// packages/kernel/_lib/enum-validate.js
//
// Shared R4 closed-enum validation with an NFC/homoglyph defense. The 5th extract-to-kernel/_lib for
// cross-layer reuse (canonical-json / recency-decay / jsonl-read / evolution-snapshot-read / this).
// PURE + side-effect-free (no env, no I/O, no module-load state) so ANY layer may require it
// (lab -> kernel/_lib = outer -> inner = K12-legal). Extracted VERBATIM (behavior-identical) from
// packages/lab/causal-edge/enums.js (Wave 2) so the causal-edge store AND the v3.5 manage-proposal
// store share ONE homoglyph defense - a SECURITY validator must not be duplicated (two copies drift,
// and the gap is a silent homoglyph-bypass on whichever copy lagged a fix). Error messages take a
// NEUTRAL `enum-validate:` prefix (NOT a layer name) so each consumer's errors name its own field
// honestly. The causal-edge/enums.js migration to re-export this leaf is a NAMED follow-up.

'use strict';

/**
 * NFC/homoglyph defense for an enum-candidate field. Normalize to NFC, then reject any codepoint
 * > U+007F BEFORE the closed-enum membership check. Catches Cyrillic/Greek lookalikes, combining
 * sequences, zero-width joiners, and the BOM - none can appear in a legitimate ASCII enum value, but
 * all can spoof one visually.
 *
 * @param {*} v the raw field value
 * @param {string} fieldName for the error message
 * @returns {string} the NFC-normalized pure-ASCII string (membership-checkable)
 * @throws if v is not a string, or contains a non-ASCII codepoint
 */
function normalizeAsciiEnum(v, fieldName) {
  if (typeof v !== 'string') {
    throw new Error(`enum-validate: ${fieldName} must be a string (got ${typeof v})`);
  }
  const nfc = v.normalize('NFC');
  for (let i = 0; i < nfc.length; i += 1) {
    if (nfc.charCodeAt(i) > 0x7f) {
      throw new Error(`enum-validate: ${fieldName} contains a non-ASCII codepoint (homoglyph / zero-width / combining rejected before the enum check)`);
    }
  }
  return nfc;
}

/**
 * Validate an enum-candidate field: NFC/ASCII defense, then closed-set membership.
 *
 * @param {*} v raw value
 * @param {readonly string[]} validSet the closed enum
 * @param {string} fieldName for the error message
 * @returns {string} the validated value
 * @throws if non-ASCII or not a member
 */
function validateEnum(v, validSet, fieldName) {
  const ascii = normalizeAsciiEnum(v, fieldName);
  if (!validSet.includes(ascii)) {
    throw new Error(`enum-validate: ${fieldName} must be one of ${validSet.join('|')} (got ${JSON.stringify(ascii)})`);
  }
  return ascii;
}

module.exports = { normalizeAsciiEnum, validateEnum };
