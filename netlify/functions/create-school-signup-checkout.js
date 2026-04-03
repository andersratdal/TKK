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
    if (!signup_id) {
      return json(400, { error: "signup_id mangler" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: signup, error } = await supabase
      .from("skating_school_signups")
      .select("id, batch_name, child_name, email, phone, payment_status, amount_nok")
      .eq("id", signup_id)
      .single();

    if (error || !signup) {
      return json(404, { error: "Fant ikke påmelding" });
    }

    if (String(signup.payment_status || "") === "Betalt") {
      return json(400, { error: "Allerede betalt" });
    }

    // 🔥 Viktig linje (styrer beløp)
    const amountNok = Number(
      process.env.SCHOOL_SIGNUP_AMOUNT_NOK || signup.amount_nok || 1500
    );

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

      // 👉 gjør at Stripe spør etter telefon
      phone_number_collection: {
        enabled: true,
      },

      metadata: {
        signup_id: String(signup.id),
        child_name: String(signup.child_name || ""),
        batch_name: String(signup.batch_name || ""),
        phone: String(signup.phone || ""),
      },
    });

    await supabase
      .from("skating_school_signups")
      .update({
        stripe_checkout_session_id: session.id,
        amount_nok: amountNok,
      })
      .eq("id", signup.id);

    return json(200, {
      url: session.url,
      amount_nok: amountNok,
    });

  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || "Ukjent feil" });
  }
};
