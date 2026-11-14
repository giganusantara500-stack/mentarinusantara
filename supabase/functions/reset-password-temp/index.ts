// Edge Function: reset-password-temp
//
// Alur reset password dengan kode sandi sementara:
// 1. Menerima email pengguna dari frontend.
// 2. Mencari user di profiles berdasarkan email.
// 3. Membuat kode sandi sementara acak (12 digit angka).
// 4. Memperbarui password user via Supabase Admin API (service_role).
// 5. Mengirim email berisi kode sandi ke pengguna via Resend API.
// 6. Menandai must_change_password = true agar pengguna wajib ganti password setelah login.
//
// TIDAK menggunakan supabase.auth.resetPasswordForEmail. Semua dilakukan via service_role.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function generateTempPassword(): string {
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
}

async function findProfileByEmail(admin: SupabaseClient, email: string): Promise<ProfileRow | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, status")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`Gagal mencari profil: ${error.message}`);
  return (data as ProfileRow) ?? null;
}

// Send email via Resend API
async function sendTempPasswordEmail(
  resendApiKey: string,
  toEmail: string,
  fullName: string,
  tempPassword: string,
  senderEmail: string,
): Promise<string | null> {
  const senderName = "Giga Mentari Nusantara";
  const fromHeader = `${senderName} <${senderEmail}>`;

  const htmlBody = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;min-height:100vh;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:28px 32px;text-align:center;">
              <div style="display:inline-block;width:44px;height:44px;background:rgba(255,255,255,0.15);border-radius:12px;line-height:44px;font-size:24px;font-weight:bold;color:#ffffff;">G</div>
              <div style="margin-top:8px;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">${senderName}</div>
              <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-top:2px;">Platform PPOB</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Kode Sandi Sementara Anda</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569;">
                Halo <strong>${escapeHtml(fullName || "Pengguna")}</strong>,<br>
                Permintaan reset password Anda telah diproses. Berikut adalah kode sandi sementara untuk akun ${senderName} Anda:
              </p>

              <div style="background-color:#f8fafc;border:2px solid #2563eb;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
                <div style="font-size:13px;color:#64748b;margin-bottom:8px;">KODE SANDI SEMENTARA</div>
                <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#1e3a5f;font-family:'Courier New',monospace;">
                  ${escapeHtml(tempPassword)}
                </div>
              </div>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">
                Silakan login dengan email dan kode sandi sementara di atas. Anda akan diminta mengubah kata sandi setelah berhasil masuk.
              </p>

              <div style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-bottom:20px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#92400e;">
                  <strong>Penting:</strong> Kode sandi ini bersifat sementara. Segera login dan ganti dengan kata sandi baru yang kuat. Jangan membagikan kode sandi ini kepada siapapun.
                </p>
              </div>

              <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
                Jika Anda tidak meminta reset password, segera hubungi administrator ${senderName}.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">
                Email ini dikirim oleh sistem ${senderName}. Jangan membalas email ini.<br>
                &copy; 2026 ${senderName}. Semua hak dilindungi.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textBody = `${senderName} - Kode Sandi Sementara

Halo ${fullName || "Pengguna"},

Permintaan reset password Anda telah diproses. Berikut adalah kode sandi sementara untuk akun ${senderName} Anda:

${tempPassword}

Silakan login dengan email dan kode sandi sementara di atas. Anda akan diminta mengubah kata sandi setelah berhasil masuk.

Penting: Kode sandi ini bersifat sementara. Segera login dan ganti dengan kata sandi baru yang kuat. Jangan membagikan kode sandi ini kepada siapapun.

Jika Anda tidak meminta reset password, segera hubungi administrator ${senderName}.

© 2026 ${senderName}. Semua hak dilindungi.`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromHeader,
      to: [toEmail],
      subject: `Kode Sandi Sementara - ${senderName}`,
      html: htmlBody,
      text: textBody,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return `Resend API error (${res.status}): ${errText}`;
  }

  return null;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Metode tidak diizinkan." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server belum dikonfigurasi dengan benar." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "Data tidak terbaca." }, 400);

    const email = clean(body.email).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      return json({ error: "Format email tidak valid." }, 400);
    }

    // 1. Cari profil berdasarkan email
    const profile = await findProfileByEmail(admin, email);
    if (!profile) {
      // Demi keamanan, jangan mengungkap apakah email ada atau tidak.
      // Tapi tetap kembalikan sukses agar tidak membocorkan info.
      return json({ success: true, message: "Jika email terdaftar, password sementara telah dikirim." });
    }

    if (profile.status === "suspended") {
      return json({ error: "Akun Anda dinonaktifkan. Hubungi administrator." }, 403);
    }

    // 2. Buat password sementara acak (retry jika ditolak karena lemah)
    let tempPassword = "";
    let updateErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      tempPassword = generateTempPassword();
      const { error } = await admin.auth.admin.updateUserById(profile.id, {
        password: tempPassword,
      });
      if (!error) { updateErr = null; break; }
      updateErr = error;
      if (!/weak|easy to guess|password/i.test(error.message)) break;
    }
    if (updateErr) {
      return json({ error: `Gagal memperbarui password: ${updateErr.message}` }, 500);
    }

    // 4. Tandai must_change_password = true agar user wajib ganti setelah login
    await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", profile.id);

    // 5. Kirim email berisi password sementara
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;
    let emailError: string | null = null;

    if (resendApiKey) {
      // Gunakan sender email dari env atau default
      const senderEmail = Deno.env.get("EMAIL_FROM_ADDRESS") || "onboarding@resend.dev";
      const sendErr = await sendTempPasswordEmail(
        resendApiKey,
        profile.email,
        profile.full_name,
        tempPassword,
        senderEmail,
      );
      if (sendErr) {
        emailError = sendErr;
      } else {
        emailSent = true;
      }
    } else {
      // Fallback: tidak ada Resend API key — kembalikan password sementara ke response
      // HANYA untuk development/testing. Di produksi, wajib set RESEND_API_KEY.
      emailError = "RESEND_API_KEY belum dikonfigurasi. Password sementara dibuat tetapi email tidak terkirim.";
    }

    // 6. Catat di audit log
    await admin.from("audit_logs").insert({
      actor_id: profile.id,
      action: "temp_password_reset",
      target_type: "profile",
      target_id: profile.id,
      details: { email: profile.email, email_sent: emailSent },
    });

    if (!emailSent && !resendApiKey) {
      // Development mode: return temp password in response (testing only)
      return json({
        success: true,
        message: "Password sementara berhasil dibuat. Email belum terkirim karena RESEND_API_KEY belum dikonfigurasi.",
        temp_password: tempPassword,
        email_sent: false,
        email_error: emailError,
      });
    }

    return json({
      success: true,
      message: emailSent
        ? "Password sementara telah dikirim ke email Anda."
        : "Password berhasil diubah tetapi email gagal terkirim.",
      email_sent: emailSent,
      email_error: emailSent ? null : emailError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan server tidak diketahui.";
    return json({ error: message }, 500);
  }
});
