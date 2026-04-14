// app.js — DOM, rendering, events, state. Depends on logic.js + storage.js.


// ─── STATE ───────────────────────────────────────────────────────────────────

let tasks = [], inbox = [];
let activeId = null, addingBrick = false;
let pickerI = 2, pickerU = 2, pickerS = 3, addAgency = 'solo';
let triageQueue = [], triageIdx = 0, triageAgency = 'solo';
// Halo panel state
let haloDeepSkipped = [];        // IDs skipped in deep mode
let haloDeepCurrent = null;      // current deep task shown
// Board panel state
let boardPanelOpen = false;
// Peek drawer state
let peekOpen = false;

let doneModalZone = null, trophyTaskId = null;

// ── Timer state ──
let timerTaskId        = null;  // id of task currently being timed
let timerEndsAt        = null;  // absolute ms when block ends
let timerDuration      = null;  // total block ms
let timerPaused        = false;
let timerPauseLeft     = null;  // ms remaining when paused
let timerTick          = null;  // setInterval handle
let timerSelectedMins  = 25;    // last-used preset (persists across opens)
let mvDragId = null, mvPendingDrop = null;
let searchActive = false, searchSelectedIdx = -1, searchResults = [];

const MV_ZONE_MAP  = { mvColFlow:'flow', mvColDeep:'deep' };
const SLIDERS_EDIT = { impId:'eImp', urgId:'eUrg', simId:'eSim', impWord:'eImpWord', urgWord:'eUrgWord', simWord:'eSimWord', impDim:'eimp', urgDim:'eurg', simDim:'esim' };
const SLIDERS_TRG  = { impId:'tImp', urgId:'tUrg', simId:'tSim', impWord:'tImpWord', urgWord:'tUrgWord', simWord:'tSimWord', impDim:'timp', urgDim:'turg', simDim:'tsim' };

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
function clearConfirms(){ ['mvFlowConfirm','mvDeepConfirm','mvDriftConfirm'].forEach(id => { const el = g(id); if (el) el.innerHTML = ''; }); }

// Patch a single card in the already-rendered board without touching any other DOM.
// Used for mutations that don't change zone, tier, or badge counts.
function renderBoardCard(id) {
  const t = byId(id); if (!t) return;
  // Flow: wrapper is .mv-flow-card[data-id]; replace the whole wrapper
  document.querySelectorAll(`.mv-flow-card[data-id="${id}"]`).forEach(el => {
    el.outerHTML = mvFlowCardHtml(t, el.dataset.zone || 'flow');
  });
  // Deep: outer container is .mv-tm-cell[data-id]; preserve its flex value
  document.querySelectorAll(`.mv-tm-cell[data-id="${id}"]`).forEach(el => {
    el.outerHTML = mvDeepCellHtml(t, el.style.flex || '1');
  });
  // Drift: chip has data-id directly
  document.querySelectorAll(`.mv-drift-chip[data-id="${id}"]`).forEach(el => {
    el.outerHTML = mvDriftChipHtml(t);
  });
}

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
function updateTriageOrb(sc, k) { renderOrb({ circle:'tOrbCircle',     ring:'tOrbRing',     num:'tOrbNum'     }, sc, k); }

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

// ─── AGENCY ──────────────────────────────────────────────────────────────────

function applyAgencyUI(selector, rowId, inputId, agency) {
  document.querySelectorAll(selector).forEach(b => b.classList.toggle('active', b.dataset.agency === agency));
  g(rowId).classList.toggle('visible', agency !== 'solo');
  if (agency !== 'solo') setTimeout(() => g(inputId).focus(), 50);
}

function setAgency(a)       { addAgency     = a; applyAgencyUI('#addModal .agency-btn',    'addContextRow',    'addContextInput',    a); }
function setTriageAgency(a) { triageAgency  = a; applyAgencyUI('.triage-modal .agency-btn','triageContextRow', 'triageContextInput', a); }
function setPanelAgency(a)  {
  const t = byId(activeId); if (!t) return;
  commitTask(() => { t.agency = a; });
  applyAgencyUI('.panel .agency-btn','panelContextRow','panelContextInput', a);
  renderBoardCard(activeId);
  renderPanelContent(activeId);
}

// ─── TEXTAREAS ───────────────────────────────────────────────────────────────

function autoResize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

// ─── ADD MODAL ───────────────────────────────────────────────────────────────

