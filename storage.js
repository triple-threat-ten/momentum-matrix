// storage.js — localStorage only. Depends on logic.js (getTier). Uses globals from app.js.

const STORAGE_KEY = 'mm_tasks_v1';
const INBOX_KEY   = 'mm_inbox_v1';

// v26: fields dropped from the data model (spec §8). Ignored on load, never written back.
const DROPPED_FIELDS = ['agency', 'context', 'links', 'urgencyAckedAt'];

// ─── STORAGE TOAST ───────────────────────────────────────────────────────────

let _toastTimer = null;
function showStorageToast(msg) {
  const el = document.getElementById('storageToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 5000);
}

// ─── MIGRATION ───────────────────────────────────────────────────────────────

// Fills any fields missing from tasks saved before they were introduced.
// Safe to run on every load — only patches what is absent.
function migrateTask(t) {
  if (!t.id)        t.id        = Date.now() + Math.random();
  if (!t.name)      t.name      = 'Untitled';
  if (t.i == null)  t.i         = 5;
  if (t.u == null)  t.u         = 5;
  if (t.s == null)  t.s         = 3;
  if (t.sc == null) t.sc        = calcScore(t.i, t.u, t.s);
  t.tier    = getTier(t.sc);
  if (t.done     == null)  t.done      = false;
  if (!t.bricks)           t.bricks    = [];
  if (!t.createdAt)        t.createdAt = Date.now();
  if (t.doneAt   == null)  t.doneAt    = null;
  if (!t.views)            t.views     = [];
  if (!t.edits)            t.edits     = [];
  if (t.note     == null)  t.note      = '';
  if (!t.planned)          t.planned   = [];
  // v26: urgency clock. We can't tell which past edits changed Urgency,
  // so the most recent of createdAt and any edit is used (spec §8).
  if (!t.urgencySetAt) {
    const edits = t.edits.filter(Number.isFinite);
    t.urgencySetAt = Math.max(t.createdAt, ...edits);
  }
  DROPPED_FIELDS.forEach(k => { delete t[k]; });
  return t;
}

// Copy of a task as it should be persisted — never carries dropped fields,
// even if app.js still sets them in memory during the v26 transition.
function serializeTask(t) {
  const out = { ...t };
  DROPPED_FIELDS.forEach(k => { delete out[k]; });
  return out;
}

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────

function save() {
  try {
    const payload = JSON.stringify(tasks.map(serializeTask));
    // Warn if approaching the typical 5MB localStorage limit (~4.5MB threshold)
    if ((payload.length + JSON.stringify(inbox).length) > 4_500_000) {
      showStorageToast('⚠ Your data is getting very large — consider exporting a backup.');
    }
    localStorage.setItem(STORAGE_KEY, payload);
    localStorage.setItem(INBOX_KEY, JSON.stringify(inbox));
  } catch(e) {
    console.error('[MM] save failed:', e);
    showStorageToast('⚠ Could not save — storage may be full or blocked. Export your data now.');
  }
}

function load() {
  try {
    const t = localStorage.getItem(STORAGE_KEY), i = localStorage.getItem(INBOX_KEY);
    if (t) tasks = JSON.parse(t).map(migrateTask);
    if (i) inbox = JSON.parse(i);
    rebuildTaskMap();
  } catch(e) {
    console.error('[MM] load failed:', e);
    showStorageToast('⚠ Could not read saved data — your browser may be blocking storage.');
  }
}

function clearSave() {
  localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(INBOX_KEY);
  tasks = []; inbox = []; activeId = null;
  rebuildTaskMap();
  render(); renderInbox();
}

function exportData() {
  const url = URL.createObjectURL(new Blob(
    [JSON.stringify({ version:1, exportedAt:new Date().toISOString(), tasks:tasks.map(serializeTask), inbox }, null, 2)],
    { type:'application/json' }
  ));
  Object.assign(document.createElement('a'), { href:url, download:`halo-${new Date().toISOString().slice(0,10)}.json` }).click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const payload = JSON.parse(e.target.result);
      if (payload.version && payload.version > 1) { alert('This export was created by a newer version of HALO°. Please update the app before importing.'); return; }
      const importedTasks = Array.isArray(payload) ? payload : (payload.tasks || []);
      const importedInbox = Array.isArray(payload) ? []      : (payload.inbox  || []);
      if (!importedTasks.length && !importedInbox.length) { alert('Nothing to import — file appears empty or unrecognised.'); return; }
      const msg = `Import ${importedTasks.length} task(s) and ${importedInbox.length} inbox item(s)? This will replace your current tasks.`;
      mmConfirm(msg, () => {
        tasks = importedTasks.map(migrateTask);
        inbox = importedInbox; activeId = null;
        rebuildTaskMap();
        save(); render(); renderInbox();
      });
    } catch(err) { alert('Could not read file. Make sure it is a valid HALO° export.'); }
    event.target.value = '';
  };
  reader.readAsText(file);
}
