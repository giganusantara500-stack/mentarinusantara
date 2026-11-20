/*
  lookup_email_by_username tidak lagi mengembalikan email kontak atau status.

  Skema profiles yang sedang dipakai tidak memiliki deleted_at.
  Akun nonaktif dikenali lewat is_active bila kolom itu ada.
  Fungsi hanya menjawab apakah username masih bisa dipakai untuk login.
*/

DROP FUNCTION IF EXISTS public.lookup_email_by_username(text);

CREATE FUNCTION public.lookup_email_by_username(p_username text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_is_active boolean;
  found boolean;
BEGIN
  IF btrim(COALESCE(p_username, '')) = '' THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'is_active'
  ) INTO has_is_active;

  IF has_is_active THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE lower(username) = lower(btrim($1))
          AND COALESCE(is_active, true) = true
      )
    $q$ INTO found USING p_username;
  ELSE
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE lower(username) = lower(btrim($1))
      )
    $q$ INTO found USING p_username;
  END IF;

  RETURN COALESCE(found, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_email_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_email_by_username(text) TO anon, authenticated;
