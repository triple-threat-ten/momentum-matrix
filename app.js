// app.js — DOM, rendering, events, state. Depends on logic.js + storage.js.


// ─── STATE ───────────────────────────────────────────────────────────────────

let tasks = [], inbox = [];
let activeId = null, addingBrick = false, expandedBrickId = null;
let panelMode = 'view'; // 'view' | 'create' | 'triage'
let panelTriageQueue = [], panelTriageIdx = 0;
// Main screen state (v26 Contexts) — the mode is never persisted (spec §4.3)
let currentMode    = 'balanced';
let foldOpen       = false;
let heroPickerId   = null;   // task whose inline duration picker is open in the #1 card
let captureOpen    = false;

let doneModalZone = null, trophyTaskId = null;

// ── Timer state ──
let timerTaskId        = null;  // id of task currently being timed
let timerEndsAt        = null;  // absolute ms when block ends
let timerDuration      = null;  // total block ms
let timerPaused        = false;
let timerPauseLeft     = null;  // ms remaining when paused
let timerTick          = null;  // setInterval handle
let timerSelectedMins  = 25;    // last-used preset (persists across opens)
let searchActive = false, searchSelectedIdx = -1, searchResults = [];

const SLIDERS_EDIT = { impId:'eImp', urgId:'eUrg', simId:'eSim', impWord:'eImpWord', urgWord:'eUrgWord', simWord:'eSimWord', impDim:'eimp', urgDim:'eurg', simDim:'esim' };

// Score orb rendering geometry
const ORB_RING_R = 44;
const ORB_CIRC   = 2 * Math.PI * ORB_RING_R;
const ORB_MIN_R  = 8;
const ORB_MAX_R  = 38;

// IMP_WORDS, URG_WORDS, SIM_WORDS, TIER_UI, TIER_HEX, tierUI → copy.js

// ─── DELTA FORMATTER ─────────────────────────────────────────────────────────
function formatDelta(delta) {
  const AXIS_WORDS = { i:IMP_WORDS, u:URG_WORDS, s:SIM_WORDS };
  return Object.entries(delta)
    .map(([ax, [from, to]]) => `${AXIS_NAME[ax]}  ${AXIS_WORDS[ax][from]} → ${AXIS_WORDS[ax][to]}`)
    .join('  ·  ');
}

// ─── DOM HELPERS ─────────────────────────────────────────────────────────────

const g = id => document.getElementById(id);

// In-app confirm — replaces native confirm() which some browsers suppress
function mmConfirm(message, onOk) {
  const overlay = g('confirmOverlay');
  g('confirmMessage').textContent = message;
  overlay.classList.remove('hidden');
  const ok     = g('confirmOk');
  const cancel = g('confirmCancel');
  function close() {
    overlay.classList.add('hidden');
    ok.removeEventListener('click', handleOk);
    cancel.removeEventListener('click', handleCancel);
  }
  function handleOk()     { close(); onOk(); }
  function handleCancel() { close(); }
  ok.addEventListener('click', handleOk);
  cancel.addEventListener('click', handleCancel);
}

// O(1) task lookup — kept in sync with the tasks array at every mutation site.
let taskMap = new Map();
function rebuildTaskMap() { taskMap = new Map(tasks.map(t => [t.id, t])); }
const byId = id => taskMap.get(id);

// Single choke point for all task mutations.
// Guarantees taskMap and localStorage stay in sync after every change.
function commitTask(fn) { fn(); rebuildTaskMap(); save(); }

function openModal(id)  { g(id).classList.remove('hidden'); }
function closeModal(id) { g(id).classList.add('hidden'); }

// Attach a capture-phase Escape listener to an overlay element.
// Fires before the global keydown handler — stops propagation so only the
// topmost visible layer responds. Attach once at boot; guard on hidden state.
function onEscapeCapture(overlayId, closeFn) {
  g(overlayId).addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (g(overlayId).classList.contains('hidden')) return;
    e.stopPropagation();
    closeFn();
  }, true);
}
// Re-render the main screen after a change that may affect one task's row or card.
// (Kept under its old name so existing callers in the panel keep working.)
function renderBoardCard() { renderMain(); }

// ─── SCORE ORB ───────────────────────────────────────────────────────────────

function renderOrb(ids, sc, tierKey) {
  const frac = sc / 100, col = TIER_HEX[tierKey] || '#6366F1';
  const c = g(ids.circle); if (!c) return;
  c.setAttribute('r',       (ORB_MIN_R + (ORB_MAX_R - ORB_MIN_R) * frac).toFixed(1));
  c.setAttribute('fill',    col);
  c.setAttribute('opacity', (0.12 + 0.18 * frac).toFixed(2));
  const r = g(ids.ring);
  r.setAttribute('stroke-dashoffset', (ORB_CIRC * (1 - frac)).toFixed(1));
  r.setAttribute('stroke', col);
  const n = g(ids.num);
  n.setAttribute('font-size', 20 + Math.round(14 * frac));
  n.setAttribute('fill', sc > 0 ? col : '#8B90A0');
  n.textContent = sc > 0 ? sc : '—';
}

function updateOrb(sc, k)       { renderOrb({ circle:'scoreOrbCircle', ring:'scoreOrbRing', num:'scoreOrbNum' }, sc, k); }
function updatePanelOrb(sc, k)  { renderOrb({ circle:'pOrbCircle',     ring:'pOrbRing',     num:'pOrbNum'     }, sc, k); }

// ─── SLIDERS ─────────────────────────────────────────────────────────────────

function paintTrack(id, v, color) {
  const el = g(id); if (!el) return;
  const pct = ((v-1)/3)*100;
  el.style.background = `linear-gradient(to right,${color} 0%,${color} ${pct}%,var(--border2) ${pct}%,var(--border2) 100%)`;
  el.style.setProperty('--thumb-color', color);
}

function highlightTicks(dim, v, color) {
  document.querySelectorAll(`.cslider-tick[data-dim="${dim}"]`).forEach(t => {
    const on = +t.dataset.val === v;
    t.classList.toggle('active', on); t.style.color = on ? color : '';
  });
}

function paintSliders(cfg, i, u, s) {
  [[cfg.impId,i,'var(--fire)',    cfg.impWord,IMP_WORDS,cfg.impDim],
   [cfg.urgId,u,'var(--activate)',cfg.urgWord,URG_WORDS,cfg.urgDim],
   [cfg.simId,s,'var(--latent)',  cfg.simWord,SIM_WORDS,cfg.simDim],
  ].forEach(([id,val,color,wordId,words,dim]) => {
    const el = g(id); if (el) el.value = val;
    paintTrack(id, val, color);
    const w = g(wordId); if (w) w.textContent = words[val];
    highlightTicks(dim, val, color);
  });
}

// ─── TEXTAREAS ───────────────────────────────────────────────────────────────

function autoResize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

// ─── CREATE / TRIAGE VIA PANEL ───────────────────────────────────────────────

function _panelCreateDefaults() {
  const sc = calcScore(2, 2, 3), tier = getTier(sc);
  updatePanelOrb(sc, tier.key);
  g('pTier').textContent = tierUI(tier.key).label; g('pTier').style.color = tierUI(tier.key).color;
  g('pNudge').textContent = tierUI(tier.key).nudge;
  g('eImp').value = 2; g('eUrg').value = 2; g('eSim').value = 3;
  g('eImpWord').textContent = IMP_WORDS[2]; g('eUrgWord').textContent = URG_WORDS[2]; g('eSimWord').textContent = SIM_WORDS[3];
  paintTrack('eImp', 2, 'var(--fire)'); paintTrack('eUrg', 2, 'var(--activate)'); paintTrack('eSim', 3, 'var(--latent)');
  highlightTicks('eimp', 2, 'var(--fire)'); highlightTicks('eurg', 2, 'var(--activate)'); highlightTicks('esim', 3, 'var(--latent)');
  g('pScoreBar').classList.remove('visible');
  g('pFormulaHint').classList.remove('visible');
  g('pCtxProgress').classList.add('hidden');   // no bricks before the task exists
  g('panelMenuWrap').classList.add('hidden');
}

function _panelCreateResetTabs() {
  if (activePanelTab) {
    const prev = g('pTab' + cap(activePanelTab)); if (prev) prev.classList.add('hidden');
    const btn  = g('pCtx' + cap(activePanelTab)); if (btn)  btn.setAttribute('aria-pressed','false');
    activePanelTab = null;
  }
}

