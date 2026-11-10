// copy.js — all user-facing strings. No logic, no DOM. Edit here for copy reviews.
// v26.0 — Contexts. Strings follow spec §7 (claude/halo-contexts-v1-spec.md).

// ─── AXIS LABELS ─────────────────────────────────────────────────────────────
const IMP_WORDS  = ['', 'Trivial', 'Useful', 'Important', 'Critical'];
const URG_WORDS  = ['', 'Someday', 'Later', 'Soon', 'Now'];
const SIM_WORDS  = ['', 'Heavy', 'Tricky', 'Manageable', 'Effortless'];
const AXIS_NAME  = { i:'Importance', u:'Urgency', s:'Simplicity' };
const AXIS_SHORT = { s:'S', u:'U', i:'I' };

// ─── TIERS (only Fire and the nudge line are visible in v26) ─────────────────
const TIER_UI = {
  fire:     { label:'🔥 Fire',          color:'var(--fire)',     nudge:'This is stealing your focus every hour you wait.' },
  activate: { label:'⚡️ Activate', color:'var(--activate)', nudge:'One hour here unlocks everything else.' },
  queue:    { label:'🌱 Queue',          color:'#3a5c05',         nudge:'Block time this week before it becomes urgent.' },
  latent:   { label:'● Latent',          color:'#0e9a8e',         nudge:'Keep it visible. Its moment will come.' },
  someday:  { label:'— Someday',         color:'var(--someday)',  nudge:'Not now. Revisit in a month.' },
};
function tierUI(key) { return TIER_UI[key] || TIER_UI.someday; }
const TIER_HEX = { fire:'#E63946', activate:'#F59E0B', queue:'#A3E635', latent:'#2DD4BF', someday:'#8B90A0' };

// ═══ MAIN SCREEN ═════════════════════════════════════════════════════════════

// ─── Header ──────────────────────────────────────────────────────────────────
const HDR_ACTIVE       = (n) => `${n} active`;
const DRIFT_BTN_COUNTS = (slipping, drifted) =>
  slipping + drifted === 0 ? 'all clear' : `${slipping} slipping · ${drifted} drifted`;

// ─── Modes (order everywhere: Simplicity · Urgency · Importance) ─────────────
const MODE_UI = {
  quick: { name:'Quick wins',  state:'Low energy, a few minutes',            energy:1, kicker:'Quick win',
           nudge:'Easy-to-start tasks come first. Small wins build momentum.' },
  zone:  { name:'In the zone', state:"Steady rhythm, clear what's pressing", energy:2, kicker:'Most pressing',
           nudge:'Time-sensitive tasks come first, and anything slipping past its horizon jumps ahead.' },
  focus: { name:'Focus time',  state:'Fresh mind, room to go deep',          energy:3, kicker:'Your big work',
           nudge:'Your most meaningful work comes first. Protect the time.' },
};
const BALANCED_TITLE       = 'Balanced view';
const BALANCED_LINE        = 'the best mix of all three. Pick a mode to match your energy.';
const BALANCED_LINE_MOBILE = 'The best mix of all three. Pick a mode below to match your energy.';
const BALANCED_KICKER      = 'Do this now';
const BACK_BALANCED        = '× Back to Balanced';
const BACK_BALANCED_SHORT  = '× Balanced';
const BACK_NEXT_TIME       = 'Back to Balanced next time you open HALO°.';

// ─── Fire banner, #1 card, #2–#3 ─────────────────────────────────────────────
const FIRE_BANNER      = "Can't wait";
const HERO_CTA         = "I'm on it";
const PICKER_LABEL     = 'How long?';
const PICKER_CANCEL    = 'cancel';
const DEEP_BADGE       = 'Deep';
const MARK_DONE        = 'Mark done';
const SLIP_BADGE_TITLE = 'Urgency rating past its horizon — open the Drift box';

// ─── List ────────────────────────────────────────────────────────────────────
const LIST_TITLE    = 'Further down';
const COL_TASK = 'Task', COL_SIMP = 'Simp.', COL_URG = 'Urg.', COL_IMP = 'Imp.', COL_MATTER = 'Matter';
const FOLD_MORE     = (n) => `Show ${n} more`;
const FOLD_MORE_SUB = 'ranked lower in this view';
const FOLD_LESS     = 'Show less';
const DONE_LINK     = (n) => `${n} done`;

// ─── Empty states ────────────────────────────────────────────────────────────
const EMPTY_NONE      = 'Nothing here yet.';
const EMPTY_ADD       = 'Add what matters →';
const EMPTY_ALL_DRIFT = (n) => `Your list is clear. ${n} task${n !== 1 ? 's are' : ' is'} drifting —`;
const EMPTY_REVIEW    = 'Review →';

// ═══ DRIFT BOX ═══════════════════════════════════════════════════════════════
const DB_QUESTION    = 'How urgent is it now?';
const DB_DONE        = '✓ Done';
const DB_LET_GO      = 'Let it go';
const DB_COMING_UP   = 'Coming up';
const DB_SEE_ALL     = (n) => `See all ${n}`;
const DB_SEE_LESS    = 'Hide list';
const DB_PROGRESS    = (pos, total) => `${pos} of ${total}`;
const DB_END_TITLE   = 'All caught up.';
const DB_END_SUB     = 'Every rating matches reality.';
const DB_CLOSE       = 'Close';
const REASON_DRIFTED = 'Rated Someday · drifted away';
const UNDO_LET_GO    = (name) => `Let go of "${name.length > 40 ? name.slice(0, 38) + '…' : name}"`;

