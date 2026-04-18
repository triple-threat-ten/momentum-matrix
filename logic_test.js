// logic.test.js — automated tests for logic.js pure functions.
// Run with: node logic.test.js
// No test framework needed — just Node.js.

const fs = require('fs');
const src = fs.readFileSync(__dirname + '/logic.js', 'utf8');

// Stub copy.js constants that logic.js references at runtime
const stubs = `
const REASON_HIGHEST = (zone) => 'Highest Matter score in ' + zone;
const REASON_NEVER   = 'Never started';
const REASON_BRICKS  = (n) => n + ' brick' + (n !== 1 ? 's' : '');
const REASON_AGE     = (d) => d + 'd in board';
`;

const L   = new Function(stubs + src + '\nreturn { calcScore, getTier, zoneFor, buildZones, suggestTask, resolveDrop, urgencyAgeFrac, urgencyAgeLabel, lastTouchedTs, fmtDuration, fmtAgo, TIERS, DAY_MS, URG_HORIZON, SESSION_CAP };')();

let passed = 0, failed = 0;

function assert(label, condition) {
  if (condition) { console.log('  ✅', label); passed++; }
  else           { console.error('  ❌', label); failed++; }
}

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const now = Date.now();
function makeTask(overrides) {
  return {
    id: 1001, name: 'Test task', i: 2, u: 2, s: 3,
    sc: L.calcScore(overrides.i ?? 2, overrides.u ?? 2, overrides.s ?? 3),
    done: false, agency: 'solo', bricks: [], context: '',
    createdAt: now - 5 * L.DAY_MS, doneAt: null, edits: [],
    urgencyAckedAt: null,
    ...overrides,
  };
}

// ─── calcScore ────────────────────────────────────────────────────────────────
console.log('\ncalcScore');
assert('max score (4,4,4) = 100',       L.calcScore(4,4,4) === 100);
assert('returns integer',                Number.isInteger(L.calcScore(2,2,3)));
assert('higher simplicity raises score', L.calcScore(3,3,4) > L.calcScore(3,3,1));
assert('higher importance raises score', L.calcScore(4,2,2) > L.calcScore(1,2,2));
assert('higher urgency raises score',    L.calcScore(2,4,2) > L.calcScore(2,1,2));
assert('minimum (1,1,1) > 0',           L.calcScore(1,1,1) > 0);
assert('score is 0–100',                [1,2,3,4].every(i => [1,2,3,4].every(u => [1,2,3,4].every(s => { const sc=L.calcScore(i,u,s); return sc>=0 && sc<=100; }))));

// ─── getTier ──────────────────────────────────────────────────────────────────
console.log('\ngetTier');
assert('score 100 → fire',     L.getTier(100).key === 'fire');
assert('score 78  → fire',     L.getTier(78).key  === 'fire');
assert('score 77  → activate', L.getTier(77).key  === 'activate');
assert('score 55  → activate', L.getTier(55).key  === 'activate');
assert('score 54  → queue',    L.getTier(54).key  === 'queue');
assert('score 35  → queue',    L.getTier(35).key  === 'queue');
assert('score 34  → latent',   L.getTier(34).key  === 'latent');
assert('score 15  → latent',   L.getTier(15).key  === 'latent');
assert('score 14  → someday',  L.getTier(14).key  === 'someday');
assert('score 0   → someday',  L.getTier(0).key   === 'someday');
// NOTE: after refactoring, TIERS will contain only key+min.
// Once logic.js is updated, replace this assertion with:
//   assert('returns only key+min', Object.keys(L.getTier(80)).sort().join(',') === 'key,min');
assert('returns key and min fields', 'key' in L.getTier(80) && 'min' in L.getTier(80));

