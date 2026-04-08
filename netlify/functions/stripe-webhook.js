const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const signature =
      event.headers["stripe-signature"] ||
      event.headers["Stripe-Signature"];

    if (!signature) {
      console.error("Missing Stripe signature header");
      return json(400, { error: "Missing Stripe signature" });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("Missing STRIPE_WEBHOOK_SECRET");
      return json(500, { error: "Missing STRIPE_WEBHOOK_SECRET" });
    }

    const stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      signature,
      webhookSecret
    );

    console.log("Stripe webhook received", {
      type: stripeEvent.type,
      id: stripeEvent.id,
    });

    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      const familySignupId =
        session?.metadata?.family_signup_id ||
        session?.client_reference_id ||
        null;

      if (!familySignupId) {
        console.error("Missing family_signup_id in Stripe session", {
          sessionId: session?.id,
          metadata: session?.metadata,
          client_reference_id: session?.client_reference_id,
        });

        return json(200, { received: true });
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
        .eq("family_signup_id", familySignupId);

      if (upd.error) {
        console.error("Supabase update failed", upd.error);
        return {
          statusCode: 500,
          body: "Database update failed",
        };
      }

      console.log("Family signup marked as paid", {
        familySignupId,
        sessionId: session?.id,
        paymentIntentId: session?.payment_intent || null,
      });
    }

    return json(200, { received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return json(400, { error: "Webhook Error" });
  }
};