// ═══ TASK PANEL ══════════════════════════════════════════════════════════════

// ─── Score hints ─────────────────────────────────────────────────────────────
const FORMULA_HINTS = {
  s_up:   "Simplicity ↑ — easier to start means higher priority. The formula amplifies important tasks you can actually begin.",
  s_down: "Simplicity ↓ — harder to start lowers priority. The formula can't fully reward a task you can't act on yet.",
  i_up:   "Importance ↑ — this is the heaviest dimension. Importance × Urgency is the foundation of the score.",
  i_down: "Importance ↓ — lower importance reduces both the base score and Simplicity's leverage on it.",
  u_up:   "Urgency ↑ — time pressure compounds importance. High urgency on a critical task approaches maximum score.",
  u_down: "Urgency ↓ — less time-sensitive means less pressure to act now. The task stays visible, not urgent.",
};

// ─── Bricks ──────────────────────────────────────────────────────────────────
// Hard = Simplicity ≤ 2 (headline + subtitle). Indexed by brick count.
const BRICK_NUDGES_HARD = [
  { h:'Ready to start?',  s:"Drop a brick — one sentence on what you're doing now." },
  { h:'Good momentum.',   s:'Touched it again? Drop another brick.' },
  { h:"You're building.", s:'Each brick is proof you moved on this.' },
];
// Easy = Simplicity ≥ 3 (one-liner). Indexed by brick count.
const BRICK_NUDGES_EASY = [
  'Done a pass on this? Log it.',
  'Made progress? Note it.',
  'Touched it again? Add a brick.',
];
const BRICK_PLACEHOLDER       = 'What did you just do? (optional)';
const BRICK_PLACEHOLDER_ERROR = 'Write something first — even one word.';
const BRICK_BTN_SAVE          = 'Drop it';
const BRICK_BTN_CANCEL        = '✕';
const BRICK_BTN_DROP          = '+ Brick';
// Shown when a task has 5+ bricks with no resolution.
const BRICK_HEALTH_MSG = (count) =>
  `Touched ${count} times with no resolution — might be worth breaking this down or redefining what done looks like.`;

// ─── Triage ──────────────────────────────────────────────────────────────────
const TRIAGE_CAPTURED = (ago) => 'Captured ' + ago;

// ─── Timer ("I'm on it" → session) ───────────────────────────────────────────
const TIMER_BRICK_TITLE = 'Block done. What did you do?';
const TIMER_BRICK_SUB   = 'One sentence is enough.';
const TIMER_BRICK_PH    = 'e.g. Finished the export mapping, need to test next…';
const TIMER_PARK_TITLE  = 'Where did you leave off?';
const TIMER_PARK_SUB    = 'A quick note so you can pick this up without friction.';
const TIMER_PARK_PH     = 'e.g. Got through the schema, next step is the mapping…';
const TIMER_BRICK_BTN   = 'Drop a brick';
const TIMER_PARK_BTN    = 'Park it';
const TIMER_SKIP_BTN    = 'Skip';

// ═══ COMPLETION ══════════════════════════════════════════════════════════════

// Done window — picked by number of completed tasks
const CONGRATS = [
  { emoji:'🏆', h:'Look at that.',         s:'Real work, done. Every item here was a small act of will.' },
  { emoji:'🎯', h:'Solid progress.',       s:"These weren't going to do themselves. You made them happen." },
  { emoji:'✨', h:'Done is beautiful.',    s:'Each completed task is a brick in something larger.' },
  { emoji:'🌿', h:'You moved the needle.', s:"The list got shorter. That's all momentum ever is." },
  { emoji:'🎉', h:'Not bad at all.',       s:'This list is proof you showed up and did the thing.' },
];
const DONE_REOPEN_BTN = 'Reopen';

// Trophy — one completed task
const TROPHY_MSGS = [
  { emoji:'🏆', h:'Nailed it.' },
  { emoji:'✅', h:'Done and dusted.' },
  { emoji:'🎯', h:'Delivered.' },
  { emoji:'🌿', h:'One less thing.' },
  { emoji:'⚡', h:'You made it happen.' },
  { emoji:'🎉', h:"That one's off the list." },
];
const TROPHY_KPI_TIME   = 'Time to done';
const TROPHY_KPI_BRICKS = 'Bricks laid';
const TROPHY_KPI_SCORE  = 'Matter score';
const TROPHY_NO_BRICKS  = 'No bricks — completed in one go.';
const TROPHY_SUB_DONE   = (duration, sc) => `Completed in ${duration} · score ${sc}`;
const TROPHY_SUB_NODONE = (sc, tierLabel) => `Score ${sc} · ${tierLabel}`;

// ═══ CONFIRMATIONS & DATA ════════════════════════════════════════════════════
const CONFIRM_DELETE_TASK  = 'Delete this task? This cannot be undone.';
const CONFIRM_SWITCH_TIMER = (from, to) => `Stop "${from}" and start "${to}"?`;
const RESET_CONFIRM        = 'Wipe all tasks and inbox? This cannot be undone.';
