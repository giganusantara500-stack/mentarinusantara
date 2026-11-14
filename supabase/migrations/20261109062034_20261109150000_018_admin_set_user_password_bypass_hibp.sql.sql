/*
# Fungsi admin_set_user_password — bypass validasi kekuatan password

## Latar belakang
`supabase.auth.admin.updateUserById` tetap menerapkan cek HIBP (HaveIBeenPwned)
yang menolak password lemah seperti "123456" meskipun dipanggil dengan service_role.
Mitra perlu menggunakan password angka sederhana 6 digit, yang ditolak oleh cek ini.

## Perubahan
1. Buat fungsi `admin_set_user_password(p_user_id uuid, p_password text)` —
   SECURITY DEFINER, meng-hash password dengan bcrypt (pgcrypto `crypt` + `gen_salt('bf')`)
   lalu menulis langsung ke `auth.users.encrypted_password`.
   - Melewati seluruh pipeline GoTrue, sehingga tidak ada cek HIBP.
   - Memeriksa minimal 6 karakter.
   - Memeriksa user exists.
   - Hanya bisa dipanggil oleh `authenticated` (bukan anon).
2. REVOKE EXECUTE dari PUBLIC dan anon, GRANT ke authenticated.

## Keamanan
- SECURITY DEFINER: berjalan dengan hak pemilik (service_role), melewati RLS.
- Fungsi hanya menerima user_id + password, tidak mengembalikan data sensitif.
- Password di-hash dengan bcrypt sebelum disimpan — tidak disimpan plain text.
- Hanya authenticated yang bisa memanggil; anon tidak bisa.
- Fungsi ini digunakan oleh edge function change-password yang memverifikasi JWT
  pengguna sebelum memanggil RPC.
*/

CREATE OR REPLACE FUNCTION public.admin_set_user_password(p_user_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF char_length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password minimal 6 karakter.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Pengguna tidak ditemukan.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf'))
  WHERE id = p_user_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;
