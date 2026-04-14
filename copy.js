// copy.js — all user-facing strings. No logic, no DOM. Edit here for copy reviews.

// ─── AXIS LABELS ─────────────────────────────────────────────────────────────
const IMP_WORDS = ['', 'Trivial', 'Useful', 'Important', 'Critical'];
const URG_WORDS = ['', 'Someday', 'Later', 'Soon', 'Now'];
const SIM_WORDS = ['', 'Heavy', 'Tricky', 'Manageable', 'Effortless'];

// ─── AXIS NAMES (used in delta formatter) ────────────────────────────────────
const AXIS_NAME = { i:'Importance', u:'Urgency', s:'Simplicity' };

// ─── TIER DISPLAY ─────────────────────────────────────────────────────────────
const TIER_UI = {
  fire:     { label:'🔥 Fire',          color:'var(--fire)',     nudge:'This is stealing your focus every hour you wait.' },
  activate: { label:'⚡\uFE0F Activate', color:'var(--activate)', nudge:'One hour here unlocks everything else.' },
  queue:    { label:'🌱 Queue',          color:'#3a5c05',         nudge:'Block time this week before it becomes urgent.' },
  latent:   { label:'● Latent',          color:'#0e9a8e',         nudge:'Keep it visible. Its moment will come.' },
  someday:  { label:'— Someday',         color:'var(--someday)',  nudge:'Not now. Revisit in a month.' },
};
function tierUI(key) { return TIER_UI[key] || TIER_UI.someday; }

// ─── TIER HEX (used for orb/badge colors) ────────────────────────────────────
const TIER_HEX = { fire:'#E63946', activate:'#F59E0B', queue:'#A3E635', latent:'#2DD4BF', someday:'#8B90A0' };

// ─── BRICK NUDGES ─────────────────────────────────────────────────────────────
// Hard = Deep column tasks (headline + subtitle). Indexed by brick count.
const BRICK_NUDGES_HARD = [
  { h:'Ready to start?',  s:"Drop a brick — one sentence on what you're doing now." },
  { h:'Good momentum.',   s:'Touched it again? Drop another brick.' },
  { h:"You're building.", s:'Each brick is proof you moved on this.' },
];
// Easy = Flow column tasks (one-liner). Indexed by brick count.
const BRICK_NUDGES_EASY = [
  'Done a pass on this? Log it.',
  'Made progress? Note it.',
  'Touched it again? Add a brick.',
];

// ─── BRICK INPUT ──────────────────────────────────────────────────────────────
const BRICK_PLACEHOLDER         = 'What did you just do? (optional)';
const BRICK_PLACEHOLDER_ERROR   = 'Write something first — even one word.';
const BRICK_BTN_SAVE            = 'Drop it';
const BRICK_BTN_CANCEL          = '✕';
const BRICK_BTN_DROP            = '+ Brick';

// ─── BRICK HEALTH SIGNAL ──────────────────────────────────────────────────────
// Shown when a task has 5+ bricks with no resolution.
const BRICK_HEALTH_MSG = (count) =>
  `Touched ${count} times with no resolution — might be worth breaking this down or redefining what done looks like.`;

// ─── CONGRATS (done modal — shown by done count) ──────────────────────────────
const CONGRATS = [
  { emoji:'🏆', h:'Look at that.',         s:'Real work, done. Every item here was a small act of will.' },
  { emoji:'🎯', h:'Solid progress.',       s:"These weren't going to do themselves. You made them happen." },
  { emoji:'✨', h:'Done is beautiful.',    s:'Each completed task is a brick in something larger.' },
  { emoji:'🌿', h:'You moved the needle.', s:"The list got shorter. That's all momentum ever is." },
  { emoji:'🎉', h:'Not bad at all.',       s:'This column is proof you showed up and did the thing.' },
];

// ─── TROPHY MSGS (individual task completion) ─────────────────────────────────
const TROPHY_MSGS = [
  { emoji:'🏆', h:'Nailed it.' },
  { emoji:'✅', h:'Done and dusted.' },
  { emoji:'🎯', h:'Delivered.' },
  { emoji:'🌿', h:'One less thing.' },
  { emoji:'⚡', h:'You made it happen.' },
  { emoji:'🎉', h:"That one's off the list." },
];

// ─── TROPHY SCREEN LABELS ────────────────────────────────────────────────────
const TROPHY_KPI_TIME   = 'Time to done';
const TROPHY_KPI_BRICKS = 'Bricks laid';
const TROPHY_KPI_SCORE  = 'Priority score';
const TROPHY_NO_BRICKS  = 'No bricks — completed in one go.';
const TROPHY_SUB_DONE   = (duration, sc) => `Completed in ${duration} · score ${sc}`;
const TROPHY_SUB_NODONE = (sc, tierLabel) => `Score ${sc} · ${tierLabel}`;

// ─── DONE MODAL REOPEN BUTTON ─────────────────────────────────────────────────
const DONE_REOPEN_BTN = 'Reopen';

// ─── HALO PANEL — streak banner ───────────────────────────────────────────────
const HALO_STREAK_WARN         = (days) => `Flow only for the past ${days}. Deep hasn't moved.`;
const HALO_STREAK_AFFIRM       = (days) => `Deep work done ${days} ago. Momentum is there.`;
// No constant for suppressed state — banner is simply absent.

// ─── HALO PANEL — Deep halo card ─────────────────────────────────────────────
const HALO_EYEBROW             = 'The work that matters most';
const HALO_START_BTN           = 'Start session';

