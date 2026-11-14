/*
# Skema inti platform Giga Mentari Nusantara (produksi)

## Tujuan
Membangun fondasi database lengkap untuk platform PPOB multi-level:
produk, kategori, aturan harga, dompet saldo, ledger, transaksi,
riwayat status transaksi, pengumuman, audit log, dan struktur organisasi.

## Tabel baru
- `product_categories` — master kategori produk (pulsa, paket_data, dst.)
- `products` — katalog produk PPOB dengan harga dasar
- `pricing_rules` — aturan harga jual per mitra/submitra/loket (override default)
- `pricing_rules_history` — riwayat perubahan aturan harga (audit)
- `wallets` — dompet saldo per pengguna (satu per user)
- `wallet_ledger` — catatan mutasi saldo (immutable, audit-ready)
- `transactions` — transaksi PPOB dengan ID unik & status
- `transaction_status_history` — riwayat perubahan status transaksi
- `announcements` — pengumuman platform
- `audit_logs` — catatan aksi sensitif

## Keamanan
- RLS diaktifkan di SEMUA tabel.
- Pengguna hanya bisa membaca/mengubah data miliknya atau jaringan di bawahnya.
- Operasi yang mengubah saldo, transaksi, harga, atau role TIDAK boleh
  dilakukan langsung dari frontend — harus melalui SECURITY DEFINER function
  atau Edge Function dengan service role key.
*/

-- ============================================================
-- Helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_active_role(p_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = p_role
      AND status = 'active'
  );
$$;

-- Turunan langsung/tidak langsung dari sebuah user (hierarki parent_id)
CREATE OR REPLACE FUNCTION public.descendant_ids(p_ancestor uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE tree AS (
    SELECT id FROM public.profiles WHERE parent_id = p_ancestor
    UNION
    SELECT p.id FROM public.profiles p JOIN tree t ON p.parent_id = t.id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) FROM tree;
$$;

-- Apakah p_uid = auth.uid() atau turunan dari auth.uid()
CREATE OR REPLACE FUNCTION public.is_self_or_descendant(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_uid = auth.uid() OR p_uid = ANY(public.descendant_ids(auth.uid()));
$$;

-- ============================================================
-- product_categories
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select_all" ON public.product_categories;
CREATE POLICY "categories_select_all"
  ON public.product_categories FOR SELECT TO authenticated USING (true);

-- ============================================================
-- products
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.product_categories(id) ON DELETE RESTRICT,
  sku text UNIQUE NOT NULL,
  name text NOT NULL,
  provider text NOT NULL,
  base_price bigint NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  default_sell_price bigint NOT NULL DEFAULT 0 CHECK (default_sell_price >= base_price),
  editable_by_mitra boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_all" ON public.products;
CREATE POLICY "products_select_all"
  ON public.products FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "products_manage_super_admin" ON public.products;
CREATE POLICY "products_manage_super_admin"
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "products_update_super_admin" ON public.products;
CREATE POLICY "products_update_super_admin"
  ON public.products FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "products_delete_super_admin" ON public.products;
CREATE POLICY "products_delete_super_admin"
  ON public.products FOR DELETE TO authenticated USING (public.is_super_admin());

-- ============================================================
-- pricing_rules (override harga jual per pengguna untuk produk editable)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sell_price bigint NOT NULL CHECK (sell_price >= 0),
  min_price bigint NOT NULL DEFAULT 0 CHECK (min_price >= 0),
  max_price bigint CHECK (max_price IS NULL OR max_price >= min_price),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, user_id)
);

ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pricing_rules_select_scope" ON public.pricing_rules;
CREATE POLICY "pricing_rules_select_scope"
  ON public.pricing_rules FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR user_id = ANY(public.descendant_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "pricing_rules_upsert_self_or_admin" ON public.pricing_rules;
CREATE POLICY "pricing_rules_upsert_self_or_admin"
  ON public.pricing_rules FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS "pricing_rules_update_self_or_admin" ON public.pricing_rules;
CREATE POLICY "pricing_rules_update_self_or_admin"
  ON public.pricing_rules FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR user_id = auth.uid())
  WITH CHECK (public.is_super_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS "pricing_rules_delete_self_or_admin" ON public.pricing_rules;
CREATE POLICY "pricing_rules_delete_self_or_admin"
  ON public.pricing_rules FOR DELETE TO authenticated
  USING (public.is_super_admin() OR user_id = auth.uid());

-- ============================================================
-- pricing_rules_history (audit)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pricing_rules_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_rule_id uuid REFERENCES public.pricing_rules(id) ON DELETE SET NULL,
  product_id uuid NOT NULL,
  user_id uuid NOT NULL,
  old_sell_price bigint,
  new_sell_price bigint,
  changed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action IN ('create','update','delete'))
);

