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
  return String(value || "")
    .trim()
    .toLowerCase();
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
        error: "Supabase-miljøvariabler mangler.",
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

    /*
     * 1. Hent aktive semester.
     */
    const {
      data: activeBatches,
      error: batchError,
    } = await supabase
      .from("skating_school_batches")
      .select(`
        id,
        name,
        department_id,
        status
      `)
      .eq("status", "Aktiv");

    if (batchError) {
      console.error(
        "Aktive semester:",
        batchError
      );

      return json(500, {
        error: "Kunne ikke hente aktive semester.",
      });
    }

    if (
      !activeBatches ||
      activeBatches.length === 0
    ) {
      return json(200, {
        success: true,
        rows: [],
        message: "Ingen aktive semester.",
      });
    }

    /*
     * 2. Hent alle kodepåmeldinger.
     */
    const {
      data: signups,
      error: signupError,
    } = await supabase
      .from("skating_school_signups")
      .select(`
        id,
        child_name,
        existing_member_id,
        batch_id,
        batch_name,
        access_code_id,
        access_code,
        source,
        created_at
      `)
      .or(
        "access_code_id.not.is.null,access_code.not.is.null,source.eq.signup_page_code"
      )
      .order(
        "created_at",
        { ascending: false }
      );

    if (signupError) {
      console.error(
        "Kodepåmeldinger:",
        signupError
      );

      return json(500, {
        error: "Kunne ikke hente kodepåmeldinger.",
      });
    }

    const codeSignups =
      signups || [];

    /*
     * 3. Finn kodepåmeldinger som tilhører
     *    et aktivt semester.
     *
     * Match først på batch_id.
     * Match også på batch_name som fallback.
     */
    const signupRows =
      codeSignups.filter((signup) =>
        activeBatches.some((batch) => {
          if (
            signup.batch_id &&
            String(signup.batch_id) ===
              String(batch.id)
          ) {
            return true;
          }

          if (
            signup.batch_name &&
            normalize(signup.batch_name) ===
              normalize(batch.name)
          ) {
            return true;
          }

          return false;
        })
      );

    /*
     * 4. Hent medlemsdata.
     */
    const memberIds = Array.from(
      new Set(
        signupRows
          .map((row) =>
            String(
              row.existing_member_id || ""
            ).trim()
          )
          .filter(Boolean)
      )
    );

    let linkedMembers = [];

    if (memberIds.length) {
      const memberResult =
        await supabase
          .from("members")
          .select(`
            id,
            name,
            membership_fee_paid
          `)
          .in(
            "id",
            memberIds
          );

      if (memberResult.error) {
        console.error(
          "Medlemmer:",
          memberResult.error
        );

        return json(500, {
          error:
            "Kunne ikke hente medlemsstatus.",
        });
      }

      linkedMembers =
        memberResult.data || [];
    }

    const membersById = new Map(
      linkedMembers.map((member) => [
        String(member.id),
        member,
      ])
    );

    /*
     * Hent også medlemmer for navnematch på
     * eldre påmeldinger uten existing_member_id.
     */
    const allMembersResult =
      await supabase
        .from("members")
        .select(`
          id,
          name,
          membership_fee_paid
        `);

    if (allMembersResult.error) {
      console.error(
        "Alle medlemmer:",
        allMembersResult.error
      );

      return json(500, {
        error:
          "Kunne ikke hente medlemsstatus.",
      });
    }

    const membersByName =
      new Map();

    (
      allMembersResult.data || []
    ).forEach((member) => {
      const key =
        normalize(member.name);

      if (!key) {
        return;
      }

      if (
        !membersByName.has(key)
      ) {
        membersByName.set(
          key,
          []
        );
      }

      membersByName
        .get(key)
        .push(member);
    });

    /*
     * 5. Bygg rapporten.
     */
    const rows =
      signupRows.map((signup) => {
        let member = null;

        if (
          signup.existing_member_id
        ) {
          member =
            membersById.get(
              String(
                signup.existing_member_id
              )
            ) || null;
        }

        if (!member) {
          const matches =
            membersByName.get(
              normalize(
                signup.child_name
              )
            ) || [];

          if (
            matches.length === 1
          ) {
            member =
              matches[0];
          }
        }

        return {
          name:
            signup.child_name || "",

          code:
            signup.access_code ||
            (
              signup.access_code_id
                ? "Kodepåmelding"
                : ""
            ),

          member_found:
            !!member,

          membership_fee_paid:
            !!(
              member &&
              member.membership_fee_paid === true
            ),
        };
      });

    rows.sort(
      (a, b) =>
        String(
          a.name || ""
        ).localeCompare(
          String(
            b.name || ""
          ),
          "no"
        )
    );

    return json(200, {
      success: true,

      active_semesters:
        activeBatches.map(
          (batch) => batch.name
        ),

      code_signups_total:
        codeSignups.length,

      code_signups_active_semester:
        signupRows.length,

      count:
        rows.length,

      rows,
    });
  } catch (error) {
    console.error(
      "report-idrettsrad:",
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
