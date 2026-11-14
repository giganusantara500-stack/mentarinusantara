/*
# Penanda wajib ganti password awal Super Admin

## Ringkasan
Akun Super Admin pertama dibuat dengan password sementara. Migration ini menambahkan
penanda yang memaksa pengguna mengganti password sebelum masuk ke dashboard.

## Perubahan
1. Kolom baru `profiles.must_change_password` (boolean, default false).
2. Fungsi `complete_initial_password_change()` untuk menurunkan penanda setelah password berhasil diganti.
   Fungsi hanya mengubah baris milik pengguna yang sedang login.

## Keamanan
- Pengguna tidak bisa mengubah penanda ini langsung, karena izin UPDATE tetap hanya pada `full_name`.
- Fungsi dijalankan dengan hak owner dan hanya diizinkan untuk peran `authenticated`.
- Tidak ada data yang dihapus.
*/

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.complete_initial_password_change()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
  SET must_change_password = false
  WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.complete_initial_password_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_initial_password_change() TO authenticated;
