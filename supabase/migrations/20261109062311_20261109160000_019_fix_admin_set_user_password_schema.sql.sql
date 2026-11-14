/*
# Perbaiki admin_set_user_password — schema-qualify pgcrypto functions

## Latar belakang
Fungsi admin_set_user_password menggunakan gen_salt() dan crypt() dari ekstensi pgcrypto.
Namun di Supabase, pgcrypto terinstal di schema "extensions", bukan "public".
Fungsi tersebut menggunakan SET search_path = public, sehingga gen_salt/crypt tidak
ditemukan dan menyebabkan error "function gen_salt(text) does not exist".

## Perubahan
- Schema-qualify pemanggilan: extensions.gen_salt('bf') dan extensions.crypt().
- Pastikan pgcrypto aktif dengan CREATE EXTENSION IF NOT EXISTS pgcrypto (di schema extensions).
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.admin_set_user_password(p_user_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
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
