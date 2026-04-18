#!/usr/bin/env node
// ─── Momentum Matrix — DOM Integrity Check ───────────────────────────────────
// Verifies that every element ID referenced in app.js exists in index.html,
// and that every data-action used in HTML is handled in app.js.
//
// Usage:  node dom_check.js
// Requires: Node.js (no external dependencies)

const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const HTML     = path.join(ROOT, 'index.html');
const APP_JS   = path.join(ROOT, 'app.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readFile(p) {
  if (!fs.existsSync(p)) { console.error(`✗ File not found: ${p}`); process.exit(1); }
  return fs.readFileSync(p, 'utf8');
}

function extractMatches(str, pattern) {
  const results = new Set();
  let m;
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  while ((m = re.exec(str)) !== null) results.add(m[1]);
  return results;
}

// ─── Load files ──────────────────────────────────────────────────────────────

const html  = readFile(HTML);
const appJs = readFile(APP_JS);

// ─── 1. IDs declared in HTML ─────────────────────────────────────────────────

const htmlIds = extractMatches(html, /\bid="([^"]+)"/);

// ─── 2. IDs referenced via g() in app.js ─────────────────────────────────────
// g() is the shorthand for getElementById used throughout app.js

const gCalls = extractMatches(appJs, /\bg\('([^']+)'\)/);

// ─── 3. IDs referenced via getElementById in app.js ──────────────────────────

const getByIdCalls = extractMatches(appJs, /getElementById\('([^']+)'\)/);

// ─── 4. data-action values used in HTML ──────────────────────────────────────

const actionsUsed = extractMatches(html, /data-action="([^"]+)"/);

// ─── 5. data-action values handled in app.js switch ─────────────────────────

const actionsHandled = extractMatches(appJs, /case '([^']+)':/);

// ─── 6. querySelector('#id') calls ───────────────────────────────────────────

