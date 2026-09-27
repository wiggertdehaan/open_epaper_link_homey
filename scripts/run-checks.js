'use strict';

/* eslint-disable no-console */
/**
 * Runs every check that needs nothing but this repository: the app.json
 * consistency check and each verify-*.js script, one after another in its own
 * process. What `npm test` and CI run.
 *
 * Scripts that need a live AP are skipped here; run those by hand from a
 * workstation on the AP's network (see each script's header).
 *
 * Run: npm test
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Need a real AP to be of any use.
const NEEDS_AP = new Set(['verify-decoder.js']);

const scripts = ['check-app-json.js', ...fs.readdirSync(__dirname)
  .filter((f) => /^verify-.*\.js$/.test(f) && !NEEDS_AP.has(f))
  .sort()];

const failed = [];
for (const script of scripts) {
  console.log(`\n=== ${script}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  });
  if (result.status !== 0) failed.push(script);
}

console.log(`\n${scripts.length - failed.length}/${scripts.length} check script(s) passed.`);
if (failed.length) {
  console.log(`Failed: ${failed.join(', ')}`);
  process.exitCode = 1;
}
