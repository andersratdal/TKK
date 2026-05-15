const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str ? str : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildSkateInfo(skate) {
  const parts = [];
  if (skate?.skate_code) parts.push(`ID ${skate.skate_code}`);
  if (skate?.size) parts.push(`str. ${skate.size}`);
  if (skate?.model) parts.push(skate.model);
  if (skate?.type) parts.push(skate.type);
  return parts.length ? parts.join(" - ") : "Skøyter";
}

async function sendReturnEmail({ member, skate }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  if (!apiKey) throw new Error("Mangler RESEND_API_KEY i Netlify miljøvariabler.");

  const resend = new Resend(apiKey);
  const memberName = member.name || "medlem";
  const skateInfo = buildSkateInfo(skate);

  return resend.emails.send({
    from,
    to: member.email,
    subject: "Skøyter er levert inn",
    html: `
      <p>Hei ${escapeHtml(memberName)},</p>

      <p>Vi bekrefter at skøytene du lånte fra Trondheim Kortbaneklubb nå er registrert som levert inn.</p>

      <p><strong>Innleverte skøyter:</strong><br>${escapeHtml(skateInfo)}</p>

      <p>Takk for at du leverte dem tilbake.</p>

      <p>Vennlig hilsen<br>Trondheim Kortbaneklubb</p>
    `,
    text: `Hei ${memberName},\n\nVi bekrefter at skøytene du lånte fra Trondheim Kortbaneklubb nå er registrert som levert inn.\n\nInnleverte skøyter: ${skateInfo}\n\nTakk for at du leverte dem tilbake.\n\nVennlig hilsen\nTrondheim Kortbaneklubb`,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const body = JSON.parse(event.body || "{}");
    const loan_id = normalizeValue(body.loan_id);
    const returned_at = normalizeValue(body.returned_at) || new Date().toISOString();

    if (!loan_id) {
      return json(400, { error: "Mangler loan_id." });
    }

    const { data: loan, error: loanError } = await supabase
      .from("loans")
      .select(`
        id,
        returned_at,
        return_email_sent_at,
        member_id,
        skate_id,
        members:member_id (id, name, email),
        skates:skate_id (id, skate_code, model, size, type)
      `)
      .eq("id", loan_id)
      .maybeSingle();

    if (loanError) {
      console.error("Return loan fetch error:", loanError);
      return json(500, { error: "Kunne ikke hente utlånet." });
    }

    if (!loan) return json(404, { error: "Fant ikke utlånet." });
    if (loan.returned_at) return json(409, { error: "Dette utlånet er allerede innlevert." });

    const member = loan.members;
    const skate = loan.skates;

    if (!member) return json(404, { error: "Fant ikke medlemmet på utlånet." });
    if (!skate) return json(404, { error: "Fant ikke skøyten på utlånet." });
    if (!member.email) return json(400, { error: "Medlemmet mangler e-postadresse. Innleveringen ble ikke registrert." });

    const updateResult = await supabase
      .from("loans")
      .update({ returned_at })
      .eq("id", loan_id)
      .is("returned_at", null)
      .select("*")
      .single();

    if (updateResult.error) {
      console.error("Return loan update error:", updateResult.error);
      return json(500, { error: "Kunne ikke registrere innlevering." });
    }

    try {
      await sendReturnEmail({ member, skate });
    } catch (emailError) {
      console.error("Return email error:", emailError);
      return json(500, {
        error: "Innleveringen ble registrert, men e-posten kunne ikke sendes. Sjekk Resend/EMAIL_FROM i Netlify.",
        loan: updateResult.data,
      });
    }

    const sentAt = new Date().toISOString();
    const sentUpdate = await supabase
      .from("loans")
      .update({ return_email_sent_at: sentAt })
      .eq("id", loan_id)
      .select("*")
      .single();

    if (sentUpdate.error) {
      console.error("return_email_sent_at update error:", sentUpdate.error);
      return json(200, {
        success: true,
        warning: "E-post ble sendt, men return_email_sent_at kunne ikke lagres.",
        loan: updateResult.data,
      });
    }

    return json(200, {
      success: true,
      return_email_sent_at: sentAt,
      loan: sentUpdate.data,
    });
  } catch (error) {
    console.error("Unhandled return-loan error:", error);
    return json(500, { error: "Noe gikk galt ved registrering av innlevering." });
  }
};