function openPanelCreate(name) {
  panelMode = 'create'; activeId = null; addingBrick = false;
  _panelCreateResetTabs();
  _panelCreateDefaults();
  const noteEl = g('pNote'); noteEl.value = ''; noteEl.style.height = 'auto';
  const nameEl = g('pNameInput'); nameEl.value = name || ''; setTimeout(() => autoResize(nameEl), 0);
  g('panelTriageBar').classList.add('hidden');
  g('btnPanelTriageSkip').classList.remove('hidden');
  g('btnPanelTriageDel').classList.add('hidden');
  g('btnPanelCreateDel').classList.remove('hidden');
  pfShow('create');
  openModal('overlay');
  openPanelTab('score');
  setTimeout(() => { const el = g('pNameInput'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 60);
}

function openTriage() {
  if (!inbox.length) return;
  panelTriageQueue = [...inbox]; panelTriageIdx = 0;
  _openPanelTriageCard();
}

function openTriageFor(id) {
  const item = inbox.find(t => t.id === id); if (!item) return;
  panelTriageQueue = [item, ...inbox.filter(t => t.id !== id)]; panelTriageIdx = 0;
  _openPanelTriageCard();
}

function _openPanelTriageCard() {
  const item = panelTriageQueue[panelTriageIdx]; if (!item) { closePanel(); renderInbox(); return; }
  panelMode = 'triage'; activeId = null; addingBrick = false;
  _panelCreateResetTabs();
  _panelCreateDefaults();
  const nameEl = g('pNameInput'); nameEl.value = item.name; setTimeout(() => autoResize(nameEl), 0);
  const noteEl = g('pNote'); noteEl.value = item.note || ''; setTimeout(() => autoResize(noteEl), 0);
  g('panelTriageBar').classList.remove('hidden');
  g('panelTriageProgress').textContent = panelTriageQueue.length > 1 ? `${panelTriageIdx + 1} of ${panelTriageQueue.length}` : '';
  g('panelTriageAge').textContent = TRIAGE_CAPTURED(fmtAgo(item.capturedAt));
  g('btnPanelTriageSkip').classList.remove('hidden');
  g('btnPanelTriageDel').classList.remove('hidden');
  g('btnPanelCreateDel').classList.add('hidden');
  pfShow('create');
  openModal('overlay');
  openPanelTab('score');
  setTimeout(() => { const el = g('pNameInput'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 60);
}

function addTaskFromPanel() {
  const name = (g('pNameInput').value || '').trim(); if (!name) { g('pNameInput').focus(); return; }
  const i = +g('eImp').value, u = +g('eUrg').value, s = +g('eSim').value;
  const note = g('pNote').value || '';
  if (panelMode === 'triage') {
    const item = panelTriageQueue[panelTriageIdx]; if (!item) return;
    commitTask(() => {
      tasks.push(makeTask(item.id, name, i, u, s, note, item.capturedAt));
      inbox = inbox.filter(t => t.id !== item.id);
    });
    panelTriageQueue.splice(panelTriageIdx, 1);
    render(); renderInbox();
    if (panelTriageQueue.length) { panelTriageIdx = Math.min(panelTriageIdx, panelTriageQueue.length - 1); _openPanelTriageCard(); }
    else closePanel();
  } else {
    const newId = Date.now();
    commitTask(() => tasks.push(makeTask(newId, name, i, u, s, note, newId)));
    g('quickInput').value = '';
    closePanel(); render();
  }
}

function panelTriageSkip() {
  if (panelMode === 'create') {
    const name = (g('pNameInput').value || '').trim();
    if (name) { const id = Date.now(); inbox.push({ id, name, note: g('pNote').value || '', capturedAt: id }); save(); }
    closePanel(); renderInbox(); return;
  }
  if (panelTriageQueue.length <= 1) { closePanel(); renderInbox(); return; }
  panelTriageIdx = (panelTriageIdx + 1) % panelTriageQueue.length;
  _openPanelTriageCard();
}

function panelCreateDelete() {
  closePanel();
}

function panelTriageDelete() {
  const item = panelTriageQueue[panelTriageIdx]; if (!item) return;
  inbox = inbox.filter(t => t.id !== item.id); save(); renderInbox();
  panelTriageQueue.splice(panelTriageIdx, 1);
  if (panelTriageQueue.length) { panelTriageIdx = Math.min(panelTriageIdx, panelTriageQueue.length - 1); _openPanelTriageCard(); }
  else closePanel();
}

// ─── TASK CRUD ───────────────────────────────────────────────────────────────

// New tasks start their urgency clock now — also when triaged from an older inbox item (§5.4)
function makeTask(id, name, i, u, s, note, createdAt) {
  const sc = calcScore(i, u, s);
  return { id, name, i, u, s, sc, tier:getTier(sc), done:false, bricks:[], planned:[], createdAt, urgencySetAt:Date.now(), doneAt:null, views:[], edits:[], note };
}

function deleteTask(id) {
  if (timerTaskId === id) timerStopSilent();
  commitTask(() => { tasks = tasks.filter(t => t.id !== id); });
  if (activeId === id) closePanel();
  render();
}

function toggleDone(id) {
  const t = byId(id); if (!t) return;
  const wasDone = t.done;
  commitTask(() => { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; });
  if (!wasDone) {
    // Task just marked done — animate its row/card out, then re-rank
    const els = document.querySelectorAll(`.ctx-main [data-task-id="${id}"]`);
    if (els.length) {
      els.forEach(el => { el.style.animation = 'doneOut .3s ease forwards'; el.style.pointerEvents = 'none'; });
      setTimeout(render, 300);
      return;
    }
  }
  render();
}

function applyNewScore(id, i, u, s) {
  const t = byId(id); if (!t) return;
  commitTask(() => {
    t.i = i; t.u = u; t.s = s; t.sc = calcScore(i, u, s); t.tier = getTier(t.sc);
    t.urgencySetAt = Date.now();
    if (!t.edits) t.edits = []; t.edits.push(Date.now());
  });
  render();
}

// ─── BRICKS ──────────────────────────────────────────────────────────────────

function addBrick(id, text) {
  const t = byId(id); if (!t || !text?.trim()) return;
  commitTask(() => t.bricks.push({ id:Date.now() + Math.random(), text:text.trim(), ts:Date.now() }));
  addingBrick = false;
  renderBoardCard(id);
  openPanel(id);
}

function deleteBrick(taskId, brickId) {
  const t = byId(taskId); if (!t) return;
  commitTask(() => { t.bricks = t.bricks.filter(b => String(b.id) !== String(brickId)); });
  renderBoardCard(taskId);
  openPanel(taskId);
}

function addPlanned(taskId, text) {
  text = text.trim(); if (!text) return;
  const t = byId(taskId); if (!t) return;
  commitTask(() => { t.planned.push({ id: Date.now() + Math.random(), text }); });
  renderPanelContent(taskId);
}

function deletePlanned(taskId, plannedId) {
  const t = byId(taskId); if (!t) return;
  commitTask(() => { t.planned = t.planned.filter(p => String(p.id) !== String(plannedId)); });
  renderPanelContent(taskId);
}

function promotePlanned(taskId, plannedId) {
  const t = byId(taskId); if (!t) return;
  const item = t.planned.find(p => String(p.id) === String(plannedId)); if (!item) return;
  commitTask(() => {
    t.bricks.push({ id: Date.now() + Math.random(), text: item.text, ts: Date.now() });
    t.planned = t.planned.filter(p => String(p.id) !== String(plannedId));
  });
  renderBoardCard(taskId);
  renderPanelContent(taskId);
}

// ─── INBOX ───────────────────────────────────────────────────────────────────

function quickCapture() {
  const el = g('quickInput'), name = el.value.trim(); if (!name) return;
  inbox.push({ id:Date.now() + Math.random(), name, capturedAt:Date.now() });
  el.value = ''; save(); renderInbox();
}

function deleteInboxItem(id) { inbox = inbox.filter(t => t.id !== id); save(); renderInbox(); }

function renderInbox() {
  const btn = g('btnInbox'), count = g('inboxCount'); if (!btn || !count) return;
  count.textContent = inbox.length;
  btn.classList.toggle('hidden', inbox.length === 0);
  btn.classList.toggle('stale', inbox.some(t => Date.now() - t.capturedAt > 7 * DAY_MS));
}

// ─── PANEL ACCORDION ─────────────────────────────────────────────────────────

const PANEL_TABS = ['score', 'progress'];
let activePanelTab = null;
const cap = k => k.charAt(0).toUpperCase() + k.slice(1);

function openPanelTab(key) {
  if (activePanelTab === key) {
    g('pTab' + cap(key)).classList.add('hidden');
    g('pCtx' + cap(key)).setAttribute('aria-pressed', 'false');
    activePanelTab = null;
    return;
  }
  if (activePanelTab) {
    g('pTab' + cap(activePanelTab)).classList.add('hidden');
    g('pCtx' + cap(activePanelTab)).setAttribute('aria-pressed', 'false');
  }
  activePanelTab = key;
  g('pTab' + cap(key)).classList.remove('hidden');
  g('pCtx' + cap(key)).setAttribute('aria-pressed', 'true');
}

function updatePanelCtxBar(t) {
  if (!t) return;
  const sv = g('pCtxScoreVal');    if (sv) sv.textContent = t.sc;
  const bv = g('pCtxProgressVal'); if (bv) bv.textContent = (t.bricks || []).length;
}

// ─── PANEL ───────────────────────────────────────────────────────────────────

function openPanel(id) {
  activeId = id; addingBrick = false; expandedBrickId = null;
  panelMode = 'view';
  g('pCtxProgress').classList.remove('hidden');
  g('panelMenuWrap').classList.remove('hidden');
  g('panelTriageBar').classList.add('hidden');
  // Reset tab state so auto-select always opens fresh
  if (activePanelTab) {
    const prevTab = g('pTab' + cap(activePanelTab)); if (prevTab) prevTab.classList.add('hidden');
    const prevBtn = g('pCtx' + cap(activePanelTab)); if (prevBtn) prevBtn.setAttribute('aria-pressed', 'false');
    activePanelTab = null;
  }
  const t = byId(id); if (t) { if (!t.views) t.views = []; t.views.push(Date.now()); }
  openModal('overlay'); renderPanelContent(id);
  timerSyncFooter(id);  // show running state only if THIS task is timed
  // Auto-open the most informative tab
  const defaultTab = t && t.bricks && t.bricks.length > 0 ? 'progress' : 'score';
  openPanelTab(defaultTab);
}

function closePanel() {
  activeId = null; addingBrick = false;
  panelMode = 'view';
  g('pCtxProgress').classList.remove('hidden');
  g('panelMenuWrap').classList.remove('hidden');
  g('panelTriageBar').classList.add('hidden');
  activePanelTab = null;
  PANEL_TABS.forEach(k => {
    const p = g('pTab' + cap(k)); if (p) p.classList.add('hidden');
    const b = g('pCtx' + cap(k)); if (b) b.setAttribute('aria-pressed', 'false');
  });
  pfShow('idle');
  panelMenuClose();
  closeModal('overlay');
}
function maybeClose(e) { if (e.target === g('overlay')) closePanel(); }
function deletePanel() { if (activeId) deleteTask(activeId); }

// ─── TIMER ENGINE ────────────────────────────────────────────────────────────
// Persists across page refresh via localStorage.

const TIMER_STORAGE_KEY = 'mm_timer';

function timerSave() {
  if (!timerTaskId) { localStorage.removeItem(TIMER_STORAGE_KEY); return; }
  localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify({
    taskId: timerTaskId,
    endsAt: timerEndsAt,
    duration: timerDuration,
    paused: timerPaused,
    pauseLeft: timerPauseLeft,
    selectedMins: timerSelectedMins
  }));
}

function timerRestore() {
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!byId(d.taskId)) { localStorage.removeItem(TIMER_STORAGE_KEY); return; }
    timerTaskId      = d.taskId;
    timerDuration    = d.duration;
    timerSelectedMins = d.selectedMins || 25;
    if (d.paused) {
      timerPaused    = true;
      timerPauseLeft = d.pauseLeft;
      timerEndsAt    = Date.now() + timerPauseLeft;
    } else {
      timerEndsAt    = d.endsAt;
      if (timerEndsAt <= Date.now()) {
        // Block already expired while page was closed — treat as complete
        const doneId = timerTaskId;
        timerTaskId = null; timerEndsAt = null;
        localStorage.removeItem(TIMER_STORAGE_KEY);
        timerShowPrompt(doneId, 'brick');
        return;
      }
      timerTick = setInterval(timerFrame, 500);
    }
    timerSyncAll();
  } catch(e) { localStorage.removeItem(TIMER_STORAGE_KEY); }
}

// ─── #1 CARD INLINE PICKER ("I'm on it") ────────────────────────────────────

function heroShowPicker(taskId) { heroPickerId = taskId; renderMain(); }
function heroHidePicker()       { heroPickerId = null;   renderMain(); }
function heroPickDuration(mins) {
  const taskId = heroPickerId; if (!taskId) return;
  heroPickerId = null;
  timerStart(taskId, mins);
}

function timerStart(taskId, mins) {
  if (timerTaskId && timerTaskId !== taskId) {
    // Conflict — require explicit confirmation before switching
    const runningTask = byId(timerTaskId);
    const newTask = byId(taskId);
    const runningName = runningTask ? runningTask.name : 'current task';
    const newName = newTask ? newTask.name : 'new task';
    mmConfirm(
      CONFIRM_SWITCH_TIMER(runningName, newName),
      () => { timerStopSilent(); timerStartNow(taskId, mins); }
    );
    return;
  }
  timerStartNow(taskId, mins);
}

function timerStartNow(taskId, mins) {
  timerTaskId       = taskId;
  timerDuration     = mins * 60 * 1000;
  timerEndsAt       = Date.now() + timerDuration;
  timerPaused       = false;
  timerPauseLeft    = null;
  timerSelectedMins = mins;
  clearInterval(timerTick);
  timerTick = setInterval(timerFrame, 500);
  timerFrame();
  timerSave();
  timerSyncAll();
}

function timerFrame() {
  if (timerPaused) return;
  const rem = timerEndsAt - Date.now();
  if (rem <= 0) {
    clearInterval(timerTick); timerTick = null;
    timerRenderCountdown(0);
    const doneId = timerTaskId;
    timerTaskId = null; timerEndsAt = null;
    timerSave();
    timerSyncAll();
    timerShowPrompt(doneId, 'brick');
    return;
  }
  timerRenderCountdown(rem);
}

function timerPauseToggle() {
  if (!timerTaskId) return;
  if (timerPaused) {
    timerEndsAt = Date.now() + timerPauseLeft;
    timerPaused = false;
    timerTick = setInterval(timerFrame, 500);
    timerFrame();
  } else {
    timerPauseLeft = timerEndsAt - Date.now();
    timerPaused = true;
    clearInterval(timerTick); timerTick = null;
  }
  timerSave();
  // Update pause button states in both session card and panel footer
  ['pfBtnPause', 'hscBtnPause'].forEach(id => {
    const btn = g(id);
    if (btn) btn.classList.toggle('pf-btn-pause--paused', timerPaused);
  });
}

// Stop with park prompt
function timerStop(silent) {
  clearInterval(timerTick); timerTick = null;
  const stoppedId = timerTaskId;
  timerTaskId = null; timerEndsAt = null; timerPaused = false;
  timerSave();
  timerSyncAll();
  if (!silent && stoppedId) timerShowPrompt(stoppedId, 'park');
}

// Stop silently (used internally before starting another task — no prompt shown)
function timerStopSilent() {
  clearInterval(timerTick); timerTick = null;
  timerTaskId = null; timerEndsAt = null; timerPaused = false;
  timerSave();
  timerSyncAll();
}

function timerRenderCountdown(remainingMs) {
  const secs = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(secs / 60), s = secs % 60;
  const label = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  const pct = timerDuration > 0
    ? Math.round(((timerDuration - remainingMs) / timerDuration) * 100) : 0;
  // Panel footer ring (circumference 100.5)
  const pfc = g('pfCountdown'); if (pfc) pfc.textContent = label;
  const pfr = g('pfRingFg');
  if (pfr) pfr.style.strokeDashoffset = (100.5 * (1 - pct / 100)).toFixed(1);

  // Session card big countdown
  const hmc = g('hmtCountdown'); if (hmc) hmc.textContent = label;
}

// Sync all surfaces to current timer state
function timerSyncAll() {
  const running = timerTaskId !== null;
  const task = running ? byId(timerTaskId) : null;

  // Session card replaces the #1 card while a block runs (spec §5.6)
  const sessionCard = g('haloSessionCard');
  if (sessionCard) sessionCard.style.display = running ? 'block' : 'none';

  if (running && task) {
    const ht = g('hscTask'); if (ht) ht.textContent = task.name;
    if (timerEndsAt) timerRenderCountdown(timerEndsAt - Date.now());
  }

  // Panel footer — only update if panel is open
  if (activeId) timerSyncFooter(activeId);

  // Re-render so the running dot follows the task wherever it appears
  render();
}

// Show correct footer state for currently open task
function timerSyncFooter(taskId) {
  const thisTaskRunning = timerTaskId === taskId;
  pfShow(thisTaskRunning ? 'running' : 'idle');
  if (thisTaskRunning) {
    if (timerEndsAt) timerRenderCountdown(timerEndsAt - Date.now());
    ['pfBtnPause', 'hscBtnPause'].forEach(id => {
      const btn = g(id);
      if (btn) btn.classList.toggle('pf-btn-pause--paused', timerPaused);
    });
  }
  // Highlight last-used duration in idle state
  if (!thisTaskRunning) {
    document.querySelectorAll('.pf-dur').forEach(btn => {
      btn.classList.toggle('pf-dur--last', parseInt(btn.dataset.mins) === timerSelectedMins);
    });
  }
}

function pfShow(state) {
  const ids = { idle:'pfIdle', picking:'pfPicking', running:'pfRunning', create:'pfCreate' };
  Object.entries(ids).forEach(([k, id]) => {
    const el = g(id); if (!el) return;
    el.classList.toggle('pf-state--hidden', k !== state);
  });
}



function timerShowPrompt(taskId, type) {
  const task = byId(taskId); if (!task) return;
  const isBrick = type === 'brick';

  g('timerModalTask').textContent  = task.name;
  g('timerModalTitle').textContent = isBrick ? TIMER_BRICK_TITLE : TIMER_PARK_TITLE;
  g('timerModalSub').textContent   = isBrick ? TIMER_BRICK_SUB   : TIMER_PARK_SUB;
  g('timerModalTa').value          = '';
  g('timerModalTa').placeholder    = isBrick ? TIMER_BRICK_PH    : TIMER_PARK_PH;

  // Show Resume button only for park (early stop), not for brick (block complete)
  const continueBtn = g('timerModalContinue');
  continueBtn.classList.toggle('hidden', isBrick);

  openModal('timerModalOverlay');
  setTimeout(() => g('timerModalTa').focus(), 80);

  // Detach old listeners by replacing buttons
  ['timerModalSkip','timerModalCta','timerModalContinue'].forEach(id => {
    const el = g(id); if (!el) return;
    const clone = el.cloneNode(true);
    el.replaceWith(clone);
  });

  g('timerModalSkip').textContent = TIMER_SKIP_BTN;
  g('timerModalCta').textContent  = isBrick ? TIMER_BRICK_BTN : TIMER_PARK_BTN;

  g('timerModalSkip').addEventListener('click', () => closeModal('timerModalOverlay'));
  g('timerModalCta').addEventListener('click', () => {
    const text = (g('timerModalTa').value || '').trim();
    if (text) addBrick(taskId, text);
    closeModal('timerModalOverlay');
  });
  // Resume: restart the timer for the same task with same duration
  g('timerModalContinue').addEventListener('click', () => {
    closeModal('timerModalOverlay');
    timerStartNow(taskId, timerSelectedMins);
  });
}

function renderPanelContent(id) {
  const t = byId(id); if (!t) return;

  updatePanelCtxBar(t);
  updatePanelOrb(t.sc, t.tier.key);
  g('pScoreBar').classList.remove('visible');
  g('pFormulaHint').classList.remove('visible');
  g('pTier').textContent = tierUI(t.tier.key).label; g('pTier').style.color = tierUI(t.tier.key).color;
  g('pNameInput').value  = t.name;
  setTimeout(() => { const el = g('pNameInput'); if (el) autoResize(el); }, 0);
  g('pNudge').textContent = tierUI(t.tier.key).nudge;
  const noteEl = g('pNote'); noteEl.value = t.note || ''; setTimeout(() => autoResize(noteEl), 0);

  paintSliders(SLIDERS_EDIT, t.i, t.u, t.s);
  g('eImp').value = t.i; g('eUrg').value = t.u; g('eSim').value = t.s;

  // Bricks list
  g('pBricksLabel').style.display = '';
  renderBrickList(t);

  // Brick CTA
  const cta = g('pBrickCta');
  if (addingBrick) {
    cta.innerHTML = `<div class="brick-input-row">
      <input class="brick-input" id="brickInp" type="text" placeholder="${BRICK_PLACEHOLDER}" maxlength="120"/>
      <button class="btn-bsave"   id="btnBrickSave">${BRICK_BTN_SAVE}</button>
      <button class="btn-bcancel" id="btnBrickCancel">${BRICK_BTN_CANCEL}</button>
    </div>`;
    const inp = g('brickInp');
    if (inp) {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { commitBrick(t.id); }
        if (e.key === 'Escape') { addingBrick = false; renderPanelContent(t.id); }
      });
      setTimeout(() => inp.focus(), 20);
    }
    const btnSave   = g('btnBrickSave');   if (btnSave)   btnSave.addEventListener('click', () => commitBrick(t.id));
    const btnCancel = g('btnBrickCancel'); if (btnCancel) btnCancel.addEventListener('click', () => { addingBrick = false; renderPanelContent(t.id); });
  } else if (t.s >= 3) {
    cta.innerHTML = `<span class="brick-link" id="brickLinkCta">+ ${BRICK_NUDGES_EASY[Math.min(t.bricks.length, BRICK_NUDGES_EASY.length-1)]}</span>`;
    const lnk = g('brickLinkCta'); if (lnk) lnk.addEventListener('click', () => { addingBrick = true; renderPanelContent(t.id); });
  } else {
    const nudge = BRICK_NUDGES_HARD[Math.min(t.bricks.length, BRICK_NUDGES_HARD.length-1)];
    cta.innerHTML = `<div class="brick-cta" id="brickCtaCard">
      <div class="brick-cta-text"><div class="brick-cta-h">${nudge.h}</div><div class="brick-cta-s">${nudge.s}</div></div>
      <button class="btn-drop-brick">${BRICK_BTN_DROP}</button>
    </div>`;
    const card = g('brickCtaCard'); if (card) card.addEventListener('click', () => { addingBrick = true; renderPanelContent(t.id); });
  }

  const sick = !t.done && t.bricks.length >= 5;
  const hEl  = g('pBrickHealth');
  if (sick) hEl.textContent = BRICK_HEALTH_MSG(t.bricks.length);
  hEl.classList.toggle('hidden', !sick);

  // Planned bricks (next steps)
  renderPlanned(t);

}

