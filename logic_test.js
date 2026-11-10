// logic.test.js — automated tests for logic.js pure functions (+ storage.js migration).
// Run with: node logic_test.js
// No test framework needed — just Node.js.

const fs = require('fs');
const src        = fs.readFileSync(__dirname + '/logic.js', 'utf8');
const storageSrc = fs.readFileSync(__dirname + '/storage.js', 'utf8');

// Stub copy.js constants that logic.js references at runtime
const stubs = `
const REASON_HIGHEST = (zone) => 'Highest Matter score in ' + zone;
const REASON_NEVER   = 'Never started';
const REASON_BRICKS  = (n) => n + ' brick' + (n !== 1 ? 's' : '');
const REASON_AGE     = (d) => d + 'd in board';
`;

const L   = new Function(stubs + src + '\nreturn { calcScore, getTier, zoneFor, buildZones, suggestTask, resolveDrop, urgencyAgeFrac, urgencyAgeLabel, lastTouchedTs, fmtDuration, fmtAgo, isDeep, isDrifted, slipRatio, sortByMode, driftQueue, MODES, TIERS, DAY_MS, URG_HORIZON, SESSION_CAP };')();

// storage.js loaded alongside logic.js (it needs calcScore / getTier). Only pure helpers are exercised.
const S   = new Function(stubs + src + '\n' + storageSrc + '\nreturn { migrateTask, serializeTask, DROPPED_FIELDS };')();

let passed = 0, failed = 0;

