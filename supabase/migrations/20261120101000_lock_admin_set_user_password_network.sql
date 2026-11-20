/*
  Kunci admin_set_user_password ke jaringan pemanggil.

  Super Admin boleh mengubah akun mana pun.
  Mitra hanya boleh mengubah Sub Mitra dan Loket di bawah parent_id-nya.
  Sub Mitra hanya boleh mengubah Loket di bawahnya.
  Loket dan peran lain tidak boleh mengubah akun siapa pun lewat fungsi ini.

  Panggilan service_role (Edge Function change-password dan create-subuser)
  tetap diizinkan. reset-password-temp memakai JWT pengguna, jadi ikut aturan ini.
*/

CREATE OR REPLACE FUNCTION public.admin_set_user_password(p_user_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  jwt_role text := '';
  claims text;
  caller_id uuid;
  caller_role text;
  caller_status text;
  target_role text;
  target_deleted timestamptz;
BEGIN
  IF char_length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password minimal 6 karakter.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Pengguna tidak ditemukan.';
  END IF;

  jwt_role := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), '');
  IF jwt_role = '' THEN
    claims := current_setting('request.jwt.claims', true);
    IF claims IS NOT NULL AND btrim(claims) <> '' THEN
      BEGIN
        jwt_role := COALESCE(claims::json->>'role', '');
      EXCEPTION WHEN OTHERS THEN
        jwt_role := '';
      END;
    END IF;
  END IF;

  IF jwt_role IS DISTINCT FROM 'service_role' THEN
    caller_id := auth.uid();
    IF caller_id IS NULL THEN
      RAISE EXCEPTION 'Akses ditolak.';
    END IF;

    SELECT role, status
      INTO caller_role, caller_status
    FROM public.profiles
    WHERE id = caller_id
      AND deleted_at IS NULL;

    IF caller_role IS NULL OR caller_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Akses ditolak.';
    END IF;

    IF caller_role = 'super_admin' THEN
      NULL;
    ELSIF caller_role = 'mitra' THEN
      SELECT role, deleted_at
        INTO target_role, target_deleted
      FROM public.profiles
      WHERE id = p_user_id;

      IF target_role IS NULL
         OR target_deleted IS NOT NULL
         OR target_role NOT IN ('submitra', 'loket')
         OR NOT (p_user_id = ANY(public.descendant_ids(caller_id))) THEN
        RAISE EXCEPTION 'Akses ditolak.';
      END IF;
    ELSIF caller_role = 'submitra' THEN
      SELECT role, deleted_at
        INTO target_role, target_deleted
      FROM public.profiles
      WHERE id = p_user_id;

      IF target_role IS DISTINCT FROM 'loket'
         OR target_deleted IS NOT NULL
         OR NOT (p_user_id = ANY(public.descendant_ids(caller_id))) THEN
        RAISE EXCEPTION 'Akses ditolak.';
      END IF;
    ELSE
      RAISE EXCEPTION 'Akses ditolak.';
    END IF;
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf'))
  WHERE id = p_user_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated, service_role;
