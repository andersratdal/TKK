const { createClient } = require("@supabase/supabase-js");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function normalizeValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const str = String(value).trim();
  return str || null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, {
      error: "Metoden er ikke tillatt."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return json(500, {
      error: "Serveroppsettet for databasen mangler."
    });
  }

  const supabase = createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

  let body;

  try {
    body = JSON.parse(event.body || "{}");
  } catch (error) {
    return json(400, {
      error: "Ugyldig forespørsel."
    });
  }

  try {
    const id = normalizeValue(body.id);

    if (!id) {
      return json(400, {
        error: "Mangler id for koden."
      });
    }

    const updates = {};

    /*
     * Aktiver / deaktiver
     */
    if (body.is_active !== undefined) {
      updates.is_active = body.is_active === true;
    }

    /*
     * Valgfrie felt dersom vi senere ønsker
     * å redigere mer fra admin-siden.
     */
    if (body.description !== undefined) {
      updates.description =
        normalizeValue(body.description);
    }

    if (body.department_id !== undefined) {
      updates.department_id =
        normalizeValue(body.department_id);
    }

    if (body.batch_id !== undefined) {
      updates.batch_id =
        normalizeValue(body.batch_id);
    }

    if (body.expires_at !== undefined) {
      updates.expires_at =
        normalizeValue(body.expires_at);
    }

    if (body.max_uses !== undefined) {
      if (
        body.max_uses === null ||
        body.max_uses === ""
      ) {
        updates.max_uses = null;
      } else {
        const maxUses = Number(body.max_uses);

        if (
          !Number.isInteger(maxUses) ||
          maxUses < 1
        ) {
          return json(400, {
            error:
              "max_uses må være et heltall større enn 0."
          });
        }

        updates.max_uses = maxUses;
      }
    }

    if (!Object.keys(updates).length) {
      return json(400, {
        error: "Ingen endringer ble sendt inn."
      });
    }

    /*
     * Oppdater koden.
     */
    const {
      data,
      error
    } = await supabase
      .from("skating_school_access_codes")
      .update(updates)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error(
        "Update access code error:",
        error
      );

      return json(500, {
        error:
          "Kunne ikke oppdatere koden: " +
          error.message
      });
    }

    if (!data) {
      return json(404, {
        error: "Fant ikke koden."
      });
    }

    return json(200, {
      success: true,
      code: data
    });
  } catch (error) {
    console.error(
      "update-school-access-code error:",
      error
    );

    return json(500, {
      error:
        error && error.message
          ? error.message
          : "Noe gikk galt ved oppdatering av koden."
    });
  }
};
