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
  return String(value || "").trim();
}

function normalizeCode(value) {
  return normalizeValue(value).toUpperCase();
}

function normalizeOptionalValue(value) {
  const normalized = normalizeValue(value);
  return normalized || null;
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;

  const expires = new Date(expiresAt);

  if (Number.isNaN(expires.getTime())) {
    return false;
  }

  return expires.getTime() < Date.now();
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, {
      error: "Metoden er ikke tillatt."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error("Supabase environment variables are missing.");

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
    const accessCode = normalizeCode(body.access_code);
    const email = normalizeValue(body.email).toLowerCase();
    const phone = normalizeValue(body.phone);
    const children = Array.isArray(body.children)
      ? body.children
      : [];

    if (!accessCode) {
      return json(400, {
        error: "Påmeldingskode mangler."
      });
    }

    if (!email) {
      return json(400, {
        error: "E-post mangler."
      });
    }

    if (!phone) {
      return json(400, {
        error: "Telefonnummer mangler."
      });
    }

    if (!children.length) {
      return json(400, {
        error: "Du må legge til minst ett barn."
      });
    }

    /*
     * Finn semesteret som er satt til Aktiv.
     *
     * Vi henter maksimalt to slik at vi også kan kontrollere
     * at administrator ikke ved et uhell har satt flere semester
     * til Aktiv samtidig.
     */
    const {
      data: activeBatches,
      error: batchError
    } = await supabase
      .from("skating_school_batches")
      .select(
        "id, name, department_id, status, start_date, end_date, created_at"
      )
      .eq("status", "Aktiv")
      .order("created_at", {
        ascending: false
      })
      .limit(2);

    if (batchError) {
      console.error(
        "Active semester fetch error:",
        batchError
      );

      return json(500, {
        error: "Kunne ikke hente aktivt semester."
      });
    }

    if (
      !activeBatches ||
      activeBatches.length === 0
    ) {
      return json(400, {
        error:
          "Det finnes ikke noe aktivt semester for påmelding."
      });
    }

    if (activeBatches.length > 1) {
      return json(400, {
        error:
          "Det finnes flere aktive semester. " +
          "Sett kun ett semester til Aktiv før påmelding."
      });
    }

    const activeBatch = activeBatches[0];

    /*
     * Hent og valider påmeldingskoden.
     */
    const {
      data: accessCodeRow,
      error: accessCodeError
    } = await supabase
      .from("skating_school_access_codes")
      .select("*")
      .eq("code", accessCode)
      .maybeSingle();

    if (accessCodeError) {
      console.error(
        "Access code fetch error:",
        accessCodeError
      );

      return json(500, {
        error: "Kunne ikke kontrollere påmeldingskoden."
      });
    }

    if (!accessCodeRow) {
      return json(400, {
        error: "Påmeldingskoden er ugyldig."
      });
    }

    if (accessCodeRow.is_active === false) {
      return json(400, {
        error: "Påmeldingskoden er ikke aktiv."
      });
    }

    if (isExpired(accessCodeRow.expires_at)) {
      return json(400, {
        error: "Påmeldingskoden har utløpt."
      });
    }

    /*
     * Dersom koden er knyttet til et bestemt semester,
     * må det være semesteret som nå er Aktiv.
     */
    if (
      accessCodeRow.batch_id &&
      String(accessCodeRow.batch_id) !==
        String(activeBatch.id)
    ) {
      return json(400, {
        error:
          "Koden gjelder ikke for dette semesteret."
      });
    }

    /*
     * Dersom koden er knyttet til en bestemt avdeling,
     * må aktivt semester tilhøre samme avdeling.
     */
    if (
      accessCodeRow.department_id &&
      String(accessCodeRow.department_id) !==
        String(activeBatch.department_id)
    ) {
      return json(400, {
        error:
          "Koden gjelder ikke for denne avdelingen."
      });
    }

    const usedCount =
      Number(accessCodeRow.used_count || 0);

    const maxUses =
      accessCodeRow.max_uses === null ||
      accessCodeRow.max_uses === undefined
        ? null
        : Number(accessCodeRow.max_uses);

    if (
      maxUses !== null &&
      Number.isFinite(maxUses) &&
      usedCount >= maxUses
    ) {
      return json(400, {
        error:
          "Påmeldingskoden er allerede brukt opp."
      });
    }

    /*
     * Valider barna før vi begynner å skrive til databasen.
     */
    const normalizedChildren = [];

    for (
      let index = 0;
      index < children.length;
      index += 1
    ) {
      const child = children[index] || {};

      const childName = normalizeValue(
        child.child_name || child.name
      );

      const birthDate = normalizeValue(
        child.birth_date
      );

      const requestedSkateSize =
        normalizeOptionalValue(
          child.requested_skate_size
        );

      const hasOwnSkates =
        child.has_own_skates === true;

      if (!childName) {
        return json(400, {
          error:
            `Barn ${index + 1}: Navn mangler.`
        });
      }

      if (!birthDate) {
        return json(400, {
          error:
            `Barn ${index + 1}: Fødselsdato mangler.`
        });
      }

      if (
        !requestedSkateSize &&
        !hasOwnSkates
      ) {
        return json(400, {
          error:
            `Barn ${index + 1}: ` +
            "Velg skøytestørrelse eller oppgi at barnet har egne skøyter."
        });
      }

      normalizedChildren.push({
        child_name: childName,
        birth_date: birthDate,
        requested_skate_size:
          hasOwnSkates
            ? null
            : requestedSkateSize,
        has_own_skates: hasOwnSkates
      });
    }

    /*
     * Alle søsken i samme innsending får samme family_signup_id.
     */
    const familySignupId =
      typeof crypto !== "undefined" &&
      crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`;

    /*
     * Opprett én rad per barn.
     *
     * batch_id og batch_name kommer ALLTID fra semesteret
     * som har status Aktiv i databasen.
     */
    const signupRows =
      normalizedChildren.map((child) => ({
        family_signup_id: familySignupId,

        batch_id: activeBatch.id,
        batch_name: activeBatch.name,
        department_id:
          activeBatch.department_id,

        access_code_id: accessCodeRow.id,
        access_code: accessCodeRow.code,

        email,
        phone,

        child_name: child.child_name,
        birth_date: child.birth_date,

        requested_skate_size:
          child.requested_skate_size,

        has_own_skates:
          child.has_own_skates,

        status: "Ny",

        notes:
          "Påmeldt via kodepåmelding."
      }));

    const {
      data: insertedSignups,
      error: insertError
    } = await supabase
      .from("skating_school_signups")
      .insert(signupRows)
      .select();

    if (insertError) {
      console.error(
        "Signup insert error:",
        insertError
      );

      return json(500, {
        error:
          "Kunne ikke lagre påmeldingen. " +
          "Ingen endringer ble gjort på koden."
      });
    }

    /*
     * Registrer at koden er brukt.
     *
     * Én familiepåmelding teller som ett bruk,
     * selv om flere søsken meldes på samtidig.
     */
    const nextUsedCount = usedCount + 1;

    const codeUpdate = {
      used_count: nextUsedCount
    };

    if (
      maxUses !== null &&
      Number.isFinite(maxUses) &&
      nextUsedCount >= maxUses
    ) {
      codeUpdate.is_active = false;
    }

    const {
      error: codeUpdateError
    } = await supabase
      .from("skating_school_access_codes")
      .update(codeUpdate)
      .eq("id", accessCodeRow.id);

    if (codeUpdateError) {
      console.error(
        "Access code update error:",
        codeUpdateError
      );

      /*
       * Påmeldingen er allerede lagret på dette tidspunktet.
       * Vi returnerer derfor ikke en falsk beskjed om at
       * påmeldingen mislyktes.
       */
      return json(200, {
        ok: true,
        warning:
          "Påmeldingen ble lagret, men brukstelleren for koden kunne ikke oppdateres.",
        family_signup_id: familySignupId,
        semester: {
          id: activeBatch.id,
          name: activeBatch.name
        },
        signups: insertedSignups || [],
        redirect_url:
          "/pamelding-bekreftet-tkk.html"
      });
    }

    return json(200, {
      ok: true,

      message:
        "Påmeldingen er registrert.",

      family_signup_id:
        familySignupId,

      semester: {
        id: activeBatch.id,
        name: activeBatch.name
      },

      signups:
        insertedSignups || [],

      redirect_url:
        "/pamelding-bekreftet-tkk.html"
    });
  } catch (error) {
    console.error(
      "create-school-signup-code error:",
      error
    );

    return json(500, {
      error:
        "En uventet feil oppstod under påmeldingen."
    });
  }
};
