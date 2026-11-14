/*
# Tambah kolom username dan phone pada profiles + update admin_create_subuser

## Tujuan
1. Tambah kolom `username` (text, unique, nullable) dan `phone` (text, nullable) ke tabel `profiles`.
2. Update fungsi `admin_create_subuser` agar menerima p_username dan p_phone, dengan validasi:
   - Username unik (jika diberikan)
   - Username tidak boleh kosong (wajib diisi saat pembuatan akun)
3. Tambahkan index pada username untuk pencarian cepat.
4. Update RLS: username dan phone tidak boleh diubah langsung oleh klien (hanya melalui RPC).

## Perubahan Kolom
- `profiles.username` text, nullable (untuk akun lama yang belum punya username)
- `profiles.phone` text, nullable

## Keamanan
- Kolom username dan phone TIDAK dimasukkan ke GRANT UPDATE untuk authenticated (hanya full_name yang bisa diupdate sendiri).
- admin_create_subuser menerima p_username dan p_phone, disimpan saat pembuatan akun.
- Validasi uniqueness username dilakukan server-side di dalam RPC.
- Tidak ada perubahan pada kebijakan RLS yang ada.
*/

-- 1. Tambah kolom username dan phone
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;

-- 2. Unique constraint pada username (partial — hanya untuk non-null)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_key'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
  END IF;
END $$;

-- 3. Index untuk pencarian username
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles (username) WHERE username IS NOT NULL;

-- 4. Update admin_create_subuser agar menerima username + phone
CREATE OR REPLACE FUNCTION public.admin_create_subuser(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text,
  p_parent_id uuid,
  p_username text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_uid uuid;
  is_admin boolean;
  valid_parent boolean;
  username_clean text;
BEGIN
  is_admin := public.is_super_admin();

  -- Validasi role target
  IF p_role NOT IN ('mitra','submitra','loket') THEN
    RAISE EXCEPTION 'Role tidak valid. Hanya mitra/submitra/loket yang dapat dibuat';
  END IF;

  -- Validasi password
  IF length(p_password) < 12 THEN
    RAISE EXCEPTION 'Password minimal 12 karakter';
  END IF;

  -- Validasi username wajib dan unik
  username_clean := BTRIM(COALESCE(p_username, ''));
  IF username_clean = '' THEN
    RAISE EXCEPTION 'Username wajib diisi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = username_clean) THEN
    RAISE EXCEPTION 'Username sudah digunakan';
  END IF;

  -- Validasi email unik (auth.admin.create_user akan error jika duplikat, tapi kita cek dulu untuk pesan jelas)
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = p_email) THEN
    RAISE EXCEPTION 'Email sudah terdaftar';
  END IF;

  -- Validasi akses parent
  IF is_admin THEN
    NULL;
  ELSE
    IF p_role = 'mitra' THEN
      RAISE EXCEPTION 'Hanya Super Admin yang dapat membuat Mitra';
    END IF;
    IF NOT public.is_self_or_descendant(p_parent_id) THEN
      RAISE EXCEPTION 'Akses ditolak: parent di luar jaringan Anda';
    END IF;
    IF p_role = 'submitra' THEN
      IF p_parent_id != auth.uid() AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'mitra'
          AND id = ANY(public.descendant_ids(auth.uid()))
      ) THEN
        RAISE EXCEPTION 'Parent mitra tidak valid';
      END IF;
    END IF;
    IF p_role = 'loket' THEN
      IF p_parent_id != auth.uid() AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'submitra'
          AND id = ANY(public.descendant_ids(auth.uid()))
      ) THEN
        RAISE EXCEPTION 'Parent submitra tidak valid';
      END IF;
    END IF;
  END IF;

  -- Validasi parent role match
  IF p_role = 'mitra' AND p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'super_admin') THEN
      RAISE EXCEPTION 'Mitra harus di bawah Super Admin';
    END IF;
  END IF;
  IF p_role = 'submitra' AND p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'mitra') THEN
      RAISE EXCEPTION 'Sub Mitra harus di bawah Mitra';
    END IF;
  END IF;
  IF p_role = 'loket' AND p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'submitra') THEN
      RAISE EXCEPTION 'Loket harus di bawah Sub Mitra';
    END IF;
  END IF;

  -- Buat user via auth.admin
  new_uid := auth.admin.create_user(
    email := p_email,
    password := p_password,
    email_confirm := true,
    user_metadata := jsonb_build_object('full_name', p_full_name, 'username', username_clean, 'phone', p_phone)
  );

  -- Update profile yang dibuat oleh trigger handle_new_user
  UPDATE public.profiles
  SET role = p_role, parent_id = p_parent_id, status = 'active',
      full_name = p_full_name, username = username_clean, phone = p_phone
  WHERE id = new_uid;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'create_subuser', 'profile', new_uid,
    jsonb_build_object('email', p_email, 'role', p_role, 'parent_id', p_parent_id,
      'username', username_clean, 'phone', p_phone));

  RETURN jsonb_build_object('success', true, 'user_id', new_uid);
END;
$$;

-- Revoke execute dari anon/public (keamanan)
REVOKE EXECUTE ON FUNCTION public.admin_create_subuser(text, text, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_subuser(text, text, text, text, uuid, text, text) TO authenticated;