function renderBrickList(t) {
  const el = g('pBrickList'); if (!el) return;
  const bricks = [...t.bricks].reverse(); // newest first
  if (!bricks.length) { el.innerHTML = ''; return; }
  let html = `<ul class="bl-list">`;
  bricks.forEach(b => {
    const isExp = String(b.id) === String(expandedBrickId);
    html += `<li class="bl-row${isExp ? ' bl-expanded' : ''}" data-bid="${b.id}">
      <div class="bl-sq bl-sq-laid"></div>
      <div class="bl-text">${b.text.replace(/</g,'&lt;')}</div>
      <span class="bl-ts">${fmtAgo(b.ts)}</span>
      ${isExp ? `<button class="bl-del" data-bid="${b.id}">Remove</button>` : ''}
    </li>`;
  });
  html += `</ul>`;
  el.innerHTML = html;
  el.querySelectorAll('.bl-row').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      if (e.target.closest('.bl-del')) return;
      const bid = row.dataset.bid;
      expandedBrickId = String(expandedBrickId) === String(bid) ? null : bid;
      renderBrickList(t);
    });
  });
  el.querySelectorAll('.bl-del').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteBrick(t.id, btn.dataset.bid); });
  });
}

function renderPlanned(t) {
  const el = g('pPlanned'); if (!el) return;
  const items = t.planned || [];
  let html = '';
  if (items.length) {
    html += `<div class="bl-divider">↓ steps</div><ul class="bl-list bl-steps">`;
    items.forEach(p => {
      html += `<li class="bl-row bl-step-row" data-pid="${p.id}">
        <button class="bl-sq bl-sq-step" data-pid="${p.id}" title="Done — turns into a brick"></button>
        <div class="bl-body">
          <div class="bl-text">${p.text.replace(/</g,'&lt;')}</div>
        </div>
        <button class="bl-step-del" data-pid="${p.id}" title="Remove">×</button>
      </li>`;
    });
    html += `</ul>`;
  }
  html += `<span class="brick-link step-link" id="stepLinkCta">+ What's the next step?</span>
  <div class="step-input-row hidden" id="stepInputRow">
    <input class="brick-input" id="stepInp" type="text" placeholder="What's the next concrete step?" maxlength="120"/>
    <button class="btn-bsave" id="btnStepSave">Add</button>
    <button class="btn-bcancel" id="btnStepCancel">Cancel</button>
  </div>`;
  el.innerHTML = html;

  el.querySelectorAll('.bl-sq-step').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); promotePlanned(t.id, btn.dataset.pid); });
  });
  el.querySelectorAll('.bl-step-del').forEach(btn => {
    btn.addEventListener('click', () => deletePlanned(t.id, btn.dataset.pid));
  });

  const cta = g('stepLinkCta'), row = g('stepInputRow'), inp = g('stepInp');
  const btnSave = g('btnStepSave'), btnCancel = g('btnStepCancel');
  if (cta) cta.addEventListener('click', () => { cta.classList.add('hidden'); row.classList.remove('hidden'); setTimeout(() => inp && inp.focus(), 20); });
  const doAdd = () => { if (inp && inp.value.trim()) addPlanned(t.id, inp.value); };
  if (btnSave)   btnSave.addEventListener('click', doAdd);
  if (btnCancel) btnCancel.addEventListener('click', () => { row.classList.add('hidden'); cta.classList.remove('hidden'); });
  if (inp)       inp.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); if (e.key === 'Escape') { row.classList.add('hidden'); cta.classList.remove('hidden'); } });
}

