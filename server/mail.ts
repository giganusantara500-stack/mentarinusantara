import fs from "node:fs";
import path from "node:path";

export const PASSWORD_EMAIL_FROM = "Giga Mentari Nusantara <onboarding@resend.dev>";

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendPasswordEmail(input: {
  apiKey: string;
  to: string;
  name: string;
  password: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: PASSWORD_EMAIL_FROM,
      to: [input.to],
      subject: "Password baru akun Giga Mentari Nusantara",
      html: `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">
        <p>Halo ${escapeHtml(input.name)},</p>
        <p>Password akun Anda telah direset oleh atasan.</p>
        <p>Password baru Anda:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px">${escapeHtml(input.password)}</p>
        <p>Gunakan 6 digit angka di atas untuk masuk, lalu ganti password setelah login.</p>
        <p>Giga Mentari Nusantara</p>
      </div>`,
    }),
  });
  if (response.ok) return { sent: true as const };
  const detail = await response.json().catch(() => null);
  const message = detail?.message || detail?.error || "Email gagal dikirim oleh Resend.";
  return { sent: false as const, error: String(message) };
}
