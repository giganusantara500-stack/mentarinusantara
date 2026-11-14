-- Akun baru mengambil peran dari metadata pendaftaran dan langsung aktif.
-- Peran yang tidak dikenali tidak lagi ditulis sebagai 'pending'.
-- Fungsi ini menyesuaikan skema profiles yang memakai is_active maupun status.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_role text := lower(replace(coalesce(NEW.raw_user_meta_data->>'role', ''), ' ', '_'));
  resolved text := CASE
    WHEN raw_role IN ('superadmin', 'super_admin') THEN 'super_admin'
    WHEN raw_role IN ('sub_mitra', 'submitra') THEN 'submitra'
    WHEN raw_role IN ('mitra', 'loket') THEN raw_role
    ELSE NULL
  END;
  username_value text := nullif(btrim(coalesce(NEW.raw_user_meta_data->>'username', '')), '');
  full_name_value text := coalesce(NEW.raw_user_meta_data->>'full_name', '');
  has_is_active boolean;
  has_status boolean;
BEGIN
  IF resolved IS NULL THEN
    RETURN NEW;
  END IF;
  IF username_value IS NULL OR username_value = '' THEN
    username_value := split_part(coalesce(NEW.email, 'akun'), '@', 1);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_active'
  ) INTO has_is_active;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'status'
  ) INTO has_status;

  IF has_is_active THEN
    BEGIN
      INSERT INTO public.profiles (id, username, role, is_active)
      VALUES (NEW.id, username_value, resolved, true)
      ON CONFLICT (id) DO UPDATE
        SET role = EXCLUDED.role,
            is_active = true,
            username = COALESCE(public.profiles.username, EXCLUDED.username)
        WHERE public.profiles.role IS NULL
           OR btrim(public.profiles.role) = ''
           OR public.profiles.role = 'pending';
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.profiles
      SET role = resolved, is_active = true
      WHERE id = NEW.id
        AND (role IS NULL OR btrim(role) = '' OR role = 'pending');
    END;
  ELSIF has_status THEN
    BEGIN
      INSERT INTO public.profiles (id, email, full_name, role, status)
      VALUES (NEW.id, coalesce(NEW.email, ''), full_name_value, resolved, 'active')
      ON CONFLICT (id) DO UPDATE
        SET role = EXCLUDED.role,
            status = 'active'
        WHERE public.profiles.role IS NULL
           OR btrim(public.profiles.role) = ''
           OR public.profiles.role = 'pending';
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.profiles
      SET role = resolved, status = 'active'
      WHERE id = NEW.id
        AND (role IS NULL OR btrim(role) = '' OR role = 'pending');
    END;
  END IF;

  IF has_is_active AND has_status THEN
    UPDATE public.profiles
    SET status = 'active'
    WHERE id = NEW.id
      AND role = resolved
      AND status IS DISTINCT FROM 'suspended';
  END IF;

  RETURN NEW;
END;
$$;
