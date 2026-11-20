-- Pembuatan akun hierarki dilakukan lewat service role (bypass RLS).
-- Trigger ini tidak boleh menggagalkan auth.users jika skema profiles berbeda.
-- Super Admin, Mitra, dan Sub Mitra tetap tidak menulis profiles langsung dari klien.

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
BEGIN
  IF resolved IS NULL THEN
    RETURN NEW;
  END IF;
  IF username_value IS NULL THEN
    username_value := split_part(coalesce(NEW.email, 'akun'), '@', 1);
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, username, role)
    VALUES (NEW.id, username_value, resolved)
    ON CONFLICT (id) DO UPDATE
      SET role = EXCLUDED.role,
          username = COALESCE(public.profiles.username, EXCLUDED.username);
  EXCEPTION WHEN undefined_column OR not_null_violation OR check_violation THEN
    BEGIN
      INSERT INTO public.profiles (id, email, full_name, role, status)
      VALUES (
        NEW.id,
        coalesce(NEW.email, ''),
        coalesce(NEW.raw_user_meta_data->>'full_name', ''),
        resolved,
        'active'
      )
      ON CONFLICT (id) DO UPDATE
        SET role = EXCLUDED.role,
            status = 'active';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user fallback: %', SQLERRM;
    END;
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
