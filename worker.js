/**
 * SBiz.app — SINGLE-FILE WORKER
 * Consolidated from feature/mod01-cloudflare-access-admin.
 * Owner deploys manually from Cloudflare Dashboard. No credentials are embedded here.
 */
import { connect } from "cloudflare:sockets";

/**
 * [EMAIL][SMTP][START]
 * Yandex SMTP over Cloudflare Workers TCP sockets (implicit TLS on port 465).
 * Configure SMTP_HOST, SMTP_PORT, SMTP_USER_NOREPLY and secret SMTP_PASSWORD_NOREPLY.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function safeHeader(value) {
  return String(value ?? "").replace(/[\r\n]/g, " ").trim();
}
function base64Utf8(value) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sendMail(env, { to, subject, text }) {
  const host = env.SMTP_HOST || "smtp.yandex.com";
  const port = Number(env.SMTP_PORT || 465);
  const username = env.SMTP_USER_NOREPLY || "no-reply@sbiz.app";
  const password = env.SMTP_PASSWORD_NOREPLY;
  if (!password) throw new Error("MAIL_NOT_CONFIGURED");
  if (port !== 465) throw new Error("SMTP_PORT_UNSUPPORTED");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("INVALID_RECIPIENT");

  const socket = connect({ hostname: host, port }, { secureTransport: "on", allowHalfOpen: false });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  let buffer = "";

  async function readLine() {
    while (!buffer.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP_CONNECTION_CLOSED");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 65536) throw new Error("SMTP_RESPONSE_TOO_LARGE");
    }
    const index = buffer.indexOf("\n");
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    return line;
  }
  async function response() {
    const lines = [];
    let line;
    do {
      line = await readLine();
      lines.push(line);
      if (lines.length > 100) throw new Error("SMTP_TOO_MANY_RESPONSE_LINES");
    } while (/^\d{3}-/.test(line));
    const code = Number((lines[lines.length - 1] || "").slice(0, 3));
    return { code, lines };
  }
  async function command(value, expected) {
    await writer.write(encoder.encode(value + "\r\n"));
    const result = await response();
    if (!expected.includes(result.code)) throw new Error("SMTP_COMMAND_FAILED_" + result.code);
    return result;
  }

  try {
    const greeting = await response();
    if (greeting.code !== 220) throw new Error("SMTP_BAD_GREETING");
    await command("EHLO sbiz.app", [250]);
    await command("AUTH LOGIN", [334]);
    await command(base64Utf8(username), [334]);
    await command(base64Utf8(password), [235]);
    await command("MAIL FROM:<" + safeHeader(username) + ">", [250]);
    await command("RCPT TO:<" + safeHeader(to) + ">", [250, 251]);
    await command("DATA", [354]);

    const body = String(text ?? "").replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    const message = [
      "From: SBiz Notifications <" + safeHeader(username) + ">",
      "To: <" + safeHeader(to) + ">",
      "Subject: " + safeHeader(subject),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      ".",
      "",
    ].join("\r\n");
    await writer.write(encoder.encode(message));
    const accepted = await response();
    if (accepted.code !== 250) throw new Error("SMTP_MESSAGE_REJECTED");
    await command("QUIT", [221]);
  } finally {
    try { await writer.close(); } catch {}
    try { await reader.cancel(); } catch {}
    try { socket.close(); } catch {}
  }
}
/* [EMAIL][SMTP][END] */

/**
 * Verify Cloudflare Access JWTs at the Worker boundary.
 *
 * Required Worker vars:
 *   CF_ACCESS_TEAM_DOMAIN = "<team-name>.cloudflareaccess.com"
 *   CF_ACCESS_AUD = the Access application's AUD tag
 *
 * Fail closed if config, token, signing key, or claims are invalid.
 */
let cachedJwks = null;
let cachedJwksAt = 0;
const JWKS_TTL_MS = 5 * 60 * 1000;

const decodeBase64Url = value => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function accessConfig(env) {
  const teamDomain = String(env.CF_ACCESS_TEAM_DOMAIN || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  const audience = String(env.CF_ACCESS_AUD || "").trim();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain) || !audience) return null;
  return { teamDomain, audience, issuer: "https://" + teamDomain };
}

async function loadJwks(teamDomain, forceRefresh = false) {
  if (!forceRefresh && cachedJwks && Date.now() - cachedJwksAt < JWKS_TTL_MS) return cachedJwks;
  const response = await fetch("https://" + teamDomain + "/cdn-cgi/access/certs", {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) throw new Error("Cloudflare Access signing keys unavailable");
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error("Invalid Cloudflare Access signing-key response");
  cachedJwks = body.keys;
  cachedJwksAt = Date.now();
  return cachedJwks;
}

async function verifySignature(parts, teamDomain) {
  const header = decodeJsonPart(parts[0]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
  let keys = await loadJwks(teamDomain);
  let jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA" && key.use !== "enc");
  if (!jwk) {
    keys = await loadJwks(teamDomain, true);
    jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA" && key.use !== "enc");
  }
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]),
  );
}

export async function verifyCloudflareAccess(request, env) {
  const config = accessConfig(env);
  if (!config) return { ok: false, status: 503, error: "CLOUDFLARE_ACCESS_NOT_CONFIGURED" };

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, status: 401, error: "CLOUDFLARE_ACCESS_REQUIRED" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401, error: "INVALID_ACCESS_TOKEN" };

  try {
    const header = decodeJsonPart(parts[0]);
    const claims = decodeJsonPart(parts[1]);
    if (header.alg !== "RS256" || !(await verifySignature(parts, config.teamDomain))) {
      return { ok: false, status: 401, error: "INVALID_ACCESS_TOKEN" };
    }
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== config.issuer ||
      !audiences.includes(config.audience) ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) ||
      typeof claims.email !== "string" ||
      !claims.email.includes("@")
    ) {
      return { ok: false, status: 401, error: "INVALID_ACCESS_TOKEN" };
    }
    return { ok: true, claims };
  } catch {
    return { ok: false, status: 503, error: "ACCESS_VERIFICATION_UNAVAILABLE" };
  }
}

/**
 * SBiz MOD-01: registration, authentication and business traceability.
 * All database writes use the SBIZ_APP_DB D1 binding.
 */


