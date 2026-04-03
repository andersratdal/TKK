const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const { signup_id } = JSON.parse(event.body || "{}");
    if (!signup_id) return json(400, { error: "signup_id mangler" });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const signupRes = await supabase
      .from("skating_school_signups")
      .select("id, batch_name, child_name, email, payment_status, amount_nok")
      .eq("id", signup_id)
      .single();

    if (signupRes.error || !signupRes.data) {
      return json(404, { error: "Fant ikke påmelding" });
    }

    const signup = signupRes.data;
    if (String(signup.payment_status || "") === "Betalt") {
      return json(400, { error: "Påmeldingen er allerede betalt" });
    }

    const defaultAmountNok = Number(process.env.SCHOOL_SIGNUP_AMOUNT_NOK || 1500);
    const amountNok = Number(signup.amount_nok || defaultAmountNok);
    const siteUrl = process.env.SITE_URL || process.env.URL || "";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${siteUrl}/betaling-fullfort.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/betaling-avbrutt.html?signup_id=${signup.id}`,
      line_items: [
        {
          price_data: {
            currency: "nok",
            product_data: {
              name: `Skøyteskole ${signup.batch_name || ""}`.trim(),
            },
            unit_amount: Math.round(amountNok * 100),
          },
          quantity: 1,
        },
      ],
      customer_email: signup.email || undefined,
      metadata: {
        signup_id: String(signup.id),
        child_name: String(signup.child_name || ""),
        batch_name: String(signup.batch_name || ""),
      },
    });

    const upd = await supabase
      .from("skating_school_signups")
      .update({
        stripe_checkout_session_id: session.id,
        amount_nok: amountNok,
      })
      .eq("id", signup.id);

    if (upd.error) {
      return json(500, { error: "Checkout ble opprettet, men kunne ikke lagre session-id i databasen." });
    }

    return json(200, { url: session.url, session_id: session.id });
  } catch (error) {
    console.error(error);
    return json(500, { error: error && error.message ? error.message : "Ukjent feil" });
  }
};
