const Stripe = require('stripe');
const { json, database } = require('./lib/school-semester');
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metoden er ikke tillatt.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Ugyldig forespørsel.' }); }
  const familyId = body?.family_signup_id;
  if (typeof familyId !== 'string' || familyId.length > 100 || !familyId) return json(400, { error: 'Påmeldingsreferanse mangler.' });
  try {
    const unitAmount = Number(process.env.SCHOOL_SIGNUP_AMOUNT_NOK);
    const siteUrl = (process.env.SITE_URL || process.env.URL || '').replace(/\/+$/, '');
    if (!Number.isInteger(unitAmount) || unitAmount <= 0 || !siteUrl || !process.env.STRIPE_SECRET_KEY) throw new Error('Betalingsoppsett mangler.');
    const db = database(), stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    async function prepare(expiredSession = null) {
      const { data, error } = await db.rpc('school_prepare_checkout', { p_family_id: familyId, p_amount: unitAmount, p_expired_session: expiredSession });
      if (error) { const err = new Error(error.code === 'P0001' ? error.message : 'Kunne ikke klargjøre betaling.'); err.statusCode = error.code === 'P0001' ? 409 : 500; throw err; }
      return data;
    }
    let prepared = await prepare();
    if (prepared.session_id) {
      const existing = await stripe.checkout.sessions.retrieve(prepared.session_id);
      if (existing.status === 'open' && existing.url) return json(200, { url: existing.url, session_id: existing.id });
      if (existing.status === 'complete') return json(409, { error: 'Betalingen er sendt inn. Vent på bekreftelsen før du prøver igjen.' });
      if (existing.status !== 'expired') throw new Error('Ukjent betalingsstatus.');
      prepared = await prepare(prepared.session_id); // Only a verified expired session may be replaced, and only while open.
    }
    const rows = prepared.rows;
    if (!rows?.length) throw new Error('Fant ingen ubetalte påmeldinger.');
    const amount = rows[0].amount_nok;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', client_reference_id: familyId,
      success_url: `${siteUrl}/pamelding-bekreftet-tkk.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/betaling-avbrutt.html`,
      customer_email: rows[0].email || undefined, phone_number_collection: { enabled: true },
      metadata: { family_signup_id: familyId, batch_id: String(prepared.batch_id), batch_name: String(prepared.batch_name || ''), child_count: String(rows.length), checkout_request_id: prepared.request_id },
      line_items: [{ quantity: rows.length, price_data: { currency: 'nok', unit_amount: Math.round(amount * 100), product_data: { name: `Skøyteskole – ${prepared.batch_name}`, description: 'Trondheim Kortbaneklubb – ' + rows.map(row => row.child_name).join(', ') } } }]
    }, { idempotencyKey: `school-${prepared.request_id}` });
    const { data: updated, error } = await db.from('skating_school_signups').update({ stripe_checkout_session_id: session.id })
      .in('id', rows.map(row => row.id)).eq('school_checkout_request_id', prepared.request_id).select('id');
    if (error || updated?.length !== rows.length) throw new Error('Kunne ikke lagre betalingsreferansen. Prøv samme betaling igjen.');
    return json(200, { url: session.url, session_id: session.id, child_count: rows.length, total_amount_nok: amount * rows.length });
  } catch (error) { console.error(error); return json(error.statusCode || 500, { error: error.statusCode ? error.message : 'Kunne ikke starte betaling. Prøv igjen eller kontakt administrator.' }); }
};
