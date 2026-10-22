const { randomUUID } = require('node:crypto');
const { json, database, registrationBatch } = require('./lib/school-semester');
const text = value => String(value || '').trim();
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metoden er ikke tillatt.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Ugyldig forespørsel.' }); }
  if (!body || typeof body !== 'object') return json(400, { error: 'Ugyldig forespørsel.' });
  const email = text(body.email).toLowerCase();
  const phone = text(body.phone).replace(/\s+/g, '');
  const children = body.children;
  if (!body.batch_id || !email.includes('@') || !phone || !Array.isArray(children) || children.length < 1 || children.length > 20) return json(400, { error: 'Semester, e-post, telefon og 1–20 barn må oppgis.' });
  const normalized = [];
  for (const child of children) {
    if (!child || typeof child !== 'object') return json(400, { error: 'Ugyldige barneopplysninger.' });
    const name = text(child.child_name), birth = text(child.birth_date), size = text(child.requested_skate_size);
    const own = child.has_own_skates === true;
    const date = new Date(birth + 'T00:00:00Z');
    if (!name || name.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(birth) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== birth || birth > new Date().toISOString().slice(0,10) || own === !!size) return json(400, { error: 'Kontroller barnets navn, fødselsdato og valg av skøyter.' });
    normalized.push({ child_name: name, birth_date: birth, requested_skate_size: size || null, has_own_skates: own });
  }
  try {
    const db = database();
    const batch = await registrationBatch(db, { requireOpen: true, expectedId: body.batch_id });
    const familyId = randomUUID();
    const rows = normalized.map(child => ({ ...child, email, phone, family_signup_id: familyId, batch_id: batch.id, batch_name: batch.name, department_id: batch.department_id, status: 'Ny', payment_status: 'Ubetalt', amount_nok: null, source: 'signup_page_family', notes: 'Påmeldt via offentlig påmeldingsside (familiepåmelding).' }));
    // One INSERT is atomic for the entire family; the DB trigger rechecks semester under a row lock.
    const { error } = await db.from('skating_school_signups').insert(rows);
    if (error) { if (error.code === 'P0001') return json(409, { error: 'Påmeldingen er stengt eller semesteret er endret. Last siden på nytt.' }); throw error; }
    return json(200, { family_signup_id: familyId, semester: { id: batch.id, name: batch.name } });
  } catch (error) { console.error(error); return json(error.statusCode || 500, { error: error.statusCode ? error.message : 'Kunne ikke registrere påmeldingen. Prøv igjen senere.' }); }
};
