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

    const [departmentsResult, batchesResult] = await Promise.all([
      supabase
        .from("departments")
        .select("id, name")
        .order("name", { ascending: true }),
      supabase
        .from("skating_school_batches")
        .select("id, name, department_id, status, start_date, end_date")
        .order("created_at", { ascending: false }),
    ]);

    if (departmentsResult.error) {
      console.error("Departments lookup error:", departmentsResult.error);
      return json(500, { error: "Kunne ikke hente avdelinger." });
    }

    if (batchesResult.error) {
      console.error("Batches lookup error:", batchesResult.error);
      return json(500, { error: "Kunne ikke hente partier." });
    }

    return json(200, {
      success: true,
      departments: departmentsResult.data || [],
      batches: batchesResult.data || [],
    });
  } catch (error) {
    console.error("Unhandled list-school-code-lookups error:", error);
    return json(500, { error: "Noe gikk galt ved henting av oppslagsdata." });
  }
};
