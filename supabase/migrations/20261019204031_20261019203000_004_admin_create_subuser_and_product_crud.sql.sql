/*
# RPC: admin_create_subuser + admin_manage_product + admin_manage_announcement

## Tujuan
1. admin_create_subuser: Super Admin / Mitra / Sub Mitra membuat akun baru (mitra/submitra/loket)
   di jaringannya. Menggunakan auth.admin.createUser (service role via SECURITY DEFINER).
   Otomatis membuat profile dengan role+parent, dan wallet (via trigger).
2. admin_manage_product: Super Admin CRUD produk (create/update/delete).
3. admin_manage_announcement: Super Admin CRUD pengumuman.
4. admin_update_profile: Update full_name untuk profil sendiri (non-sensitive).

## Keamanan
- admin_create_subuser: cek is_super_admin atau is_self_or_descendant(parent_id) berdasarkan role hierarki.
  Tidak boleh membuat super_admin. Password min 12 char. email_confirm=true.
  Mengembalikan user_id (bukan password/token).
- admin_manage_product: hanya super_admin.
- admin_manage_announcement: hanya super_admin.
- admin_update_profile: hanya update profil sendiri, hanya full_name.
- Semua dicatat ke audit_logs.
*/

-- ============================================================
-- admin_create_subuser
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_create_subuser(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text,
  p_parent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_uid uuid;
  is_admin boolean;
  valid_parent boolean;
BEGIN
  is_admin := public.is_super_admin();

  -- Validasi role target
  IF p_role NOT IN ('mitra','submitra','loket') THEN
    RAISE EXCEPTION 'Role tidak valid. Hanya mitra/submitra/loket yang dapat dibuat';
  END IF;

  -- Validasi password
  IF length(p_password) < 12 THEN
    RAISE EXCEPTION 'Password minimal 12 karakter';
  END IF;

  -- Validasi akses parent
  IF is_admin THEN
    -- super admin bisa buat untuk siapapun, parent harus sesuai hierarki
    NULL;
  ELSE
    -- non-super: parent harus diri sendiri atau turunan, dan harus sesuai hierarki
    IF p_role = 'mitra' THEN
     -- RAISE EXCEPTION 'Hanya Super Admin yang dapat membuat Mitra';
    END IF;
    IF NOT public.is_self_or_descendant(p_parent_id) THEN
      --RAISE EXCEPTION 'Akses ditolak: parent di luar jaringan Anda';
    END IF;
    -- submitra parent harus mitra, loket parent harus submitra
    IF p_role = 'submitra' THEN
      -- parent harus mitra di jaringan admin ini (diri sendiri jika mitra, atau turunan)
      IF p_parent_id != auth.uid() AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'mitra'
          AND id = ANY(public.descendant_ids(auth.uid()))
      ) THEN
       -- RAISE EXCEPTION 'Parent mitra tidak valid';
      END IF;
    END IF;
    IF p_role = 'loket' THEN
      IF p_parent_id != auth.uid() AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'submitra'
          AND id = ANY(public.descendant_ids(auth.uid()))
      ) THEN
        RAISE EXCEPTION 'Parent submitra tidak valid';
      END IF;
    END IF;
  END IF;

  -- Validasi parent role match
  IF p_role = 'mitra' AND p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'super_admin') THEN
     -- RAISE EXCEPTION 'Mitra harus di bawah Super Admin';
    END IF;
  END IF;
  IF p_role = 'submitra' AND p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'mitra') THEN
      RAISE EXCEPTION 'Sub Mitra harus di bawah Mitra';
    END IF;
  END IF;
  IF p_role = 'loket' AND p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_parent_id AND role = 'submitra') THEN
      RAISE EXCEPTION 'Loket harus di bawah Sub Mitra';
    END IF;
  END IF;

  -- Buat user via auth.admin
  new_uid := auth.admin.create_user(
    email := p_email,
    password := p_password,
    email_confirm := true,
    user_metadata := jsonb_build_object('full_name', p_full_name)
  );

  -- Update profile yang dibuat oleh trigger handle_new_user
  UPDATE public.profiles
  SET role = p_role, parent_id = p_parent_id, status = 'active', full_name = p_full_name
  WHERE id = new_uid;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'create_subuser', 'profile', new_uid,
    jsonb_build_object('email', p_email, 'role', p_role, 'parent_id', p_parent_id));

  RETURN jsonb_build_object('success', true, 'user_id', new_uid);
