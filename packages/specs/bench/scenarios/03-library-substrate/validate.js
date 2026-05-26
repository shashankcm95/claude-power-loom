// bench/scenarios/03-library-substrate/validate.js
//
// CLI-driven scenario. No agent spawn expected; instead, verify each library
// verb was invoked via Bash + the artifacts persisted to the live library.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function validate(/* workdir */ _workdir, streamMetrics /* , hookBumps */) {
  const checks = {};

  // Collect all Bash commands from the stream
  const bashCmds = (streamMetrics && streamMetrics.bash_commands) || [];

  function bashHit(re) {
    return bashCmds.some(cmd => re.test(cmd));
  }

  checks.library_stats_invoked = {
    pass: bashHit(/library(\.js)?\s+stats/),
    detail: bashHit(/library(\.js)?\s+stats/) ? 'library stats invoked' : 'no library stats call in Bash history',
  };

  checks.library_daybook_invoked = {
    pass: bashHit(/library(\.js)?\s+daybook/),
    detail: bashHit(/library(\.js)?\s+daybook/) ? 'library daybook invoked' : 'no library daybook call',
  };

  checks.library_write_invoked = {
    pass: bashHit(/library(\.js)?\s+write/),
    detail: bashHit(/library(\.js)?\s+write/) ? 'library write invoked' : 'no library write call',
  };

  checks.library_read_invoked = {
    pass: bashHit(/library(\.js)?\s+read/),
    detail: bashHit(/library(\.js)?\s+read/) ? 'library read invoked' : 'no library read call',
  };

  checks.library_gc_invoked = {
    pass: bashHit(/library(\.js)?\s+gc/),
    detail: bashHit(/library(\.js)?\s+gc/) ? 'library gc invoked' : 'no library gc call',
  };

  // Verify the test volume persisted to live library
  const volumePath = path.join(
    os.homedir(),
    '.claude/library/sections/toolkit/stacks/decisions/volumes/test-vol-bench.md'
  );
  checks.library_volume_persisted = {
    pass: fs.existsSync(volumePath),
    detail: fs.existsSync(volumePath) ? `volume exists at ${volumePath}` : `volume absent at ${volumePath}`,
  };

  // Catalog entry check
  const catPath = path.join(
    os.homedir(),
    '.claude/library/sections/toolkit/stacks/decisions/_catalog.json'
  );
  let catalogHasEntry = false;
  if (fs.existsSync(catPath)) {
    try {
      const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
      const entries = Array.isArray(cat.entries) ? cat.entries : [];
      catalogHasEntry = entries.some(e => e.volume_id === 'test-vol-bench');
    } catch { /* skip */ }
  }
  checks.library_catalog_entry_present = {
    pass: catalogHasEntry,
    detail: catalogHasEntry ? 'catalog entry found' : 'no catalog entry for test-vol-bench',
  };

  return checks;
}

module.exports = { validate };