function updateEditPreview() {
  const i = +g('eImp').value, u = +g('eUrg').value, s = +g('eSim').value;
  paintSliders(SLIDERS_EDIT, i, u, s);
  if (panelMode === 'create' || panelMode === 'triage') {
    const sc = calcScore(i, u, s), tier = getTier(sc);
    updatePanelOrb(sc, tier.key);
    g('pTier').textContent = tierUI(tier.key).label; g('pTier').style.color = tierUI(tier.key).color;
    g('pNudge').textContent = tierUI(tier.key).nudge;
    return;
  }
  const t = byId(activeId); if (!t) return;
  const newSc = calcScore(i, u, s), newTier = getTier(newSc), delta = newSc - t.sc;
  const changed = i !== t.i || u !== t.u || s !== t.s;
  const bar = g('pScoreBar');
  if (changed) {
    g('pScoreFrom').textContent     = t.sc;          g('pScoreFrom').style.color     = tierUI(t.tier.key).color;
    g('pScoreFromTier').textContent = tierUI(t.tier.key).label;   g('pScoreFromTier').style.color = tierUI(t.tier.key).color;
    g('pScoreTo').textContent       = newSc;          g('pScoreTo').style.color       = tierUI(newTier.key).color;
    g('pScoreToTier').textContent   = tierUI(newTier.key).label;  g('pScoreToTier').style.color = tierUI(newTier.key).color;
    const diff = g('pScoreDiff');
    diff.textContent = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`;
    diff.className   = `psb-diff ${delta === 0 ? 'delta-same' : delta > 0 ? 'delta-up' : 'delta-down'}`;
    bar.classList.add('visible');
    const hints = [];
    if (s !== t.s) hints.push(s > t.s ? FORMULA_HINTS.s_up : FORMULA_HINTS.s_down);
    if (i !== t.i) hints.push(i > t.i ? FORMULA_HINTS.i_up : FORMULA_HINTS.i_down);
    if (u !== t.u) hints.push(u > t.u ? FORMULA_HINTS.u_up : FORMULA_HINTS.u_down);
    const hintEl = g('pFormulaHint');
    if (hints.length) { hintEl.textContent = hints[0]; hintEl.classList.add('visible'); } else hintEl.classList.remove('visible');
  } else {
    bar.classList.remove('visible'); g('pFormulaHint').classList.remove('visible');
  }
}

function applyScoreEdit() {
  if (!activeId) return;
  applyNewScore(activeId, +g('eImp').value, +g('eUrg').value, +g('eSim').value);
  renderPanelContent(activeId);
}

function commitNameEdit() {
  const t = byId(activeId); if (!t) return;
  const inp = g('pNameInput'), name = inp?.value.trim();
  if (name && name !== t.name) {
    commitTask(() => { t.name = name; });
    renderBoardCard(activeId);
    renderPanelContent(activeId);
  } else if (!name && inp) { inp.value = t.name; autoResize(inp); }
}

function commitNoteEdit() {
  const t = byId(activeId); if (!t) return;
  const el = g('pNote'); if (!el) return;
  if (el.value !== (t.note || '')) {
    commitTask(() => { t.note = el.value; });
    renderBoardCard(activeId);
  }
}

function commitBrick(id) {
  const inp = g('brickInp'), text = inp?.value.trim();
  if (!text) {
    if (inp) {
      inp.style.borderColor = 'var(--fire)'; inp.placeholder = BRICK_PLACEHOLDER_ERROR;
      setTimeout(() => { inp.style.borderColor = ''; inp.placeholder = BRICK_PLACEHOLDER; }, 2000);
    }
    return;
  }
  addBrick(id, text);
}

// ─── DONE MODAL ──────────────────────────────────────────────────────────────

function openDoneModal(zone) {
  doneModalZone = zone || 'all';
  const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)); if (!done.length) return;
  const c = CONGRATS[Math.min(Math.floor(done.length / 2), CONGRATS.length - 1)];
  g('doneEmoji').textContent    = c.emoji;
  g('doneCongrats').textContent = c.h;
  g('doneSub').textContent      = `${c.s} · ${done.length} task${done.length > 1 ? 's' : ''} done.`;
  g('doneTaskList').innerHTML   = done.map((t, i) => `
    <div class="done-task-row" style="animation-delay:${i*.04}s">
      <span class="done-task-check">✓</span>
      <span class="done-task-name" data-action="open-trophy" data-id="${t.id}">${esc(t.name)}</span>
      ${t.bricks.length ? `<span class="done-task-bricks">🧱 ${t.bricks.length}</span>` : ''}
      <span class="done-task-score">${t.sc}</span>
      <button class="done-task-reopen" data-action="reopen-from-done" data-id="${t.id}">${DONE_REOPEN_BTN}</button>
    </div>`).join('');
  openModal('doneModalOverlay');
}

function reopenFromDone(id) { toggleDone(id); closeDoneModal(); }
function closeDoneModal()   { closeModal('doneModalOverlay'); doneModalZone = null; }
function maybeDoneClose(e)  { if (e.target === g('doneModalOverlay')) closeDoneModal(); }

// ─── TROPHY ──────────────────────────────────────────────────────────────────

function openTrophy(id) {
  const t = byId(id); if (!t) return; trophyTaskId = id;
  const msg = TROPHY_MSGS[Math.floor(Math.random() * TROPHY_MSGS.length)];
  g('trEmoji').textContent   = msg.emoji;
  g('trHeading').textContent = msg.h;
  g('trTask').textContent    = t.name;
  const ls = t.doneAt ? t.doneAt - t.createdAt : 0;
  g('trSub').textContent = ls > 0 ? TROPHY_SUB_DONE(fmtDuration(ls), t.sc) : TROPHY_SUB_NODONE(t.sc, tierUI(t.tier.key).label);
  g('trKpis').innerHTML = `
    <div class="trophy-kpi"><div class="trophy-kpi-val" style="color:var(--latent)">${ls > 0 ? fmtDuration(ls) : '—'}</div><div class="trophy-kpi-label">${TROPHY_KPI_TIME}</div></div>
    <div class="trophy-kpi"><div class="trophy-kpi-val" style="color:var(--brick)">${t.bricks.length}</div><div class="trophy-kpi-label">${TROPHY_KPI_BRICKS}</div></div>
    <div class="trophy-kpi"><div class="trophy-kpi-val" style="color:${tierUI(t.tier.key).color}">${t.sc}</div><div class="trophy-kpi-label">${TROPHY_KPI_SCORE}</div></div>`;
  const events = [
    { ts:t.createdAt, label:'Created', color:'#8B90A0' },
    ...(t.edits||[]).map(ts => ({ ts, label:'Scored',  color:'#F59E0B' })),
    ...t.bricks.map(b => ({ ts:b.ts, label:b.text.length > 18 ? b.text.slice(0,16)+'…' : b.text, color:'#7C6FF7' })),
    ...(t.doneAt ? [{ ts:t.doneAt, label:'Done ✓', color:'#2DD4BF' }] : []),
  ].sort((a,b) => a.ts - b.ts);
  renderTimeline(events, t.createdAt, t.doneAt || Date.now());
  g('trBricks').innerHTML = !t.bricks.length
    ? `<div class="trophy-no-bricks">${TROPHY_NO_BRICKS}</div>`
    : t.bricks.map(b => `<div class="trophy-brick-row"><span class="trophy-brick-icon">🧱</span><span class="trophy-brick-text">${esc(b.text)}</span><span class="trophy-brick-age">${fmtAgo(b.ts)}</span></div>`).join('');
  openModal('trophyOverlay');
}

function renderTimeline(events, startTs, endTs) {
  const W=396, H=64, PAD=18, r=6, span=Math.max(endTs-startTs,1), midY=H/2;
  const xFor = ts => PAD + ((ts-startTs)/span) * (W-PAD*2);
  const placed = [];
  events.forEach(ev => {
    const x = xFor(ev.ts), last = placed[placed.length-1];
    if (last && Math.abs(x-last.x) < r*2.5) last.x += r*1.4;
    placed.push({ ...ev, x });
  });
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="timeline-svg-wrap" style="width:100%;display:block;">`;
  svg += `<rect x="${PAD}" y="${midY-1}" width="${W-PAD*2}" height="2" rx="1" fill="#D8DCE8"/>`;
  if (events.length > 1) {
    svg += `<rect x="${placed[0].x}" y="${midY-1}" width="${placed[placed.length-1].x-placed[0].x}" height="2" rx="1" fill="url(#tl-grad)"/>`;
    svg += `<defs><linearGradient id="tl-grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#8B90A0"/><stop offset="100%" stop-color="#2DD4BF"/></linearGradient></defs>`;
  }
  placed.forEach((ev, i) => {
    const top=i%2===0, y1=top?midY-r:midY+r, lY=top?midY-r-14:midY+r+14;
    svg += `<line x1="${ev.x}" y1="${y1}" x2="${ev.x}" y2="${top?y1-6:y1+6}" stroke="${ev.color}" stroke-width="1" opacity=".5"/>`;
    svg += `<circle cx="${ev.x}" cy="${midY}" r="${r}" fill="${ev.color}" stroke="#FFFFFF" stroke-width="2"/>`;
    svg += `<text x="${ev.x}" y="${lY}" text-anchor="middle" font-size="8" font-family="JetBrains Mono,monospace" fill="#8B90A0" letter-spacing="0.04em">${ev.label}</text>`;
  });
  g('trTimeline').innerHTML = svg + '</svg>';
}

function closeTrophy()      { closeModal('trophyOverlay'); trophyTaskId = null; }
function maybeTrophyClose(e){ if (e.target === g('trophyOverlay')) closeTrophy(); }
function reopenFromTrophy() {
  const t = byId(trophyTaskId); if (!t) return;
  commitTask(() => { t.done = false; t.doneAt = null; });
  closeTrophy(); closeDoneModal(); render();
}

// ─── DRIFT BOX (spec §5.3) ───────────────────────────────────────────────────
// One card at a time: "How urgent is it now?" — one tap re-rates and moves on.

let dbQueue    = [];          // task ids in review order, frozen when the box opens
let dbHandled  = new Set();   // ids answered while the box is open
let dbSeeAll   = false;       // mobile: "See all N" list expanded
let dbOpener   = null;        // element to give focus back to on close
const dbReviewed = new Set(); // reviewed this session — not shown again until the app is reopened

function driftBoxCounts() {
  const active = tasks.filter(t => !t.done);
  return {
    slipping: active.filter(t => !isDrifted(t) && (slipRatio(t) ?? 0) > 1).length,
    drifted:  active.filter(isDrifted).length,
  };
}

function updateDriftBoxBadge() {
  const { slipping, drifted } = driftBoxCounts();
  const el = g('driftBoxCount'); if (el) el.textContent = DRIFT_BTN_COUNTS(slipping, drifted);
  const btn = g('btnDriftBox'); if (btn) btn.classList.toggle('is-empty', slipping + drifted === 0);
}

const driftBoxIsOpen = () => !g('driftBoxOverlay').classList.contains('hidden');

// focusId: open on that task first (used by a Slipping badge)
function openDriftBox(focusId) {
  dbOpener = document.activeElement;
  dbQueue  = driftQueue(tasks, Date.now(), dbReviewed).map(t => t.id);
  if (focusId && dbQueue.includes(focusId)) dbQueue = [focusId, ...dbQueue.filter(id => id !== focusId)];
  dbHandled = new Set(); dbSeeAll = false;
  renderDriftBox();
  openModal('driftBoxOverlay');
  requestAnimationFrame(() => g('driftBoxOverlay').classList.add('is-open'));
  dbFocusCard();
}

function closeDriftBox() {
  if (!driftBoxIsOpen()) return;
  g('driftBoxOverlay').classList.remove('is-open');
  closeModal('driftBoxOverlay');
  if (dbOpener && document.contains(dbOpener)) dbOpener.focus();
}
function maybeCloseDriftBox(e) { if (e.target === g('driftBoxOverlay')) closeDriftBox(); }

// Tasks still waiting for an answer (skips anything completed or deleted elsewhere)
function dbPending() { return dbQueue.filter(id => !dbHandled.has(id) && byId(id) && !byId(id).done); }

function dbFocusCard() {
  setTimeout(() => {
    const body = g('driftBoxBody');
    const b = body.querySelector('.db-card .db-urg.is-current') || body.querySelector('.db-card .db-urg, .db-end-close');
    if (b) b.focus();
  }, 40);
}

function dbReasonHtml(t) {
  if (isDrifted(t)) return `<span class="db-reason db-reason-drifted">${REASON_DRIFTED}</span>`;
  const lvl = slipLevel(t) || 'amber';
  return `<span class="db-reason slip-${lvl}">${esc(urgencyAgeLabel(t) || '')}</span>`;
}

function dbUrgButtonsHtml(t, cls) {
  return [1, 2, 3, 4].map(u => `<button class="${cls}${t.u === u ? ' is-current' : ''}" data-action="db-rate" data-id="${t.id}" data-u="${u}"
    aria-pressed="${t.u === u}"${cls === 'db-mini' ? ` aria-label="${URG_WORDS[u]} — ${esc(t.name)}"` : ''}>${URG_WORDS[u]}</button>`).join('');
}

function renderDriftBox() {
  const body = g('driftBoxBody'); if (!body) return;
  const pending = dbPending();
  if (!pending.length) {
    body.innerHTML = `<div class="db-end">
      <div class="db-end-mark" aria-hidden="true">✓</div>
      <div class="db-end-title">${DB_END_TITLE}</div>
      <div class="db-end-sub">${DB_END_SUB}</div>
      <button class="db-end-close" data-action="db-close">${DB_CLOSE}</button>
    </div>`;
    return;
  }
  const total = dbQueue.length, pos = total - pending.length + 1;
  const t = byId(pending[0]), rest = pending.slice(1).map(byId);
  body.innerHTML = `
    <div class="db-progress" aria-label="${DB_PROGRESS(pos, total)}">
      <div class="db-progress-bar"><i style="width:${((pos - 1) / total * 100).toFixed(1)}%"></i></div>
      <span class="db-progress-text">${DB_PROGRESS(pos, total)}</span>
    </div>
    <article class="db-card" data-task-id="${t.id}">
      <h3 class="db-card-title">${esc(t.name)}</h3>
      ${dbReasonHtml(t)}
      <div class="db-question" id="dbQuestion">${DB_QUESTION}</div>
      <div class="db-urgs" role="group" aria-labelledby="dbQuestion">${dbUrgButtonsHtml(t, 'db-urg')}</div>
      <div class="db-secondary">
        <button class="db-link db-link-done" data-action="db-done" data-id="${t.id}">${DB_DONE}</button>
        <span class="db-sep" aria-hidden="true">·</span>
        <button class="db-link db-link-letgo" data-action="db-letgo" data-id="${t.id}">${DB_LET_GO}</button>
      </div>
    </article>
    ${rest.length ? `
    <button class="db-seeall" data-action="db-seeall" aria-expanded="${dbSeeAll}">${dbSeeAll ? DB_SEE_LESS : DB_SEE_ALL(rest.length)}</button>
    <section class="db-upnext${dbSeeAll ? ' is-open' : ''}" aria-label="${DB_COMING_UP}">
      <div class="db-upnext-title">${DB_COMING_UP} · ${rest.length}</div>
      ${rest.map(r => `<div class="db-row" data-task-id="${r.id}">
        <div class="db-row-text"><span class="db-row-name">${esc(r.name)}</span>
          <span class="db-row-reason">${isDrifted(r) ? REASON_DRIFTED : esc(urgencyAgeLabel(r) || '')}</span></div>
        <div class="db-row-urgs" role="group" aria-label="${DB_QUESTION}">${dbUrgButtonsHtml(r, 'db-mini')}</div>
      </div>`).join('')}
    </section>` : ''}`;
}

function dbAfterAnswer(id) {
  dbHandled.add(id); dbReviewed.add(id);
  render();             // list, header counts, background screen
  renderDriftBox();
  dbFocusCard();
}

// Saving any urgency — even the same value — restarts its clock (§4.5)
function dbRate(id, u) {
  const t = byId(id); if (!t) return;
  commitTask(() => {
    Object.assign(t, rerateUrgency(t, u));
    if (!t.edits) t.edits = []; t.edits.push(Date.now());
  });
  dbAfterAnswer(id);
}

function dbDone(id) {
  const t = byId(id); if (!t) return;
  commitTask(() => { t.done = true; t.doneAt = Date.now(); });
  if (timerTaskId === id) timerStopSilent();
  dbAfterAnswer(id);
}

// "Let it go" deletes straight away, with a 5-second Undo (§9)
function dbLetGo(id) {
  const idx = tasks.findIndex(t => t.id === id); if (idx < 0) return;
  const snapshot = JSON.parse(JSON.stringify(tasks[idx]));
  if (timerTaskId === id) timerStopSilent();
  commitTask(() => { tasks.splice(idx, 1); });
  if (activeId === id) closePanel();
  dbAfterAnswer(id);
  showUndoToast(UNDO_LET_GO(snapshot.name), () => {
    const restored = migrateTask(snapshot);
    commitTask(() => { tasks.splice(Math.min(idx, tasks.length), 0, restored); });
    dbHandled.delete(id); dbReviewed.delete(id);
    render();
    if (driftBoxIsOpen()) { renderDriftBox(); dbFocusCard(); }
  });
}

// ─── UNDO TOAST ──────────────────────────────────────────────────────────────

let undoFn = null, undoTimer = null;
function showUndoToast(text, onUndo) {
  undoFn = onUndo;
  g('undoToastText').textContent = text;
  g('undoToast').classList.remove('hidden');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndoToast, 5000);
}
function hideUndoToast() { clearTimeout(undoTimer); undoFn = null; g('undoToast').classList.add('hidden'); }
function runUndo()       { const fn = undoFn; hideUndoToast(); if (fn) fn(); }

