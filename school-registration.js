/* Shared, same-origin semester information for all public signup entry points. */
(() => {
  'use strict';
  const en = document.documentElement.lang.toLowerCase().startsWith('en');
  const form = document.getElementById('signupForm');
  if (!form) return;
  window.schoolRegistration = { open: false, semester: null };
  const notice = document.createElement('div'); notice.id = 'schoolRegistrationNotice';
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  notice.textContent = en ? 'Loading registration information…' : 'Henter påmeldingsinformasjon …';
  form.before(notice);
  const period = document.createElement('div'); period.id = 'schoolCoursePeriod'; notice.before(period);
  form.addEventListener('submit', event => {
    if (!window.schoolRegistration.open) {
      event.preventDefault(); event.stopImmediatePropagation();
      notice.textContent = en ? 'Registration is closed or unavailable. Reload the page.' : 'Påmeldingen er stengt eller utilgjengelig. Last siden på nytt.';
    }
  }, true);
  function semesterText(name) {
    const match = /^(Vinter|Vår|Sommer|Høst)\s+(\d{4})$/i.exec(name || '');
    if (!match) return name || '';
    const seasons = { vinter: 'vinteren', vår: 'våren', sommer: 'sommeren', høst: 'høsten' };
    return seasons[match[1].toLowerCase()] + ' ' + match[2];
  }
  function date(value) {
    return value ? new Date(value + 'T12:00:00').toLocaleDateString(en ? 'en-GB' : 'nb-NO') : '';
  }
  fetch('/.netlify/functions/get-school-registration', { cache: 'no-store' })
    .then(async response => { if (!response.ok) throw new Error('unavailable'); return response.json(); })
    .then(data => {
      const batch = data.semester;
      const open = data.open === true && !!batch?.id;
      window.schoolRegistration = { ...data, open };
      if (typeof ACTIVE_BATCH_NAME !== 'undefined') ACTIVE_BATCH_NAME = batch?.name || '';
      const titles = document.querySelectorAll('h1');
      const title = titles[titles.length - 1];
      const heading = en ? 'TKK skating school registration' + (batch ? ' – ' + batch.name : '')
        : 'Påmelding til TKK skøyteskole' + (batch ? ' ' + semesterText(batch.name) : '');
      if (title) title.textContent = heading;
      document.title = heading;
      const badge = document.getElementById('batchBadge'); if (badge) badge.textContent = batch?.name || '—';
      const dates = [date(batch?.start_date), date(batch?.end_date)].filter(Boolean);
      period.textContent = dates.length ? (en ? 'Course period: ' : 'Kursperiode: ') + dates.join(' – ') : '';
      const english = { 'Åpen': 'Registration is open.', 'Fulltegnet': 'The skating school is fully booked.', 'Stengt': 'Registration is closed.', 'Ikke åpnet': 'Registration has not opened yet.' };
      notice.textContent = en ? (!open && batch?.registration_status === 'Åpen' ? 'Registration is closed.' : english[batch?.registration_status] || 'Registration has not opened yet.') : data.message;
      form.hidden = !open;
      document.dispatchEvent(new CustomEvent('school-registration-ready', { detail: window.schoolRegistration }));
    }).catch(() => {
      form.hidden = true;
      notice.textContent = en ? 'Registration information is unavailable. Please try again later.' : 'Påmeldingsinformasjonen er utilgjengelig. Prøv igjen senere.';
    });
})();
