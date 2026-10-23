import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import worker from "../worker.js";

globalThis.crypto ??= webcrypto;

class D1Statement {
  constructor(db, sql, values = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new D1Statement(this.db, this.sql, values);
  }
  run() {
    return this.db.prepare(this.sql).run(...this.values);
  }
  first() {
    return this.db.prepare(this.sql).get(...this.values) ?? null;
  }
  all() {
    return { results: this.db.prepare(this.sql).all(...this.values) };
  }
}

class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
  }
  exec(sql) {
    this.sqlite.exec(sql);
  }
  prepare(sql) {
    return new D1Statement(this.sqlite, sql);
  }
  batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map(statement =>
        this.sqlite.prepare(statement.sql).run(...statement.values)
      );
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.sqlite.close();
  }
}

const now = new Date().toISOString();
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const sessionToken = "test-session-token-0123456789abcdef";
async function hashToken(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("base64url");
}

async function fixture({ role = "owner" } = {}) {
  const db = new SQLiteD1();
  db.exec(await readFile(new URL("../migrations/0001_mod01_account_business_traceability.sql", import.meta.url), "utf8"));
  db.exec(await readFile(new URL("../migrations/0002_mod01_business_slug_history.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO accounts (account_id,email,password_hash,email_verified_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind("account-owner", "owner@example.test", "not-used", now, "active", now, now).run();
  db.prepare("INSERT INTO accounts (account_id,email,password_hash,email_verified_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind("account-other", "other@example.test", "not-used", now, "active", now, now).run();
  db.prepare("INSERT INTO businesses (business_id,account_id,current_slug,default_language,created_at,verified_at,status) VALUES (?,?,?,?,?,?,?)")
    .bind("sbiz-000000001", "account-owner", "ownerbusiness123", "en", now, now, "active").run();
  db.prepare("INSERT INTO businesses (business_id,account_id,current_slug,default_language,created_at,verified_at,status) VALUES (?,?,?,?,?,?,?)")
    .bind("sbiz-000000002", "account-other", "otherbusiness123", "vi", now, now, "active").run();
  db.prepare("INSERT INTO business_memberships (business_id,account_id,role,created_at) VALUES (?,?,?,?)")
    .bind("sbiz-000000001", "account-owner", role, now).run();
  db.prepare("INSERT INTO business_memberships (business_id,account_id,role,created_at) VALUES (?,?,?,?)")
    .bind("sbiz-000000002", "account-other", "owner", now).run();
  db.prepare("INSERT INTO business_slug_history (slug_history_id,business_id,slug,valid_from,change_source) VALUES (?,?,?,?,?)")
    .bind("history-owner-initial", "sbiz-000000001", "ownerbusiness123", now, "registration").run();
  db.prepare("INSERT INTO business_slug_history (slug_history_id,business_id,slug,valid_from,change_source) VALUES (?,?,?,?,?)")
    .bind("history-other-initial", "sbiz-000000002", "otherbusiness123", now, "registration").run();
  db.prepare("INSERT INTO auth_sessions (session_id,account_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)")
    .bind("session-1", "account-owner", await hashToken(sessionToken), now, future).run();
  return { db, env: { SBIZ_APP_DB: db }, close: () => db.close() };
}

function authenticatedRequest(path, { method = "GET", body } = {}) {
  return new Request("https://sbiz.app" + path, {
    method,
    headers: {
      cookie: "sbiz_session=" + sessionToken,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("D1-backed /me returns the authenticated account and its business", async t => {
  const f = await fixture();
  t.after(f.close);
  const response = await worker.fetch(authenticatedRequest("/api/v1/me"), f.env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.email, "owner@example.test");
  assert.equal(body.businesses.length, 1);
  assert.equal(body.businesses[0].business_id, "sbiz-000000001");
});

test("owner language update persists the new L1 and writes an audit event", async t => {
  const f = await fixture();
  t.after(f.close);
  const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/language", {
    method: "PATCH", body: { defaultLanguage: "vi" },
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(f.db.prepare("SELECT default_language FROM businesses WHERE business_id=?").bind("sbiz-000000001").first().default_language, "vi");
  const event = f.db.prepare("SELECT event_type,old_value,new_value FROM business_events WHERE business_id=?").bind("sbiz-000000001").first();
  assert.deepEqual(event, { event_type: "primary_language_changed", old_value: "en", new_value: "vi" });
});

test("non-owner membership cannot change the business primary language", async t => {
  const f = await fixture({ role: "member" });
  t.after(f.close);
  const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/language", {
    method: "PATCH", body: { defaultLanguage: "es" },
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 403);
  assert.equal(f.db.prepare("SELECT default_language FROM businesses WHERE business_id=?").bind("sbiz-000000001").first().default_language, "en");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM business_events WHERE business_id=?").bind("sbiz-000000001").first().count, 0);
});

test("owner slug update closes prior history and creates exactly one current history row", async t => {
  const f = await fixture();
  t.after(f.close);
  const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/slug", {
    method: "PATCH", body: { slug: "newownerbusiness123" },
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const history = f.db.prepare("SELECT slug,valid_to,change_source FROM business_slug_history WHERE business_id=? ORDER BY valid_from,slug_history_id").bind("sbiz-000000001").all().results;
  assert.equal(history.length, 2);
  assert.equal(history[0].slug, "ownerbusiness123");
  assert.ok(history[0].valid_to);
  assert.equal(history[1].slug, "newownerbusiness123");
  assert.equal(history[1].valid_to, null);
  assert.equal(history[1].change_source, "owner");
});

test("slug conflict is rejected without mutating current slug or history", async t => {
  const f = await fixture();
  t.after(f.close);
  const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/slug", {
    method: "PATCH", body: { slug: "otherbusiness123" },
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 409);
  assert.equal(f.db.prepare("SELECT current_slug FROM businesses WHERE business_id=?").bind("sbiz-000000001").first().current_slug, "ownerbusiness123");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM business_slug_history WHERE business_id=?").bind("sbiz-000000001").first().count, 1);
});

test("invalid language is rejected without changing business data", async t => {
  const f = await fixture();
  t.after(f.close);
  const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/language", {
    method: "PATCH", body: { defaultLanguage: "fr" },
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 400);
  assert.equal(f.db.prepare("SELECT default_language FROM businesses WHERE business_id=?").bind("sbiz-000000001").first().default_language, "en");
});
