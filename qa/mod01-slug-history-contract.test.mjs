import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0002_mod01_business_slug_history.sql", import.meta.url), "utf8");

test("MOD01 slug history migration stores immutable business-linked history", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS business_slug_history/);
  assert.match(migration, /FOREIGN KEY \(business_id\) REFERENCES businesses\(business_id\)/);
  assert.match(migration, /valid_from TEXT NOT NULL/);
  assert.match(migration, /valid_to TEXT/);
  assert.match(migration, /uq_business_slug_history_current/);
  assert.match(migration, /INSERT INTO business_slug_history[\s\S]*FROM businesses b/);
});

test("newly verified businesses receive an initial slug history entry", () => {
  assert.match(worker, /INSERT INTO business_slug_history \(slug_history_id,business_id,slug,valid_from,valid_to,changed_by_account_id,change_source\) SELECT \?, business_id, current_slug, created_at, NULL, \?, 'registration' FROM businesses/);
});

test("slug changes close the prior current entry and append a new history entry", () => {
  assert.match(worker, /UPDATE business_slug_history SET valid_to=\? WHERE business_id=\? AND valid_to IS NULL/);
  assert.match(worker, /INSERT INTO business_slug_history \(slug_history_id,business_id,slug,valid_from,valid_to,changed_by_account_id,change_source\) VALUES/);
  assert.match(worker, /changeSource = admin \? "admin" : "owner"/);
});

test("dashboard renders account and business data containers", () => {
  assert.match(worker, /Your dashboard/);
  assert.match(worker, /Signed in as/);
  assert.match(worker, /Your businesses/);
  assert.match(worker, /fetch\("\/api\/v1\/me"/);
});
test("admin detail panel stays hidden until opened", () => {
  assert.match(worker, /\.detail:not\(\.open\)\{display:none\}/);
  assert.match(worker, /value="unverified">Unverified/);
});