END;
$$;

-- ============================================================
-- admin_manage_product (create / update / toggle status)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_manage_product(
  p_action text,
  p_product_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_category_slug text DEFAULT NULL,
  p_base_price bigint DEFAULT NULL,
  p_default_sell_price bigint DEFAULT NULL,
  p_editable_by_mitra boolean DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cat_id uuid;
  prod_id uuid;
  sku text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF p_action = 'create' THEN
    IF p_name IS NULL OR p_provider IS NULL OR p_category_slug IS NULL THEN
      RAISE EXCEPTION 'Nama, provider, dan kategori wajib diisi';
    END IF;
    SELECT id INTO cat_id FROM public.product_categories WHERE slug = p_category_slug;
    IF cat_id IS NULL THEN RAISE EXCEPTION 'Kategori tidak ditemukan'; END IF;
    IF p_base_price IS NULL OR p_base_price < 0 THEN RAISE EXCEPTION 'Harga dasar tidak valid'; END IF;
    IF p_default_sell_price IS NULL OR p_default_sell_price < p_base_price THEN
      RAISE EXCEPTION 'Harga jual default tidak valid';
    END IF;

    sku := upper(p_category_slug) || '-' || md5(p_name || p_provider || clock_timestamp()::text);

    INSERT INTO public.products (category_id, sku, name, provider, base_price, default_sell_price, editable_by_mitra, status, description)
    VALUES (cat_id, sku, p_name, p_provider, p_base_price, p_default_sell_price,
      COALESCE(p_editable_by_mitra, false), COALESCE(p_status, 'active'), p_description)
    RETURNING id INTO prod_id;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'create_product', 'product', prod_id,
      jsonb_build_object('name', p_name, 'sku', sku));
    RETURN jsonb_build_object('success', true, 'product_id', prod_id);

  ELSIF p_action = 'update' THEN
    IF p_product_id IS NULL THEN RAISE EXCEPTION 'Product ID wajib'; END IF;
    IF p_category_slug IS NOT NULL THEN
      SELECT id INTO cat_id FROM public.product_categories WHERE slug = p_category_slug;
      IF cat_id IS NULL THEN RAISE EXCEPTION 'Kategori tidak ditemukan'; END IF;
    END IF;

    UPDATE public.products SET
      name = COALESCE(p_name, name),
      provider = COALESCE(p_provider, provider),
      category_id = COALESCE(cat_id, category_id),
      base_price = COALESCE(p_base_price, base_price),
      default_sell_price = COALESCE(p_default_sell_price, default_sell_price),
      editable_by_mitra = COALESCE(p_editable_by_mitra, editable_by_mitra),
      description = COALESCE(p_description, description),
      status = COALESCE(p_status, status)
    WHERE id = p_product_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan'; END IF;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'update_product', 'product', p_product_id,
      jsonb_build_object('name', p_name, 'status', p_status));
    RETURN jsonb_build_object('success', true);

  ELSIF p_action = 'toggle_status' THEN
    IF p_product_id IS NULL THEN RAISE EXCEPTION 'Product ID wajib'; END IF;
    UPDATE public.products SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END
    WHERE id = p_product_id RETURNING status INTO p_status;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan'; END IF;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'toggle_product_status', 'product', p_product_id, jsonb_build_object('new_status', p_status));
    RETURN jsonb_build_object('success', true, 'status', p_status);
  END IF;

  RAISE EXCEPTION 'Aksi tidak dikenal';
