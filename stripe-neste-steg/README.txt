Endringer:
- appfila peker nå til pamelding.html
- pamelding.html lagrer ikke lenger amount_nok = 1500
- create-school-signup-checkout.js bruker SCHOOL_SIGNUP_AMOUNT_NOK først
- Stripe Checkout ber nå om telefonnummer i checkout

Viktig:
- Link i Stripe kan fortsatt gjenkjenne en tidligere kunde i samme nettleser.
- Test gjerne i inkognitovindu hvis Stripe fortsatt foreslår ditt eget telefonnummer.
