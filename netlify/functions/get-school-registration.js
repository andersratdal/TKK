const { json, database, registrationBatch, canRegister, closedMessage } = require('./lib/school-semester');
exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Metoden er ikke tillatt.' });
  try {
    const batch = await registrationBatch(database());
    // Only public semester information, never codes, signups, or credentials.
    return json(200, { semester: batch && { id: batch.id, name: batch.name, start_date: batch.start_date, end_date: batch.end_date, registration_status: batch.registration_status }, open: canRegister(batch), message: canRegister(batch) ? 'Påmeldingen er åpen.' : closedMessage(batch) });
  } catch (error) { console.error(error); return json(503, { error: 'Påmeldingsinformasjonen er utilgjengelig. Prøv igjen senere.' }); }
};
