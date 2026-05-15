const { createClient } = require("@supabase/supabase-js");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ["admin", "utlan", "skoyteskole"].includes(role) ? role : null;
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: "Server mangler Supabase-konfigurasjon." });
    }

    const token = getBearerToken(event);
    if (!token) {
      return json(401, { error: "Du må være innlogget." });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData || !userData.user || !userData.user.email) {
      return json(401, { error: "Ugyldig innlogging." });
    }

    const requesterEmail = normalizeEmail(userData.user.email);
    const { data: requesterRole, error: roleError } = await supabase
      .from("app_user_roles")
      .select("role")
      .eq("email", requesterEmail)
      .maybeSingle();

    if (roleError) {
      console.error("Role lookup error:", roleError);
      return json(500, { error: "Kunne ikke kontrollere tilgang." });
    }

    if (!requesterRole || requesterRole.role !== "admin") {
      return json(403, { error: "Kun admin kan opprette brukere." });
    }

    const body = JSON.parse(event.body || "{}");
    const email = normalizeEmail(body.email);
    const role = normalizeRole(body.role);
    const password = String(body.password || "");

    if (!email) {
      return json(400, { error: "Mangler e-post." });
    }

    if (!role) {
      return json(400, { error: "Ugyldig rolle." });
    }

    if (password.length < 8) {
      return json(400, { error: "Midlertidig passord må være minst 8 tegn." });
    }

    const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      const msg = String(createError.message || "");
      if (!msg.toLowerCase().includes("already")) {
        console.error("Create auth user error:", createError);
        return json(400, { error: "Kunne ikke opprette bruker: " + msg });
      }
    }

    const { error: roleUpsertError } = await supabase
      .from("app_user_roles")
      .upsert(
        {
          email,
          role,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "email" }
      );

    if (roleUpsertError) {
      console.error("Role upsert error:", roleUpsertError);
      return json(500, { error: "Bruker ble opprettet, men rollen kunne ikke lagres." });
    }

    return json(200, {
      success: true,
      email,
      role,
      auth_user_id: createdUser && createdUser.user ? createdUser.user.id : null,
    });
  } catch (error) {
    console.error("Unhandled create-app-user error:", error);
    return json(500, { error: "Noe gikk galt ved opprettelse av bruker." });
  }
};
