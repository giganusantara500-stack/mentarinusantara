/*
# Manajemen Mitra/Sub Mitra/Loket: soft-delete, jenis loket, detail lengkap, edit email

## Tujuan
Menyempurnakan manajemen akun dengan:
1. Soft delete (deleted_at) — tidak menghapus baris, hanya menyembunyikan dari daftar aktif.
   Riwayat transaksi dan mutasi saldo tetap utuh.
2. Kolom `loket_type` pada profiles untuk jenis loket (konter, minimarket, agen, lainnya).
3. Kolom `last_login_at` pada profiles untuk mencatat login terakhir.
4. Fungsi RPC baru: admin_soft_delete_user, admin_restore_user, admin_get_user_detail,
   admin_request_password_reset, admin_update_user_email.
5. Fungsi admin_update_user_details diperluas untuk menerima email, loket_type, dan
   tidak lagi mengizinkan pengubahan akun yang sudah di-soft-delete.

## Kolom baru
- profiles.deleted_at (timestamptz, nullable) — timestamp soft delete. NULL = aktif/tidak dihapus.
- profiles.loket_type (text, nullable, default NULL) — hanya untuk role='loket'.
  Nilai valid: 'konter', 'minimarket', 'agen', 'lainnya'.
- profiles.last_login_at (timestamptz, nullable) — diisi via trigger setelah login.

## Keamanan
- RLS: tidak ada kebijakan baru yang mengizinkan tulis langsung ke kolom baru.
  Kolom deleted_at, loket_type, last_login_at hanya dapat diubah melalui RPC SECURITY DEFINER.
- Semua fungsi baru SECURITY DEFINER, EXECUTE dicabut dari PUBLIC+anon, hanya authenticated.
- Soft delete hanya mengubah deleted_at, tidak menghapus baris → riwayat transaksi & mutasi utuh.
- audit_logs mencatat setiap aksi soft delete, restore, edit email, dan password reset.

## Catatan
- Fungsi `admin_toggle_user_status` tetap ada untuk suspend/activate (berbeda dari soft delete).
- Soft delete mencegah login: auth.users dinonaktifkan via edge function (service_role).
- Profil yang sudah di-soft-delete (deleted_at NOT NULL) tidak muncul di daftar manajemen.
*/