// ─── zoneFor ──────────────────────────────────────────────────────────────────
console.log('\nzoneFor');
assert('sc<20 → drift',                  L.zoneFor(makeTask({ sc:10 }))                       === 'drift');
assert('i>=3, s<=2, sc>=20 → deep',      L.zoneFor(makeTask({ i:3, s:2, sc:50 }))             === 'deep');
assert('i>=3, s<=2, sc>=20 → deep (i=4)',L.zoneFor(makeTask({ i:4, s:1, sc:60 }))             === 'deep');
assert('i>=3 but s=3 → flow',            L.zoneFor(makeTask({ i:3, s:3, sc:60 }))             === 'flow');
assert('i=2, s=3, sc>=20 → flow',        L.zoneFor(makeTask({ i:2, s:3, sc:30 }))             === 'flow');
assert('sc exactly 20 is not drift',     L.zoneFor(makeTask({ i:2, s:3, sc:20 }))             !== 'drift');
assert('sc=19 → drift',                  L.zoneFor(makeTask({ sc:19, i:2, s:3 }))             === 'drift');

// ─── buildZones ───────────────────────────────────────────────────────────────
console.log('\nbuildZones');
const zoneTasks = [
  makeTask({ id:1, sc:10 }),                     // drift
  makeTask({ id:2, i:3, s:2, sc:60 }),            // deep
  makeTask({ id:3, i:2, s:3, sc:40 }),            // flow
  makeTask({ id:4, i:4, s:1, sc:80 }),            // deep
];
const zones = L.buildZones(zoneTasks);
assert('flow has 1 task',  zones.flow.length  === 1);
assert('deep has 2 tasks', zones.deep.length  === 2);
assert('drift has 1 task', zones.drift.length === 1);
assert('all zones present', 'flow' in zones && 'deep' in zones && 'drift' in zones);

// ─── suggestTask ──────────────────────────────────────────────────────────────
console.log('\nsuggestTask');
const suggestTasks = [
  makeTask({ id:10, i:3, s:1, sc:80, bricks:[] }),   // deep, high score
  makeTask({ id:11, i:3, s:1, sc:70, bricks:[] }),   // deep, lower score
  makeTask({ id:12, i:2, s:3, sc:55, bricks:[] }),   // flow quick (s>=3, bricks<=1)
  makeTask({ id:13, i:2, s:3, sc:50, bricks:[{id:1,text:'x',ts:now}] }), // flow quick, 1 brick
  makeTask({ id:14, i:2, s:3, sc:45, bricks:[{id:2,text:'x',ts:now},{id:3,text:'y',ts:now}] }), // flow medium (bricks>1)
  makeTask({ id:15, done:true, i:3, s:1, sc:80 }),   // done — should be excluded
  makeTask({ id:16, agency:'waiting', i:3, s:1, sc:80 }), // waiting — excluded
];

const deepSug = L.suggestTask(suggestTasks, 'deep', []);
assert('deep: returns highest-score deep task',    deepSug?.task.id === 10);
// NOTE: after refactoring, suggestTask will return reasonData instead of reason.
// Once logic.js is updated, replace these assertions with:
//   assert('returns reasonData not reason', 'reasonData' in (deepSug || {}));
//   assert('reasonData has brickCount',     deepSug?.reasonData.brickCount === 0);
//   assert('reasonData has daysOnBoard',    deepSug?.reasonData.daysOnBoard >= 0);
assert('deep: returns a reason string (pre-refactor)', typeof deepSug?.reason === 'string');
assert('deep: reason includes zone label',              deepSug?.reason.includes('Deep'));

const quickSug = L.suggestTask(suggestTasks, 'quick', []);
assert('quick: picks from flow, s>=3, bricks<=1',  quickSug?.task.id === 12);

const medSug = L.suggestTask(suggestTasks, 'medium', []);
assert('medium: picks flow tasks with >1 brick',   medSug?.task.id === 14);

const excl = L.suggestTask(suggestTasks, 'deep', [10]);
assert('exclude: skips task 10, picks task 11',    excl?.task.id === 11);

