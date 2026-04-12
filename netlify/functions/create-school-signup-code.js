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

function normalizePhone(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/\s+/g, "").trim();
  return digits || null;
}

function generateFamilySignupId() {
  return `FAM-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function validateChildren(children) {
  if (!Array.isArray(children) || !children.length) {
    return "Du må legge til minst ett barn.";
  }

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    const number = i + 1;

    if (!normalizeValue(child.child_name)) {
      return `Barn ${number}: Du må fylle inn barnets navn.`;
    }

    if (!normalizeValue(child.birth_date)) {
      return `Barn ${number}: Du må fylle inn fødselsdato.`;
    }

    const requestedSkateSize = normalizeValue(child.requested_skate_size);
    const hasOwnSkates = !!child.has_own_skates;

    if (!requestedSkateSize && !hasOwnSkates) {
      return `Barn ${number}: Du må enten velge skøytestørrelse eller krysse av for egne skøyter.`;
    }

    if (requestedSkateSize && hasOwnSkates) {
      return `Barn ${number}: Du kan ikke velge både størrelse og egne skøyter.`;
    }
  }

  return null;
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

    const accessCode = normalizeValue(body.access_code);
    const phone = normalizePhone(body.phone);
    const email = normalizeValue(body.email)?.toLowerCase() || null;
    const children = Array.isArray(body.children) ? body.children : [];
    const batchId = normalizeValue(body.batch_id);
    const batchName = normalizeValue(body.batch_name);

    if (!accessCode) {
      return json(400, { error: "Manglende kode." });
    }

    if (!phone) {
      return json(400, { error: "Du må fylle inn telefon." });
    }

    if (!email) {
      return json(400, { error: "Du må fylle inn e-post." });
    }

    const childValidationError = validateChildren(children);
    if (childValidationError) {
      return json(400, { error: childValidationError });
    }

    let batchQuery = supabase
      .from("skating_school_batches")
      .select("id, name, department_id, status")
      .limit(1);

    if (batchId) {
      batchQuery = batchQuery.eq("id", batchId);
    } else if (batchName) {
      batchQuery = batchQuery.eq("name", batchName);
    } else {
      batchQuery = batchQuery.eq("status", "Aktiv");
    }

    const { data: activeBatch, error: batchError } = await batchQuery.maybeSingle();

    if (batchError) {
      console.error("Batch fetch error:", batchError);
      return json(500, { error: "Kunne ikke hente parti." });
    }

    if (!activeBatch) {
      return json(400, { error: "Fant ikke gyldig parti for påmeldingen." });
    }

    const { data: codeRow, error: codeError } = await supabase
      .from("skating_school_access_codes")
      .select("*")
      .eq("code", accessCode)
      .limit(1)
      .maybeSingle();

    if (codeError) {
      console.error("Access code fetch error:", codeError);
      return json(500, { error: "Kunne ikke validere kode." });
    }

    if (!codeRow) {
      return json(400, { error: "Koden er ugyldig." });
    }

    if (!codeRow.is_active) {
      return json(400, { error: "Koden er ikke aktiv." });
    }

    if (codeRow.expires_at && new Date(codeRow.expires_at).getTime() < Date.now()) {
      return json(400, { error: "Koden er utløpt." });
    }

    if (
      codeRow.department_id &&
      activeBatch.department_id &&
      codeRow.department_id !== activeBatch.department_id
    ) {
      return json(400, { error: "Koden gjelder ikke for dette partiet." });
    }

    if (codeRow.batch_id && codeRow.batch_id !== activeBatch.id) {
      return json(400, { error: "Koden gjelder ikke for dette partiet." });
    }

    const usedCount = Number(codeRow.used_count || 0);
    const maxUses =
      codeRow.max_uses === null || codeRow.max_uses === undefined
        ? null
        : Number(codeRow.max_uses);

    // Én bruk = én familiepåmelding
    if (maxUses !== null && usedCount >= maxUses) {
      return json(400, { error: "Koden er allerede brukt opp." });
    }

    const familySignupId = generateFamilySignupId();

    const rows = children.map((child) => ({
      family_signup_id: familySignupId,
      batch_name: activeBatch.name,
      batch_id: activeBatch.id,
      department_id: activeBatch.department_id || null,
      child_name: normalizeValue(child.child_name),
      phone,
      email,
      birth_date: normalizeValue(child.birth_date),
      requested_skate_size: normalizeValue(child.requested_skate_size),
      has_own_skates: !!child.has_own_skates,
      status: "Ny",
      payment_status: "Fritatt",
      payment_exempt: true,
      amount_nok: 0,
      source: "signup_page_code",
      notes: "Påmeldt via kodepåmelding.",
      access_code_id: codeRow.id,
      access_code: codeRow.code,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      paid_at: new Date().toISOString(),
    }));

    const { data: insertedRows, error: insertError } = await supabase
      .from("skating_school_signups")
      .insert(rows)
      .select("id, family_signup_id, child_name, access_code");

    if (insertError) {
      console.error("Signup insert error:", insertError);
      return json(500, { error: "Kunne ikke lagre påmeldingen." });
    }

    const nextUsedCount = usedCount + 1;

    const { error: updateCodeError } = await supabase
      .from("skating_school_access_codes")
      .update({
        used_count: nextUsedCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", codeRow.id);

    if (updateCodeError) {
      console.error("Access code update error:", updateCodeError);
      return json(500, {
        error: "Påmeldingen ble lagret, men koden kunne ikke oppdateres.",
      });
    }

    return json(200, {
      success: true,
      family_signup_id: familySignupId,
      redirect_url: "/betaling-fullfort-tkk.html",
      signups: insertedRows || [],
    });
  } catch (error) {
    console.error("Create code signup error:", error);
    return json(500, { error: "Kunne ikke fullføre kodepåmelding." });
  }
};
