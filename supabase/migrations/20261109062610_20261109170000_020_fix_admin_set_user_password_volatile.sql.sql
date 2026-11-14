/*
# Perbaiki admin_set_user_password — STABLE → VOLATILE

## Latar belakang
Fungsi admin_set_user_password melakukan UPDATE ke auth.users, tetapi dideklarasikan
sebagai STABLE. PostgreSQL menolak: "UPDATE is not allowed in a non-volatile function".
Fungsi yang memodifikasi data harus VOLATILE.

## Perbaikan
- Ubuh modifier dari STABLE menjadi VOLATILE.
- Tetap menggunakan pgcrypto (crypt + gen_salt) untuk hash bcrypt, melewati cek HIBP.
*/

CREATE OR REPLACE FUNCTION public.admin_set_user_password(p_user_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
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