const noDeep = L.suggestTask([makeTask({ id:20, i:2, s:3, sc:40 })], 'deep', []);
assert('returns null when pool empty',             noDeep === null);

// ─── resolveDrop ──────────────────────────────────────────────────────────────
console.log('\nresolveDrop');
const flowTask = makeTask({ i:2, s:3, sc:40 });  // → flow
const deepTask = makeTask({ i:3, s:1, sc:70 });  // → deep

const flowToDeep = L.resolveDrop(flowTask, 'deep');
assert('flow→deep: returns resolution',    flowToDeep !== null);
assert('flow→deep: has nudge',             typeof flowToDeep?.nudge === 'string');
assert('flow→deep: has apply fn',          typeof flowToDeep?.apply === 'function');
assert('flow→deep: apply mutates simplicity', (() => { const t={...flowTask}; flowToDeep.apply(t); return t.s <= 2; })());

const sameZone = L.resolveDrop(flowTask, 'flow');
assert('same zone → null',                 sameZone === null);

const deepToFlow = L.resolveDrop(deepTask, 'flow');
assert('deep→flow: resolution exists',     deepToFlow !== null);
assert('deep→flow: apply raises simplicity', (() => { const t={...deepTask}; deepToFlow.apply(t); return t.s >= 3; })());

// ─── urgencyAgeFrac ───────────────────────────────────────────────────────────
console.log('\nurgencyAgeFrac');
const overdueTask = makeTask({ u:3, createdAt: now - 10 * L.DAY_MS }); // horizon=4d, 10d old → overdue
const freshTask   = makeTask({ u:3, createdAt: now - 1  * L.DAY_MS }); // 1d old, horizon=4d
const doneTask    = makeTask({ done:true, u:3, createdAt: now - 10 * L.DAY_MS });
const somedayTask = makeTask({ u:1, createdAt: now - 10 * L.DAY_MS });

assert('overdue task → frac > 1',           (L.urgencyAgeFrac(overdueTask) ?? 0) > 1);
assert('fresh task → frac < 1',             (L.urgencyAgeFrac(freshTask)   ?? 0) < 1);
assert('done task → null',                  L.urgencyAgeFrac(doneTask)   === null);
assert('u=1 (someday) → null',              L.urgencyAgeFrac(somedayTask) === null);
assert('acked within 24h → null', (() => {
  const t = makeTask({ u:3, createdAt: now - 10 * L.DAY_MS, urgencyAckedAt: now - 1000 });
  return L.urgencyAgeFrac(t) === null;
})());

// ─── lastTouchedTs ────────────────────────────────────────────────────────────
console.log('\nlastTouchedTs');
const baseTs   = now - 10 * L.DAY_MS;
const brickTs  = now - 2  * L.DAY_MS;
const editTs   = now - 1  * L.DAY_MS;
const taskWithHistory = makeTask({
  createdAt: baseTs,
  bricks: [{ id:1, text:'x', ts: brickTs }],
  edits:  [ editTs ],
});
assert('returns most recent timestamp',       L.lastTouchedTs(taskWithHistory) === editTs);
assert('falls back to createdAt with no history', L.lastTouchedTs(makeTask({ createdAt: baseTs })) === baseTs);

// ─── fmtDuration ─────────────────────────────────────────────────────────────
console.log('\nfmtDuration');
assert('30min → "30m"',     L.fmtDuration(30  * 60000)       === '30m');
assert('2h    → "2h"',      L.fmtDuration(2   * 3600000)     === '2h');
assert('3d    → "3d"',      L.fmtDuration(3   * L.DAY_MS)    === '3d');
assert('2w    → "2w"',      L.fmtDuration(14  * L.DAY_MS)    === '2w');
assert('2mo   → "2mo"',     L.fmtDuration(60  * L.DAY_MS)    === '2mo');

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('❌ Test run failed'); process.exit(1); }
else              console.log('✅ All tests passed');
