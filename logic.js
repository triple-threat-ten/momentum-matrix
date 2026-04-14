// logic.js — pure functions, no DOM, no localStorage

const TIERS = [
  { key:'fire',     min:78 },
  { key:'activate', min:55 },
  { key:'queue',    min:35 },
  { key:'latent',   min:15 },
  { key:'someday',  min:0  },
];

const URG_HORIZON         = [0, 0, 14, 4, 1]; // days; indices 0-1 unused
const DRIFT_BOX_THRESHOLD = { 2:14, 3:45 };    // days by urgency level
const DAY_MS              = 86400000;
const PARKED_STALE_MS     = 30 * DAY_MS;
const SESSION_CAP         = 5;

// Matter score: (I×U) + (S×√(I×U)) normalised to 0–100. Max raw = 32.
function calcScore(i, u, s) { return Math.round(((i*u) + (s*Math.sqrt(i*u))) / 32 * 100); }
function getTier(sc)        { return TIERS.find(t => sc >= t.min); }

function zoneFor(t) {
  if (t.sc < 20)             return 'drift';
  if (t.i >= 3 && t.s <= 2) return 'deep';
  return 'flow';
}

function sizeClass(sc) {
  if (sc >= 78) return 'sz-xl'; if (sc >= 55) return 'sz-lg';
  if (sc >= 35) return 'sz-md'; if (sc >= 15) return 'sz-sm';
  return 'sz-xs';
}

function buildZones(tasks) {
  const z = { flow:[], deep:[], drift:[] };
  tasks.forEach(t => z[zoneFor(t)].push(t));
  return z;
}

// Last meaningful interaction — brick, edit, creation, or done; not panel views.
function lastTouchedTs(t) {
  const pts = [t.createdAt];
  if (t.doneAt)         pts.push(t.doneAt);
  if (t.edits?.length)  pts.push(Math.max(...t.edits));
  if (t.bricks?.length) pts.push(Math.max(...t.bricks.map(b => b.ts)));
  return Math.max(...pts);
}

function fmtDuration(ms) {
  if (ms < 60000) return 'just now';
  const m = Math.round(ms/60000), h = Math.round(ms/3600000), d = Math.round(ms/DAY_MS);
  if (m < 60) return `${m}m`; if (h < 24) return `${h}h`;
  if (d <  7) return `${d}d`; if (d < 30) return `${Math.round(d/7)}w`;
  return `${Math.round(d/30)}mo`;
}
function fmtAgo(ts) {
  const ms = Date.now() - ts;
  return ms < 60000 ? 'just now' : fmtDuration(ms) + ' ago';
}

// Returns age/horizon ratio (>1 = overdue) or null if not applicable.
function urgencyAgeFrac(t) {
  if (t.done || !t.u || t.u <= 1) return null;
  if (t.urgencyAckedAt && Date.now() - t.urgencyAckedAt < DAY_MS) return null;
  return (Date.now() - t.createdAt) / DAY_MS / URG_HORIZON[t.u];
}

function urgencyAgeLabel(t) {
  const frac = urgencyAgeFrac(t); if (!frac || frac <= 1) return null;
  const over = (Date.now() - t.createdAt) / DAY_MS - URG_HORIZON[t.u], lbl = URG_WORDS[t.u];
  if (over < 1) return `today — rated ${lbl}`;
  if (over < 2) return `1d past ${lbl}`;
  if (over < 7) return `${Math.floor(over)}d past ${lbl}`;
  return `${Math.floor(over/7)}w past ${lbl}`;
}

function suggestTask(tasks, blockType, exclude) {
  const skip   = new Set(exclude || []);
  const active = tasks.filter(t => !t.done && t.agency !== 'waiting' && zoneFor(t) !== 'drift' && !skip.has(t.id));
  const reason = (t, zone) => {
    const parts = [REASON_HIGHEST(zone), t.bricks.length === 0 ? REASON_NEVER : REASON_BRICKS(t.bricks.length)];
    const d = Math.round((Date.now() - t.createdAt) / DAY_MS);
    if (d > 0) parts.push(REASON_AGE(d));
    return parts.join(' · ');
  };
  const isQuick  = t => zoneFor(t) === 'flow' && t.s >= 3 && t.bricks.length <= 1;
  const isMedium = t => zoneFor(t) === 'flow' && !isQuick(t);
  const pools = { deep:active.filter(t => zoneFor(t) === 'deep'), medium:active.filter(isMedium), quick:active.filter(isQuick) };
  const pool  = (pools[blockType] || []).sort((a, b) => b.sc - a.sc);
  if (!pool.length) return null;
  return { task:pool[0], reason:reason(pool[0], blockType === 'deep' ? 'Deep' : 'Flow') };
}

function resolveDrop(task, targetZone) {
  const cur = zoneFor(task); if (cur === targetZone) return null;
  if (cur === 'flow' && targetZone === 'deep') {
    if (task.s > 2 && task.i >= 3) return { nudge:'Deep needs protected time. Does this task have high activation cost?',       delta:{ s:[task.s,2] },                              apply: t => { t.s = 2; } };
    if (task.i < 3 && task.s <= 2) return { nudge:'Deep is for high-stakes work. Is this more important than rated?',          delta:{ i:[task.i,3] },                              apply: t => { t.i = 3; } };
    return                                { nudge:'Deep means protected time for hard, important work. Adjust both?',           delta:{ i:[task.i,3], s:[task.s,2] },                apply: t => { t.i = 3; t.s = 2; } };
  }
  if (cur === 'flow'  && targetZone === 'drift') return { nudge:'Parking this task. Has its importance changed fundamentally?',                             delta:{ i:[task.i,1], u:[task.u,1] },                apply: t => { t.i = 1; t.u = 1; } };
  if (cur === 'deep'  && targetZone === 'flow')  return { nudge:'Easier to start than expected? Raising Simplicity moves it to Flow.',                     delta:{ s:[task.s,3] },                              apply: t => { t.s = 3; } };
  if (cur === 'deep'  && targetZone === 'drift') return { nudge:'Drifting from Deep is a real reprioritization. Has the importance fundamentally changed?', delta:{ i:[task.i,2], u:[task.u,1] },                apply: t => { t.i = 2; t.u = 1; } };
  if (cur === 'drift' && targetZone === 'flow')  return { nudge:'Activating this task. Is it more pressing than when you parked it?',                      delta:{ i:[task.i,2], u:[task.u,2], s:[task.s,3] }, apply: t => { t.i = 2; t.u = 2; t.s = 3; } };
  if (cur === 'drift' && targetZone === 'deep')  return { nudge:'Escalating to Deep — important, demanding, needs a dedicated block.',                     delta:{ i:[task.i,3], s:[task.s,2], u:[task.u,Math.max(task.u,2)] }, apply: t => { t.i = 3; t.s = 2; t.u = Math.max(t.u, 2); } };
  return null;
}

function esc(s)         { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function scoreWeight(t) { return Math.max(t.sc || 0, 10); }
function hexRgb(hex)    { return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`; }
