/* ============================================================
   sheets.js — Google Sheets API (browser, OAuth via gmail.js token)
   ============================================================
   Uses the same access token that Gmail.authorize() obtains.
   The token must have the Sheets scope included — handled in gmail.js.
   ============================================================ */

const Sheets = (() => {

  /* Column order that matches leads_master.csv / the canonical Google Sheet */
  const SHEET_COLUMNS = [
    'company', 'contact', 'position', 'email', 'website',
    'linkedin', 'country', 'category', 'client_type', 'priority',
    'pitch_angle', 'design_notes', 'past_projects', 'satisfaction',
    'last_contact', 'source', 'notes', 'status'
  ];

  const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

  // Cache the first tab name per sheetId so we only look it up once per session
  const _tabNameCache = {};

  function _authHeader() {
    const t = Gmail.accessToken;
    if (!t) throw new Error('Not authorized — connect Gmail first.');
    return { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' };
  }

  /* ── get the actual name of the first tab (handles "Sheet 1", "Leads", etc.) ── */
  async function _firstTabName(sheetId) {
    if (_tabNameCache[sheetId]) return _tabNameCache[sheetId];
    const res = await fetch(`${BASE}/${sheetId}?fields=sheets.properties.title`, {
      headers: _authHeader()
    });
    if (res.status === 404) throw new Error('Sheet not found — check the Sheet ID in Settings.');
    if (res.status === 403) throw new Error('Permission denied — make sure the sheet is shared with your Gmail account (Editor access).');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Sheets API error ${res.status}`);
    }
    const json  = await res.json();
    const title = json.sheets?.[0]?.properties?.title;
    if (!title) throw new Error('Could not read sheet tab name — is the Sheet ID correct?');
    _tabNameCache[sheetId] = title;
    return title;
  }

  /* ── encode tab name safely for use in a range (wraps in quotes if needed) ── */
  function _range(tabName, cells) {
    // Tab names with spaces or special chars need wrapping in single quotes
    const safe = tabName.includes(' ') || tabName.includes("'")
      ? `'${tabName.replace(/'/g, "''")}'`
      : tabName;
    return cells ? `${safe}!${cells}` : safe;
  }

  /* ── read all rows from the first tab ── */
  async function readSheet(sheetId) {
    const tab  = await _firstTabName(sheetId);
    const url  = `${BASE}/${sheetId}/values/${encodeURIComponent(_range(tab))}`;
    const res  = await fetch(url, { headers: _authHeader() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Sheets read error ${res.status}`);
    }
    const json = await res.json();
    return json.values || [];
  }

  /* ── write rows to the first tab (full overwrite) ── */
  async function writeSheet(sheetId, rows) {
    const tab  = await _firstTabName(sheetId);
    const range = _range(tab);
    const url  = `${BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const res  = await fetch(url, {
      method: 'PUT',
      headers: _authHeader(),
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Sheets write error ${res.status}`);
    }
    return await res.json();
  }

  /* ── append rows without overwriting existing content ── */
  async function appendRows(sheetId, rows) {
    const tab   = await _firstTabName(sheetId);
    const range = _range(tab);
    const url   = `${BASE}/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res   = await fetch(url, {
      method: 'POST',
      headers: _authHeader(),
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Sheets append error ${res.status}`);
    }
    return await res.json();
  }

  /* ── parse rows from sheet into lead objects, skip dupes by email ── */
  function parseLeads(rows, existingEmails) {
    if (!rows || rows.length < 2) return { leads: [], skipped: 0 };

    const headerRow = rows[0].map(h => (h || '').toLowerCase().trim());
    const col = name => headerRow.findIndex(h => h === name || h.includes(name));

    const iCompany    = col('company');
    const iContact    = col('contact') !== -1 ? col('contact') : col('name');
    const iPosition   = col('position') !== -1 ? col('position') : col('title');
    const iEmail      = col('email');
    const iWebsite    = col('website');
    const iLinkedin   = col('linkedin');
    const iCountry    = col('country');
    const iCategory   = col('category');
    const iClientType = col('client_type');
    const iPriority   = col('priority');
    const iPitch      = col('pitch_angle');
    const iDesign     = col('design_notes');
    const iPastProj   = col('past_projects');
    const iSat        = col('satisfaction');
    const iLastCont   = col('last_contact');
    const iSource     = col('source');
    const iNotes      = col('notes');
    const iStatus     = col('status');

    if (iEmail === -1) throw new Error('Sheet must have an "email" column header in row 1.');

    const emailSet = new Set((existingEmails || []).map(e => e.toLowerCase()));
    const leads    = [];
    let skipped    = 0;
    const now      = new Date().toISOString();

    for (let i = 1; i < rows.length; i++) {
      const r     = rows[i];
      const email = (r[iEmail] || '').trim();
      if (!email) continue;
      if (emailSet.has(email.toLowerCase())) { skipped++; continue; }
      emailSet.add(email.toLowerCase());

      const rawStatus = iStatus >= 0 ? (r[iStatus] || '').trim() : '';
      const validStatuses = ['not_contacted','contacted','replied','proposal_sent','negotiating','closed_won','closed_lost'];
      const status = validStatuses.includes(rawStatus) ? rawStatus : 'not_contacted';

      leads.push({
        id:           _uid(),
        company:      iCompany    >= 0 ? (r[iCompany]    || '').trim() : email,
        contact:      iContact    >= 0 ? (r[iContact]    || '').trim() : '',
        position:     iPosition   >= 0 ? (r[iPosition]   || '').trim() : '',
        email,
        website:      iWebsite    >= 0 ? (r[iWebsite]    || '').trim() : '',
        linkedin:     iLinkedin   >= 0 ? (r[iLinkedin]   || '').trim() : '',
        country:      iCountry    >= 0 ? (r[iCountry]    || '').trim() : '',
        category:     iCategory   >= 0 ? (r[iCategory]   || '').trim() : '',
        client_type:  iClientType >= 0 ? (r[iClientType] || '').trim() : '',
        priority:     iPriority   >= 0 ? (r[iPriority]   || '').trim() : '',
        pitch_angle:  iPitch      >= 0 ? (r[iPitch]      || '').trim() : '',
        design_notes: iDesign     >= 0 ? (r[iDesign]     || '').trim() : '',
        past_projects:iPastProj   >= 0 ? (r[iPastProj]   || '').trim() : '',
        satisfaction: iSat        >= 0 ? (r[iSat]        || '').trim() : '',
        last_contact: iLastCont   >= 0 ? (r[iLastCont]   || '').trim() : '',
        source:       iSource     >= 0 ? (r[iSource]     || '').trim() : '',
        notes:        iNotes      >= 0 ? (r[iNotes]      || '').trim() : '',
        status,
        createdAt: now, updatedAt: now,
        history: [{ date: now, action: 'lead_created', details: 'Synced from Google Sheet' }]
      });
    }
    return { leads, skipped };
  }

  /* ── convert state.leads to sheet rows ── */
  function leadsToRows(leads) {
    const header = SHEET_COLUMNS;
    const rows   = [header];
    leads.forEach(l => {
      rows.push(SHEET_COLUMNS.map(k => l[k] || ''));
    });
    return rows;
  }

  /* ── push all leads to sheet (full sync) ── */
  async function pushLeads(sheetId, leads) {
    const rows = leadsToRows(leads);
    return writeSheet(sheetId, rows);
  }

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  return { readSheet, writeSheet, appendRows, parseLeads, leadsToRows, pushLeads, SHEET_COLUMNS };
})();
