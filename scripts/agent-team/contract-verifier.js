#!/usr/bin/env node

// Contract verifier — runs functional + anti-pattern checks against an
// agent's output. Returns JSON with verdict and per-check results.
// Also calls pattern-recorder.js to feed the self-learning loop.
//
// Usage:
//   node contract-verifier.js \
//     --contract path/to/contract.json \
//     --output path/to/agent-output.md \
//     [--previous-run path/to/prior/findings/dir] \
//     [--no-record]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.contract || !args.output) {
  console.error('Usage: contract-verifier.js --contract X.json --output Y.md [--previous-run Z]');
  process.exit(1);
}

const contract = JSON.parse(fs.readFileSync(args.contract, 'utf8'));
const output = fs.readFileSync(args.output, 'utf8');

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { frontmatter: fm, body: text.slice(end + 4).trim() };
}

const parsed = parseFrontmatter(output);
const body = parsed ? parsed.body : output;
const frontmatter = parsed ? parsed.frontmatter : {};

function countFindings(text) {
  const sections = text.match(/^##\s+(?:🔴|🟠|🟡|🔵)?\s*(CRITICAL|HIGH|MEDIUM|LOW)\b/gim) || [];
  let total = 0;
  for (const sec of sections) {
    const after = text.slice(text.indexOf(sec) + sec.length);
    const next = after.search(/\n##\s+/);
    const segment = next === -1 ? after : after.slice(0, next);
    const items = (segment.match(/^###\s+/gm) || []).length + (segment.match(/^[*-]\s+\*\*/gm) || []).length;
    total += items;
  }
  return total;
}

function countFileCitations(text) {
  const matches = text.match(/(?:[a-zA-Z_./-]+\.[a-z]{1,4}):\d+|\*\*File\*\*:\s*\S+|`[a-zA-Z_./-]+\.[a-z]{1,4}`/g) || [];
  return matches.length;
}

function jaccard(a, b) {
  const aw = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const bw = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let inter = 0;
  for (const w of aw) if (bw.has(w)) inter++;
  return inter / (aw.size + bw.size - inter);
}

const functionalChecks = {
  outputContainsFrontmatter: () => parsed !== null,
  frontmatterHasFields: (cArgs) => {
    if (!parsed) return false;
    return cArgs.fields.every((f) => frontmatter[f] !== undefined);
  },
  minFindings: (cArgs) => countFindings(body) >= cArgs.min,
  hasFileCitations: (cArgs) => countFileCitations(body) >= cArgs.min,
  hasSeveritySections: (cArgs) => cArgs.severities.some((s) => new RegExp(`##\\s+(?:🔴|🟠|🟡|🔵)?\\s*${s}\\b`, 'i').test(body)),
  outputLengthMin: (cArgs) => body.length >= cArgs.min,
  outputLengthMax: (cArgs) => body.length <= cArgs.max,
  containsKeywords: (cArgs) => cArgs.keywords.every((k) => body.toLowerCase().includes(k.toLowerCase())),
};

const antiPatternChecks = {
  noTextSimilarityToPriorRun: (cArgs) => {
    const priorDir = cArgs.priorRunDir || args['previous-run'];
    if (!priorDir || !fs.existsSync(priorDir)) return { pass: true, reason: 'no_prior_run' };
    const priorFiles = fs.readdirSync(priorDir).filter((f) => f.endsWith('.md'));
    let maxSim = 0;
    for (const pf of priorFiles) {
      const priorText = fs.readFileSync(path.join(priorDir, pf), 'utf8');
      const sim = jaccard(body, priorText);
      if (sim > maxSim) maxSim = sim;
    }
    return { pass: maxSim < (cArgs.threshold || 0.7), similarity: maxSim };
  },
  noTemplateRepetition: (cArgs) => {
    const findings = (body.match(/^###\s+[^\n]+\n[\s\S]*?(?=^###|\Z)/gm) || []);
    if (findings.length < 2) return { pass: true, reason: 'too_few_findings' };
    const similarities = [];
    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        similarities.push(jaccard(findings[i], findings[j]));
      }
    }
    const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    const variation = 1 - avgSim;
    return { pass: variation >= (cArgs.minVariation || 0.3), variation };
  },
  claimsHaveEvidence: (cArgs) => {
    const markers = (cArgs && cArgs.markers) || ['file:line', 'verified by', 'lines '];
    const seriousSections = body.match(/##\s+(?:🔴|🟠)?\s*(CRITICAL|HIGH)\b[\s\S]*?(?=^##\s|\Z)/gim) || [];
    if (seriousSections.length === 0) return { pass: true, reason: 'no_serious_findings' };
    for (const section of seriousSections) {
      // Empty/none sections (e.g., "None this run") are valid — no claims means nothing to evidence
      const sectionBody = section.replace(/^##\s+[^\n]*\n/, '').trim();
      if (sectionBody.length < 100 && /\bnone\b/i.test(sectionBody)) continue;
      // Sections with no actual findings (no ###  or - **) don't need evidence
      const hasFindings = /^###\s+/m.test(section) || /^[*-]\s+\*\*/m.test(section);
      if (!hasFindings) continue;
      const hasEvidence = markers.some((m) => section.toLowerCase().includes(m.toLowerCase())) ||
                         /\.[a-z]{1,4}:\d+/i.test(section) ||
                         /`[a-zA-Z_./-]+\.[a-z]{1,4}`/.test(section) ||
                         /lines?\s+\d+/i.test(section);
      if (!hasEvidence) return { pass: false, reason: 'serious_finding_without_evidence', sample: section.slice(0, 200) };
    }
    return { pass: true };
  },
  noPaddingPhrases: (cArgs) => {
    const phrases = (cArgs && cArgs.phrases) || ['I reviewed everything', 'looks good overall', 'all is well', 'nothing to report'];
    for (const phrase of phrases) {
      if (body.toLowerCase().includes(phrase.toLowerCase())) return { pass: false, foundPhrase: phrase };
    }
    return { pass: true };
  },
  acknowledgesFallback: () => {
    const constraintMentions = /\b(blocked|unavailable|denied|not\s+available|sandboxed)\b/i.test(body);
    if (!constraintMentions) return { pass: true, reason: 'no_constraints_encountered' };
    const acknowledgments = /\b(fell\s+back|instead\s+I|since\s+\w+\s+(?:was|is)\s+(?:unavailable|blocked)|methodology\s+note)\b/i.test(body);
    return { pass: acknowledgments, hadConstraints: true };
  },
  noDuplicateFindingIds: () => {
    const ids = (body.match(/^###\s+([A-Z]+-?\d+)/gm) || []).map((m) => m.replace(/^###\s+/, ''));
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) return { pass: false, duplicateId: id };
      seen.add(id);
    }
    return { pass: true };
  },
};

const result = {
  agentId: contract.agentId,
  persona: contract.persona,
  contractFile: args.contract,
  outputFile: args.output,
  ranAt: new Date().toISOString(),
  functional: {},
  antiPattern: {},
};

let functionalFailures = 0;
let antiPatternFailures = 0;
let antiPatternWarns = 0;

for (const check of contract.functional || []) {
  const fn = functionalChecks[check.check];
  if (!fn) {
    result.functional[check.id] = { check: check.check, status: 'unknown_check' };
    continue;
  }
  try {
    const passed = fn(check.args || {});
    result.functional[check.id] = { check: check.check, status: passed ? 'pass' : 'fail' };
    if (!passed && check.required !== false) functionalFailures++;
  } catch (err) {
    result.functional[check.id] = { check: check.check, status: 'error', error: err.message };
    if (check.required !== false) functionalFailures++;
  }
}

for (const check of contract.antiPattern || []) {
  const fn = antiPatternChecks[check.check];
  if (!fn) {
    result.antiPattern[check.id] = { check: check.check, status: 'unknown_check' };
    continue;
  }
  try {
    const ret = fn(check.args || {});
    const passed = typeof ret === 'object' ? ret.pass : ret;
    result.antiPattern[check.id] = {
      check: check.check,
      status: passed ? 'pass' : (check.severity === 'fail' ? 'fail' : 'warn'),
      ...(typeof ret === 'object' ? { ...ret, pass: undefined } : {}),
    };
    if (!passed) {
      if (check.severity === 'fail') antiPatternFailures++;
      else antiPatternWarns++;
    }
  } catch (err) {
    result.antiPattern[check.id] = { check: check.check, status: 'error', error: err.message };
  }
}

let verdict;
if (functionalFailures === 0 && antiPatternFailures === 0 && antiPatternWarns === 0) verdict = 'pass';
else if (functionalFailures === 0 && antiPatternFailures === 0) verdict = 'partial';
else verdict = 'fail';

result.verdict = verdict;
result.summary = {
  functionalFailures,
  antiPatternFailures,
  antiPatternWarns,
  findingsCount: countFindings(body),
  fileCitations: countFileCitations(body),
};
result.recommendation = verdict === 'pass' ? 'accept'
  : verdict === 'partial' ? 'accept-with-warning'
  : 'retry-with-tighter-prompt';

console.log(JSON.stringify(result, null, 2));

// Self-learning hook
if (!args['no-record']) {
  try {
    const recorderPath = path.join(__dirname, 'pattern-recorder.js');
    if (fs.existsSync(recorderPath)) {
      spawnSync(process.execPath, [
        recorderPath, 'record',
        '--task-signature', `${contract.persona || 'unknown'}:${contract.agentId}`,
        '--agent-role', frontmatter.role || contract.role || 'actor',
        '--persona', contract.persona || 'unknown',
        '--verdict', verdict,
        '--findings-count', String(result.summary.findingsCount),
      ], { stdio: 'inherit', timeout: 5000 });
    }
  } catch { /* recorder is optional */ }
}

process.exit(verdict === 'fail' ? 1 : 0);