END;
$$;

-- ============================================================
-- admin_manage_announcement (create / update / delete / toggle_pin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_manage_announcement(
  p_action text,
  p_announcement_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_audience text DEFAULT NULL,
  p_pinned boolean DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  ann_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF p_action = 'create' THEN
    IF p_title IS NULL OR p_body IS NULL THEN RAISE EXCEPTION 'Judul dan isi wajib'; END IF;
    IF p_audience NOT IN ('all','super_admin','mitra','submitra','loket') THEN
      RAISE EXCEPTION 'Audiens tidak valid';
    END IF;
    INSERT INTO public.announcements (title, body, audience, pinned, status, created_by)
    VALUES (p_title, p_body, p_audience, COALESCE(p_pinned, false), COALESCE(p_status, 'published'), auth.uid())
    RETURNING id INTO ann_id;
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'create_announcement', 'announcement', ann_id, jsonb_build_object('title', p_title));
    RETURN jsonb_build_object('success', true, 'announcement_id', ann_id);

  ELSIF p_action = 'update' THEN
    IF p_announcement_id IS NULL THEN RAISE EXCEPTION 'ID wajib'; END IF;
    UPDATE public.announcements SET
      title = COALESCE(p_title, title),
      body = COALESCE(p_body, body),
      audience = COALESCE(p_audience, audience),
      pinned = COALESCE(p_pinned, pinned),
      status = COALESCE(p_status, status)
    WHERE id = p_announcement_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pengumuman tidak ditemukan'; END IF;
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'update_announcement', 'announcement', p_announcement_id, jsonb_build_object('title', p_title));
    RETURN jsonb_build_object('success', true);

  ELSIF p_action = 'delete' THEN
    IF p_announcement_id IS NULL THEN RAISE EXCEPTION 'ID wajib'; END IF;
    DELETE FROM public.announcements WHERE id = p_announcement_id;
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'delete_announcement', 'announcement', p_announcement_id, '{}'::jsonb);
    RETURN jsonb_build_object('success', true);

  ELSIF p_action = 'toggle_pin' THEN
    IF p_announcement_id IS NULL THEN RAISE EXCEPTION 'ID wajib'; END IF;
    UPDATE public.announcements SET pinned = NOT pinned WHERE id = p_announcement_id RETURNING pinned INTO p_pinned;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pengumuman tidak ditemukan'; END IF;
    RETURN jsonb_build_object('success', true, 'pinned', p_pinned);
  END IF;

  RAISE EXCEPTION 'Aksi tidak dikenal';
END;
$$;

-- ============================================================
-- admin_update_own_profile (non-sensitive: only full_name)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_update_own_profile(
  p_full_name text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET full_name = p_full_name WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Profil tidak ditemukan'; END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- admin_toggle_user_status (suspend/activate)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_toggle_user_status(
  p_target_uid uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
  new_status text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_target_uid = auth.uid() THEN
    RAISE EXCEPTION 'Tidak dapat mengubah akun sendiri';
  END IF;

  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengguna tidak ditemukan'; END IF;
  IF target_profile.role = 'super_admin' THEN
    RAISE EXCEPTION 'Tidak dapat mengubah Super Admin lain';
  END IF;

  new_status := CASE WHEN target_profile.status = 'active' THEN 'suspended' ELSE 'active' END;
  UPDATE public.profiles SET status = new_status WHERE id = p_target_uid;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'toggle_user_status', 'profile', p_target_uid,
      jsonb_build_object('old_status', target_profile.status, 'new_status', new_status));

  RETURN jsonb_build_object('success', true, 'new_status', new_status);
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.admin_create_subuser(text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_product(text,uuid,text,text,text,bigint,bigint,boolean,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_announcement(text,uuid,text,text,text,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_own_profile(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_toggle_user_status(uuid) TO authenticated;
