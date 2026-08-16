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

function getBirthYear(birthDate) {
  const match = String(birthDate || "").match(/^(\d{4})-/);
  return match ? Number(match[1]) : null;
}

function getSchoolGroupNameByBirthYear(birthYear) {
  const year = Number(birthYear || 0);

  if (!year) return null;
  if (year >= 2021) return "Blå";
  if (year >= 2018 && year <= 2020) return "Gul";
  if (year <= 2017) return "Rød";

  return null;
}

async function ensureDefaultSchoolGroups(
  supabase,
  batchId
) {
  const wanted = [
    {
      name: "Blå",
      color: "blue",
      sort_order: 10
    },
    {
      name: "Gul",
      color: "yellow",
      sort_order: 20
    },
    {
      name: "Rød",
      color: "red",
      sort_order: 30
    }
  ];

  const {
    data: existingGroups,
    error: groupFetchError
  } = await supabase
    .from("skating_school_groups")
    .select(
      "id, batch_id, name, color, sort_order"
    )
    .eq("batch_id", batchId)
    .order("sort_order", {
      ascending: true
    });

  if (groupFetchError) {
    throw groupFetchError;
  }

  const groups = Array.isArray(existingGroups)
    ? existingGroups.slice()
    : [];

  for (const wantedGroup of wanted) {
    const exists = groups.find(
      (group) =>
        String(group.name || "")
          .trim()
          .toLowerCase() ===
        wantedGroup.name.toLowerCase()
    );

    if (exists) {
      continue;
    }

    const {
      data: insertedGroup,
      error: groupInsertError
    } = await supabase
      .from("skating_school_groups")
      .insert([
        {
          batch_id: batchId,
          name: wantedGroup.name,
          color: wantedGroup.color,
          sort_order: wantedGroup.sort_order
        }
      ])
      .select(
        "id, batch_id, name, color, sort_order"
      )
      .single();

    if (groupInsertError) {
      throw groupInsertError;
    }

    groups.push(insertedGroup);
  }

  return groups;
}

