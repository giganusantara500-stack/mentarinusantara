-- Loket boleh berada langsung di bawah Mitra atau di bawah Sub Mitra.
-- Hak buat akun: Super Admin -> mitra, Mitra -> submitra/loket, Sub Mitra -> loket.
-- Rekap jaringan tetap memakai descendant_ids, jadi transaksi loket terlihat
-- oleh Sub Mitra (jika ada), Mitra di atasnya, dan seluruhnya oleh Super Admin.

CREATE OR REPLACE FUNCTION public.get_network_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_role text;
  my_id uuid := auth.uid();
  desc_ids uuid[];
BEGIN
  SELECT role INTO my_role FROM public.profiles WHERE id = my_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'no_profile'); END IF;

  IF my_role = 'super_admin' THEN
    RETURN jsonb_build_object(
      'role', my_role,
      'total_mitra', (SELECT count(*) FROM public.profiles WHERE role = 'mitra' AND deleted_at IS NULL),
      'total_submitra', (SELECT count(*) FROM public.profiles WHERE role IN ('submitra', 'sub_mitra') AND deleted_at IS NULL),
      'total_loket', (SELECT count(*) FROM public.profiles WHERE role = 'loket' AND deleted_at IS NULL),
      'active_users', (SELECT count(*) FROM public.profiles WHERE status = 'active' AND role <> 'super_admin' AND deleted_at IS NULL),
      'total_balance', COALESCE((SELECT sum(balance) FROM public.wallets), 0),
      'total_tx', (SELECT count(*) FROM public.transactions),
      'success_tx', (SELECT count(*) FROM public.transactions WHERE status = 'success'),
      'tx_volume', COALESCE((SELECT sum(amount) FROM public.transactions WHERE status = 'success'), 0)
    );
  END IF;

  desc_ids := COALESCE(public.descendant_ids(my_id), ARRAY[]::uuid[]);
  RETURN jsonb_build_object(
    'role', my_role,
    'descendants', cardinality(desc_ids),
    'direct_children', (SELECT count(*) FROM public.profiles WHERE parent_id = my_id AND deleted_at IS NULL),
    'sub_mitra_count', (SELECT count(*) FROM public.profiles WHERE role IN ('submitra', 'sub_mitra') AND id = ANY(desc_ids) AND deleted_at IS NULL),
    'loket_count', (SELECT count(*) FROM public.profiles WHERE role = 'loket' AND id = ANY(desc_ids) AND deleted_at IS NULL),
    'total_balance', COALESCE((SELECT sum(balance) FROM public.wallets WHERE user_id = ANY(desc_ids) OR user_id = my_id), 0),
    'total_tx', (SELECT count(*) FROM public.transactions WHERE user_id = ANY(desc_ids) OR user_id = my_id),
    'success_tx', (SELECT count(*) FROM public.transactions WHERE status = 'success' AND (user_id = ANY(desc_ids) OR user_id = my_id)),
    'tx_volume', COALESCE((SELECT sum(amount) FROM public.transactions WHERE status = 'success' AND (user_id = ANY(desc_ids) OR user_id = my_id)), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_target_uid uuid,
  p_role text,
  p_parent_id uuid DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
  parent_profile public.profiles%ROWTYPE;
  parent_role text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_target_uid = auth.uid() THEN
    RAISE EXCEPTION 'Tidak dapat mengubah akun sendiri';
  END IF;
  IF p_role NOT IN ('pending', 'super_admin', 'mitra', 'submitra', 'loket') THEN
    RAISE EXCEPTION 'Role tidak valid';
  END IF;
  IF p_status NOT IN ('pending', 'active', 'suspended') THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;

  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengguna tidak ditemukan';
  END IF;

  IF p_parent_id IS NOT NULL THEN
    SELECT * INTO parent_profile FROM public.profiles WHERE id = p_parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent tidak ditemukan';
    END IF;
    parent_role := CASE WHEN parent_profile.role = 'sub_mitra' THEN 'submitra' ELSE parent_profile.role END;
    IF p_role = 'mitra' AND parent_role <> 'super_admin' THEN
      RAISE EXCEPTION 'Mitra harus di bawah Super Admin';
    END IF;
    IF p_role = 'submitra' AND parent_role <> 'mitra' THEN
      RAISE EXCEPTION 'Sub Mitra harus di bawah Mitra';
    END IF;
    IF p_role = 'loket' AND parent_role NOT IN ('mitra', 'submitra') THEN
      RAISE EXCEPTION 'Loket harus di bawah Mitra atau Sub Mitra';
    END IF;
  END IF;

  UPDATE public.profiles
  SET role = p_role, parent_id = p_parent_id, status = p_status
  WHERE id = p_target_uid;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_user_role', 'profile', p_target_uid,
    jsonb_build_object(
      'old_role', target_profile.role, 'new_role', p_role,
      'old_status', target_profile.status, 'new_status', p_status,
      'parent_id', p_parent_id
    ));

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_subuser(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text,
  p_parent_id uuid,
  p_username text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_uid uuid;
  caller_role text;
  parent_role text;
  username_clean text;
  normalized_role text;
BEGIN
  SELECT CASE WHEN role = 'sub_mitra' THEN 'submitra' ELSE role END
    INTO caller_role
  FROM public.profiles
  WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL;

  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  normalized_role := CASE WHEN p_role = 'sub_mitra' THEN 'submitra' ELSE p_role END;
  IF normalized_role NOT IN ('mitra', 'submitra', 'loket') THEN
    RAISE EXCEPTION 'Role tidak valid. Hanya mitra, sub mitra, atau loket yang dapat dibuat';
  END IF;
  IF caller_role = 'super_admin' AND normalized_role <> 'mitra' THEN
    RAISE EXCEPTION 'Super Admin hanya dapat membuat Mitra';
  END IF;
  IF caller_role = 'mitra' AND normalized_role NOT IN ('submitra', 'loket') THEN
    RAISE EXCEPTION 'Mitra hanya dapat membuat Sub Mitra atau Loket';
  END IF;
  IF caller_role = 'submitra' AND normalized_role <> 'loket' THEN
    RAISE EXCEPTION 'Sub Mitra hanya dapat membuat Loket';
  END IF;
  IF caller_role NOT IN ('super_admin', 'mitra', 'submitra') THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password minimal 6 karakter';
  END IF;

  username_clean := BTRIM(COALESCE(p_username, ''));
  IF username_clean = '' THEN
    RAISE EXCEPTION 'Username wajib diisi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = username_clean) THEN
    RAISE EXCEPTION 'Username sudah digunakan';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = p_email) THEN
    RAISE EXCEPTION 'Email sudah terdaftar';
  END IF;

  IF caller_role <> 'super_admin' AND NOT public.is_self_or_descendant(p_parent_id) THEN
    RAISE EXCEPTION 'Akses ditolak: parent di luar jaringan Anda';
  END IF;

  SELECT CASE WHEN role = 'sub_mitra' THEN 'submitra' ELSE role END
    INTO parent_role
  FROM public.profiles
  WHERE id = p_parent_id AND status = 'active' AND deleted_at IS NULL;

  IF parent_role IS NULL THEN
    RAISE EXCEPTION 'Atasan tidak ditemukan atau tidak aktif';
  END IF;
  IF normalized_role = 'mitra' AND (parent_role <> 'super_admin' OR p_parent_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Mitra harus di bawah Super Admin yang membuatnya';
  END IF;
  IF normalized_role = 'submitra' AND (parent_role <> 'mitra' OR p_parent_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Sub Mitra harus langsung di bawah Mitra yang membuatnya';
  END IF;
  IF normalized_role = 'loket' AND parent_role NOT IN ('mitra', 'submitra') THEN
    RAISE EXCEPTION 'Loket harus di bawah Mitra atau Sub Mitra';
  END IF;
  IF caller_role = 'submitra' AND p_parent_id <> auth.uid() THEN
    RAISE EXCEPTION 'Sub Mitra hanya dapat membuat loket di bawah akunnya sendiri';
  END IF;
  IF caller_role = 'mitra' AND normalized_role = 'loket' AND p_parent_id <> auth.uid() AND parent_role <> 'submitra' THEN
    RAISE EXCEPTION 'Loket hanya dapat berada di bawah Mitra atau Sub Mitra di jaringannya';
  END IF;

  new_uid := auth.admin.create_user(
    email := p_email,
    password := p_password,
    email_confirm := true,
    user_metadata := jsonb_build_object('full_name', p_full_name, 'username', username_clean, 'phone', p_phone)
  );

  UPDATE public.profiles
  SET role = normalized_role,
      parent_id = p_parent_id,
      status = 'active',
      full_name = p_full_name,
      username = username_clean,
      phone = p_phone,
      must_change_password = true
  WHERE id = new_uid;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'create_subuser', 'profile', new_uid,
    jsonb_build_object('email', p_email, 'role', normalized_role, 'parent_id', p_parent_id,
      'username', username_clean, 'phone', p_phone));

  RETURN jsonb_build_object('success', true, 'user_id', new_uid);
END;
$$;

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
SET search_path = public
AS $$
DECLARE
  caller_is_super boolean := public.is_super_admin();
  target_profile public.profiles%ROWTYPE;
  parent_profile public.profiles%ROWTYPE;
  normalized_username text := lower(btrim(p_username));
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  loket_type_val text := NULL;
  parent_role text;
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
  IF normalized_username !~ '^[a-z0-9_.]{3,30}$' THEN
    RAISE EXCEPTION 'Username hanya boleh huruf kecil, angka, titik, dan garis bawah (3-30 karakter)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = normalized_username AND id <> p_target_uid
  ) THEN
    RAISE EXCEPTION 'Username sudah digunakan';
  END IF;

  IF normalized_email <> '' AND normalized_email <> lower(target_profile.email) THEN
    IF normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Format email tidak valid';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = normalized_email AND id <> p_target_uid) THEN
      RAISE EXCEPTION 'Email sudah digunakan akun lain';
    END IF;
  END IF;

  IF target_profile.role = 'loket' THEN
    loket_type_val := COALESCE(NULLIF(p_loket_type, ''), 'lainnya');
    IF loket_type_val NOT IN ('konter', 'minimarket', 'agen', 'lainnya') THEN
      RAISE EXCEPTION 'Jenis loket tidak valid';
    END IF;
  END IF;

  IF p_parent_id IS NULL THEN RAISE EXCEPTION 'Atasan wajib dipilih'; END IF;
  SELECT * INTO parent_profile FROM public.profiles WHERE id = p_parent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atasan tidak ditemukan'; END IF;
  IF NOT caller_is_super AND NOT (p_parent_id = auth.uid() OR p_parent_id = ANY(public.descendant_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Atasan berada di luar jaringan Anda';
  END IF;

  parent_role := CASE WHEN parent_profile.role = 'sub_mitra' THEN 'submitra' ELSE parent_profile.role END;
  IF target_profile.role = 'mitra' AND parent_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Mitra harus di bawah Super Admin';
  END IF;
  IF target_profile.role IN ('submitra', 'sub_mitra') AND parent_role <> 'mitra' THEN
    RAISE EXCEPTION 'Sub Mitra harus di bawah Mitra';
  END IF;
  IF target_profile.role = 'loket' AND parent_role NOT IN ('mitra', 'submitra') THEN
    RAISE EXCEPTION 'Loket harus di bawah Mitra atau Sub Mitra';
  END IF;

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
      'loket_type', loket_type_val
    ));

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_network_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_network_summary() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_create_subuser(text, text, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_subuser(text, text, text, text, uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_details(uuid, text, text, text, text, text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_details(uuid, text, text, text, text, text, uuid, text, text, text) TO authenticated;