// Timer copy
const TIMER_START_GO      = mins => `Start ${mins}-min block`;
const TIMER_BRICK_TITLE   = 'Block done. What did you do?';
const TIMER_BRICK_SUB     = 'One sentence is enough.';
const TIMER_BRICK_PH      = 'e.g. Finished the export mapping, need to test next…';
const TIMER_PARK_TITLE    = 'Where did you leave off?';
const TIMER_PARK_SUB      = 'A quick note so you can pick this up without friction.';
const TIMER_PARK_PH       = 'e.g. Got through the schema, next step is the mapping…';
const TIMER_BRICK_BTN     = 'Drop a brick';
const TIMER_PARK_BTN      = 'Park it';
const TIMER_SKIP_BTN      = 'Skip';
const HALO_TRY_ANOTHER         = 'try another';
const HALO_PILL_UNTOUCHED      = (days) => `${days} days untouched`;
const HALO_PILL_IN_PROGRESS    = 'in progress';
const HALO_PILL_DONE_TODAY     = 'done today';
const HALO_ESCAPE              = 'Show me shorter tasks instead';
const HALO_EMPTY_DEEP          = 'Nothing in Deep yet — add a task that truly matters and is hard to start.';

// ─── HALO PANEL — Flow fallback ───────────────────────────────────────────────
const HALO_BACK_NUDGE          = 'Ready to tackle the real work?';
const HALO_FLOW_INTRO          = 'Some things you can move forward right now:';
const HALO_WILDCARD_EYEBROW    = 'you keep skipping this';
const HALO_FLOW_START_BTN      = 'Start this';
const HALO_FLOW_ESCAPE         = 'Show me all tasks';
const HALO_EMPTY_FLOW          = 'Nothing in Flow right now — check the board.';

// ─── PANEL DRIFT / AVOIDANCE PROMPTS ─────────────────────────────────────────
// These are assembled dynamically in app.js using urgencyAgeLabel() and zone.
// Button labels are extracted here for the copy review.
const DRIFT_KEEP_DEFAULT       = 'Still pressing';
const DRIFT_KEEP_ACCURATE      = 'Still accurate';
const DRIFT_KEEP_NOT_READY     = 'Not ready yet';
const DRIFT_ACTION_BLOCK       = 'Block time ↓';
const DRIFT_ACTION_REASSESS    = 'Reassess ↓';
const DRIFT_ACTION_BRICK       = 'Drop a brick ↓';

// ─── FORMULA HINTS (score edit panel) ────────────────────────────────────────
const FORMULA_HINTS = {
  s_up:   "Simplicity ↑ — easier to start means higher priority. The formula amplifies important tasks you can actually begin.",
  s_down: "Simplicity ↓ — harder to start lowers priority. The formula can't fully reward a task you can't act on yet.",
  i_up:   "Importance ↑ — this is the heaviest dimension. Importance × Urgency is the foundation of the score.",
  i_down: "Importance ↓ — lower importance reduces both the base score and Simplicity's leverage on it.",
  u_up:   "Urgency ↑ — time pressure compounds importance. High urgency on a critical task approaches maximum score.",
  u_down: "Urgency ↓ — less time-sensitive means less pressure to act now. The task stays visible, not urgent.",
};

// ─── DRAG-DROP NUDGES (resolveDrop) ──────────────────────────────────────────
// Intentionally left in logic.js — each nudge string is structurally coupled
// to its zone-transition condition and delta. Edit them directly in logic.js.

// ─── BOARD BADGES ─────────────────────────────────────────────────────────────
const BADGE_FIRE   = (n) => `🔥 ${n} Fire`;
const BADGE_STUCK  = (n) => `⚡ ${n} stuck`;

// ─── RESET CONFIRM ────────────────────────────────────────────────────────────
const RESET_CONFIRM = 'Wipe all tasks and inbox? This cannot be undone.';

// ─── TASK LINKING ─────────────────────────────────────────────────────────────
const LINK_URG_MISMATCH = '⚠ The prerequisite task has lower urgency than the one it unlocks — worth checking the order is right.';
const LINK_BEFORE_LABEL = 'I need to do this first';
const LINK_AFTER_LABEL  = 'This comes after something else';
const LINK_MERGE_LABEL  = 'These are the same task — merge them';

// ─── TRIAGE ───────────────────────────────────────────────────────────────────
const TRIAGE_CAPTURED = (ago) => 'Captured ' + ago;

// ─── TASK REASON (session suggestion) ────────────────────────────────────────
// Built dynamically in logic.js suggestTask(). Strings below are its parts.
const REASON_HIGHEST   = (zone) => `Highest Matter score in ${zone}`;
const REASON_NEVER     = 'Never started';
const REASON_BRICKS    = (n) => `${n} brick${n !== 1 ? 's' : ''}`;
const REASON_AGE       = (d) => `${d}d in board`;

// ─── EMPTY STATES ─────────────────────────────────────────────────────────────
const EMPTY_FLOW  = 'Nothing in Flow —<br>add something with a clear path';
const EMPTY_DEEP  = 'Nothing in Deep —<br>add something hard to start<br>that truly matters';
const EMPTY_DRIFT = 'Nothing parked. Everything is either moving or done.';

// ─── CONFIRM DIALOGS ──────────────────────────────────────────────────────────
const CONFIRM_DELETE_TASK    = 'Delete this task? This cannot be undone.';
const CONFIRM_SWITCH_TIMER   = (from, to) => `Stop "${from}" and start "${to}"?`;

// ─── AGENCY LABELS ────────────────────────────────────────────────────────────
const AGENCY_LABELS = { solo:'Mine', shared:'Shared', waiting:'Waiting' };
