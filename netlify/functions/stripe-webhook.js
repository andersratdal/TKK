const Stripe = require('stripe');
const { json, database } = require('./lib/school-semester');
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let stripeEvent;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'];
    if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) return json(400, { error: 'Missing signature or webhook configuration' });
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) { console.error(error); return json(400, { error: 'Webhook Error' }); }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(stripeEvent.type)) return json(200, { received: true });
  const session = stripeEvent.data.object;
  if (session.payment_status !== 'paid') return json(200, { received: true });
  const familyId = session.metadata?.family_signup_id || session.client_reference_id;
  if (!familyId) return json(200, { received: true });
  try {
    // Never look up the CURRENT default: a session retains its original family,
    // batch, and checkout request after closure or a semester switch.
    let query = database().from('skating_school_signups').update({
      payment_status: 'Betalt', stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent || null,
      paid_at: new Date(stripeEvent.created * 1000).toISOString()
    }).eq('family_signup_id', familyId);
    if (session.metadata?.checkout_request_id && session.metadata?.batch_id) {
      query = query.eq('school_checkout_request_id', session.metadata.checkout_request_id).eq('batch_id', session.metadata.batch_id);
    } else {
      // Sessions started before this release must match their stored session ID.
      query = query.eq('stripe_checkout_session_id', session.id);
    }
    const { data, error } = await query.select('id');
    if (error || !data?.length) throw error || new Error('No matching signup for paid session; retry required');
    return json(200, { received: true });
  } catch (error) { console.error(error); return json(500, { error: 'Database update failed; retry webhook' }); }
};
