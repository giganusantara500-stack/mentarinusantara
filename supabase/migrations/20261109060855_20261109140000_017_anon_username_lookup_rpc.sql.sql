/*
# Lookup email by username untuk login (anon-accessible)

## Latar belakang
Halaman login memungkinkan pengguna masuk dengan username alih-alih email.
Namun tabel profiles hanya memberikan SELECT ke `authenticated`, bukan `anon`.
Sehingga pencarian email berdasarkan username sebelum login selalu mengembalikan
kosong, dan pengguna melihat "Username tidak ditemukan" meskipun username ada.

## Perubahan
1. Buat fungsi `lookup_email_by_username(p_username text)` — SECURITY DEFINER,
   membaca kolom email + status dari profiles berdasarkan username (case-insensitive),
   hanya untuk akun yang belum di-soft-delete.
   - Mengembalikan tabel dengan kolom `email` (text) dan `status` (text).
   - Hanya mengembalikan email — tidak membocorkan data profil lain.
2. REVOKE EXECUTE dari PUBLIC dan anon, lalu GRANT EXECUTE ke `anon` dan `authenticated`.
   (Anon perlu memanggil ini saat pre-login lookup; authenticated tidak digunakan tapi
   diberikan untuk konsistensi.)
3. Fungsi sengaja tidak memeriksa `deleted_at` di policy karena SECURITY DEFINER
   melewati RLS — filter dilakukan di dalam fungsi dengan WHERE deleted_at IS NULL.

## Keamanan
- SECURITY DEFINER: fungsi berjalan dengan hak pemilik (service_role), melewati RLS.
- Hanya kolom email dan status yang diekspos — tidak ada data sensitif lain.
- Filter deleted_at IS NULL di dalam fungsi mencegah akun yang dihapus.
- Username dicocokkan secara case-insensitive (lower()).
- Tidak ada INSERT/UPDATE/DELETE — fungsi read-only.
*/

CREATE OR REPLACE FUNCTION public.lookup_email_by_username(p_username text)
RETURNS TABLE(email text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email, status
  FROM public.profiles
  WHERE lower(username) = lower(p_username)
    AND deleted_at IS NULL
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_email_by_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_email_by_username(text) TO anon, authenticated;
