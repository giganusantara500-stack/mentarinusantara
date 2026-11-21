-- Kolom status akun pada profiles.
-- Aman dijalankan ulang di Supabase SQL Editor.
-- Nilai yang dipakai aplikasi: pending, active, suspended.
-- Jika is_active sudah ada, akun nonaktif diisi suspended. Selain itu diisi active.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE public.profiles
  ALTER COLUMN status SET DEFAULT 'active';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'is_active'
  ) THEN
    UPDATE public.profiles
    SET status = CASE WHEN is_active IS FALSE THEN 'suspended' ELSE 'active' END
    WHERE status IS NULL OR btrim(status) = '';
  ELSE
    UPDATE public.profiles
    SET status = 'active'
    WHERE status IS NULL OR btrim(status) = '';
  END IF;
END $$;

ALTER TABLE public.profiles
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_status_check'
      AND conrelid = 'public.profiles'::regclass
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE status NOT IN ('pending', 'active', 'suspended')
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_check
      CHECK (status IN ('pending', 'active', 'suspended'));
  END IF;
END $$;
