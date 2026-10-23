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
  db.exec(await readFile(new URL("../migrations/0003_mod01_custom_domain_lifecycle.sql", import.meta.url), "utf8"));
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
  assert.equal(body.businesses[0].verification_status, "unverified");
  assert.equal(body.businesses[0].admin_verified_at, null);
  assert.equal(body.businesses[0].subscription_started_at, null);
  assert.equal(body.businesses[0].subscription_expires_at, null);
  assert.equal(body.businesses[0].data_deleted_at, null);
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

test("password reset rolls token consumption and password update back when session revocation fails", async t => {
  const f = await fixture();
  t.after(f.close);
  const token = "atomic-password-reset-token-0123456789abcdef";
  const tokenHash = await hashToken(token);
  f.db.prepare("INSERT INTO password_reset_tokens (reset_id,account_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)")
    .bind("atomic-reset", "account-owner", tokenHash, now, future).run();
  f.db.exec("CREATE TRIGGER force_session_revoke_failure BEFORE UPDATE ON auth_sessions WHEN NEW.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'forced session revoke failure'); END");
  const before = f.db.prepare("SELECT password_hash FROM accounts WHERE account_id=?").bind("account-owner").first().password_hash;
  const response = await worker.fetch(new Request("https://sbiz.app/api/v1/password/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password: "A-strong-new-password-2026" }),
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 503);
  assert.equal(f.db.prepare("SELECT used_at FROM password_reset_tokens WHERE reset_id=?").bind("atomic-reset").first().used_at, null);
  assert.equal(f.db.prepare("SELECT password_hash FROM accounts WHERE account_id=?").bind("account-owner").first().password_hash, before);
});

test("email confirmation rolls back token consumption and account email when audit write fails", async t => {
  const f = await fixture();
  t.after(f.close);
  const token = "atomic-email-change-token-0123456789abcdef";
  f.db.prepare("INSERT INTO email_change_requests (change_id,account_id,business_id,new_email,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)")
    .bind("atomic-email-change", "account-owner", "sbiz-000000001", "new-owner@example.test", await hashToken(token), now, future).run();
  f.db.exec("CREATE TRIGGER force_email_audit_failure BEFORE INSERT ON business_events WHEN NEW.event_type='email_changed' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END");
  const response = await worker.fetch(new Request("https://sbiz.app/api/v1/email/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 503);
  assert.equal(f.db.prepare("SELECT email FROM accounts WHERE account_id=?").bind("account-owner").first().email, "owner@example.test");
  assert.equal(f.db.prepare("SELECT used_at FROM email_change_requests WHERE change_id=?").bind("atomic-email-change").first().used_at, null);
});

test("custom domain request is owner-only and returns a one-time DNS TXT challenge", async t => {
  const f = await fixture();
  t.after(f.close);
  const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
    method: "POST", body: { hostname: "Shop.Example.com." }
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.hostname, "shop.example.com");
  assert.equal(body.status, "pending_dns");
  assert.equal(body.dns.type, "TXT");
  assert.equal(body.dns.name, "_sbiz-verification.shop.example.com");
  assert.match(body.dns.value, /^sbiz-domain-verification=[A-Za-z0-9_-]{32,}$/);
  const saved = f.db.prepare("SELECT hostname,status,verification_token_hash,verified_at FROM business_custom_domains WHERE domain_id=?").bind(body.domain_id).get();
  assert.equal(saved.hostname, "shop.example.com");
  assert.equal(saved.status, "pending_dns");
  assert.equal(saved.verified_at, null);
  assert.equal(saved.verification_token_hash, await hashToken(body.dns.value.slice("sbiz-domain-verification=".length)));
  assert.notEqual(saved.verification_token_hash, body.dns.value.slice("sbiz-domain-verification=".length));

  const duplicate = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
    method: "POST", body: { hostname: "shop.example.com" }
  }), f.env, { waitUntil() {} });
  assert.equal(duplicate.status, 409);
});

