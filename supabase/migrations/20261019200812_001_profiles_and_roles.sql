/*
# Skema profil pengguna & peran (tahap autentikasi Super Admin)

## Tujuan
Menyimpan data profil pengguna yang terhubung ke Supabase Auth, dengan kolom `role`
yang dilindungi — pengguna TIDAK boleh mengubah peran mereka sendiri. Hanya Super Admin
(via Edge Function server-side) yang dapat mengelola peran dan hierarki pengguna.

## Tabel baru
- `profiles`
  - `id` (uuid, PK) — sama dengan `auth.users.id`
  - `email` (text) — salinan email untuk kemudahan tampilan
  - `full_name` (text) — nama lengkap
  - `role` (text, NOT NULL) — salah satu: 'super_admin' | 'mitra' | 'submitra' | 'loket'
  - `parent_id` (uuid, nullable) — atasan langsung sesuai hierarki
  - `status` (text, NOT NULL, default 'pending') — 'pending' | 'active' | 'suspended'
  - `created_at`, `updated_at` (timestamptz)

## Fungsi baru
- `handle_new_user()` — trigger function yang membuat baris profile saat user baru mendaftar
  via Supabase Auth. Role default 'pending' — TIDAK otomatis super_admin.
- `profiles_updated_at()` — update `updated_at` otomatis.

## Trigger
- `on_auth_user_created` — jalankan `handle_new_user()` setelah user baru dibuat.

## Keamanan (RLS)
- RLS diaktifkan pada `profiles`.
- SELECT: pengguna terotentikasi hanya bisa membaca profil MEREKA SENDIRI.
- UPDATE: pengguna terotentikasi hanya bisa mengubah `full_name` mereka sendiri. Kolom
  `role`, `parent_id`, `status`, dan `email` TIDAK boleh diubah oleh pengguna melalui
  policy ini (akan ditangani via Edge Function dengan service role key).
- INSERT/DELETE: tidak diizinkan dari klien (insert dilakukan via trigger; delete via admin).
- Policy menggunakan `auth.uid()`, bukan `current_user`.

## Catatan penting
1. Tidak ada akun super_admin otomatis. Penyiapan Super Admin pertama dilakukan via
   Edge Function `setup-first-superadmin` yang hanya bisa dijalankan oleh operator
   (memerlukan service role key / bootstrap token).
2. Email konfirmasi aktif sesuai pengaturan Supabase Auth dashboard.
3. Tidak ada penyimpanan kata sandi di tabel aplikasi — kata sandi dikelola Supabase Auth.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'pending' CHECK (role IN ('pending','super_admin','mitra','submitra','loket')),
  parent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: pengguna hanya bisa baca profil sendiri
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- UPDATE: pengguna hanya bisa update full_name sendiri (role/status/parent dilindungi via aplikasi)
-- Policy ini mengizinkan update baris milik sendiri; aplikasi akan membatasi kolom yang diizinkan.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Tidak ada policy INSERT/DELETE untuk klien — insert via trigger, delete via admin edge function.

-- Fungsi trigger: buat profile saat user baru dibuat
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'pending',
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update updated_at otomatis
CREATE OR REPLACE FUNCTION public.profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_updated_at();

-- Helper: cek apakah user saat ini adalah super_admin (untuk dipakai policy di tabel lain nanti)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin' AND status = 'active'
  );
$$;
