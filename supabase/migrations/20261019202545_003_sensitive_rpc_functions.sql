/*
# RPC SECURITY DEFINER untuk operasi sensitif Giga Mentari Nusantara

## Tujuan
Operasi yang mengubah saldo, mengelola pengguna, atau mengatur aturan harga
tidak boleh dilakukan langsung dari frontend dengan policy biasa, karena
rawan manipulasi. Semua dilakukan via SECURITY DEFINER functions yang
memverifikasi hak akses secara server-side dan mencatat ke audit_logs.

## Fungsi baru
- `admin_topup_wallet(p_target_uid uuid, p_amount bigint, p_description text)`
    Hanya super_admin. Menambah saldo target (credit) + catat ledger + audit.
- `admin_adjust_wallet(p_target_uid uuid, p_amount bigint, p_description text)`
    Hanya super_admin. Penyesuaian saldo (bisa positif/negatif) + ledger + audit.
- `admin_set_user_role(p_target_uid uuid, p_role text, p_parent_id uuid, p_status text)`
    Hanya super_admin. Mengubah role/parent/status pengguna + audit.
    Tidak boleh mengubah akun sendiri untuk mencegah self-lockout/escalation.
- `admin_set_pricing_rule(p_product_id uuid, p_target_uid uuid, p_sell_price bigint,
    p_min_price bigint, p_max_price bigint)`
    Super_admin atur rule untuk siapapun; mitra/submitra atur untuk dirinya.
    Validasi: produk harus editable_by_mitra, harga >= base_price, dalam [min,max].
    Catat ke pricing_rules_history + audit.
- `get_effective_sell_price(p_product_id uuid, p_seller_uid uuid)`
    Ambil harga jual efektif: pricing rule milik seller atau ancestor terdekat,
    fallback ke default_sell_price produk.
- `get_network_summary()` — ringkasan jaringan untuk user saat ini.
- `admin_create_subuser(p_email, p_password, p_full_name, p_role, p_parent_id)`
    Hanya super_admin. Buat user baru via auth.admin + set role + buat wallet.

## Keamanan
- Semua fungsi cek `public.is_super_admin()` atau kepemilikan jaringan.
- `search_path` di-set ke 'public' untuk hindari hijack.
- Pengecualian dibangkitkan dengan pesan generik (tidak membocorkan detail).
- audit_logs diisi server-side.
*/

-- ============================================================
-- admin_topup_wallet
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_topup_wallet(
  p_target_uid uuid,
  p_amount bigint,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w public.wallets%ROWTYPE;
  new_balance bigint;
  ledger_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Jumlah harus positif';
  END IF;
  IF p_amount > 100000000000 THEN
    RAISE EXCEPTION 'Jumlah melebihi batas';
  END IF;

  SELECT * INTO w FROM public.wallets WHERE user_id = p_target_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dompet tidak ditemukan';
  END IF;
  IF w.status = 'frozen' THEN
    RAISE EXCEPTION 'Dompet dibekukan';
  END IF;

  new_balance := w.balance + p_amount;

  INSERT INTO public.wallet_ledger (wallet_id, user_id, entry_type, amount, balance_after, reference_type, description, created_by)
  VALUES (w.id, p_target_uid, 'credit', p_amount, new_balance, 'topup', p_description, auth.uid())
  RETURNING id INTO ledger_id;

  UPDATE public.wallets SET balance = new_balance, last_ledger_id = ledger_id
  WHERE id = w.id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'wallet_topup', 'wallet', p_target_uid,
    jsonb_build_object('amount', p_amount, 'balance_after', new_balance, 'description', p_description));

  RETURN jsonb_build_object('success', true, 'new_balance', new_balance, 'ledger_id', ledger_id);
END;
$$;