// ─── RENDER ──────────────────────────────────────────────────────────────────

function render() {
  updateDriftBoxBadge();
  renderMain();
  if (activeId && byId(activeId)) renderPanelContent(activeId);
}

// ─── MAIN SCREEN (v26 Contexts) ──────────────────────────────────────────────
// One ranked list that re-ranks by focus mode (spec §4–§5.1).

const FOLD_ROWS = 16;                    // rows shown after #3 before "Show more" (desktop)
const MODE_ORDER = ['quick', 'zone', 'focus'];   // Simplicity · Urgency · Importance
const MODE_AXIS  = { quick:'s', zone:'u', focus:'i' };
const MODE_ICONS = {
  quick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
  zone:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 9c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1.5"/><path d="M2 15c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1.5"/></svg>',
  focus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>',
};

function setMode(mode) {
  // Tapping the active mode again returns to Balanced (§4.3)
  currentMode = (mode === currentMode || !MODES.includes(mode)) ? 'balanced' : mode;
  foldOpen = false; heroPickerId = null;
  document.body.dataset.mode = currentMode;
  renderMain();
}

// Tasks that belong in the list: not done, not rated Someday (§4.2)
function listTasks() { return tasks.filter(t => !t.done && !isDrifted(t)); }

// ── Small building blocks ──

