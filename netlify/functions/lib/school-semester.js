const { createClient } = require('@supabase/supabase-js');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function database() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Serveroppsettet for databasen mangler.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function canRegister(batch) {
  return !!batch && batch.is_default_registration === true && batch.registration_status === 'Åpen' && ['Planlagt', 'Pågående'].includes(batch.lifecycle_status);
}
function closedMessage(batch) {
  if (!batch) return 'Påmeldingen er ikke åpnet.';
  if (batch.registration_status === 'Fulltegnet') return 'Skøyteskolen er fulltegnet.';
  if (batch.registration_status === 'Ikke åpnet') return 'Påmeldingen er ikke åpnet ennå.';
  return 'Påmeldingen er stengt.';
}
async function registrationBatch(db, { requireOpen = false, expectedId } = {}) {
  const { data, error } = await db.from('skating_school_batches')
    .select('id,name,department_id,start_date,end_date,lifecycle_status,registration_status,is_default_registration')
    .eq('is_default_registration', true).limit(2);
  if (error) throw new Error('Kunne ikke hente påmeldingssemester. Kontroller SQL-migreringen.');
  if ((data || []).length > 1) throw new Error('Flere standard påmeldingssemestre er satt. Kontakt administrator.');
  const batch = data?.[0] || null;
  if (expectedId && String(batch?.id) !== String(expectedId)) {
    const err = new Error('Påmeldingssemesteret er endret. Last siden på nytt før du sender inn.'); err.statusCode = 409; throw err;
  }
  if (requireOpen && !canRegister(batch)) { const err = new Error(closedMessage(batch)); err.statusCode = 409; throw err; }
  return batch;
}
module.exports = { json, database, canRegister, closedMessage, registrationBatch };
