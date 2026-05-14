/* ============================================================
   storage.js — JSONBin.io with localStorage fallback
   ============================================================ */

const Storage = (() => {
  const LS_DATA_KEY     = 'crm_data';
  const LS_SETTINGS_KEY = 'crm_settings';

  let _apiKey = '';
  let _binId  = '';

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(LS_SETTINGS_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveSettings(obj) {
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(obj));
  }

  function loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(LS_DATA_KEY) || 'null');
    } catch { return null; }
  }

  function saveLocal(data) {
    localStorage.setItem(LS_DATA_KEY, JSON.stringify(data));
  }

  function init(apiKey, binId) {
    _apiKey = apiKey || '';
    _binId  = binId  || '';
  }

  function isConfigured() {
    return _apiKey.length > 0 && _binId.length > 0;
  }

  async function getData() {
    if (!isConfigured()) {
      return loadLocal() || _emptyData();
    }
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${_binId}/latest`, {
        headers: { 'X-Master-Key': _apiKey, 'X-Bin-Meta': 'false' }
      });
      if (!res.ok) throw new Error(`JSONBin ${res.status}`);
      const json = await res.json();
      const data = json.record || json;
      saveLocal(data); // keep local copy in sync
      return data;
    } catch (err) {
      console.warn('Storage.getData remote failed, using local:', err.message);
      return loadLocal() || _emptyData();
    }
  }

  async function setData(data) {
    saveLocal(data); // always update local immediately
    if (!isConfigured()) return { ok: false, source: 'local' };
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${_binId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': _apiKey
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error(`JSONBin PUT ${res.status}`);
      return { ok: true, source: 'remote' };
    } catch (err) {
      console.warn('Storage.setData remote failed:', err.message);
      return { ok: false, source: 'local', error: err.message };
    }
  }

  async function testConnection(apiKey, binId) {
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
        headers: { 'X-Master-Key': apiKey, 'X-Bin-Meta': 'false' }
      });
      if (res.status === 200) return { ok: true };
      if (res.status === 401) return { ok: false, msg: 'Invalid API key' };
      if (res.status === 404) return { ok: false, msg: 'Bin not found — check your Bin ID' };
      return { ok: false, msg: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, msg: 'Network error — check CORS or internet' };
    }
  }

  function _emptyData() {
    return { leads: [], templates: [] };
  }

  function exportJson(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `crm-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { init, isConfigured, getData, setData, testConnection, loadSettings, saveSettings, exportJson };
})();
