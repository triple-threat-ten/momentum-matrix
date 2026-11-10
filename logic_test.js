// logic.test.js — automated tests for logic.js pure functions (+ storage.js migration).
// Run with: node logic_test.js
// No test framework needed — just Node.js.

const fs = require('fs');
const src        = fs.readFileSync(__dirname + '/logic.js', 'utf8');
const storageSrc = fs.readFileSync(__dirname + '/storage.js', 'utf8');

// Stub copy.js constants that logic.js references at runtime
const stubs = `
const URG_WORDS = ['', 'Someday', 'Later', 'Soon', 'Now'];
`;

const L   = new Function(stubs + src + '\nreturn { calcScore, getTier, urgencyAgeLabel, lastTouchedTs, fmtDuration, fmtAgo, isDeep, isDrifted, slipRatio, sortByMode, driftQueue, rerateUrgency, MODES, TIERS, DAY_MS, URG_HORIZON };')();

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

// ─── rerateUrgency ───────────────────────────────────────────────────────────
console.log('\nrerateUrgency');
const rr = L.rerateUrgency(makeTask({ i:3, u:4, s:2, urgencySetAt: ago(9) }), 1, now);
assert('sets the new urgency',                rr.u === 1);
assert('recomputes the Matter score',         rr.sc === L.calcScore(3, 1, 2));
assert('recomputes the tier',                 rr.tier.key === L.getTier(rr.sc).key);
assert('restarts the urgency clock',          rr.urgencySetAt === now);
assert('same value still restarts the clock (still accurate)', (() => {
  const t = makeTask({ u:3, urgencySetAt: ago(10) });
  Object.assign(t, L.rerateUrgency(t, 3, now));
  return t.urgencySetAt === now && L.slipRatio(t, now) === 0;
})());
assert('Someday → drifted; Soon again → back in the list', (() => {
  const t = makeTask({ u:3, urgencySetAt: ago(10) });
  Object.assign(t, L.rerateUrgency(t, 1, now)); const drifted = L.isDrifted(t);
  Object.assign(t, L.rerateUrgency(t, 3, now));
  return drifted && !L.isDrifted(t);
})());
assert('does not mutate the task',            (() => { const t = makeTask({ u:2 }); L.rerateUrgency(t, 4, now); return t.u === 2; })());

// ─── urgencyAgeLabel (badge / reason chip, §4.5) ────────────────────────────
console.log('\nurgencyAgeLabel');
assert('Soon 5d → "1d past Soon" (acceptance §11)',  L.urgencyAgeLabel(makeTask({ u:3, urgencySetAt: ago(5)    }), now) === '1d past Soon');
assert('Soon 4.5d → "today — rated Soon"',           L.urgencyAgeLabel(makeTask({ u:3, urgencySetAt: ago(4.5)  }), now) === 'today — rated Soon');
assert('Soon 10d → "6d past Soon"',                  L.urgencyAgeLabel(makeTask({ u:3, urgencySetAt: ago(10)   }), now) === '6d past Soon');
assert('Later 30d → "2w past Later"',                L.urgencyAgeLabel(makeTask({ u:2, urgencySetAt: ago(30)   }), now) === '2w past Later');
assert('within horizon → null',                      L.urgencyAgeLabel(makeTask({ u:3, urgencySetAt: ago(2)    }), now) === null);
assert('Someday → null',                             L.urgencyAgeLabel(makeTask({ u:1, urgencySetAt: ago(100)  }), now) === null);
assert('counts from urgencySetAt, not createdAt',    L.urgencyAgeLabel(makeTask({ u:3, createdAt: ago(60), urgencySetAt: ago(1) }), now) === null);

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
