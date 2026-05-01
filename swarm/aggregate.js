#!/usr/bin/env node

// Swarm aggregator — combines per-persona findings into a unified report.
//
// Usage: node aggregate.js <run-id>
// Output: swarm/run-state/{run-id}/aggregated-report.md

const fs = require('fs');
const path = require('path');

const runId = process.argv[2];
if (!runId) {
  console.error('Usage: node aggregate.js <run-id>');
  console.error('Example: node aggregate.js chaos-20260501-103000');
  process.exit(1);
}

const RUN_DIR = path.join(__dirname, 'run-state', runId);
if (!fs.existsSync(RUN_DIR)) {
  console.error(`Run directory not found: ${RUN_DIR}`);
  process.exit(1);
}

// Discover finding files (any file ending in -findings.md)
const findingFiles = fs.readdirSync(RUN_DIR)
  .filter((f) => f.endsWith('-findings.md'))
  .sort();

if (findingFiles.length === 0) {
  console.error(`No finding files found in ${RUN_DIR}`);
  console.error('Expected files like: 01-hacker-findings.md, 02-confused-user-findings.md, etc.');
  process.exit(1);
}

// Severity emojis
const SEVERITY = {
  CRITICAL: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🔵',
};

// Parse findings from a markdown file. Returns:
// { persona, sections: { CRITICAL: [...], HIGH: [...], MEDIUM: [...], LOW: [...] }, summary }
function parseFindings(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const persona = path.basename(filePath, '-findings.md');

  const sections = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  let currentSection = null;
  let currentItem = [];
  let summary = '';
  let inSummary = false;

  for (const line of content.split('\n')) {
    // Detect section headers (## CRITICAL, ## HIGH, etc.)
    const sectionMatch = line.match(/^##\s+(CRITICAL|HIGH|MEDIUM|LOW)\b/i);
    if (sectionMatch) {
      if (currentItem.length > 0 && currentSection) {
        sections[currentSection].push(currentItem.join('\n').trim());
        currentItem = [];
      }
      currentSection = sectionMatch[1].toUpperCase();
      inSummary = false;
      continue;
    }

    // Detect any other ## section — end the current findings section
    if (line.match(/^##\s+/)) {
      if (currentItem.length > 0 && currentSection) {
        sections[currentSection].push(currentItem.join('\n').trim());
        currentItem = [];
      }
      currentSection = null;
      inSummary = /summary/i.test(line);
      continue;
    }

    // Inside a findings section: split items by ### headers OR top-level bullets
    if (currentSection) {
      if (line.match(/^###\s+/) || (line.match(/^- /) && currentItem.length === 0)) {
        if (currentItem.length > 0) {
          sections[currentSection].push(currentItem.join('\n').trim());
        }
        currentItem = [line];
      } else {
        currentItem.push(line);
      }
    } else if (inSummary) {
      summary += line + '\n';
    }
  }

  // Flush last item
  if (currentItem.length > 0 && currentSection) {
    sections[currentSection].push(currentItem.join('\n').trim());
  }

  // Filter out empty findings
  for (const sev of Object.keys(sections)) {
    sections[sev] = sections[sev].filter((f) => f.length > 0);
  }

  return { persona, sections, summary: summary.trim() };
}

// Aggregate
const allFindings = findingFiles.map((f) => parseFindings(path.join(RUN_DIR, f)));

const stats = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
for (const f of allFindings) {
  for (const sev of Object.keys(stats)) {
    stats[sev] += f.sections[sev].length;
  }
}
const total = Object.values(stats).reduce((a, b) => a + b, 0);

// Build report
const lines = [];
lines.push(`# Chaos Swarm Aggregated Report`);
lines.push('');
lines.push(`**Run ID**: ${runId}`);
lines.push(`**Aggregated**: ${new Date().toISOString()}`);
lines.push(`**Personas**: ${allFindings.length} (${allFindings.map((f) => f.persona).join(', ')})`);
lines.push('');

// Summary stats
lines.push(`## Findings Summary`);
lines.push('');
lines.push(`| Severity | Count |`);
lines.push(`|----------|-------|`);
for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
  lines.push(`| ${SEVERITY[sev]} ${sev} | ${stats[sev]} |`);
}
lines.push(`| **TOTAL** | **${total}** |`);
lines.push('');

// Per-persona summary
lines.push(`## Per-Persona Stats`);
lines.push('');
lines.push(`| Persona | Critical | High | Medium | Low | Total |`);
lines.push(`|---------|----------|------|--------|-----|-------|`);
for (const f of allFindings) {
  const c = f.sections.CRITICAL.length;
  const h = f.sections.HIGH.length;
  const m = f.sections.MEDIUM.length;
  const l = f.sections.LOW.length;
  lines.push(`| ${f.persona} | ${c} | ${h} | ${m} | ${l} | ${c + h + m + l} |`);
}
lines.push('');

// All findings by severity
for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
  if (stats[sev] === 0) continue;

  lines.push(`---`);
  lines.push('');
  lines.push(`## ${SEVERITY[sev]} ${sev} Findings (${stats[sev]})`);
  lines.push('');

  for (const f of allFindings) {
    if (f.sections[sev].length === 0) continue;
    lines.push(`### From ${f.persona}`);
    lines.push('');
    for (const item of f.sections[sev]) {
      lines.push(item);
      lines.push('');
    }
  }
}

// Footer
lines.push(`---`);
lines.push('');
lines.push(`## Per-Persona Reports`);
lines.push('');
for (const f of allFindings) {
  lines.push(`- [${f.persona}](./${f.persona}-findings.md)`);
}
lines.push('');

// Write
const outputPath = path.join(RUN_DIR, 'aggregated-report.md');
fs.writeFileSync(outputPath, lines.join('\n'));

console.log(`Aggregated ${total} findings from ${allFindings.length} personas`);
console.log(`Report: ${outputPath}`);
console.log('');
console.log('Severity breakdown:');
for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
  console.log(`  ${SEVERITY[sev]} ${sev}: ${stats[sev]}`);
}
