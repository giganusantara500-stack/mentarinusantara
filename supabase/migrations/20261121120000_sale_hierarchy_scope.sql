/*
  Setiap transaksi menyimpan rantai Loket -> Sub Mitra -> Mitra -> Super Admin.
  Loket hanya melihat transaksinya sendiri.
  Sub Mitra melihat loket di bawahnya.
  Mitra melihat Sub Mitra buatannya dan seluruh loket jaringannya.
  Super Admin melihat seluruh transaksi.
*/

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS loket_id uuid,
  ADD COLUMN IF NOT EXISTS submitra_id uuid,
  ADD COLUMN IF NOT EXISTS mitra_id uuid,
  ADD COLUMN IF NOT EXISTS super_admin_id uuid;

ALTER TABLE public.payment_simulations
  ADD COLUMN IF NOT EXISTS submitra_id uuid,
  ADD COLUMN IF NOT EXISTS mitra_id uuid,
  ADD COLUMN IF NOT EXISTS super_admin_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_submitra ON public.transactions (submitra_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_mitra ON public.transactions (mitra_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulations_submitra ON public.payment_simulations (submitra_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulations_mitra ON public.payment_simulations (mitra_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ledger_hierarchy(p_loket uuid)
RETURNS TABLE (loket_id uuid, submitra_id uuid, mitra_id uuid, super_admin_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  current_id uuid := p_loket;
  seen uuid[] := ARRAY[]::uuid[];
  row_role text;
  parent uuid;
  steps integer := 0;
  found_submitra uuid;
  found_mitra uuid;
BEGIN
  loket_id := p_loket;
  SELECT id INTO super_admin_id
  FROM public.profiles
  WHERE lower(replace(COALESCE(role, ''), '-', '_')) IN ('super_admin', 'superadmin')
  ORDER BY created_at
  LIMIT 1;

  WHILE current_id IS NOT NULL AND steps < 6 AND NOT (current_id = ANY(seen)) LOOP
    seen := array_append(seen, current_id);
    steps := steps + 1;
    SELECT
      CASE
        WHEN lower(replace(COALESCE(p.role, ''), '-', '_')) IN ('superadmin', 'super_admin') THEN 'super_admin'
        WHEN lower(replace(COALESCE(p.role, ''), '-', '_')) IN ('sub_mitra', 'submitra') THEN 'submitra'
        WHEN lower(replace(COALESCE(p.role, ''), '-', '_')) = 'mitra' THEN 'mitra'
        WHEN lower(replace(COALESCE(p.role, ''), '-', '_')) = 'loket' THEN 'loket'
        ELSE ''
      END,
      COALESCE(p.parent_id, p.created_by, p.mitra_id)
    INTO row_role, parent
    FROM public.profiles p
    WHERE p.id = current_id;

    IF row_role = 'submitra' AND found_submitra IS NULL THEN found_submitra := current_id; END IF;
    IF row_role = 'mitra' AND found_mitra IS NULL THEN found_mitra := current_id; END IF;
    IF row_role = 'super_admin' OR parent IS NULL OR parent = current_id THEN EXIT; END IF;
    current_id := parent;
  END LOOP;

  IF found_mitra IS NULL THEN
    SELECT p.mitra_id INTO found_mitra FROM public.profiles p WHERE p.id = p_loket AND p.mitra_id IS NOT NULL;
  END IF;
  IF found_mitra IS NULL AND found_submitra IS NOT NULL THEN
    SELECT COALESCE(
      p.mitra_id,
      CASE WHEN lower(replace(COALESCE(up.role, ''), '-', '_')) = 'mitra' THEN up.id ELSE NULL END
    )
    INTO found_mitra
    FROM public.profiles p
    LEFT JOIN public.profiles up ON up.id = COALESCE(p.parent_id, p.created_by)
    WHERE p.id = found_submitra;
  END IF;

  submitra_id := found_submitra;
  mitra_id := found_mitra;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_sale_visible(
  p_role text,
  p_actor uuid,
  p_loket uuid,
  p_submitra uuid,
  p_mitra uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p_role = 'super_admin' THEN true
    WHEN p_role = 'loket' THEN p_loket = p_actor
    WHEN p_role = 'submitra' THEN p_submitra = p_actor
    WHEN p_role = 'mitra' THEN p_mitra = p_actor
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_sale_hierarchy()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  owner uuid;
  chain record;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    owner := COALESCE(NEW.loket_id, NEW.user_id);
  ELSE
    owner := NEW.loket_id;
  END IF;
  SELECT * INTO chain FROM public.ledger_hierarchy(owner);
  IF TG_TABLE_NAME = 'transactions' THEN
    NEW.loket_id := chain.loket_id;
  END IF;
  NEW.submitra_id := chain.submitra_id;
  NEW.mitra_id := chain.mitra_id;
  NEW.super_admin_id := chain.super_admin_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_stamp_hierarchy ON public.transactions;
CREATE TRIGGER transactions_stamp_hierarchy
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sale_hierarchy();

DROP TRIGGER IF EXISTS simulations_stamp_hierarchy ON public.payment_simulations;
CREATE TRIGGER simulations_stamp_hierarchy
  BEFORE INSERT ON public.payment_simulations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sale_hierarchy();

UPDATE public.transactions AS tx
SET loket_id = chain.loket_id,
    submitra_id = chain.submitra_id,
    mitra_id = chain.mitra_id,
    super_admin_id = chain.super_admin_id
FROM public.ledger_hierarchy(tx.user_id) AS chain;

UPDATE public.payment_simulations AS sale
SET submitra_id = chain.submitra_id,
    mitra_id = chain.mitra_id,
    super_admin_id = chain.super_admin_id
FROM public.ledger_hierarchy(sale.loket_id) AS chain;

REVOKE ALL ON FUNCTION public.ledger_hierarchy(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_sale_visible(text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_sale_hierarchy() FROM PUBLIC, anon, authenticated;

DO $scope$
DECLARE
  src text;
BEGIN
  src := pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure);
  IF position('public.ledger_sale_visible' in src) > 0 THEN
    RAISE NOTICE 'Cakupan transaksi hierarki sudah terpasang.';
    RETURN;
  END IF;
  IF position('AND (role = ''super_admin'' OR tx.user_id = ANY(visible))' in src) = 0
     OR position('WHERE s.loket_id = p_actor' in src) = 0 THEN
    RAISE EXCEPTION 'Fungsi saldo tidak memiliki daftar transaksi yang dikenali.';
  END IF;
  src := replace(
    src,
    'tx.status, ''production'', tx.created_at
      ) ORDER BY tx.created_at DESC)',
    'tx.status, ''production'', tx.created_at
      ) || jsonb_build_object(''submitraId'', tx.submitra_id, ''mitraId'', tx.mitra_id, ''superAdminId'', tx.super_admin_id) ORDER BY tx.created_at DESC)'
  );
  src := replace(
    src,
    'AND (role = ''super_admin'' OR tx.user_id = ANY(visible))',
    'AND public.ledger_sale_visible(role, p_actor, tx.user_id, tx.submitra_id, tx.mitra_id)'
  );
  src := regexp_replace(
    src,
    'IF role <> ''loket'' THEN[[:space:]]+RETURN jsonb_build_object\(''status'', 200, ''simulations'', ''\[\]''::jsonb\);[[:space:]]+END IF;[[:space:]]+',
    ''
  );
  src := replace(
    src,
    's.period, s.parent_id, s.status, ''simulation'', s.created_at
      ) ORDER BY s.created_at DESC)',
    's.period, s.parent_id, s.status, ''simulation'', s.created_at
      ) || jsonb_build_object(''submitraId'', s.submitra_id, ''mitraId'', s.mitra_id, ''superAdminId'', s.super_admin_id) ORDER BY s.created_at DESC)'
  );
  src := replace(
    src,
    'WHERE s.loket_id = p_actor',
    'WHERE public.ledger_sale_visible(role, p_actor, s.loket_id, s.submitra_id, s.mitra_id)'
  );
  EXECUTE src;
END
$scope$;
