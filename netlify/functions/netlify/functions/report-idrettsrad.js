const { createClient } = require("@supabase/supabase-js");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function normalize(value) {
  return String(value || "").trim();
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    if (
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return json(500, {
        error: "Supabase-miljøvariabler mangler på serveren.",
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // Hent alle påmeldinger som ser ut til å være kodepåmeldinger.
    // Vi støtter flere kjennetegn for å fange både nyere og eldre rader.
    const { data: signups, error: signupError } = await supabase
      .from("skating_school_signups")
      .select(`
        id,
        child_name,
        existing_member_id,
        access_code_id,
        access_code,
        source,
        created_at
      `)
      .or(
        "access_code_id.not.is.null,access_code.not.is.null,source.eq.signup_page_code"
      )
      .order("created_at", { ascending: false });

    if (signupError) {
      console.error(
        "report-idrettsrad signups:",
        signupError
      );

      return json(500, {
        error: "Kunne ikke hente kodepåmeldinger.",
      });
    }

    const signupRows = signups || [];

    if (!signupRows.length) {
      return json(200, {
        success: true,
        rows: [],
      });
    }

    // Hent eksplisitt koblede medlemmer.
    const memberIds = Array.from(
      new Set(
        signupRows
          .map((row) => normalize(row.existing_member_id))
          .filter(Boolean)
      )
    );

    let linkedMembers = [];

    if (memberIds.length) {
      const linkedResult = await supabase
        .from("members")
        .select(
          "id, name, membership_fee_paid"
        )
        .in("id", memberIds);

      if (linkedResult.error) {
        console.error(
          "report-idrettsrad linked members:",
          linkedResult.error
        );

        return json(500, {
          error: "Kunne ikke hente medlemsstatus.",
        });
      }

      linkedMembers = linkedResult.data || [];
    }

    const linkedById = new Map(
      linkedMembers.map((member) => [
        String(member.id),
        member,
      ])
    );

    // For eldre påmeldinger uten existing_member_id
    // prøver vi entydig navnematch.
    const unresolvedNames = Array.from(
      new Set(
        signupRows
          .filter(
            (row) =>
              !normalize(row.existing_member_id)
          )
          .map((row) =>
            normalize(row.child_name)
          )
          .filter(Boolean)
      )
    );

    let nameMembers = [];

    if (unresolvedNames.length) {
      const membersResult = await supabase
        .from("members")
        .select(
          "id, name, membership_fee_paid"
        );

      if (membersResult.error) {
        console.error(
          "report-idrettsrad all members:",
          membersResult.error
        );

        return json(500, {
          error: "Kunne ikke hente medlemsstatus.",
        });
      }

      nameMembers = membersResult.data || [];
    }

    const byNormalizedName = new Map();

    nameMembers.forEach((member) => {
      const key = normalize(
        member.name
      ).toLowerCase();

      if (!key) {
        return;
      }

      if (!byNormalizedName.has(key)) {
        byNormalizedName.set(
          key,
          []
        );
      }

      byNormalizedName
        .get(key)
        .push(member);
    });

    const rows = signupRows.map((signup) => {
      let member = null;

      if (signup.existing_member_id) {
        member =
          linkedById.get(
            String(
              signup.existing_member_id
            )
          ) || null;
      }

      if (!member) {
        const key = normalize(
          signup.child_name
        ).toLowerCase();

        const matches = key
          ? byNormalizedName.get(key) || []
          : [];

        if (matches.length === 1) {
          member = matches[0];
        }
      }

      return {
        name: signup.child_name || "",

        code:
          signup.access_code ||
          (
            signup.access_code_id
              ? "Kodepåmelding"
              : ""
          ),

        member_found: !!member,

        membership_fee_paid: !!(
          member &&
          member.membership_fee_paid === true
        ),
      };
    });

    rows.sort((a, b) =>
      String(a.name || "").localeCompare(
        String(b.name || ""),
        "no"
      )
    );

    return json(200, {
      success: true,
      count: rows.length,
      rows,
    });
  } catch (error) {
    console.error(
      "Unhandled report-idrettsrad error:",
      error
    );

    return json(500, {
      error:
        error &&
        error.message
          ? error.message
          : "Noe gikk galt ved generering av rapporten.",
    });
  }
};
