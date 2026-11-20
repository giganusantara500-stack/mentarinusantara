import fs from "node:fs";
import path from "node:path";

export const SENDER_NAME = "Mentari Nusantara";
export const PASSWORD_EMAIL_SUBJECT = "Password Baru Anda";

export function readDotEnv(name: string) {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 0 || trimmed.slice(0, index).trim() !== name) continue;
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return value.trim();
    }
  } catch {
    return "";
  }
  return "";
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function senderFrom(address?: string, senderName = SENDER_NAME) {
  const raw = (address || "").trim();
  const wrapped = raw.match(/<([^>]+)>/);
  const email = (wrapped?.[1] || raw).trim();
  const name = (senderName || SENDER_NAME).trim() || SENDER_NAME;
  if (!email.includes("@")) return "";
  return `${name} <${email}>`;
}

function plainEmailError(status: number, raw: string) {
  const html = /<!doctype|<html/i.test(raw);
  if (status === 404 || html) {
    return "Layanan email belum dikonfigurasi. Username dan password sementara tetap tersedia di layar.";
  }
  try {
    const detail = JSON.parse(raw) as { message?: string; error?: string };
    const message = detail.message || detail.error || "";
    if (!message || /<!doctype|<html/i.test(message)) {
      return "Email gagal dikirim. Username dan password sementara tetap tersedia di layar.";
    }
    return String(message);
  } catch {
    return "Email gagal dikirim. Username dan password sementara tetap tersedia di layar.";
  }
}

export function temporaryPasswordEmail(input: {
  senderName?: string;
  name: string;
  password: string;
  username?: string;
  email?: string;
  supportEmail?: string;
  kind: "registration" | "reset";
}) {
  const senderName = (input.senderName || SENDER_NAME).trim() || SENDER_NAME;
  const name = input.name.trim() || "Pengguna";
  const support = input.supportEmail?.trim();
  const help = support
    ? `Jika Anda tidak meminta email ini atau mengalami kendala, hubungi ${support}.`
    : `Jika Anda tidak meminta email ini atau mengalami kendala, hubungi administrator ${senderName}.`;
  const intro = input.kind === "registration"
    ? `Akun ${senderName} Anda sudah dibuat. Berikut password sementara untuk masuk pertama kali.`
    : `Permintaan reset password akun ${senderName} Anda sudah diproses. Berikut password sementara yang baru.`;
  const identity = [
    ["Nama", name],
    ["Username", input.username?.trim() || ""],
    ["Email", input.email?.trim() || ""],
  ].filter((row) => row[1]);
  const identityHtml = identity.map(([label, value]) =>
    `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:110px;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(value)}</td></tr>`,
  ).join("");
  const html = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background-color:#1e3a5f;padding:28px 32px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">${escapeHtml(senderName)}</div>
              <div style="font-size:11px;color:#cbd5e1;letter-spacing:1.5px;margin-top:6px;">PASSWORD SEMENTARA</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Password Baru Anda</h1>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#475569;">Halo <strong>${escapeHtml(name)}</strong>,<br>${escapeHtml(intro)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${identityHtml}</table>
              <div style="background-color:#f8fafc;border:2px solid #1e3a5f;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px;">
                <div style="font-size:12px;color:#64748b;letter-spacing:1px;margin-bottom:8px;">PASSWORD SEMENTARA</div>
                <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#1e3a5f;font-family:'Courier New',Courier,monospace;">${escapeHtml(input.password)}</div>
              </div>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">Gunakan password di atas untuk login. Segera ganti dengan password baru milik Anda setelah berhasil masuk. Jangan membagikan password ini kepada siapa pun.</p>
              <div style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#92400e;"><strong>Masa berlaku:</strong> password sementara ini berlaku sampai Anda menggantinya setelah login. ${escapeHtml(help)}</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;padding:18px 28px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">Email ini dikirim oleh sistem ${escapeHtml(senderName)}. Mohon tidak membalas email ini.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  const text = [
    `${senderName} — Password Baru Anda`,
    "",
    `Halo ${name},`,
    intro,
    ...identity.map(([label, value]) => `${label}: ${value}`),
    "",
    `Password sementara: ${input.password}`,
    "",
    "Gunakan password di atas untuk login. Segera ganti dengan password baru milik Anda setelah berhasil masuk. Jangan membagikan password ini kepada siapa pun.",
    `Masa berlaku: password sementara ini berlaku sampai Anda menggantinya setelah login. ${help}`,
  ].join("\n");
  return { html, text };
}

async function deliver(input: { apiKey: string; from?: string; senderName?: string; to: string; subject: string; html: string; text: string }) {
  const from = senderFrom(input.from, input.senderName);
  if (!from) {
    return { sent: false as const, error: "Secret SENDER_EMAIL belum diisi. Email tidak dikirim." };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    const raw = await response.text();
    if (response.ok) return { sent: true as const };
    return { sent: false as const, error: plainEmailError(response.status, raw) };
  } catch (error) {
    console.error("Email gagal dikirim:", error);
    return { sent: false as const, error: "Layanan email belum bisa dihubungi. Username dan password sementara tetap tersedia di layar." };
  }
}

export async function sendAccountEmail(input: {
  apiKey: string;
  from?: string;
  senderName?: string;
  supportEmail?: string;
  to: string;
  name: string;
  username: string;
  email: string;
  password: string;
}) {
  const message = temporaryPasswordEmail({
    senderName: input.senderName,
    name: input.name,
    username: input.username,
    email: input.email,
    password: input.password,
    supportEmail: input.supportEmail,
    kind: "registration",
  });
  return deliver({
    apiKey: input.apiKey,
    from: input.from,
    senderName: input.senderName,
    to: input.to,
    subject: PASSWORD_EMAIL_SUBJECT,
    html: message.html,
    text: message.text,
  });
}

export async function sendPasswordEmail(input: {
  apiKey: string;
  from?: string;
  senderName?: string;
  supportEmail?: string;
  to: string;
  name: string;
  username?: string;
  email?: string;
  password: string;
}) {
  const message = temporaryPasswordEmail({
    senderName: input.senderName,
    name: input.name,
    username: input.username,
    email: input.email || input.to,
    password: input.password,
    supportEmail: input.supportEmail,
    kind: "reset",
  });
  return deliver({
    apiKey: input.apiKey,
    from: input.from,
    senderName: input.senderName,
    to: input.to,
    subject: PASSWORD_EMAIL_SUBJECT,
    html: message.html,
    text: message.text,
  });
}