ALTER TABLE public.pricing_rules_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pricing_history_select_scope" ON public.pricing_rules_history;
CREATE POLICY "pricing_history_select_scope"
  ON public.pricing_rules_history FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR user_id = ANY(public.descendant_ids(auth.uid()))
  );

-- ============================================================
-- wallets (satu per user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance bigint NOT NULL DEFAULT 0,
  pending_balance bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IDR',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  last_ledger_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallets_select_scope" ON public.wallets;
CREATE POLICY "wallets_select_scope"
  ON public.wallets FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR user_id = ANY(public.descendant_ids(auth.uid()))
  );

-- ============================================================
-- wallet_ledger (immutable audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('credit','debit')),
  amount bigint NOT NULL CHECK (amount > 0),
  balance_after bigint NOT NULL,
  reference_type text CHECK (reference_type IN ('topup','transaction','refund','adjustment','fee')),
  reference_id uuid,
  description text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_select_scope" ON public.wallet_ledger;
CREATE POLICY "ledger_select_scope"
  ON public.wallet_ledger FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR user_id = ANY(public.descendant_ids(auth.uid()))
  );

-- ============================================================
-- transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_code text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  category_slug_snapshot text NOT NULL,
  customer_number text NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  cost_price bigint NOT NULL DEFAULT 0,
  sell_price bigint NOT NULL DEFAULT 0,
  profit bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','refunded')),
  provider_reference text,
  provider_response jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tx_select_scope" ON public.transactions;
CREATE POLICY "tx_select_scope"
  ON public.transactions FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR user_id = ANY(public.descendant_ids(auth.uid()))
  );

-- ============================================================
-- transaction_status_history
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transaction_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transaction_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tx_history_select_scope" ON public.transaction_status_history;
CREATE POLICY "tx_history_select_scope"
  ON public.transaction_status_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = transaction_status_history.transaction_id
        AND (
          public.is_super_admin()
          OR t.user_id = auth.uid()
          OR t.user_id = ANY(public.descendant_ids(auth.uid()))
        )
    )
  );

-- ============================================================
-- announcements
-- ============================================================
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','super_admin','mitra','submitra','loket')),
  pinned boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ann_select_scope" ON public.announcements;
CREATE POLICY "ann_select_scope"
  ON public.announcements FOR SELECT TO authenticated
  USING (
    status = 'published' AND (audience = 'all' OR audience = (
      SELECT role FROM public.profiles WHERE id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "ann_manage_super_admin" ON public.announcements;
CREATE POLICY "ann_manage_super_admin"
  ON public.announcements FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "ann_update_super_admin" ON public.announcements;
CREATE POLICY "ann_update_super_admin"
  ON public.announcements FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "ann_delete_super_admin" ON public.announcements;
CREATE POLICY "ann_delete_super_admin"
  ON public.announcements FOR DELETE TO authenticated USING (public.is_super_admin());

-- ============================================================
-- audit_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  details jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select_super_admin" ON public.audit_logs;
CREATE POLICY "audit_select_super_admin"
  ON public.audit_logs FOR SELECT TO authenticated USING (public.is_super_admin());

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_user ON public.pricing_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_product ON public.pricing_rules(product_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON public.wallet_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON public.wallet_ledger(wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created ON public.wallet_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_user ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_created ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_history_tx ON public.transaction_status_history(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ann_created ON public.announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_parent ON public.profiles(parent_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role_status ON public.profiles(role, status);

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS pricing_rules_set_updated_at ON public.pricing_rules;
CREATE TRIGGER pricing_rules_set_updated_at BEFORE UPDATE ON public.pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS wallets_set_updated_at ON public.wallets;
CREATE TRIGGER wallets_set_updated_at BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS transactions_set_updated_at ON public.transactions;
CREATE TRIGGER transactions_set_updated_at BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS announcements_set_updated_at ON public.announcements;
CREATE TRIGGER announcements_set_updated_at BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Auto-create wallet saat profile dibuat / diaktifkan
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_wallet()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('mitra','submitra','loket') AND NEW.status = 'active' THEN
    INSERT INTO public.wallets (user_id, balance, status)
    VALUES (NEW.id, 0, 'active')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_ensure_wallet ON public.profiles;
CREATE TRIGGER profiles_ensure_wallet
  AFTER INSERT OR UPDATE OF role, status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_wallet();
