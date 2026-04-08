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
    const { family_signup_id } = JSON.parse(event.body || "{}");

    if (!family_signup_id) {
      return json(400, { error: "Missing family_signup_id" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: signups, error: signupError } = await supabase
      .from("skating_school_signups")
      .select("*")
      .eq("family_signup_id", family_signup_id)
      .order("created_at", { ascending: true });

    if (signupError) {
      console.error("Signup fetch error:", signupError);
      return json(500, { error: "Failed to fetch family signups" });
    }

    if (!signups || !signups.length) {
      return json(404, { error: "Family signups not found" });
    }

    const unpaidSignups = signups.filter((row) => String(row.payment_status || "") !== "Betalt");

    if (!unpaidSignups.length) {
      return json(400, { error: "Family signup is already paid" });
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

    const childCount = unpaidSignups.length;
    const unitAmountOre = Math.round(amountNok * 100);
    const totalAmountNok = amountNok * childCount;
    const siteUrl = (process.env.SITE_URL || process.env.URL || "").replace(/\/+$/, "");

    if (!siteUrl) {
      console.error("Missing SITE_URL");
      return json(500, { error: "Missing SITE_URL" });
    }

    const primarySignup = unpaidSignups[0];
    const childNames = unpaidSignups.map((row) => row.child_name).filter(Boolean).join(", ");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: String(family_signup_id),
      success_url: `${siteUrl}/pamelding-bekreftet-tkk.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/betaling-avbrutt.html`,
      customer_email: primarySignup.email || undefined,
      phone_number_collection: {
        enabled: true,
      },
      metadata: {
        family_signup_id: String(family_signup_id),
        child_count: String(childCount),
        batch_name: String(primarySignup.batch_name || ""),
      },
      line_items: [
        {
          quantity: childCount,
          price_data: {
            currency: "nok",
            unit_amount: unitAmountOre,
            product_data: {
              name: "Skøyteskole",
              description: childNames ? `Trondheim Kortbaneklubb – ${childNames}` : "Trondheim Kortbaneklubb",
            },
          },
        },
      ],
    });

    const signupIds = unpaidSignups.map((row) => row.id);

    const { error: updateError } = await supabase
      .from("skating_school_signups")
      .update({
        amount_nok: amountNok,
        stripe_checkout_session_id: session.id,
      })
      .in("id", signupIds);

    if (updateError) {
      console.error("Signup update error:", updateError);
      return json(500, { error: "Failed to update signups before checkout" });
    }

    return json(200, {
      url: session.url,
      session_id: session.id,
      child_count: childCount,
      total_amount_nok: totalAmountNok,
    });
  } catch (error) {
    console.error("Create checkout error:", error);
    return json(500, { error: "Failed to create checkout session" });
  }
};