function assert(label, condition) {
  if (condition) { console.log('  ✅', label); passed++; }
  else           { console.error('  ❌', label); failed++; }
}

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const now = Date.now();
function makeTask(overrides) {
  const createdAt = overrides.createdAt ?? now - 5 * L.DAY_MS;
  return {
    id: 1001, name: 'Test task', i: 2, u: 2, s: 3,
    sc: L.calcScore(overrides.i ?? 2, overrides.u ?? 2, overrides.s ?? 3),
    done: false, agency: 'solo', bricks: [], context: '',
    createdAt, doneAt: null, edits: [],
    urgencyAckedAt: null, urgencySetAt: createdAt,
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

// ─── zoneFor (deprecated v26 — remove in session ②) ──────────────────────────
console.log('\nzoneFor (deprecated)');
assert('sc<20 → drift',                  L.zoneFor(makeTask({ sc:10 }))                       === 'drift');
assert('i>=3, s<=2, sc>=20 → deep',      L.zoneFor(makeTask({ i:3, s:2, sc:50 }))             === 'deep');
assert('i>=3, s<=2, sc>=20 → deep (i=4)',L.zoneFor(makeTask({ i:4, s:1, sc:60 }))             === 'deep');
assert('i>=3 but s=3 → flow',            L.zoneFor(makeTask({ i:3, s:3, sc:60 }))             === 'flow');
assert('i=2, s=3, sc>=20 → flow',        L.zoneFor(makeTask({ i:2, s:3, sc:30 }))             === 'flow');
assert('sc exactly 20 is not drift',     L.zoneFor(makeTask({ i:2, s:3, sc:20 }))             !== 'drift');
assert('sc=19 → drift',                  L.zoneFor(makeTask({ sc:19, i:2, s:3 }))             === 'drift');

// ─── buildZones (deprecated v26) ─────────────────────────────────────────────
console.log('\nbuildZones (deprecated)');
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

// ─── suggestTask (deprecated v26) ────────────────────────────────────────────
console.log('\nsuggestTask (deprecated)');
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

// ─── resolveDrop (deprecated v26) ────────────────────────────────────────────
console.log('\nresolveDrop (deprecated)');
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

// ─── urgencyAgeFrac (deprecated v26) ─────────────────────────────────────────
console.log('\nurgencyAgeFrac (deprecated)');
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

// ═══ v26 CONTEXTS MODEL ═══════════════════════════════════════════════════════
const ago = d => now - d * L.DAY_MS;

// ─── isDeep ──────────────────────────────────────────────────────────────────
console.log('\nisDeep');
assert('I=3, S=2 → deep',                  L.isDeep(makeTask({ i:3, s:2 })) === true);
assert('I=4, S=1 → deep',                  L.isDeep(makeTask({ i:4, s:1 })) === true);
assert('I=3, S=3 → not deep (easy start)', L.isDeep(makeTask({ i:3, s:3 })) === false);
assert('I=2, S=1 → not deep (not important enough)', L.isDeep(makeTask({ i:2, s:1 })) === false);
assert('ignores score (low sc still deep)',L.isDeep(makeTask({ i:3, s:1, sc:5 })) === true);

// ─── isDrifted ───────────────────────────────────────────────────────────────
console.log('\nisDrifted');
assert('U=1 (Someday) → drifted',          L.isDrifted(makeTask({ u:1 })) === true);
assert('U=2 (Later) → not drifted',        L.isDrifted(makeTask({ u:2 })) === false);
assert('U=4 low score → not drifted (old <20 rule gone)', L.isDrifted(makeTask({ u:4, sc:10 })) === false);
assert('done Someday task → not drifted',  L.isDrifted(makeTask({ u:1, done:true })) === false);

// ─── slipRatio ───────────────────────────────────────────────────────────────
console.log('\nslipRatio');
const near = (a, b) => a !== null && Math.abs(a - b) < 1e-9;
assert('Soon set 5d ago → 1.25 (amber: >1, <2)', near(L.slipRatio(makeTask({ u:3, urgencySetAt: ago(5) }), now), 1.25));
assert('Soon set 8d ago → 2 (red: ≥2)',          near(L.slipRatio(makeTask({ u:3, urgencySetAt: ago(8) }), now), 2));
assert('Soon set 2d ago → 0.5 (not slipping)',   near(L.slipRatio(makeTask({ u:3, urgencySetAt: ago(2) }), now), 0.5));
assert('Now: 1-day horizon (3d → 3)',            near(L.slipRatio(makeTask({ u:4, urgencySetAt: ago(3) }), now), 3));
assert('Later: 14-day horizon (7d → 0.5)',       near(L.slipRatio(makeTask({ u:2, urgencySetAt: ago(7) }), now), 0.5));
assert('Someday → null (no horizon)',            L.slipRatio(makeTask({ u:1, urgencySetAt: ago(100) }), now) === null);
assert('done → null',                            L.slipRatio(makeTask({ u:3, done:true, urgencySetAt: ago(10) }), now) === null);
assert('invalid urgency (5) → null',             L.slipRatio(makeTask({ u:5 }), now) === null);
assert('uses urgencySetAt, not createdAt',       near(L.slipRatio(makeTask({ u:3, createdAt: ago(30), urgencySetAt: ago(1) }), now), 0.25));
assert('falls back to createdAt if unset',       near(L.slipRatio(makeTask({ u:3, createdAt: ago(6), urgencySetAt: undefined }), now), 1.5));
assert('re-rating resets the clock (set now → 0)', near(L.slipRatio(makeTask({ u:3, createdAt: ago(30), urgencySetAt: now }), now), 0));
assert('ignores urgencyAckedAt (no 24h ack in v26)', L.slipRatio(makeTask({ u:3, urgencySetAt: ago(10), urgencyAckedAt: now }), now) > 1);
assert('defaults now to Date.now()',             L.slipRatio(makeTask({ u:3, urgencySetAt: ago(8) })) >= 2);

// ─── sortByMode ──────────────────────────────────────────────────────────────
console.log('\nsortByMode');
// Scores: T1=100 · T3=66 · T4=48 · T5=34 · T2=24
const mk = (id, i, u, s, setDaysAgo) => makeTask({ id, i, u, s, sc:L.calcScore(i,u,s), urgencySetAt: ago(setDaysAgo) });
const sortSet = [
  mk(2, 1,2,4, 1),
  mk(5, 2,3,2, 10),  // Soon, 10d → ratio 2.5 (most overdue)
  mk(4, 4,3,1, 2),   // Soon, 2d  → ratio 0.5
  mk(1, 4,4,4, 0),
  mk(3, 3,3,4, 2),   // Soon, 2d  → ratio 0.5 (ties T4 on slip → Matter decides)
];
const ids = arr => arr.map(t => t.id);
assert('Balanced: Matter ↓',                         eq(ids(L.sortByMode(sortSet, 'balanced', now)), [1,3,4,5,2]));
assert('Quick wins: Simplicity ↓, then Matter ↓',    eq(ids(L.sortByMode(sortSet, 'quick',    now)), [1,3,2,5,4]));
assert('In the zone: Urgency ↓, Slip ↓, Matter ↓',   eq(ids(L.sortByMode(sortSet, 'zone',     now)), [1,5,3,4,2]));
assert('Focus time: Importance ↓, then Matter ↓',    eq(ids(L.sortByMode(sortSet, 'focus',    now)), [1,4,3,5,2]));
assert('unknown / null mode → Balanced',             eq(ids(L.sortByMode(sortSet, null, now)), [1,3,4,5,2]) && eq(ids(L.sortByMode(sortSet, 'nope', now)), [1,3,4,5,2]));
assert('does not mutate the input array',            eq(ids(sortSet), [2,5,4,1,3]));
assert('returns a new array',                        L.sortByMode(sortSet, 'balanced', now) !== sortSet);
assert('full tie keeps input order (stable)', (() => {
  const a = mk(91, 2,2,3, 1), b = mk(92, 2,2,3, 1);
  return eq(ids(L.sortByMode([a,b], 'focus', now)), [91,92]) && eq(ids(L.sortByMode([b,a], 'focus', now)), [92,91]);
})());
assert('MODES lists the four views',                 eq(L.MODES, ['balanced','quick','zone','focus']));

// ─── driftQueue ──────────────────────────────────────────────────────────────
console.log('\ndriftQueue');
const dq = [
  makeTask({ id:21, u:2, sc:40, urgencySetAt: ago(20) }), // Later 20d → 1.43 slipping
  makeTask({ id:22, u:1, sc:15 }),                         // Someday, low
  makeTask({ id:23, u:3, sc:60, urgencySetAt: ago(10) }), // Soon 10d  → 2.5 slipping (most overdue)
  makeTask({ id:24, u:3, sc:70, urgencySetAt: ago(1)  }), // Soon fresh → not in queue
  makeTask({ id:25, u:1, sc:30 }),                         // Someday, higher
  makeTask({ id:26, u:1, sc:90, done:true }),              // done → excluded
  makeTask({ id:27, u:3, sc:50, done:true, urgencySetAt: ago(30) }), // done slipping → excluded
];
assert('slipping (most overdue first), then drifted (Matter ↓)', eq(ids(L.driftQueue(dq, now)), [23,21,25,22]));
assert('excludes ids reviewed this session',        eq(ids(L.driftQueue(dq, now, [23, 25])), [21,22]));
assert('accepts a Set for exclude',                 eq(ids(L.driftQueue(dq, now, new Set([21]))), [23,25,22]));
assert('ratio exactly 1 is not slipping',           L.driftQueue([makeTask({ id:31, u:3, urgencySetAt: ago(4) })], now).length === 0);
assert('empty input → empty queue',                 eq(L.driftQueue([], now), []));

// ─── storage.js: migrateTask / serializeTask ─────────────────────────────────
console.log('\nstorage migration (v26)');
const legacy = () => ({
  id: 501, name: 'Legacy', i: 3, u: 3, s: 2, sc: 50, done: false, bricks: [],
  createdAt: ago(20), doneAt: null, views: [], edits: [ago(12), ago(4), ago(9)], note: '',
  agency: 'waiting', context: 'Thierry', links: [{ targetId: 2, type: 'before' }], urgencyAckedAt: ago(1),
});
const m1 = S.migrateTask(legacy());
assert('urgencySetAt = most recent edit',            m1.urgencySetAt === ago(4));
assert('urgencySetAt = createdAt when no edits',     S.migrateTask({ ...legacy(), edits: [] }).urgencySetAt === ago(20));
assert('existing urgencySetAt is kept',              S.migrateTask({ ...legacy(), urgencySetAt: ago(2) }).urgencySetAt === ago(2));
assert('dropped fields removed on load',             S.DROPPED_FIELDS.every(k => !(k in m1)));
assert('keep-list fields preserved',                 ['id','name','i','u','s','sc','tier','done','doneAt','bricks','createdAt','views','edits','note'].every(k => k in m1));
assert('idempotent (second pass changes nothing)',   eq(S.migrateTask({ ...m1 }), m1));
const inMemory = { ...m1, agency: 'solo', context: '', links: [], urgencyAckedAt: now };
const out = S.serializeTask(inMemory);
assert('serializeTask strips dropped fields',        S.DROPPED_FIELDS.every(k => !(k in out)));
assert('serializeTask keeps urgencySetAt',           out.urgencySetAt === m1.urgencySetAt);
assert('serializeTask does not mutate the task',     inMemory.agency === 'solo' && Array.isArray(inMemory.links));

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('❌ Test run failed'); process.exit(1); }
else              console.log('✅ All tests passed');
