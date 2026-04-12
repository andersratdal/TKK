const { createClient } = require("@supabase/supabase-js");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async () => {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("skating_school_access_codes")
      .select(`
        id,
        code,
        description,
        department_id,
        batch_id,
        is_active,
        max_uses,
        used_count,
        expires_at,
        created_at,
        updated_at,
        departments:department_id (
          id,
          name
        ),
        skating_school_batches:batch_id (
          id,
          name
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("List access codes error:", error);
      return json(500, { error: "Kunne ikke hente koder." });
    }

    const codes = (data || []).map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      department_id: row.department_id,
      batch_id: row.batch_id,
      is_active: row.is_active,
      max_uses: row.max_uses,
      used_count: row.used_count,
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      department_name: row.departments?.name || null,
      batch_name: row.skating_school_batches?.name || null,
    }));

    return json(200, {
      success: true,
      codes,
    });
  } catch (error) {
    console.error("Unhandled list-school-access-codes error:", error);
    return json(500, { error: "Noe gikk galt ved henting av koder." });
  }
};
