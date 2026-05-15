TKK innlevering med e-post

Filer:
- index.html: oppdatert slik at innlevering kaller /api/return-loan
- netlify/functions/return-loan.js: registrerer innlevering og sender e-post
- netlify.toml: redirect for /api/return-loan
- package.json: legger til resend hvis den mangler
- skate-return-email.sql: legger til return_email_sent_at på loans

Husk:
1. Kopier filene inn i prosjektet.
2. Kjør SQL-filen i Supabase SQL Editor.
3. Deploy på nytt i Netlify.
4. Netlify må ha RESEND_API_KEY og EMAIL_FROM satt.