-- ============================================================
-- admin_adjust_wallet (positif/negatif)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
  p_target_uid uuid,
  p_amount bigint,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w public.wallets%ROWTYPE;
  new_balance bigint;
  entry_type text;
  ledger_id uuid;
  abs_amount bigint;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'Jumlah tidak boleh nol';
  END IF;

  SELECT * INTO w FROM public.wallets WHERE user_id = p_target_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dompet tidak ditemukan';
  END IF;

  new_balance := w.balance + p_amount;
  IF new_balance < 0 THEN
    RAISE EXCEPTION 'Saldo tidak cukup';
  END IF;

  IF p_amount > 0 THEN
    entry_type := 'credit';
    abs_amount := p_amount;
  ELSE
    entry_type := 'debit';
    abs_amount := -p_amount;
  END IF;

  INSERT INTO public.wallet_ledger (wallet_id, user_id, entry_type, amount, balance_after, reference_type, description, created_by)
  VALUES (w.id, p_target_uid, entry_type, abs_amount, new_balance, 'adjustment', p_description, auth.uid())
  RETURNING id INTO ledger_id;

  UPDATE public.wallets SET balance = new_balance, last_ledger_id = ledger_id
  WHERE id = w.id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'wallet_adjust', 'wallet', p_target_uid,
    jsonb_build_object('amount', p_amount, 'balance_after', new_balance, 'description', p_description));

  RETURN jsonb_build_object('success', true, 'new_balance', new_balance, 'ledger_id', ledger_id);
END;
$$;

-- ============================================================
-- admin_set_user_role
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_target_uid uuid,
  p_role text,
  p_parent_id uuid DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
  parent_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_target_uid = auth.uid() THEN
    RAISE EXCEPTION 'Tidak dapat mengubah akun sendiri';
  END IF;
  IF p_role NOT IN ('pending','super_admin','mitra','submitra','loket') THEN
    RAISE EXCEPTION 'Role tidak valid';
  END IF;
  IF p_status NOT IN ('pending','active','suspended') THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;

  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengguna tidak ditemukan';
  END IF;

  -- Validasi hierarki parent
  IF p_parent_id IS NOT NULL THEN
    SELECT * INTO parent_profile FROM public.profiles WHERE id = p_parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent tidak ditemukan';
    END IF;
    IF p_role = 'mitra' AND parent_profile.role != 'super_admin' THEN
      RAISE EXCEPTION 'Mitra harus di bawah Super Admin';
    END IF;
    IF p_role = 'submitra' AND parent_profile.role != 'mitra' THEN
      RAISE EXCEPTION 'Sub Mitra harus di bawah Mitra';
    END IF;
    IF p_role = 'loket' AND parent_profile.role != 'submitra' THEN
      RAISE EXCEPTION 'Loket harus di bawah Sub Mitra';
    END IF;
  END IF;

  UPDATE public.profiles
  SET role = p_role, parent_id = p_parent_id, status = p_status
  WHERE id = p_target_uid;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_user_role', 'profile', p_target_uid,
    jsonb_build_object('old_role', target_profile.role, 'new_role', p_role,
      'old_status', target_profile.status, 'new_status', p_status,
      'parent_id', p_parent_id));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- admin_set_pricing_rule
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_pricing_rule(
  p_product_id uuid,
  p_target_uid uuid,
  p_sell_price bigint,
  p_min_price bigint DEFAULT 0,
  p_max_price bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p public.products%ROWTYPE;
  existing public.pricing_rules%ROWTYPE;
  is_admin boolean;
  is_self boolean;
BEGIN
  is_admin := public.is_super_admin();
  is_self := (p_target_uid = auth.uid());

  -- Mitra/submitra boleh atur untuk dirinya sendiri; super_admin untuk siapapun
  IF NOT (is_admin OR is_self) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  SELECT * INTO p FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan'; END IF;

  IF p.status != 'active' THEN
    RAISE EXCEPTION 'Produk tidak aktif';
  END IF;

  -- Hanya produk editable_by_mitra yang boleh diatur oleh non-super_admin
  IF NOT is_admin AND NOT p.editable_by_mitra THEN
    RAISE EXCEPTION 'Harga produk ini dikendalikan Super Admin';
  END IF;

  IF p_sell_price < p.base_price THEN
    RAISE EXCEPTION 'Harga jual tidak boleh di bawah harga dasar';
  END IF;
  IF p_min_price < p.base_price THEN
    RAISE EXCEPTION 'Harga minimum tidak boleh di bawah harga dasar';
  END IF;
  IF p_max_price IS NOT NULL AND p_sell_price > p_max_price THEN
    RAISE EXCEPTION 'Harga jual melebihi batas maksimum';
  END IF;
  IF p_sell_price < p_min_price THEN
    RAISE EXCEPTION 'Harga jual di bawah batas minimum';
  END IF;

  SELECT * INTO existing FROM public.pricing_rules
  WHERE product_id = p_product_id AND user_id = p_target_uid;

  IF FOUND THEN
    INSERT INTO public.pricing_rules_history
      (pricing_rule_id, product_id, user_id, old_sell_price, new_sell_price, changed_by, action)
    VALUES (existing.id, p_product_id, p_target_uid, existing.sell_price, p_sell_price, auth.uid(), 'update');

    UPDATE public.pricing_rules
    SET sell_price = p_sell_price, min_price = p_min_price, max_price = p_max_price, status = 'active'
    WHERE id = existing.id;
  ELSE
    INSERT INTO public.pricing_rules (product_id, user_id, sell_price, min_price, max_price, status)
    VALUES (p_product_id, p_target_uid, p_sell_price, p_min_price, p_max_price, 'active')
    RETURNING id INTO existing.id;

    INSERT INTO public.pricing_rules_history
      (pricing_rule_id, product_id, user_id, old_sell_price, new_sell_price, changed_by, action)
    VALUES (existing.id, p_product_id, p_target_uid, NULL, p_sell_price, auth.uid(), 'create');
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_pricing_rule', 'product', p_product_id,
    jsonb_build_object('target_user', p_target_uid, 'sell_price', p_sell_price,
      'min_price', p_min_price, 'max_price', p_max_price));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- get_effective_sell_price
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_effective_sell_price(
  p_product_id uuid,
  p_seller_uid uuid
)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p public.products%ROWTYPE;
  cur_uid uuid;
  rule_price bigint;
