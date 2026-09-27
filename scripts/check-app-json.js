'use strict';

/* eslint-disable no-console */
/**
 * Checks that app.json says what .homeycompose and the drivers' compose files
 * say.
 *
 * app.json is generated from those by `homey app build`, but it is committed,
 * and an edit made to one side only is easy to miss: the compose file is what
 * gets edited, app.json is what Homey actually reads. This fails when the two
 * disagree, so a change cannot reach a release half-applied.
 *
 * Run: node scripts/check-app-json.js
 */

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), 'utf8'));
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts));

const app = read('app.json');
const problems = [];

// Top-level manifest
const compose = read('.homeycompose', 'app.json');
for (const [key, value] of Object.entries(compose)) {
  if (!isDeepStrictEqual(app[key], value)) problems.push(`app.json "${key}" differs from .homeycompose/app.json`);
}

// Flow cards
for (const kind of ['actions', 'triggers', 'conditions']) {
  const dir = path.join(ROOT, '.homeycompose', 'flow', kind);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const cards = (app.flow && app.flow[kind]) || [];

  for (const file of files) {
    const id = file.slice(0, -5);
    const card = cards.find((c) => c.id === id);
    if (!card) {
      problems.push(`flow ${kind} "${id}" is missing from app.json`);
      continue;
    }
    const { id: ignored, ...rest } = card;
    if (!isDeepStrictEqual(rest, read('.homeycompose', 'flow', kind, file))) {
      problems.push(`flow ${kind} "${id}" differs from its compose file`);
    }
  }
  for (const card of cards) {
    if (!files.includes(`${card.id}.json`)) problems.push(`flow ${kind} "${card.id}" has no compose file`);
  }
}

// Capabilities
for (const [id, capability] of Object.entries(app.capabilities || {})) {
  if (!exists('.homeycompose', 'capabilities', `${id}.json`)) {
    problems.push(`capability "${id}" has no compose file`);
  } else if (!isDeepStrictEqual(capability, read('.homeycompose', 'capabilities', `${id}.json`))) {
    problems.push(`capability "${id}" differs from its compose file`);
  }
}

// Drivers
for (const driver of app.drivers || []) {
  const { id, settings, ...rest } = driver;
  const raw = fs.readFileSync(path.join(ROOT, 'drivers', id, 'driver.compose.json'), 'utf8')
    .replace(/\{\{driverAssetsPath\}\}/g, `/drivers/${id}/assets`);
  if (!isDeepStrictEqual(rest, JSON.parse(raw))) {
    problems.push(`driver "${id}" differs from its driver.compose.json`);
  }
  const settingsFile = ['drivers', id, 'driver.settings.compose.json'];
  const expected = exists(...settingsFile) ? read(...settingsFile) : undefined;
  if (!isDeepStrictEqual(settings, expected)) {
    problems.push(`driver "${id}" settings differ from its driver.settings.compose.json`);
  }
}

for (const problem of problems) console.log(`FAIL  ${problem}`);
console.log(problems.length === 0
  ? 'app.json matches the compose files.\n\nAll checks passed.'
  : `\n${problems.length} check(s) failed. Run \`homey app build\` to regenerate app.json.`);
process.exitCode = problems.length === 0 ? 0 : 1;
