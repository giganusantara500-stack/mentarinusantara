/*
  admin_set_user_password mengikuti skema profiles yang sedang dipakai.

  Tidak memakai deleted_at atau status.
  Super Admin boleh mengubah akun mana pun.
  Mitra hanya Sub Mitra dan Loket di pohon parent_id-nya, termasuk yang dibuat bawahannya.
  Sub Mitra hanya Loket di bawahnya atau yang dibuatnya.
  Loket tidak boleh mengubah akun lain.

  service_role tetap diizinkan untuk change-password dan create-subuser.
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
  caller_active boolean;
  target_role text;
  target_parent uuid;
  target_created_by uuid;
  target_active boolean;
  allowed boolean;
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

    SELECT lower(replace(COALESCE(role, ''), '-', '_')), COALESCE(is_active, true)
      INTO caller_role, caller_active
    FROM public.profiles
    WHERE id = caller_id;

    IF caller_role IN ('superadmin', 'super_admin') THEN
      caller_role := 'super_admin';
    ELSIF caller_role = 'sub_mitra' THEN
      caller_role := 'submitra';
    END IF;

    IF caller_role IS NULL OR caller_active IS FALSE THEN
      RAISE EXCEPTION 'Akses ditolak.';
    END IF;

    IF caller_role = 'super_admin' THEN
      NULL;
    ELSIF caller_role = 'mitra' THEN
      SELECT lower(replace(COALESCE(role, ''), '-', '_')), parent_id, created_by, COALESCE(is_active, true)
        INTO target_role, target_parent, target_created_by, target_active
      FROM public.profiles
      WHERE id = p_user_id;

      IF target_role = 'sub_mitra' THEN
        target_role := 'submitra';
      END IF;

      allowed := target_role IN ('submitra', 'loket')
        AND target_active IS TRUE
        AND (
          p_user_id = ANY(public.descendant_ids(caller_id))
          OR target_parent = caller_id
          OR target_parent = ANY(public.descendant_ids(caller_id))
          OR target_created_by = caller_id
          OR target_created_by = ANY(public.descendant_ids(caller_id))
        );

      IF NOT allowed THEN
        RAISE EXCEPTION 'Akses ditolak.';
      END IF;
    ELSIF caller_role = 'submitra' THEN
      SELECT lower(replace(COALESCE(role, ''), '-', '_')), parent_id, created_by, COALESCE(is_active, true)
        INTO target_role, target_parent, target_created_by, target_active
      FROM public.profiles
      WHERE id = p_user_id;

      allowed := target_role = 'loket'
        AND target_active IS TRUE
        AND (
          p_user_id = ANY(public.descendant_ids(caller_id))
          OR target_parent = caller_id
          OR target_created_by = caller_id
        );

      IF NOT allowed THEN
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
