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
  if (!expiresAt) {
    return false;
  }

  const expires = new Date(expiresAt);

  if (Number.isNaN(expires.getTime())) {
    return false;
  }

  return expires.getTime() < Date.now();
}

function getBirthYear(birthDate) {
  const match = String(birthDate || "").match(/^(\d{4})-/);

  return match
    ? Number(match[1])
    : null;
}

function getSchoolGroupNameByBirthYear(birthYear) {
  const year = Number(birthYear || 0);

  if (!year) {
    return null;
  }

  if (year >= 2021) {
    return "Blå";
  }

  if (year >= 2018 && year <= 2020) {
    return "Gul";
  }

  if (year <= 2017) {
    return "Rød";
  }

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
    .order(
      "sort_order",
      { ascending: true }
    );

  if (groupFetchError) {
    throw groupFetchError;
  }

  const groups =
    Array.isArray(existingGroups)
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

  const {
    data: nameMatches,
    error: memberLookupError
  } = await supabase
    .from("members")
    .select(
      "id, name, phone, email, role"
    )
    .ilike(
      "name",
      childName
    )
    .limit(2);

  if (memberLookupError) {
    throw memberLookupError;
  }

  if (
    Array.isArray(nameMatches) &&
    nameMatches.length === 1
  ) {
    return {
      member: nameMatches[0],
      created: false
    };
  }

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
  groups,
  preferredLanguage,
  otherInformation
) {
  const birthYear =
    getBirthYear(
      child.birth_date
    );

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

  const {
    data: existingEnrollment,
    error: enrollmentFetchError
  } = await supabase
    .from("skating_school_enrollments")
    .select(
      [
        "id",
        "batch_id",
        "member_id",
        "school_group_id",
        "birth_year",
        "preferred_language",
        "other_information",
        "manual_override"
      ].join(", ")
    )
    .eq(
      "batch_id",
      batch.id
    )
    .eq(
      "member_id",
      member.id
    )
    .maybeSingle();

  if (enrollmentFetchError) {
    throw enrollmentFetchError;
  }

  if (existingEnrollment) {
    const updatePayload = {
      birth_year:
        birthYear || null,

      preferred_language:
        preferredLanguage,

      other_information:
        otherInformation
    };

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

      updatePayload.manual_override =
        false;
    }

    const {
      data: updatedEnrollment,
      error: enrollmentUpdateError
    } = await supabase
      .from("skating_school_enrollments")
      .update(
        updatePayload
      )
      .eq(
        "id",
        existingEnrollment.id
      )
      .select(
        [
          "id",
          "batch_id",
          "member_id",
          "school_group_id",
          "birth_year",
          "preferred_language",
          "other_information"
        ].join(", ")
      )
      .single();

    if (enrollmentUpdateError) {
      throw enrollmentUpdateError;
    }

    return {
      enrollment:
        updatedEnrollment,

      created:
        false
    };
  }

  const {
    data: createdEnrollment,
    error: enrollmentInsertError
  } = await supabase
    .from("skating_school_enrollments")
    .insert([
      {
        batch_id:
          batch.id,

        member_id:
          member.id,

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

        preferred_language:
          preferredLanguage,

        other_information:
          otherInformation,

        manual_override:
          false
      }
    ])
    .select(
      [
        "id",
        "batch_id",
        "member_id",
        "school_group_id",
        "birth_year",
        "preferred_language",
        "other_information"
      ].join(", ")
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
    enrollment:
      createdEnrollment,

    created:
      true
  };
}

