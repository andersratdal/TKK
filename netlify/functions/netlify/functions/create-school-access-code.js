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
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function addYearsIso(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString();
}

async function generateUniqueCodes(supabase, quantity) {
  const codes = [];
  const seen = new Set();

  while (codes.length < quantity) {
    const candidate = generateCode();

    if (seen.has(candidate)) continue;

    const { data, error } = await supabase
      .from("skating_school_access_codes")
      .select("id")
      .eq("code", candidate)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      seen.add(candidate);
      codes.push(candidate);
    }
  }

  return codes;
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

    const description = normalizeValue(body.description);
    const departmentId = normalizeValue(body.department_id);
    const batchId = normalizeValue(body.batch_id);
    const expiresAt = normalizeValue(body.expires_at) || addYearsIso(3);
    const isActive = body.is_active === undefined ? true : !!body.is_active;

    const quantity = Number(body.quantity || 1);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      return json(400, { error: "Antall må være mellom 1 og 500." });
    }

    const codes = await generateUniqueCodes(supabase, quantity);

    const insertPayload = codes.map((code) => ({
      code,
      description,
      department_id: departmentId,
      batch_id: batchId,
      is_active: isActive,
      max_uses: null,
      used_count: 0,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("skating_school_access_codes")
      .insert(insertPayload)
      .select("*");

    if (error) {
      console.error(error);
      return json(500, { error: "Kunne ikke opprette koder." });
    }

    return json(200, {
      success: true,
      codes: data,
    });

  } catch (error) {
    console.error(error);
    return json(500, { error: "Noe gikk galt." });
  }
};