function slipLevel(t) {
  const r = slipRatio(t);
  return r === null || r <= 1 ? '' : r >= 2 ? 'red' : 'amber';
}

function slipBadgeHtml(t) {
  const lvl = slipLevel(t); if (!lvl) return '';
  return `<button class="slip-badge slip-${lvl}" data-action="open-drift-box" data-focus="${t.id}" title="${esc(SLIP_BADGE_TITLE)}">${esc(urgencyAgeLabel(t))}</button>`;
}

function deepBadgeHtml(t)   { return isDeep(t) ? `<span class="deep-badge">${DEEP_BADGE}</span>` : ''; }
function runningDotHtml(t)  { return timerTaskId === t.id ? '<span class="card-timer-dot" title="Block running"></span>' : ''; }

function barsHtml(v, extraCls) {
  return `<span class="mbars${extraCls ? ' ' + extraCls : ''}" aria-hidden="true">${[1,2,3,4].map(n => `<i${n <= v ? ' class="on"' : ''}></i>`).join('')}</span>`;
}

function ringHtml(sc, size, stroke) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, dash = Math.max(0, Math.min(100, sc)) / 100 * c;
  return `<span class="ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="${stroke}"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${stroke}"
        stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>
    </svg>
    <span class="ring-num">${sc}</span>
  </span>`;
}

// S/U/I pills — order everywhere: Simplicity · Urgency · Importance (§4.3)
function axisPillsHtml(t, compact) {
  const lvl = slipLevel(t), active = MODE_AXIS[currentMode];
  const axes = [
    ['s', AXIS_SHORT.s, SIM_WORDS[t.s], t.s, ''],
    ['u', AXIS_SHORT.u, URG_WORDS[t.u], t.u, lvl ? 'slip-' + lvl : ''],
    ['i', AXIS_SHORT.i, IMP_WORDS[t.i], t.i, ''],
  ];
  return `<div class="axis-pills${compact ? ' compact' : ''}">${axes.map(([k, short, word, v, cls]) =>
    `<span class="axis-pill${active === k ? ' is-active' : ''}" title="${AXIS_NAME[k]}: ${word}">
      <span class="axis-k">${short}</span>${compact ? '' : `<span class="axis-word">${word}</span>`}${barsHtml(v, cls)}
    </span>`).join('')}</div>`;
}

// ── Sections ──

function renderHeaderMeta(nActive) {
  const d = g('hdrDate');
  if (d) d.textContent = new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
  const a = g('hdrActive'); if (a) a.textContent = HDR_ACTIVE(nActive);
}

function renderContext() {
  const status = g('ctxStatus'), cards = g('modeCards');
  if (status) {
    status.innerHTML = currentMode === 'balanced'
      ? `<strong>${BALANCED_TITLE}</strong> · ${BALANCED_LINE}`
      : `<strong>${MODE_UI[currentMode].name}</strong> · ${MODE_UI[currentMode].nudge}
         <button class="btn-back-balanced" data-action="back-balanced">${BACK_BALANCED}</button>`;
  }
  if (cards) {
    cards.innerHTML = MODE_ORDER.map(m => {
      const ui = MODE_UI[m], on = currentMode === m;
      return `<button class="mode-card mode-${m}${on ? ' is-on' : ''}" data-action="set-mode" data-mode="${m}" aria-pressed="${on}">
        <span class="mode-icon">${MODE_ICONS[m]}</span>
        <span class="mode-text"><span class="mode-name">${ui.name}</span><span class="mode-state">${ui.state}</span></span>
        <span class="energy" aria-label="${ui.energy} of 3 energy">${[1,2,3].map(n => `<i${n <= ui.energy ? ' class="on"' : ''}></i>`).join('')}</span>
      </button>`;
    }).join('');
  }
}

// "Can't wait": Fire tasks that the current ranking pushed out of the top 3 (§4.4)
function renderFireBanner(ranked) {
  const el = g('fireBanner'); if (!el) return;
  const top3 = new Set(ranked.slice(0, 3).map(t => t.id));
  const out = ranked.filter(t => t.tier?.key === 'fire' && !top3.has(t.id)).sort((a, b) => b.sc - a.sc);
  if (!out.length) { el.innerHTML = ''; return; }
  const t = out[0];
  el.innerHTML = `<div class="fire-banner" data-action="open-panel" data-id="${t.id}" data-task-id="${t.id}" role="button" tabindex="0">
    <span class="fire-label">🔥 ${FIRE_BANNER}</span>
    <span class="fire-name">${esc(t.name)}</span>${runningDotHtml(t)}
    ${out.length > 1 ? `<span class="fire-more">(+${out.length - 1})</span>` : ''}
    <span class="fire-score">${t.sc}</span>
  </div>`;
}

function heroHtml(t) {
  const ui = currentMode === 'balanced' ? null : MODE_UI[currentMode];
  const kicker = ui ? ui.kicker : BALANCED_KICKER;
  const picking = heroPickerId === t.id;
  const action = picking
    ? `<div class="hero-picker" role="group" aria-label="${PICKER_LABEL}">
        <span class="hero-picker-label">${PICKER_LABEL}</span>
        ${[15, 25, 50].map(m => `<button class="hero-dur${m === timerSelectedMins ? ' is-last' : ''}" data-action="hero-pick-dur" data-mins="${m}">${m} min</button>`).join('')}
        <button class="hero-dur-cancel" data-action="hero-pick-cancel">${PICKER_CANCEL}</button>
      </div>`
    : `<button class="btn-onit" data-action="hero-start" data-id="${t.id}">${HERO_CTA}</button>`;
  return `<article class="hero-card${isDeep(t) ? ' is-deep' : ''}" data-action="open-panel" data-id="${t.id}" data-task-id="${t.id}" role="button" tabindex="0">
    ${ringHtml(t.sc, 104, 7)}
    <div class="hero-body">
      <div class="hero-kicker"><span>${kicker}</span>${deepBadgeHtml(t)}</div>
      <h2 class="hero-title">${esc(t.name)}${runningDotHtml(t)}</h2>
      <div class="hero-meta">${slipBadgeHtml(t)}<span class="hero-nudge">${tierUI(t.tier.key).nudge}</span></div>
      ${axisPillsHtml(t, false)}
      <div class="hero-actions">${action}</div>
    </div>
  </article>`;
}

