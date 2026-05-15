TKK tilgangsstyring - første versjon

Roller:
- admin: full tilgang
- utlan: utlån, innlevering, rapporter, samt Skøyter og Medlemmer i Admin
- skoyteskole: kun Skøyteskole

Filer:
- index.html -> erstatt eksisterende index.html
- netlify/functions/create-loan.js -> erstatt eksisterende funksjon
- netlify/functions/return-loan.js -> erstatt eksisterende funksjon
- access-control.sql -> kjør i Supabase SQL Editor

Viktig oppsett:
1. Kjør access-control.sql i Supabase.
2. Opprett brukere i Supabase -> Authentication -> Users.
3. Kjør INSERT-linjen nederst i SQL-filen med din egen e-post som admin.
4. Deploy filene til Netlify.
5. Logg inn i appen.
6. Admin kan legge flere e-poster og roller i Admin -> Tilgang.

Netlify miljøvariabler må fortsatt finnes:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- RESEND_API_KEY
- EMAIL_FROM=onboarding@resend.dev
