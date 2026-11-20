-- Status 2FA Mitra disimpan sebagai boolean dan langsung aktif saat akun dibuat.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;

UPDATE public.profiles
SET mfa_enabled = true
WHERE role = 'mitra' AND mfa_enabled IS DISTINCT FROM true;
