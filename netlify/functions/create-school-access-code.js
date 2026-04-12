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

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "TKK-";
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
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

    let code = normalizeValue(body.code) || generateCode();
    code = code.toUpperCase();

    const description = normalizeValue(body.description);
    const departmentId = normalizeValue(body.department_id);
    const batchId = normalizeValue(body.batch_id);
    const expiresAt = normalizeValue(body.expires_at);
    const isActive = body.is_active === undefined ? true : !!body.is_active;

    let maxUses = body.max_uses;
    if (maxUses === "" || maxUses === undefined || maxUses === null) {
      maxUses = null;
    } else {
      maxUses = Number(maxUses);
      if (!Number.isInteger(maxUses) || maxUses < 1) {
        return json(400, { error: "max_uses må være et heltall større enn 0." });
      }
    }

    const { data: existingCode, error: existingError } = await supabase
      .from("skating_school_access_codes")
      .select("id")
      .eq("code", code)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error("Existing code lookup error:", existingError);
      return json(500, { error: "Kunne ikke kontrollere om koden finnes fra før." });
    }

    if (existingCode) {
      return json(400, { error: "Koden finnes allerede. Prøv en annen." });
    }

    if (departmentId) {
      const { data: dept, error: deptError } = await supabase
        .from("departments")
        .select("id")
        .eq("id", departmentId)
        .limit(1)
        .maybeSingle();

      if (deptError) {
        console.error("Department lookup error:", deptError);
        return json(500, { error: "Kunne ikke kontrollere avdeling." });
      }

      if (!dept) {
        return json(400, { error: "Ugyldig department_id." });
      }
    }

    if (batchId) {
      const { data: batch, error: batchError } = await supabase
        .from("skating_school_batches")
        .select("id")
        .eq("id", batchId)
        .limit(1)
        .maybeSingle();

      if (batchError) {
        console.error("Batch lookup error:", batchError);
        return json(500, { error: "Kunne ikke kontrollere parti." });
      }

      if (!batch) {
        return json(400, { error: "Ugyldig batch_id." });
      }
    }

    const insertPayload = {
      code,
      description,
      department_id: departmentId,
      batch_id: batchId,
      is_active: isActive,
      max_uses: maxUses,
      used_count: 0,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("skating_school_access_codes")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      console.error("Create access code error:", error);
      return json(500, { error: "Kunne ikke opprette kode." });
    }

    return json(200, {
      success: true,
      code: data,
    });
  } catch (error) {
    console.error("Unhandled create-school-access-code error:", error);
    return json(500, { error: "Noe gikk galt ved opprettelse av kode." });
  }
};
