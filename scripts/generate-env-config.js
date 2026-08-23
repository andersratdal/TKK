const fs = require("fs");
const path = require("path");

const required = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY"
];

const missing = required.filter(
  (name) => !String(process.env[name] || "").trim()
);

if (missing.length) {
  console.error(
    "Mangler påkrevde frontend-miljøvariabler: " + missing.join(", ")
  );
  process.exit(1);
}

const config = {
  SUPABASE_URL: String(
    process.env.SUPABASE_URL || ""
  ).trim(),

  SUPABASE_PUBLISHABLE_KEY: String(
    process.env.SUPABASE_PUBLISHABLE_KEY || ""
  ).trim(),

  SITE_URL: String(
    process.env.SITE_URL || ""
  ).trim(),

  ENVIRONMENT: String(
    process.env.TKK_ENVIRONMENT ||
    process.env.CONTEXT ||
    "unknown"
  ).trim()
};

const output = [
  "/* Generert automatisk av scripts/generate-env-config.js. Ikke rediger manuelt. */",
  "window.TKK_ENV = Object.freeze(" +
    JSON.stringify(config, null, 2) +
    ");",
  ""
].join("\n");

const target = path.join(
  process.cwd(),
  "env-config.js"
);

fs.writeFileSync(
  target,
  output,
  "utf8"
);

console.log(
  "Genererte env-config.js for miljø: " +
  config.ENVIRONMENT
);
