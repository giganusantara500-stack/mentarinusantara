/*
# Kunci kolom profil agar pengguna tidak bisa mengubah role sendiri

## Ringkasan
Sebelumnya pengguna yang sudah login memiliki izin mengubah semua kolom pada profilnya
sendiri, termasuk `role` dan `status`. Migration ini hanya mengizinkan pengguna
mengubah `full_name`.

## Perubahan
1. Mencabut seluruh izin pada `profiles` dari peran `anon` dan `authenticated`.
2. Memberikan kembali SELECT kepada `authenticated` (RLS tetap membatasi ke baris miliknya).
3. Memberikan UPDATE hanya pada kolom `full_name` kepada `authenticated`.

## Catatan
- Perubahan role, status, dan parent dilakukan hanya melalui fungsi server dengan hak service role.
- Tidak ada data yang dihapus.
*/

REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;
