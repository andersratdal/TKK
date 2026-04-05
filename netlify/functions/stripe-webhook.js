const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const signature =
      event.headers["stripe-signature"] ||
      event.headers["Stripe-Signature"];

    const body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");

    const stripeEvent = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log("Stripe webhook received", {
  type: stripeEvent.type,
  id: stripeEvent.id,
});

    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      const signupId = session && session.metadata ? session.metadata.signup_id : null;

      if (!signupId) {
  console.error("Missing signupId in Stripe session", {
    sessionId: session?.id,
    metadata: session?.metadata,
    client_reference_id: session?.client_reference_id,
  });
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const upd = await supabase
  .from("skating_school_signups")
  .update({
    payment_status: "Betalt",
    stripe_checkout_session_id: session.id || null,
    stripe_payment_intent_id: session.payment_intent || null,
    paid_at: new Date().toISOString(),
  })
  .eq("id", signupId);

if (upd.error) {
  console.error("Supabase update failed", upd.error);
  return { statusCode: 500, body: "Database update failed" };
}
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error(error);
    return { statusCode: 400, body: `Webhook Error: ${error.message}` };
  }
};

exports.config = {
  path: "/.netlify/functions/stripe-webhook",
};