const LANGUAGES = new Set(["en", "vi", "id", "es", "pt"]);
const RESERVED_SLUGS = new Set([
  "admin", "api", "login", "create", "www", "assets", "support", "help",
  "pricing", "privacy", "terms", "status", "en", "vi", "id", "es", "pt",
  "verify", "logout", "dashboard", "account", "business", "products",
  "quotes", "billing", "contact", "register", "forgot-password", "reset-password"
]);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }
});
const html = (body, status = 200, headers = {}) => new Response(body, {
  status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", ...headers }
});
const nowIso = () => new Date().toISOString();
const uniqueTimestamp = () => new Date().toISOString().replace(/\.(\d{3})Z$/, (_, millis) => "." + millis + String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0") + "Z");
const uuid = () => crypto.randomUUID();
const normalizeEmail = value => String(value ?? "").trim().toLowerCase();
const normalizeSlug = value => String(value ?? "").trim().toLowerCase();
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validSignupSlug = slug => slug.length >= 13 && slug.length <= 32 && /^[a-z0-9]+$/.test(slug) && !RESERVED_SLUGS.has(slug);
const validChangedSlug = slug => slug.length >= 1 && slug.length <= 32 && /^[a-z0-9]+$/.test(slug) && !RESERVED_SLUGS.has(slug);
const bytesToB64url = bytes => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const randomToken = (size = 32) => bytesToB64url(crypto.getRandomValues(new Uint8Array(size)));
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToB64url(new Uint8Array(digest));
}
async function passwordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, key, 256);
  return "pbkdf2-sha256$310000$" + bytesToB64url(salt) + "$" + bytesToB64url(new Uint8Array(bits));
}
async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, rounds, saltText, expected] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(Number(rounds)) || Number(rounds) < 100000) return false;
  const fromB64 = text => {
    const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  };
  const salt = fromB64(saltText);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(rounds), hash: "SHA-256" }, key, 256);
  return bytesToB64url(new Uint8Array(bits)) === expected;
}
async function bodyJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) return null;
  try { return await request.json(); } catch { return null; }
}
async function event(db, businessId, eventType, actorId = null, oldValue = null, newValue = null, metadata = null) {
  await db.prepare(`INSERT INTO business_events
    (event_id, business_id, event_type, occurred_at, actor_account_id, old_value, new_value, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(uuid(), businessId, eventType, nowIso(), actorId, oldValue, newValue, metadata ? JSON.stringify(metadata) : null).run();
}
function cookieValue(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index > -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
async function currentAccount(request, env) {
  const token = cookieValue(request, "sbiz_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.SBIZ_APP_DB.prepare(`SELECT a.account_id, a.email, a.status, a.email_verified_at
    FROM auth_sessions s JOIN accounts a ON a.account_id=s.account_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.status='active'`)
    .bind(tokenHash, nowIso()).first();
}
async function createSession(db, accountId) {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("INSERT INTO auth_sessions (session_id, account_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(uuid(), accountId, await sha256(token), now.toISOString(), expires).run();
  return token;
}
function sessionCookie(token) {
  return "sbiz_session=" + token + "; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax";
}
function clearSessionCookie() {
  return "sbiz_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}
function page(title, content, language = "en") {
  return `<!doctype html><html lang="${["en", "vi", "id", "es", "pt"].includes(language) ? language : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — SBiz</title><style>:root{font-family:Roboto,Arial,sans-serif;color:#111827;background:#fff;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#fff}main{width:min(100%,440px);padding:24px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.05)}h1{font-size:1.5rem;margin:0 0 8px;font-weight:500}p{line-height:1.5;color:#6b7280}label{display:block;font-size:.9rem;font-weight:500;margin:16px 0 6px}input,select{width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;font:inherit;color:#111827;background:#fff}input:focus,select:focus{outline:2px solid #9ca3af;outline-offset:1px}button,a.button{display:block;width:100%;margin-top:16px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#111827;font:inherit;font-weight:500;text-align:center;text-decoration:none;cursor:pointer}a.secondary{display:block;text-align:center;margin-top:16px;color:#4b5563}#message{white-space:pre-wrap;margin-top:14px;color:#6b7280}small{color:#6b7280}</style></head><body><main><h1>${title}</h1>${content}</main></body></html>`;
}
function localizedPath(language, path) {
  const lang = ["en", "vi", "id", "es", "pt"].includes(language) ? language : "en";
  const target = path.startsWith("/") ? path : "/" + path;
  return lang === "en" ? target : "/" + lang + (target === "/" ? "" : target);
}
function pageForPath(path, url) {
  const languageMatch = path.match(/^\/(vi|id|es|pt)(?=\/|$)(.*)$/);
  const uiLanguage = languageMatch ? languageMatch[1] : "en";
  if (languageMatch) path = languageMatch[2] || "/";
  const localPath = target => localizedPath(uiLanguage, target);
  if (languageMatch && (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/"))) return null;
  const pageLocalized = (title, content) => page(title, content, uiLanguage);
  const copy = ({
en:{homeIntro:"Create a business account or sign in to manage your business.",create:"Create",login:"Login",chooseLanguage:"Choose language",createTitle:"Create your SBiz account",createIntro:"Create a business account. Email verification is required within 30 minutes.",email:"Email",slug:"Business slug",slugHelp:"13–32 lowercase letters or numbers.",defaultLanguage:"Default language",alreadyLogin:"Already have an account? Login",loginTitle:"Login",password:"Password",forgotPassword:"Forgot password?",createAccount:"Create account",verifyTitle:"Verify email and set password",verifyIntro:"Confirm your email by setting a password. The verification link expires after 30 minutes.",newPassword:"New password",verifyButton:"Verify and create account",forgotTitle:"Forgot password",forgotIntro:"If the account is eligible, we will email a password reset link.",accountEmail:"Account email",sendReset:"Send reset link",backLogin:"Back to Login",resetTitle:"Reset password",resetButton:"Reset password",changeEmailTitle:"Confirm email change",changeEmailIntro:"Confirm the new email address for your SBiz account.",confirmEmail:"Confirm email change",missingEmailLink:"Confirmation link is missing."},
vi:{homeIntro:"Tạo tài khoản doanh nghiệp hoặc đăng nhập để quản lý doanh nghiệp.",create:"Tạo tài khoản",login:"Đăng nhập",chooseLanguage:"Chọn ngôn ngữ",createTitle:"Tạo tài khoản SBiz",createIntro:"Tạo tài khoản doanh nghiệp. Bạn cần xác minh email trong vòng 30 phút.",email:"Email",slug:"Slug doanh nghiệp",slugHelp:"13–32 chữ cái thường hoặc chữ số.",defaultLanguage:"Ngôn ngữ mặc định",alreadyLogin:"Đã có tài khoản? Đăng nhập",loginTitle:"Đăng nhập",password:"Mật khẩu",forgotPassword:"Quên mật khẩu?",createAccount:"Tạo tài khoản",verifyTitle:"Xác minh email và đặt mật khẩu",verifyIntro:"Xác nhận email bằng cách đặt mật khẩu. Liên kết hết hạn sau 30 phút.",newPassword:"Mật khẩu mới",verifyButton:"Xác minh và tạo tài khoản",forgotTitle:"Quên mật khẩu",forgotIntro:"Nếu tài khoản đủ điều kiện, chúng tôi sẽ gửi liên kết đặt lại mật khẩu qua email.",accountEmail:"Email tài khoản",sendReset:"Gửi liên kết đặt lại",backLogin:"Quay lại đăng nhập",resetTitle:"Đặt lại mật khẩu",resetButton:"Đặt lại mật khẩu",changeEmailTitle:"Xác nhận đổi email",changeEmailIntro:"Xác nhận địa chỉ email mới cho tài khoản SBiz.",confirmEmail:"Xác nhận đổi email",missingEmailLink:"Thiếu liên kết xác nhận."},
id:{homeIntro:"Buat akun bisnis atau masuk untuk mengelola bisnis Anda.",create:"Buat akun",login:"Masuk",chooseLanguage:"Pilih bahasa",createTitle:"Buat akun SBiz",createIntro:"Buat akun bisnis. Verifikasi email diperlukan dalam 30 menit.",email:"Email",slug:"Slug bisnis",slugHelp:"13–32 huruf kecil atau angka.",defaultLanguage:"Bahasa default",alreadyLogin:"Sudah punya akun? Masuk",loginTitle:"Masuk",password:"Kata sandi",forgotPassword:"Lupa kata sandi?",createAccount:"Buat akun",verifyTitle:"Verifikasi email dan atur kata sandi",verifyIntro:"Konfirmasi email dengan membuat kata sandi. Tautan berlaku selama 30 menit.",newPassword:"Kata sandi baru",verifyButton:"Verifikasi dan buat akun",forgotTitle:"Lupa kata sandi",forgotIntro:"Jika akun memenuhi syarat, tautan pengaturan ulang kata sandi akan dikirim melalui email.",accountEmail:"Email akun",sendReset:"Kirim tautan reset",backLogin:"Kembali ke Masuk",resetTitle:"Atur ulang kata sandi",resetButton:"Atur ulang kata sandi",changeEmailTitle:"Konfirmasi perubahan email",changeEmailIntro:"Konfirmasikan alamat email baru untuk akun SBiz Anda.",confirmEmail:"Konfirmasi perubahan email",missingEmailLink:"Tautan konfirmasi tidak ditemukan."},
es:{homeIntro:"Crea una cuenta empresarial o inicia sesión para administrar tu negocio.",create:"Crear cuenta",login:"Iniciar sesión",chooseLanguage:"Elegir idioma",createTitle:"Crea tu cuenta de SBiz",createIntro:"Crea una cuenta empresarial. Debes verificar el correo en 30 minutos.",email:"Correo electrónico",slug:"Slug del negocio",slugHelp:"13–32 letras minúsculas o números.",defaultLanguage:"Idioma predeterminado",alreadyLogin:"¿Ya tienes una cuenta? Inicia sesión",loginTitle:"Iniciar sesión",password:"Contraseña",forgotPassword:"¿Olvidaste tu contraseña?",createAccount:"Crear cuenta",verifyTitle:"Verificar correo y crear contraseña",verifyIntro:"Confirma tu correo creando una contraseña. El enlace vence en 30 minutos.",newPassword:"Nueva contraseña",verifyButton:"Verificar y crear cuenta",forgotTitle:"Recuperar contraseña",forgotIntro:"Si la cuenta cumple los requisitos, enviaremos un enlace para restablecer la contraseña.",accountEmail:"Correo de la cuenta",sendReset:"Enviar enlace",backLogin:"Volver a iniciar sesión",resetTitle:"Restablecer contraseña",resetButton:"Restablecer contraseña",changeEmailTitle:"Confirmar cambio de correo",changeEmailIntro:"Confirma la nueva dirección de correo de tu cuenta SBiz.",confirmEmail:"Confirmar cambio de correo",missingEmailLink:"Falta el enlace de confirmación."},
pt:{homeIntro:"Crie uma conta empresarial ou entre para gerenciar sua empresa.",create:"Criar conta",login:"Entrar",chooseLanguage:"Escolher idioma",createTitle:"Crie sua conta SBiz",createIntro:"Crie uma conta empresarial. A verificação do e-mail deve ocorrer em até 30 minutos.",email:"E-mail",slug:"Slug da empresa",slugHelp:"13–32 letras minúsculas ou números.",defaultLanguage:"Idioma padrão",alreadyLogin:"Já tem uma conta? Entre",loginTitle:"Entrar",password:"Senha",forgotPassword:"Esqueceu a senha?",createAccount:"Criar conta",verifyTitle:"Verificar e-mail e definir senha",verifyIntro:"Confirme seu e-mail definindo uma senha. O link expira em 30 minutos.",newPassword:"Nova senha",verifyButton:"Verificar e criar conta",forgotTitle:"Recuperar senha",forgotIntro:"Se a conta estiver elegível, enviaremos um link para redefinir a senha.",accountEmail:"E-mail da conta",sendReset:"Enviar link",backLogin:"Voltar para entrar",resetTitle:"Redefinir senha",resetButton:"Redefinir senha",changeEmailTitle:"Confirmar alteração de e-mail",changeEmailIntro:"Confirme o novo endereço de e-mail da sua conta SBiz.",confirmEmail:"Confirmar alteração de e-mail",missingEmailLink:"O link de confirmação está ausente."}
})[uiLanguage];
  const dashboardCopy = ({
    en:{title:"Your dashboard",intro:"Account and business information recorded by SBiz.",logout:"Log out",signedIn:"Signed in as",businesses:"Your businesses",refresh:"Refresh",changeLanguage:"Change primary language",saveLanguage:"Save language",changeEmail:"Change account email",newEmail:"New email address",sendEmailConfirmation:"Send confirmation",businessId:"Business ID",primaryLanguage:"Primary language",created:"Created",emailVerified:"Email verified",verificationStatus:"Verification status",adminVerified:"Admin verified",subscriptionStarts:"Subscription starts",subscriptionExpires:"Subscription expires",dataDeleted:"Operational data deleted",domains:"Custom domains",domainHint:"Prove domain ownership with a DNS TXT record. A hostname is active only after Cloudflare confirms it and its SSL status.",hostname:"Custom hostname",addDomain:"Add hostname",verifyDomain:"Check DNS / provider",removeDomain:"Unlink hostname",business:"Business",domainRemoveConfirm:"Remove this custom hostname? It will no longer be linked to this business.",dnsRecord:"Required DNS TXT record"},
    vi:{title:"Bảng điều khiển",intro:"Thông tin tài khoản và doanh nghiệp được SBiz ghi nhận.",logout:"Đăng xuất",signedIn:"Đang đăng nhập bằng",businesses:"Doanh nghiệp của bạn",refresh:"Làm mới",changeLanguage:"Đổi ngôn ngữ chính",saveLanguage:"Lưu ngôn ngữ",changeEmail:"Đổi email tài khoản",newEmail:"Địa chỉ email mới",sendEmailConfirmation:"Gửi liên kết xác nhận",businessId:"Mã doanh nghiệp",primaryLanguage:"Ngôn ngữ chính",created:"Ngày tạo",emailVerified:"Email đã xác minh",verificationStatus:"Trạng thái xác minh",adminVerified:"Ngày admin duyệt",subscriptionStarts:"Bắt đầu thuê bao",subscriptionExpires:"Hết hạn thuê bao",dataDeleted:"Ngày xóa dữ liệu vận hành",domains:"Tên miền riêng",domainHint:"Xác minh quyền sở hữu bằng bản ghi DNS TXT. Tên miền chỉ hoạt động khi Cloudflare xác nhận tên miền và SSL.",hostname:"Tên miền",addDomain:"Thêm tên miền",verifyDomain:"Kiểm tra DNS / nhà cung cấp",removeDomain:"Gỡ tên miền",business:"Doanh nghiệp",domainRemoveConfirm:"Gỡ tên miền này khỏi doanh nghiệp?",dnsRecord:"Bản ghi DNS TXT cần tạo"},
    id:{title:"Dasbor Anda",intro:"Informasi akun dan bisnis yang tercatat di SBiz.",logout:"Keluar",signedIn:"Masuk sebagai",businesses:"Bisnis Anda",refresh:"Muat ulang",changeLanguage:"Ubah bahasa utama",saveLanguage:"Simpan bahasa",changeEmail:"Ubah email akun",newEmail:"Alamat email baru",sendEmailConfirmation:"Kirim konfirmasi",businessId:"ID bisnis",primaryLanguage:"Bahasa utama",created:"Dibuat",emailVerified:"Email terverifikasi",verificationStatus:"Status verifikasi",adminVerified:"Disetujui admin",subscriptionStarts:"Mulai langganan",subscriptionExpires:"Langganan berakhir",dataDeleted:"Data operasional dihapus",domains:"Domain kustom",domainHint:"Buktikan kepemilikan melalui TXT DNS. Hostname hanya aktif setelah Cloudflare mengonfirmasi hostname dan status SSL.",hostname:"Hostname kustom",addDomain:"Tambah hostname",verifyDomain:"Periksa DNS / penyedia",removeDomain:"Lepas hostname",business:"Bisnis",domainRemoveConfirm:"Lepaskan hostname kustom ini dari bisnis?",dnsRecord:"Catatan DNS TXT yang diperlukan"},
    es:{title:"Tu panel",intro:"Información de cuenta y negocio registrada por SBiz.",logout:"Cerrar sesión",signedIn:"Sesión iniciada como",businesses:"Tus negocios",refresh:"Actualizar",changeLanguage:"Cambiar idioma principal",saveLanguage:"Guardar idioma",changeEmail:"Cambiar correo de la cuenta",newEmail:"Nueva dirección de correo",sendEmailConfirmation:"Enviar confirmación",businessId:"ID del negocio",primaryLanguage:"Idioma principal",created:"Creado",emailVerified:"Correo verificado",verificationStatus:"Estado de verificación",adminVerified:"Verificado por admin",subscriptionStarts:"Inicio de suscripción",subscriptionExpires:"Fin de suscripción",dataDeleted:"Datos operativos eliminados",domains:"Dominios personalizados",domainHint:"Demuestra la propiedad mediante un registro TXT DNS. El nombre solo se activa cuando Cloudflare confirma el nombre y el estado SSL.",hostname:"Nombre de dominio",addDomain:"Añadir dominio",verifyDomain:"Comprobar DNS / proveedor",removeDomain:"Desvincular dominio",business:"Negocio",domainRemoveConfirm:"¿Desvincular este dominio personalizado del negocio?",dnsRecord:"Registro DNS TXT requerido"},
    pt:{title:"Seu painel",intro:"Informações da conta e da empresa registradas pelo SBiz.",logout:"Sair",signedIn:"Conectado como",businesses:"Suas empresas",refresh:"Atualizar",changeLanguage:"Alterar idioma principal",saveLanguage:"Salvar idioma",changeEmail:"Alterar e-mail da conta",newEmail:"Novo endereço de e-mail",sendEmailConfirmation:"Enviar confirmação",businessId:"ID da empresa",primaryLanguage:"Idioma principal",created:"Criada em",emailVerified:"E-mail verificado",verificationStatus:"Status de verificação",adminVerified:"Verificada pelo admin",subscriptionStarts:"Início da assinatura",subscriptionExpires:"Fim da assinatura",dataDeleted:"Dados operacionais excluídos",domains:"Domínios personalizados",domainHint:"Comprove a propriedade com um registro TXT DNS. O domínio só fica ativo após a confirmação do Cloudflare e do SSL.",hostname:"Nome do domínio",addDomain:"Adicionar domínio",verifyDomain:"Verificar DNS / provedor",removeDomain:"Desvincular domínio",business:"Empresa",domainRemoveConfirm:"Desvincular este domínio personalizado da empresa?",dnsRecord:"Registro DNS TXT necessário"}
  })[uiLanguage];
  if (path === "/") return html(pageLocalized("SBiz — Smart Business", `
    <p>${copy.homeIntro}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><a class="button" href="${localPath("/create")}">${copy.create}</a><a class="button" href="${localPath("/login")}">${copy.login}</a></div>
    <p style="margin-top:24px">${copy.chooseLanguage}</p><nav style="display:flex;gap:10px;flex-wrap:wrap"><a href="/">English 🇺🇸</a><a href="/vi">Tiếng Việt 🇻🇳</a><a href="/id">Bahasa Indonesia 🇮🇩</a><a href="/es">Español 🇲🇽</a><a href="/pt">Português 🇧🇷</a></nav>
  `));
  if (path === "/create") return html(pageLocalized(copy.createTitle, `
    <p>${copy.createIntro}</p>
    <form id="form"><label>${copy.email}</label><input name="email" type="email" autocomplete="email" required maxlength="254">
    <label>${copy.slug}</label><input name="slug" required minlength="13" maxlength="32" pattern="[a-z0-9]+" autocomplete="off"><small>${copy.slugHelp}</small>
    <label>${copy.defaultLanguage}</label><select name="defaultLanguage"><option value="en">English 🇺🇸</option><option value="vi">Tiếng Việt 🇻🇳</option><option value="id">Bahasa Indonesia 🇮🇩</option><option value="es">Español 🇲🇽</option><option value="pt">Português 🇧🇷</option></select>
    <button>${copy.create}</button><div id="message" role="status"></div></form><a class="secondary" href="${localPath("/login")}">${copy.alreadyLogin}</a>
    <script>document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),slug:f.get('slug'),defaultLanguage:f.get('defaultLanguage'),uiLanguage:${JSON.stringify(uiLanguage)}})});const d=await r.json();document.querySelector('#message').textContent=d.message||d.error||'Request completed';});</script>`));
  if (path === "/login") return html(pageLocalized(copy.loginTitle, `
    <form id="form"><label>${copy.email}</label><input name="email" type="email" autocomplete="email" required><label>${copy.password}</label><input name="password" type="password" autocomplete="current-password" required minlength="12"><button>${copy.login}</button><div id="message" role="status"></div></form><a class="secondary" href="${localPath("/forgot-password")}">${copy.forgotPassword}</a><a class="secondary" href="${localPath("/create")}">${copy.createAccount}</a>
    <script>document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')})});const d=await r.json();if(r.ok)location.href=${JSON.stringify(localizedPath(uiLanguage, "/dashboard"))};else document.querySelector('#message').textContent=d.message||'Unable to login.';});</script>`));
  if (path === "/verify") return html(pageLocalized(copy.verifyTitle, `
    <p>${copy.verifyIntro}</p><form id="form"><label>${copy.newPassword}</label><input name="password" type="password" autocomplete="new-password" minlength="12" required><small>Use at least 12 characters.</small><button>${copy.verifyButton}</button><div id="message" role="status"></div></form>
    <script>const token=new URLSearchParams(location.search).get('token');document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/register/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,password:f.get('password')})});const d=await r.json();document.querySelector('#message').textContent=d.message||d.error||'Request completed';if(r.ok)setTimeout(()=>location.href=${JSON.stringify(localizedPath(uiLanguage, "/login"))},1500);});if(!token)document.querySelector('#message').textContent='Verification link is missing.';</script>`));
  if (path === "/change-email") return html(pageLocalized(copy.changeEmailTitle, `
    <p>${copy.changeEmailIntro}</p><form id="form"><button>${copy.confirmEmail}</button><div id="message" role="status"></div></form>
    <script>const token=new URLSearchParams(location.search).get('token');document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/v1/email/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});const d=await r.json();document.querySelector('#message').textContent=d.message||d.error||'Request completed';});if(!token)document.querySelector('#message').textContent=${JSON.stringify(copy.missingEmailLink)};</script>`));
  if (path === "/forgot-password") return html(pageLocalized(copy.forgotTitle, `
    <p>${copy.forgotIntro}</p><form id="form"><label>${copy.accountEmail}</label><input name="email" type="email" autocomplete="email" required><button>${copy.sendReset}</button><div id="message" role="status"></div></form><a class="secondary" href="${localPath("/login")}">${copy.backLogin}</a>
    <script>document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/password/forgot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),uiLanguage:${JSON.stringify(uiLanguage)}})});const d=await r.json();document.querySelector('#message').textContent=d.message||'If the account is eligible, a reset link will be sent.';});</script>`));
  if (path === "/reset-password") return html(pageLocalized(copy.resetTitle, `
    <form id="form"><label>${copy.newPassword}</label><input name="password" type="password" minlength="12" autocomplete="new-password" required><button>${copy.resetButton}</button><div id="message" role="status"></div></form>
    <script>const token=new URLSearchParams(location.search).get('token');document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/password/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,password:f.get('password')})});const d=await r.json();document.querySelector('#message').textContent=d.message||d.error||'Request completed';if(r.ok)setTimeout(()=>location.href=${JSON.stringify(localizedPath(uiLanguage, "/login"))},1500);});if(!token)document.querySelector('#message').textContent='Reset link is missing.';</script>`));
  if (path === "/admin") return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SBiz Admin</title><style>:root{font-family:Roboto,Arial,sans-serif;color:#111827;background:#fff;font-synthesis:none;color-scheme:light;--ui-surface:#fff;--ui-border:#e5e7eb;--ui-text:#111827;--ui-muted:#6b7280;--ui-shadow:0 1px 2px rgba(0,0,0,.05);--ui-radius-control:6px;--ui-radius-panel:8px}
*{box-sizing:border-box}html,body{min-height:100%;margin:0;background:#fff;color:#111827}body{font-family:Roboto,Arial,sans-serif}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px clamp(16px,4vw,40px);background:#fff;border-bottom:1px solid #e5e7eb}
header strong{font-size:1rem;font-weight:500}header span{color:#6b7280;font-size:.9rem}main{max-width:1280px;margin:0 auto;padding:clamp(16px,3vw,32px)}h1{margin:0;font-size:1.75rem;font-weight:500;line-height:1.25}h2,h3{font-weight:500}p{color:#6b7280;line-height:1.5}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0;padding:0}
.toolbar input,.toolbar select,input[type=url]{min-height:40px;padding:9px 11px;border:1px solid #e5e7eb;border-radius:6px;font:inherit;color:#111827;background:#fff}
.toolbar input{flex:1;min-width:200px}.toolbar input:focus,.toolbar select:focus,input[type=url]:focus{outline:2px solid #9ca3af;outline-offset:1px}
button,.button{border:1px solid #e5e7eb;border-radius:6px;padding:9px 13px;background:#fff;color:#111827;font:inherit;font-weight:500;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
button:hover,.button:hover,button.secondary:hover{border-color:#9ca3af}button:active,.button:active{transform:none}button:focus-visible,.button:focus-visible{outline:2px solid #9ca3af;outline-offset:2px}button.secondary{background:#fff;color:#111827;border-color:#e5e7eb;box-shadow:none}
.panel,.detail{margin-top:16px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.05);overflow:hidden}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:#fff;border-bottom:1px solid #e5e7eb}
.table-wrap{background:#fff;overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:640px;background:#fff}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid #e5e7eb;font-size:.9rem;background:#fff}th{font-size:.75rem;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}td{vertical-align:middle}tbody tr:last-child td{border-bottom:0}.muted{color:#6b7280}.pill{display:inline-block;border:1px solid #e5e7eb;border-radius:6px;padding:4px 8px;font-size:.78rem;background:#fff;color:#4b5563}.pill.verified{background:#fff;color:#374151;border-color:#d1d5db}.empty{padding:32px 16px;text-align:center;color:#6b7280}
.detail{padding:18px}.detail:not(.open){display:none}.detail h2{margin-top:0}.detail dl{display:grid;grid-template-columns:minmax(120px,180px) 1fr;gap:10px 16px}.detail dt{color:#6b7280}.detail dd{margin:0;overflow-wrap:anywhere}
input,select,textarea{font:inherit;color:#111827;background:#fff;border:1px solid #e5e7eb;border-radius:6px}input,select,textarea{padding:9px 11px}textarea{width:100%;min-height:100px}input:focus,select:focus,textarea:focus{outline:2px solid #9ca3af;outline-offset:1px}
a{color:#374151}a:hover{color:#111827}
@media(max-width:640px){header{align-items:flex-start;padding:12px 16px}main{padding:16px}.toolbar{display:grid;grid-template-columns:1fr}.toolbar input{min-width:0;width:100%}.panel,.detail{margin-top:12px}.panel-head{align-items:flex-start;flex-direction:column;padding:12px}th,td{padding:10px 11px}.detail dl{grid-template-columns:1fr;gap:4px}.detail dd{margin-bottom:10px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation:none!important}}</style></head><body><header><strong>SBiz <span>/ System administration</span></strong><span>Owner access verified by Cloudflare</span></header><main><h1>Business administration</h1><p>Review registered businesses, inspect traceability history, and record a business registration document link.</p><div class="toolbar"><input id="search" type="search" placeholder="Search business ID, slug, or email" aria-label="Search businesses"><select id="status" aria-label="Filter by verification status"><option value="">All verification statuses</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="rejected">Rejected</option></select><button id="refresh">Refresh list</button></div><section class="panel"><div class="panel-head"><strong>Businesses</strong><span id="count" class="muted">Loading…</span></div><div class="table-wrap"><table><thead><tr><th>Business</th><th>Owner email</th><th>Verification</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody id="rows"></tbody></table></div><div id="empty" class="empty" hidden>No businesses match this view.</div></section><section id="detail" class="detail" aria-live="polite"><div class="panel-head" style="padding:0 0 14px"><div><h2 id="detail-title" style="margin:0;font-size:1.2rem">Business details</h2><p id="detail-subtitle" style="margin:5px 0 0"></p></div><button id="close-detail" class="secondary">Close details</button></div><div id="detail-fields" class="detail-grid"></div><h3>Registration document</h3><p>Enter a direct HTTPS document link. Saving it marks the business verification status as verified and records an audit event.</p><form id="document-form"><div class="form-row"><input id="document-url" type="url" placeholder="https://…" required maxlength="2048" aria-label="Registration document HTTPS URL"><button type="submit">Save link and verify</button></div></form><div id="message" role="status"></div><h3>Slug history</h3><ol id="slug-history" class="history"></ol><h3>Subscription history</h3><ol id="subscription-history" class="history"></ol><h3>Custom domains</h3><ol id="domain-history" class="history"></ol><h3>Recent history</h3><ol id="history" class="history"></ol></section><footer>SBiz administration · Protected by Cloudflare Access</footer></main><script>
  const $=id=>document.getElementById(id);let businesses=[];let selectedId=null;
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const date=value=>value?new Date(value).toLocaleString():"—";
  async function load(){ $("rows").innerHTML="";$("empty").hidden=true;$("count").textContent="Loading…";try{const r=await fetch("/api/v1/admin/businesses?limit=100",{headers:{accept:"application/json"},cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||"Could not load businesses");businesses=Array.isArray(d.businesses)?d.businesses:[];render();}catch(e){$("count").textContent="Could not load";$("empty").hidden=false;$("empty").textContent=e.message+" — refresh to try again.";$("empty").style.color="#b42318";}}
  function render(){const q=$("search").value.trim().toLowerCase(),status=$("status").value;const filtered=businesses.filter(b=>[b.business_id,b.current_slug,b.email].some(v=>String(v||"").toLowerCase().includes(q))&&(!status||(b.verification_status||"pending")===status));$("rows").innerHTML=filtered.map(b=>'<tr><td data-label="Business"><strong>'+esc(b.current_slug)+'</strong><br><span class="muted">'+esc(b.business_id)+'</span></td><td data-label="Owner email">'+esc(b.email)+'</td><td data-label="Verification"><span class="pill '+(b.verification_status==="verified"?"verified":"")+'">'+esc(b.verification_status||"pending")+'</span></td><td data-label="Status">'+esc(b.status||"—")+'</td><td data-label="Created">'+esc(date(b.created_at))+'</td><td data-label="Details"><button class="secondary" data-open="'+esc(b.business_id)+'">View</button></td></tr>').join("");$("count").textContent=filtered.length+" shown · "+businesses.length+" total";$("empty").hidden=filtered.length!==0;$("empty").style.color="";$("rows").querySelectorAll("[data-open]").forEach(btn=>btn.addEventListener("click",()=>openBusiness(btn.dataset.open)));}
  async function openBusiness(id){selectedId=id;$("detail").classList.add("open");$("detail-title").textContent="Loading business…";$("detail-fields").innerHTML="";$("history").innerHTML="";$("slug-history").innerHTML="";$("subscription-history").innerHTML="";$("domain-history").innerHTML="";$("message").textContent="";$("message").className="";try{const r=await fetch("/api/v1/admin/businesses/"+encodeURIComponent(id),{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||"Could not load business");const b=d.business;$("detail-title").textContent=b.current_slug||b.business_id;$("detail-subtitle").textContent=b.business_id;$("detail-fields").innerHTML=[["Owner email",b.email],["Account ID",b.account_id],["Default language",b.default_language],["Business status",b.status],["Verification status",b.verification_status],["Created",date(b.created_at)],["Email verified",date(b.verified_at)],["Admin verified",date(b.admin_verified_at)],["Subscription starts",date(b.subscription_started_at)],["Subscription expires",date(b.subscription_expires_at)],["Data deleted",date(b.data_deleted_at)],["Registration document",b.registration_document_url||"Not provided"]].map(([k,v])=>'<div class="field"><b>'+esc(k)+'</b>'+esc(v||"—")+'</div>').join("");$("document-url").value=b.registration_document_url||"";$("history").innerHTML=(d.history||[]).map(e=>'<li><strong>'+esc(e.event_type)+'</strong> · '+esc(date(e.occurred_at))+(e.new_value?' · '+esc(e.new_value):"")+'</li>').join("")||"<li>No events recorded yet.</li>";$("slug-history").innerHTML=(d.slug_history||[]).map(h=>'<li><strong>'+esc(h.slug)+'</strong> · '+esc(date(h.valid_from))+(h.valid_to?' — '+esc(date(h.valid_to)):' · Current')+' · '+esc(h.change_source||"system")+'</li>').join("")||"<li>No slug history recorded.</li>";$("subscription-history").innerHTML=(d.subscriptions||[]).map(v=>'<li><strong>'+esc(v.plan_code)+'</strong> · '+esc(v.status)+' · '+esc(v.term_years||"—")+' year(s) · '+esc(v.currency||"—")+' '+esc(v.amount_minor_units??"—")+' · '+esc(date(v.starts_at))+' — '+esc(date(v.expires_at))+'</li>').join("")||"<li>No subscription history recorded.</li>";$("domain-history").innerHTML=(d.domains||[]).map(v=>'<li><strong>'+esc(v.hostname)+'</strong> · '+esc(v.status)+' · Provider: '+esc(v.provider_status||"—")+' · SSL: '+esc(v.ssl_status||"—")+'</li>').join("")||"<li>No custom domains recorded.</li>";}catch(e){$("message").textContent=e.message;$("message").className="error";}}
  $("refresh").addEventListener("click",load);$("search").addEventListener("input",render);$("status").addEventListener("change",render);$("close-detail").addEventListener("click",()=>{$("detail").classList.remove("open");selectedId=null;});$("document-form").addEventListener("submit",async e=>{e.preventDefault();if(!selectedId)return;$("message").textContent="Saving…";$("message").className="";try{const r=await fetch("/api/v1/admin/businesses/"+encodeURIComponent(selectedId),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({registrationDocumentUrl:$("document-url").value.trim()})});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||"Could not save document link");$("message").textContent="Document link saved. Business verification marked verified.";$("message").className="";await load();await openBusiness(selectedId);}catch(e){$("message").textContent=e.message;$("message").className="error";}});load();
  </script></body></html>`);
  if (path === "/dashboard") return html(`<!doctype html><html lang="${uiLanguage}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${dashboardCopy.title} — SBiz</title><style>
:root{font-family:Roboto,Arial,sans-serif;color:#111827;background:#fff;color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111827}header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px clamp(16px,4vw,40px);border-bottom:1px solid #e5e7eb;background:#fff}header strong{font-weight:500}header span,.muted{color:#6b7280}main{max-width:1080px;margin:0 auto;padding:clamp(16px,4vw,36px)}h1{font-size:1.8rem;font-weight:500;margin:0}h2{font-size:1.1rem;font-weight:500;margin:0}p{line-height:1.5;color:#6b7280}.topline{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}.actions{display:flex;gap:8px;flex-wrap:wrap}button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:9px 13px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#111827;font:inherit;text-decoration:none;cursor:pointer}button:hover,.button:hover{border-color:#9ca3af}button:focus-visible,.button:focus-visible{outline:2px solid #9ca3af;outline-offset:2px}.summary{border:1px solid #e5e7eb;border-radius:8px;padding:18px;margin-bottom:24px;box-shadow:0 1px 2px rgba(0,0,0,.05)}.summary-label{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}.email{margin-top:8px;font-size:1.05rem;overflow-wrap:anywhere}.businesses{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px;margin-top:14px}.business{border:1px solid #e5e7eb;border-radius:8px;padding:18px;background:#fff;min-width:0}.business-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.slug{font-size:1.1rem;font-weight:500;overflow-wrap:anywhere}.pill{display:inline-block;border:1px solid #e5e7eb;border-radius:6px;padding:4px 8px;font-size:.78rem;color:#4b5563;white-space:nowrap}.facts{display:grid;grid-template-columns:minmax(110px,130px) 1fr;gap:9px 12px;margin:18px 0 0;font-size:.9rem}.facts dt{color:#6b7280}.facts dd{margin:0;overflow-wrap:anywhere}.language-setting{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:18px;padding-top:14px;border-top:1px solid #e5e7eb}.language-setting label{display:grid;gap:6px;flex:1;min-width:150px;color:#6b7280;font-size:.85rem}.language-select{min-height:40px;width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#111827;font:inherit}.language-save:disabled{opacity:.6;cursor:wait}.empty,.error{padding:18px;border:1px solid #e5e7eb;border-radius:8px;color:#6b7280}.error{color:#b42318}.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}@media(max-width:560px){header{align-items:flex-start}main{padding:18px 14px}.facts{grid-template-columns:1fr;gap:3px}.facts dd{margin-bottom:8px}}
</style></head><body><header><strong>SBiz <span>/ ${dashboardCopy.title}</span></strong><div class="actions"><button id="refresh">${dashboardCopy.refresh}</button><a class="button" href="/api/v1/logout?lang=${uiLanguage}">${dashboardCopy.logout}</a></div></header><main><div class="topline"><div><h1>${dashboardCopy.title}</h1><p>${dashboardCopy.intro}</p></div></div><section class="summary"><div class="summary-label">${dashboardCopy.signedIn}</div><div id="email" class="email">Checking session…</div></section><section class="summary"><div class="summary-label">${dashboardCopy.changeEmail}</div><form id="email-change-form"><label for="new-account-email">${dashboardCopy.newEmail}</label><input id="new-account-email" class="language-select" type="email" autocomplete="email" required maxlength="254"><button id="email-change-submit" type="submit">${dashboardCopy.sendEmailConfirmation}</button></form><p id="email-change-message" role="status"></p></section><div class="section-head"><h2>${dashboardCopy.businesses}</h2><span id="count" class="muted">Loading…</span></div><section id="businesses" class="businesses" aria-live="polite"></section><section class="summary"><div class="summary-label">${dashboardCopy.domains}</div><p>${dashboardCopy.domainHint}</p><form id="domain-form"><label for="domain-business">${dashboardCopy.business}</label><select id="domain-business" class="language-select" required></select><label for="domain-hostname">${dashboardCopy.hostname}</label><input id="domain-hostname" class="language-select" type="text" autocomplete="url" placeholder="shop.example.com" required maxlength="253"><button id="domain-submit" type="submit">${dashboardCopy.addDomain}</button></form><p id="domain-message" role="status"></p><pre id="domain-dns" hidden style="white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #e5e7eb;border-radius:6px;padding:12px"></pre><div id="domain-list" class="businesses"></div></section><p id="message" role="status" class="muted"></p></main><script>
const $=id=>document.getElementById(id);let emailChangeBusinessId=null;let selectedDomainBusinessId=null;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const fmt=v=>v?new Date(v).toLocaleDateString():"—";
function domainMessage(text){$("domain-message").textContent=text||"";}
async function loadDomains(){const list=$("domain-list");list.replaceChildren();$("domain-dns").hidden=true;if(!selectedDomainBusinessId){domainMessage("");return;}try{const r=await fetch("/api/v1/businesses/"+encodeURIComponent(selectedDomainBusinessId)+"/domains",{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||"Could not load custom domains");for(const domain of (d.domains||[])){const card=el("article","business");const head=el("div","business-head");const info=el("div");info.append(el("div","slug",domain.hostname),el("div","muted",domain.provider_status?("Provider: "+domain.provider_status+" · SSL: "+(domain.ssl_status||"unknown")):"DNS verification required"));head.append(info,el("span","pill",domain.status));card.append(head);if(domain.error_code)card.append(el("p","error",domain.error_code));if(domain.status!=="removed"){const actions=el("div","actions");const verify=el("button","",dashboardCopy.verifyDomain);verify.type="button";verify.addEventListener("click",async()=>{verify.disabled=true;domainMessage("");try{const response=await fetch("/api/v1/businesses/"+encodeURIComponent(selectedDomainBusinessId)+"/domains/"+encodeURIComponent(domain.domain_id)+"/verify",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});const result=await response.json();if(!response.ok)throw Error(result.message||result.error||"Domain verification failed");domainMessage(result.status==="active"?"Hostname and SSL are active in Cloudflare.":"Provider status: "+result.status);await loadDomains();}catch(error){domainMessage(error.message||"Domain verification failed.");await loadDomains();}});const remove=el("button","",dashboardCopy.removeDomain);remove.type="button";remove.addEventListener("click",async()=>{if(!confirm(dashboardCopy.domainRemoveConfirm))return;remove.disabled=true;try{const response=await fetch("/api/v1/businesses/"+encodeURIComponent(selectedDomainBusinessId)+"/domains/"+encodeURIComponent(domain.domain_id),{method:"DELETE"});const result=await response.json();if(!response.ok)throw Error(result.message||result.error||"Could not remove hostname");domainMessage("Hostname removed.");await loadDomains();}catch(error){domainMessage(error.message||"Could not remove hostname.");await loadDomains();}});actions.append(verify,remove);card.append(actions);}list.append(card);}if(!(d.domains||[]).length)list.append(el("p","muted","No custom domains requested."));}catch(error){domainMessage(error.message||"Could not load custom domains.");}}

async function load(){ $("message").textContent="";$("businesses").replaceChildren();$("count").textContent="Loading…";try{const r=await fetch("/api/v1/me",{cache:"no-store",headers:{accept:"application/json"}});const d=await r.json();if(r.status===401||!d.authenticated){location.replace(${JSON.stringify(localizedPath(uiLanguage, "/login"))});return;}if(!r.ok)throw Error(d.message||d.error||"Could not load account data");$("email").textContent=d.email||"—";const list=Array.isArray(d.businesses)?d.businesses:[];emailChangeBusinessId=list[0]?.business_id||null;$("email-change-submit").disabled=!emailChangeBusinessId;const domainSelect=$("domain-business");const previousDomainBusiness=domainSelect.value;domainSelect.replaceChildren();for(const business of list){const option=el("option","",business.current_slug||business.business_id);option.value=business.business_id;domainSelect.append(option);}if(list.some(b=>b.business_id===previousDomainBusiness))domainSelect.value=previousDomainBusiness;selectedDomainBusinessId=domainSelect.value||null;$("domain-hostname").disabled=!selectedDomainBusinessId;$("domain-submit").disabled=!selectedDomainBusinessId;$("count").textContent=list.length+" business"+(list.length===1?"":"es");if(!list.length){$("businesses").append(el("div","empty","No business profile is available for this account yet."));return;}for(const b of list){const card=el("article","business");const head=el("div","business-head");const names=el("div");names.append(el("div","slug",b.current_slug||"Business profile"),el("div","muted",b.business_id||""));head.append(names,el("span","pill",b.status||"unknown"));card.append(head);const facts=el("dl","facts");for(const [label,value] of [[dashboardCopy.businessId,b.business_id],[dashboardCopy.primaryLanguage,b.default_language],[dashboardCopy.created,fmt(b.created_at)],[dashboardCopy.emailVerified,fmt(b.verified_at)],[dashboardCopy.verificationStatus,b.verification_status],[dashboardCopy.adminVerified,fmt(b.admin_verified_at)],[dashboardCopy.subscriptionStarts,fmt(b.subscription_started_at)],[dashboardCopy.subscriptionExpires,fmt(b.subscription_expires_at)],[dashboardCopy.dataDeleted,fmt(b.data_deleted_at)]]){facts.append(el("dt","",label),el("dd","",value||"—"));}card.append(facts);const languageRow=el("div","language-setting");const languageLabel=el("label","", dashboardCopy.changeLanguage);const languageSelect=el("select","language-select");languageSelect.setAttribute("aria-label","Primary language for "+(b.current_slug||b.business_id));for(const [code,name] of [["en","English"],["vi","Tiếng Việt"],["id","Bahasa Indonesia"],["es","Español"],["pt","Português"]]){const option=el("option","",name);option.value=code;if(code===b.default_language)option.selected=true;languageSelect.append(option);}languageLabel.append(languageSelect);const saveLanguage=el("button","language-save",dashboardCopy.saveLanguage);saveLanguage.type="button";saveLanguage.addEventListener("click",async()=>{saveLanguage.disabled=true;$("message").textContent="Saving primary language…";try{const response=await fetch("/api/v1/businesses/"+encodeURIComponent(b.business_id)+"/language",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({defaultLanguage:languageSelect.value})});const result=await response.json();if(!response.ok)throw Error(result.message||result.error||"Could not update language");await load();$("message").textContent="Primary language saved.";}catch(error){$("message").textContent=error.message||"Could not update language.";}finally{saveLanguage.disabled=false;}});languageRow.append(languageLabel,saveLanguage);card.append(languageRow);$("businesses").append(card);}await loadDomains();}catch(e){$("count").textContent="Unavailable";$("businesses").append(el("div","error",e.message||"Could not load account data."));}}
$("domain-business").addEventListener("change",async()=>{selectedDomainBusinessId=$("domain-business").value||null;domainMessage("");await loadDomains();});
$("domain-form").addEventListener("submit",async e=>{e.preventDefault();if(!selectedDomainBusinessId)return;const button=$("domain-submit");button.disabled=true;domainMessage("");$("domain-dns").hidden=true;try{const response=await fetch("/api/v1/businesses/"+encodeURIComponent(selectedDomainBusinessId)+"/domains",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({hostname:$("domain-hostname").value.trim()})});const result=await response.json();if(!response.ok)throw Error(result.message||result.error||"Could not request custom domain");$("domain-dns").textContent=dashboardCopy.dnsRecord+"\\nType: "+result.dns.type+"\\nName: "+result.dns.name+"\\nValue: "+result.dns.value+"\\nExpires: "+result.verification_expires_at;$("domain-dns").hidden=false;$("domain-hostname").value="";domainMessage(result.message||"Add the TXT record and verify.");await loadDomains();}catch(error){domainMessage(error.message||"Could not request custom domain.");}finally{button.disabled=!selectedDomainBusinessId;}});
$("email-change-form").addEventListener("submit",async e=>{e.preventDefault();const message=$("email-change-message");if(!emailChangeBusinessId){message.textContent="No business profile is available for this account.";return;}const button=$("email-change-submit");button.disabled=true;message.textContent="";try{const response=await fetch("/api/v1/businesses/"+encodeURIComponent(emailChangeBusinessId)+"/email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({newEmail:$("new-account-email").value.trim(),uiLanguage:${JSON.stringify(uiLanguage)}})});const result=await response.json();if(!response.ok)throw Error(result.message||result.error||"Could not request email change");message.textContent=result.message||"Check the new email to confirm the change.";$("new-account-email").value="";}catch(error){message.textContent=error.message||"Could not request email change.";}finally{button.disabled=!emailChangeBusinessId;}});$("refresh").addEventListener("click",load);load();
</script></body></html>`);
  return null;
}

async function register(request, env) {
  const input = await bodyJson(request);
  if (!input) return json({ error: "INVALID_JSON" }, 400);
  const email = normalizeEmail(input.email);
  const slug = normalizeSlug(input.slug);
  const language = String(input.defaultLanguage || "");
  const requestedUiLanguage = String(input.uiLanguage || "en");
  const uiLanguage = ["en", "vi", "id", "es", "pt"].includes(requestedUiLanguage) ? requestedUiLanguage : "en";
  if (!validEmail(email)) return json({ error: "INVALID_EMAIL", message: "Enter a valid email address." }, 400);
  if (!validSignupSlug(slug)) return json({ error: "INVALID_SLUG", message: "Slug must contain 13–32 lowercase letters or numbers and cannot be reserved." }, 400);
  if (!LANGUAGES.has(language)) return json({ error: "INVALID_LANGUAGE" }, 400);
  const db = env.SBIZ_APP_DB;
  if (!db) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const existingEmail = await db.prepare("SELECT account_id FROM accounts WHERE email=? COLLATE NOCASE").bind(email).first();
  if (existingEmail) return json({ error: "EMAIL_ALREADY_USED", message: "This email is already in use. Please log in to your existing account." }, 409);
  const existingSlug = await db.prepare("SELECT business_id FROM businesses WHERE current_slug=? COLLATE NOCASE").bind(slug).first();
  if (existingSlug) return json({ error: "SLUG_UNAVAILABLE", message: "This business slug is unavailable. Choose another." }, 409);
  const rateKey = "register:" + await sha256(email);
  const now = new Date();
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rate = await db.prepare("SELECT window_started_at, request_count FROM email_rate_limits WHERE rate_key=?").bind(rateKey).first();
  if (rate && rate.window_started_at > windowStart && rate.request_count >= 3) return json({ error: "RATE_LIMITED", message: "Too many requests. Try again later." }, 429);
  if (rate) await db.prepare("UPDATE email_rate_limits SET window_started_at=?, request_count=CASE WHEN window_started_at<=? THEN 1 ELSE request_count+1 END WHERE rate_key=?").bind(now.toISOString(), windowStart, rateKey).run();
  else await db.prepare("INSERT INTO email_rate_limits (rate_key, window_started_at, request_count) VALUES (?, ?, 1)").bind(rateKey, now.toISOString()).run();

  const token = randomToken(32);
  const requestId = uuid();
  const expires = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM registration_requests WHERE email=? COLLATE NOCASE").bind(email).run();
  await db.prepare(`INSERT INTO registration_requests (request_id,email,requested_slug,default_language,token_hash,created_at,expires_at,attempts)
    VALUES (?,?,?,?,?,?,?,0)`).bind(requestId, email, slug, language, await sha256(token), now.toISOString(), expires).run();
  const verifyUrl = new URL(localizedPath(uiLanguage, "/verify") + "?token=" + encodeURIComponent(token), request.url).toString();
  // Mark the token as eligible immediately before send to avoid a fast-click race.
  // If sending fails, delete the pending request so the token cannot be used.
  await db.prepare("UPDATE registration_requests SET email_sent_at=?,last_sent_at=? WHERE request_id=?").bind(nowIso(), nowIso(), requestId).run();
  try {
    await sendMail(env, { to: email, subject: "Verify your SBiz account", text: "Open this link to verify your email and set your account password. The link expires in 30 minutes:\n\n" + verifyUrl + "\n\nIf you did not request this, you can ignore this email." });
  } catch {
    await db.prepare("DELETE FROM registration_requests WHERE request_id=?").bind(requestId).run();
    return json({ error: "EMAIL_SEND_FAILED", message: "We could not send the verification email. Your account has not been created. Please try again later." }, 503);
  }
  return json({ ok: true, message: "If the email was accepted for delivery, check your inbox and verify within 30 minutes." }, 202);
}

async function verifyRegistration(request, env) {
  const input = await bodyJson(request);
  const token = String(input?.token || "");
  const password = String(input?.password || "");
  if (token.length < 32 || password.length < 12 || password.length > 256) return json({ error: "INVALID_VERIFICATION", message: "The verification link or password is invalid." }, 400);
  const db = env.SBIZ_APP_DB;
  const tokenHash = await sha256(token);
  const pending = await db.prepare("SELECT * FROM registration_requests WHERE token_hash=?").bind(tokenHash).first();
  if (!pending || !pending.email_sent_at || pending.expires_at <= nowIso()) {
    if (pending) await db.prepare("DELETE FROM registration_requests WHERE request_id=?").bind(pending.request_id).run();
    return json({ error: "VERIFICATION_EXPIRED", message: "This verification link is invalid or expired. Please register again." }, 410);
  }
  const duplicate = await db.prepare("SELECT account_id FROM accounts WHERE email=? COLLATE NOCASE").bind(pending.email).first();
  const slugDuplicate = await db.prepare("SELECT business_id FROM businesses WHERE current_slug=? COLLATE NOCASE").bind(pending.requested_slug).first();
  if (duplicate || slugDuplicate) return json({ error: duplicate ? "EMAIL_ALREADY_USED" : "SLUG_UNAVAILABLE", message: "The registration details are no longer available. Please register again." }, 409);

  const accountId = uuid();
  const timestamp = nowIso();
  const hash = await passwordHash(password);
  const statements = [
    db.prepare("INSERT INTO accounts (account_id,email,password_hash,email_verified_at,status,created_at,updated_at) VALUES (?,?,?,?, 'active',?,?)")
      .bind(accountId, pending.email, hash, timestamp, timestamp, timestamp),
    db.prepare("INSERT INTO businesses (business_id,account_id,current_slug,default_language,created_at,verified_at,status) SELECT 'sbiz-' || printf('%09d', next_value), ?, ?, ?, ?, ?, 'active' FROM business_id_sequence WHERE sequence_name='business' AND next_value<=999999999")
      .bind(accountId, pending.requested_slug, pending.default_language, timestamp, timestamp),
    db.prepare("INSERT INTO business_slug_history (slug_history_id,business_id,slug,valid_from,valid_to,changed_by_account_id,change_source) SELECT ?, business_id, current_slug, created_at, NULL, ?, 'registration' FROM businesses WHERE account_id=? AND created_at=? AND current_slug=?")
      .bind(uuid(), accountId, accountId, timestamp, pending.requested_slug),
    db.prepare("INSERT INTO business_memberships (business_id,account_id,role,created_at) SELECT business_id, ?, 'owner', ? FROM businesses WHERE account_id=? AND created_at=? AND current_slug=?")
      .bind(accountId, timestamp, accountId, timestamp, pending.requested_slug),
    db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,metadata_json) SELECT ?, business_id, 'business_created', ?, ?, ? FROM businesses WHERE account_id=? AND created_at=? AND current_slug=?")
      .bind(uuid(), timestamp, accountId, JSON.stringify({ source: "email_verification", language: pending.default_language }), accountId, timestamp, pending.requested_slug),
    db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,metadata_json) SELECT ?, business_id, 'email_verified', ?, ?, ? FROM businesses WHERE account_id=? AND created_at=? AND current_slug=?")
      .bind(uuid(), timestamp, accountId, JSON.stringify({ email: pending.email }), accountId, timestamp, pending.requested_slug),
    db.prepare("UPDATE business_id_sequence SET next_value=next_value+1 WHERE sequence_name='business' AND EXISTS (SELECT 1 FROM businesses WHERE account_id=? AND created_at=? AND current_slug=?)")
      .bind(accountId, timestamp, pending.requested_slug),
    db.prepare("DELETE FROM registration_requests WHERE request_id=?").bind(pending.request_id)
  ];
  try {
    await db.batch(statements);
  } catch {
    const sequence = await db.prepare("SELECT next_value FROM business_id_sequence WHERE sequence_name='business'").first();
    if (sequence && sequence.next_value > 999999999) return json({ error: "BUSINESS_ID_CAPACITY_REACHED" }, 503);
    return json({ error: "ACCOUNT_CREATION_FAILED", message: "Email verification succeeded, but account creation could not be completed. Please retry this link if it has not expired." }, 503);
  }
  const createdBusiness = await db.prepare("SELECT business_id FROM businesses WHERE account_id=? AND created_at=? AND current_slug=?").bind(accountId, timestamp, pending.requested_slug).first();
  if (!createdBusiness) return json({ error: "ACCOUNT_CREATION_FAILED", message: "The account could not be confirmed. Please contact support if this continues." }, 503);
  return json({ ok: true, business_id: createdBusiness.business_id, message: "Email verified and account created. You can now log in." }, 201);
}

async function login(request, env) {
  const input = await bodyJson(request);
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || "");
  if (!validEmail(email) || !password) return json({ error: "INVALID_CREDENTIALS", message: "Email or password is incorrect." }, 400);
  const db = env.SBIZ_APP_DB;
  const account = await db.prepare("SELECT account_id,email,password_hash,email_verified_at,status FROM accounts WHERE email=? COLLATE NOCASE").bind(email).first();
  const valid = account && account.status === "active" && account.email_verified_at && await verifyPassword(password, account.password_hash);
  if (!valid) return json({ error: "INVALID_CREDENTIALS", message: "Email or password is incorrect." }, 401);
  const token = await createSession(db, account.account_id);
  return json({ ok: true, message: "Login successful." }, 200, { "set-cookie": sessionCookie(token) });
}

async function forgotPassword(request, env) {
  const input = await bodyJson(request);
  const email = normalizeEmail(input?.email);
  const requestedUiLanguage = String(input?.uiLanguage || "en");
  const uiLanguage = ["en", "vi", "id", "es", "pt"].includes(requestedUiLanguage) ? requestedUiLanguage : "en";
  const neutral = { ok: true, message: "If an eligible account exists for that email, a password reset link will be sent." };
  if (!validEmail(email)) return json(neutral, 200);
  const db = env.SBIZ_APP_DB;
  const account = await db.prepare("SELECT account_id,email FROM accounts WHERE email=? COLLATE NOCASE AND status='active' AND email_verified_at IS NOT NULL").bind(email).first();
  if (!account) return json(neutral);
  const rateKey = "reset:" + await sha256(email);
  const now = new Date();
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rate = await db.prepare("SELECT window_started_at,request_count FROM email_rate_limits WHERE rate_key=?").bind(rateKey).first();
  if (rate && rate.window_started_at > windowStart && rate.request_count >= 3) return json(neutral);
  if (rate) await db.prepare("UPDATE email_rate_limits SET window_started_at=?,request_count=CASE WHEN window_started_at<=? THEN 1 ELSE request_count+1 END WHERE rate_key=?").bind(now.toISOString(), windowStart, rateKey).run();
  else await db.prepare("INSERT INTO email_rate_limits (rate_key,window_started_at,request_count) VALUES (?,?,1)").bind(rateKey, now.toISOString()).run();
  const token = randomToken(32);
  const resetId = uuid();
  const expires = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  await db.prepare("UPDATE password_reset_tokens SET used_at=? WHERE account_id=? AND used_at IS NULL").bind(now.toISOString(), account.account_id).run();
  await db.prepare("INSERT INTO password_reset_tokens (reset_id,account_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)").bind(resetId, account.account_id, await sha256(token), now.toISOString(), expires).run();
  const resetUrl = new URL(localizedPath(uiLanguage, "/reset-password") + "?token=" + encodeURIComponent(token), request.url).toString();
  try {
    await sendMail(env, { to: account.email, subject: "Reset your SBiz password", text: "Open this link to reset your SBiz password. It expires in 30 minutes and can be used once:\n\n" + resetUrl + "\n\nIf you did not request this, ignore this email." });
  } catch {
    await db.prepare("UPDATE password_reset_tokens SET used_at=? WHERE reset_id=?").bind(nowIso(), resetId).run();
  }
  return json(neutral);
}

async function resetPassword(request, env) {
  const input = await bodyJson(request);
  const token = String(input?.token || "");
  const password = String(input?.password || "");
  if (token.length < 32 || password.length < 12 || password.length > 256) return json({ error: "INVALID_RESET", message: "The reset link or password is invalid." }, 400);
  const db = env.SBIZ_APP_DB;
  const row = await db.prepare("SELECT * FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?").bind(await sha256(token), nowIso()).first();
  if (!row) return json({ error: "RESET_EXPIRED", message: "This reset link is invalid or expired. Request a new link." }, 410);
  const hash = await passwordHash(password);
  const now = nowIso();
  const usedAt = uniqueTimestamp();
  try {
    await db.batch([
      db.prepare("UPDATE password_reset_tokens SET used_at=? WHERE reset_id=? AND used_at IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM accounts WHERE account_id=?)")
        .bind(usedAt, row.reset_id, now, row.account_id),
      db.prepare("UPDATE accounts SET password_hash=?,updated_at=? WHERE account_id=? AND EXISTS (SELECT 1 FROM password_reset_tokens WHERE reset_id=? AND used_at=?)")
        .bind(hash, now, row.account_id, row.reset_id, usedAt),
      db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM password_reset_tokens WHERE reset_id=? AND used_at=?)")
        .bind(now, row.account_id, row.reset_id, usedAt)
    ]);
  } catch {
    return json({ error: "RESET_FAILED", message: "The password could not be reset. Request a new link if this continues." }, 503);
  }
  const updated = await db.prepare("SELECT password_hash FROM accounts WHERE account_id=?").bind(row.account_id).first();
  if (!updated || updated.password_hash !== hash) return json({ error: "RESET_EXPIRED", message: "This reset link has already been used or expired." }, 410);
  return json({ ok: true, message: "Password reset. Please log in with your new password." });
}

async function logout(request, env) {
  const token = cookieValue(request, "sbiz_session");
  if (token) await env.SBIZ_APP_DB.prepare("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(nowIso(), await sha256(token)).run();
  const requestedLanguage = new URL(request.url).searchParams.get("lang") || "en";
  const language = ["en", "vi", "id", "es", "pt"].includes(requestedLanguage) ? requestedLanguage : "en";
  return new Response(null, { status: 302, headers: { location: localizedPath(language, "/login"), "set-cookie": clearSessionCookie(), "cache-control": "no-store" } });
}

async function me(request, env) {
  const account = await currentAccount(request, env);
  if (!account) return json({ authenticated: false }, 401);
  const businesses = await env.SBIZ_APP_DB.prepare("SELECT b.business_id,b.current_slug,b.default_language,b.created_at,b.verified_at,b.status,b.verification_status,b.admin_verified_at,b.subscription_started_at,b.subscription_expires_at,b.data_deleted_at FROM businesses b JOIN business_memberships m ON m.business_id=b.business_id WHERE m.account_id=? ORDER BY b.created_at").bind(account.account_id).all();
  return json({ authenticated: true, email: account.email, businesses: businesses.results || [] });
}

async function updateBusinessSlug(request, env, businessId) {
  const account = await currentAccount(request, env);
  if (!account) return json({ error: "UNAUTHENTICATED" }, 401);
  const input = await bodyJson(request);
  const slug = normalizeSlug(input?.slug);
  if (!validChangedSlug(slug)) return json({ error: "INVALID_SLUG" }, 400);
  const db = env.SBIZ_APP_DB;
  const business = await db.prepare("SELECT * FROM businesses WHERE business_id=?").bind(businessId).first();
  if (!business) return json({ error: "NOT_FOUND" }, 404);
  const membership = await db.prepare("SELECT role FROM business_memberships WHERE business_id=? AND account_id=?").bind(businessId, account.account_id).first();
  const access = slug.length <= 12 ? await verifyCloudflareAccess(request, env) : null;
  const admin = Boolean(access?.ok);
  if (!membership && !admin) return json({ error: "FORBIDDEN" }, 403);
  if (slug.length <= 12 && !admin) return json({ error: "ADMIN_REQUIRED_FOR_SHORT_SLUG" }, 403);
  const conflict = await db.prepare("SELECT business_id FROM businesses WHERE current_slug=? COLLATE NOCASE AND business_id<>?").bind(slug, businessId).first();
  if (conflict) return json({ error: "SLUG_UNAVAILABLE" }, 409);
  const now = nowIso();
  const changeSource = admin ? "admin" : "owner";
  await db.batch([
    db.prepare("UPDATE businesses SET current_slug=? WHERE business_id=?").bind(slug, businessId),
    db.prepare("UPDATE business_slug_history SET valid_to=? WHERE business_id=? AND valid_to IS NULL").bind(now, businessId),
    db.prepare("INSERT INTO business_slug_history (slug_history_id,business_id,slug,valid_from,valid_to,changed_by_account_id,change_source) VALUES (?,?,?,?,NULL,?,?)")
      .bind(uuid(), businessId, slug, now, account.account_id, changeSource),
    db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) VALUES (?,?, 'slug_changed',?,?,?,?,?)")
      .bind(uuid(), businessId, now, account.account_id, business.current_slug, slug, JSON.stringify({ changeSource }))
  ]);
  return json({ ok: true, business_id: businessId, slug });
}

async function updateBusinessLanguage(request, env, businessId) {
  const account = await currentAccount(request, env);
  if (!account) return json({ error: "UNAUTHENTICATED" }, 401);
  const input = await bodyJson(request);
  const language = String(input?.defaultLanguage || "");
  if (!LANGUAGES.has(language)) return json({ error: "INVALID_LANGUAGE" }, 400);
  const db = env.SBIZ_APP_DB;
  const business = await db.prepare("SELECT business_id,default_language FROM businesses WHERE business_id=?").bind(businessId).first();
  if (!business) return json({ error: "NOT_FOUND" }, 404);
  const membership = await db.prepare("SELECT role FROM business_memberships WHERE business_id=? AND account_id=?").bind(businessId, account.account_id).first();
  if (!membership || membership.role !== "owner") return json({ error: "OWNER_REQUIRED" }, 403);
  if (business.default_language === language) return json({ ok: true, business_id: businessId, default_language: language, unchanged: true });
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE businesses SET default_language=? WHERE business_id=?").bind(language, businessId),
    db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) VALUES (?,?, 'primary_language_changed',?,?,?,?,?)")
      .bind(uuid(), businessId, now, account.account_id, business.default_language, language, JSON.stringify({ source: "owner_settings" }))
  ]);
  return json({ ok: true, business_id: businessId, default_language: language });
}

async function requestEmailChange(request, env, businessId) {
  const account = await currentAccount(request, env);
  if (!account) return json({ error: "UNAUTHENTICATED" }, 401);
  const input = await bodyJson(request);
  const newEmail = normalizeEmail(input?.newEmail);
  const requestedUiLanguage = String(input?.uiLanguage || "en");
  const uiLanguage = ["en", "vi", "id", "es", "pt"].includes(requestedUiLanguage) ? requestedUiLanguage : "en";
  if (!validEmail(newEmail)) return json({ error: "INVALID_EMAIL" }, 400);
  if (newEmail === normalizeEmail(account.email)) return json({ error: "EMAIL_UNCHANGED" }, 400);
  const db = env.SBIZ_APP_DB;
  const membership = await db.prepare("SELECT role FROM business_memberships WHERE business_id=? AND account_id=?").bind(businessId, account.account_id).first();
  const access = await verifyCloudflareAccess(request, env);
  if (!membership && !access.ok) return json({ error: "FORBIDDEN" }, 403);
  const existing = await db.prepare("SELECT account_id FROM accounts WHERE email=? COLLATE NOCASE AND account_id<>?").bind(newEmail, account.account_id).first();
  if (existing) return json({ error: "EMAIL_ALREADY_USED", message: "This email is already in use." }, 409);
  const token = randomToken(32);
  const changeId = uuid();
  const now = new Date();
  const created = now.toISOString();
  const expires = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM email_change_requests WHERE account_id=? AND business_id=?").bind(account.account_id, businessId).run();
  await db.prepare("INSERT INTO email_change_requests (change_id,account_id,business_id,new_email,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)")
    .bind(changeId, account.account_id, businessId, newEmail, await sha256(token), created, expires).run();
  const confirmUrl = new URL(localizedPath(uiLanguage, "/change-email") + "?token=" + encodeURIComponent(token), request.url).toString();
  try {
    await sendMail(env, { to: newEmail, subject: "Confirm your new SBiz email", text: "Confirm this email address for your SBiz account within 30 minutes:\n\n" + confirmUrl + "\n\nIf you did not request this, ignore this email." });
  } catch {
    await db.prepare("DELETE FROM email_change_requests WHERE change_id=?").bind(changeId).run();
    return json({ error: "EMAIL_SEND_FAILED", message: "We could not send the confirmation email. Your email has not changed." }, 503);
  }
  await event(db, businessId, "email_change_requested", account.account_id, account.email, newEmail);
  return json({ ok: true, message: "Check the new email address to confirm the change within 30 minutes." }, 202);
}

async function confirmEmailChange(request, env) {
  const input = await bodyJson(request);
  const token = String(input?.token || "");
  if (token.length < 32) return json({ error: "INVALID_TOKEN" }, 400);
  const db = env.SBIZ_APP_DB;
  const now = nowIso();
  const row = await db.prepare("SELECT * FROM email_change_requests WHERE token_hash=? AND used_at IS NULL AND expires_at>?").bind(await sha256(token), now).first();
  if (!row) return json({ error: "TOKEN_EXPIRED", message: "This email confirmation link is invalid or expired." }, 410);
  const existing = await db.prepare("SELECT account_id FROM accounts WHERE email=? COLLATE NOCASE AND account_id<>?").bind(row.new_email, row.account_id).first();
  if (existing) return json({ error: "EMAIL_ALREADY_USED", message: "This email is already in use." }, 409);
  const account = await db.prepare("SELECT email FROM accounts WHERE account_id=?").bind(row.account_id).first();
  if (!account) return json({ error: "ACCOUNT_NOT_FOUND" }, 404);
  const usedAt = uniqueTimestamp();
  const statements = [
    db.prepare("UPDATE accounts SET email=?,email_verified_at=?,updated_at=? WHERE account_id=? AND EXISTS (SELECT 1 FROM email_change_requests WHERE change_id=? AND used_at IS NULL AND expires_at>?)")
      .bind(row.new_email, now, now, row.account_id, row.change_id, now),
    db.prepare("UPDATE email_change_requests SET used_at=? WHERE change_id=? AND used_at IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM accounts WHERE account_id=? AND email=?)")
      .bind(usedAt, row.change_id, now, row.account_id, row.new_email),
    db.prepare("UPDATE email_change_requests SET used_at=? WHERE account_id=? AND change_id<>? AND used_at IS NULL AND EXISTS (SELECT 1 FROM email_change_requests WHERE change_id=? AND used_at=?)")
      .bind(now, row.account_id, row.change_id, row.change_id, usedAt)
  ];
  const memberships = await db.prepare("SELECT business_id FROM business_memberships WHERE account_id=?").bind(row.account_id).all();
  for (const membership of memberships.results || []) {
    statements.push(db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value) SELECT ?, ?, 'email_changed', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM email_change_requests WHERE change_id=? AND used_at=?)")
      .bind(uuid(), membership.business_id, now, row.account_id, account.email, row.new_email, row.change_id, usedAt));
  }
  try {
    await db.batch(statements);
  } catch {
    return json({ error: "EMAIL_CHANGE_FAILED", message: "The email could not be changed. Please request a new confirmation link." }, 503);
  }
  const result = await db.prepare("SELECT a.email,r.used_at FROM accounts a JOIN email_change_requests r ON r.account_id=a.account_id WHERE a.account_id=? AND r.change_id=?")
    .bind(row.account_id, row.change_id).first();
  if (!result || result.email !== row.new_email || result.used_at !== usedAt) {
    return json({ error: "TOKEN_EXPIRED", message: "This email confirmation link has already been used or expired." }, 410);
  }
  return json({ ok: true, message: "Email updated. Use the new email for future logins." });
}
async function adminBusinessList(request, env) {
  const accessEmail = request.headers.get("x-sbiz-verified-access-email");
  if (!accessEmail) return json({ error: "CLOUDFLARE_ACCESS_REQUIRED" }, 401);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50)));
  const result = await env.SBIZ_APP_DB.prepare(
    "SELECT b.business_id,b.current_slug,a.email,b.account_id,b.default_language,b.created_at,b.verified_at,b.registration_document_url,b.verification_status,b.admin_verified_at,b.status FROM businesses b JOIN accounts a ON a.account_id=b.account_id ORDER BY b.created_at DESC LIMIT ?"
  ).bind(limit).all();
  return json({ businesses: result.results || [] });
}

async function adminBusiness(request, env, businessId) {
  const accessEmail = request.headers.get("x-sbiz-verified-access-email");
  if (!accessEmail) return json({ error: "CLOUDFLARE_ACCESS_REQUIRED" }, 401);
  const db = env.SBIZ_APP_DB;
  if (request.method === "GET") {
    const business = await db.prepare("SELECT b.business_id,b.current_slug,a.email,b.account_id,b.default_language,b.created_at,b.verified_at,b.subscription_started_at,b.subscription_expires_at,b.data_deleted_at,b.registration_document_url,b.verification_status,b.admin_verified_at,b.status FROM businesses b JOIN accounts a ON a.account_id=b.account_id WHERE b.business_id=?").bind(businessId).first();
    if (!business) return json({ error: "NOT_FOUND" }, 404);
    const history = await db.prepare("SELECT event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json FROM business_events WHERE business_id=? ORDER BY occurred_at DESC LIMIT 200").bind(businessId).all();
    const slugHistory = await db.prepare("SELECT slug,valid_from,valid_to,changed_by_account_id,change_source FROM business_slug_history WHERE business_id=? ORDER BY valid_from DESC LIMIT 100").bind(businessId).all();
    const subscriptions = await db.prepare("SELECT provider,provider_reference,plan_code,term_years,amount_minor_units,currency,status,purchased_at,starts_at,expires_at,ended_at,created_at,updated_at FROM business_subscription_history WHERE business_id=? ORDER BY created_at DESC LIMIT 100").bind(businessId).all();
    const domains = await db.prepare("SELECT domain_id,hostname,status,verified_at,provider_status,ssl_status,last_provider_check_at,error_code,created_at,updated_at,removed_at FROM business_custom_domains WHERE business_id=? ORDER BY created_at DESC LIMIT 100").bind(businessId).all();
    return json({ business, history: history.results || [], slug_history: slugHistory.results || [], subscriptions: subscriptions.results || [], domains: domains.results || [] });
  }
  if (request.method === "PATCH") {
    const input = await bodyJson(request);
    const rawUrl = String(input?.registrationDocumentUrl || "").trim();
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return json({ error: "INVALID_DOCUMENT_URL" }, 400); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || rawUrl.length > 2048) return json({ error: "INVALID_DOCUMENT_URL", message: "Provide a valid HTTPS document link." }, 400);
    const old = await db.prepare("SELECT registration_document_url,verification_status FROM businesses WHERE business_id=?").bind(businessId).first();
    if (!old) return json({ error: "NOT_FOUND" }, 404);
    const now = nowIso();
    await db.batch([
      db.prepare("UPDATE businesses SET registration_document_url=?,verification_status='verified',admin_verified_at=? WHERE business_id=?").bind(rawUrl, now, businessId),
      db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) VALUES (?,?, 'registration_document_link_updated',?,?,?,?,?)").bind(uuid(), businessId, now, null, old.registration_document_url, rawUrl, JSON.stringify({ actorEmail: accessEmail })),
      db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) VALUES (?,?, 'business_verification_approved',?,?,?,? ,?)").bind(uuid(), businessId, now, null, old.verification_status, "verified", JSON.stringify({ documentUrl: rawUrl, accessEmail }))
    ]);
    return json({ ok: true, business_id: businessId, registration_document_url: rawUrl, verification_status: "verified", admin_verified_at: now });
  }
  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}


function normalizeCustomHostname(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!raw || raw.length > 253 || /[\s/@?#:]/.test(raw)) return null;
  let parsed;
  try { parsed = new URL("https://" + raw); } catch { return null; }
  if (parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname.includes(".") || hostname === "sbiz.app" || hostname.endsWith(".sbiz.app")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return null;
  const labels = hostname.split(".");
  if (labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels[labels.length - 1])) return null;
  return hostname;
}

async function requireBusinessOwner(request, env, businessId) {
  const account = await currentAccount(request, env);
  if (!account) return { response: json({ error: "UNAUTHENTICATED" }, 401) };
  const business = await env.SBIZ_APP_DB.prepare("SELECT business_id FROM businesses WHERE business_id=?").bind(businessId).first();
  if (!business) return { response: json({ error: "NOT_FOUND" }, 404) };
  const membership = await env.SBIZ_APP_DB.prepare("SELECT role FROM business_memberships WHERE business_id=? AND account_id=?")
    .bind(businessId, account.account_id).first();
  if (!membership || membership.role !== "owner") return { response: json({ error: "OWNER_REQUIRED" }, 403) };
  return { account };
}

async function listBusinessCustomDomains(request, env, businessId) {
  const access = await requireBusinessOwner(request, env, businessId);
  if (access.response) return access.response;
  const result = await env.SBIZ_APP_DB.prepare(
    "SELECT domain_id,business_id,hostname,status,verified_at,provider_status,ssl_status,last_provider_check_at,error_code,created_at,updated_at,removed_at FROM business_custom_domains WHERE business_id=? ORDER BY created_at DESC LIMIT 50"
  ).bind(businessId).all();
  return json({ domains: (result.results || []).map(row => ({ ...row, dns_record_name: "_sbiz-verification." + row.hostname })) });
}

async function createBusinessCustomDomain(request, env, businessId) {
  const access = await requireBusinessOwner(request, env, businessId);
  if (access.response) return access.response;
  const input = await bodyJson(request);
  const hostname = normalizeCustomHostname(input?.hostname);
  if (!hostname) return json({ error: "INVALID_HOSTNAME", message: "Enter a valid public hostname, without a protocol or path. SBiz hostnames cannot be used as custom domains." }, 400);
  const db = env.SBIZ_APP_DB;
  const existing = await db.prepare("SELECT domain_id,status FROM business_custom_domains WHERE hostname=? COLLATE NOCASE AND status<>'removed'").bind(hostname).first();
  if (existing) return json({ error: existing.status === "active" ? "HOSTNAME_ALREADY_ACTIVE" : "HOSTNAME_ALREADY_RESERVED", message: "This hostname is already linked or has a pending request." }, 409);
  const token = randomToken(32);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const domainId = uuid();
  try {
    await db.batch([
      db.prepare("INSERT INTO business_custom_domains (domain_id,business_id,hostname,status,verification_token_hash,verification_created_at,verification_expires_at,created_at,updated_at) VALUES (?,?,?,'pending_dns',?,?,?,?,?)")
        .bind(domainId, businessId, hostname, await sha256(token), createdAt, expiresAt, createdAt, createdAt),
      db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) VALUES (?,?, 'custom_domain_requested',?,?,?,?,?)")
        .bind(uuid(), businessId, createdAt, access.account.account_id, null, hostname, JSON.stringify({ domainId, verificationExpiresAt: expiresAt }))
    ]);
  } catch {
    const raced = await db.prepare("SELECT domain_id FROM business_custom_domains WHERE hostname=? COLLATE NOCASE AND status<>'removed'").bind(hostname).first();
    if (raced) return json({ error: "HOSTNAME_ALREADY_RESERVED", message: "This hostname is already linked or has a pending request." }, 409);
    return json({ error: "CUSTOM_DOMAIN_REQUEST_FAILED", message: "The custom domain request could not be saved. Please retry." }, 503);
  }
  return json({
    ok: true,
    domain_id: domainId,
    hostname,
    status: "pending_dns",
    verification_expires_at: expiresAt,
    dns: { type: "TXT", name: "_sbiz-verification." + hostname, value: "sbiz-domain-verification=" + token },
    message: "Add the TXT record shown here, then verify the hostname. The challenge expires in 24 hours."
  }, 201);
}

function customHostnameState(providerResult) {
  const providerStatus = String(providerResult?.status || "unknown").toLowerCase();
  const sslStatus = String(providerResult?.ssl?.status || "unknown").toLowerCase();
  if (providerStatus === "active" && sslStatus === "active") return "active";
  if (["pending_validation", "pending_issuance", "pending_deployment"].includes(providerStatus)) return providerStatus;
  if (["pending_validation", "pending_issuance", "pending_deployment"].includes(sslStatus)) {
    if (sslStatus === "pending_validation") return "pending_validation";
    if (sslStatus === "pending_issuance") return "pending_issuance";
    return "pending_deployment";
  }
  return "error";
}

async function cloudflareCustomHostname(env, method, hostname, providerId) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) return { configured: false };
  const base = "https://api.cloudflare.com/client/v4/zones/" + encodeURIComponent(zoneId) + "/custom_hostnames";
  const endpoint = providerId ? base + "/" + encodeURIComponent(providerId) : base;
  const init = { method, headers: { authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json" } };
  if (method === "POST") init.body = JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } });
  let response;
  try { response = await fetch(endpoint, init); }
  catch { return { configured: true, ok: false, errorCode: "CLOUDFLARE_API_UNREACHABLE" }; }
  const payload = await response.json().catch(() => null);
  if (method === "DELETE" && response.status === 404) return { configured: true, ok: true, removed: true };
  if (!response.ok || !payload?.success || (method !== "DELETE" && !payload.result)) {
    return { configured: true, ok: false, errorCode: "CLOUDFLARE_API_ERROR", providerHttpStatus: response.status };
  }
  return { configured: true, ok: true, result: payload.result, removed: method === "DELETE" };
}

async function verifyBusinessCustomDomain(request, env, businessId, domainId) {
  const access = await requireBusinessOwner(request, env, businessId);
  if (access.response) return access.response;
  const db = env.SBIZ_APP_DB;
  const domain = await db.prepare("SELECT * FROM business_custom_domains WHERE domain_id=? AND business_id=? AND status<>'removed'")
    .bind(domainId, businessId).first();
  if (!domain) return json({ error: "NOT_FOUND" }, 404);
  const now = nowIso();
  if (!domain.verified_at) {
    if (domain.verification_expires_at <= now) return json({ error: "DNS_CHALLENGE_EXPIRED", message: "The DNS challenge expired. Remove this request and create a new one." }, 410);
    let dnsResponse;
    try {
      dnsResponse = await fetch("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent("_sbiz-verification." + domain.hostname) + "&type=TXT", {
        headers: { accept: "application/dns-json" },
        cf: { cacheTtl: 0, cacheEverything: false }
      });
    } catch {
      return json({ error: "DNS_LOOKUP_UNAVAILABLE", message: "DNS verification is temporarily unavailable. Please retry." }, 503);
    }
    if (!dnsResponse.ok) return json({ error: "DNS_LOOKUP_UNAVAILABLE", message: "DNS verification is temporarily unavailable. Please retry." }, 503);
    const dns = await dnsResponse.json().catch(() => null);
    const answers = Array.isArray(dns?.Answer) ? dns.Answer.filter(answer => Number(answer.type) === 16) : [];
    let verified = false;
    for (const answer of answers) {
      const value = String(answer.data || "").replace(/^"|"$/g, "").replace(/"\s*"/g, "");
      const prefix = "sbiz-domain-verification=";
      if (value.startsWith(prefix) && await sha256(value.slice(prefix.length)) === domain.verification_token_hash) verified = true;
    }
    if (!verified) return json({ error: "DNS_CHALLENGE_NOT_FOUND", message: "The required TXT record was not found yet. Check the record name and value, then retry." }, 409);
    await db.batch([
      db.prepare("UPDATE business_custom_domains SET verified_at=?,status='pending_provider',error_code=NULL,updated_at=? WHERE domain_id=? AND verified_at IS NULL AND verification_expires_at>?")
        .bind(now, now, domainId, now),
      db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) SELECT ?, ?, 'custom_domain_dns_verified', ?, ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM business_custom_domains WHERE domain_id=? AND business_id=? AND verified_at=?) AND NOT EXISTS (SELECT 1 FROM business_events WHERE business_id=? AND event_type='custom_domain_dns_verified' AND metadata_json LIKE ?)")
        .bind(uuid(), businessId, now, access.account.account_id, domain.hostname, JSON.stringify({ domainId }), domainId, businessId, now, businessId, "%" + domainId + "%")
    ]);
  }

  const refreshed = await db.prepare("SELECT * FROM business_custom_domains WHERE domain_id=? AND business_id=?").bind(domainId, businessId).first();
  if (!refreshed?.verified_at) return json({ error: "DNS_CHALLENGE_EXPIRED", message: "The DNS challenge expired before verification could be saved. Create a new request." }, 410);
  if (!refreshed.provider_hostname_id) {
    const provision = await cloudflareCustomHostname(env, "POST", refreshed.hostname, null);
    if (!provision.configured) return json({ error: "CUSTOM_DOMAIN_PROVIDER_NOT_CONFIGURED", message: "DNS ownership is verified, but Cloudflare for SaaS API credentials are not configured." }, 503);
    if (!provision.ok) {
      await db.prepare("UPDATE business_custom_domains SET status='error',error_code=?,updated_at=? WHERE domain_id=?")
        .bind(provision.errorCode, nowIso(), domainId).run();
      return json({ error: provision.errorCode, message: "Cloudflare for SaaS could not provision this hostname. Retry after checking the provider configuration." }, 503);
    }
    const result = provision.result;
    if (!result?.id) return json({ error: "CLOUDFLARE_INVALID_RESPONSE", message: "Cloudflare did not return a hostname identifier; the hostname was not marked active." }, 503);
    const state = customHostnameState(result);
    const checkedAt = nowIso();
    await db.batch([
      db.prepare("UPDATE business_custom_domains SET provider_hostname_id=?,provider_status=?,ssl_status=?,status=?,last_provider_check_at=?,error_code=?,updated_at=? WHERE domain_id=?")
        .bind(result.id, result.status || null, result.ssl?.status || null, state, checkedAt, state === "error" ? "CLOUDFLARE_HOSTNAME_NOT_ACTIVE" : null, checkedAt, domainId),
      db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) SELECT ?, ?, ?, ?, ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM business_custom_domains WHERE domain_id=? AND provider_hostname_id=? AND status=?)")
        .bind(uuid(), businessId, state === "active" ? "custom_domain_activated" : "custom_domain_provider_created", checkedAt, access.account.account_id, refreshed.hostname, JSON.stringify({ domainId, providerStatus: result.status || null, sslStatus: result.ssl?.status || null }), domainId, result.id, state)
    ]);
    return json({ ok: true, domain_id: domainId, hostname: refreshed.hostname, status: state, provider_status: result.status || null, ssl_status: result.ssl?.status || null }, state === "active" ? 200 : 202);
  }

  const check = await cloudflareCustomHostname(env, "GET", refreshed.hostname, refreshed.provider_hostname_id);
  if (!check.configured) return json({ error: "CUSTOM_DOMAIN_PROVIDER_NOT_CONFIGURED", message: "Cloudflare for SaaS API credentials are not configured." }, 503);
  if (!check.ok) return json({ error: check.errorCode, message: "Cloudflare for SaaS status could not be checked. Retry later." }, 503);
  const result = check.result;
  const state = customHostnameState(result);
  const checkedAt = nowIso();
  const refreshStatements = [
    db.prepare("UPDATE business_custom_domains SET provider_status=?,ssl_status=?,status=?,last_provider_check_at=?,error_code=?,updated_at=? WHERE domain_id=?")
      .bind(result.status || null, result.ssl?.status || null, state, checkedAt, state === "error" ? "CLOUDFLARE_HOSTNAME_NOT_ACTIVE" : null, checkedAt, domainId)
  ];
  if (state === "active" && refreshed.status !== "active") {
    refreshStatements.push(db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) VALUES (?, ?, 'custom_domain_activated', ?, ?, ?, ?, ?)")
      .bind(uuid(), businessId, checkedAt, access.account.account_id, refreshed.status, refreshed.hostname, JSON.stringify({ domainId, providerStatus: result.status || null, sslStatus: result.ssl?.status || null })));
  }
  await db.batch(refreshStatements);
  return json({ ok: true, domain_id: domainId, hostname: refreshed.hostname, status: state, provider_status: result.status || null, ssl_status: result.ssl?.status || null }, state === "active" ? 200 : 202);
}

async function removeBusinessCustomDomain(request, env, businessId, domainId) {
  const access = await requireBusinessOwner(request, env, businessId);
  if (access.response) return access.response;
  const db = env.SBIZ_APP_DB;
  const domain = await db.prepare("SELECT * FROM business_custom_domains WHERE domain_id=? AND business_id=? AND status<>'removed'")
    .bind(domainId, businessId).first();
  if (!domain) return json({ error: "NOT_FOUND" }, 404);
  const now = nowIso();
  if (domain.provider_hostname_id) {
    await db.prepare("UPDATE business_custom_domains SET status='removing',updated_at=? WHERE domain_id=?").bind(now, domainId).run();
    const result = await cloudflareCustomHostname(env, "DELETE", domain.hostname, domain.provider_hostname_id);
    if (!result.configured) return json({ error: "CUSTOM_DOMAIN_PROVIDER_NOT_CONFIGURED", message: "The provider hostname exists, but Cloudflare for SaaS API credentials are not configured. The domain remains in removing state." }, 503);
    if (!result.ok) {
      await db.prepare("UPDATE business_custom_domains SET status='error',error_code=?,updated_at=? WHERE domain_id=?")
        .bind(result.errorCode, nowIso(), domainId).run();
      return json({ error: result.errorCode, message: "Cloudflare for SaaS could not remove this hostname. Retry after checking the provider configuration." }, 503);
    }
  }
  const removedAt = nowIso();
  await db.batch([
    db.prepare("UPDATE business_custom_domains SET status='removed',removed_at=?,updated_at=?,error_code=NULL WHERE domain_id=?")
      .bind(removedAt, removedAt, domainId),
    db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) VALUES (?, ?, 'custom_domain_removed', ?, ?, ?, NULL, ?)")
      .bind(uuid(), businessId, removedAt, access.account.account_id, domain.hostname, JSON.stringify({ domainId, providerHostnameId: domain.provider_hostname_id || null }))
  ]);
  return json({ ok: true, domain_id: domainId, hostname: domain.hostname, status: "removed" });
}

async function routeMod01(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const backgroundAssets = {
    "/assets/background-light.jpg": "assets/background-light.jpg",
    "/assets/background-dark.jpg": "assets/background-dark.jpg",
  };
  if (Object.hasOwn(backgroundAssets, path)) {
    if (!env.SBIZ_APP_R2) return json({ error: "ASSET_STORAGE_UNAVAILABLE" }, 503);
    const object = await env.SBIZ_APP_R2.get(backgroundAssets[path]);
    if (!object) return json({ error: "ASSET_NOT_FOUND" }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", "image/jpeg");
    headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  }
  const pageResponse = pageForPath(path, url);
  if (pageResponse) return pageResponse;
  if (path === "/api/v1/register" && request.method === "POST") return register(request, env);
  if (path === "/api/v1/register/verify" && request.method === "POST") return verifyRegistration(request, env);
  if (path === "/api/v1/login" && request.method === "POST") return login(request, env);
  if (path === "/api/v1/email/confirm" && request.method === "POST") return confirmEmailChange(request, env);
  const emailChangeMatch = path.match(/^\/api\/v1\/businesses\/(sbiz-\d{9})\/email$/);
  if (emailChangeMatch && request.method === "POST") return requestEmailChange(request, env, emailChangeMatch[1]);
  if (path === "/api/v1/password/forgot" && request.method === "POST") return forgotPassword(request, env);
  if (path === "/api/v1/password/reset" && request.method === "POST") return resetPassword(request, env);
  if (path === "/api/v1/logout" && request.method === "GET") return logout(request, env);
  if (path === "/api/v1/me" && request.method === "GET") return me(request, env);
  const domainsMatch = path.match(/^\/api\/v1\/businesses\/(sbiz-\d{9})\/domains$/);
  if (domainsMatch && request.method === "GET") return listBusinessCustomDomains(request, env, domainsMatch[1]);
  if (domainsMatch && request.method === "POST") return createBusinessCustomDomain(request, env, domainsMatch[1]);
  const domainActionMatch = path.match(/^\/api\/v1\/businesses\/(sbiz-\d{9})\/domains\/([0-9a-f-]{36})(?:\/(verify))?$/i);
  if (domainActionMatch && domainActionMatch[3] === "verify" && request.method === "POST") return verifyBusinessCustomDomain(request, env, domainActionMatch[1], domainActionMatch[2]);
  if (domainActionMatch && !domainActionMatch[3] && request.method === "DELETE") return removeBusinessCustomDomain(request, env, domainActionMatch[1], domainActionMatch[2]);
  const slugMatch = path.match(/^\/api\/v1\/businesses\/(sbiz-\d{9})\/slug$/);
  if (slugMatch && request.method === "PATCH") return updateBusinessSlug(request, env, slugMatch[1]);
  const languageMatch = path.match(/^\/api\/v1\/businesses\/(sbiz-\d{9})\/language$/);
  if (languageMatch && request.method === "PATCH") return updateBusinessLanguage(request, env, languageMatch[1]);
  if (path === "/api/v1/admin/businesses" && request.method === "GET") return adminBusinessList(request, env);
  const adminMatch = path.match(/^\/api\/v1\/admin\/businesses\/(sbiz-\d{9})$/);
  if (adminMatch && ["GET", "PATCH"].includes(request.method)) return adminBusiness(request, env, adminMatch[1]);
  if (path.startsWith("/api/v1/")) return json({ error: "NOT_FOUND" }, 404);
  return null;
}
/* [MOD01][BACKEND][END] */

async function cleanupMod01(env) {
  const db = env.SBIZ_APP_DB;
  if (!db) throw new Error("D1 binding SBIZ_APP_DB is missing");
  const now = nowIso();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM registration_requests WHERE expires_at<=?").bind(now),
    db.prepare("DELETE FROM email_change_requests WHERE expires_at<=? OR used_at IS NOT NULL").bind(now),
    db.prepare("DELETE FROM password_reset_tokens WHERE expires_at<=? OR used_at IS NOT NULL").bind(now),
    db.prepare("DELETE FROM auth_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL").bind(cutoff),
    db.prepare("DELETE FROM email_rate_limits WHERE window_started_at<=?").bind(cutoff),
    db.prepare("UPDATE business_custom_domains SET status='error',error_code='DNS_CHALLENGE_EXPIRED',updated_at=? WHERE status='pending_dns' AND verification_expires_at<=?").bind(now, now)
  ]);
  const expiredDomains = await db.prepare("SELECT domain_id,business_id,hostname FROM business_custom_domains WHERE status='error' AND error_code='DNS_CHALLENGE_EXPIRED' AND updated_at=?").bind(now).all();
  for (const domain of expiredDomains.results || []) {
    await db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,old_value,new_value,metadata_json) SELECT ?, ?, 'custom_domain_verification_expired', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM business_events WHERE business_id=? AND event_type='custom_domain_verification_expired' AND new_value=? AND metadata_json LIKE ?) ")
      .bind(uuid(), domain.business_id, now, "pending_dns", domain.hostname, JSON.stringify({ domainId: domain.domain_id }), domain.business_id, domain.hostname, "%"+domain.domain_id+"%").run();
  }
}

/* [HEALTH][BACKEND][START]
 * Responsibility: Respond to GET /health only.
 */
function handleHealth(request) {
  if (request.method !== "GET") return null;

  return new Response(
    JSON.stringify({
      status: "ok",
      service: "sbiz",
      phase: "mod01",
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
/* [HEALTH][BACKEND][END] */

const routerJson = (body, status = 404) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});


async function routeRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === "/assets/background-light.jpg" || url.pathname === "/assets/background-dark.jpg") {
    if (request.method !== "GET" && request.method !== "HEAD") return routerJson({ error: "Method Not Allowed" }, 405);
    const key = url.pathname.slice(1);
    const object = await env.SBIZ_APP_R2.get(key);
    if (!object) return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
    const headers = new Headers({
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
    });
    object.writeHttpMetadata(headers);
    headers.set("content-type", "image/jpeg");
    headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  }
  if (url.pathname === "/health") {
    const response = handleHealth(request);
    return response ?? routerJson({ error: "Method Not Allowed" }, 405);
  }
  const mod01Response = await routeMod01(request, env);
  if (mod01Response) return mod01Response;
  return routerJson({ error: "Not Found" }, 404);
}


function handleRobotsTxt() {
  return new Response("User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /login\nDisallow: /create\nDisallow: /verify\nDisallow: /reset-password\nDisallow: /forgot-password\nSitemap: https://sbiz.app/sitemap.xml\n", {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" }
  });
}
function handleSitemapXml() {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://sbiz.app/</loc></url></urlset>';
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
}
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (request.method === "GET" && path === "/robots.txt") return handleRobotsTxt();
      if (request.method === "GET" && path === "/sitemap.xml") return handleSitemapXml();
      const protectedPath = path === "/admin" || path.startsWith("/admin/") || path === "/api/v1/admin" || path.startsWith("/api/v1/admin/");
      const headers = new Headers(request.headers);
      headers.delete("x-sbiz-verified-access-email");
      request = new Request(request, { headers });
      if (protectedPath) {
        const access = await verifyCloudflareAccess(request, env);
        if (!access.ok) return new Response(JSON.stringify({ error: access.error }), { status: access.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
        const verifiedHeaders = new Headers(request.headers);
        verifiedHeaders.set("x-sbiz-verified-access-email", access.claims.email);
        request = new Request(request, { headers: verifiedHeaders });
      }
      return await routeRequest(request, env, ctx);
    } catch {
      return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
  },
  async scheduled(controller, env, ctx) { ctx.waitUntil(cleanupMod01(env)); },
};
