const { createClient } = require("@supabase/supabase-js");

const ALLOWED_ROLES = new Set([
  "admin",
  "utlan",
  "skoyteskole",
  "idrettsrad",
]);

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

function clean(value) {
  return String(value || "").trim();
}

function cleanEmail(value) {
  return clean(value).toLowerCase();
}

function getBearerToken(event) {
  const header =
    event.headers.authorization ||
    event.headers.Authorization ||
    "";

  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function makeSupabase() {
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error("Supabase-miljøvariabler mangler.");
  }

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

async function getSignedInUser(supabase, event) {
  const token = getBearerToken(event);

  if (!token) {
    return { error: "Mangler innlogging." };
  }

  const result = await supabase.auth.getUser(token);

  if (
    result.error ||
    !result.data ||
    !result.data.user
  ) {
    return {
      error:
        "Innloggingen er utløpt eller ugyldig.",
    };
  }

  return {
    user: result.data.user,
  };
}

async function getRoleRow(
  supabase,
  email
) {
  const result = await supabase
    .from("app_user_roles")
    .select(
      "id, email, role, display_name, is_active"
    )
    .eq(
      "email",
      cleanEmail(email)
    )
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data || null;
}

async function requireAdmin(
  supabase,
  event
) {
  const signedIn =
    await getSignedInUser(
      supabase,
      event
    );

  if (signedIn.error) {
    return signedIn;
  }

  const roleRow =
    await getRoleRow(
      supabase,
      signedIn.user.email
    );

  if (
    !roleRow ||
    roleRow.role !== "admin" ||
    roleRow.is_active === false
  ) {
    return {
      error:
        "Du har ikke administratorrettigheter.",
    };
  }

  return {
    user: signedIn.user,
    roleRow,
  };
}

async function saveRoleRow(
  supabase,
  email,
  role,
  displayName,
  isActive
) {
  const normalizedEmail =
    cleanEmail(email);

  const existing =
    await supabase
      .from("app_user_roles")
      .select("id")
      .eq(
        "email",
        normalizedEmail
      )
      .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const payload = {
    email:
      normalizedEmail,

    role,

    display_name:
      clean(displayName) || null,

    is_active:
      isActive !== false,

    updated_at:
      new Date().toISOString(),
  };

  if (existing.data) {
    const update =
      await supabase
        .from("app_user_roles")
        .update(payload)
        .eq(
          "id",
          existing.data.id
        );

    if (update.error) {
      throw update.error;
    }
  } else {
    const insert =
      await supabase
        .from("app_user_roles")
        .insert([payload]);

    if (insert.error) {
      throw insert.error;
    }
  }
}

async function listAllAuthUsers(
  supabase
) {
  const users = [];

  let page = 1;

  const perPage = 200;

  while (true) {
    const result =
      await supabase.auth.admin.listUsers({
        page,
        perPage,
      });

    if (result.error) {
      throw result.error;
    }

    const batch =
      result.data &&
      Array.isArray(
        result.data.users
      )
        ? result.data.users
        : [];

    users.push(...batch);

    if (
      batch.length < perPage
    ) {
      break;
    }

    page += 1;

    if (page > 50) {
      break;
    }
  }

  return users;
}

async function handleMe(
  supabase,
  event
) {
  const signedIn =
    await getSignedInUser(
      supabase,
      event
    );

  if (signedIn.error) {
    return json(
      401,
      {
        error:
          signedIn.error,
      }
    );
  }

  let roleRow = null;

  try {
    roleRow =
      await getRoleRow(
        supabase,
        signedIn.user.email
      );
  } catch (error) {
    console.error(
      "admin-users me role:",
      error
    );
  }

  return json(
    200,
    {
      success: true,

      user: {
        id:
          signedIn.user.id,

        email:
          signedIn.user.email || "",

        display_name:
          (
            roleRow &&
            roleRow.display_name
          ) ||
          (
            signedIn.user
              .user_metadata &&
            signedIn.user
              .user_metadata
              .display_name
          ) ||
          "",

        role:
          roleRow
            ? roleRow.role
            : null,

        is_active:
          roleRow
            ? roleRow.is_active !== false
            : true,
      },
    }
  );
}

async function handleList(
  supabase,
  event
) {
  const admin =
    await requireAdmin(
      supabase,
      event
    );

  if (admin.error) {
    return json(
      403,
      {
        error:
          admin.error,
      }
    );
  }

  const [
    authUsers,
    rolesResult,
  ] =
    await Promise.all([
      listAllAuthUsers(
        supabase
      ),

      supabase
        .from("app_user_roles")
        .select(
          "id, email, role, display_name, is_active"
        ),
    ]);

  if (rolesResult.error) {
    throw rolesResult.error;
  }

  const rolesByEmail =
    new Map(
      (
        rolesResult.data || []
      ).map(
        (row) => [
          cleanEmail(
            row.email
          ),
          row,
        ]
      )
    );

  const users =
    authUsers
      .map((user) => {
        const roleRow =
          rolesByEmail.get(
            cleanEmail(
              user.email
            )
          );

        return {
          id:
            user.id,

          email:
            user.email || "",

          display_name:
            (
              roleRow &&
              roleRow.display_name
            ) ||
            (
              user.user_metadata &&
              user.user_metadata
                .display_name
            ) ||
            "",

          role:
            roleRow
              ? roleRow.role
              : "",

          is_active:
            roleRow
              ? roleRow.is_active !== false
              : !user.banned_until,

          created_at:
            user.created_at || null,

          last_sign_in_at:
            user.last_sign_in_at || null,
        };
      })
      .sort(
        (a, b) =>
          String(
            a.display_name ||
            a.email
          ).localeCompare(
            String(
              b.display_name ||
              b.email
            ),
            "no"
          )
      );

  return json(
    200,
    {
      success: true,
      users,
    }
  );
}

async function handleCreate(
  supabase,
  event,
  body
) {
  const admin =
    await requireAdmin(
      supabase,
      event
    );

  if (admin.error) {
    return json(
      403,
      {
        error:
          admin.error,
      }
    );
  }

  const email =
    cleanEmail(
      body.email
    );

  const displayName =
    clean(
      body.display_name
    );

  const role =
    clean(
      body.role
    );

  if (
    !email ||
    !email.includes("@")
  ) {
    return json(
      400,
      {
        error:
          "Ugyldig e-postadresse.",
      }
    );
  }

  if (!displayName) {
    return json(
      400,
      {
        error:
          "Navn mangler.",
      }
    );
  }

  if (
    !ALLOWED_ROLES.has(
      role
    )
  ) {
    return json(
      400,
      {
        error:
          "Ugyldig rolle.",
      }
    );
  }

  const inviteOptions = {
    data: {
      display_name:
        displayName,
    },
  };

  if (
    process.env.SITE_URL
  ) {
    inviteOptions.redirectTo =
      String(
        process.env.SITE_URL
      ).replace(
        /\/$/,
        ""
      ) +
      "/?reset=1";
  }

  const invite =
    await supabase.auth.admin
      .inviteUserByEmail(
        email,
        inviteOptions
      );

  if (invite.error) {
    const message =
      String(
        invite.error.message || ""
      );

    if (
      !message
        .toLowerCase()
        .includes("already") &&
      !message
        .toLowerCase()
        .includes("registered")
    ) {
      throw invite.error;
    }
  }

  await saveRoleRow(
    supabase,
    email,
    role,
    displayName,
    true
  );

  return json(
    200,
    {
      success: true,
      message:
        "Brukeren er opprettet og invitasjon er sendt.",
    }
  );
}

async function handleUpdate(
  supabase,
  event,
  body
) {
  const admin =
    await requireAdmin(
      supabase,
      event
    );

  if (admin.error) {
    return json(
      403,
      {
        error:
          admin.error,
      }
    );
  }

  const userId =
    clean(
      body.user_id
    );

  const email =
    cleanEmail(
      body.email
    );

  const displayName =
    clean(
      body.display_name
    );

  const role =
    clean(
      body.role
    );

  const isActive =
    body.is_active !== false;

  if (
    !userId ||
    !email
  ) {
    return json(
      400,
      {
        error:
          "Bruker-ID eller e-post mangler.",
      }
    );
  }

  if (
    !ALLOWED_ROLES.has(
      role
    )
  ) {
    return json(
      400,
      {
        error:
          "Ugyldig rolle.",
      }
    );
  }

  const userResult =
    await supabase.auth.admin
      .getUserById(
        userId
      );

  if (userResult.error) {
    throw userResult.error;
  }

  const currentMetadata =
    (
      userResult.data.user &&
      userResult.data.user
        .user_metadata
    ) ||
    {};

  const authUpdate =
    await supabase.auth.admin
      .updateUserById(
        userId,
        {
          user_metadata: {
            ...currentMetadata,

            display_name:
              displayName,
          },

          ban_duration:
            isActive
              ? "none"
              : "876000h",
        }
      );

  if (authUpdate.error) {
    throw authUpdate.error;
  }

  await saveRoleRow(
    supabase,
    email,
    role,
    displayName,
    isActive
  );

  return json(
    200,
    {
      success: true,
    }
  );
}

async function handleResetPassword(
  supabase,
  event,
  body
) {
  const admin =
    await requireAdmin(
      supabase,
      event
    );

  if (admin.error) {
    return json(
      403,
      {
        error:
          admin.error,
      }
    );
  }

  const email =
    cleanEmail(
      body.email
    );

  if (!email) {
    return json(
      400,
      {
        error:
          "E-post mangler.",
      }
    );
  }

  const options = {};

  if (
    process.env.SITE_URL
  ) {
    options.redirectTo =
      String(
        process.env.SITE_URL
      ).replace(
        /\/$/,
        ""
      ) +
      "/?reset=1";
  }

  const result =
    await supabase.auth
      .resetPasswordForEmail(
        email,
        options
      );

  if (result.error) {
    throw result.error;
  }

  return json(
    200,
    {
      success: true,
    }
  );
}

exports.handler =
  async (event) => {
    try {
      const supabase =
        makeSupabase();

      if (
        event.httpMethod === "GET"
      ) {
        const mode =
          clean(
            event.queryStringParameters &&
            event.queryStringParameters
              .mode
          );

        if (
          mode === "me"
        ) {
          return await handleMe(
            supabase,
            event
          );
        }

        return await handleList(
          supabase,
          event
        );
      }

      let body = {};

      try {
        body =
          JSON.parse(
            event.body || "{}"
          );
      } catch (_) {
        return json(
          400,
          {
            error:
              "Ugyldig JSON.",
          }
        );
      }

      if (
        event.httpMethod === "POST"
      ) {
        const action =
          clean(
            body.action
          );

        if (
          action === "create"
        ) {
          return await handleCreate(
            supabase,
            event,
            body
          );
        }

        if (
          action ===
          "reset_password"
        ) {
          return await handleResetPassword(
            supabase,
            event,
            body
          );
        }
      }

      if (
        event.httpMethod === "PATCH" &&
        clean(body.action) ===
          "update"
      ) {
        return await handleUpdate(
          supabase,
          event,
          body
        );
      }

      return json(
        405,
        {
          error:
            "Method not allowed",
        }
      );
    } catch (error) {
      console.error(
        "admin-users error:",
        error
      );

      return json(
        500,
        {
          error:
            error &&
            error.message
              ? error.message
              : "Noe gikk galt i brukeradministrasjonen.",
        }
      );
    }
  };