-- 1. Tambah kolom deleted_at, loket_type, last_login_at ke profiles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'deleted_at') THEN
    ALTER TABLE public.profiles ADD COLUMN deleted_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'loket_type') THEN
    ALTER TABLE public.profiles ADD COLUMN loket_type text
      CHECK (loket_type IS NULL OR loket_type IN ('konter','minimarket','agen','lainnya'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'last_login_at') THEN
    ALTER TABLE public.profiles ADD COLUMN last_login_at timestamptz;
  END IF;
END $$;

-- 2. Indeks untuk filter deleted_at pada daftar manajemen
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON public.profiles (deleted_at);
CREATE INDEX IF NOT EXISTS idx_profiles_role_status ON public.profiles (role, status);

-- 3. Fungsi: admin_soft_delete_user
-- Soft delete: set deleted_at = now(), tidak menghapus baris.
-- Mencegah penghapusan Super Admin, diri sendiri, atau akun yang sudah dihapus.
CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(p_target_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin()
     AND NOT (p_target_uid = ANY(public.descendant_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_target_uid = auth.uid() THEN
    RAISE EXCEPTION 'Tidak dapat menghapus akun sendiri';
  END IF;

  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengguna tidak ditemukan'; END IF;
  IF target_profile.role = 'super_admin' THEN
    RAISE EXCEPTION 'Tidak dapat menghapus Super Admin';
  END IF;
  IF target_profile.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Akun sudah dihapus';
  END IF;

  UPDATE public.profiles
    SET deleted_at = now(), status = 'suspended'
    WHERE id = p_target_uid;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'soft_delete_user', 'profile', p_target_uid,
    jsonb_build_object('old_status', target_profile.status, 'soft_deleted', true));

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_soft_delete_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(uuid) TO authenticated;

-- 4. Fungsi: admin_restore_user
-- Membatalkan soft delete: set deleted_at = NULL, status kembali ke 'active'.
CREATE OR REPLACE FUNCTION public.admin_restore_user(p_target_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin()
     AND NOT (p_target_uid = ANY(public.descendant_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengguna tidak ditemukan'; END IF;
  IF target_profile.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Akun tidak dalam status dihapus';
  END IF;

  UPDATE public.profiles
    SET deleted_at = NULL, status = 'active'
    WHERE id = p_target_uid;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'restore_user', 'profile', p_target_uid,
    jsonb_build_object('restored', true));

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_restore_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_user(uuid) TO authenticated;

-- 5. Fungsi: admin_get_user_detail
-- Mengembalikan detail lengkap untuk halaman detail akun:
-- profil, wallet, total deposit, total transaksi, total CMS (profit), total OS,
-- daftar bawahan, riwayat transaksi (10 terakhir), riwayat mutasi (10 terakhir),
-- audit log perubahan akun (10 terakhir), parent + grandparent info.
CREATE OR REPLACE FUNCTION public.admin_get_user_detail(p_target_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller_is_super boolean := public.is_super_admin();
  target_profile public.profiles%ROWTYPE;
  parent_profile public.profiles%ROWTYPE;
  grandparent_profile public.profiles%ROWTYPE;
  wallet_row public.wallets%ROWTYPE;
  total_deposit bigint;
  total_tx_count bigint;
  total_tx_volume bigint;
  total_cms bigint;
  total_os bigint;
  children jsonb;
  recent_tx jsonb;
  recent_mutations jsonb;
  account_changes jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Akses ditolak'; END IF;
  IF NOT caller_is_super
     AND NOT (p_target_uid = auth.uid() OR p_target_uid = ANY(public.descendant_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengguna tidak ditemukan'; END IF;

  -- Parent info
  IF target_profile.parent_id IS NOT NULL THEN
    SELECT id, email, full_name, username, role, status, business_name
      INTO parent_profile FROM public.profiles WHERE id = target_profile.parent_id;
    IF parent_profile.parent_id IS NOT NULL THEN
      SELECT id, email, full_name, username, role, status, business_name
        INTO grandparent_profile FROM public.profiles WHERE id = parent_profile.parent_id;
    END IF;
  END IF;

  -- Wallet
  SELECT * INTO wallet_row FROM public.wallets WHERE user_id = p_target_uid LIMIT 1;

  -- Total deposit (credit entries in wallet_ledger with reference_type='topup')
  SELECT COALESCE(sum(amount), 0) INTO total_deposit
    FROM public.wallet_ledger
    WHERE user_id = p_target_uid AND entry_type = 'credit';

  -- Total transaksi (count + volume for success)
  SELECT count(*), COALESCE(sum(amount), 0)
    INTO total_tx_count, total_tx_volume
    FROM public.transactions
    WHERE user_id = p_target_uid AND status = 'success';

  -- Total CMS (profit from successful transactions)
  SELECT COALESCE(sum(profit), 0) INTO total_cms
    FROM public.transactions
    WHERE user_id = p_target_uid AND status = 'success';

  -- Total OS (outstanding: pending transactions amount)
  SELECT COALESCE(sum(amount), 0) INTO total_os
    FROM public.transactions
    WHERE user_id = p_target_uid AND status = 'pending';

  -- Children (direct subordinates)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email,
    'username', p.username, 'role', p.role, 'status', p.status,
    'business_name', p.business_name, 'phone', p.phone,
    'created_at', p.created_at, 'deleted_at', p.deleted_at
  ) ORDER BY p.created_at DESC), '[]'::jsonb) INTO children
  FROM public.profiles p
  WHERE p.parent_id = p_target_uid AND p.deleted_at IS NULL;

  -- Recent transactions (10 latest)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'invoice_code', t.invoice_code, 'product_name', t.product_name_snapshot,
    'category', t.category_slug_snapshot, 'customer_number', t.customer_number,
    'amount', t.amount, 'profit', t.profit, 'status', t.status,
    'created_at', t.created_at, 'completed_at', t.completed_at
  ) ORDER BY t.created_at DESC), '[]'::jsonb) INTO recent_tx
  FROM public.transactions t
  WHERE t.user_id = p_target_uid
  LIMIT 10;

  -- Recent mutations (10 latest ledger entries)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'entry_type', l.entry_type, 'amount', l.amount,
    'balance_after', l.balance_after, 'reference_type', l.reference_type,
    'description', l.description, 'created_at', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb) INTO recent_mutations
  FROM public.wallet_ledger l
  WHERE l.user_id = p_target_uid
  LIMIT 10;

  -- Account changes (audit logs for this user, 10 latest)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'action', a.action, 'actor_id', a.actor_id,
    'details', a.details, 'created_at', a.created_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb) INTO account_changes
  FROM public.audit_logs a
  WHERE a.target_id = p_target_uid AND a.target_type = 'profile'
  LIMIT 10;

  RETURN jsonb_build_object(
    'profile', jsonb_build_object(
      'id', target_profile.id, 'email', target_profile.email,
      'full_name', target_profile.full_name, 'username', target_profile.username,
      'phone', target_profile.phone, 'business_name', target_profile.business_name,
      'address', target_profile.address, 'role', target_profile.role,
      'parent_id', target_profile.parent_id, 'status', target_profile.status,
      'must_change_password', target_profile.must_change_password,
      'loket_type', target_profile.loket_type,
      'deleted_at', target_profile.deleted_at,
      'last_login_at', target_profile.last_login_at,
      'created_at', target_profile.created_at,
      'updated_at', target_profile.updated_at,
      'created_by', target_profile.created_by
    ),
    'parent', CASE WHEN parent_profile.id IS NOT NULL THEN jsonb_build_object(
      'id', parent_profile.id, 'email', parent_profile.email,
      'full_name', parent_profile.full_name, 'username', parent_profile.username,
      'role', parent_profile.role, 'status', parent_profile.status,
      'business_name', parent_profile.business_name
    ) ELSE NULL END,
    'grandparent', CASE WHEN grandparent_profile.id IS NOT NULL THEN jsonb_build_object(
      'id', grandparent_profile.id, 'email', grandparent_profile.email,
      'full_name', grandparent_profile.full_name, 'username', grandparent_profile.username,
      'role', grandparent_profile.role, 'status', grandparent_profile.status,
      'business_name', grandparent_profile.business_name
    ) ELSE NULL END,
    'wallet', CASE WHEN wallet_row.id IS NOT NULL THEN jsonb_build_object(
      'id', wallet_row.id, 'balance', wallet_row.balance,
      'pending_balance', wallet_row.pending_balance,
      'status', wallet_row.status
    ) ELSE NULL END,
    'total_deposit', total_deposit,
    'total_tx_count', total_tx_count,
    'total_tx_volume', total_tx_volume,
    'total_cms', total_cms,
    'total_os', total_os,
    'children', children,
    'recent_transactions', recent_tx,
    'recent_mutations', recent_mutations,
    'account_changes', account_changes
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) TO authenticated;