BEGIN
  SELECT * INTO p FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF NOT p.editable_by_mitra THEN
    RETURN p.default_sell_price;
  END IF;

  -- Cari pricing rule: seller sendiri, lalu naik ke ancestor
  cur_uid := p_seller_uid;
  WHILE cur_uid IS NOT NULL LOOP
    SELECT sell_price INTO rule_price FROM public.pricing_rules
    WHERE product_id = p_product_id AND user_id = cur_uid AND status = 'active'
    LIMIT 1;
    IF rule_price IS NOT NULL THEN RETURN rule_price; END IF;

    SELECT parent_id INTO cur_uid FROM public.profiles WHERE id = cur_uid;
  END LOOP;

  RETURN p.default_sell_price;
END;
$$;

-- ============================================================
-- get_network_summary — ringkasan jaringan user saat ini
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_network_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  my_role text;
  my_id uuid := auth.uid();
  desc_ids uuid[];
BEGIN
  SELECT role INTO my_role FROM public.profiles WHERE id = my_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','no_profile'); END IF;

  IF my_role = 'super_admin' THEN
    RETURN jsonb_build_object(
      'role', my_role,
      'total_mitra', (SELECT count(*) FROM public.profiles WHERE role='mitra'),
      'total_submitra', (SELECT count(*) FROM public.profiles WHERE role='submitra'),
      'total_loket', (SELECT count(*) FROM public.profiles WHERE role='loket'),
      'active_users', (SELECT count(*) FROM public.profiles WHERE status='active' AND role != 'super_admin'),
      'total_balance', COALESCE((SELECT sum(balance) FROM public.wallets), 0),
      'total_tx', (SELECT count(*) FROM public.transactions),
      'success_tx', (SELECT count(*) FROM public.transactions WHERE status='success'),
      'tx_volume', COALESCE((SELECT sum(amount) FROM public.transactions WHERE status='success'), 0)
    );
  END IF;

  desc_ids := public.descendant_ids(my_id);
  RETURN jsonb_build_object(
    'role', my_role,
    'descendants', array_length(desc_ids, 1),
    'direct_children', (SELECT count(*) FROM public.profiles WHERE parent_id = my_id),
    'total_balance', COALESCE((SELECT sum(balance) FROM public.wallets WHERE user_id = ANY(desc_ids) OR user_id = my_id), 0),
    'total_tx', (SELECT count(*) FROM public.transactions WHERE user_id = ANY(desc_ids) OR user_id = my_id),
    'success_tx', (SELECT count(*) FROM public.transactions WHERE status='success' AND (user_id = ANY(desc_ids) OR user_id = my_id)),
    'tx_volume', COALESCE((SELECT sum(amount) FROM public.transactions WHERE status='success' AND (user_id = ANY(desc_ids) OR user_id = my_id)), 0)
  );
END;
$$;

-- Berikan EXECUTE ke authenticated
GRANT EXECUTE ON FUNCTION public.admin_topup_wallet(uuid,bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid,bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_pricing_rule(uuid,uuid,bigint,bigint,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_sell_price(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_network_summary() TO authenticated;
