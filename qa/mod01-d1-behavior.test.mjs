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
  assert.equal(event.event_type, "primary_language_changed");
  assert.equal(event.old_value, "en");
  assert.equal(event.new_value, "vi");
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


function publicJsonRequest(path, body) {
  return new Request("https://sbiz.app" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function emptyFixture() {
  const db = new SQLiteD1();
  db.exec(await readFile(new URL("../migrations/0001_mod01_account_business_traceability.sql", import.meta.url), "utf8"));
  db.exec(await readFile(new URL("../migrations/0002_mod01_business_slug_history.sql", import.meta.url), "utf8"));
  return { db, env: { SBIZ_APP_DB: db }, close: () => db.close() };
}

test("registration rejects invalid slug before creating pending or official records", async t => {
  const f = await emptyFixture();
  t.after(f.close);
  const response = await worker.fetch(publicJsonRequest("/api/v1/register", {
    email: "new@example.test",
    slug: "bad-slug",
    defaultLanguage: "en",
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_SLUG");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM registration_requests").first().count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM accounts").first().count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM businesses").first().count, 0);
});

test("registration email-send failure removes the pending request and creates no account", async t => {
  const f = await emptyFixture();
  t.after(f.close);
  const response = await worker.fetch(publicJsonRequest("/api/v1/register", {
    email: "new@example.test",
    slug: "newbusiness12345",
    defaultLanguage: "vi",
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "EMAIL_SEND_FAILED");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM registration_requests").first().count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM accounts").first().count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM businesses").first().count, 0);
});

test("expired registration token cannot create an account and is removed", async t => {
  const f = await emptyFixture();
  t.after(f.close);
  const token = "expired-registration-token-0123456789";
  f.db.prepare("INSERT INTO registration_requests (request_id,email,requested_slug,default_language,token_hash,created_at,email_sent_at,expires_at,attempts) VALUES (?,?,?,?,?,?,?,?,0)")
    .bind("expired-request", "new@example.test", "newbusiness12345", "en", await hashToken(token), now, now, new Date(Date.now() - 1000).toISOString()).run();
  const response = await worker.fetch(publicJsonRequest("/api/v1/register/verify", {
    token,
    password: "LongEnoughPassword123!",
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).error, "VERIFICATION_EXPIRED");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM registration_requests").first().count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM accounts").first().count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM businesses").first().count, 0);
});

test("valid registration verification atomically creates account, business, owner membership, slug history and audit events", async t => {
  const f = await emptyFixture();
  t.after(f.close);
  const token = "valid-registration-token-0123456789";
  f.db.prepare("INSERT INTO registration_requests (request_id,email,requested_slug,default_language,token_hash,created_at,email_sent_at,expires_at,attempts) VALUES (?,?,?,?,?,?,?,?,0)")
    .bind("valid-request", "new@example.test", "newbusiness12345", "pt", await hashToken(token), now, now, future).run();
  const response = await worker.fetch(publicJsonRequest("/api/v1/register/verify", {
    token,
    password: "LongEnoughPassword123!",
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.business_id, "sbiz-000000001");
  const account = f.db.prepare("SELECT email,email_verified_at,password_hash FROM accounts WHERE email=?").bind("new@example.test").first();
  assert.ok(account.email_verified_at);
  assert.ok(account.password_hash);
  const business = f.db.prepare("SELECT business_id,current_slug,default_language FROM businesses WHERE business_id=?").bind(body.business_id).first();
  assert.deepEqual({ business_id: business.business_id, current_slug: business.current_slug, default_language: business.default_language }, {
    business_id: "sbiz-000000001",
    current_slug: "newbusiness12345",
    default_language: "pt",
  });
  assert.equal(f.db.prepare("SELECT role FROM business_memberships WHERE business_id=?").bind(body.business_id).first().role, "owner");
  assert.equal(f.db.prepare("SELECT slug FROM business_slug_history WHERE business_id=? AND valid_to IS NULL").bind(body.business_id).first().slug, "newbusiness12345");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM business_events WHERE business_id=? AND event_type IN ('business_created','email_verified')").bind(body.business_id).first().count, 2);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM registration_requests").first().count, 0);

  const replay = await worker.fetch(publicJsonRequest("/api/v1/register/verify", {
    token,
    password: "LongEnoughPassword123!",
  }), f.env, { waitUntil() {} });
  assert.equal(replay.status, 410);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM accounts").first().count, 1);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM businesses").first().count, 1);
});

test("password reset consumes a one-time token, changes the password hash and revokes all active sessions", async t => {
  const f = await fixture();
  t.after(f.close);
  const token = "valid-password-reset-token-0123456789";
  f.db.prepare("INSERT INTO password_reset_tokens (reset_id,account_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)")
    .bind("reset-1", "account-owner", await hashToken(token), now, future).run();

  const response = await worker.fetch(publicJsonRequest("/api/v1/password/reset", {
    token,
    password: "AnotherLongPassword123!",
  }), f.env, { waitUntil() {} });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  const account = f.db.prepare("SELECT password_hash FROM accounts WHERE account_id=?").bind("account-owner").first();
  assert.notEqual(account.password_hash, "not-used");
  assert.ok(f.db.prepare("SELECT used_at FROM password_reset_tokens WHERE reset_id=?").bind("reset-1").first().used_at);
  assert.ok(f.db.prepare("SELECT revoked_at FROM auth_sessions WHERE session_id=?").bind("session-1").first().revoked_at);

  const replay = await worker.fetch(publicJsonRequest("/api/v1/password/reset", {
    token,
    password: "AnotherLongPassword123!",
  }), f.env, { waitUntil() {} });
  assert.equal(replay.status, 410);
  assert.equal(f.db.prepare("SELECT password_hash FROM accounts WHERE account_id=?").bind("account-owner").first().password_hash, account.password_hash);
});

test("email-change confirmation updates the account, records events for memberships and rejects token replay", async t => {
  const f = await fixture();
  t.after(f.close);
  const token = "valid-email-change-token-0123456789";
  f.db.prepare("INSERT INTO email_change_requests (change_id,account_id,business_id,new_email,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)")
    .bind("email-change-1", "account-owner", "sbiz-000000001", "new-owner@example.test", await hashToken(token), now, future).run();

  const response = await worker.fetch(publicJsonRequest("/api/v1/email/confirm", { token }), f.env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(f.db.prepare("SELECT email FROM accounts WHERE account_id=?").bind("account-owner").first().email, "new-owner@example.test");
  const event = f.db.prepare("SELECT event_type,old_value,new_value FROM business_events WHERE business_id=?").bind("sbiz-000000001").first();
  assert.equal(event.event_type, "email_changed");
  assert.equal(event.old_value, "owner@example.test");
  assert.equal(event.new_value, "new-owner@example.test");

  const replay = await worker.fetch(publicJsonRequest("/api/v1/email/confirm", { token }), f.env, { waitUntil() {} });
  assert.equal(replay.status, 410);
  assert.equal(f.db.prepare("SELECT email FROM accounts WHERE account_id=?").bind("account-owner").first().email, "new-owner@example.test");
});

test("business ID capacity exhaustion blocks registration without creating partial records or consuming the pending request", async t => {
  const f = await emptyFixture();
  t.after(f.close);
  f.db.prepare("UPDATE business_id_sequence SET next_value=1000000000 WHERE sequence_name='business'").run();
  const token = "capacity-registration-token-0123456789";
  f.db.prepare("INSERT INTO registration_requests (request_id,email,requested_slug,default_language,token_hash,created_at,email_sent_at,expires_at,attempts) VALUES (?,?,?,?,?,?,?,?,0)")
    .bind("capacity-request", "capacity@example.test", "capacitybusiness123", "en", await hashToken(token), now, now, future).run();

  const response = await worker.fetch(publicJsonRequest("/api/v1/register/verify", {
    token,
    password: "LongEnoughPassword123!",
  }), f.env, { waitUntil() {} });

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "BUSINESS_ID_CAPACITY_REACHED");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM accounts").first().count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM businesses").first().count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM registration_requests WHERE request_id=?").bind("capacity-request").first().count, 1);
  assert.equal(f.db.prepare("SELECT next_value FROM business_id_sequence WHERE sequence_name='business'").first().next_value, 1000000000);
});

