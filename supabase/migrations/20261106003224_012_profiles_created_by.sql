/*
# Catat pembuat akun pada profil

1. Perubahan tabel
- Menambah kolom `created_by` pada `profiles`. Kolom ini berisi id akun yang membuat akun tersebut.
- Akun lama tidak diubah dan kolom ini dibiarkan kosong untuk akun yang sudah ada.

2. Keamanan
- Kolom hanya diisi oleh Edge Function di sisi server. Pengguna tidak dapat mengubahnya dari browser karena tidak ada grant tambahan.
- Tidak ada kebijakan RLS yang berubah.

3. Catatan
- Saat akun Super Admin pertama dibuat, kolom ini tetap kosong.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_created_by_idx ON public.profiles(created_by);
