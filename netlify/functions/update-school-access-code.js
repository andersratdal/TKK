const { createClient } = require("@supabase/supabase-js");

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
    const id = normalizeValue(body.id);

    if (!id) {
      return json(400, { error: "Mangler id." });
    }

    const updates = {
      updated_at: new Date().toISOString(),
    };

    if (body.is_active !== undefined) {
      updates.is_active = !!body.is_active;
    }

    if (body.description !== undefined) {
      updates.description = normalizeValue(body.description);
    }

    if (body.department_id !== undefined) {
      updates.department_id = normalizeValue(body.department_id);
    }

    if (body.batch_id !== undefined) {
      updates.batch_id = normalizeValue(body.batch_id);
    }

    if (body.expires_at !== undefined) {
      updates.expires_at = normalizeValue(body.expires_at);
    }

    if (body.max_uses !== undefined) {
      if (body.max_uses === null || body.max_uses === "") {
        updates.max_uses = null;
      } else {
        const maxUses = Number(body.max_uses);
        if (!Number.isInteger(maxUses) || maxUses < 1) {
          return json(400, { error: "max_uses må være et heltall større enn 0." });
        }
        updates.max_uses = maxUses;
      }
    }

    const { data, error } = await supabase
      .from("skating_school_access_codes")
      .update(updates)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("Update access code error:", error);
      return json(500, { error: "Kunne ikke oppdatere koden." });
    }

    if (!data) {
      return json(404, { error: "Fant ikke koden." });
    }

    return json(200, {
      success: true,
      code: data,
    });
  } catch (error) {
    console.error("Unhandled update-school-access-code error:", error);
    return json(500, { error: "Noe gikk galt ved oppdatering av kode." });
  }
};
