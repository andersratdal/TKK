Stripe neste steg for skøyteskole

Innhold:
- tkk-skoyteutleie-med-stripe-neste-steg.html
- skoyteskole-pamelding-med-stripe.html
- stripe_school_signup.sql
- netlify/functions/create-school-signup-checkout.js
- netlify/functions/stripe-webhook.js
- package.json
- netlify.toml
- betaling-fullfort.html
- betaling-avbrutt.html

Hva som er gjort:
- Påmeldingssiden lagrer først påmeldingen i skating_school_signups
- Deretter kaller siden en Netlify Function som oppretter Stripe Checkout Session
- Webhook markerer payment_status = 'Betalt'
- Appen viser betalingsstatus i listen over påmeldinger
- Barn kan bare flyttes til deltakere når payment_status = 'Betalt'

Netlify miljøvariabler:
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SITE_URL

Stripe:
- Opprett webhook for checkout.session.completed
- Pek webhook til:
  https://DITT-NETLIFY-DOMENE/.netlify/functions/stripe-webhook
