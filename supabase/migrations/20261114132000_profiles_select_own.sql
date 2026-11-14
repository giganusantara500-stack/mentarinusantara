-- Pengguna yang sudah login boleh membaca baris profilnya sendiri.
-- Peran dan status tetap tidak bisa diubah dari klien.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);