function escapeHtml(value) {
  return String(
    value == null ? "" : value
  )
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSkateChoice(child) {
  if (
    child.has_own_skates === true
  ) {
    return "Egne skøyter";
  }

  return child.requested_skate_size
    ? "Størrelse " +
        child.requested_skate_size
    : "Ikke oppgitt";
}

function getConfirmationLanguage(
  children
) {
  const languages =
    new Set(
      (children || [])
        .map(
          (child) =>
            normalizeValue(
              child.preferred_language
            )
        )
        .filter(Boolean)
    );

  if (
    languages.size === 1 &&
    languages.has("Engelsk")
  ) {
    return "en";
  }

  if (
    languages.size === 1 &&
    languages.has("Norsk")
  ) {
    return "no";
  }

  return "both";
}

function buildConfirmationEmail({
  email,
  phone,
  batch,
  children
}) {
  const language =
    getConfirmationLanguage(
      children
    );

  const childRowsNo =
    children
      .map((child) => {
        const info =
          child.other_information
            ? "<br><strong>Annen informasjon:</strong> " +
              escapeHtml(
                child.other_information
              )
            : "";

        return `
          <li style="margin-bottom:14px;">
            <strong>
              ${escapeHtml(
                child.child_name
              )}
            </strong>
            <br>
            Fødselsdato:
            ${escapeHtml(
              child.birth_date
            )}
            <br>
            Skøyter:
            ${escapeHtml(
              formatSkateChoice(
                child
              )
            )}
            <br>
            Ønsket språk:
            ${escapeHtml(
              child.preferred_language ||
              "-"
            )}
            ${info}
          </li>
        `;
      })
      .join("");

  const childRowsEn =
    children
      .map((child) => {
        const skateText =
          child.has_own_skates === true
            ? "Own skates"
            : child.requested_skate_size
              ? "Size " +
                child.requested_skate_size
              : "Not specified";

        const languageText =
          child.preferred_language ===
          "Engelsk"
            ? "English"
            : child.preferred_language ===
              "Norsk"
              ? "Norwegian"
              : child.preferred_language ||
                "-";

        const info =
          child.other_information
            ? "<br><strong>Other information:</strong> " +
              escapeHtml(
                child.other_information
              )
            : "";

        return `
          <li style="margin-bottom:14px;">
            <strong>
              ${escapeHtml(
                child.child_name
              )}
            </strong>
            <br>
            Date of birth:
            ${escapeHtml(
              child.birth_date
            )}
            <br>
            Skates:
            ${escapeHtml(
              skateText
            )}
            <br>
            Preferred language:
            ${escapeHtml(
              languageText
            )}
            ${info}
          </li>
        `;
      })
      .join("");

  const noBlock = `
    <h2 style="margin:0 0 12px;">
      Påmeldingen er mottatt
    </h2>

    <p>
      Takk for påmeldingen til
      TKKs skøyteskole.
    </p>

    <p>
      Vi har registrert følgende
      påmelding for
      <strong>
        ${escapeHtml(
          batch.name ||
          "aktivt semester"
        )}
      </strong>:
    </p>

    <ul style="padding-left:22px;">
      ${childRowsNo}
    </ul>

    <p>
      Kontaktinformasjon registrert
      på påmeldingen:
    </p>

    <p>
      E-post:
      ${escapeHtml(email)}
      <br>
      Telefon:
      ${escapeHtml(phone)}
    </p>

    <p>
      Du trenger ikke foreta deg
      noe mer nå. Vi tar kontakt
      dersom vi trenger flere
      opplysninger.
    </p>

    <p>
      Med vennlig hilsen
      <br>
      <strong>
        Trondheim Kortbaneklubb
      </strong>
    </p>
  `;

  const enBlock = `
    <h2 style="margin:0 0 12px;">
      Registration received
    </h2>

    <p>
      Thank you for registering
      for TKK Skating School.
    </p>

    <p>
      We have registered the
      following for
      <strong>
        ${escapeHtml(
          batch.name ||
          "the active semester"
        )}
      </strong>:
    </p>

    <ul style="padding-left:22px;">
      ${childRowsEn}
    </ul>

    <p>
      Contact information
      registered with the
      submission:
    </p>

    <p>
      Email:
      ${escapeHtml(email)}
      <br>
      Phone:
      ${escapeHtml(phone)}
    </p>

    <p>
      You do not need to do
      anything else now. We will
      contact you if we need more
      information.
    </p>

    <p>
      Kind regards
      <br>
      <strong>
        Trondheim Short Track Club
      </strong>
    </p>
  `;

  let subject;
  let content;

  if (language === "en") {
    subject =
      "Registration confirmed – TKK Skating School";

    content =
      enBlock;
  } else if (
    language === "both"
  ) {
    subject =
      "Påmelding bekreftet / Registration confirmed – TKK";

    content =
      noBlock +
      `
        <hr
          style="
            border:0;
            border-top:1px solid #d1d5db;
            margin:28px 0;
          "
        >
      ` +
      enBlock;
  } else {
    subject =
      "Påmelding bekreftet – TKKs skøyteskole";

    content =
      noBlock;
  }

  const html = `
    <!doctype html>
    <html>
      <body
        style="
          margin:0;
          background:#f6f8fb;
          font-family:Arial,sans-serif;
          color:#1f2937;
        "
      >
        <div
          style="
            max-width:680px;
            margin:0 auto;
            padding:28px 16px;
          "
        >
          <div
            style="
              background:#ffffff;
              border:1px solid #e5e7eb;
              border-radius:16px;
              padding:28px;
            "
          >
            <div
              style="
                font-size:13px;
                font-weight:700;
                letter-spacing:.08em;
                text-transform:uppercase;
                color:#003a8f;
                margin-bottom:18px;
              "
            >
              Trondheim Kortbaneklubb
            </div>

            ${content}
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    html
  };
}

async function sendConfirmationEmail({
  email,
  phone,
  batch,
  children
}) {
  const apiKey =
    process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY mangler."
    );
  }

  const from =
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    "Trondheim Kortbaneklubb <onboarding@resend.dev>";

  const message =
    buildConfirmationEmail({
      email,
      phone,
      batch,
      children
    });

  const response =
    await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",

        headers: {
          Authorization:
            "Bearer " + apiKey,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            from,

            to: [
              email
            ],

            subject:
              message.subject,

            html:
              message.html
          })
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const detail =
      data &&
      data.message
        ? data.message
        : "HTTP " +
          response.status;

    throw new Error(
      "Resend-feil: " +
      detail
    );
  }

  return data;
}

exports.handler =
  async function (event) {

    if (
      event.httpMethod !== "POST"
    ) {
      return json(
        405,
        {
          error:
            "Metoden er ikke tillatt."
        }
      );
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

      return json(
        500,
        {
          error:
            "Serveroppsettet for databasen mangler."
        }
      );
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
      body =
        JSON.parse(
          event.body || "{}"
        );
    } catch (error) {
      return json(
        400,
        {
          error:
            "Ugyldig forespørsel."
        }
      );
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
        return json(
          400,
          {
            error:
              "Påmeldingskode mangler."
          }
        );
      }

      if (!email) {
        return json(
          400,
          {
            error:
              "E-post mangler."
          }
        );
      }

      if (!phone) {
        return json(
          400,
          {
            error:
              "Telefonnummer mangler."
          }
        );
      }

      if (!children.length) {
        return json(
          400,
          {
            error:
              "Du må legge til minst ett barn."
          }
        );
      }

      const {
        data: activeBatches,
        error: batchError
      } = await supabase
        .from(
          "skating_school_batches"
        )
        .select(
          [
            "id",
            "name",
            "department_id",
            "status",
            "start_date",
            "end_date",
            "created_at"
          ].join(", ")
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

        return json(
          500,
          {
            error:
              "Kunne ikke hente aktivt semester."
          }
        );
      }

      if (
        !activeBatches ||
        activeBatches.length === 0
      ) {
        return json(
          400,
          {
            error:
              "Det finnes ikke noe aktivt semester for påmelding."
          }
        );
      }

      if (
        activeBatches.length > 1
      ) {
        return json(
          400,
          {
            error:
              "Det finnes flere aktive semester. Sett kun ett semester til Aktiv før påmelding."
          }
        );
      }

      const activeBatch =
        activeBatches[0];

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

        return json(
          500,
          {
            error:
              "Kunne ikke kontrollere påmeldingskoden."
          }
        );
      }

      if (!accessCodeRow) {
        return json(
          400,
          {
            error:
              "Påmeldingskoden er ugyldig."
          }
        );
      }

      if (
        accessCodeRow.is_active ===
        false
      ) {
        return json(
          400,
          {
            error:
              "Påmeldingskoden er ikke aktiv."
          }
        );
      }

      if (
        isExpired(
          accessCodeRow.expires_at
        )
      ) {
        return json(
          400,
          {
            error:
              "Påmeldingskoden har utløpt."
          }
        );
      }

      if (
        accessCodeRow.batch_id &&
        String(
          accessCodeRow.batch_id
        ) !==
        String(
          activeBatch.id
        )
      ) {
        return json(
          400,
          {
            error:
              "Koden gjelder ikke for dette semesteret."
          }
        );
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
        return json(
          400,
          {
            error:
              "Koden gjelder ikke for denne avdelingen."
          }
        );
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
        return json(
          400,
          {
            error:
              "Påmeldingskoden er allerede brukt opp."
          }
        );
      }

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

        const preferredLanguage =
          normalizeOptionalValue(
            child.preferred_language
          );

        const otherInformation =
          normalizeOptionalValue(
            child.other_information
          );

        if (!childName) {
          return json(
            400,
            {
              error:
                `Barn ${index + 1}: Navn mangler.`
            }
          );
        }

        if (!birthDate) {
          return json(
            400,
            {
              error:
                `Barn ${index + 1}: Fødselsdato mangler.`
            }
          );
        }

        if (!preferredLanguage) {
          return json(
            400,
            {
              error:
                `Barn ${index + 1}: Velg ønsket språk.`
            }
          );
        }

        if (
          preferredLanguage !==
            "Norsk" &&
          preferredLanguage !==
            "Engelsk"
        ) {
          return json(
            400,
            {
              error:
                `Barn ${index + 1}: Ugyldig språkvalg.`
            }
          );
        }

        if (
          !requestedSkateSize &&
          !hasOwnSkates
        ) {
          return json(
            400,
            {
              error:
                `Barn ${index + 1}: Velg skøytestørrelse eller oppgi at barnet har egne skøyter.`
            }
          );
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
            hasOwnSkates,

          preferred_language:
            preferredLanguage,

          other_information:
            otherInformation
        });
      }

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

      const signupRows =
        [];

      const memberResults =
        [];

      for (
        const child of
        normalizedChildren
      ) {
        const preferredLanguage =
          child.preferred_language;

        const otherInformation =
          child.other_information;

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
            groups,
            preferredLanguage,
            otherInformation
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
            enrollmentResult.created,

          preferred_language:
            preferredLanguage,

          other_information:
            otherInformation
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

          preferred_language:
            preferredLanguage,

          other_information:
            otherInformation,

          existing_member_id:
            member.id,

          status:
            "Ferdig",

          notes:
            "Påmeldt via kodepåmelding. Medlem og semesterdeltakelse opprettet automatisk."
        });
      }

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

        return json(
          500,
          {
            error:
              "Medlemmet ble opprettet, men påmeldingsloggen kunne ikke lagres. Kontakt administrator."
          }
        );
      }

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
      }

      let emailWarning =
        null;

      try {
        await sendConfirmationEmail({
          email,
          phone,
          batch:
            activeBatch,
          children:
            normalizedChildren
        });
      } catch (emailError) {
        console.error(
          "Confirmation email error:",
          emailError
        );

        emailWarning =
          "Påmeldingen ble registrert, men bekreftelsesmailen kunne ikke sendes.";
      }

      return json(
        200,
        {
          ok:
            true,

          message:
            "Påmeldingen er registrert og barnet er lagt inn som medlem og deltaker.",

          email_sent:
            !emailWarning,

          email_warning:
            emailWarning,

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
        }
      );

    } catch (error) {
      console.error(
        "create-school-signup-code error:",
        error
      );

      return json(
        500,
        {
          error:
            error &&
            error.message
              ? error.message
              : "En uventet feil oppstod under påmeldingen."
        }
      );
    }
  };