test("localized account routes keep locale in paths and document language", async () => {
  const home = await worker.fetch(new Request("https://sbiz.app/vi"), {}, { waitUntil() {} });
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /<html lang="vi">/);
  assert.match(homeHtml, /href="\/vi\/create"/);
  assert.match(homeHtml, /href="\/vi\/login"/);
  assert.match(homeHtml, /href="\/es"/);

  const create = await worker.fetch(new Request("https://sbiz.app/vi/create"), {}, { waitUntil() {} });
  assert.equal(create.status, 200);
  const createHtml = await create.text();
  assert.match(createHtml, /<html lang="vi">/);
  assert.match(createHtml, /uiLanguage:"vi"/);
  assert.match(createHtml, /href="\/vi\/login"/);

  const login = await worker.fetch(new Request("https://sbiz.app/vi/login"), {}, { waitUntil() {} });
  assert.equal(login.status, 200);
  assert.match(await login.text(), /location\.href="\/vi\/dashboard"/);
});

test("localized URL prefix cannot bypass the admin route boundary", async () => {
  const response = await worker.fetch(new Request("https://sbiz.app/vi/admin"), {}, { waitUntil() {} });
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /Business administration/);
});

test("all supported locale prefixes render localized entry and account screens", async () => {
  const cases = [
    ["/vi", "vi", "Tạo tài khoản doanh nghiệp"],
    ["/id", "id", "Buat akun bisnis"],
    ["/es", "es", "Crea una cuenta empresarial"],
    ["/pt", "pt", "Crie uma conta empresarial"],
  ];
  for (const [path, lang, expectedCopy] of cases) {
    const response = await worker.fetch(new Request("https://sbiz.app" + path), {}, { waitUntil() {} });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, new RegExp('<html lang="' + lang + '">'));
    assert.ok(body.includes(expectedCopy), "Expected localized home copy for " + lang);
  }

  const forgot = await worker.fetch(new Request("https://sbiz.app/es/forgot-password"), {}, { waitUntil() {} });
  assert.equal(forgot.status, 200);
  const forgotHtml = await forgot.text();
  assert.match(forgotHtml, /<html lang="es">/);
  assert.match(forgotHtml, /uiLanguage:"es"/);

  const dashboard = await worker.fetch(new Request("https://sbiz.app/pt/dashboard"), {}, { waitUntil() {} });
  assert.equal(dashboard.status, 200);
  const dashboardHtml = await dashboard.text();
  assert.match(dashboardHtml, /<html lang="pt">/);
  assert.match(dashboardHtml, /Seu painel/);
});

test("localized email-change confirmation page renders without missing-copy errors", async () => {
  const response = await worker.fetch(new Request("https://sbiz.app/vi/change-email"), {}, { waitUntil() {} });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Xác nhận đổi email/);
  assert.match(body, /Thiếu liên kết xác nhận\./);
  assert.doesNotMatch(body, /translations is not defined/);
});

test("dashboard exposes the email-change action and preserves its UI language", async () => {
  const response = await worker.fetch(new Request("https://sbiz.app/pt/dashboard"), {}, { waitUntil() {} });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Alterar e-mail da conta/);
  assert.match(body, /Novo endereço de e-mail/);
  assert.match(body, /uiLanguage:"pt"/);
  assert.match(body, /\/api\/v1\/businesses\//);
});
