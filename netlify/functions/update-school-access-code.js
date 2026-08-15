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

    let code = normalizeValue(body.code) || generateCode();
    code = code.toUpperCase();

const description = normalizeValue(body.description);
const departmentId = normalizeValue(body.department_id);
const batchId = normalizeValue(body.batch_id);
    const expiresAt = normalizeValue(body.expires_at);
    const expiresAt = normalizeValue(body.expires_at) || addYearsIso(3);
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
    const quantity = Number(body.quantity || 1);

    if (existingCode) {
      return json(400, { error: "Koden finnes allerede. Prøv en annen." });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      return json(400, { error: "Antall må være mellom 1 og 500." });
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
    const codes = await generateUniqueCodes(supabase, quantity);

    const insertPayload = {
    const insertPayload = codes.map((code) => ({
code,
description,
department_id: departmentId,
batch_id: batchId,
is_active: isActive,
      max_uses: maxUses,
      max_uses: null,
used_count: 0,
expires_at: expiresAt,
updated_at: new Date().toISOString(),
    };
    }));

const { data, error } = await supabase
.from("skating_school_access_codes")
.insert(insertPayload)
      .select("*")
      .single();
      .select("*");

if (error) {
      console.error("Create access code error:", error);
      return json(500, { error: "Kunne ikke opprette kode." });
      console.error("Create access codes error:", error);
      return json(500, { error: "Kunne ikke opprette koder." });
}

return json(200, {
success: true,
      code: data,
      codes: data || [],
});
} catch (error) {
console.error("Unhandled create-school-access-code error:", error);
    return json(500, { error: "Noe gikk galt ved opprettelse av kode." });
    return json(500, { error: "Noe gikk galt ved opprettelse av koder." });
}
};
