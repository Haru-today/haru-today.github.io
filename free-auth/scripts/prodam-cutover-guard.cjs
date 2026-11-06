"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");

const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function deployment(value) {
  assert.ok(value && uuid(value.id) && Array.isArray(value.versions) && value.versions.length === 1, "Expected one active deployment");
  const version = value.versions[0];
  assert.ok(uuid(version.version_id) && version.percentage === 100, "Expected one version receiving all traffic");
  return { deployment: value.id, version: version.version_id };
}
function uploaded(lines) {
  const events = lines.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)).filter(event => event.type === "version-upload");
  assert.equal(events.length, 1, "Expected one upload event");
  assert.ok(events[0].worker_name === "labdam-free-approval" && uuid(events[0].version_id), "Unexpected uploaded version");
  return events[0].version_id;
}
function bindings(version) {
  assert.ok(version && version.resources && Array.isArray(version.resources.bindings), "Missing version bindings");
  const result = new Map();
  for (const entry of version.resources.bindings) {
    assert.ok(entry && typeof entry.type === "string" && typeof entry.name === "string" && entry.name, "Invalid binding");
    assert.ok(!result.has(entry.name), "Duplicate binding name");
    // Secret values are never read or displayed. Asset identifiers necessarily change with the bundle.
    result.set(entry.name, entry.type === "secret_text" || entry.type === "assets" ? {type:entry.type, name:entry.name} : entry);
  }
  return result;
}
function latest(versions, expected, previous) {
  assert.ok(Array.isArray(versions) && versions.length > 0 && uuid(expected), "Expected deployable versions");
  assert.equal(versions.at(-1)?.id, expected, "Newest Worker version changed");
  if (previous !== undefined) {
    assert.ok(uuid(previous), "Invalid prior version");
    assert.equal(versions.at(-2)?.id, previous, "Another version was uploaded during cutover");
  }
}
function compareVersions(before, after, expectedBefore, expectedAfter) {
  assert.ok(uuid(expectedBefore) && uuid(expectedAfter), "Missing expected version identifiers");
  assert.equal(before?.id, expectedBefore, "Baseline version mismatch");
  assert.equal(after?.id, expectedAfter, "Candidate version mismatch");
  assert.ok(before?.resources?.script_runtime && isDeepStrictEqual(before.resources.script_runtime, after?.resources?.script_runtime), "Worker runtime changed");
  const a = bindings(before), b = bindings(after);
  for (const [name, entry] of a) assert.ok(isDeepStrictEqual(b.get(name), entry), `Existing binding changed: ${name}`);
  assert.equal(a.get("DB")?.type, "d1", "Missing D1 binding");
  assert.equal(a.get("ASSETS")?.type, "assets", "Missing asset binding");
  for (const name of ["GOOGLE_CLIENT_SECRET", "RATE_LIMIT_SECRET"]) assert.equal(a.get(name)?.type, "secret_text", `Missing required secret: ${name}`);
  for (const [name, value] of [["PRODAM_REVIEW_ONLY", "1"], ["PRODAM_REVIEW_ORIGIN", "https://repodam.labdam.kr"]]) {
    assert.ok(!a.has(name), "Baseline already has PRODAM switch");
    assert.equal(b.get(name)?.type, "plain_text", "Missing PRODAM switch");
    assert.equal(b.get(name)?.text, value, "Incorrect PRODAM switch");
    b.delete(name);
  }
  assert.equal(b.size, a.size, "Unexpected binding added");
}
if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
  if (mode === "deployment") console.log(JSON.stringify(deployment(json(args[0]))));
  else if (mode === "upload") console.log(uploaded(fs.readFileSync(args[0], "utf8")));
  else if (mode === "latest") { latest(json(args[0]), args[1], args[2]); console.log("Latest version matches expected version."); }
  else if (mode === "bindings") { compareVersions(json(args[0]), json(args[1]), args[2], args[3]); console.log("Existing bindings preserved; PRODAM gate switches verified."); }
  else throw Error("Unknown operation");
}
module.exports = { deployment, uploaded, latest, compareVersions };
