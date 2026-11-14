/*
# Hapus RPC pembuatan akun yang rusak dan tambah data usaha pada profiles

## Latar belakang
Fungsi admin_create_subuser memanggil auth.admin.create_user, padahal fungsi tersebut
tidak tersedia di SQL. Akibatnya setiap pembuatan akun dari aplikasi selalu gagal.
Pembuatan akun dipindahkan ke Edge Function server-side (create-subuser) yang memakai
service role di server.

## Perubahan
1. Menghapus semua overload fungsi admin_create_subuser (tidak ada data yang hilang).
2. Menambah kolom business_name (nama usaha) dan address (alamat) pada profiles, nullable.

## Keamanan
- Kolom baru tidak dapat diubah langsung oleh klien; hanya Edge Function yang menulisnya.
- Tidak ada perubahan pada RLS atau data yang sudah ada.
*/

DROP FUNCTION IF EXISTS public.admin_create_subuser(text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.admin_create_subuser(text, text, text, text, uuid, text, text);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address text;