test("custom domain rejects internal SBiz hostnames, malformed hosts, and non-owners", async t => {
  const f = await fixture();
  t.after(f.close);
  for (const hostname of ["sbiz.app", "admin.sbiz.app", "localhost", "127.0.0.1", "shop.example.com/path", "shop.example.com:8443", "-bad.example.com"]) {
    const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
      method: "POST", body: { hostname }
    }), f.env, { waitUntil() {} });
    assert.equal(response.status, 400, hostname);
  }
  const memberFixture = await fixture({ role: "member" });
  t.after(memberFixture.close);
  const denied = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
    method: "POST", body: { hostname: "shop.example.com" }
  }), memberFixture.env, { waitUntil() {} });
  assert.equal(denied.status, 403);
});

test("custom hostname is active only after DNS proof and Cloudflare confirms active SSL", async t => {
  const f = await fixture();
  t.after(f.close);
  const created = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
    method: "POST", body: { hostname: "secure.example.com" }
  }), f.env, { waitUntil() {} });
  assert.equal(created.status, 201);
  const challenge = await created.json();
  const token = challenge.dns.value.slice("sbiz-domain-verification=".length);
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  let cnameCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      if (url.includes("type=CNAME")) { cnameCalls++; return new Response(JSON.stringify({ Answer: [{ type: 5, data: cnameCalls === 1 ? "wrong.saas.example.net." : "fallback.saas.example.net." }] }), { status: 200 }); }
      return new Response(JSON.stringify({ Answer: [{ type: 16, data: '"sbiz-domain-verification=' + token + '"' }] }), {
        status: 200, headers: { "content-type": "application/dns-json" }
      });
    }
    if (url.endsWith("/custom_hostnames/fallback_origin")) {
      return new Response(JSON.stringify({ success: true, result: { origin: "fallback.saas.example.net", status: "active" } }), { status: 200 });
    }
    if (url.includes("/custom_hostnames")) {
      providerCalls++;
      if (init.method === "POST") {
        assert.match(init.body, /"method":"txt"/);
        return new Response(JSON.stringify({ success: true, result: { id: "cf-hostname-1", hostname: "secure.example.com", status: "pending", ownership_verification: { name: "_cf-custom-hostname.secure.example.com", type: "txt", value: "provider-token" }, ssl: { status: "pending_issuance", validation_records: [{ txt_name: "_acme-challenge.secure.example.com", txt_value: "ssl-token" }] } } }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
      assert.equal(init.method, "GET");
      return new Response(JSON.stringify({ success: true, result: { id: "cf-hostname-1", hostname: "secure.example.com", status: "active", ownership_verification: { name: "_cf-custom-hostname.secure.example.com", type: "txt", value: "provider-token" }, ssl: { status: "active", validation_records: [{ txt_name: "_acme-challenge.secure.example.com", txt_value: "ssl-token" }] } } }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    throw new Error("Unexpected external request in test: " + url);
  };
  try {
    const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains/" + challenge.domain_id + "/verify", {
      method: "POST", body: {}
    }), { ...f.env, CLOUDFLARE_API_TOKEN: "test-only-token", CLOUDFLARE_ZONE_ID: "test-zone-id" }, { waitUntil() {} });
    assert.equal(response.status, 202);
    const pending = await response.json();
    assert.equal(pending.status, "pending_validation");
    assert.equal(pending.provider_status, "pending");
    assert.equal(pending.ssl_status, "pending_issuance");
    assert.equal(f.db.prepare("SELECT status FROM business_custom_domains WHERE domain_id=?").bind(challenge.domain_id).get().status, "pending_validation");

    const routingPending = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains/" + challenge.domain_id + "/verify", {
      method: "POST", body: {}
    }), { ...f.env, CLOUDFLARE_API_TOKEN: "test-only-token", CLOUDFLARE_ZONE_ID: "test-zone-id" }, { waitUntil() {} });
    assert.equal(routingPending.status, 202);
    assert.equal((await routingPending.json()).status, "pending_deployment");
    const notYetActive = f.db.prepare("SELECT status,routing_verified_at FROM business_custom_domains WHERE domain_id=?").bind(challenge.domain_id).get();
    assert.equal(notYetActive.status, "pending_deployment");
    assert.equal(notYetActive.routing_verified_at, null);

    const activated = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains/" + challenge.domain_id + "/verify", {
      method: "POST", body: {}
    }), { ...f.env, CLOUDFLARE_API_TOKEN: "test-only-token", CLOUDFLARE_ZONE_ID: "test-zone-id" }, { waitUntil() {} });
    assert.equal(activated.status, 200);
    const body = await activated.json();
    assert.equal(body.status, "active");
    assert.equal(body.provider_status, "active");
    assert.equal(body.ssl_status, "active");
    assert.equal(providerCalls, 3);
    assert.equal(cnameCalls, 2);
    const saved = f.db.prepare("SELECT status,provider_hostname_id,verified_at,routing_verified_at,provider_validation_json,ssl_validation_json,cname_target FROM business_custom_domains WHERE domain_id=?").bind(challenge.domain_id).get();
    assert.equal(saved.status, "active");
    assert.equal(saved.provider_hostname_id, "cf-hostname-1");
    assert.ok(saved.verified_at);
    assert.ok(saved.routing_verified_at);
    assert.equal(saved.cname_target, "fallback.saas.example.net");
    assert.equal(JSON.parse(saved.provider_validation_json).ownership.name, "_cf-custom-hostname.secure.example.com");
    assert.equal(JSON.parse(saved.ssl_validation_json)[0].txt_name, "_acme-challenge.secure.example.com");
    const listed = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains"), f.env, { waitUntil() {} });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json();
    assert.equal(listedBody.domains[0].provider_validation.ownership.value, "provider-token");
    assert.equal(listedBody.domains[0].ssl_validation_records[0].txt_value, "ssl-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DNS verification without Cloudflare for SaaS configuration never marks a hostname active", async t => {
  const f = await fixture();
  t.after(f.close);
  const created = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
    method: "POST", body: { hostname: "pending.example.com" }
  }), f.env, { waitUntil() {} });
  const challenge = await created.json();
  const token = challenge.dns.value.slice("sbiz-domain-verification=".length);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.ok(String(input).startsWith("https://cloudflare-dns.com/dns-query"));
    return new Response(JSON.stringify({ Answer: [{ type: 16, data: '"sbiz-domain-verification=' + token + '"' }] }), { status: 200 });
  };
  try {
    const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains/" + challenge.domain_id + "/verify", {
      method: "POST", body: {}
    }), f.env, { waitUntil() {} });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "CUSTOM_DOMAIN_PROVIDER_NOT_CONFIGURED");
    const saved = f.db.prepare("SELECT status,verified_at,provider_hostname_id FROM business_custom_domains WHERE domain_id=?").bind(challenge.domain_id).get();
    assert.equal(saved.status, "pending_provider");
    assert.ok(saved.verified_at);
    assert.equal(saved.provider_hostname_id, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("custom domain can be removed before provider provisioning and hostname can then be requested again", async t => {
  const f = await fixture();
  t.after(f.close);
  const first = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
    method: "POST", body: { hostname: "reusable.example.com" }
  }), f.env, { waitUntil() {} });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  const removed = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains/" + firstBody.domain_id, {
    method: "DELETE"
  }), f.env, { waitUntil() {} });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).status, "removed");
  assert.equal(f.db.prepare("SELECT status FROM business_custom_domains WHERE domain_id=?").bind(firstBody.domain_id).get().status, "removed");
  const second = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
    method: "POST", body: { hostname: "reusable.example.com" }
  }), f.env, { waitUntil() {} });
  assert.equal(second.status, 201);
  assert.notEqual((await second.json()).domain_id, firstBody.domain_id);
});