function nextCardHtml(t, rank) {
  return `<article class="next-card${isDeep(t) ? ' is-deep' : ''}" data-action="open-panel" data-id="${t.id}" data-task-id="${t.id}" role="button" tabindex="0">
    ${ringHtml(t.sc, 48, 4)}
    <div class="next-body">
      <div class="next-top"><span class="next-rank">#${rank}</span>${deepBadgeHtml(t)}${slipBadgeHtml(t)}</div>
      <div class="next-title">${esc(t.name)}${runningDotHtml(t)}</div>
      ${axisPillsHtml(t, true)}
    </div>
    <button class="row-check" data-action="toggle-done" data-id="${t.id}" aria-label="${MARK_DONE} — ${esc(t.name)}" title="${MARK_DONE}"></button>
  </article>`;
}

function listRowHtml(t, rank) {
  const lvl = slipLevel(t);
  return `<div class="list-row${isDeep(t) ? ' is-deep' : ''}" data-action="open-panel" data-id="${t.id}" data-task-id="${t.id}" role="button" tabindex="0">
    <span class="c-rank">${rank}</span>
    <span class="c-task"><span class="c-name">${esc(t.name)}</span>${runningDotHtml(t)}${deepBadgeHtml(t)}${slipBadgeHtml(t)}</span>
    <span class="c-ax" title="${AXIS_NAME.s}: ${SIM_WORDS[t.s]}">${barsHtml(t.s)}</span>
    <span class="c-ax" title="${AXIS_NAME.u}: ${URG_WORDS[t.u]}">${barsHtml(t.u, lvl ? 'slip-' + lvl : '')}</span>
    <span class="c-ax" title="${AXIS_NAME.i}: ${IMP_WORDS[t.i]}">${barsHtml(t.i)}</span>
    <span class="c-matter">${t.sc}</span>
    <button class="row-check" data-action="toggle-done" data-id="${t.id}" aria-label="${MARK_DONE} — ${esc(t.name)}" title="${MARK_DONE}"></button>
  </div>`;
}

function renderList(rest) {
  const el = g('listSection'); if (!el) return;
  if (!rest.length) { el.innerHTML = ''; return; }
  const shown = foldOpen ? rest : rest.slice(0, FOLD_ROWS);
  const hidden = rest.length - shown.length;
  const active = MODE_AXIS[currentMode];
  const col = (k, label) => `<span class="c-ax${active === k ? ' is-active' : ''}">${label}${active === k ? ' ▾' : ''}</span>`;
  el.innerHTML = `
    <div class="list-head-title">${LIST_TITLE}</div>
    <div class="list-table${currentMode !== 'balanced' ? ' in-mode' : ''}">
      <div class="list-row list-head" aria-hidden="true">
        <span class="c-rank">#</span><span class="c-task">${COL_TASK}</span>
        ${col('s', COL_SIMP)}${col('u', COL_URG)}${col('i', COL_IMP)}
        <span class="c-matter${currentMode === 'balanced' ? ' is-active' : ''}">${COL_MATTER}${currentMode === 'balanced' ? ' ▾' : ''}</span><span></span>
      </div>
      ${shown.map((t, i) => listRowHtml(t, i + 4)).join('')}
    </div>
    ${rest.length > FOLD_ROWS ? `<button class="fold-btn" data-action="fold-toggle" aria-expanded="${foldOpen}">
      ${foldOpen ? FOLD_LESS : `<strong>${FOLD_MORE(hidden)}</strong> · ${FOLD_MORE_SUB}`}</button>` : ''}`;
}

function renderFoot() {
  const el = g('ctxFoot'); if (!el) return;
  const nDone = tasks.filter(t => t.done).length;
  el.innerHTML = [
    currentMode !== 'balanced' ? `<span>${BACK_NEXT_TIME}</span>` : '',
    nDone ? `<button class="done-link" data-action="open-done">✓ ${DONE_LINK(nDone)}</button>` : '',
  ].filter(Boolean).join('<span class="foot-sep">·</span>');
}

function renderMain() {
  const pool = listTasks();
  const ranked = sortByMode(pool, currentMode);
  const running = timerTaskId !== null;
  renderHeaderMeta(pool.length);
  renderContext();
  renderFireBanner(ranked);

  const hero = g('heroSlot'), next = g('nextCards');
  if (!ranked.length) {
    const nDrifted = tasks.filter(t => !t.done && isDrifted(t)).length;
    hero.innerHTML = `<div class="empty-state">${nDrifted
      ? `${EMPTY_ALL_DRIFT(nDrifted)} <button class="empty-cta" data-action="open-drift-box">${EMPTY_REVIEW}</button>`
      : `${EMPTY_NONE} <button class="empty-cta" data-action="open-capture">${EMPTY_ADD}</button>`}</div>`;
    next.innerHTML = '';
    renderList([]);
  } else {
    // While a block runs, the session card takes the #1 slot (§5.6)
    hero.innerHTML = running ? '' : heroHtml(ranked[0]);
    next.innerHTML = ranked.slice(1, 3).map((t, i) => nextCardHtml(t, i + 2)).join('');
    renderList(ranked.slice(3));
  }
  renderFoot();
}

// ─── DELEGATED EVENT DISPATCHER ─────────────────────────────────────────────
// Handles clicks on data-action elements generated inside HTML strings.
// Removes the need for global inline onclick= attributes on cards and modals.

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id     = el.dataset.id !== undefined ? Number(el.dataset.id) : null;
  switch (action) {
    case 'open-panel':       e.stopPropagation(); openPanel(id);            break;
    case 'toggle-done':      e.stopPropagation(); toggleDone(id);           break;
    case 'open-triage-for':      openTriageFor(id);                             break;
    case 'triage-panel-skip':    panelTriageSkip();                             break;
    case 'triage-panel-delete':  panelTriageDelete();                           break;
    case 'create-panel-delete':  panelCreateDelete();                           break;
    case 'delete-inbox':     e.stopPropagation(); deleteInboxItem(id);      break;
    case 'select-search':    selectSearchResult(id);                        break;
    case 'open-trophy':      openTrophy(id);                                break;
    case 'reopen-from-done': e.stopPropagation(); reopenFromDone(id);       break;
    case 'set-mode':         setMode(el.dataset.mode);                      break;
    case 'back-balanced':    setMode('balanced');                           break;
    case 'fold-toggle':      foldOpen = !foldOpen; renderMain();            break;
    case 'hero-start':       e.stopPropagation(); heroShowPicker(id);       break;
    case 'hero-pick-dur':    e.stopPropagation(); heroPickDuration(parseInt(el.dataset.mins)); break;
    case 'hero-pick-cancel': e.stopPropagation(); heroHidePicker();         break;
    case 'open-drift-box':   e.stopPropagation(); openDriftBox(el.dataset.focus ? Number(el.dataset.focus) : null); break;
    case 'db-rate':          dbRate(id, +el.dataset.u);                     break;
    case 'db-done':          dbDone(id);                                    break;
    case 'db-letgo':         dbLetGo(id);                                   break;
    case 'db-seeall':        dbSeeAll = !dbSeeAll; renderDriftBox();        break;
    case 'db-close':         closeDriftBox();                               break;
    case 'open-capture':     openCapture();                                 break;
    case 'open-done':        openDoneModal();                               break;
    case 'timer-stop':       timerStop(false);                              break;
  }
});

// ─── SEARCH ──────────────────────────────────────────────────────────────────

function openSearch() {
  searchActive=true; searchSelectedIdx=-1;
  g('searchOverlay').classList.add('open');
  const inp=g('searchInput'); inp.value=''; renderSearch(); setTimeout(()=>inp.focus(),30);
}

function closeSearch() { searchActive=false; g('searchOverlay').classList.remove('open'); g('searchInput').value=''; }
function maybeCloseSearch(e) { if (e.target===g('searchOverlay')) closeSearch(); }

function highlight(text, q) {
  if (!q) return text;
  return text.replace(new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')', 'gi'), '<mark>$1</mark>');
}

function searchKeydown(e) {
  const items=document.querySelectorAll('.search-result');
  if      (e.key==='ArrowDown') { e.preventDefault(); searchSelectedIdx=Math.min(searchSelectedIdx+1,items.length-1); }
  else if (e.key==='ArrowUp')   { e.preventDefault(); searchSelectedIdx=Math.max(searchSelectedIdx-1,0); }
  else if (e.key==='Enter')  { const t=searchSelectedIdx>=0?searchResults[searchSelectedIdx]:searchResults.length===1?searchResults[0]:null; if (t) selectSearchResult(t.id); return; }
  items.forEach((el,i)=>el.classList.toggle('active',i===searchSelectedIdx));
  if (items[searchSelectedIdx]) items[searchSelectedIdx].scrollIntoView({block:'nearest'});
}

function selectSearchResult(id) { closeSearch(); const t = byId(id); if (t?.done) openTrophy(id); else openPanel(id); }

let _searchTimer = null;
function renderSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(_doSearch, 120);
}

