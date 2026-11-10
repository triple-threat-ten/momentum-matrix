// logic.js — pure functions, no DOM, no localStorage

const TIERS = [
  { key:'fire',     min:78 },
  { key:'activate', min:55 },
  { key:'queue',    min:35 },
  { key:'latent',   min:15 },
  { key:'someday',  min:0  },
];

const URG_HORIZON         = [0, 0, 14, 4, 1]; // days an urgency rating stays valid: Later 14 · Soon 4 · Now 1 (Someday none)
const DAY_MS              = 86400000;

// Focus modes (spec §4.3). 'balanced' is the default and is never persisted.
const MODES = ['balanced', 'quick', 'zone', 'focus'];

// Matter score: (I×U) + (S×√(I×U)) normalised to 0–100. Max raw = 32.
function calcScore(i, u, s) { return Math.round(((i*u) + (s*Math.sqrt(i*u))) / 32 * 100); }
function getTier(sc)        { return TIERS.find(t => sc >= t.min); }

// ─── v26 CONTEXTS MODEL ──────────────────────────────────────────────────────

// Deep = important and hard to start. Visual highlight only, not a zone (§3, §4.6).
function isDeep(t) { return t.i >= 3 && t.s <= 2; }

// Drifted away = rated Someday. Lives in the Drift box, never in the list (§4.2).
function isDrifted(t) { return !t.done && t.u === 1; }

// How far past its horizon an urgency rating is: (now − urgencySetAt) / horizon.
// > 1 = slipping (amber), ≥ 2 = red. null when no horizon applies (done, Someday, invalid u).
// Falls back to createdAt for tasks that have not been migrated yet.
function slipRatio(t, now = Date.now()) {
  if (!t || t.done) return null;
  const horizon = URG_HORIZON[t.u];
  if (!horizon) return null;
  const since = t.urgencySetAt ?? t.createdAt;
  if (since == null) return null;
  return Math.max(0, (now - since) / DAY_MS / horizon);
}

// Returns a NEW array ranked for the given mode (§4.3). Does not filter — callers
// decide which tasks belong in the list (not done, not drifted). Unknown mode → Balanced.
//   balanced: Matter ↓
//   quick:    Simplicity ↓ · Matter ↓
//   zone:     Urgency ↓ · Slip ratio ↓ (most overdue first) · Matter ↓
//   focus:    Importance ↓ · Matter ↓
// Full ties keep input order (Array.prototype.sort is stable).
function sortByMode(tasks, mode, now = Date.now()) {
  const matter = t => t.sc;
  const keys = {
    quick: [t => t.s, matter],
    zone:  [t => t.u, t => slipRatio(t, now), matter],
    focus: [t => t.i, matter],
  }[mode] || [matter];
  return [...tasks].sort((a, b) => {
    for (const k of keys) {
      const va = k(a) ?? -Infinity, vb = k(b) ?? -Infinity;
      if (va !== vb) return vb - va;
    }
    return 0;
  });
}

// Fields to apply when the Urgency rating is saved — in the panel, triage or the Drift box (§4.5).
// Any save restarts the urgency clock, even with the same value ("still accurate").
function rerateUrgency(t, u, now = Date.now()) {
  const sc = calcScore(t.i, u, t.s);
  return { u, sc, tier: getTier(sc), urgencySetAt: now };
}

// Drift box review order (§5.3): slipping tasks (most overdue first), then drifted-away
// tasks (highest Matter first). `exclude` = ids already reviewed this session.
function driftQueue(tasks, now = Date.now(), exclude) {
  const skip = new Set(exclude || []);
  const pool = tasks.filter(t => !t.done && !skip.has(t.id));
  const slipping = pool
    .filter(t => !isDrifted(t) && (slipRatio(t, now) ?? 0) > 1)
    .sort((a, b) => slipRatio(b, now) - slipRatio(a, now));
  const drifted = pool.filter(isDrifted).sort((a, b) => b.sc - a.sc);
  return [...slipping, ...drifted];
}

// ─── SHARED HELPERS ──────────────────────────────────────────────────────────

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

// Badge / reason-chip text for a slipping task (spec §4.5): "today — rated Soon",
// "3d past Soon", "2w past Later". null when the rating is still within its horizon.
function urgencyAgeLabel(t, now = Date.now()) {
  const r = slipRatio(t, now); if (r === null || r <= 1) return null;
  const over = (r - 1) * URG_HORIZON[t.u], lbl = URG_WORDS[t.u];
  if (over < 1) return `today — rated ${lbl}`;
  if (over < 7) return `${Math.floor(over)}d past ${lbl}`;
  return `${Math.floor(over / 7)}w past ${lbl}`;
}

function esc(s)         { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
