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
  if (skate.skate_code) parts.push(`ID ${skate.skate_code}`);
  if (skate.size) parts.push(`str. ${skate.size}`);
  if (skate.model) parts.push(skate.model);
  if (skate.type) parts.push(skate.type);
  return parts.length ? parts.join(" - ") : "Skøyter";
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireRole(supabase, event, allowedRoles) {
  const token = getBearerToken(event);
  if (!token) {
    return { error: json(401, { error: "Du må være logget inn." }) };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData || !userData.user || !userData.user.email) {
    return { error: json(401, { error: "Ugyldig eller utløpt innlogging." }) };
  }

  const email = String(userData.user.email).trim().toLowerCase();
  const { data: roleRow, error: roleError } = await supabase
    .from("app_user_roles")
    .select("role")
    .eq("email", email)
    .maybeSingle();

  if (roleError) {
    console.error("Role lookup error:", roleError);
    return { error: json(500, { error: "Kunne ikke sjekke tilgang." }) };
  }

  const role = roleRow && roleRow.role;
  if (!role || !allowedRoles.includes(role)) {
    return { error: json(403, { error: "Du har ikke tilgang til denne handlingen." }) };
  }

  return { user: userData.user, role };
}

async function sendLoanEmail({ member, skate }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  if (!apiKey) throw new Error("Mangler RESEND_API_KEY i Netlify miljøvariabler.");

  const resend = new Resend(apiKey);
  const memberName = member.name || "medlem";
  const skateInfo = buildSkateInfo(skate);

  return resend.emails.send({
    from,
    to: member.email,
    subject: "Du har lånt skøyter",
    html: `
      <p>Hei ${escapeHtml(memberName)},</p>

      <p>Du har nå lånt skøyter fra Trondheim Kortbaneklubb.</p>

      <p><strong>Lånte skøyter:</strong><br>${escapeHtml(skateInfo)}</p>

      <p>Ta godt vare på dem, og lever dem tilbake når du er ferdig med å bruke dem.</p>

      <p>Vennlig hilsen<br>Trondheim Kortbaneklubb</p>
    `,
    text: `Hei ${memberName}\n\nDu har nå lånt skøyter fra Trondheim Kortbaneklubb.\n\nLånte skøyter: ${skateInfo}\n\nTa godt vare på dem, og lever dem tilbake når du er ferdig med å bruke dem.\n\nVennlig hilsen\nTrondheim Kortbaneklubb`,
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

    const auth = await requireRole(supabase, event, ["admin", "utlan"]);
    if (auth.error) return auth.error;

    const body = JSON.parse(event.body || "{}");
    const department_id = normalizeValue(body.department_id);
    const member_id = normalizeValue(body.member_id);
    const skate_id = normalizeValue(body.skate_id);
    const loaned_at = normalizeValue(body.loaned_at) || new Date().toISOString();

    if (!department_id || !member_id || !skate_id || !loaned_at) {
      return json(400, { error: "Mangler avdeling, medlem, skøyte eller tidspunkt." });
    }

    const [{ data: member, error: memberError }, { data: skate, error: skateError }] = await Promise.all([
      supabase.from("members").select("id, name, email").eq("id", member_id).maybeSingle(),
      supabase.from("skates").select("id, skate_code, model, size, type, is_active").eq("id", skate_id).maybeSingle(),
    ]);

    if (memberError) {
      console.error("Member fetch error:", memberError);
      return json(500, { error: "Kunne ikke hente medlem." });
    }

    if (skateError) {
      console.error("Skate fetch error:", skateError);
      return json(500, { error: "Kunne ikke hente skøyte." });
    }

    if (!member) return json(404, { error: "Fant ikke medlemmet." });
    if (!skate) return json(404, { error: "Fant ikke skøyten." });
    if (skate.is_active === false) return json(400, { error: "Skøyten er arkivert og kan ikke lånes ut." });
    if (!member.email) return json(400, { error: "Medlemmet mangler e-postadresse. Utlånet ble ikke registrert." });

    const activeLoan = await supabase
      .from("loans")
      .select("id")
      .eq("skate_id", skate_id)
      .is("returned_at", null)
      .limit(1);

    if (activeLoan.error) {
      console.error("Active loan check error:", activeLoan.error);
      return json(500, { error: "Kunne ikke sjekke om skøyten er ledig." });
    }

    if ((activeLoan.data || []).length > 0) {
      return json(409, { error: "Denne skøyten er allerede utlånt." });
    }

    const insertResult = await supabase
      .from("loans")
      .insert([{ department_id, member_id, skate_id, loaned_at }])
      .select("*")
      .single();

    if (insertResult.error) {
      console.error("Loan insert error:", insertResult.error);
      return json(500, { error: "Kunne ikke registrere utlån." });
    }

    try {
      await sendLoanEmail({ member, skate });
    } catch (emailError) {
      console.error("Loan email error:", emailError);
      return json(500, {
        error: "Utlånet ble registrert, men e-posten kunne ikke sendes. Sjekk Resend/EMAIL_FROM i Netlify.",
        loan: insertResult.data,
      });
    }

    const sentAt = new Date().toISOString();
    const updateResult = await supabase
      .from("loans")
      .update({ email_sent_at: sentAt })
      .eq("id", insertResult.data.id)
      .select("*")
      .single();

    if (updateResult.error) {
      console.error("Loan email_sent_at update error:", updateResult.error);
      return json(200, {
        success: true,
        warning: "E-post ble sendt, men email_sent_at kunne ikke lagres.",
        loan: insertResult.data,
      });
    }

    return json(200, {
      success: true,
      email_sent_at: sentAt,
      loan: updateResult.data,
    });
  } catch (error) {
    console.error("Unhandled create-loan error:", error);
    return json(500, { error: "Noe gikk galt ved registrering av utlån." });
  }
};