function openScoreModal(name) {
  g('taskInput').value = name || ''; pickerI = 2; pickerU = 2; pickerS = 3;
  addAgency = 'solo'; setAgency('solo');
  setImportance(2); setUrgency(2); setSimplicity(3);
  openModal('addOverlay');
  setTimeout(() => { const inp = g('taskInput'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 60);
}

function maybeCloseAdd(e) { if (e.target === g('addOverlay')) closeAll(); }

function closeAll() {
  pickerI = 2; pickerU = 2; pickerS = 3; addAgency = 'solo';
  document.querySelectorAll('#addModal .agency-btn').forEach(b => b.classList.toggle('active', b.dataset.agency === 'solo'));
  g('addContextRow').classList.remove('visible');
  closeModal('addOverlay');
}

function updatePreview() {
  const sc = calcScore(pickerI, pickerU, pickerS), tier = getTier(sc);
  updateOrb(sc, tier.key);
  g('scoreOrbTier').textContent = tierUI(tier.key).label; g('scoreOrbTier').style.color = tierUI(tier.key).color;
  g('scoreOrbNudge').textContent = tierUI(tier.key).nudge;
}

function setCreationAxis(axis, val, rangeId, wordId, words, tickDim, color) {
  if (axis === 'i') pickerI = val; else if (axis === 'u') pickerU = val; else pickerS = val;
  if (navigator.vibrate && axis !== 's') navigator.vibrate(8);
  paintTrack(rangeId, val, color);
  const el = g(rangeId); if (el) el.value = val;
  g(wordId).textContent = words[val];
  highlightTicks(tickDim, val, color);
  if (axis === 's') document.querySelectorAll('.sim-seg').forEach(el => el.classList.toggle('active', +el.dataset.val === val));
  updatePreview();
}

function setImportance(v) { setCreationAxis('i', v, 'impRange', 'impWord', IMP_WORDS, 'imp', 'var(--fire)'); }
function setUrgency(v)    { setCreationAxis('u', v, 'urgRange', 'urgWord', URG_WORDS, 'urg', 'var(--activate)'); }
function setSimplicity(v) { setCreationAxis('s', v, 'simRange', 'simWord', SIM_WORDS, 'sim', 'var(--latent)'); }

// ─── TASK CRUD ───────────────────────────────────────────────────────────────

function makeTask(id, name, i, u, s, agency, context, note, createdAt) {
  const sc = calcScore(i, u, s);
  return { id, name, i, u, s, sc, tier:getTier(sc), done:false, bricks:[], createdAt, doneAt:null, views:[], edits:[], agency, context, note, links:[] };
}

function addTask() {
  const inp = g('taskInput'), name = inp.value.trim(); if (!name) { inp.focus(); return; }
  commitTask(() => tasks.push(makeTask(Date.now(), name, pickerI, pickerU, pickerS, addAgency,
    (g('addContextInput').value || '').trim(), g('addNote').value || '', Date.now())));
  inp.value = ''; g('addContextInput').value = '';
  const n = g('addNote'); n.value = ''; n.style.height = 'auto';
  g('quickInput').value = '';
  closeAll(); render();
}

// Remove a card's DOM wrapper and update its column's done badge count.
// zone is the task's zone string ('flow'|'deep'|'drift').
function removeCardFromDOM(id, zone) {
  const selMap = { flow: `.mv-flow-card[data-id="${id}"]`, deep: `.mv-tm-cell[data-id="${id}"]`, drift: `.mv-drift-chip[data-id="${id}"]` };
  const badgeMap = { flow: 'mvFlowDone', deep: 'mvDeepDone', drift: 'mvDriftDone' };
  const wrapper = document.querySelector(selMap[zone]);
  if (wrapper) wrapper.remove();
  const doneCount = tasks.filter(t => t.done && zoneFor(t) === zone).length;
  setDoneBadge(badgeMap[zone], doneCount);
}

function deleteTask(id) {
  const t = byId(id);
  const zone = t ? zoneFor(t) : null;
  // Clean up any links pointing to this task
  commitTask(() => {
    tasks.forEach(other => { if (other.links) other.links = other.links.filter(l => l.targetId !== id); });
    tasks = tasks.filter(t => t.id !== id);
  });
  if (activeId === id) closePanel();
  if (zone) removeCardFromDOM(id, zone); else render();
}

// ─── TASK LINKING ─────────────────────────────────────────────────────────────

function linkTasks(beforeId, afterId) {
  const before = byId(beforeId), after = byId(afterId);
  if (!before || !after || beforeId === afterId) return;
  if (!before.links) before.links = [];
  if (!after.links)  after.links  = [];
  // Guard against duplicates
  if (before.links.some(l => l.targetId === afterId)) return;
  commitTask(() => {
    before.links.push({ targetId: afterId, type: 'before', createdAt: Date.now() });
    after.links.push({ targetId: beforeId, type: 'after',  createdAt: Date.now() });
  });
  // Urgency mismatch check
  if (before.u < after.u) {
    showStorageToast(LINK_URG_MISMATCH);
  }
  render();
  if (activeId === beforeId || activeId === afterId) renderPanelContent(activeId);
}

function unlinkTasks(aId, bId) {
  const a = byId(aId), b = byId(bId);
  commitTask(() => {
    if (a) a.links = (a.links || []).filter(l => l.targetId !== bId);
    if (b) b.links = (b.links || []).filter(l => l.targetId !== aId);
  });
  render();
  if (activeId === aId) renderPanelContent(aId);
}

// Merge: absorb sourceId into targetId (target survives with new i/u/s)
function mergeTasks(targetId, sourceId, newI, newU, newS) {
  const target = byId(targetId), source = byId(sourceId);
  if (!target || !source) return;
  commitTask(() => {
    // Combine bricks and edits from source
    target.bricks = [...(target.bricks || []), ...(source.bricks || [])].sort((a,b) => a.ts - b.ts);
    target.edits  = [...(target.edits  || []), ...(source.edits  || [])];
    // Apply new scores
    target.i = newI; target.u = newU; target.s = newS;
    target.sc = calcScore(newI, newU, newS); target.tier = getTier(target.sc);
    target.edits.push(Date.now());
    // Repoint any links that pointed at source → target, remove the direct link between them
    tasks.forEach(other => {
      if (other.id === targetId || other.id === sourceId) return;
      if (other.links) other.links = other.links.map(l => l.targetId === sourceId ? { ...l, targetId } : l);
    });
    // Remove the source
    tasks = tasks.filter(t => t.id !== sourceId);
    // Remove any self-referencing links now on target
    target.links = (target.links || []).filter(l => l.targetId !== targetId && l.targetId !== sourceId);
  });
  closeMergeModal();
  render();
  renderPanelContent(targetId);
}

// Link search state
let linkSearchActive = false, linkSearchResults = [], linkSearchTaskId = null;

function openLinkSearch(taskId) {
  linkSearchTaskId = taskId;
  linkSearchActive = true;
  const overlay = g('linkSearchOverlay');
  overlay.classList.remove('hidden');
  const inp = g('linkSearchInput');
  inp.value = '';
  renderLinkSearch('');
  setTimeout(() => inp.focus(), 30);
}

function closeLinkSearch() {
  linkSearchActive = false;
  linkSearchTaskId = null;
  linkSearchResults = [];
  const overlay = g('linkSearchOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function renderLinkSearch(q) {
  const el = g('linkSearchResults');
  const cur = byId(linkSearchTaskId);
  const linkedIds = new Set((cur?.links || []).map(l => l.targetId));
  const lower = q.toLowerCase();
  const pool = tasks.filter(t =>
    t.id !== linkSearchTaskId && !t.done && !linkedIds.has(t.id) &&
    (!q || t.name.toLowerCase().includes(lower) || (t.note || '').toLowerCase().includes(lower))
  ).sort((a, b) => b.sc - a.sc).slice(0, 8);
  linkSearchResults = pool;
  if (!pool.length) {
    el.innerHTML = `<div class="ls-empty">${q ? 'No matching tasks' : 'Type to search tasks to link'}</div>`;
    return;
  }
  el.innerHTML = pool.map((t, i) => {
    const col = TIER_HEX[t.tier.key] || 'var(--muted)';
    return `<div class="ls-result" data-action="ls-select" data-idx="${i}">
      <span class="ls-dot" style="background:${col}"></span>
      <span class="ls-name">${esc(t.name)}</span>
      <span class="ls-score" style="color:${col}">${t.sc}</span>
    </div>`;
  }).join('');
}

function selectLinkResult(idx) {
  const target = linkSearchResults[idx];
  const fromId = linkSearchTaskId;
  if (!target || !fromId) return;
  closeLinkSearch();
  openLinkTypeChooser(fromId, target.id);
}

let linkTypeState = null; // { fromId, toId }

function openLinkTypeChooser(fromId, toId) {
  linkTypeState = { fromId, toId };
  const from = byId(fromId), to = byId(toId);
  if (!from || !to) return;
  const el = g('linkTypeChooser');
  el.classList.remove('hidden');
  const trim = (name, n=28) => name.length > n ? name.slice(0, n) + '…' : name;
  const fromName = trim(from.name), toName = trim(to.name);
  g('ltcFromName').textContent = fromName;
  g('ltcToName').textContent   = toName;
  g('ltcSubBefore').textContent = `"${fromName}" comes first — it unlocks "${toName}"`;
  g('ltcSubAfter').textContent  = `"${toName}" must be done before "${fromName}"`;
}

function closeLinkTypeChooser() {
  linkTypeState = null;
  const el = g('linkTypeChooser');
  if (el) el.classList.add('hidden');
}

function applyLinkType(type) {
  if (!linkTypeState) return;
  const { fromId, toId } = linkTypeState;
  if (type === 'before') {
    // fromId must happen before toId
    linkTasks(fromId, toId);
  } else if (type === 'after') {
    // fromId happens after toId
    linkTasks(toId, fromId);
  } else if (type === 'merge') {
    closeLinkTypeChooser();
    openMergeModal(fromId, toId);
    return;
  }
  closeLinkTypeChooser();
}

// Merge modal state
let mergeState = null;

function openMergeModal(keepId, absorbId) {
  mergeState = { keepId, absorbId };
  const keep = byId(keepId), absorb = byId(absorbId);
  if (!keep || !absorb) return;
  const el = g('mergeModalOverlay');
  el.classList.remove('hidden');
  g('mergeKeepName').textContent   = keep.name;
  g('mergeAbsorbName').textContent = absorb.name;
  // Pre-fill merged name with the kept task's name
  g('mergeResultName').value = keep.name;
  // Combine notes for reference
  const combinedNote = [keep.note, absorb.note].filter(Boolean).join('\n\n— absorbed note:\n');
  g('mergeResultNote').value = combinedNote;
  // Start sliders at keep task values
  mergeI = keep.i; mergeU = keep.u; mergeS = keep.s;
  paintSliders(SLIDERS_MERGE, mergeI, mergeU, mergeS);
  g('mImp').value = mergeI; g('mUrg').value = mergeU; g('mSim').value = mergeS;
  mergePreview();
}

function closeMergeModal() {
  mergeState = null;
  const el = g('mergeModalOverlay');
  if (el) el.classList.add('hidden');
}

let mergeI = 2, mergeU = 2, mergeS = 3;
const SLIDERS_MERGE = { impId:'mImp', urgId:'mUrg', simId:'mSim', impWord:'mImpWord', urgWord:'mUrgWord', simWord:'mSimWord', impDim:'mimp', urgDim:'murg', simDim:'msim' };

function mergePreview() {
  const i = +g('mImp').value, u = +g('mUrg').value, s = +g('mSim').value;
  mergeI = i; mergeU = u; mergeS = s;
  paintSliders(SLIDERS_MERGE, i, u, s);
  const sc = calcScore(i, u, s), tier = getTier(sc);
  g('mergeOrbScore').textContent = sc;
  g('mergeOrbScore').style.color = TIER_HEX[tier.key] || 'var(--accent)';
  g('mergeOrbTier').textContent  = tierUI(tier.key).label;
  g('mergeOrbTier').style.color  = TIER_HEX[tier.key] || 'var(--accent)';
}

function confirmMerge() {
  if (!mergeState) return;
  const { keepId, absorbId } = mergeState;
  const keepTask = byId(keepId);
  if (!keepTask) return;
  const newName = (g('mergeResultName').value || '').trim();
  const newNote = (g('mergeResultNote').value || '').trim();
  if (newName) keepTask.name = newName;
  if (newNote !== keepTask.note) keepTask.note = newNote;
  mergeTasks(keepId, absorbId, mergeI, mergeU, mergeS);
}

function toggleDone(id) {
  const t = byId(id); if (!t) return;
  const wasDone = t.done;
  const zone = zoneFor(t);
  commitTask(() => { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; });
  if (!wasDone) {
    // Task just marked done — animate out then remove surgically
    const card = document.querySelector(`.task-card[data-id="${id}"]`);
    if (card) {
      card.style.animation = 'doneOut .35s ease forwards'; card.style.pointerEvents = 'none';
      setTimeout(() => {
        removeCardFromDOM(id, zone);
        const badgeMap = { flow: 'mvFlowDone', deep: 'mvDeepDone', drift: 'mvDriftDone' };
        const badge = g(badgeMap[zone]);
        if (badge) {
          badge.style.transition = 'outline .15s, outline-offset .15s';
          badge.style.outline = '2px solid var(--latent)'; badge.style.outlineOffset = '2px';
          setTimeout(() => { badge.style.outline = ''; badge.style.outlineOffset = ''; }, 900);
        }
      }, 320);
    } else { removeCardFromDOM(id, zone); }
  } else render(); // reopening: card must re-appear, full render needed
}

function applyNewScore(id, i, u, s) {
  const t = byId(id); if (!t) return;
  commitTask(() => {
    t.i = i; t.u = u; t.s = s; t.sc = calcScore(i, u, s); t.tier = getTier(t.sc);
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

// ─── INBOX ───────────────────────────────────────────────────────────────────

function quickCapture() {
  const el = g('quickInput'), name = el.value.trim(); if (!name) return;
  inbox.push({ id:Date.now() + Math.random(), name, capturedAt:Date.now() });
  el.value = ''; save(); renderInbox();
}

function deleteInboxItem(id) { inbox = inbox.filter(t => t.id !== id); save(); renderInbox(); }

function renderInbox() {
  const strip = g('inboxStrip'), cards = g('inboxCards'), count = g('inboxCount');
  if (!inbox.length) { strip.classList.add('hidden'); return; }
  strip.classList.remove('hidden');
  const now = Date.now();
  count.textContent = inbox.length;
  count.classList.toggle('stale', inbox.some(t => now - t.capturedAt > 7 * DAY_MS));
  cards.innerHTML = inbox.map(t => {
    const ms = now - t.capturedAt;
    const cls = ms > 14*DAY_MS ? 'aged-red' : ms > 7*DAY_MS ? 'aged-amber' : '';
    return `<div class="inbox-card ${cls}" data-action="open-triage-for" data-id="${t.id}">
      <button class="inbox-card-del" data-action="delete-inbox" data-id="${t.id}">×</button>
      <div class="inbox-card-name">${esc(t.name)}</div>
      <div class="inbox-card-age ${cls}">${fmtDuration(ms)} ago</div>
    </div>`;
  }).join('');
}

// ─── TRIAGE ──────────────────────────────────────────────────────────────────

function openTriage() {
  if (!inbox.length) return;
  triageQueue = [...inbox]; triageIdx = 0; renderTriageCard(); openModal('triageOverlay');
}

function openTriageFor(id) {
  const item = inbox.find(t => t.id === id); if (!item) return;
  triageQueue = [item, ...inbox.filter(t => t.id !== id)]; triageIdx = 0;
  renderTriageCard(); openModal('triageOverlay');
}

function renderTriageCard() {
  const item = triageQueue[triageIdx]; if (!item) { closeTriage(); return; }
  g('triageProgress').textContent = `${triageIdx + 1} of ${triageQueue.length}`;
  const nameEl = g('triageTaskName'); nameEl.value = item.name; setTimeout(() => autoResize(nameEl), 0);
  g('triageTaskAge').textContent = TRIAGE_CAPTURED(fmtAgo(item.capturedAt));
  triageAgency = 'solo'; setTriageAgency('solo'); g('triageContextInput').value = '';
  const noteEl = g('triageNote'); noteEl.value = item.note || ''; noteEl.style.height = 'auto';
  setTimeout(() => { if (noteEl.value) autoResize(noteEl); }, 0);
  paintSliders(SLIDERS_TRG, 2, 2, 3);
  g('tImp').value = 2; g('tUrg').value = 2; g('tSim').value = 3;
  triagePreview();
}

function triagePreview() {
  const i = +g('tImp').value, u = +g('tUrg').value, s = +g('tSim').value;
  paintSliders(SLIDERS_TRG, i, u, s);
  const sc = calcScore(i, u, s), tier = getTier(sc);
  updateTriageOrb(sc, tier.key);
  g('tOrbTier').textContent = tierUI(tier.key).label; g('tOrbTier').style.color = tierUI(tier.key).color;
}

function triageSend() {
  const item = triageQueue[triageIdx]; if (!item) return;
  const name = (g('triageTaskName').value || '').trim() || item.name;
  const i = +g('tImp').value, u = +g('tUrg').value, s = +g('tSim').value;
  commitTask(() => {
    tasks.push(makeTask(item.id, name, i, u, s, triageAgency,
      (g('triageContextInput').value || '').trim(), g('triageNote').value || '', item.capturedAt));
    inbox = inbox.filter(t => t.id !== item.id);
  });
  triageQueue.splice(triageIdx, 1);
  if (!triageQueue.length) closeTriage(); else renderTriageCard();
  renderInbox(); render();
}

function flushTriageEdits() {
  const item = triageQueue[triageIdx]; if (!item) return;
  const name = (g('triageTaskName').value || '').trim();
  const note = (g('triageNote').value || '').trim();
  if (name) item.name = name;
  item.note = note;
  const inboxItem = inbox.find(t => t.id === item.id);
  if (inboxItem) { if (name) inboxItem.name = name; inboxItem.note = note; }
  save();
}

function triageSkip() {
  flushTriageEdits();
  triageQueue.push(triageQueue.splice(triageIdx, 1)[0]);
  if (triageIdx >= triageQueue.length) { closeTriage(); return; }
  renderTriageCard();
}

function triageDelete() {
  const item = triageQueue[triageIdx]; if (!item) return;
  inbox = inbox.filter(t => t.id !== item.id);
  triageQueue.splice(triageIdx, 1);
  if (!triageQueue.length) { closeTriage(); save(); renderInbox(); return; }
  if (triageIdx >= triageQueue.length) triageIdx = triageQueue.length - 1;
  save(); renderTriageCard(); renderInbox();
}

function closeTriage()  { flushTriageEdits(); closeModal('triageOverlay'); triageQueue = []; triageIdx = 0; }
function maybeTriage(e) { if (e.target === g('triageOverlay')) closeTriage(); }

// ─── PANEL ACCORDION ─────────────────────────────────────────────────────────

const PANEL_TABS = ['score', 'progress', 'links', 'agency'];
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
  const lv = g('pCtxLinksVal');    if (lv) lv.textContent = (t.links  || []).length;
  const av = g('pCtxAgencyVal');
  if (av) { av.textContent = AGENCY_LABELS[t.agency || 'solo'] || 'Mine'; }
}

// ─── PANEL ───────────────────────────────────────────────────────────────────

function openPanel(id) {
  activeId = id; addingBrick = false;
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
  const defaultTab = t && t.bricks && t.bricks.length > 0 ? 'progress'
                   : t && t.links  && t.links.length  > 0 ? 'links'
                   : 'score';
  openPanelTab(defaultTab);
}

function closePanel() {
  activeId = null; addingBrick = false;
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

// ─── HALO INLINE PICKER ─────────────────────────────────────────────────────

let haloPickerTaskId = null;

function haloShowPicker(taskId) {
  haloPickerTaskId = taskId;
  const task = byId(taskId); if (!task) return;
  const nameEl = g('haloPickerTask'); if (nameEl) nameEl.textContent = task.name;
  g('haloViewDeep').classList.add('halo-view-hidden');
  g('haloViewPicker').classList.remove('halo-view-hidden');
  // Highlight last-used duration
  document.querySelectorAll('.halo-picker-dur').forEach(btn => {
    btn.classList.toggle('halo-picker-dur--last', parseInt(btn.dataset.mins) === timerSelectedMins);
  });
}

function haloHidePicker() {
  haloPickerTaskId = null;
  g('haloViewDeep').classList.remove('halo-view-hidden');
  g('haloViewPicker').classList.add('halo-view-hidden');
}

function haloPickDuration(mins) {
  const taskId = haloPickerTaskId; if (!taskId) return;
  haloHidePicker();
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

function playCompletionChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.start(t); osc.stop(t + 0.7);
    });
  } catch(e) { /* audio not available — fail silently */ }
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
    playCompletionChime();
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

  // Halo card inline label (when task is current in deep view)
  const htl = g('haloTimerLabel'); if (htl) htl.textContent = label;
}

// Sync all surfaces to current timer state
function timerSyncAll() {
  const running = timerTaskId !== null;
  const task = running ? byId(timerTaskId) : null;

  // Session card replaces halo block + peek when running
  const sessionCard = g('haloSessionCard');
  const haloBlock   = g('haloBlock');
  const peekTrigger = g('peekTrigger');
  const peekDrawer  = g('peekDrawer');
  if (sessionCard) sessionCard.style.display = running ? 'block' : 'none';
  if (haloBlock)   haloBlock.style.display   = running ? 'none'  : '';
  if (peekTrigger) peekTrigger.style.display = running ? 'none'  : '';
  if (peekDrawer)  peekDrawer.style.display  = running ? 'none'  : '';

  // Update session card content
  if (running && task) {
    const ht = g('hscTask'); if (ht) ht.textContent = task.name;
    if (timerEndsAt) timerRenderCountdown(timerEndsAt - Date.now());
  }

  // Panel footer — only update if panel is open
  if (activeId) timerSyncFooter(activeId);

  // Re-render halo panel and board so card indicators update
  renderHaloPanel();
  if (tasks && tasks.length) render();
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
  const ids = { idle:'pfIdle', picking:'pfPicking', running:'pfRunning' };
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
    if (text) { addBrick(taskId, text); renderHaloPanel(); }
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

  applyAgencyUI('.panel .agency-btn', 'panelContextRow', 'panelContextInput', t.agency || 'solo');
  g('panelContextInput').value = t.context || '';

  // Drift / avoidance prompt
  const frac         = urgencyAgeFrac(t);
  const untouchedDays = Math.floor((Date.now() - lastTouchedTs(t)) / DAY_MS);
  const isAvoidance  = !t.done && t.bricks.length === 0 && t.s <= 2 && untouchedDays > 7;
  const prompt       = g('panelDriftPrompt');
  const keepBtn      = g('btnDriftKeep');
  const actionBtn    = g('btnDriftAction');
  const brickAction  = () => { addingBrick = true; renderPanelContent(activeId); };

  const setPrompt = (text, keepLbl, actionLbl, fn, cls) => {
    g('panelDriftText').textContent = text;
    keepBtn.textContent   = keepLbl;
    actionBtn.textContent = actionLbl;
    actionBtn.onclick     = fn;
    prompt.className = `panel-drift-prompt visible ${cls}`;
  };

  if (frac !== null && frac > 1) {
    const label = urgencyAgeLabel(t), inDeep = zoneFor(t) === 'deep';
    if (inDeep && isAvoidance) {
      setPrompt(`In Deep for ${untouchedDays} days — no dedicated block, no first action yet. What's the one thing you could do right now to start?`, DRIFT_KEEP_NOT_READY, DRIFT_ACTION_BRICK, brickTabAction, 'drift-deep-prompt');
    } else if (inDeep) {
      setPrompt(`Needs protected time — ${label} ${frac > 2 ? 'still without a dedicated block' : 'without a dedicated block'}. When are you scheduling this?`, DRIFT_KEEP_DEFAULT, DRIFT_ACTION_BLOCK, driftAction, 'drift-deep-prompt');
    } else {
      setPrompt(`Rated "${URG_WORDS[t.u]}" at creation — ${label}. This urgency is ${frac > 2 ? 'significantly overdue' : 'past its expected window'}. Still accurate?`, DRIFT_KEEP_ACCURATE, DRIFT_ACTION_REASSESS, driftAction, 'drift-flow');
    }
  } else if (isAvoidance) {
    setPrompt(`In ${zoneFor(t) === 'deep' ? 'Deep' : 'Flow'} for ${untouchedDays} days without a first action. What's the one concrete thing you could do to start?`, DRIFT_KEEP_NOT_READY, DRIFT_ACTION_BRICK, brickTabAction, 'drift-deep-prompt');
  } else {
    prompt.className = 'panel-drift-prompt'; actionBtn.onclick = driftAction;
  }

  g('pAvoidancePrompt').classList.remove('visible');
  if (isAvoidance && !addingBrick) addingBrick = true;

  paintSliders(SLIDERS_EDIT, t.i, t.u, t.s);
  g('eImp').value = t.i; g('eUrg').value = t.u; g('eSim').value = t.s;

  // Bricks display
  g('pBricksLabel').style.display = '';
  const br = g('pBricks'); br.innerHTML = '';
  g('pBrickDetail').classList.remove('show');

  const shown = t.bricks.slice(-20);
  if (t.bricks.length > shown.length) {
    const sp = document.createElement('span');
    sp.className = 'brick-overflow-count';
    sp.textContent = `+${t.bricks.length - shown.length}`; br.appendChild(sp);
  }
  shown.forEach(b => {
    const el = document.createElement('div'); el.className = 'brick-blk'; el.dataset.brickId = b.id;
    el.onclick = e => {
      e.stopPropagation();
      const detail = g('pBrickDetail'), wasOpen = el.classList.contains('selected');
      br.querySelectorAll('.brick-blk').forEach(x => x.classList.remove('selected'));
      if (wasOpen) { detail.classList.remove('show'); return; }
      el.classList.add('selected');
      g('pBrickDetailText').textContent = b.text;
      g('pBrickDetailTs').textContent   = fmtAgo(b.ts);
      g('pBrickDetailDel').onclick = ev => { ev.stopPropagation(); deleteBrick(t.id, b.id); };
      detail.classList.add('show');
    };
    br.appendChild(el);
  });
  for (let i = 0; i < Math.min(5, Math.max(0, 6 - shown.length)); i++) {
    const s = document.createElement('div'); s.className = 'brick-slot'; br.appendChild(s);
  }

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

  // Linked tasks section
  renderPanelLinks(id);
}

function renderPanelLinks(id) {
  const t = byId(id);
  const el = g('pLinkedTasks');
  if (!el) return;
  const links = (t.links || []);
  if (!links.length) {
    el.innerHTML = `<div class="panel-link-add"><span class="link-add-btn" data-action="open-link-search" data-id="${t.id}">+ Link to another task</span></div>`;
    return;
  }
  const befores = links.filter(l => l.type === 'after').map(l => byId(l.targetId)).filter(Boolean);
  const afters  = links.filter(l => l.type === 'before').map(l => byId(l.targetId)).filter(Boolean);
  let html = '';
  if (befores.length) {
    html += `<div class="panel-link-group-label">Pending on</div>`;
    html += befores.map(linked => {
      const col = TIER_HEX[linked.tier.key] || 'var(--muted)';
      return `<div class="panel-link-chip before-chip">
        <span class="plc-dot" style="background:${col}"></span>
        <span class="plc-name" data-action="open-panel" data-id="${linked.id}">${esc(linked.name)}</span>
        <button class="plc-go" data-action="open-panel" data-id="${linked.id}">Go →</button>
        <button class="plc-unlink" data-action="unlink-tasks" data-id="${t.id}" data-targetid="${linked.id}">×</button>
      </div>`;
    }).join('');
  }
  if (afters.length) {
    html += `<div class="panel-link-group-label">Required for</div>`;
    html += afters.map(linked => {
      const col = TIER_HEX[linked.tier.key] || 'var(--muted)';
      return `<div class="panel-link-chip after-chip">
        <span class="plc-dot" style="background:${col}"></span>
        <span class="plc-name" data-action="open-panel" data-id="${linked.id}">${esc(linked.name)}</span>
        <button class="plc-go" data-action="open-panel" data-id="${linked.id}">Go →</button>
        <button class="plc-unlink" data-action="unlink-tasks" data-id="${t.id}" data-targetid="${linked.id}">×</button>
      </div>`;
    }).join('');
  }
  html += `<div class="panel-link-add"><span class="link-add-btn" data-action="open-link-search" data-id="${t.id}">+ Link to another task</span></div>`;
  el.innerHTML = html;
}

function updateEditPreview() {
  const t = byId(activeId); if (!t) return;
  const i = +g('eImp').value, u = +g('eUrg').value, s = +g('eSim').value;
  paintSliders(SLIDERS_EDIT, i, u, s);
  const newSc = calcScore(i, u, s), newTier = getTier(newSc), delta = newSc - t.sc;
  const changed = i !== t.i || u !== t.u || s !== t.s;
  const bar = g('pScoreBar');
  if (changed) {
    g('pScoreFrom').textContent     = t.sc;          g('pScoreFrom').style.color     = tierUI(t.tier.key).color;
    g('pScoreFromTier').textContent = tierUI(t.tier.key).label;   g('pScoreFromTier').style.color = tierUI(t.tier.key).color;
    g('pScoreTo').textContent       = newSc;          g('pScoreTo').style.color       = newTier.color;
    g('pScoreToTier').textContent   = newTier.label;  g('pScoreToTier').style.color   = newTier.color;
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

function commitContextEdit() {
  const t = byId(activeId); if (!t) return;
  commitTask(() => { t.context = (g('panelContextInput').value || '').trim(); });
}

// ─── DRIFT ACTIONS ───────────────────────────────────────────────────────────

function keepUrgency() {
  const t = byId(activeId); if (!t) return;
  commitTask(() => { t.urgencyAckedAt = Date.now(); });
  renderBoardCard(activeId);
  // Just hide the prompt — no full re-render needed
  const prompt = g('panelDriftPrompt');
  if (prompt) prompt.className = 'panel-drift-prompt';
}

function driftAction() {
  const t = byId(activeId); if (!t) return;
  // Open Score tab and scroll to urgency slider
  openPanelTab('score');
  setTimeout(() => {
    const el = g('eUrg'); if (!el) return;
    el.scrollIntoView({ behavior:'smooth', block:'nearest' });
    const row = el.closest('.cslider-row');
    if (row) {
      row.style.transition = 'background .15s';
      row.style.background = zoneFor(t) === 'deep' ? 'rgba(99,102,241,.10)' : 'rgba(245,158,11,.09)';
      setTimeout(() => { row.style.background = ''; }, 700);
    }
  }, 60);
}

// Drop a brick action — opens bricks tab directly
function brickTabAction() {
  openPanelTab('progress');
}
// ─── DONE MODAL ──────────────────────────────────────────────────────────────

function openDoneModal(zone) {
  doneModalZone = zone;
  const done = buildZones(tasks)[zone].filter(t => t.done); if (!done.length) return;
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

// ─── HYGIENE MODALS ──────────────────────────────────────────────────────────

function renderModalList(listId, emptyId, items, rowFn) {
  const listEl = g(listId), emptyEl = g(emptyId);
  listEl.innerHTML = '';
  if (!items.length) { listEl.classList.add('hidden'); emptyEl.classList.remove('hidden'); }
  else { listEl.classList.remove('hidden'); emptyEl.classList.add('hidden'); items.forEach(t => listEl.appendChild(rowFn(t))); }
}

function dbRow(cls, t, dotColor, meta, age, btnClass, btnLabel, btnAction) {
  const row = document.createElement('div'); row.className = cls;
  row.innerHTML = `
    <div class="db-tier-dot" style="background:${dotColor}"></div>
    <div class="db-task-body">
      <div class="db-task-name">${esc(t.name)}</div>
      <div class="db-task-meta">${meta}</div>
      <div class="db-task-age">${age}</div>
    </div>
    <button class="${btnClass}" data-action="${btnAction}" data-id="${t.id}">${btnLabel}</button>`;
  return row;
}

// Drift Box
function getDriftBoxTasks() {
  return tasks.filter(t => {
    if (t.done || (t.u !== 2 && t.u !== 3)) return false;
    const base = DRIFT_BOX_THRESHOLD[t.u] * DAY_MS;
    return Date.now() - lastTouchedTs(t) > (t.agency === 'waiting' ? base * 2 : base);
  }).sort((a, b) => lastTouchedTs(a) - lastTouchedTs(b));
}

function updateDriftBoxBadge() {
  const n = getDriftBoxTasks().length;
  g('driftBoxCount').textContent = n; g('btnDriftBox').classList.toggle('hidden', n === 0);
}

function openDriftBox() {
  renderModalList('driftBoxList', 'driftBoxEmpty', getDriftBoxTasks(), t => {
    const stale = Math.floor((Date.now() - lastTouchedTs(t)) / DAY_MS);
    const thr   = DRIFT_BOX_THRESHOLD[t.u] * (t.agency === 'waiting' ? 2 : 1);
    const ov    = stale - thr, lbl = URG_WORDS[t.u];
    const age   = ov < 1 ? `just past ${lbl} threshold` : ov < 7 ? `${ov}d past ${lbl} threshold` : `${Math.floor(ov/7)}w past ${lbl} threshold`;
    const row   = dbRow('db-task-row', t, TIER_HEX[t.tier.key]||'var(--muted)',
      `Rated ${lbl} · score ${t.sc} · ${tierUI(t.tier.key).label.replace(/[^\x20-\x7E]/g,'').trim()}`,
      age, 'db-reassess', 'Reassess ↓', 'drift-box-reassess');
    row.querySelector('.db-task-age').classList.toggle('age-warn', ov <= 14);
    return row;
  });
  openModal('driftBoxOverlay');
}

function closeDriftBox()       { closeModal('driftBoxOverlay'); }
function maybeCloseDriftBox(e) { if (e.target === g('driftBoxOverlay')) closeDriftBox(); }
function driftBoxReassess(id)  { closeDriftBox(); openPanel(id); setTimeout(driftAction, 120); }

// Fire Modal
function getFireTasks() { return tasks.filter(t => !t.done && t.tier?.key === 'fire').sort((a,b) => b.sc-a.sc); }

function openFireModal() {
  renderModalList('fireModalList', 'fireModalEmpty', getFireTasks(), t => {
    const days = Math.floor((Date.now() - lastTouchedTs(t)) / DAY_MS);
    const bc   = t.bricks.length, zone = zoneFor(t);
    return dbRow('fire-task-row', t, TIER_HEX[t.tier.key]||'var(--fire)',
      `Score ${t.sc} · ${zone==='deep'?'Deep':zone==='flow'?'Flow':'Drift'} · ${bc===0?'no bricks yet':bc===1?'1 brick':`${bc} bricks`}`,
      days===0?'touched today':days===1?'1d untouched':`${days}d untouched`,
      'fire-open-btn', 'Open →', 'fire-modal-open');
  });
  openModal('fireOverlay');
}

function closeFireModal()  { closeModal('fireOverlay'); }
function maybeCloseFire(e) { if (e.target === g('fireOverlay')) closeFireModal(); }
function fireModalOpen(id) { closeFireModal(); openPanel(id); }

// Stuck Modal
function getStuckTasks() {
  return tasks.filter(t => !t.done && zoneFor(t)==='deep' && t.s<=2 && t.bricks.length===0 && Date.now()-lastTouchedTs(t)>7*DAY_MS)
    .sort((a,b) => lastTouchedTs(a)-lastTouchedTs(b));
}

function openStuckModal() {
  renderModalList('stuckModalList', 'stuckModalEmpty', getStuckTasks(), t => {
    const days = Math.floor((Date.now() - lastTouchedTs(t)) / DAY_MS);
    return dbRow('stuck-task-row', t, TIER_HEX[t.tier.key]||'var(--accent)',
      `Score ${t.sc} · ${tierUI(t.tier.key).label.replace(/[^\x20-\x7E]/g,'').trim()} · ${SIM_WORDS[t.s]||''}`,
      `${days===1?'1d':`${days}d`} in Deep without a start`,
      'stuck-brick-btn', 'Drop a brick →', 'stuck-modal-brick');
  });
  openModal('stuckOverlay');
}

function closeStuckModal()  { closeModal('stuckOverlay'); }
function maybeCloseStuck(e) { if (e.target === g('stuckOverlay')) closeStuckModal(); }
function stuckModalBrick(id) {
  closeStuckModal(); openPanel(id);
  setTimeout(() => { const cta = g('pBrickCta'); if (cta) cta.scrollIntoView({ behavior:'smooth', block:'center' }); }, 180);
}

// Parked Review
function getParkedStaleTasks() {
  return tasks.filter(t => !t.done && zoneFor(t)==='drift' && Date.now()-lastTouchedTs(t)>PARKED_STALE_MS)
    .sort((a,b) => lastTouchedTs(a)-lastTouchedTs(b));
}

function updateParkedBadge() {
  const n=getParkedStaleTasks().length, btn=g('mvParkedBadge'), cnt=g('mvParkedStaleCount');
  if (btn && cnt) { cnt.textContent=n; btn.classList.toggle('hidden',n===0); btn.style.display=n===0?'none':''; }
}

function openParkedReview() {
  renderModalList('parkedList', 'parkedEmpty', getParkedStaleTasks(), t => {
    const days=Math.floor((Date.now()-lastTouchedTs(t))/DAY_MS);
    const row=document.createElement('div'); row.className='pr-task-row';
    row.innerHTML = `
      <div class="pr-tier-dot" style="background:${TIER_HEX[t.tier.key]||'var(--muted)'}"></div>
      <div class="pr-body">
        <div class="pr-name">${esc(t.name)}</div>
        <div class="pr-meta">Score ${t.sc} · ${tierUI(t.tier.key).label.replace(/[^\x20-\x7E]/g,'').trim()}</div>
        <div class="pr-age">${days>=60?`${Math.floor(days/30)} months parked`:`${days} days parked`}</div>
      </div>
      <div class="pr-btns">
        <button class="pr-btn"     data-action="parked-reassess" data-id="${t.id}">Reassess</button>
        <button class="pr-btn del" data-action="parked-delete"   data-id="${t.id}">Delete</button>
      </div>`;
    return row;
  });
  openModal('parkedOverlay');
}

function closeParkedReview() { closeModal('parkedOverlay'); }
function maybeCloseParked(e) { if (e.target === g('parkedOverlay')) closeParkedReview(); }
function parkedReassess(id)  { closeParkedReview(); openPanel(id); }
function parkedDelete(id) {
  commitTask(() => { tasks = tasks.filter(t => t.id !== id); });
  render();
  if (!g('parkedOverlay').classList.contains('hidden')) openParkedReview();
}

// ─── BOARD BADGES ────────────────────────────────────────────────────────────

function setBadge(id, count, label) {
  const el = g(id); if (!el) return;
  el.textContent = label; el.classList.toggle('hidden', count === 0);
}

function updateBoardBadges() {
  const active = tasks.filter(t => !t.done), now = Date.now();
  const fire   = active.filter(t => t.tier?.key === 'fire').length;
  const stuck  = active.filter(t => zoneFor(t)==='deep' && t.s<=2 && t.bricks.length===0 && now-lastTouchedTs(t)>7*DAY_MS).length;
  setBadge('bzFireBadge',       fire,  BADGE_FIRE(fire));
  setBadge('bzActivationBadge', stuck, BADGE_STUCK(stuck));
  // Update header button count
  const countEl = g('boardCount'); if (countEl) countEl.textContent = active.length;
  // Update board panel subtitle
  const subEl = g('boardPanelSub');
  if (subEl) {
    const zones = buildZones(tasks);
    const fl = zones.flow.filter(t=>!t.done).length;
    const dp = zones.deep.filter(t=>!t.done).length;
    const dr = zones.drift.filter(t=>!t.done).length;
    subEl.textContent = `${active.length} active · Flow ${fl} · Deep ${dp} · Drift ${dr}`;
  }
}

// ─── HALO PANEL ──────────────────────────────────────────────────────────────

// Returns { state:'warn'|'affirm'|'suppress', days:string }
function getStreakState() {
  const deepTasks = tasks.filter(t => zoneFor(t) === 'deep');
  // Last Deep brick across all Deep tasks (session progress signal)
  const allDeepBrickTs = deepTasks.flatMap(t => (t.bricks || []).map(b => b.ts));
  // Last completed Deep task
  const deepDoneTs = tasks.filter(t => t.done && zoneFor(t) === 'deep' && t.doneAt).map(t => t.doneAt);
  const allTs = [...allDeepBrickTs, ...deepDoneTs];
  if (!allTs.length) return { state:'warn', days:'a while' };
  const lastTs = Math.max(...allTs);
  const msAgo = Date.now() - lastTs;
  const daysAgo = Math.floor(msAgo / DAY_MS);
  if (msAgo < DAY_MS)        return { state:'suppress' };
  if (msAgo < 3 * DAY_MS)   return { state:'affirm', days: daysAgo <= 1 ? 'yesterday' : `${daysAgo} days` };
  return { state:'warn', days: `${daysAgo} days` };
}

// Returns the best Deep task to surface, cycling infinitely
function pickDeepTask() {
  const pool = tasks.filter(t => !t.done && zoneFor(t) === 'deep');
  if (!pool.length) return null;
  const available = pool.filter(t => !haloDeepSkipped.includes(t.id));
  // All tasks seen — reset and start again (infinite cycle)
  if (!available.length) haloDeepSkipped = [];
  const candidates = pool.filter(t => !haloDeepSkipped.includes(t.id));
  // Avoidance-first: untouched 7+ days, no bricks, then score desc
  const untouched = candidates.filter(t => t.bricks.length === 0 && Date.now() - lastTouchedTs(t) > 7 * DAY_MS);
  if (untouched.length) return untouched.sort((a,b) => b.sc - a.sc)[0];
  return candidates.sort((a,b) => b.sc - a.sc)[0];
}

// Returns 3 flow slots: [highScore+avoidance, highScore, wildcard]
function pickFlowSlots() {
  const pool = tasks.filter(t => !t.done && zoneFor(t) === 'flow');
  if (!pool.length) return [];
  const byScore = [...pool].sort((a,b) => b.sc - a.sc);
  // Slot 1: highest score + untouched 7+ days
  const avoided = byScore.filter(t => Date.now() - lastTouchedTs(t) > 7 * DAY_MS);
  const slot1 = avoided.length ? avoided[0] : byScore[0];
  // Slot 2: highest score, not slot1
  const slot2 = byScore.find(t => t.id !== slot1.id) || null;
  // Slot 3: wildcard — most untouched mid-priority (not already picked)
  const picked = new Set([slot1.id, slot2?.id].filter(Boolean));
  const wildPool = pool.filter(t => !picked.has(t.id));
  const wildcard = wildPool.length
    ? wildPool.sort((a,b) => lastTouchedTs(a) - lastTouchedTs(b))[0]
    : null;
  return [slot1, slot2, wildcard].filter(Boolean);
}

function renderHaloPanel() {
  // Reset picker state on re-render
  haloPickerTaskId = null;
  const vDeep = g('haloViewDeep'); const vPick = g('haloViewPicker');
  if (vDeep) vDeep.classList.remove('halo-view-hidden');
  if (vPick) vPick.classList.add('halo-view-hidden');
  // ── streak banner — hide when timer running ──
  const streak = getStreakState();
  const streakEl = g('haloStreak'), dotEl = g('haloStreakDot'), textEl = g('haloStreakText');
  if (streak.state === 'suppress' || timerTaskId) {
    streakEl.classList.add('hidden');
  } else {
    streakEl.classList.remove('hidden');
    if (streak.state === 'warn') {
      streakEl.className = 'halo-streak halo-streak-warn';
      dotEl.className    = 'halo-streak-dot halo-streak-dot-warn';
      textEl.textContent = HALO_STREAK_WARN(streak.days);
    } else {
      streakEl.className = 'halo-streak halo-streak-affirm';
      dotEl.className    = 'halo-streak-dot halo-streak-dot-affirm';
      textEl.textContent = HALO_STREAK_AFFIRM(streak.days);
    }
  }

  // ── deep halo card ──
  const task = pickDeepTask();
  haloDeepCurrent = task;
  const card = g('haloCard');

  if (!task) {
    card.innerHTML = `<div class="halo-empty">${HALO_EMPTY_DEEP}</div>`;
  } else {
    const untouchedDays = Math.floor((Date.now() - lastTouchedTs(task)) / DAY_MS);
    let pillHtml = `<span class="halo-pill halo-pill-tier" style="background:${TIER_HEX[task.tier.key]||'#888'};color:#fff">${tierUI(task.tier.key).label}</span>`;
    if (streak.state === 'suppress') {
      pillHtml += `<span class="halo-pill halo-pill-today">${HALO_PILL_DONE_TODAY}</span>`;
    } else if (streak.state === 'affirm' && task.bricks.length > 0) {
      pillHtml += `<span class="halo-pill halo-pill-progress">${HALO_PILL_IN_PROGRESS}</span>`;
    } else if (untouchedDays >= 1) {
      pillHtml += `<span class="halo-pill halo-pill-age">${HALO_PILL_UNTOUCHED(untouchedDays)}</span>`;
    }
    const r = 15, circ = 2 * Math.PI * r, dash = (task.sc / 100) * circ;
    card.innerHTML = `
      <div class="halo-card" id="haloCardInner">
        <div class="halo-card-top">
          <div class="halo-card-eyebrow">${HALO_EYEBROW}</div>
          <div class="halo-card-orb">
            <svg viewBox="0 0 38 38" width="38" height="38">
              <circle cx="19" cy="19" r="${r}" fill="none" stroke="var(--border2)" stroke-width="2.5"/>
              <circle cx="19" cy="19" r="${r}" fill="none" stroke="var(--accent)" stroke-width="2.5"
                stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round"
                transform="rotate(-90 19 19)"/>
            </svg>
            <div class="halo-orb-num">${task.sc}</div>
          </div>
          <div class="halo-card-name"><button class="halo-card-name-btn" data-action="halo-open" data-id="${task.id}">${esc(task.name)}</button></div>
          <div class="halo-card-pills">${pillHtml}</div>
        </div>
        ${timerTaskId === task.id ? `<div class="halo-timer-running"><span class="halo-timer-dot"></span><span class="halo-timer-label" id="haloTimerLabel">–:–</span><button class="halo-timer-stop" data-action="timer-stop">Stop</button></div>` : `<button class="halo-btn-start" data-action="halo-start" data-id="${task.id}">${HALO_START_BTN}</button>`}
        <div class="halo-secondary-row">
          <button class="halo-btn-another" id="btnHaloAnother">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
            ${HALO_TRY_ANOTHER}
          </button>
        </div>
      </div>`;
    g('btnHaloAnother').addEventListener('click', () => {
      if (haloDeepCurrent) haloDeepSkipped.push(haloDeepCurrent.id);
      renderHaloPanel();
    });
  }

  // ── peek drawer (flow slots) ──
  renderPeekDrawer();
}

function renderPeekDrawer() {
  const slots = pickFlowSlots();
  const triggerText = g('peekTriggerText');
  const peekCountEl = g('peekCount');
  const inner = g('peekDrawerInner');

  if (!slots.length) {
    g('peekTrigger').style.display = 'none';
    g('peekDrawer').style.display  = 'none';
    return;
  }

  // Don't restore peek visibility if timer is running — timerSyncAll owns that
  if (!timerTaskId) {
    g('peekTrigger').style.display = '';
    g('peekDrawer').style.display  = '';
  }
  triggerText.textContent = `${slots.length} Flow task${slots.length !== 1 ? 's' : ''} ready`;
  peekCountEl.textContent = `+${slots.length}`;

  inner.innerHTML = slots.map((task, idx) => {
    const isWildcard = idx === 2;
    const untouchedDays = Math.floor((Date.now() - lastTouchedTs(task)) / DAY_MS);
    const scCls = isWildcard ? 'peek-sc peek-sc-wild' : 'peek-sc';
    let meta = '';
    if (isWildcard) meta += `<span class="peek-wild-tag">${HALO_WILDCARD_EYEBROW}</span><span>·</span>`;
    meta += `<span>${tierUI(task.tier.key).label}</span>`;
    if (untouchedDays >= 1) meta += `<span>·</span><span>${HALO_PILL_UNTOUCHED(untouchedDays)}</span>`;
    return `
      <div class="peek-row" data-action="halo-open" data-id="${task.id}">
        <div class="${scCls}">${task.sc}</div>
        <div class="peek-row-body">
          <div class="peek-row-name">${esc(task.name)}</div>
          <div class="peek-row-meta">${meta}</div>
        </div>
        ${timerTaskId === task.id ? `<span class="peek-row-running"><span class="halo-timer-dot"></span> running</span>` : `<button class="peek-row-start" data-action="halo-open" data-id="${task.id}">${HALO_FLOW_START_BTN}</button>`}
      </div>`;
  }).join('');
}

// ─── BOARD PANEL ─────────────────────────────────────────────────────────────

function openBoardPanel(focusCapture) {
  boardPanelOpen = true;
  g('boardPanel').classList.add('open');
  g('actPage').classList.add('board-open');
  g('btnBoard').classList.add('active');
  if (focusCapture) setTimeout(() => g('quickInput').focus(), 60);
}

function closeBoardPanel() {
  boardPanelOpen = false;
  g('boardPanel').classList.remove('open');
  g('actPage').classList.remove('board-open');
  g('btnBoard').classList.remove('active');
}

function toggleBoardPanel() {
  if (boardPanelOpen) closeBoardPanel(); else openBoardPanel(false);
}

// ─── DRIFT DRAWER ─────────────────────────────────────────────────────────────

let driftDrawerOpen = false;

function toggleDriftDrawer() {
  driftDrawerOpen ? closeDriftDrawer() : openDriftDrawer();
}

function openDriftDrawer() {
  driftDrawerOpen = true;
  g('mvDriftDrawer').classList.add('open');
  g('btnDriftShow').textContent = '↓ hide';
}

function closeDriftDrawer() {
  driftDrawerOpen = false;
  g('mvDriftDrawer').classList.remove('open');
  g('btnDriftShow').textContent = '↑ show';
}
// ─── PEEK DRAWER ─────────────────────────────────────────────────────────────

function togglePeek() {
  peekOpen = !peekOpen;
  g('peekDrawer').classList.toggle('open', peekOpen);
  g('peekChevron').classList.toggle('open', peekOpen);
}

// ─── RENDER ──────────────────────────────────────────────────────────────────

function render() {
  updateBoardBadges(); updateDriftBoxBadge(); updateParkedBadge(); renderMoodView();
  if (activeId && byId(activeId)) renderPanelContent(activeId);
}

// ─── MOOD VIEW ───────────────────────────────────────────────────────────────

function renderMoodView() {
  const zones = buildZones(tasks);
  Object.values(zones).forEach(arr => arr.sort((a,b) => a.done !== b.done ? (a.done?1:-1) : b.sc-a.sc));
  const split = arr => ({ active:arr.filter(t=>!t.done), done:arr.filter(t=>t.done) });
  const fl=split(zones.flow), dp=split(zones.deep), dr=split(zones.drift);

  // Flow
  g('mvFlowCount').textContent = fl.active.length + ' tasks';
  const flowList = g('mvFlowList');
  flowList.innerHTML = fl.active.length
    ? fl.active.map(mvFlowCardHtml).join('')
    : `<div class="mv-empty">${EMPTY_FLOW}</div>`;
  flowList.querySelectorAll('.mv-flow-card').forEach((c,i) => c.style.animationDelay = (i*.04)+'s');
  setDoneBadge('mvFlowDone', fl.done.length);

  // Deep treemap
  g('mvDeepCount').textContent = dp.active.length + ' tasks';
  const treemap = g('mvDeepTreemap');
  if (!dp.active.length) {
    treemap.innerHTML = `<div class="mv-empty">${EMPTY_DEEP}</div>`;
  } else {
    // Top 6 → proportional treemap (fixed height, always visible)
    // Remainder → compact pastel list that scrolls below
    const TREEMAP_CAP = 10;
    const treemapTasks = dp.active.slice(0, TREEMAP_CAP);
    const listTasks    = dp.active.slice(TREEMAP_CAP);
    const total = treemapTasks.reduce((s,t) => s+scoreWeight(t), 0) || 1;
    let html = '<div class="mv-tm-rows">';
    let i = 0;
    while (i < treemapTasks.length) {
      const t1=treemapTasks[i], t2=treemapTasks[i+1], w1=scoreWeight(t1);
      if (!t2 || w1 > total*0.45) {
        html += `<div class="mv-tm-row" style="flex:${Math.max(w1/total*treemapTasks.length,.7).toFixed(2)}">${mvDeepCellHtml(t1,1)}</div>`; i++;
      } else {
        const w2=scoreWeight(t2);
        html += `<div class="mv-tm-row" style="flex:${Math.max((w1+w2)/total*treemapTasks.length,.7).toFixed(2)}">${mvDeepCellHtml(t1,(w1/(w1+w2)*2).toFixed(2))}${mvDeepCellHtml(t2,(w2/(w1+w2)*2).toFixed(2))}</div>`; i+=2;
      }
    }
    html += '</div>';
    if (listTasks.length) {
      html += `<div class="mv-tm-list">${listTasks.map(mvDeepListCardHtml).join('')}</div>`;
    }
    treemap.innerHTML = html;
    treemap.querySelectorAll('.mv-tm-cell').forEach((c,i) => c.style.animationDelay=(i*.06)+'s');
    requestAnimationFrame(() => treemap.querySelectorAll('.mv-tm-cell').forEach(cell => {
      const h=cell.offsetHeight;
      cell.classList.remove('mv-sz-compact','mv-sz-minimal','mv-sz-tiny');
      if (h<50) cell.classList.add('mv-sz-tiny'); else if (h<72) cell.classList.add('mv-sz-minimal');
      // mv-sz-compact intentionally removed — at 72px+ full content always fits
    }));
  }
  setDoneBadge('mvDeepDone', dp.done.length);

  // Drift
  g('mvDriftCount').textContent = dr.active.length + ' parked';
  const di = g('mvDriftInner');
  di.innerHTML = dr.active.length ? dr.active.map(mvDriftChipHtml).join('')
    : `<div class="mv-empty-drift">${EMPTY_DRIFT}</div>`;
  di.querySelectorAll('.mv-drift-chip').forEach((c,i) => c.style.animationDelay=(i*.03)+'s');
  setDoneBadge('mvDriftDone', dr.done.length);
}

function setDoneBadge(id, count) {
  const el=g(id); if (!el) return;
  el.style.display=count?'inline':'none'; el.textContent=`✓ ${count} done`;
}

// ─── CARD HTML ───────────────────────────────────────────────────────────────

function agenceBadgeHtml(t) {
  if (t.agency === 'shared')  return ' <span class="card-badge badge-shared">🤝 shared</span>';
  if (t.agency === 'waiting') {
    const days = Math.floor((Date.now()-lastTouchedTs(t))/DAY_MS);
    return ` <span class="card-badge badge-waiting">⏸ waiting${days>=1?` · ${days}d`:''}</span>`;
  }
  return '';
}

function driftHtml(t, forceDeep) {
  const frac=urgencyAgeFrac(t); if (frac===null||frac<=1) return {bar:'',label:''};
  const pct=Math.min((frac-1)/2*100,100), inDeep=forceDeep||zoneFor(t)==='deep', sev=frac>2;
  const barCls  = inDeep?'drift-deep'     :(sev?'drift-red'     :'drift-amber');
  const textCls = inDeep?'drift-deep-text':(sev?'drift-red-text':'drift-amber-text');
  const lbl=urgencyAgeLabel(t);
  return { bar:`<div class="drift-bar ${barCls}" style="width:${pct.toFixed(1)}%"></div>`, label:lbl?`<div class="cd ${textCls}">${lbl}</div>`:'' };
}

function cardInnerHtml(t, bc, badge, drift, style) {
  return `<div class="ci"${style?` style="${style}"`:''}>`
    + `<div class="cs" style="color:${tierUI(t.tier.key).color}">${t.sc} · ${tierUI(t.tier.key).label}</div>`
    + `<div class="cn${t.done?' strike':''}">${esc(t.name)}${badge}${t.note?'<span class="note-dot" title="Has note"></span>':''}</div>`
    + `<div class="ck">${tierUI(t.tier.key).nudge}</div>`
    + (bc>0?`<div class="cb">🧱 ${bc} brick${bc>1?'s':''}</div>`:'')
    + drift.label;
}

function cardHtml(t) {
  const bc=t.bricks.length, badge=agenceBadgeHtml(t), drift=driftHtml(t,false);
  const un=(Date.now()-lastTouchedTs(t))/DAY_MS;
  const isAv=!t.done&&bc===0&&t.s<=2&&un>7, isFB=!t.done&&bc===0&&!isAv&&un>7;
  const linkBadge = cardLinkBadgeHtml(t);
  const isPending = !t.done && (t.links||[]).some(l => l.type==='after' && byId(l.targetId) && !byId(l.targetId).done);
  return `
  <div class="task-card ${sizeClass(t.sc)} tier-${t.tier.key}${t.done?' done-card':''}${t.agency==='waiting'?' card-waiting':''}${isAv?' card-avoidance':isFB?' card-first-brick-gap':''}${isPending?' card-blocked':''}"
       draggable="true" data-id="${t.id}" data-action="open-panel">
    <div class="drag-handle" title="Drag to move">⠿</div>
    <button class="card-check${t.done?' is-done':''}" data-action="toggle-done" data-id="${t.id}" title="${t.done?'Reopen':'Mark done'}"></button>
    ${cardInnerHtml(t,bc,badge+linkBadge,drift,'padding-right:36px;padding-left:16px')}
    ${isAv?`<div class="card-never-started">Never started · ${Math.floor(un)}d in ${zoneFor(t)==='deep'?'Deep':'Flow'}</div>`:''}
    </div>${drift.bar}
  </div>`;
}

function cardLinkBadgeHtml(t) {
  const links = t.links || [];
  // "required" — this task is a prerequisite for at least one undone task
  const isRequired = links.some(l => l.type === 'before' && byId(l.targetId) && !byId(l.targetId).done);
  // "pending" — this task has an undone prerequisite
  const isPending  = links.some(l => l.type === 'after'  && byId(l.targetId) && !byId(l.targetId).done);
  if (isRequired) return ' <span class="card-badge badge-required">required</span>';
  if (isPending)  return ' <span class="card-badge badge-pending">pending</span>';
  return '';
}

// Compact single-line card for Flow (and Deep list fallback)
// Badge logic: bricks takes priority over link dependency — one badge max
function mvCardBadgeHtml(t) {
  const bc = t.bricks ? t.bricks.length : 0;
  if (bc > 0) return `<span class="mv-fc-badge badge-bricks">🧱 ${bc}</span>`;
  const links = t.links || [];
  const isRequired = links.some(l => l.type === 'before' && byId(l.targetId) && !byId(l.targetId).done);
  const isPending  = links.some(l => l.type === 'after'  && byId(l.targetId) && !byId(l.targetId).done);
  if (isRequired) return `<span class="mv-fc-badge badge-required">→</span>`;
  if (isPending)  return `<span class="mv-fc-badge badge-pending">⏸</span>`;
  return '';
}

function mvFlowCardHtml(t, zone) {
  zone = zone || 'flow';
  const hex = TIER_HEX[t.tier.key] || 'var(--muted)';
  const badge = mvCardBadgeHtml(t);
  return `<div class="mv-flow-card" draggable="true" data-zone="${zone}" data-id="${t.id}" data-action="open-panel"
    style="animation-delay:0s">
    <div class="mv-fc" style="border-left-color:${hex}">
      <span class="mv-fc-name${t.done?' strike':''}">${esc(t.name)}</span>
      ${badge}
      ${timerTaskId === t.id ? '<span class="card-timer-dot" title="Block running"></span>' : ''}
      <span class="mv-fc-score">${t.sc}</span>
    </div>
  </div>`;
}

// Shared style computation for Deep treemap and list cards
function deepCardStyle(t) {
  const hex = TIER_HEX[t.tier.key] || '#6366F1';
  const rgb = hexRgb(hex);
  return { hex, softBg:`rgba(${rgb},.09)`, border:`rgba(${rgb},.22)` };
}

// Treemap cell for Deep — top border in tier color, pastel fill, name + score only
function mvDeepCellHtml(t, flexW) {
  const { hex, softBg, border } = deepCardStyle(t);
  return `
  <div class="mv-tm-cell" style="flex:${flexW}" data-id="${t.id}" data-zone="deep" draggable="true" data-action="open-panel">
    <div class="mv-tm-card${t.done?' done-card':''}"
         style="background:${softBg};border:1px solid ${border};border-top-color:${hex}">
      <div class="mv-tm-inner">
        <div class="mv-tm-name">${esc(t.name)}${timerTaskId === t.id ? '<span class="card-timer-dot card-timer-dot--tm" title="Block running"></span>' : ''}</div>
        <div class="mv-tm-score">${t.sc}</div>
      </div>
    </div>
  </div>`;
}

// Compact list card for Deep overflow — pastel bg + left tier border, matches treemap aesthetic
function mvDeepListCardHtml(t) {
  const { hex, softBg, border } = deepCardStyle(t);
  const badge = mvCardBadgeHtml(t);
  return `<div class="mv-flow-card" draggable="true" data-zone="deep" data-id="${t.id}" data-action="open-panel">
    <div class="mv-fc" style="border-left-color:${hex};background:${softBg};border-color:${border};border-left-color:${hex}">
      <span class="mv-fc-name${t.done?' strike':''}">${esc(t.name)}</span>
      ${badge}
      <span class="mv-fc-score">${t.sc}</span>
    </div>
  </div>`;
}
function mvDriftChipHtml(t) {
  return `<div class="mv-drift-chip" draggable="true" data-id="${t.id}" data-zone="drift" data-action="open-panel">
    ${esc(t.name)}${t.note?'<span class="note-dot"></span>':''}
    <span class="mv-dc-score">${t.sc}</span>
    <div class="mv-dchip-check" data-action="toggle-done" data-id="${t.id}" title="Mark done">✓</div>
  </div>`;
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
    case 'open-triage-for':  openTriageFor(id);                             break;
    case 'delete-inbox':     e.stopPropagation(); deleteInboxItem(id);      break;
    case 'select-search':    selectSearchResult(id);                        break;
    case 'open-trophy':      openTrophy(id);                                break;
    case 'reopen-from-done': e.stopPropagation(); reopenFromDone(id);       break;
    case 'parked-reassess':  parkedReassess(id);                            break;
    case 'parked-delete':    parkedDelete(id);                              break;
    case 'halo-open':        openPanel(id);                                 break;
    case 'halo-start':       haloShowPicker(id);                            break;
    case 'halo-pick-dur':    haloPickDuration(parseInt(el.dataset.mins));   break;
    case 'halo-pick-cancel': haloHidePicker();                              break;
    case 'timer-stop':       timerStop(false);                              break;
    case 'scroll-to-board':    openBoardPanel(false);                       break;
    case 'drift-box-reassess': driftBoxReassess(id);                        break;
    case 'fire-modal-open':    fireModalOpen(id);                            break;
    case 'stuck-modal-brick':  stuckModalBrick(id);                         break;
    case 'open-link-search':   openLinkSearch(id);                          break;
    case 'ls-select':          selectLinkResult(+el.dataset.idx);           break;
    case 'unlink-tasks':       unlinkTasks(id, +el.dataset.targetid);       break;
  }
});

// ─── DRAG & DROP ─────────────────────────────────────────────────────────────

document.addEventListener('dragstart', e => {
  let row = e.target.closest('[data-id][data-zone]');
  if (!row) { const card=e.target.closest('.task-card[data-id]'); if (card) { const w=card.closest('[data-zone]'); if (w) row=w; } }
  if (!row) return;
  if (e.target.closest('.card-check,.mv-dchip-check')) { e.preventDefault(); return; }
  mvDragId = +row.dataset.id;
  row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', mvDragId);
});

document.addEventListener('dragend', () => {
  document.querySelectorAll('.dragging,.mv-drop-target,.mv-drop-reject')
    .forEach(el => el.classList.remove('dragging','mv-drop-target','mv-drop-reject'));
  mvDragId = null;
});

function clearDropHighlights() {
  document.querySelectorAll('.mv-col,.mv-drift-footer').forEach(c => c.classList.remove('mv-drop-target','mv-drop-reject'));
}

document.addEventListener('dragover', e => {
  if (!mvDragId) return;
  const col=e.target.closest('.mv-col'), driftEl=e.target.closest('.mv-drift-footer,.mv-drift-drawer');
  if (!col && !driftEl) return;
  const zone=col?MV_ZONE_MAP[col.id]:'drift'; if (!zone) return;
  e.preventDefault(); clearDropHighlights();
  const t=byId(mvDragId); if (!t) return;
  const res=resolveDrop(t,zone), target=col||g('mvDriftWrap');
  target.classList.add(res?'mv-drop-target':'mv-drop-reject');
  e.dataTransfer.dropEffect=res?'move':'none';
});

document.addEventListener('dragleave', e => {
  const col=e.target.closest('.mv-col'), driftEl=e.target.closest('.mv-drift-footer,.mv-drift-drawer');
  if (col    && !col.contains(e.relatedTarget))     col.classList.remove('mv-drop-target','mv-drop-reject');
  if (driftEl && !driftEl.contains(e.relatedTarget)) g('mvDriftWrap').classList.remove('mv-drop-target','mv-drop-reject');
});

document.addEventListener('drop', e => {
  if (!mvDragId) return;
  clearDropHighlights();
  const col=e.target.closest('.mv-col'), driftEl=e.target.closest('.mv-drift-footer,.mv-drift-drawer');
  const zone=col?MV_ZONE_MAP[col.id]:driftEl?'drift':null; if (!zone) return;
  e.preventDefault();
  const t=byId(mvDragId); if (!t) return;
  const res=resolveDrop(t,zone); if (!res) return;
  mvPendingDrop = { taskId:mvDragId, zone, resolution:res };
  if (zone !== 'drift') render();
  mvRenderDropConfirm(zone, mvDragId, res); mvDragId=null;
});

function mvRenderDropConfirm(zone, taskId, res) {
  const cid={flow:'mvFlowConfirm',deep:'mvDeepConfirm',drift:'mvDriftConfirm'}[zone];
  const c=g(cid); if (!c) return;
  const t=byId(taskId); if (!t) return;
  c.innerHTML = `<div class="mv-confirm">
    <div class="mv-confirm-task">${esc(t.name)}</div>
    <div class="mv-confirm-nudge">${res.nudge}</div>
    <div class="mv-confirm-change"><b>Δ</b> ${formatDelta(res.delta)}</div>
    <div class="mv-confirm-actions">
      <button class="btn-drag-apply"  id="btnDragApply">Apply & move</button>
      <button class="btn-drag-cancel" id="btnDragCancel">Cancel</button>
    </div>
  </div>`;
  const btnApply  = g('btnDragApply');  if (btnApply)  btnApply.addEventListener('click', mvApplyDrop);
  const btnCancel = g('btnDragCancel'); if (btnCancel) btnCancel.addEventListener('click', mvCancelDrop);
}

function mvApplyDrop()  { if (!mvPendingDrop) return; applyDrop(mvPendingDrop.taskId, mvPendingDrop.resolution); mvPendingDrop=null; }
function mvCancelDrop() { mvPendingDrop=null; clearConfirms(); }

function applyDrop(taskId, res) {
  const t=byId(taskId); if (!t) return;
  commitTask(() => {
    res.apply(t); t.sc = calcScore(t.i, t.u, t.s); t.tier = getTier(t.sc);
    if (!t.edits) t.edits = []; t.edits.push(Date.now());
  });
  render(); clearConfirms();
  if (activeId === taskId) renderPanelContent(taskId);
}

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
  else if (e.key==='Escape') { closeSearch(); return; }
  items.forEach((el,i)=>el.classList.toggle('active',i===searchSelectedIdx));
  if (items[searchSelectedIdx]) items[searchSelectedIdx].scrollIntoView({block:'nearest'});
}

function selectSearchResult(id) { closeSearch(); openPanel(id); }

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
    const cx=(t.context||'').toLowerCase().includes(q);
    const bk=(t.bricks||[]).some(b=>(b.text||'').toLowerCase().includes(q));
    if (!nm&&!no&&!cx&&!bk) return null;
    return { t, rank:nm?0:(no||cx)?1:2, nm, no, cx, bk };
  }).filter(Boolean).sort((a,b)=>a.rank-b.rank||b.t.sc-a.t.sc);
  searchResults=scored.map(s=>s.t);
  if (!scored.length) {
    el.innerHTML=`<div class="search-empty">No tasks match "<strong>${q}</strong>"<br><span style="font-size:10px;margin-top:4px;display:block">Try a word from the task name, note, or a progress log</span></div>`;
    return;
  }
  const ZL={flow:'Flow',deep:'Deep',drift:'Drift'};
  el.innerHTML=scored.map(({t,nm,no,cx,bk})=>{
    const zone=zoneFor(t);
    let mc='';
    if (!nm&&no&&t.note)     { const i=t.note.toLowerCase().indexOf(q); mc=`Note: ${t.note.slice(Math.max(0,i-20),i+40).trim()}`; }
    else if (!nm&&cx&&t.context) mc=`Context: ${t.context}`;
    else if (!nm&&bk) { const b=t.bricks.find(b=>(b.text||'').toLowerCase().includes(q)); if (b?.text) mc=`Progress: ${b.text.slice(0,50)}`; }
    return `<div class="search-result${t.done?' sr-done':''}" data-action="select-search" data-id="${t.id}">
      <span class="sr-score" style="color:${tierUI(t.tier.key).color||'var(--muted)'}">${t.sc}</span>
      <div class="sr-body">
        <div class="sr-name">${nm?highlight(t.name,q):t.name}${t.done?' <span style="font-size:10px;color:var(--muted)">✓ done</span>':''}</div>
        <div class="sr-meta"><span class="sr-zone sr-zone-${zone}">${ZL[zone]}</span><span class="sr-tier">${(tierUI(t.tier.key).label||'').split(' ')[0]} ${(tierUI(t.tier.key).label||'').replace(/^[^ ]+ /,'')}</span></div>
        ${mc?`<div class="sr-match-context">${highlight(mc,q)}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
// (scroll navigation removed — board is now a slide-in panel)

document.addEventListener('keydown', e => {
  const inInput=['INPUT','TEXTAREA'].includes(document.activeElement.tagName);
  if (e.key==='Escape') {
    [closeTriage,closeTrophy,closePanel,closeDoneModal,closeAll,
     closeDriftBox,closeParkedReview,closeSearch,closeFireModal,closeStuckModal,closeDriftDrawer].forEach(fn=>fn());
    if (boardPanelOpen) closeBoardPanel();
    quickInput.blur(); return;
  }
  if (inInput) return;
  if ((e.key==='n'||e.key==='N')&&!activeId&&!doneModalZone&&!trophyTaskId) {
    e.preventDefault();
    openBoardPanel(true);
  }
  if (e.key==='/'&&!activeId&&!doneModalZone&&!trophyTaskId&&!searchActive) { e.preventDefault(); openSearch(); }
});

// ─── STATIC EVENT LISTENERS ──────────────────────────────────────────────────
try {

// Header
g('btnSearch').addEventListener('click', openSearch);
g('btnExport').addEventListener('click', exportData);
g('btnReset').addEventListener('click', () => { mmConfirm(RESET_CONFIRM, clearSave); });
g('importInput').addEventListener('change', importData);

// Board panel
g('btnBoard').addEventListener('click', toggleBoardPanel);
g('btnBoardClose').addEventListener('click', closeBoardPanel);

// Peek drawer
g('peekTrigger').addEventListener('click', togglePeek);

// Inbox
g('btnTriage').addEventListener('click', openTriage);

// Board header badges
g('bzFireBadge').addEventListener('click', openFireModal);
g('bzActivationBadge').addEventListener('click', openStuckModal);
g('btnDriftBox').addEventListener('click', openDriftBox);

// Done badges
g('mvFlowDone').addEventListener('click', () => openDoneModal('flow'));
g('mvDeepDone').addEventListener('click', () => openDoneModal('deep'));

// Drift box modal
g('driftBoxOverlay').addEventListener('click', maybeCloseDriftBox);
g('btnDriftBoxClose').addEventListener('click', closeDriftBox);

// Fire modal
g('fireOverlay').addEventListener('click', maybeCloseFire);
g('btnFireClose').addEventListener('click', closeFireModal);

// Stuck modal
g('stuckOverlay').addEventListener('click', maybeCloseStuck);
g('btnStuckClose').addEventListener('click', closeStuckModal);

// Parked modal
g('parkedOverlay').addEventListener('click', maybeCloseParked);
g('btnParkedClose').addEventListener('click', closeParkedReview);

// Add modal
g('addOverlay').addEventListener('click', maybeCloseAdd);
g('btnAddClose').addEventListener('click', closeAll);
g('btnAddTask').addEventListener('click', addTask);

// Agency buttons — delegated on each modal's agency-row parent
document.querySelector('#addModal .agency-row').addEventListener('click', e => {
  const btn = e.target.closest('.agency-btn[data-ctx="add"]');
  if (btn) setAgency(btn.dataset.agency);
});

// Search overlay
g('searchOverlay').addEventListener('click', maybeCloseSearch);

// Triage modal
g('triageOverlay').addEventListener('click', maybeTriage);
g('btnTriageClose').addEventListener('click', closeTriage);
g('btnTriSend').addEventListener('click', triageSend);
g('btnTriSkip').addEventListener('click', triageSkip);
g('btnTriDel').addEventListener('click', triageDelete);
document.querySelector('.triage-modal .agency-row').addEventListener('click', e => {
  const btn = e.target.closest('.agency-btn[data-ctx="triage"]');
  if (btn) setTriageAgency(btn.dataset.agency);
});

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

// Restore timer after page load
timerRestore();
g('btnApplyScore').addEventListener('click', applyScoreEdit);
g('btnDriftKeep').addEventListener('click', keepUrgency);
g('btnDriftAction').addEventListener('click', driftAction);
document.querySelector('.panel .agency-row').addEventListener('click', e => {
  const btn = e.target.closest('.agency-btn[data-ctx="panel"]');
  if (btn) setPanelAgency(btn.dataset.agency);
});

// Link search overlay
g('linkSearchOverlay').addEventListener('click', e => { if (e.target === g('linkSearchOverlay')) closeLinkSearch(); });
g('btnLinkSearchClose').addEventListener('click', closeLinkSearch);
g('linkSearchInput').addEventListener('input', e => renderLinkSearch(e.target.value.trim()));
g('linkSearchInput').addEventListener('keydown', e => { if (e.key === 'Escape') closeLinkSearch(); });

// Link type chooser
g('btnLinkBefore').addEventListener('click', () => applyLinkType('before'));
g('btnLinkAfter').addEventListener('click',  () => applyLinkType('after'));
g('btnLinkMerge').addEventListener('click',  () => applyLinkType('merge'));
g('btnLtcCancel').addEventListener('click',  closeLinkTypeChooser);

// Merge modal
g('mergeModalOverlay').addEventListener('click', e => { if (e.target === g('mergeModalOverlay')) closeMergeModal(); });
g('btnMergeClose').addEventListener('click', closeMergeModal);
g('btnMergeConfirm').addEventListener('click', confirmMerge);
g('mImp').addEventListener('input', mergePreview);
g('mUrg').addEventListener('input', mergePreview);
g('mSim').addEventListener('input', mergePreview);

} catch(err) { console.error('[MM] Listener setup failed:', err); }

// ─── CAPTURE BAR ─────────────────────────────────────────────────────────────

g('taskInput').addEventListener('keydown', e => { if (e.key==='Enter') addTask(); });

const quickInput  = g('quickInput');
const captureWrap = g('captureWrap');

quickInput.addEventListener('focus', ()=>captureWrap.classList.add('focused'));
quickInput.addEventListener('blur',  ()=>captureWrap.classList.remove('focused'));
quickInput.addEventListener('keydown', e => {
  if (e.key!=='Enter') return; e.preventDefault();
  if (e.shiftKey) { const n=quickInput.value.trim(); if(!n) return; quickInput.value=''; captureWrap.classList.remove('focused'); openScoreModal(n); }
  else quickCapture();
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
  ].map(([id,name,i,u,s,createdAt])=>makeTask(id,name,i,u,s,'solo','','',createdAt));
  rebuildTaskMap();
  save();
}

render();
renderInbox();
renderHaloPanel();

