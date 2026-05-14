/* ============================================================
   app.js — Design CRM
   ============================================================ */

(function () {
  'use strict';

  /* ── constants ── */
  const STATUSES = [
    { key: 'not_contacted', label: 'Not Contacted' },
    { key: 'contacted',     label: 'Contacted'     },
    { key: 'replied',       label: 'Replied'        },
    { key: 'proposal_sent', label: 'Proposal Sent'  },
    { key: 'negotiating',   label: 'Negotiating'    },
    { key: 'closed_won',    label: 'Closed Won'     },
    { key: 'closed_lost',   label: 'Closed Lost'    }
  ];
  const SL = Object.fromEntries(STATUSES.map(s => [s.key, s.label]));

  const STAGE_LABEL = {
    initial_outreach: 'Initial Outreach',
    follow_up:        'Follow-Up',
    proposal:         'Proposal',
    closing:          'Closing'
  };
  const ACT_ICON = {
    lead_created: '➕', email_sent: '📧',
    status_change: '🔄', reply_received: '💬', note_added: '📝'
  };
  const STATUS_COLOR = {
    not_contacted: '#94A3B8', contacted: '#2563EB', replied: '#D97706',
    proposal_sent: '#7C3AED', negotiating: '#EA580C',
    closed_won: '#059669', closed_lost: '#DC2626'
  };
  const PRIORITY_BADGE = { Hot: '🔥 Hot', Warm: '♨ Warm', Cold: '❄ Cold', High: '🔥 High', Medium: '◉ Medium', Low: '↓ Low' };
  const VALID_STATUSES = Object.keys(SL);

  /* ── state ── */
  const state = {
    leads: [], templates: [], settings: {},
    currentView: 'dashboard', detailLeadId: null,
    selectedLeads: new Set()   // ids of checked leads
  };

  /* ════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════ */
  async function init() {
    state.settings = Storage.loadSettings();
    Storage.init(state.settings.jsonbinKey, state.settings.jsonbinBin);
    Gmail.init(state.settings.googleClientId, onGmailAuthorized);

    const data = await Storage.getData();
    state.leads     = data.leads     || [];
    state.templates = data.templates || [];
    if (!state.templates.length) { state.templates = defaultTemplates(); await persist(); }

    bindEvents();
    navigate('dashboard');
  }

  /* ════════════════════════════════════════════
     NAVIGATION
  ════════════════════════════════════════════ */
  function navigate(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('[data-view]').forEach(a => a.classList.remove('active'));
    const el  = document.getElementById(`view-${view}`);
    const nav = document.querySelector(`[data-view="${view}"]`);
    if (el)  el.classList.add('active');
    if (nav) nav.classList.add('active');
    state.currentView = view;
    ({ dashboard: renderDashboard, leads: renderLeads, templates: renderTemplates,
       settings: renderSettings, 'lead-detail': renderLeadDetail })[view]?.();
  }

  function refresh() {
    if (state.currentView === 'dashboard')    renderDashboard();
    if (state.currentView === 'leads')        renderLeads();
    if (state.currentView === 'lead-detail')  renderLeadDetail();
  }

  /* ════════════════════════════════════════════
     EVENTS
  ════════════════════════════════════════════ */
  function bindEvents() {
    document.querySelectorAll('[data-view]').forEach(el =>
      el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.view); }));

    q('btn-check-replies').addEventListener('click', checkReplies);
    q('btn-sync-sheet').addEventListener('click', syncFromSheet);
    q('btn-push-sheet').addEventListener('click', pushToSheet);
    q('btn-add-lead').addEventListener('click', () => openLeadModal());
    q('lead-search').addEventListener('input', renderLeads);
    q('status-filter').addEventListener('change', renderLeads);
    q('import-file').addEventListener('change', handleImport);
    q('btn-back-leads').addEventListener('click', () => navigate('leads'));
    q('btn-edit-lead').addEventListener('click', () => openLeadModal(state.detailLeadId));
    q('btn-delete-lead').addEventListener('click', () => deleteLead(state.detailLeadId));
    q('btn-add-template').addEventListener('click', () => openTemplateModal());
    q('btn-save-settings').addEventListener('click', saveSettings);
    q('btn-test-storage').addEventListener('click', testStorage);
    q('btn-export-json').addEventListener('click', () =>
      Storage.exportJson({ leads: state.leads, templates: state.templates }));
    q('btn-clear-data').addEventListener('click', clearLocal);
    q('btn-gmail-auth').addEventListener('click', connectGmail);
    q('btn-create-sheet-template').addEventListener('click', showSheetSetupModal);
    q('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });
    q('btn-modal-close').addEventListener('click', closeModal);
  }

  /* ════════════════════════════════════════════
     PERSIST
  ════════════════════════════════════════════ */
  async function persist() {
    return Storage.setData({ leads: state.leads, templates: state.templates });
  }

  /* ════════════════════════════════════════════
     DASHBOARD
  ════════════════════════════════════════════ */
  function renderDashboard() {
    const cnt = k => state.leads.filter(l => l.status === k).length;
    q('stat-total').textContent         = state.leads.length;
    q('stat-not-contacted').textContent = cnt('not_contacted');
    q('stat-contacted').textContent     = cnt('contacted');
    q('stat-replied').textContent       = cnt('replied');
    q('stat-proposal').textContent      = cnt('proposal_sent');
    q('stat-won').textContent           = cnt('closed_won');
    q('stat-lost').textContent          = cnt('closed_lost');
    renderKanban();
    renderActivity();
  }

  function renderKanban() {
    q('kanban-board').innerHTML = STATUSES.map(s => {
      const items = state.leads.filter(l => l.status === s.key);
      return `<div class="kanban-col">
        <div class="kanban-col-header">
          <span class="kanban-col-title" style="color:${STATUS_COLOR[s.key]}">${s.label}</span>
          <span class="kanban-count">${items.length}</span>
        </div>
        <div class="kanban-items">
          ${items.map(l => `<div class="kanban-item" onclick="App.viewLead('${l.id}')">
            ${esc(l.company || l.name || '')}
            <div class="kanban-item-email">${esc(l.email || '')}</div>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  function renderActivity() {
    const all = [];
    state.leads.forEach(l => (l.history || []).forEach(h =>
      all.push({ ...h, leadName: l.company || l.name || l.email, leadId: l.id })));
    all.sort((a, b) => new Date(b.date) - new Date(a.date));
    const el = q('recent-activity');
    const recent = all.slice(0, 12);
    if (!recent.length) { el.innerHTML = '<p class="empty-state">No activity yet</p>'; return; }
    el.innerHTML = recent.map(h => `
      <div class="activity-item ${h.action === 'reply_received' ? 'highlight' : ''}">
        <div class="activity-icon">${ACT_ICON[h.action] || '•'}</div>
        <div class="activity-body">
          <strong>${esc(h.leadName)}</strong> — ${esc(h.details)}
          <div class="activity-date">${fmtDate(h.date)}</div>
        </div>
        <button class="btn-link" onclick="App.viewLead('${h.leadId}')">View</button>
      </div>`).join('');
  }

  /* ════════════════════════════════════════════
     LEADS LIST
  ════════════════════════════════════════════ */
  function renderLeads() {
    const qv     = (q('lead-search').value || '').toLowerCase();
    const status = q('status-filter').value;
    let leads    = state.leads;
    if (qv)     leads = leads.filter(l =>
      `${l.company||''} ${l.contact||''} ${l.email||''} ${l.category||''}`.toLowerCase().includes(qv));
    if (status) leads = leads.filter(l => l.status === status);

    q('leads-count-label').textContent =
      `${leads.length} lead${leads.length !== 1 ? 's' : ''}${status ? ` · ${SL[status]}` : ''}`;

    updateBulkBar();
    const wrap = q('leads-list');
    if (!leads.length) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-m)">
        ${state.leads.length === 0
          ? 'No leads yet — add one, import the master CSV, or sync from Google Sheets.'
          : 'No leads match this filter.'}
      </div>`;
      return;
    }
    const allChecked = leads.length > 0 && leads.every(l => state.selectedLeads.has(l.id));
    wrap.innerHTML = `<table class="leads-table">
      <thead><tr>
        <th class="th-check"><input type="checkbox" id="select-all-leads" title="Select all"
          ${allChecked ? 'checked' : ''} onchange="App.toggleAllLeads(this.checked)"></th>
        <th>Company</th><th>Contact</th><th>Email</th>
        <th>Category</th><th>Priority</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>${leads.map(l => {
        const sel = state.selectedLeads.has(l.id);
        return `<tr class="${sel ? 'selected-row' : ''}" onclick="App.viewLead('${l.id}')">
          <td class="td-check" onclick="event.stopPropagation()">
            <input type="checkbox" ${sel ? 'checked' : ''}
              onchange="App.toggleLead('${l.id}', this.checked)">
          </td>
          <td><strong>${esc(l.company || '')}</strong></td>
          <td>${esc(l.contact || '—')}</td>
          <td>${esc(l.email   || '—')}</td>
          <td>${esc(l.category || '—')}</td>
          <td>${priorityBadge(l.priority)}</td>
          <td><span class="badge ${l.status}">${SL[l.status]}</span></td>
          <td onclick="event.stopPropagation()" class="td-actions">
            <button class="btn-sm blue" onclick="App.openSendEmail('${l.id}')">Email</button>
            <button class="btn-sm"      onclick="App.viewLead('${l.id}')">View</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  function priorityBadge(p) {
    if (!p) return '—';
    const label = PRIORITY_BADGE[p] || p;
    const cls   = p.toLowerCase();
    return `<span class="priority-badge priority-${cls}">${label}</span>`;
  }

  function viewLead(id) { state.detailLeadId = id; navigate('lead-detail'); }

  /* ════════════════════════════════════════════
     LEAD DETAIL
  ════════════════════════════════════════════ */
  function renderLeadDetail() {
    const l = state.leads.find(x => x.id === state.detailLeadId);
    if (!l) { navigate('leads'); return; }
    const history = [...(l.history || [])].reverse();

    q('lead-detail-content').innerHTML = `
      <div class="lead-detail-layout">
        <div>
          <div class="card">
            <div class="lead-card-top">
              <div>
                <h2>${esc(l.company || '')}</h2>
                <div class="lead-card-sub">${esc(l.contact || '')}${l.position ? ` · ${esc(l.position)}` : ''}</div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                ${l.priority ? priorityBadge(l.priority) : ''}
                <span class="badge ${l.status}">${SL[l.status]}</span>
              </div>
            </div>

            <div class="info-grid" style="grid-template-columns:repeat(3,1fr)">
              ${infoItem('Email',        l.email)}
              ${infoItem('Phone',        l.phone)}
              ${infoItem('Website',      l.website)}
              ${infoItem('LinkedIn',     l.linkedin)}
              ${infoItem('Country',      l.country)}
              ${infoItem('Category',     l.category)}
              ${infoItem('Client Type',  l.client_type)}
              ${infoItem('Past Projects',l.past_projects)}
              ${infoItem('Satisfaction', l.satisfaction)}
              ${infoItem('Last Contact', l.last_contact)}
              ${infoItem('Source',       l.source)}
              ${infoItem('Added',        fmtDate(l.createdAt))}
            </div>

            ${l.pitch_angle ? `<div class="lead-notes-block">
              <h4>Best Pitch Angle</h4><p>${esc(l.pitch_angle)}</p></div>` : ''}

            ${l.design_notes ? `<div class="lead-notes-block">
              <h4>Design / UX Notes</h4><p>${esc(l.design_notes)}</p></div>` : ''}

            ${l.notes ? `<div class="lead-notes-block">
              <h4>Notes</h4><p>${esc(l.notes)}</p></div>` : ''}
          </div>

          ${renderEmailThread(l)}

          <div class="card">
            <h3 style="margin-bottom:16px">Activity History</h3>
            <div class="history-list">
              ${!history.length ? '<p class="empty-state">No activity yet</p>' :
                history.map(h => `<div class="history-item">
                  <div class="history-icon">${ACT_ICON[h.action] || '•'}</div>
                  <div class="history-body">
                    <div class="history-detail">${esc(h.details)}</div>
                    <div class="history-date">${fmtDate(h.date)}</div>
                  </div>
                </div>`).join('')}
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-section-title">Quick Actions</div>
            <div class="action-col">
              <button class="btn-primary w-full"  onclick="App.openSendEmail('${l.id}')">📧 Send Email</button>
              <button class="btn-secondary w-full" onclick="App.openAddNote('${l.id}')">📝 Add Note</button>
            </div>
          </div>
          <div class="card">
            <div class="card-section-title">Change Status</div>
            <div class="status-picker">
              ${STATUSES.map(s => `<button class="status-opt ${s.key} ${l.status === s.key ? 'active' : ''}"
                onclick="App.changeStatus('${l.id}','${s.key}')">${s.label}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  function infoItem(label, value) {
    return `<div class="info-item">
      <span class="info-label">${label}</span>
      <span class="info-value">${esc(value || '—')}</span>
    </div>`;
  }

  /* ════════════════════════════════════════════
     LEAD MODAL  (add / edit)
  ════════════════════════════════════════════ */
  function openLeadModal(id = null) {
    const l = id ? state.leads.find(x => x.id === id) : null;
    openModal(l ? 'Edit Lead' : 'Add New Lead', `
      <form id="lead-form" class="form">
        <div class="form-row">
          <div class="form-group"><label>Company / Brand *</label>
            <input type="text" name="company" value="${esc(l?.company || '')}" required></div>
          <div class="form-group"><label>Contact Person</label>
            <input type="text" name="contact" value="${esc(l?.contact || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Position / Title</label>
            <input type="text" name="position" value="${esc(l?.position || '')}"></div>
          <div class="form-group"><label>Email *</label>
            <input type="email" name="email" value="${esc(l?.email || '')}" required></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Phone</label>
            <input type="tel" name="phone" value="${esc(l?.phone || '')}"></div>
          <div class="form-group"><label>Website</label>
            <input type="text" name="website" value="${esc(l?.website || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>LinkedIn URL</label>
            <input type="text" name="linkedin" value="${esc(l?.linkedin || '')}"></div>
          <div class="form-group"><label>Country</label>
            <input type="text" name="country" value="${esc(l?.country || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Category / Business Type</label>
            <input type="text" name="category" value="${esc(l?.category || '')}" placeholder="Creative Agency, SaaS…"></div>
          <div class="form-group"><label>Client Type</label>
            <input type="text" name="client_type" value="${esc(l?.client_type || '')}" placeholder="Agency, Business Owner…"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Priority</label>
            <select name="priority">
              <option value="">—</option>
              ${['Hot','Warm','Cold','High','Medium','Low'].map(p =>
                `<option value="${p}" ${(l?.priority||'')=== p?'selected':''}>${p}</option>`).join('')}
            </select></div>
          <div class="form-group"><label>Status</label>
            <select name="status">${STATUSES.map(s =>
              `<option value="${s.key}" ${(l?.status||'not_contacted')===s.key?'selected':''}>${s.label}</option>`
            ).join('')}</select></div>
        </div>
        <div class="form-group"><label>Source</label>
          <input type="text" name="source" value="${esc(l?.source || '')}" placeholder="LinkedIn, Referral, Import…"></div>
        <div class="form-group"><label>Best Pitch Angle</label>
          <textarea name="pitch_angle" rows="2">${esc(l?.pitch_angle || '')}</textarea></div>
        <div class="form-group"><label>Design / UX Notes</label>
          <textarea name="design_notes" rows="2">${esc(l?.design_notes || '')}</textarea></div>
        <div class="form-group"><label>Notes</label>
          <textarea name="notes" rows="3">${esc(l?.notes || '')}</textarea></div>
        <div class="form-actions">
          <button type="button" class="btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn-primary">${l ? 'Save Changes' : 'Add Lead'}</button>
        </div>
      </form>`);

    document.getElementById('lead-form').addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const now  = new Date().toISOString();
      if (id) {
        const existing = state.leads.find(x => x.id === id);
        if (existing) {
          const old = existing.status;
          Object.assign(existing, { ...data, updatedAt: now });
          if (old !== data.status)
            pushHistory(existing, 'status_change', `Status: ${SL[old]} → ${SL[data.status]}`);
        }
      } else {
        state.leads.push({ id: uid(), ...data, createdAt: now, updatedAt: now,
          history: [{ date: now, action: 'lead_created', details: 'Lead added to CRM' }] });
      }
      await persist();
      closeModal();
      toast('Lead saved!', 'success');
      refresh();
    });
  }

  async function deleteLead(id) {
    if (!confirm('Delete this lead permanently?')) return;
    state.leads = state.leads.filter(l => l.id !== id);
    await persist();
    toast('Lead deleted', 'info');
    navigate('leads');
  }

  /* ════════════════════════════════════════════
     STATUS
  ════════════════════════════════════════════ */
  function changeStatus(id, status) {
    const l = state.leads.find(x => x.id === id);
    if (!l || l.status === status) return;
    const old = l.status;
    l.status = status;
    l.updatedAt = new Date().toISOString();
    pushHistory(l, 'status_change', `Status: ${SL[old]} → ${SL[status]}`);
    persist().then(() => { toast(`Moved to ${SL[status]}`, 'success'); refresh(); });
  }

  /* ════════════════════════════════════════════
     MULTI-SELECT
  ════════════════════════════════════════════ */
  function toggleLead(id, checked) {
    if (checked) state.selectedLeads.add(id);
    else         state.selectedLeads.delete(id);
    updateBulkBar();
    // Update the select-all checkbox state without full re-render
    const all = q('select-all-leads');
    if (all) {
      const visibleIds = Array.from(
        document.querySelectorAll('#leads-list tbody input[type=checkbox]')
      ).map(cb => cb.closest('tr')?.querySelector('.td-check input')?.getAttribute('onchange')?.match(/'([^']+)'/)?.[1]).filter(Boolean);
      all.checked = visibleIds.length > 0 && visibleIds.every(id => state.selectedLeads.has(id));
    }
  }

  function toggleAllLeads(checked) {
    // Only affect the currently visible (filtered) leads
    const checkboxes = document.querySelectorAll('#leads-list tbody .td-check input[type=checkbox]');
    checkboxes.forEach(cb => {
      const match = (cb.getAttribute('onchange') || '').match(/'([^']+)'/);
      if (!match) return;
      const id = match[1];
      if (checked) state.selectedLeads.add(id);
      else         state.selectedLeads.delete(id);
      cb.checked = checked;
    });
    // Highlight rows
    document.querySelectorAll('#leads-list tbody tr').forEach(tr => {
      tr.classList.toggle('selected-row', checked);
    });
    updateBulkBar();
  }

  function clearSelection() {
    state.selectedLeads.clear();
    updateBulkBar();
    renderLeads();
  }

  function updateBulkBar() {
    const bar = q('bulk-bar');
    const cnt = q('bulk-count-text');
    if (!bar || !cnt) return;
    const n = state.selectedLeads.size;
    cnt.textContent = `${n} lead${n !== 1 ? 's' : ''}`;
    bar.classList.toggle('hidden', n === 0);
  }

  /* ════════════════════════════════════════════
     BULK EMAIL
  ════════════════════════════════════════════ */
  function openBulkEmail() {
    const leads = state.leads.filter(l => state.selectedLeads.has(l.id));
    if (!leads.length) { toast('Select at least one lead first', 'error'); return; }
    if (!Gmail.isAuthorized()) { toast('Connect Gmail first (sidebar)', 'error'); return; }

    openModal(`Bulk Email — ${leads.length} Lead${leads.length !== 1 ? 's' : ''}`, `
      <div class="form">
        <div class="bulk-recipients">
          ${leads.map(l => `<span class="bulk-chip" title="${esc(l.email)}">${esc(l.company || l.email)}</span>`).join('')}
        </div>
        <p class="bulk-info-note">Each email is personalized — <code>{{name}}</code>, <code>{{company}}</code> etc. are replaced per recipient at send time.</p>

        <div class="form-group"><label>Load Template</label>
          <select id="bulk-tpl-select" onchange="App.applyBulkTemplate()">
            <option value="">— choose a template —</option>
            ${state.templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label>Subject</label>
          <input type="text" id="bulk-subject" placeholder="e.g. Elevate {{company}}'s Brand"></div>
        <div class="form-group"><label>Message</label>
          <div id="bulk-body" class="rich-editor" contenteditable="true" style="min-height:160px"></div></div>

        <div class="form-actions">
          <button class="btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button class="btn-primary"   onclick="App.doBulkSend()">
            📧 Send to ${leads.length} Lead${leads.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>`);
  }

  function applyBulkTemplate() {
    const tId = document.getElementById('bulk-tpl-select')?.value;
    if (!tId) return;
    const t = state.templates.find(x => x.id === tId);
    if (!t) return;
    document.getElementById('bulk-subject').value  = t.subject;
    document.getElementById('bulk-body').innerHTML = t.body;
  }

  async function doBulkSend() {
    const leads   = state.leads.filter(l => state.selectedLeads.has(l.id));
    const subject = (document.getElementById('bulk-subject')?.value    || '').trim();
    const html    = (document.getElementById('bulk-body')?.innerHTML   || '').trim();

    if (!leads.length)         { toast('No leads selected', 'error');           return; }
    if (!subject || !html)     { toast('Fill in subject and message', 'error'); return; }
    if (!Gmail.isAuthorized()) { toast('Connect Gmail first', 'error');         return; }

    closeModal();
    toast(`Sending to ${leads.length} lead${leads.length !== 1 ? 's' : ''}…`, 'info');

    let sent = 0, failed = 0;
    const failures = [];
    const now = new Date().toISOString();

    for (const lead of leads) {
      // Plain-text fill (for subject / history) — no HTML entities
      const fillText = s => s
        .replace(/\{\{name\}\}/gi,    lead.contact || lead.company || '')
        .replace(/\{\{company\}\}/gi, lead.company || '')
        .replace(/\{\{email\}\}/gi,   lead.email   || '')
        .replace(/\{\{sender\}\}/gi,  state.settings.senderName || 'The Team')
        .replace(/\{\{pitch\}\}/gi,   lead.pitch_angle || '');

      // HTML-safe fill (for email body — escapes special chars in values)
      const fillHtml = s => s
        .replace(/\{\{name\}\}/gi,    esc(lead.contact || lead.company || ''))
        .replace(/\{\{company\}\}/gi, esc(lead.company || ''))
        .replace(/\{\{email\}\}/gi,   esc(lead.email   || ''))
        .replace(/\{\{sender\}\}/gi,  esc(state.settings.senderName || 'The Team'))
        .replace(/\{\{pitch\}\}/gi,   esc(lead.pitch_angle || ''));

      try {
        const result = await Gmail.sendEmail({
          to:        lead.email,
          subject:   fillText(subject),
          htmlBody:  fillHtml(html),
          fromName:  state.settings.senderName  || '',
          fromEmail: state.settings.senderEmail || ''
        });

        // Update lead
        lead.threadId          = result.threadId;
        lead.knownMessageCount = 1;
        lead.lastContacted     = now;
        lead.updatedAt         = now;
        if (lead.status === 'not_contacted') lead.status = 'contacted';
        pushHistory(lead, 'email_sent', `Bulk email: "${fillText(subject)}"`);

        // Store the sent message in the thread
        try {
          const sentMsg = await Gmail.getMessage(result.id);
          lead.emailThread = lead.emailThread || [];
          sentMsg.direction = 'sent';
          lead.emailThread.push(sentMsg);
        } catch (_) { /* non-critical */ }

        sent++;
        toast(`✓ ${sent}/${leads.length} — ${esc(lead.company || lead.email)}`, 'info');
      } catch (err) {
        console.warn(`Bulk send failed for ${lead.email}:`, err.message);
        failures.push(lead.company || lead.email);
        failed++;
      }

      // 400 ms gap between sends — respects Gmail's per-second rate limit
      if (sent + failed < leads.length) await new Promise(r => setTimeout(r, 400));
    }

    await persist();
    state.selectedLeads.clear();

    if (failed) {
      toast(`Sent ${sent}/${leads.length}. Failed: ${failures.slice(0, 3).join(', ')}${failures.length > 3 ? '…' : ''}`, 'warning');
    } else {
      toast(`✅ All ${sent} email${sent !== 1 ? 's' : ''} sent!`, 'success');
    }
    refresh();
  }

  /* ════════════════════════════════════════════
     SEND EMAIL
  ════════════════════════════════════════════ */
  function openSendEmail(id) {
    const l = state.leads.find(x => x.id === id);
    if (!l) return;
    openModal(`Email — ${esc(l.company || '')}`, `
      <div class="form">
        <div class="form-group"><label>Load Template</label>
          <select id="tpl-select" onchange="App.applyTemplate('${id}')">
            <option value="">— choose a template —</option>
            ${state.templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label>To</label>
          <input type="email" id="email-to" value="${esc(l.email || '')}"></div>
        <div class="form-group"><label>Subject *</label>
          <input type="text" id="email-subject"></div>
        <div class="form-group"><label>Message *</label>
          <div id="email-body" class="rich-editor" contenteditable="true"></div></div>
        <div class="form-actions">
          <button class="btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button class="btn-primary"   onclick="App.doSendEmail('${id}')">Send Email</button>
        </div>
      </div>`);
  }

  function applyTemplate(leadId) {
    const l   = state.leads.find(x => x.id === leadId);
    const tId = document.getElementById('tpl-select')?.value;
    if (!tId || !l) return;
    const t = state.templates.find(x => x.id === tId);
    if (!t) return;
    const fill = s => s
      .replace(/\{\{name\}\}/gi,    esc(l.contact || l.company || ''))
      .replace(/\{\{company\}\}/gi, esc(l.company || ''))
      .replace(/\{\{email\}\}/gi,   esc(l.email || ''))
      .replace(/\{\{sender\}\}/gi,  esc(state.settings.senderName || 'The Team'))
      .replace(/\{\{pitch\}\}/gi,   esc(l.pitch_angle || ''));
    document.getElementById('email-subject').value    = fill(t.subject);
    document.getElementById('email-body').innerHTML   = fill(t.body);
  }

  async function doSendEmail(leadId) {
    const l       = state.leads.find(x => x.id === leadId);
    const to      = (document.getElementById('email-to')?.value    || '').trim();
    const subject = (document.getElementById('email-subject')?.value || '').trim();
    const html    = (document.getElementById('email-body')?.innerHTML || '').trim();
    if (!to || !subject || !html)  { toast('Fill in all fields', 'error');            return; }
    if (!Gmail.isAuthorized())      { toast('Connect Gmail first (sidebar)', 'error'); return; }
    try {
      const result = await Gmail.sendEmail({
        to, subject, htmlBody: html,
        fromName:  state.settings.senderName  || '',
        fromEmail: state.settings.senderEmail || ''
      });
      const now = new Date().toISOString();
      Object.assign(l, { threadId: result.threadId, knownMessageCount: 1,
        lastContacted: now, updatedAt: now });
      if (l.status === 'not_contacted') l.status = 'contacted';
      pushHistory(l, 'email_sent', `Email sent: "${subject}"`);

      // Fetch and store the sent message content
      try {
        const sentMsg = await Gmail.getMessage(result.id);
        l.emailThread = l.emailThread || [];
        sentMsg.direction = 'sent';
        l.emailThread.push(sentMsg);
      } catch (_) { /* non-critical — thread view just won't show body */ }

      await persist();
      closeModal();
      toast('Email sent!', 'success');
      refresh();
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ════════════════════════════════════════════
     CHECK REPLIES
  ════════════════════════════════════════════ */
  async function checkReplies() {
    if (!Gmail.isAuthorized()) { toast('Connect Gmail first', 'error'); return; }
    toast('Checking for replies…', 'info');
    try {
      const found = await Gmail.checkAllReplies(state.leads);
      if (!found.length) { toast('No new replies', 'info'); return; }
      const now = new Date().toISOString();

      for (const { lead, newCount } of found) {
        lead.knownMessageCount = newCount;
        lead.updatedAt = now;
        if (lead.status === 'contacted') lead.status = 'replied';
        pushHistory(lead, 'reply_received', 'Reply detected in email thread');

        // Fetch the full thread and store any messages we haven't seen yet
        try {
          const messages   = await Gmail.getThreadMessages(lead.threadId);
          const seenIds    = new Set((lead.emailThread || []).map(m => m.messageId));
          const ourEmail   = (state.settings.senderEmail || '').toLowerCase();
          lead.emailThread = lead.emailThread || [];

          for (const msg of messages) {
            if (seenIds.has(msg.messageId)) continue;
            const fromLower  = (msg.from || '').toLowerCase();
            msg.direction    = (ourEmail && fromLower.includes(ourEmail)) ? 'sent' : 'received';
            lead.emailThread.push(msg);
            seenIds.add(msg.messageId);
          }
        } catch (threadErr) {
          console.warn('Could not fetch thread for', lead.company, ':', threadErr.message);
        }
      }

      await persist();
      toast(`${found.length} new repl${found.length > 1 ? 'ies' : 'y'} detected!`, 'success');
      renderDashboard();
      // Refresh detail view if we're on one of the updated leads
      if (state.currentView === 'lead-detail' &&
          found.some(f => f.lead.id === state.detailLeadId)) {
        renderLeadDetail();
      }
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ════════════════════════════════════════════
     GOOGLE SHEETS SYNC
  ════════════════════════════════════════════ */
  async function syncFromSheet() {
    if (!Gmail.isAuthorized()) { toast('Connect Gmail first', 'error'); return; }
    const sheetId = state.settings.sheetId;
    if (!sheetId) { toast('Set your Google Sheet ID in Settings first', 'error'); navigate('settings'); return; }

    toast('Reading Google Sheet…', 'info');
    try {
      const rows    = await Sheets.readSheet(sheetId);
      const emails  = state.leads.map(l => l.email);
      const { leads: newLeads, skipped } = Sheets.parseLeads(rows, emails);

      if (!newLeads.length) {
        toast(`All leads already in CRM${skipped ? ` (${skipped} duplicates skipped)` : ''}`, 'info');
        return;
      }
      state.leads.push(...newLeads);
      await persist();
      toast(`Imported ${newLeads.length} new lead${newLeads.length > 1 ? 's' : ''}${skipped ? `, ${skipped} duplicates skipped` : ''}`, 'success');
      refresh();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function pushToSheet() {
    if (!Gmail.isAuthorized()) { toast('Connect Gmail first', 'error'); return; }
    const sheetId = state.settings.sheetId;
    if (!sheetId) { toast('Set your Google Sheet ID in Settings first', 'error'); navigate('settings'); return; }
    if (!confirm(`Push all ${state.leads.length} leads to Google Sheet? This will overwrite the sheet content.`)) return;

    toast('Pushing to Google Sheet…', 'info');
    try {
      await Sheets.pushLeads(sheetId, state.leads);
      toast(`${state.leads.length} leads pushed to Google Sheet!`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  function showSheetSetupModal() {
    const cols = Sheets.SHEET_COLUMNS.join(', ');
    openModal('Google Sheet Setup', `
      <div style="line-height:1.7;font-size:13.5px">
        <p style="margin-bottom:12px">Your master leads Google Sheet should have these column headers in <strong>Row 1</strong> of <strong>Sheet1</strong>:</p>
        <div style="background:var(--bg);border-radius:6px;padding:12px;font-family:monospace;font-size:12px;word-break:break-all;margin-bottom:16px">
          ${esc(cols)}
        </div>
        <p style="margin-bottom:8px"><strong>Quickstart:</strong></p>
        <ol style="margin-left:20px;display:flex;flex-direction:column;gap:6px">
          <li>Create a new Google Sheet at <em>sheets.google.com</em></li>
          <li>Paste the column headers above into row 1</li>
          <li>Upload <strong>leads_master.csv</strong> (already in your CRM folder) — File → Import → Replace spreadsheet</li>
          <li>Copy the Sheet ID from the URL and paste it in Settings</li>
          <li>Click <strong>Connect Gmail</strong> in the sidebar (grants Sheets access at the same time)</li>
          <li>Use <strong>↓ Sync from Sheet</strong> on the dashboard to pull new leads anytime</li>
          <li>Use <strong>↑ Push to Sheet</strong> to write CRM status changes back to the sheet</li>
        </ol>
        <p style="margin-top:16px;color:var(--text-m);font-size:12.5px">Duplicates are matched by email address — existing leads are never overwritten on sync.</p>
        <div class="form-actions" style="margin-top:20px">
          <button class="btn-primary" onclick="App.closeModal()">Got it</button>
        </div>
      </div>`);
  }

  /* ════════════════════════════════════════════
     ADD NOTE
  ════════════════════════════════════════════ */
  function openAddNote(id) {
    openModal('Add Note', `
      <div class="form">
        <div class="form-group"><label>Note</label>
          <textarea id="note-text" rows="5" placeholder="Write your note…"></textarea></div>
        <div class="form-actions">
          <button class="btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button class="btn-primary"   onclick="App.saveNote('${id}')">Save Note</button>
        </div>
      </div>`);
  }

  async function saveNote(id) {
    const l    = state.leads.find(x => x.id === id);
    const text = (document.getElementById('note-text')?.value || '').trim();
    if (!l || !text) return;
    const now = new Date().toISOString();
    l.notes    = l.notes ? `${l.notes}\n\n[${fmtDate(now)}] ${text}` : `[${fmtDate(now)}] ${text}`;
    l.updatedAt = now;
    pushHistory(l, 'note_added', `Note: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);
    await persist();
    closeModal();
    toast('Note saved', 'success');
    if (state.currentView === 'lead-detail') renderLeadDetail();
  }

  /* ════════════════════════════════════════════
     TEMPLATES
  ════════════════════════════════════════════ */
  function renderTemplates() {
    const el = q('templates-list');
    if (!state.templates.length) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-m)">No templates yet.</div>';
      return;
    }
    el.innerHTML = state.templates.map(t => `
      <div class="card template-card">
        <div class="template-card-top">
          <div>
            <h3>${esc(t.name)}</h3>
            <span class="stage-badge">${STAGE_LABEL[t.stage] || t.stage}</span>
          </div>
          <div class="template-card-actions">
            <button class="btn-sm blue" onclick="App.openTemplateModal('${t.id}')">Edit</button>
            <button class="btn-sm red"  onclick="App.deleteTemplate('${t.id}')">Delete</button>
          </div>
        </div>
        <div class="template-subject"><strong>Subject:</strong> ${esc(t.subject)}</div>
        <div class="template-body-preview">${t.body.replace(/<[^>]+>/g, ' ')}</div>
      </div>`).join('');
  }

  function openTemplateModal(id = null) {
    const t = id ? state.templates.find(x => x.id === id) : null;
    openModal(t ? 'Edit Template' : 'New Template', `
      <form id="tpl-form" class="form">
        <div class="form-row">
          <div class="form-group"><label>Name *</label>
            <input type="text" name="name" value="${esc(t?.name || '')}" required></div>
          <div class="form-group"><label>Stage</label>
            <select name="stage">${Object.entries(STAGE_LABEL).map(([k, v]) =>
              `<option value="${k}" ${(t?.stage || 'initial_outreach') === k ? 'selected' : ''}>${v}</option>`
            ).join('')}</select></div>
        </div>
        <div class="form-group"><label>Subject *</label>
          <input type="text" name="subject" value="${esc(t?.subject || '')}" required>
          <small>Placeholders: {{name}}, {{company}}, {{sender}}, {{pitch}}</small></div>
        <div class="form-group"><label>Body (HTML supported) *</label>
          <textarea name="body" rows="10" required>${esc(t?.body || '')}</textarea>
          <small>Placeholders: {{name}}, {{company}}, {{sender}}, {{pitch}}</small></div>
        <div class="form-actions">
          <button type="button" class="btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn-primary">${t ? 'Save' : 'Add Template'}</button>
        </div>
      </form>`);

    document.getElementById('tpl-form').addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      if (id) { const tpl = state.templates.find(x => x.id === id); if (tpl) Object.assign(tpl, data); }
      else state.templates.push({ id: uid(), ...data });
      await persist();
      closeModal();
      toast('Template saved!', 'success');
      renderTemplates();
    });
  }

  async function deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    state.templates = state.templates.filter(t => t.id !== id);
    await persist();
    toast('Template deleted', 'info');
    renderTemplates();
  }

  /* ════════════════════════════════════════════
     SETTINGS
  ════════════════════════════════════════════ */
  function renderSettings() {
    const s = state.settings;
    q('setting-jsonbin-key').value       = s.jsonbinKey     || '';
    q('setting-jsonbin-bin').value       = s.jsonbinBin     || '';
    q('setting-google-client-id').value  = s.googleClientId || '';
    q('setting-sheet-id').value          = s.sheetId        || '';
    q('setting-sender-name').value       = s.senderName     || '';
    q('setting-sender-email').value      = s.senderEmail    || '';
  }

  async function saveSettings() {
    const settings = {
      jsonbinKey:     q('setting-jsonbin-key').value.trim(),
      jsonbinBin:     q('setting-jsonbin-bin').value.trim(),
      googleClientId: q('setting-google-client-id').value.trim(),
      sheetId:        q('setting-sheet-id').value.trim(),
      senderName:     q('setting-sender-name').value.trim(),
      senderEmail:    q('setting-sender-email').value.trim()
    };
    state.settings = settings;
    Storage.saveSettings(settings);
    Storage.init(settings.jsonbinKey, settings.jsonbinBin);
    Gmail.init(settings.googleClientId, onGmailAuthorized);
    toast('Settings saved!', 'success');
  }

  async function testStorage() {
    const key = q('setting-jsonbin-key').value.trim();
    const bin = q('setting-jsonbin-bin').value.trim();
    if (!key || !bin) { toast('Enter API Key and Bin ID first', 'error'); return; }
    toast('Testing connection…', 'info');
    const r = await Storage.testConnection(key, bin);
    r.ok ? toast('JSONBin connected successfully!', 'success')
         : toast(`Connection failed: ${r.msg}`, 'error');
  }

  function clearLocal() {
    if (!confirm('Clear all local data? Remote JSONBin data is unaffected.')) return;
    localStorage.removeItem('crm_data');
    toast('Local data cleared. Reload to re-sync from JSONBin.', 'info');
  }

  /* ════════════════════════════════════════════
     GMAIL
  ════════════════════════════════════════════ */
  async function connectGmail() {
    if (!state.settings.googleClientId) {
      toast('Set your Google Client ID in Settings first', 'error');
      navigate('settings');
      return;
    }
    try { await Gmail.authorize(); }
    catch (err) { toast(err.message, 'error'); }
  }

  function onGmailAuthorized() {
    q('gmail-status').className        = 'gmail-status connected';
    q('gmail-status-text').textContent = 'Gmail connected';
    const btn = q('btn-gmail-auth');
    btn.textContent = 'Gmail Connected ✓';
    btn.classList.add('connected');
    toast('Gmail connected! (also has Google Sheets access)', 'success');
  }

  /* ════════════════════════════════════════════
     CSV IMPORT  (handles leads_master.csv columns)
  ════════════════════════════════════════════ */
  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const rows = parseCSV(ev.target.result);
      if (rows.length < 2) { toast('CSV appears empty', 'error'); return; }

      const header = rows[0].map(h => (h || '').toLowerCase().trim());
      const col    = (...names) => {
        for (const n of names) {
          const i = header.findIndex(h => h === n || h.includes(n));
          if (i !== -1) return i;
        }
        return -1;
      };

      const iCompany    = col('company', 'name');
      const iContact    = col('contact', 'person', 'client name');
      const iPosition   = col('position', 'title', 'role');
      const iEmail      = col('email');
      const iWebsite    = col('website');
      const iLinkedin   = col('linkedin');
      const iCountry    = col('country');
      const iCategory   = col('category', 'type of business', 'business');
      const iClientType = col('client_type', 'client type', 'type of client');
      const iPriority   = col('priority', 'cold', 'warm', 'hot');
      const iPitch      = col('pitch_angle', 'pitch angle', 'best pitch');
      const iDesign     = col('design_notes', 'design notes', 'design fit');
      const iPastProj   = col('past_projects', 'past projects', 'number of past');
      const iSat        = col('satisfaction', 'sartsfaction');
      const iLastCont   = col('last_contact', 'last contact');
      const iSource     = col('source', 'point of contact');
      const iNotes      = col('notes', 'content', 'onboarding');
      const iStatus     = col('status');

      if (iEmail === -1) { toast('CSV must have an "email" column', 'error'); return; }

      const emailSet = new Set(state.leads.map(l => (l.email || '').toLowerCase()));
      let added = 0;
      const now = new Date().toISOString();

      for (let i = 1; i < rows.length; i++) {
        const r     = rows[i];
        const email = (r[iEmail] || '').trim();
        if (!email || emailSet.has(email.toLowerCase())) continue;
        emailSet.add(email.toLowerCase());

        const rawStatus = iStatus >= 0 ? (r[iStatus] || '').trim() : '';
        const status    = VALID_STATUSES.includes(rawStatus) ? rawStatus : 'not_contacted';

        state.leads.push({
          id:           uid(),
          company:      iCompany    >= 0 ? (r[iCompany]    || '').trim() : email,
          contact:      iContact    >= 0 ? (r[iContact]    || '').trim() : '',
          position:     iPosition   >= 0 ? (r[iPosition]   || '').trim() : '',
          email,
          phone:        '',
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
          source:       iSource     >= 0 ? (r[iSource]     || '').trim() : 'Import',
          notes:        iNotes      >= 0 ? (r[iNotes]      || '').trim() : '',
          status,
          createdAt: now, updatedAt: now,
          history: [{ date: now, action: 'lead_created', details: 'Imported from CSV' }]
        });
        added++;
      }

      if (!added) { toast('No new leads found (duplicates skipped)', 'info'); return; }
      await persist();
      toast(`Imported ${added} lead${added > 1 ? 's' : ''}!`, 'success');
      navigate('leads');
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function parseCSV(text) {
    return text.split(/\r?\n/).map(line => {
      const cells = []; let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === ',' && !inQ) { cells.push(cur); cur = ''; }
        else cur += c;
      }
      cells.push(cur);
      return cells;
    }).filter(r => r.some(c => (c || '').trim()));
  }

  /* ════════════════════════════════════════════
     DEFAULT TEMPLATES
  ════════════════════════════════════════════ */
  function defaultTemplates() {
    return [
      {
        id: uid(), name: 'Initial Outreach', stage: 'initial_outreach',
        subject: "Elevate {{company}}'s Brand with Professional Design",
        body: `<p>Hi {{name}},</p>
<p>I hope this finds you well! I came across {{company}} and was genuinely impressed by what you're building.</p>
<p>We run a design & branding subscription that helps growing companies stand out — unlimited design requests, fast turnarounds, and a dedicated designer who understands your brand.</p>
<p>Would you be open to a quick 15-minute chat to explore if there's a fit?</p>
<p>Best,<br>{{sender}}</p>`
      },
      {
        id: uid(), name: 'Follow-Up', stage: 'follow_up',
        subject: 'Following up — Design for {{company}}',
        body: `<p>Hi {{name}},</p>
<p>Just circling back on my last message — I know inboxes get busy!</p>
<p>We've helped companies similar to {{company}} transform their visual presence without the overhead of an in-house team. I'd love to share a few relevant examples.</p>
<p>Even a quick 10 minutes could be worthwhile. What does your week look like?</p>
<p>Best,<br>{{sender}}</p>`
      },
      {
        id: uid(), name: 'Proposal Ready', stage: 'proposal',
        subject: 'Your Design Proposal — {{company}}',
        body: `<p>Hi {{name}},</p>
<p>Thank you for your interest! Here's what our subscription includes for {{company}}:</p>
<ul>
<li>Unlimited design requests</li>
<li>48-hour turnaround on most tasks</li>
<li>Dedicated designer who knows your brand</li>
<li>Unlimited revisions</li>
</ul>
<p>I'd love to walk you through the details on a quick call. When works best for you?</p>
<p>Best,<br>{{sender}}</p>`
      },
      {
        id: uid(), name: 'Closing', stage: 'closing',
        subject: 'Ready to get started, {{name}}?',
        body: `<p>Hi {{name}},</p>
<p>One final follow-up — we have a limited offer this month I'd hate for {{company}} to miss.</p>
<p>If the timing isn't right, no worries at all — I'll check back later. But if you'd like to move forward or have any questions, just reply here.</p>
<p>Looking forward to hearing from you,<br>{{sender}}</p>`
      }
    ];
  }

  /* ════════════════════════════════════════════
     MODAL / TOAST / UTILS
  ════════════════════════════════════════════ */
  function openModal(title, body) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML    = body;
    q('modal-overlay').classList.remove('hidden');
  }
  function closeModal() { q('modal-overlay').classList.add('hidden'); }

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function q(id)  { return document.getElementById(id); }
  function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso; // return raw string if not a valid ISO date
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  // Extract display name from "Display Name <email@example.com>" headers
  function parseFromName(header) {
    if (!header) return 'Unknown';
    const m = header.match(/^"?([^"<]+?)"?\s*</);
    if (m) return m[1].trim();
    return header.replace(/<[^>]+>/g, '').trim() || header;
  }

  // Render an email body HTML safely inside a sandboxed iframe that auto-sizes
  function emailBodyFrame(bodyHtml) {
    if (!bodyHtml) return '<em style="color:#94a3b8;font-size:12px">No content</em>';

    const doc =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>' +
      'body{margin:10px 14px;padding:0;font-family:-apple-system,BlinkMacSystemFont,' +
      'sans-serif;font-size:13.5px;line-height:1.65;color:#0F172A;word-wrap:break-word}' +
      'a{color:#2563EB}p,ul,ol{margin:0 0 8px}li{margin:0 0 3px}' +
      'img{max-width:100%;height:auto}blockquote{border-left:3px solid #CBD5E1;' +
      'margin:8px 0;padding:4px 12px;color:#64748B}' +
      '</style></head><body>' +
      bodyHtml +
      '</body></html>';

    // Escape for use as an HTML attribute value (& → &amp;, " → &quot;)
    const srcdoc = doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

    return '<iframe class="email-iframe" srcdoc="' + srcdoc + '"' +
      ' sandbox="allow-same-origin allow-popups"' +
      " onload=\"try{this.style.height=(this.contentDocument.body.scrollHeight+20)+'px'}catch(e){}\"" +
      '></iframe>';
  }

  // Render the full email conversation thread card for a lead
  function renderEmailThread(l) {
    const thread = [...(l.emailThread || [])].sort((a, b) =>
      new Date(a.date) - new Date(b.date));

    if (!thread.length) {
      return `<div class="card">
        <div class="email-thread-header">
          <h3 class="email-thread-title">✉️ Email Thread</h3>
        </div>
        <p class="empty-state">No emails recorded yet — click <strong>Send Email</strong> to start the conversation.</p>
      </div>`;
    }

    const msgs = thread.map(msg => {
      const dir      = msg.direction || 'received';
      const fromName = dir === 'sent' ? 'You' : parseFromName(msg.from || '');
      const toLine   = msg.to ? `<div class="email-msg-to">To: ${esc(parseFromName(msg.to))}</div>` : '';
      const subject  = msg.subject || '(no subject)';
      const dateStr  = fmtDateTime(msg.date);
      const dirIcon  = dir === 'sent' ? '📤' : '📥';

      return `<div class="email-msg ${esc(dir)}">
        <div class="email-msg-header">
          <div class="email-msg-meta">
            <div class="email-msg-from">${dirIcon} ${esc(fromName)}</div>
            ${toLine}
          </div>
          <span class="email-msg-date">${esc(dateStr)}</span>
        </div>
        <div class="email-msg-subject">Subject: ${esc(subject)}</div>
        <div class="email-msg-body">${emailBodyFrame(msg.body)}</div>
      </div>`;
    }).join('');

    return `<div class="card">
      <div class="email-thread-header">
        <h3 class="email-thread-title">✉️ Email Thread</h3>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="email-thread-count">${thread.length} message${thread.length !== 1 ? 's' : ''}</span>
          <button class="btn-sm blue" onclick="App.openSendEmail('${l.id}')">Reply / New Email</button>
        </div>
      </div>
      <div class="email-thread">${msgs}</div>
    </div>`;
  }

  function pushHistory(lead, action, details) {
    lead.history = lead.history || [];
    lead.history.push({ date: new Date().toISOString(), action, details });
  }

  /* ════════════════════════════════════════════
     EXPOSE GLOBAL App
  ════════════════════════════════════════════ */
  window.App = {
    init, viewLead, changeStatus, closeModal,
    applyTemplate, doSendEmail, saveNote,
    openTemplateModal, deleteTemplate,
    openSendEmail, openAddNote,
    // multi-select + bulk email
    toggleLead, toggleAllLeads, clearSelection,
    openBulkEmail, applyBulkTemplate, doBulkSend
  };

})();

document.addEventListener('DOMContentLoaded', () => App.init());