async function findOrCreateMember(
  supabase,
  child,
  email,
  phone
) {
  const childName =
    normalizeValue(child.child_name);

  /*
   * Kontaktinfo tilhører foresatt.
   *
   * Vi bruker derfor IKKE e-post eller telefon
   * for å finne barnet.
   */
  const {
    data: nameMatches,
    error: memberLookupError
  } = await supabase
    .from("members")
    .select(
      "id, name, phone, email, role"
    )
    .ilike("name", childName)
    .limit(2);

  if (memberLookupError) {
    throw memberLookupError;
  }

  /*
   * Hvis det finnes nøyaktig ett medlem
   * med samme navn, bruker vi dette.
   */
  if (
    Array.isArray(nameMatches) &&
    nameMatches.length === 1
  ) {
    return {
      member: nameMatches[0],
      created: false
    };
  }

  /*
   * Ellers oppretter vi barnet som nytt medlem.
   */
  const {
    data: createdMember,
    error: memberInsertError
  } = await supabase
    .from("members")
    .insert([
      {
        name: childName,
        phone: phone || null,
        email: email || null,
        role: "Skøyteskole"
      }
    ])
    .select(
      "id, name, phone, email, role"
    )
    .single();

  if (memberInsertError) {
    throw memberInsertError;
  }

  if (
    !createdMember ||
    !createdMember.id
  ) {
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
  groups
) {
  const birthYear =
    getBirthYear(child.birth_date);

  const wantedGroupName =
    getSchoolGroupNameByBirthYear(
      birthYear
    );

  const wantedGroup =
    groups.find(
      (group) =>
        String(group.name || "")
          .trim()
          .toLowerCase() ===
        String(wantedGroupName || "")
          .trim()
          .toLowerCase()
    );

  /*
   * Sjekk om barnet allerede ligger
   * i dette semesteret.
   */
  const {
    data: existingEnrollment,
    error: enrollmentFetchError
  } = await supabase
    .from("skating_school_enrollments")
    .select(
      "id, batch_id, member_id, school_group_id, birth_year, manual_override"
    )
    .eq("batch_id", batch.id)
    .eq("member_id", member.id)
    .maybeSingle();

  if (enrollmentFetchError) {
    throw enrollmentFetchError;
  }

  if (existingEnrollment) {
    const updatePayload = {
      birth_year: birthYear || null
    };

    /*
     * Ikke overskriv et manuelt gruppevalg.
     */
    if (
      !existingEnrollment.manual_override &&
      !existingEnrollment.school_group_id
    ) {
      updatePayload.school_group_id =
        wantedGroup
          ? wantedGroup.id
          : null;

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
      .eq(
        "id",
        existingEnrollment.id
      )
      .select(
        "id, batch_id, member_id, school_group_id, birth_year"
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
   * Opprett semesterdeltakelse.
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

        manual_override: false
      }
    ])
    .select(
      "id, batch_id, member_id, school_group_id, birth_year"
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

exports.handler =
  async function (event) {
    if (
      event.httpMethod !== "POST"
    ) {
      return json(405, {
        error:
          "Metoden er ikke tillatt."
      });
    }

    const supabaseUrl =
      process.env.SUPABASE_URL;

    const supabaseServiceRoleKey =
      process.env
        .SUPABASE_SERVICE_ROLE_KEY;

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

    const supabase =
      createClient(
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
        error:
          "Ugyldig forespørsel."
      });
    }

    try {
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

      const children =
        Array.isArray(
          body.children
        )
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
       */
      const {
        data: activeBatches,
        error: batchError
      } = await supabase
        .from(
          "skating_school_batches"
        )
        .select(
          "id, name, department_id, status, start_date, end_date, created_at"
        )
        .eq(
          "status",
          "Aktiv"
        )
        .order(
          "created_at",
          {
            ascending: false
          }
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
       * Hent kode.
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
        accessCodeRow.is_active ===
        false
      ) {
        return json(400, {
          error:
            "Påmeldingskoden er ikke aktiv."
        });
      }

      if (
        isExpired(
          accessCodeRow.expires_at
        )
      ) {
        return json(400, {
          error:
            "Påmeldingskoden har utløpt."
        });
      }

      if (
        accessCodeRow.batch_id &&
        String(
          accessCodeRow.batch_id
        ) !==
          String(activeBatch.id)
      ) {
        return json(400, {
          error:
            "Koden gjelder ikke for dette semesteret."
        });
      }

      if (
        accessCodeRow.department_id &&
        String(
          accessCodeRow.department_id
        ) !==
          String(
            activeBatch.department_id
          )
      ) {
        return json(400, {
          error:
            "Koden gjelder ikke for denne avdelingen."
        });
      }

      const usedCount =
        Number(
          accessCodeRow.used_count ||
            0
        );

      const maxUses =
        accessCodeRow.max_uses ===
          null ||
        accessCodeRow.max_uses ===
          undefined
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
            "Påmeldingskoden er allerede brukt opp."
        });
      }

      /*
       * Valider barna.
       */
      const normalizedChildren =
        [];

      for (
        let index = 0;
        index < children.length;
        index += 1
      ) {
        const child =
          children[index] || {};

        const childName =
          normalizeValue(
            child.child_name ||
              child.name
          );

        const birthDate =
          normalizeValue(
            child.birth_date
          );

        const requestedSkateSize =
          normalizeOptionalValue(
            child.requested_skate_size
          );

        const hasOwnSkates =
          child.has_own_skates ===
          true;

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
              `Barn ${index + 1}: Velg skøytestørrelse eller oppgi at barnet har egne skøyter.`
          });
        }

        normalizedChildren.push({
          child_name:
            childName,

          birth_date:
            birthDate,

          requested_skate_size:
            hasOwnSkates
              ? null
              : requestedSkateSize,

          has_own_skates:
            hasOwnSkates
        });
      }

      /*
       * Sørg for Blå/Gul/Rød-grupper.
       */
      const groups =
        await ensureDefaultSchoolGroups(
          supabase,
          activeBatch.id
        );

      const familySignupId =
        typeof crypto !==
          "undefined" &&
        crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}`;

      const signupRows = [];
      const memberResults = [];

      /*
       * Opprett medlem og
       * semesterdeltakelse direkte.
       */
      for (
        const child of
        normalizedChildren
      ) {
        const memberResult =
          await findOrCreateMember(
            supabase,
            child,
            email,
            phone
          );

        const member =
          memberResult.member;

        const enrollmentResult =
          await ensureEnrollment(
            supabase,
            activeBatch,
            member,
            child,
            groups
          );

        memberResults.push({
          member_id:
            member.id,

          member_name:
            member.name,

          member_created:
            memberResult.created,

          enrollment_id:
            enrollmentResult
              .enrollment.id,

          enrollment_created:
            enrollmentResult.created
        });

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
        .insert(signupRows)
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
       * Oppdater bruk av kode.
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
        .update(codeUpdate)
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
            insertedSignups ||
            [],

          redirect_url:
            "/pamelding-bekreftet-tkk.html"
        });
      }

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
          insertedSignups ||
          [],

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
