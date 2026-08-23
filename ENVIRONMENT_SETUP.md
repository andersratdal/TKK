# TKK miljøoppsett

Dette oppsettet gjør at samme kode kan deployes til DEV og PROD uten å redigere Supabase-URL eller publishable key i HTML-filene.

## Netlify-variabler

Legg inn disse i BÅDE DEV og PROD:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL`
- `TKK_ENVIRONMENT` (anbefalt: `dev` eller `prod`)
- øvrige eksisterende variabler som Resend/Stripe

`SUPABASE_SERVICE_ROLE_KEY` brukes kun av Netlify Functions og skrives aldri til `env-config.js`.

## Build

Netlify kjører:

`npm run build`

Dette genererer `env-config.js` fra miljøvariablene før deploy.

`env-config.js` er lagt i `.gitignore`, slik at DEV-verdier aldri merges til PROD.

## Brancher

- `Dev` -> Netlify DEV -> Supabase DEV
- `main` -> Netlify PROD -> Supabase PROD

## Release

1. Utvikle og test på `Dev`.
2. Opprett Pull Request `Dev` -> `main`.
3. Merge når testen er godkjent.
4. Netlify PROD deployer samme kode, men genererer `env-config.js` med PROD-variablene.
5. Kjør kort produksjonstest.

## Viktig

Frontend skal bruke `SUPABASE_PUBLISHABLE_KEY`, aldri `SUPABASE_SERVICE_ROLE_KEY`.
