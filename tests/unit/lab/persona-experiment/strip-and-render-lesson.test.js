'use strict';

// @loom-layer: lab (test)
//
// Track A W1 - the shared lesson sanitizer leaf (consumed by BOTH grounding-slice arm-C and the
// recall-inject boundary). Pins the sanitize contract directly on the leaf so both consumers inherit a
// tested guarantee: control (C0/DEL/C1) + Unicode-format (Cf/bidi/zero-width) strip, whitespace collapse,
// bounded single line. The C1 + Cf cases are the VALIDATE #hacker M1 / H7 folds. All non-ASCII test
// vectors are BUILT from numeric codepoints via String.fromCharCode (pure-ASCII source, explicit intent,
// robust against invisible-char corruption in the fixture).

const assert = require('assert');
const {
  stripControlChars, stripFormatChars, sanitizeLessonText, renderLessonLine, DEFAULT_LESSON_LINE_MAX,
} = require('../../../../packages/lab/persona-experiment/_lib/strip-and-render-lesson');

// Attack codepoints, built from numbers (no raw invisible chars in source).
const C0 = String.fromCharCode(0x00, 0x07, 0x1b);            // NUL, BEL, ESC
const DEL = String.fromCharCode(0x7f);
const C1 = String.fromCharCode(0x80, 0x85, 0x9b, 0x9f);      // C1 incl. NEL (0x85) + CSI (0x9b)
const CF = String.fromCharCode(0x202e, 0x202c, 0x200b, 0xfeff, 0x2066, 0x2069, 0x00ad, 0x061c); // bidi/ZW/BOM/isolates/SHY/ALM
const RLO = String.fromCharCode(0x202e);
const PDF = String.fromCharCode(0x202c);
const ZWSP = String.fromCharCode(0x200b);

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`ok - ${name}\n`); }
  catch (e) { failed++; process.stdout.write(`NOT ok - ${name}\n  ${(e && e.message) || e}\n`); }
}

// --- stripControlChars: C0 + DEL + C1 -------------------------------------------------------------
test('stripControlChars drops C0 (NUL/BEL/ESC), DEL, and the C1 range (NEL/CSI)', () => {
  assert.strictEqual(stripControlChars(`a${C0}b`), 'ab', 'C0 not stripped');
  assert.strictEqual(stripControlChars(`a${DEL}b`), 'ab', 'DEL not stripped');
  assert.strictEqual(stripControlChars(`a${C1}b`), 'ab', 'C1 range not stripped (M1)');
  assert.strictEqual(stripControlChars('normal text 123'), 'normal text 123', 'printable text must survive');
});

// --- stripFormatChars: Cf (bidi / zero-width / BOM / SHY / isolates) -------------------------------
test('stripFormatChars drops the Cf category (bidi / zero-width / BOM / isolates)', () => {
  assert.strictEqual(stripFormatChars(`a${CF}b`), 'ab');
  assert.strictEqual(stripFormatChars('plain'), 'plain', 'plain text unaffected');
});

// --- sanitizeLessonText: whitespace collapse + all strips + trim -----------------------------------
test('sanitizeLessonText collapses whitespace, strips control+format, trims', () => {
  assert.strictEqual(sanitizeLessonText('  a\t\n b   c  '), 'a b c');
  assert.strictEqual(sanitizeLessonText(`safe${RLO}reversed${PDF} mid${ZWSP}word`), 'safereversed midword');
  // RLO + ZWSP are non-whitespace Cf (unlike BOM, which JS \s folds to a space first), so a${C1}...b -> ab.
  assert.strictEqual(sanitizeLessonText(`a${C1}${RLO}${ZWSP}b`), 'ab', 'C1 + Cf both stripped in one pass');
  assert.strictEqual(sanitizeLessonText(null), '', 'null -> empty (never throws)');
  assert.strictEqual(sanitizeLessonText(undefined), '', 'undefined -> empty');
  assert.strictEqual(sanitizeLessonText(42), '42', 'a non-string is coerced, not thrown');
});

// --- renderLessonLine: prefix, empty fallback, bounded truncation ---------------------------------
test('renderLessonLine prefixes "- ", falls back to (lesson) on empty, truncates with an ellipsis', () => {
  assert.strictEqual(renderLessonLine('hello world', {}), '- hello world');
  assert.strictEqual(renderLessonLine('   ', {}), '- (lesson)', 'whitespace-only -> (lesson)');
  assert.strictEqual(renderLessonLine(`${ZWSP}${RLO}`, {}), '- (lesson)', 'format-only -> (lesson)');
  const long = 'x'.repeat(1000);
  const line = renderLessonLine(long, { lineMax: 50 });
  assert.ok(line.length <= 52 && line.endsWith(' ...'), `bounded + ellipsis (got len ${line.length})`);
  assert.ok(renderLessonLine('y'.repeat(DEFAULT_LESSON_LINE_MAX + 100), {}).endsWith(' ...'), 'default lineMax truncates');
});

// --- surrogate-safe truncation (CodeRabbit): a cut mid-emoji must not leave a LONE surrogate ---------
function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(i + 1); if (!(n >= 0xdc00 && n <= 0xdfff)) return true; }
    else if (c >= 0xdc00 && c <= 0xdfff) { const p = s.charCodeAt(i - 1); if (!(p >= 0xd800 && p <= 0xdbff)) return true; }
  }
  return false;
}
test('renderLessonLine truncation never splits a surrogate pair (no lone surrogate)', () => {
  const emoji = String.fromCodePoint(0x1f600); // astral codepoint = a surrogate pair
  // slide the emoji across the cut boundary (lineMax - 4) for a range of caps
  for (let max = 6; max <= 20; max += 1) {
    for (let padLeft = 0; padLeft <= max; padLeft += 1) {
      const line = renderLessonLine(`${'x'.repeat(padLeft)}${emoji}${'y'.repeat(30)}`, { lineMax: max });
      assert.ok(!hasLoneSurrogate(line), `lone surrogate at lineMax=${max}, pad=${padLeft}: ${JSON.stringify(line)}`);
    }
  }
  // a complete emoji that fits is preserved intact
  assert.ok(renderLessonLine(`ab${emoji}cd`, { lineMax: 100 }).includes(emoji), 'a fitting emoji must survive');
});

process.stdout.write(`\n=== strip-and-render-lesson: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
