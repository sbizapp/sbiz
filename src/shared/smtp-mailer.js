/**
 * [EMAIL][SMTP][START]
 * Yandex SMTP over Cloudflare Workers TCP sockets (implicit TLS on port 465).
 * Configure SMTP_HOST, SMTP_PORT, SMTP_USER_NOREPLY and secret SMTP_PASSWORD_NOREPLY.
 */
import { connect } from "cloudflare:sockets";

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

export async function sendMail(env, { to, subject, text }) {
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