const queriedIds = new Set();
const qsRe = /querySelector\(['"`]#([a-zA-Z][\w-]*)['"`]\)/g;
let qm;
while ((qm = qsRe.exec(appJs)) !== null) queriedIds.add(qm[1]);

// ─── Combine all referenced IDs ───────────────────────────────────────────────

const allReferencedIds = new Set([...gCalls, ...getByIdCalls, ...queriedIds]);

// ─── Known dynamic IDs (built at runtime, not static in HTML) ────────────────
// These are IDs constructed via string concatenation (e.g. 'pTab' + cap(key))
// They exist in HTML but can't be statically verified — skip them.

const DYNAMIC_PREFIXES = ['pTab', 'pCtx', 'mvFlow', 'mvDeep', 'mvDrift'];
const KNOWN_FALSE_POSITIVES = new Set([
  // IDs that are injected dynamically into innerHTML, not static in HTML
  'brickCtaCard', 'brickLinkCta', 'brickInp', 'btnBrickSave', 'btnBrickCancel',
  'btnApplyScore', 'pBrickDetailDel', 'pBrickDetailText', 'pBrickDetailTs',
  'btnDriftKeep', 'btnDriftAction', 'pAvoidanceText',
  // Halo card — injected dynamically when timer is running
  'haloTimerLabel', 'btnHaloAnother',
  // Drag-and-drop confirm bar — injected dynamically on drop
  'btnDragApply', 'btnDragCancel',
  // IDs inside dynamically rendered modal content
  'ltcFromName', 'ltcToName', 'mergeKeepName', 'mergeAbsorbName',
]);

// ─── Run checks ──────────────────────────────────────────────────────────────

let pass = 0, fail = 0, warn = 0;
const errors = [], warnings = [];

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║     Momentum Matrix — DOM Integrity Check            ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

// CHECK 1: All g() / getElementById / querySelector('#id') calls resolve
console.log('── Check 1: Element IDs referenced in app.js ───────────');
const missing = [];
for (const id of [...allReferencedIds].sort()) {
  if (KNOWN_FALSE_POSITIVES.has(id)) { warn++; warnings.push(`  SKIP (dynamic) : ${id}`); continue; }
  if (DYNAMIC_PREFIXES.some(p => id.startsWith(p))) { warn++; continue; }
  if (htmlIds.has(id)) { pass++; }
  else { fail++; missing.push(id); }
}
if (missing.length) {
  missing.forEach(id => errors.push(`  MISSING in HTML : ${id}`));
  console.log(`  ✗ ${missing.length} missing ID(s):`);
  missing.forEach(id => console.log(`      ✗ ${id}`));
} else {
  console.log(`  ✓ All ${pass} referenced IDs found in HTML`);
}

// CHECK 2: All data-action values in HTML are handled in app.js
console.log('\n── Check 2: data-action coverage ───────────────────────');
const unhandledActions = [...actionsUsed].filter(a => !actionsHandled.has(a)).sort();
if (unhandledActions.length) {
  fail += unhandledActions.length;
  console.log(`  ✗ ${unhandledActions.length} unhandled action(s):`);
  unhandledActions.forEach(a => {
    console.log(`      ✗ ${a}`);
    errors.push(`  UNHANDLED action : ${a}`);
  });
} else {
  pass += actionsUsed.size;
  console.log(`  ✓ All ${actionsUsed.size} data-action values are handled`);
}

// CHECK 3: No references to known removed elements
console.log('\n── Check 3: Removed element guard ──────────────────────');
const REMOVED_IDS = [
  'addOverlay', 'addModal', 'btnAddClose', 'btnAddTask', 'taskInput',
  'addNote', 'addContextInput', 'addContextRow', 'scoreOrbTier', 'scoreOrbNudge',
  'impRange', 'urgRange', 'simRange', 'impWord', 'urgWord', 'simWord',
  'triageOverlay', 'triageTaskName', 'triageNote', 'triageProgress', 'triageTaskAge',
  'triageContextInput', 'triageContextRow', 'btnTriSend', 'btnTriSkip', 'btnTriDel',
  'btnTriageClose', 'tOrbCircle', 'tOrbRing', 'tOrbNum', 'tOrbTier',
  'tImp', 'tUrg', 'tSim',
];
const zombies = REMOVED_IDS.filter(id => {
  const re = new RegExp(`g\\('${id}'\\)|getElementById\\('${id}'\\)`);
  return re.test(appJs);
});
if (zombies.length) {
  fail += zombies.length;
  console.log(`  ✗ ${zombies.length} reference(s) to removed elements:`);
  zombies.forEach(id => {
    console.log(`      ✗ ${id}`);
    errors.push(`  ZOMBIE reference : ${id}`);
  });
} else {
  pass += REMOVED_IDS.length;
  console.log(`  ✓ No references to removed elements`);
}

// CHECK 4: Warn about stale IDs in HTML with no JS reference
console.log('\n── Check 4: Unreferenced IDs in HTML (advisory) ────────');
const IGNORE_UNREFERENCED = new Set([
  // IDs used only by CSS, aria, or label[for]
  'importInput', 'quickInput', 'captureWrap', 'actPage',
  // IDs referenced from inline event handlers in HTML
  'pNameInput', 'pNote',
]);
const unreferenced = [...htmlIds].filter(id =>
  !allReferencedIds.has(id) &&
  !IGNORE_UNREFERENCED.has(id) &&
  !DYNAMIC_PREFIXES.some(p => id.startsWith(p))
).sort();
if (unreferenced.length) {
  console.log(`  ⚠  ${unreferenced.length} HTML ID(s) with no JS reference (may be CSS/aria only):`);
  unreferenced.slice(0, 10).forEach(id => console.log(`      ?  ${id}`));
  if (unreferenced.length > 10) console.log(`      … and ${unreferenced.length - 10} more`);
} else {
  console.log(`  ✓ No unreferenced IDs`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════');
if (fail === 0) {
  console.log(`  ✓ ALL CHECKS PASSED  (${pass} checks, ${warn} skipped as dynamic)\n`);
} else {
  console.log(`  ✗ FAILED  —  ${fail} issue(s), ${pass} passed, ${warn} skipped\n`);
  errors.forEach(e => console.log(e));
  console.log('');
  process.exit(1);
}