-- 6. Fungsi: admin_request_password_reset
-- Memicu Supabase reset password email untuk pengguna target.
-- Hanya mencatat audit log; email dikirim oleh Supabase Auth.
CREATE OR REPLACE FUNCTION public.admin_request_password_reset(p_target_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin()
     AND NOT (p_target_uid = ANY(public.descendant_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_target_uid = auth.uid() THEN
    RAISE EXCEPTION 'Tidak dapat reset password akun sendiri dari sini';
  END IF;

  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengguna tidak ditemukan'; END IF;
  IF target_profile.role = 'super_admin' THEN
    RAISE EXCEPTION 'Tidak dapat reset password Super Admin';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'admin_password_reset_request', 'profile', p_target_uid,
    jsonb_build_object('email', target_profile.email));

  RETURN jsonb_build_object('success', true, 'email', target_profile.email);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_request_password_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_request_password_reset(uuid) TO authenticated;

-- 7. Update admin_update_user_details untuk menerima p_email dan p_loket_type
CREATE OR REPLACE FUNCTION public.admin_update_user_details(
  p_target_uid uuid,
  p_full_name text,
  p_username text,
  p_phone text,
  p_business_name text,
  p_address text,
  p_parent_id uuid,
  p_status text,
  p_loket_type text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller_is_super boolean := public.is_super_admin();
  target_profile public.profiles%ROWTYPE;
  parent_profile public.profiles%ROWTYPE;
  normalized_username text := lower(btrim(p_username));
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  loket_type_val text := NULL;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Akses ditolak'; END IF;
  IF p_target_uid = auth.uid() THEN RAISE EXCEPTION 'Tidak dapat mengubah akun sendiri'; END IF;

  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengguna tidak ditemukan'; END IF;
  IF target_profile.role = 'super_admin' THEN RAISE EXCEPTION 'Tidak dapat mengubah Super Admin'; END IF;
  IF target_profile.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Akun sudah dihapus'; END IF;
  IF NOT caller_is_super AND NOT (p_target_uid = ANY(public.descendant_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF p_status NOT IN ('pending', 'active', 'suspended') THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;
  IF NOT caller_is_super AND p_status = 'pending' THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;

  IF btrim(coalesce(p_full_name, '')) = '' OR btrim(coalesce(p_phone, '')) = ''
     OR btrim(coalesce(p_business_name, '')) = '' OR btrim(coalesce(p_address, '')) = '' THEN
    RAISE EXCEPTION 'Semua field wajib diisi';
  END IF;
  IF normalized_username !~ '^[a-z0-9_.]{3,30}$' THEN
    RAISE EXCEPTION 'Username hanya boleh huruf kecil, angka, titik, dan garis bawah (3-30 karakter)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = normalized_username AND id <> p_target_uid
  ) THEN
    RAISE EXCEPTION 'Username sudah digunakan';
  END IF;

  -- Email: jika berbeda, validasi format dan keunikan di profiles
  IF normalized_email <> '' AND normalized_email <> lower(target_profile.email) THEN
    IF normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Format email tidak valid';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = normalized_email AND id <> p_target_uid) THEN
      RAISE EXCEPTION 'Email sudah digunakan akun lain';
    END IF;
  END IF;

  -- loket_type: hanya untuk role loket
  IF target_profile.role = 'loket' THEN
    loket_type_val := COALESCE(NULLIF(p_loket_type, ''), 'lainnya');
    IF loket_type_val NOT IN ('konter','minimarket','agen','lainnya') THEN
      RAISE EXCEPTION 'Jenis loket tidak valid';
    END IF;
  END IF;

  IF p_parent_id IS NULL THEN RAISE EXCEPTION 'Atasan wajib dipilih'; END IF;
  SELECT * INTO parent_profile FROM public.profiles WHERE id = p_parent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atasan tidak ditemukan'; END IF;
  IF NOT caller_is_super AND NOT (p_parent_id = auth.uid() OR p_parent_id = ANY(public.descendant_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Atasan berada di luar jaringan Anda';
  END IF;
  IF target_profile.role = 'mitra' AND parent_profile.role <> 'super_admin' THEN
    RAISE EXCEPTION 'Mitra harus di bawah Super Admin';
  END IF;
  IF target_profile.role = 'submitra' AND parent_profile.role <> 'mitra' THEN
    RAISE EXCEPTION 'Sub Mitra harus di bawah Mitra';
  END IF;
  IF target_profile.role = 'loket' AND parent_profile.role <> 'submitra' THEN
    RAISE EXCEPTION 'Loket harus di bawah Sub Mitra';
  END IF;

  -- Update email di profiles jika berubah (auth.users diupdate via edge function)
  IF normalized_email <> '' AND normalized_email <> lower(target_profile.email) THEN
    UPDATE public.profiles
    SET full_name = btrim(p_full_name),
        username = normalized_username,
        phone = btrim(p_phone),
        business_name = btrim(p_business_name),
        address = btrim(p_address),
        parent_id = p_parent_id,
        status = p_status,
        email = normalized_email,
        loket_type = loket_type_val,
        updated_at = now()
    WHERE id = p_target_uid;
  ELSE
    UPDATE public.profiles
    SET full_name = btrim(p_full_name),
        username = normalized_username,
        phone = btrim(p_phone),
        business_name = btrim(p_business_name),
        address = btrim(p_address),
        parent_id = p_parent_id,
        status = p_status,
        loket_type = loket_type_val,
        updated_at = now()
    WHERE id = p_target_uid;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'update_user_details', 'profile', p_target_uid,
    jsonb_build_object(
      'old_parent_id', target_profile.parent_id,
      'new_parent_id', p_parent_id,
      'old_status', target_profile.status,
      'new_status', p_status,
      'old_username', target_profile.username,
      'new_username', normalized_username,
      'old_email', target_profile.email,
      'new_email', normalized_email,
      'loket_type', loket_type_val
    ));

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_update_user_details(uuid, text, text, text, text, text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_details(uuid, text, text, text, text, text, uuid, text, text, text) TO authenticated;

-- 8. Update RLS: profile select policies should exclude soft-deleted for network reads
-- (super admin can still see all). We add a new policy that also allows reading
-- soft-deleted profiles for super admin (already covered by is_super_admin policy).
-- For network reads, soft-deleted profiles are still visible to parent (so they can restore).
-- No change needed — existing policies already allow reading via descendant_ids.

-- 9. Trigger: catat last_login_at setelah login
CREATE OR REPLACE FUNCTION public.update_last_login_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.profiles SET last_login_at = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_update_last_login ON auth.users;
CREATE TRIGGER trg_update_last_login
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW
  WHEN (NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at)
  EXECUTE FUNCTION public.update_last_login_at();

REVOKE EXECUTE ON FUNCTION public.update_last_login_at() FROM PUBLIC, anon;
