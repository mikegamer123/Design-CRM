/* ============================================================
   gmail.js — Gmail API via Google Identity Services (browser OAuth)
   ============================================================ */

const Gmail = (() => {
  let _accessToken  = null;
  let _tokenExpiry  = 0;
  let _tokenClient  = null;
  let _clientId     = '';
  let _onAuthorized = null;

  const SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' ');

  function init(clientId, onAuthorized) {
    _clientId     = clientId || '';
    _onAuthorized = onAuthorized || null;
  }

  function isReady() {
    return !!_clientId && typeof google !== 'undefined' && google.accounts;
  }

  function isAuthorized() {
    return !!_accessToken && Date.now() < _tokenExpiry;
  }

  function _ensureTokenClient() {
    if (_tokenClient) return true;
    if (!isReady()) return false;
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: _clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) {
          console.error('Gmail OAuth error:', resp.error);
          return;
        }
        _accessToken = resp.access_token;
        // Google tokens last 3600 s; subtract 60 s buffer
        _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        if (_onAuthorized) _onAuthorized();
      }
    });
    return true;
  }

  function authorize() {
    if (!_clientId) {
      return Promise.reject(new Error('Set your Google Client ID in Settings first.'));
    }
    if (!isReady()) {
      return Promise.reject(new Error('Google Identity Services not yet loaded. Try again in a moment.'));
    }
    _ensureTokenClient();
    return new Promise((resolve, reject) => {
      const orig = _onAuthorized;
      // temporarily wrap so we can resolve the promise
      _tokenClient.callback = (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        _accessToken = resp.access_token;
        _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        if (orig) orig();
        if (_onAuthorized) _onAuthorized();
        resolve();
      };
      _tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  /* ---- helpers ---- */

  function _b64url(str) {
    // UTF-8 safe base64url
    const bytes = new TextEncoder().encode(str);
    let binary  = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function _buildRaw(from, fromName, to, subject, htmlBody) {
    const boundary = 'crmbound' + Date.now();
    const lines = [
      `From: ${fromName} <${from}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      htmlBody.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      htmlBody,
      '',
      `--${boundary}--`
    ];
    return _b64url(lines.join('\r\n'));
  }

  async function _gmailFetch(path, options = {}) {
    if (!isAuthorized()) throw new Error('Gmail not authorized. Please connect Gmail first.');
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${_accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      _accessToken = null; // force re-auth next time
      throw new Error('Gmail token expired. Please reconnect Gmail.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gmail API error ${res.status}`);
    }
    return res.json();
  }

  /* ---- public API ---- */

  async function sendEmail({ to, subject, htmlBody, fromName, fromEmail }) {
    const raw = _buildRaw(fromEmail, fromName, to, subject, htmlBody);
    const result = await _gmailFetch('/users/me/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw })
    });
    return result; // { id, threadId, labelIds }
  }

  async function getThread(threadId) {
    return _gmailFetch(`/users/me/threads/${threadId}?format=minimal`);
  }

  /* ── fetch every message in a thread with full body content ── */
  async function getThreadMessages(threadId) {
    const thread = await _gmailFetch(`/users/me/threads/${threadId}?format=full`);
    if (!thread.messages) return [];
    return thread.messages.map(_parseMessage);
  }

  /* ── fetch a single message by id ── */
  async function getMessage(messageId) {
    const msg = await _gmailFetch(`/users/me/messages/${messageId}?format=full`);
    return _parseMessage(msg);
  }

  /* ── parse a raw Gmail API message object into a clean object ── */
  function _parseMessage(msg) {
    const headers  = msg.payload?.headers || [];
    const get      = name => (headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '');
    const body     = _extractBody(msg.payload);
    const dateRaw  = get('Date');
    let date;
    try { date = new Date(dateRaw).toISOString(); } catch { date = new Date().toISOString(); }

    return {
      messageId: msg.id,
      threadId:  msg.threadId,
      date,
      from:      get('From'),
      to:        get('To'),
      subject:   get('Subject'),
      snippet:   msg.snippet || '',
      body,      // HTML preferred, falls back to plain text wrapped in <pre>
      labelIds:  msg.labelIds || []
    };
  }

  /* ── recursively extract the best body part (HTML > plain) ── */
  function _extractBody(payload) {
    if (!payload) return '';

    // Direct body (non-multipart)
    if (payload.body?.data) {
      const decoded = _b64decode(payload.body.data);
      if (payload.mimeType === 'text/html')  return decoded;
      if (payload.mimeType === 'text/plain') return `<pre style="white-space:pre-wrap;font-family:inherit">${_escHtml(decoded)}</pre>`;
    }

    if (!payload.parts) return '';

    // Prefer HTML part
    const htmlPart  = _findPart(payload.parts, 'text/html');
    if (htmlPart?.body?.data) return _b64decode(htmlPart.body.data);

    // Fall back to plain
    const plainPart = _findPart(payload.parts, 'text/plain');
    if (plainPart?.body?.data) {
      return `<pre style="white-space:pre-wrap;font-family:inherit">${_escHtml(_b64decode(plainPart.body.data))}</pre>`;
    }

    // Recurse into nested multipart
    for (const part of payload.parts) {
      const nested = _extractBody(part);
      if (nested) return nested;
    }
    return '';
  }

  function _findPart(parts, mimeType) {
    for (const p of parts) {
      if (p.mimeType === mimeType) return p;
      if (p.parts) {
        const found = _findPart(p.parts, mimeType);
        if (found) return found;
      }
    }
    return null;
  }

  function _b64decode(str) {
    try {
      const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      return decodeURIComponent(escape(atob(b64)));
    } catch { return ''; }
  }

  function _escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Returns array of { lead, newCount } for leads that received replies
  async function checkAllReplies(leads) {
    const newReplies = [];
    const toCheck = leads.filter(l =>
      l.threadId &&
      l.status !== 'closed_won' &&
      l.status !== 'closed_lost'
    );

    for (const lead of toCheck) {
      try {
        const thread = await getThread(lead.threadId);
        const count  = thread.messages ? thread.messages.length : 0;
        const known  = lead.knownMessageCount || 1;
        if (count > known) {
          newReplies.push({ lead, newCount: count });
        }
      } catch (e) {
        // skip this lead silently (thread may have been deleted)
        console.warn(`Thread check failed for ${lead.name}:`, e.message);
      }
    }
    return newReplies;
  }

  return {
    init,
    authorize,
    isAuthorized,
    isReady,
    sendEmail,
    getThread,
    getThreadMessages,
    getMessage,
    checkAllReplies,
    get accessToken() { return _accessToken; }
  };
})();