function _doSearch() {
  const q=g('searchInput').value.trim().toLowerCase(), el=g('searchResults');
  searchSelectedIdx=-1;
  if (!q) { searchResults=[]; el.innerHTML='<div class="search-empty">Type to search your tasks</div>'; return; }
  const scored=tasks.map(t => {
    const nm=t.name.toLowerCase().includes(q);
    const no=(t.note||'').toLowerCase().includes(q);
    const bk=(t.bricks||[]).some(b=>(b.text||'').toLowerCase().includes(q));
    if (!nm&&!no&&!bk) return null;
    return { t, rank:nm?0:no?1:2, nm, no, bk };
  }).filter(Boolean).sort((a,b)=>a.rank-b.rank||b.t.sc-a.t.sc);
  searchResults=scored.map(s=>s.t);
  if (!scored.length) {
    el.innerHTML=`<div class="search-empty">No tasks match "<strong>${q}</strong>"<br><span style="font-size:10px;margin-top:4px;display:block">Try a word from the task name, note, or a progress log</span></div>`;
    return;
  }
  const ZL={flow:'List',deep:'Deep',drift:'Drift box'};
  const placeOf=t=>isDrifted(t)||(slipRatio(t)??0)>1?'drift':isDeep(t)?'deep':'flow';
  el.innerHTML=scored.map(({t,nm,no,bk})=>{
    const zone=placeOf(t);
    let mc='';
    if (!nm&&no&&t.note)     { const i=t.note.toLowerCase().indexOf(q); mc=`Note: ${t.note.slice(Math.max(0,i-20),i+40).trim()}`; }
    else if (!nm&&bk) { const b=t.bricks.find(b=>(b.text||'').toLowerCase().includes(q)); if (b?.text) mc=`Progress: ${b.text.slice(0,50)}`; }
    return `<div class="search-result${t.done?' sr-done':''}" data-action="select-search" data-id="${t.id}">
      <span class="sr-score" style="color:${tierUI(t.tier.key).color||'var(--muted)'}">${t.sc}</span>
      <div class="sr-body">
        <div class="sr-name">${nm?highlight(esc(t.name),q):t.name}${t.done?' <span style="font-size:10px;color:var(--muted)">✓ done</span>':''}</div>
        <div class="sr-meta"><span class="sr-zone sr-zone-${zone}">${ZL[zone]}</span><span class="sr-tier">${(tierUI(t.tier.key).label||'').split(' ')[0]} ${(tierUI(t.tier.key).label||'').replace(/^[^ ]+ /,'')}</span></div>
        ${mc?`<div class="sr-match-context">${highlight(esc(mc),q)}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
// (scroll navigation removed — board is now a slide-in panel)

document.addEventListener('keydown', e => {
  const inInput=['INPUT','TEXTAREA'].includes(document.activeElement.tagName);
  if (e.key==='Escape') {
    // Overlay-level Escape is handled by capture-phase listeners on each overlay.
    // This fallback covers non-overlay layers only.
    if (driftBoxIsOpen()) { closeDriftBox(); return; }
    if (captureOpen) { closeCapture(); return; }
    quickInput.blur(); return;
  }
  if (inInput) return;
  if ((e.key==='n'||e.key==='N')&&!activeId&&!doneModalZone&&!trophyTaskId) {
    e.preventDefault();
    openCapture();
  }
  if (e.key==='/'&&!activeId&&!doneModalZone&&!trophyTaskId&&!searchActive) { e.preventDefault(); openSearch(); }
});

// ─── STATIC EVENT LISTENERS ──────────────────────────────────────────────────
try {

// ── Escape capture — each overlay closes only itself, topmost wins ──
onEscapeCapture('timerModalOverlay', () => closeModal('timerModalOverlay'));
onEscapeCapture('confirmOverlay',    () => closeModal('confirmOverlay'));
onEscapeCapture('searchOverlay',     closeSearch);
onEscapeCapture('driftBoxOverlay',   closeDriftBox);
onEscapeCapture('trophyOverlay',     closeTrophy);
onEscapeCapture('doneModalOverlay',  closeDoneModal);
onEscapeCapture('overlay',           closePanel);

// Header
g('btnSearch').addEventListener('click', openSearch);
g('btnExport').addEventListener('click', exportData);
g('btnReset').addEventListener('click', () => { mmConfirm(RESET_CONFIRM, clearSave); });
g('importInput').addEventListener('change', importData);

// Header entries: Drift box · Inbox · + Add
g('btnDriftBox').addEventListener('click', () => openDriftBox());
g('btnInbox').addEventListener('click', openTriage);
g('btnAdd').addEventListener('click', () => captureOpen ? closeCapture() : openCapture());

// List rows are role="button" divs: Enter / Space open them like a click
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest && e.target.closest('.ctx-main [role="button"][data-action]');
  if (!row || e.target !== row) return;
  e.preventDefault(); row.click();
});

// Drift box panel + undo toast
g('driftBoxOverlay').addEventListener('click', maybeCloseDriftBox);
g('btnDriftBoxClose').addEventListener('click', closeDriftBox);
g('btnUndo').addEventListener('click', runUndo);

// Create panel
g('btnPanelCreate').addEventListener('click', addTaskFromPanel);

// Search overlay
g('searchOverlay').addEventListener('click', maybeCloseSearch);

// Done modal
g('doneModalOverlay').addEventListener('click', maybeDoneClose);
g('btnDoneClose').addEventListener('click', closeDoneModal);

// Trophy panel
g('trophyOverlay').addEventListener('click', maybeTrophyClose);
g('btnTrophyClose').addEventListener('click', closeTrophy);
g('btnTrophyReopen').addEventListener('click', reopenFromTrophy);

// Detail panel
g('overlay').addEventListener('click', maybeClose);
g('btnPanelClose').addEventListener('click', closePanel);

// Panel chevron menu
function panelMenuOpen() {
  g('panelMenuDropdown').classList.remove('hidden');
  g('btnPanelMenu').classList.add('active');
}
function panelMenuClose() {
  g('panelMenuDropdown').classList.add('hidden');
  g('btnPanelMenu').classList.remove('active');
}
function panelMenuToggle() {
  g('panelMenuDropdown').classList.contains('hidden') ? panelMenuOpen() : panelMenuClose();
}
g('btnPanelMenu').addEventListener('click', e => { e.stopPropagation(); panelMenuToggle(); });
g('pmClose').addEventListener('click',  () => { panelMenuClose(); closePanel(); });
g('pmDone').addEventListener('click',   () => { panelMenuClose(); if (activeId) { toggleDone(activeId); closePanel(); } });
g('pmDelete').addEventListener('click', () => {
  panelMenuClose();
  if (activeId) mmConfirm(CONFIRM_DELETE_TASK, deletePanel);
});
// Close menu when clicking outside
document.addEventListener('click', e => {
  if (!g('panelMenuWrap').contains(e.target)) panelMenuClose();
  // Collapse expanded brick if clicking outside the brick list
  if (expandedBrickId !== null && !e.target.closest('#pBrickList')) {
    expandedBrickId = null;
    const t = activeId ? byId(activeId) : null;
    if (t) renderBrickList(t);
  }
});
g('btnPanelDone').addEventListener('click', () => { if (activeId) { toggleDone(activeId); closePanel(); } });

// Timer footer events
// Start session → show duration picker
g('btnPanelStart').addEventListener('click', () => {
  pfShow('picking');
  // Highlight last-used duration
  document.querySelectorAll('.pf-dur').forEach(btn => {
    btn.classList.toggle('pf-dur--last', parseInt(btn.dataset.mins) === timerSelectedMins);
  });
});
// Cancel picking
g('btnStartCancel').addEventListener('click', () => pfShow('idle'));
// Tap a duration = start immediately
g('pfPresets').addEventListener('click', e => {
  const btn = e.target.closest('.pf-dur');
  if (btn && activeId) timerStart(activeId, parseInt(btn.dataset.mins));
});
g('pfBtnPause').addEventListener('click', timerPauseToggle);
g('pfBtnStop').addEventListener('click', () => timerStop(false));
// Mini indicator
g('hmtOpen').addEventListener('click', () => { if (timerTaskId) openPanel(timerTaskId); });
g('hmtStop').addEventListener('click', () => timerStop(false));
g('hscBtnPause').addEventListener('click', timerPauseToggle);
// Session card open — click anywhere on countdown area opens the task panel
g('haloSessionCard').addEventListener('click', e => {
  if (!e.target.closest('button') && timerTaskId) openPanel(timerTaskId);
});

g('btnApplyScore').addEventListener('click', applyScoreEdit);

} catch(err) { console.error('[MM] Listener setup failed:', err); }

// ─── CAPTURE BAR ─────────────────────────────────────────────────────────────

// (taskInput removed — quick capture now uses openPanelCreate via shift+enter)

const quickInput  = g('quickInput');
const captureWrap = g('captureWrap');

quickInput.addEventListener('focus', ()=>captureWrap.classList.add('focused'));
quickInput.addEventListener('blur',  ()=>captureWrap.classList.remove('focused'));
quickInput.addEventListener('keydown', e => {
  if (e.key!=='Enter') return; e.preventDefault();
  if (e.shiftKey) captureRateNow(); else quickCapture();
});

// Capture popover (spec §5.4): ↵ → Inbox, ⇧↵ / "Rate now" → task panel in create mode.
// It stays open after ↵ so several things can be captured in a row.
function openCapture() {
  captureOpen = true;
  g('captureRow').classList.remove('hidden');
  g('btnAdd').setAttribute('aria-expanded', 'true');
  setTimeout(() => quickInput.focus(), 30);
}
function closeCapture() {
  captureOpen = false;
  quickInput.blur();
  g('captureRow').classList.add('hidden');
  g('btnAdd').setAttribute('aria-expanded', 'false');
}
function captureRateNow() {
  const n = quickInput.value.trim(); if (!n) { quickInput.focus(); return; }
  quickInput.value = ''; closeCapture(); openPanelCreate(n);
}
g('btnCaptureInbox').addEventListener('click', () => { quickCapture(); quickInput.focus(); });
g('btnCaptureRate').addEventListener('click', captureRateNow);
// Click outside the popover closes it
document.addEventListener('mousedown', e => {
  if (captureOpen && !e.target.closest('#captureRow, #btnAdd')) closeCapture();
});

// ─── BOOT ────────────────────────────────────────────────────────────────────

function updateHeaderOffset() {
  const h=document.querySelector('header'); if (!h) return;
  const hh=h.offsetHeight;
  document.documentElement.style.setProperty('--header-h', hh+'px');
  const app=document.querySelector('.app'); if (app) app.style.paddingTop=hh+'px';
}

updateHeaderOffset();
document.fonts.ready.then(updateHeaderOffset);
window.addEventListener('resize', updateHeaderOffset);
load();
rebuildTaskMap();

if (!tasks.length) {
  const now=Date.now();
  tasks=[
    [1001,'Fix critical prod bug',      4,4,3,now-2*DAY_MS],
    [1002,'Investor deck final pass',    4,3,4,now-1*DAY_MS],
    [1003,'Architecture review doc',     3,3,2,now-10*DAY_MS],
    [1004,'Research competitor pricing', 3,2,3,now-16*DAY_MS],
    [1005,'Write Q2 OKR update',         3,3,3,now-3*DAY_MS],
  ].map(([id,name,i,u,s,createdAt])=>makeTask(id,name,i,u,s,'',createdAt));
  rebuildTaskMap();
  save();
}

document.body.dataset.mode = currentMode;   // every launch starts in Balanced
render();
renderInbox();
timerRestore();

