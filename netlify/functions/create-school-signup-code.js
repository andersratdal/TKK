const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function normalizeValue(value) {
  return String(value || "").trim();
}

function normalizeOptionalValue(value) {
  const normalized = normalizeValue(value);
  return normalized || null;
}

function normalizeCode(value) {
  return normalizeValue(value).toUpperCase();
}

function getBirthYear(value) {
  const birthDate = normalizeValue(value);

  if (!birthDate) {
    return null;
  }

  const match = birthDate.match(/^(\d{4})-\d{2}-\d{2}$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);

  if (!Number.isFinite(year)) {
    return null;
  }

  return year;
}

function getSchoolGroupNameByBirthYear(birthYear) {
  if (!birthYear) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear;

  if (age <= 6) {
    return "Blå";
  }

  if (age <= 9) {
    return "Gul";
  }

  return "Rød";
}

async function getSchoolGroups(supabase, batchId) {
  const { data, error } = await supabase
    .from("skating_school_groups")
    .select("id, batch_id, name, sort_order")
    .eq("batch_id", batchId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function findOrCreateMember(
  supabase,
  child,
  phone,
  email
) {
  const childName = normalizeValue(child.child_name);

  if (!childName) {
    throw new Error("Barnets navn mangler.");
  }

  /*
   * Først forsøker vi å finne et eksisterende medlem.
   *
   * Vi bruker navn sammen med e-post/telefon for å redusere
   * risikoen for å koble påmeldingen til feil person.
   */
  const { data: existingMembers, error: memberFetchError } =
    await supabase
      .from("members")
      .select("id, name, phone, email, role")
      .ilike("name", childName)
      .limit(20);

  if (memberFetchError) {
    throw memberFetchError;
  }

  const normalizedEmail = normalizeValue(email).toLowerCase();
  const normalizedPhone = normalizeValue(phone);

  let existingMember = null;

  if (Array.isArray(existingMembers)) {
    existingMember = existingMembers.find((member) => {
      const memberEmail =
        normalizeValue(member.email).toLowerCase();

      const memberPhone =
        normalizeValue(member.phone);

      if (
        normalizedEmail &&
        memberEmail &&
        normalizedEmail === memberEmail
      ) {
        return true;
      }

      if (
        normalizedPhone &&
        memberPhone &&
        normalizedPhone === memberPhone
      ) {
        return true;
      }

      return false;
    });
  }

  if (existingMember) {
    /*
     * Sørg for at medlemmet er markert som Skøyteskole.
     */
    const updatePayload = {};

    if (
      normalizeValue(existingMember.role).toLowerCase() !==
      "skøyteskole"
    ) {
      updatePayload.role = "Skøyteskole";
    }

    if (
      !normalizeValue(existingMember.phone) &&
      normalizedPhone
    ) {
      updatePayload.phone = normalizedPhone;
    }

    if (
      !normalizeValue(existingMember.email) &&
      normalizedEmail
    ) {
      updatePayload.email = normalizedEmail;
    }

    if (Object.keys(updatePayload).length > 0) {
      const { data: updatedMember, error: updateError } =
        await supabase
          .from("members")
          .update(updatePayload)
          .eq("id", existingMember.id)
          .select("id, name, phone, email, role")
          .single();

      if (updateError) {
        throw updateError;
      }

      existingMember = updatedMember;
    }

    return {
      member: existingMember,
      created: false
    };
  }

  /*
   * Medlemmet finnes ikke fra før.
   * Opprett medlem direkte.
   */
  const { data: createdMember, error: memberInsertError } =
    await supabase
      .from("members")
      .insert([
        {
          name: childName,
          phone: phone || null,
          email: email || null,
          role: "Skøyteskole"
        }
      ])
      .select("id, name, phone, email, role")
      .single();

  if (memberInsertError) {
    throw memberInsertError;
  }

  if (!createdMember || !createdMember.id) {
    throw new Error(
      "Medlemmet ble ikke opprettet korrekt."
    );
  }

  return {
    member: createdMember,
    created: true
  };
}

async function ensureEnrollment(
  supabase,
  batch,
  member,
  child,
  groups,
  advisorName
) {
  const birthYear = getBirthYear(child.birth_date);

  const wantedGroupName =
    getSchoolGroupNameByBirthYear(birthYear);

  const wantedGroup = groups.find(
    (group) =>
      String(group.name || "")
        .trim()
        .toLowerCase() ===
      String(wantedGroupName || "")
        .trim()
        .toLowerCase()
  );

  /*
   * Kontroller om medlemmet allerede er registrert
   * på dette semesteret.
   */
  const {
    data: existingEnrollment,
    error: enrollmentFetchError
  } = await supabase
    .from("skating_school_enrollments")
    .select(
      "id, batch_id, member_id, school_group_id, birth_year, advisor_name, manual_override"
    )
    .eq("batch_id", batch.id)
    .eq("member_id", member.id)
    .maybeSingle();

  if (enrollmentFetchError) {
    throw enrollmentFetchError;
  }

  if (existingEnrollment) {
    /*
     * Oppdater fødselsår og veileder.
     *
     * Ikke overskriv et manuelt gruppevalg som
     * allerede er gjort i appen.
     */
    const updatePayload = {
      birth_year: birthYear || null,
      advisor_name: advisorName || null
    };

    if (
      !existingEnrollment.manual_override &&
      !existingEnrollment.school_group_id
    ) {
      updatePayload.school_group_id =
        wantedGroup ? wantedGroup.id : null;

      updatePayload.assignment_reason =
        wantedGroup
          ? "Automatisk fordelt etter fødselsår ved kodepåmelding"
          : "Kodepåmelding uten automatisk gruppe";

      updatePayload.manual_override = false;
    }

    const {
      data: updatedEnrollment,
      error: enrollmentUpdateError
    } = await supabase
      .from("skating_school_enrollments")
      .update(updatePayload)
      .eq("id", existingEnrollment.id)
      .select(
        "id, batch_id, member_id, school_group_id, birth_year, advisor_name"
      )
      .single();

    if (enrollmentUpdateError) {
      throw enrollmentUpdateError;
    }

    return {
      enrollment: updatedEnrollment,
      created: false
    };
  }

  /*
   * Ingen enrollment finnes.
   * Opprett deltakeren direkte i aktivt semester.
   */
  const {
    data: createdEnrollment,
    error: enrollmentInsertError
  } = await supabase
    .from("skating_school_enrollments")
    .insert([
      {
        batch_id: batch.id,
        member_id: member.id,

        birth_year:
          birthYear || null,

        school_group_id:
          wantedGroup
            ? wantedGroup.id
            : null,

        assignment_reason:
          wantedGroup
            ? "Automatisk fordelt etter fødselsår ved kodepåmelding"
            : "Kodepåmelding uten automatisk gruppe",

        advisor_name:
          advisorName || null,

        manual_override: false
      }
    ])
    .select(
      "id, batch_id, member_id, school_group_id, birth_year, advisor_name"
    )
    .single();

  if (enrollmentInsertError) {
    throw enrollmentInsertError;
  }

  if (
    !createdEnrollment ||
    !createdEnrollment.id
  ) {
    throw new Error(
      "Deltakerkoblingen ble ikke opprettet korrekt."
    );
  }

  return {
    enrollment: createdEnrollment,
    created: true
  };
}

exports.handler = async function (event) {
  /*
   * CORS / preflight
   */
  if (event.httpMethod === "OPTIONS") {
    return json(200, {
      ok: true
    });
  }

  if (event.httpMethod !== "POST") {
    return json(405, {
      error: "Metoden er ikke tillatt."
    });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL;

  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey
  ) {
    console.error(
      "Supabase environment variables are missing."
    );

    return json(500, {
      error:
        "Serveroppsettet for databasen mangler."
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
    body = JSON.parse(
      event.body || "{}"
    );
  } catch (error) {
    return json(400, {
      error: "Ugyldig forespørsel."
    });
  }

  try {
    /*
     * Data fra pamelding-kode.html
     */
    const accessCode =
      normalizeCode(
        body.access_code
      );

    const email =
      normalizeValue(
        body.email
      ).toLowerCase();

    const phone =
      normalizeValue(
        body.phone
      );

    const advisorName =
      normalizeOptionalValue(
        body.advisor_name
      );

    const children =
      Array.isArray(body.children)
        ? body.children
        : [];

    if (!accessCode) {
      return json(400, {
        error:
          "Påmeldingskode mangler."
      });
    }

    if (!email) {
      return json(400, {
        error:
          "E-post mangler."
      });
    }

    if (!phone) {
      return json(400, {
        error:
          "Telefonnummer mangler."
      });
    }

    if (!children.length) {
      return json(400, {
        error:
          "Du må legge til minst ett barn."
      });
    }

    /*
     * Finn aktivt semester.
     *
     * Det skal bare finnes ett semester
     * med status Aktiv.
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
      .order(
        "created_at",
        { ascending: false }
      )
      .limit(2);

    if (batchError) {
      console.error(
        "Active semester fetch error:",
        batchError
      );

      return json(500, {
        error:
          "Kunne ikke hente aktivt semester."
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

    if (
      activeBatches.length > 1
    ) {
      return json(400, {
        error:
          "Det finnes flere aktive semester. Sett kun ett semester til Aktiv før påmelding."
      });
    }

    const activeBatch =
      activeBatches[0];

    /*
     * Kontroller påmeldingskoden.
     */
    const {
      data: accessCodeRow,
      error: accessCodeError
    } = await supabase
      .from(
        "skating_school_access_codes"
      )
      .select("*")
      .eq(
        "code",
        accessCode
      )
      .maybeSingle();

    if (accessCodeError) {
      console.error(
        "Access code fetch error:",
        accessCodeError
      );

      return json(500, {
        error:
          "Kunne ikke kontrollere påmeldingskoden."
      });
    }

    if (!accessCodeRow) {
      return json(400, {
        error:
          "Påmeldingskoden er ugyldig."
      });
    }

    if (
      accessCodeRow.is_active === false
    ) {
      return json(400, {
        error:
          "Påmeldingskoden er ikke aktiv."
      });
    }

    /*
     * Dersom koden er knyttet til et semester,
     * må dette være aktivt semester.
     */
    if (
      accessCodeRow.batch_id &&
      String(accessCodeRow.batch_id) !==
        String(activeBatch.id)
    ) {
      return json(400, {
        error:
          "Påmeldingskoden gjelder ikke aktivt semester."
      });
    }

    const usedCount =
      Number(
        accessCodeRow.used_count || 0
      );

    const maxUses =
      accessCodeRow.max_uses === null ||
      accessCodeRow.max_uses === undefined
        ? null
        : Number(
            accessCodeRow.max_uses
          );

    if (
      maxUses !== null &&
      Number.isFinite(maxUses) &&
      usedCount >= maxUses
    ) {
      return json(400, {
        error:
          "Påmeldingskoden er allerede brukt maksimalt antall ganger."
      });
    }

    /*
     * Sørg for at semestergruppene
     * Blå, Gul og Rød finnes.
     */
    const groups =
      await getSchoolGroups(
        supabase,
        activeBatch.id
      );

    /*
     * Én ID brukes til å knytte sammen
     * barn fra samme innsending.
     */
    const familySignupId =
      crypto.randomUUID();

    const signupRows = [];
    const memberResults = [];

    /*
     * Opprett/koble hvert barn.
     */
    for (
      const child of children
    ) {
      const childName =
        normalizeValue(
          child.child_name
        );

      if (!childName) {
        return json(400, {
          error:
            "Barnets navn mangler."
        });
      }

      if (
        !normalizeValue(
          child.birth_date
        )
      ) {
        return json(400, {
          error:
            "Fødselsdato mangler for " +
            childName +
            "."
        });
      }

      /*
       * Finn eller opprett medlem.
       */
      const memberResult =
        await findOrCreateMember(
          supabase,
          child,
          phone,
          email
        );

      const member =
        memberResult.member;

      /*
       * Legg medlemmet direkte inn
       * som deltaker i aktivt semester.
       *
       * Veileder lagres på enrollment.
       */
      const enrollmentResult =
        await ensureEnrollment(
          supabase,
          activeBatch,
          member,
          child,
          groups,
          advisorName
        );

      memberResults.push({
        member_id:
          member.id,

        name:
          member.name,

        member_created:
          memberResult.created,

        enrollment_id:
          enrollmentResult
            .enrollment.id,

        enrollment_created:
          enrollmentResult.created,

        advisor_name:
          advisorName
      });

      /*
       * Behold også selve påmeldingen
       * som historikk/logg.
       *
       * Veilederen lagres også her.
       */
      signupRows.push({
        family_signup_id:
          familySignupId,

        batch_id:
          activeBatch.id,

        batch_name:
          activeBatch.name,

        department_id:
          activeBatch.department_id,

        access_code_id:
          accessCodeRow.id,

        access_code:
          accessCodeRow.code,

        email,

        phone,

        child_name:
          child.child_name,

        birth_date:
          child.birth_date,

        requested_skate_size:
          child.requested_skate_size,

        has_own_skates:
          child.has_own_skates,

        existing_member_id:
          member.id,

        advisor_name:
          advisorName || null,

        status:
          "Ferdig",

        notes:
          "Påmeldt via kodepåmelding. Medlem og semesterdeltakelse opprettet automatisk."
      });
    }

    /*
     * Lagre påmeldingsloggen.
     */
    const {
      data: insertedSignups,
      error: insertError
    } = await supabase
      .from(
        "skating_school_signups"
      )
      .insert(
        signupRows
      )
      .select();

    if (insertError) {
      console.error(
        "Signup insert error:",
        insertError
      );

      return json(500, {
        error:
          "Medlemmet ble opprettet, men påmeldingsloggen kunne ikke lagres. Kontakt administrator."
      });
    }

    /*
     * Oppdater brukstelleren på koden.
     */
    const nextUsedCount =
      usedCount + 1;

    const codeUpdate = {
      used_count:
        nextUsedCount
    };

    if (
      maxUses !== null &&
      Number.isFinite(maxUses) &&
      nextUsedCount >= maxUses
    ) {
      codeUpdate.is_active =
        false;
    }

    const {
      error: codeUpdateError
    } = await supabase
      .from(
        "skating_school_access_codes"
      )
      .update(
        codeUpdate
      )
      .eq(
        "id",
        accessCodeRow.id
      );

    if (codeUpdateError) {
      console.error(
        "Access code update error:",
        codeUpdateError
      );

      return json(200, {
        ok: true,

        warning:
          "Påmeldingen og medlemskapet ble registrert, men brukstelleren for koden kunne ikke oppdateres.",

        family_signup_id:
          familySignupId,

        semester: {
          id:
            activeBatch.id,

          name:
            activeBatch.name
        },

        members:
          memberResults,

        signups:
          insertedSignups || [],

        redirect_url:
          "/pamelding-bekreftet-tkk.html"
      });
    }

    /*
     * Alt ferdig.
     */
    return json(200, {
      ok: true,

      message:
        "Påmeldingen er registrert og barnet er lagt inn som medlem og deltaker.",

      family_signup_id:
        familySignupId,

      semester: {
        id:
          activeBatch.id,

        name:
          activeBatch.name
      },

      members:
        memberResults,

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
        error &&
        error.message
          ? error.message
          : "Kunne ikke registrere påmeldingen."
    });
  }
};
