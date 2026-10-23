/**
 * SBiz MOD-01: registration, authentication and business traceability.
 * All database writes use the SBIZ_APP_DB D1 binding.
 */
import { sendMail } from "../shared/smtp-mailer.js";
import { verifyCloudflareAccess } from "../shared/cloudflare-access.js";

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
function page(title, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — SBiz</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#182230;background:#e9edf3}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#e9edf3 url("/assets/background-light.jpg") center/cover fixed no-repeat}main{width:min(100%,440px);padding:28px;border:1px solid rgba(255,255,255,.78);border-radius:20px;background:rgba(255,255,255,.75);backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);box-shadow:0 8px 24px rgba(31,45,66,.12)}@media(prefers-color-scheme:dark){:root{color:#f3f6fa;background:#0b1018}body{background-color:#0b1018;background-image:url("/assets/background-dark.jpg")}main{color:#f3f6fa;background:rgba(15,23,35,.75);border-color:rgba(210,225,245,.2);box-shadow:0 8px 24px rgba(0,0,0,.32)}p,small{color:#b4c0d0}input,select{color:#f3f6fa;background:rgba(22,32,47,.88);border-color:rgba(210,225,245,.2)}a.secondary{color:#8bbcff}}h1{font-size:1.5rem;margin:0 0 8px}p{line-height:1.5;color:#526174}label{display:block;font-size:.9rem;font-weight:600;margin:16px 0 6px}input,select{width:100%;padding:12px;border:1px solid #c8d1df;border-radius:10px;font:inherit;background:#fff}button,a.button{display:block;width:100%;margin-top:16px;padding:12px;border:0;border-radius:10px;background:#1677f2;color:#fff;font:inherit;font-weight:650;text-align:center;text-decoration:none;cursor:pointer}a.secondary{display:block;text-align:center;margin-top:16px;color:#245ea8}#message{white-space:pre-wrap;margin-top:14px;color:#8b2635}small{color:#526174}</style></head><body><main><h1>${title}</h1>${content}</main></body></html>`;
}
function pageForPath(path, url) {
  if (path === "/") return html(page("SBiz — Smart Business", `
    <p>Create a business account or sign in to manage your business.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><a class="button" href="/create">Create</a><a class="button" href="/login" style="background:#334155">Login</a></div>
    <p style="margin-top:24px">Choose language</p><nav style="display:flex;gap:10px;flex-wrap:wrap"><a href="/?lang=en">English 🇺🇸</a><a href="/?lang=vi">Tiếng Việt 🇻🇳</a><a href="/?lang=id">Bahasa Indonesia 🇮🇩</a><a href="/?lang=es">Español 🇲🇽</a><a href="/?lang=pt">Português 🇧🇷</a></nav>
  `));
  if (path === "/create") return html(page("Create your SBiz account", `
    <p>Create a business account. Email verification is required within 30 minutes.</p>
    <form id="form"><label>Email</label><input name="email" type="email" autocomplete="email" required maxlength="254">
    <label>Business slug</label><input name="slug" required minlength="13" maxlength="32" pattern="[a-z0-9]+" autocomplete="off"><small>13–32 lowercase letters or numbers.</small>
    <label>Default language</label><select name="defaultLanguage"><option value="en">English 🇺🇸</option><option value="vi">Tiếng Việt 🇻🇳</option><option value="id">Bahasa Indonesia 🇮🇩</option><option value="es">Español 🇲🇽</option><option value="pt">Português 🇧🇷</option></select>
    <button>Create</button><div id="message" role="status"></div></form><a class="secondary" href="/login">Already have an account? Login</a>
    <script>document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),slug:f.get('slug'),defaultLanguage:f.get('defaultLanguage')})});const d=await r.json();document.querySelector('#message').textContent=d.message||d.error||'Request completed';});</script>`));
  if (path === "/login") return html(page("Login", `
    <form id="form"><label>Email</label><input name="email" type="email" autocomplete="email" required><label>Password</label><input name="password" type="password" autocomplete="current-password" required minlength="12"><button>Login</button><div id="message" role="status"></div></form><a class="secondary" href="/forgot-password">Forgot password?</a><a class="secondary" href="/create">Create account</a>
    <script>document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')})});const d=await r.json();if(r.ok)location.href='/dashboard';else document.querySelector('#message').textContent=d.message||'Unable to login.';});</script>`));
  if (path === "/verify") return html(page("Verify email and set password", `
    <p>Confirm your email by setting a password. The verification link expires after 30 minutes.</p><form id="form"><label>New password</label><input name="password" type="password" autocomplete="new-password" minlength="12" required><small>Use at least 12 characters.</small><button>Verify and create account</button><div id="message" role="status"></div></form>
    <script>const token=new URLSearchParams(location.search).get('token');document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/register/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,password:f.get('password')})});const d=await r.json();document.querySelector('#message').textContent=d.message||d.error||'Request completed';if(r.ok)setTimeout(()=>location.href='/login',1500);});if(!token)document.querySelector('#message').textContent='Verification link is missing.';</script>`));
  if (path === "/change-email") return html(page("Confirm email change", `
    <p>Confirm the new email address for your SBiz account.</p><form id="form"><button>Confirm email change</button><div id="message" role="status"></div></form>
    <script>const token=new URLSearchParams(location.search).get('token');document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/v1/email/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});const d=await r.json();document.querySelector('#message').textContent=d.message||d.error||'Request completed';});if(!token)document.querySelector('#message').textContent='Confirmation link is missing.';</script>`));
  if (path === "/forgot-password") return html(page("Forgot password", `
    <p>If the account is eligible, we will email a password reset link.</p><form id="form"><label>Account email</label><input name="email" type="email" autocomplete="email" required><button>Send reset link</button><div id="message" role="status"></div></form><a class="secondary" href="/login">Back to Login</a>
    <script>document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/password/forgot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email')})});const d=await r.json();document.querySelector('#message').textContent=d.message||'If the account is eligible, a reset link will be sent.';});</script>`));
  if (path === "/reset-password") return html(page("Reset password", `
    <form id="form"><label>New password</label><input name="password" type="password" minlength="12" autocomplete="new-password" required><button>Reset password</button><div id="message" role="status"></div></form>
    <script>const token=new URLSearchParams(location.search).get('token');document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/v1/password/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,password:f.get('password')})});const d=await r.json();document.querySelector('#message').textContent=d.message||d.error||'Request completed';if(r.ok)setTimeout(()=>location.href='/login',1500);});if(!token)document.querySelector('#message').textContent='Reset link is missing.';</script>`));
  if (path === "/admin") return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SBiz Admin</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#182230;background:#e9edf3;font-synthesis:none;color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#e9edf3 url("/assets/background-light.jpg") center/cover fixed no-repeat}header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px clamp(16px,4vw,40px);background:#fff;border-bottom:1px solid #dce3ec}header strong{font-size:1.15rem;letter-spacing:-.02em}header span{color:#66758a;font-size:.9rem}main{max-width:1200px;margin:0 auto;padding:clamp(16px,4vw,36px)}h1{margin:0;font-size:clamp(1.5rem,3vw,2rem);letter-spacing:-.03em}p{color:#627187;line-height:1.5}.toolbar{display:flex;flex-wrap:wrap;gap:12px;margin:22px 0}.toolbar input,.toolbar select,input[type=url]{min-height:42px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font:inherit;background:white}.toolbar input{flex:1;min-width:220px}button,.button{border:0;border-radius:9px;padding:10px 14px;background:#155eef;color:white;font:inherit;font-weight:650;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}button.secondary{background:#e8eef7;color:#233b5b}.panel{background:#fff;border:1px solid #dce3ec;border-radius:14px;overflow:hidden}.panel-head{padding:16px 18px;border-bottom:1px solid #e7edf4;display:flex;justify-content:space-between;gap:12px;align-items:center}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:680px}th,td{text-align:left;padding:13px 16px;border-bottom:1px solid #edf1f6;font-size:.9rem}th{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:#718096;background:#fafbfd}td{vertical-align:middle}.muted{color:#718096}.pill{display:inline-block;border-radius:999px;padding:4px 9px;font-size:.78rem;background:#edf2f7;color:#43536a}.pill.verified{background:#e1f7ec;color:#126b45}.empty{padding:36px 18px;text-align:center;color:#64748b}.detail{display:none;margin-top:18px;padding:20px;background:#fff;border:1px solid #dce3ec;border-radius:14px}.detail.open{display:block}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:18px 0}.field{padding:12px;background:#f7f9fc;border-radius:9px;overflow-wrap:anywhere}.field b{display:block;font-size:.75rem;color:#718096;margin-bottom:5px;text-transform:uppercase}.history{padding-left:20px;color:#526174}.form-row{display:flex;gap:10px;flex-wrap:wrap}.form-row input{flex:1;min-width:240px}#message{min-height:24px;margin:12px 0;color:#475569}#message.error{color:#b42318}footer{padding:22px 0;color:#8290a3;font-size:.82rem}/* SBiz Liquid Glass: interactive surfaces only; content remains opaque and readable. */
  header{background:rgba(255,255,255,.78);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);border-bottom:1px solid rgba(255,255,255,.9);box-shadow:0 1px 0 rgba(148,163,184,.18)}
  .toolbar input,.toolbar select,input[type=url]{background:rgba(255,255,255,.72);backdrop-filter:blur(14px) saturate(135%);-webkit-backdrop-filter:blur(14px) saturate(135%);border:1px solid rgba(255,255,255,.95);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 1px 3px rgba(36,54,78,.06)}
  button,.button{box-shadow:inset 0 1px 0 rgba(255,255,255,.25);transition:transform .15s ease,filter .15s ease}button:hover,.button:hover{filter:brightness(1.03)}button:active,.button:active{transform:translateY(1px)}
  .panel,.detail{border:1px solid rgba(207,218,232,.9);box-shadow:0 2px 8px rgba(34,52,76,.035)}
  .panel-head{background:rgba(248,250,253,.72)}
  .detail{background:rgba(255,255,255,.88);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
  @media(max-width:600px){header{align-items:flex-start;flex-direction:column}.panel-head{align-items:flex-start;flex-direction:column}.toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px}.toolbar input{grid-column:1/-1;min-width:0;width:100%}.toolbar select{min-width:0;width:100%;font-size:.9rem}.toolbar #refresh{white-space:nowrap;padding:10px 12px}.table-wrap{overflow:visible}table{display:block;min-width:0;width:100%}thead{display:none}tbody{display:grid;gap:10px;padding:12px;background:#f7f9fc}tbody tr{display:grid;gap:0;min-width:0;border:1px solid #e1e7ef;border-radius:12px;background:#fff;overflow:hidden}tbody td{display:grid;grid-template-columns:minmax(100px,.8fr) minmax(0,1.2fr);gap:10px;align-items:start;padding:10px 12px;border-bottom:1px solid #edf1f6;overflow-wrap:anywhere}tbody td::before{content:attr(data-label);font-size:.72rem;font-weight:700;letter-spacing:.035em;text-transform:uppercase;color:#718096}tbody td:last-child{border-bottom:0}tbody td:last-child button{justify-self:start}.empty{padding:24px 16px}.form-row{flex-direction:column}.form-row input{min-width:0;width:100%}.form-row button{width:100%}.detail-grid{grid-template-columns:minmax(0,1fr)}}
  @media(prefers-color-scheme:dark){:root{color:#f3f6fa;background:#0b1018}body{background-color:#0b1018;background-image:url("/assets/background-dark.jpg");color:#f3f6fa}header{color:#f3f6fa;background:rgba(15,23,35,.75);border-color:rgba(210,225,245,.2)}header span,p,.muted,.empty,footer{color:#b4c0d0}.panel,.detail{color:#f3f6fa;background:rgba(15,23,35,.75);border-color:rgba(210,225,245,.2)}.panel-head{background:rgba(22,32,47,.72);border-color:rgba(230,238,250,.12)}th{color:#b4c0d0;background:rgba(22,32,47,.88)}td{border-color:rgba(230,238,250,.12)}.pill{background:rgba(180,192,208,.14);color:#d6dfeb}.pill.verified{background:rgba(30,160,100,.2);color:#8ee0b8}.toolbar input,.toolbar select,input[type=url]{color:#f3f6fa;background:rgba(22,32,47,.88);border-color:rgba(210,225,245,.2)}button.secondary{color:#e4edf8;background:rgba(75,96,124,.55)}.field{background:rgba(22,32,47,.88)}.field b{color:#b4c0d0}.history{color:#b4c0d0}tbody{background:transparent}tbody tr{background:rgba(15,23,35,.86);border-color:rgba(210,225,245,.2)}tbody td{border-color:rgba(230,238,250,.12)}tbody td::before{color:#b4c0d0}}
  @media(prefers-reduced-motion:reduce){button,.button{transition:none}}
  </style></head><body><header><strong>SBiz <span>/ System administration</span></strong><span>Owner access verified by Cloudflare</span></header><main><h1>Business administration</h1><p>Review registered businesses, inspect traceability history, and record a business registration document link.</p><div class="toolbar"><input id="search" type="search" placeholder="Search business ID, slug, or email" aria-label="Search businesses"><select id="status" aria-label="Filter by verification status"><option value="">All verification statuses</option><option value="verified">Verified</option><option value="pending">Pending</option></select><button id="refresh">Refresh list</button></div><section class="panel"><div class="panel-head"><strong>Businesses</strong><span id="count" class="muted">Loading…</span></div><div class="table-wrap"><table><thead><tr><th>Business</th><th>Owner email</th><th>Verification</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody id="rows"></tbody></table></div><div id="empty" class="empty" hidden>No businesses match this view.</div></section><section id="detail" class="detail" aria-live="polite"><div class="panel-head" style="padding:0 0 14px"><div><h2 id="detail-title" style="margin:0;font-size:1.2rem">Business details</h2><p id="detail-subtitle" style="margin:5px 0 0"></p></div><button id="close-detail" class="secondary">Close details</button></div><div id="detail-fields" class="detail-grid"></div><h3>Registration document</h3><p>Enter a direct HTTPS document link. Saving it marks the business verification status as verified and records an audit event.</p><form id="document-form"><div class="form-row"><input id="document-url" type="url" placeholder="https://…" required maxlength="2048" aria-label="Registration document HTTPS URL"><button type="submit">Save link and verify</button></div></form><div id="message" role="status"></div><h3>Recent history</h3><ol id="history" class="history"></ol></section><footer>SBiz administration · Protected by Cloudflare Access</footer></main><script>
  const $=id=>document.getElementById(id);let businesses=[];let selectedId=null;
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const date=value=>value?new Date(value).toLocaleString():"—";
  async function load(){ $("rows").innerHTML="";$("empty").hidden=true;$("count").textContent="Loading…";try{const r=await fetch("/api/v1/admin/businesses?limit=100",{headers:{accept:"application/json"},cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||"Could not load businesses");businesses=Array.isArray(d.businesses)?d.businesses:[];render();}catch(e){$("count").textContent="Could not load";$("empty").hidden=false;$("empty").textContent=e.message+" — refresh to try again.";$("empty").style.color="#b42318";}}
  function render(){const q=$("search").value.trim().toLowerCase(),status=$("status").value;const filtered=businesses.filter(b=>[b.business_id,b.current_slug,b.email].some(v=>String(v||"").toLowerCase().includes(q))&&(!status||(b.verification_status||"pending")===status));$("rows").innerHTML=filtered.map(b=>'<tr><td data-label="Business"><strong>'+esc(b.current_slug)+'</strong><br><span class="muted">'+esc(b.business_id)+'</span></td><td data-label="Owner email">'+esc(b.email)+'</td><td data-label="Verification"><span class="pill '+(b.verification_status==="verified"?"verified":"")+'">'+esc(b.verification_status||"pending")+'</span></td><td data-label="Status">'+esc(b.status||"—")+'</td><td data-label="Created">'+esc(date(b.created_at))+'</td><td data-label="Details"><button class="secondary" data-open="'+esc(b.business_id)+'">View</button></td></tr>').join("");$("count").textContent=filtered.length+" shown · "+businesses.length+" total";$("empty").hidden=filtered.length!==0;$("empty").style.color="";$("rows").querySelectorAll("[data-open]").forEach(btn=>btn.addEventListener("click",()=>openBusiness(btn.dataset.open)));}
  async function openBusiness(id){selectedId=id;$("detail").classList.add("open");$("detail-title").textContent="Loading business…";$("detail-fields").innerHTML="";$("history").innerHTML="";$("message").textContent="";$("message").className="";try{const r=await fetch("/api/v1/admin/businesses/"+encodeURIComponent(id),{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||"Could not load business");const b=d.business;$("detail-title").textContent=b.current_slug||b.business_id;$("detail-subtitle").textContent=b.business_id;$("detail-fields").innerHTML=[["Owner email",b.email],["Account ID",b.account_id],["Default language",b.default_language],["Business status",b.status],["Verification status",b.verification_status],["Created",date(b.created_at)],["Email verified",date(b.verified_at)],["Admin verified",date(b.admin_verified_at)],["Subscription starts",date(b.subscription_started_at)],["Subscription expires",date(b.subscription_expires_at)],["Data deleted",date(b.data_deleted_at)],["Registration document",b.registration_document_url||"Not provided"]].map(([k,v])=>'<div class="field"><b>'+esc(k)+'</b>'+esc(v||"—")+'</div>').join("");$("document-url").value=b.registration_document_url||"";$("history").innerHTML=(d.history||[]).map(e=>'<li><strong>'+esc(e.event_type)+'</strong> · '+esc(date(e.occurred_at))+(e.new_value?' · '+esc(e.new_value):"")+'</li>').join("")||"<li>No events recorded yet.</li>";}catch(e){$("message").textContent=e.message;$("message").className="error";}}
  $("refresh").addEventListener("click",load);$("search").addEventListener("input",render);$("status").addEventListener("change",render);$("close-detail").addEventListener("click",()=>{$("detail").classList.remove("open");selectedId=null;});$("document-form").addEventListener("submit",async e=>{e.preventDefault();if(!selectedId)return;$("message").textContent="Saving…";$("message").className="";try{const r=await fetch("/api/v1/admin/businesses/"+encodeURIComponent(selectedId),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({registrationDocumentUrl:$("document-url").value.trim()})});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||"Could not save document link");$("message").textContent="Document link saved. Business verification marked verified.";$("message").className="";await load();await openBusiness(selectedId);}catch(e){$("message").textContent=e.message;$("message").className="error";}});load();
  </script></body></html>`);
  if (path === "/dashboard") return html(page("SBiz dashboard", `<p id="status">Checking session…</p><a class="button" href="/api/v1/logout">Logout</a><script>fetch('/api/v1/me').then(r=>r.json()).then(d=>{document.querySelector('#status').textContent=d.email?'Signed in as '+d.email:'Please login first';if(!d.email)setTimeout(()=>location.href='/login',800)});</script>`));
  return null;
}

async function register(request, env) {
  const input = await bodyJson(request);
  if (!input) return json({ error: "INVALID_JSON" }, 400);
  const email = normalizeEmail(input.email);
  const slug = normalizeSlug(input.slug);
  const language = String(input.defaultLanguage || "");
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
  const verifyUrl = new URL("/verify?token=" + encodeURIComponent(token), request.url).toString();
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
  const resetUrl = new URL("/reset-password?token=" + encodeURIComponent(token), request.url).toString();
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
  const consumed = await db.prepare("UPDATE password_reset_tokens SET used_at=? WHERE reset_id=? AND used_at IS NULL AND expires_at>? RETURNING reset_id")
    .bind(now, row.reset_id, now).first();
  if (!consumed) return json({ error: "RESET_EXPIRED", message: "This reset link has already been used or expired." }, 410);
  await db.batch([
    db.prepare("UPDATE accounts SET password_hash=?,updated_at=? WHERE account_id=?").bind(hash, now, row.account_id),
    db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL").bind(now, row.account_id)
  ]);
  return json({ ok: true, message: "Password reset. Please log in with your new password." });
}

async function logout(request, env) {
  const token = cookieValue(request, "sbiz_session");
  if (token) await env.SBIZ_APP_DB.prepare("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(nowIso(), await sha256(token)).run();
  return new Response(null, { status: 302, headers: { location: "/login", "set-cookie": clearSessionCookie(), "cache-control": "no-store" } });
}

async function me(request, env) {
  const account = await currentAccount(request, env);
  if (!account) return json({ authenticated: false }, 401);
  const businesses = await env.SBIZ_APP_DB.prepare("SELECT b.business_id,b.current_slug,b.default_language,b.created_at,b.verified_at,b.status FROM businesses b JOIN business_memberships m ON m.business_id=b.business_id WHERE m.account_id=? ORDER BY b.created_at").bind(account.account_id).all();
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
  await db.batch([
    db.prepare("UPDATE businesses SET current_slug=? WHERE business_id=?").bind(slug, businessId),
    db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value) VALUES (?,?, 'slug_changed',?,?,?,?)").bind(uuid(), businessId, now, account.account_id, business.current_slug, slug)
  ]);
  return json({ ok: true, business_id: businessId, slug });
}

async function requestEmailChange(request, env, businessId) {
  const account = await currentAccount(request, env);
  if (!account) return json({ error: "UNAUTHENTICATED" }, 401);
  const input = await bodyJson(request);
  const newEmail = normalizeEmail(input?.newEmail);
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
  const confirmUrl = new URL("/change-email?token=" + encodeURIComponent(token), request.url).toString();
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
  const row = await db.prepare("SELECT * FROM email_change_requests WHERE token_hash=? AND used_at IS NULL AND expires_at>?").bind(await sha256(token), nowIso()).first();
  if (!row) return json({ error: "TOKEN_EXPIRED", message: "This email confirmation link is invalid or expired." }, 410);
  const existing = await db.prepare("SELECT account_id FROM accounts WHERE email=? COLLATE NOCASE AND account_id<>?").bind(row.new_email, row.account_id).first();
  if (existing) return json({ error: "EMAIL_ALREADY_USED", message: "This email is already in use." }, 409);
  const account = await db.prepare("SELECT email FROM accounts WHERE account_id=?").bind(row.account_id).first();
  if (!account) return json({ error: "ACCOUNT_NOT_FOUND" }, 404);
  const memberships = await db.prepare("SELECT business_id FROM business_memberships WHERE account_id=?").bind(row.account_id).all();
  const now = nowIso();
  const consumed = await db.prepare("UPDATE email_change_requests SET used_at=? WHERE change_id=? AND used_at IS NULL AND expires_at>? RETURNING change_id")
    .bind(now, row.change_id, now).first();
  if (!consumed) return json({ error: "TOKEN_EXPIRED", message: "This email confirmation link has already been used or expired." }, 410);
  const statements = [
    db.prepare("UPDATE accounts SET email=?,email_verified_at=?,updated_at=? WHERE account_id=?").bind(row.new_email, now, now, row.account_id),
    db.prepare("UPDATE email_change_requests SET used_at=? WHERE account_id=? AND used_at IS NULL").bind(now, row.account_id)
  ];
  for (const membership of memberships.results || []) {
    statements.push(db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value) VALUES (?,?, 'email_changed',?,?,?,?)")
      .bind(uuid(), membership.business_id, now, row.account_id, account.email, row.new_email));
  }
  try {
    await db.batch(statements);
  } catch {
    return json({ error: "EMAIL_CHANGE_FAILED", message: "The email could not be changed. Please request a new confirmation link." }, 503);
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
    return json({ business, history: history.results || [] });
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
      db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value) VALUES (?,?, 'registration_document_link_updated',?,?,?,?)").bind(uuid(), businessId, now, null, old.registration_document_url, rawUrl),
      db.prepare("INSERT INTO business_events (event_id,business_id,event_type,occurred_at,actor_account_id,old_value,new_value,metadata_json) VALUES (?,?, 'business_verification_approved',?,?,?,? ,?)").bind(uuid(), businessId, now, null, old.verification_status, "verified", JSON.stringify({ documentUrl: rawUrl, accessEmail }))
    ]);
    return json({ ok: true, business_id: businessId, registration_document_url: rawUrl, verification_status: "verified", admin_verified_at: now });
  }
  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}

export async function routeMod01(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
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
  const slugMatch = path.match(/^\/api\/v1\/businesses\/(sbiz-\d{9})\/slug$/);
  if (slugMatch && request.method === "PATCH") return updateBusinessSlug(request, env, slugMatch[1]);
  if (path === "/api/v1/admin/businesses" && request.method === "GET") return adminBusinessList(request, env);
  const adminMatch = path.match(/^\/api\/v1\/admin\/businesses\/(sbiz-\d{9})$/);
  if (adminMatch && ["GET", "PATCH"].includes(request.method)) return adminBusiness(request, env, adminMatch[1]);
  if (path.startsWith("/api/v1/")) return json({ error: "NOT_FOUND" }, 404);
  return null;
}
/* [MOD01][BACKEND][END] */

export async function cleanupMod01(env) {
  const db = env.SBIZ_APP_DB;
  if (!db) throw new Error("D1 binding SBIZ_APP_DB is missing");
  const now = nowIso();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM registration_requests WHERE expires_at<=?").bind(now),
    db.prepare("DELETE FROM email_change_requests WHERE expires_at<=? OR used_at IS NOT NULL").bind(now),
    db.prepare("DELETE FROM password_reset_tokens WHERE expires_at<=? OR used_at IS NOT NULL").bind(now),
    db.prepare("DELETE FROM auth_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL").bind(cutoff),
    db.prepare("DELETE FROM email_rate_limits WHERE window_started_at<=?").bind(cutoff)
  ]);
}
