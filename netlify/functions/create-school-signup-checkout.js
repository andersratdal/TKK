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
    const { signup_id } = JSON.parse(event.body || "{}");

    if (!signup_id) {
      return json(400, { error: "Missing signup_id" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: signup, error: signupError } = await supabase
      .from("skating_school_signups")
      .select("*")
      .eq("id", signup_id)
      .single();

    if (signupError || !signup) {
      console.error("Signup fetch error:", signupError);
      return json(404, { error: "Signup not found" });
    }

    if (String(signup.payment_status || "") === "Betalt") {
      return json(400, { error: "Signup is already paid" });
    }

    const amountNokRaw = process.env.SCHOOL_SIGNUP_AMOUNT_NOK;

    if (!amountNokRaw) {
      console.error("Missing SCHOOL_SIGNUP_AMOUNT_NOK");
      return json(500, { error: "Server config error: missing amount" });
    }

    const amountNok = Number(amountNokRaw);

    if (!Number.isFinite(amountNok) || amountNok <= 0) {
      console.error("Invalid SCHOOL_SIGNUP_AMOUNT_NOK:", amountNokRaw);
      return json(500, { error: "Server config error: invalid amount" });
    }

    const unitAmountOre = Math.round(amountNok * 100);
    const siteUrl = process.env.SITE_URL || process.env.URL || "";

    if (!siteUrl) {
      console.error("Missing SITE_URL");
      return json(500, { error: "Missing SITE_URL" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: String(signup.id),
      success_url: `${siteUrl}/pamelding-bekreftet-tkk.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/betaling-avbrutt.html`,
      customer_email: signup.email || undefined,
      phone_number_collection: {
        enabled: true,
      },
      metadata: {
        signup_id: String(signup.id),
        child_name: String(signup.child_name || ""),
        batch_name: String(signup.batch_name || ""),
        phone: String(signup.phone || ""),
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "nok",
            unit_amount: unitAmountOre,
            product_data: {
              name: "Skøyteskole",
              description: "Trondheim Kortbaneklubb",
            },
          },
        },
      ],
    });

    const { error: updateError } = await supabase
      .from("skating_school_signups")
      .update({
        amount_nok: amountNok,
        stripe_checkout_session_id: session.id,
      })
      .eq("id", signup.id);

    if (updateError) {
      console.error("Signup update error:", updateError);
      return json(500, { error: "Failed to update signup before checkout" });
    }

    return json(200, {
      url: session.url,
      session_id: session.id,
    });
  } catch (error) {
    console.error("Create checkout error:", error);
    return json(500, { error: "Failed to create checkout session" });
  }
};