test("dashboard renders custom-domain controls in each supported locale", async () => {
  const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
  assert.match(source, /id="domain-form"/);
  assert.match(source, /id="domain-business"/);
  assert.match(source, /\/api\/v1\/businesses\/"\+encodeURIComponent\(selectedDomainBusinessId\)\+"\/domains"/);
  assert.match(source, /Activation requires an active fallback origin, hostname, SSL and verified CNAME routing/);
  assert.match(source, /Chỉ kích hoạt khi fallback origin, hostname, SSL và CNAME đều được xác minh/);
});

test("custom domain removal requires provider confirmation before marking removed", async t => {
  const f = await fixture();
  t.after(f.close);
  const created = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
    method: "POST", body: { hostname: "remove.example.com" }
  }), f.env, { waitUntil() {} });
  const challenge = await created.json();
  const token = challenge.dns.value.slice("sbiz-domain-verification=".length);
  const originalFetch = globalThis.fetch;
  let deleteCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return new Response(JSON.stringify({ Answer: [{ type: 16, data: '"sbiz-domain-verification=' + token + '"' }] }), { status: 200 });
    }
    if (url.endsWith("/custom_hostnames/fallback_origin")) {
      return new Response(JSON.stringify({ success: true, result: { origin: "fallback.saas.example.net", status: "active" } }), { status: 200 });
    }
    if (url.includes("/custom_hostnames") && init.method === "POST") {
      return new Response(JSON.stringify({ success: true, result: { id: "cf-remove-1", hostname: "remove.example.com", status: "pending_validation", ssl: { status: "pending_validation" } } }), { status: 200 });
    }
    if (url.endsWith("/cf-remove-1") && init.method === "DELETE") {
      deleteCalls++;
      if (deleteCalls === 1) return new Response(JSON.stringify({ success: false, errors: [{ code: 1000 }] }), { status: 500 });
      return new Response(JSON.stringify({ success: true, result: { id: "cf-remove-1" } }), { status: 200 });
    }
    throw new Error("Unexpected external request in test: " + url + " " + init.method);
  };
  const env = { ...f.env, CLOUDFLARE_API_TOKEN: "test-only-token", CLOUDFLARE_ZONE_ID: "test-zone-id" };
  try {
    const verified = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains/" + challenge.domain_id + "/verify", {
      method: "POST", body: {}
    }), env, { waitUntil() {} });
    assert.equal(verified.status, 202);
    const failedDelete = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains/" + challenge.domain_id, {
      method: "DELETE"
    }), env, { waitUntil() {} });
    assert.equal(failedDelete.status, 503);
    assert.equal(f.db.prepare("SELECT status FROM business_custom_domains WHERE domain_id=?").bind(challenge.domain_id).get().status, "error");
    const deleted = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains/" + challenge.domain_id, {
      method: "DELETE"
    }), env, { waitUntil() {} });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).status, "removed");
    assert.equal(deleteCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("custom hostname is not provisioned until the Cloudflare fallback origin is active", async t => {
  const f = await fixture();
  t.after(f.close);
  const created = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains", {
    method: "POST", body: { hostname: "origin-pending.example.com" }
  }), f.env, { waitUntil() {} });
  const challenge = await created.json();
  const token = challenge.dns.value.slice("sbiz-domain-verification=".length);
  const originalFetch = globalThis.fetch;
  let createCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return new Response(JSON.stringify({ Answer: [{ type: 16, data: '"sbiz-domain-verification=' + token + '"' }] }), { status: 200 });
    }
    if (url.endsWith("/custom_hostnames/fallback_origin")) {
      return new Response(JSON.stringify({ success: true, result: { origin: "fallback.saas.example.net", status: "pending_deployment" } }), { status: 200 });
    }
    if (url.includes("/custom_hostnames") && init.method === "POST") createCalls++;
    throw new Error("The provider hostname must not be created while fallback origin is pending.");
  };
  try {
    const response = await worker.fetch(authenticatedRequest("/api/v1/businesses/sbiz-000000001/domains/" + challenge.domain_id + "/verify", {
      method: "POST", body: {}
    }), { ...f.env, CLOUDFLARE_API_TOKEN: "test-only-token", CLOUDFLARE_ZONE_ID: "test-zone-id" }, { waitUntil() {} });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "FALLBACK_ORIGIN_NOT_ACTIVE");
    assert.equal(createCalls, 0);
    const saved = f.db.prepare("SELECT status,error_code,provider_hostname_id FROM business_custom_domains WHERE domain_id=?").bind(challenge.domain_id).get();
    assert.equal(saved.status, "pending_provider");
    assert.equal(saved.error_code, "FALLBACK_ORIGIN_NOT_ACTIVE");
    assert.equal(saved.provider_hostname_id, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
