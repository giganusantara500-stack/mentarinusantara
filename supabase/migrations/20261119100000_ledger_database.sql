/*
  Saldo, mutasi, tiket deposit, dan transaksi pindah ke database.
  Fungsi ledger_api hanya boleh dipanggil kunci service (server), tidak dari browser.
  Simulasi pembayaran disimpan terpisah dan tidak mengubah saldo produksi.

  Bagian awal menyiapkan tabel yang belum ada di database yang sedang dipakai,
  lalu menyalin hubungan atasan dari data akun yang sudah tersimpan.
*/

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mitra_id uuid;

UPDATE public.profiles AS profile
SET parent_id = (account.raw_user_meta_data->>'parent_id')::uuid
FROM auth.users AS account
WHERE account.id = profile.id
  AND profile.parent_id IS NULL
  AND COALESCE(account.raw_user_meta_data->>'parent_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.profiles AS profile
SET created_by = (account.raw_user_meta_data->>'created_by')::uuid
FROM auth.users AS account
WHERE account.id = profile.id
  AND profile.created_by IS NULL
  AND COALESCE(account.raw_user_meta_data->>'created_by', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.profiles AS profile
SET mitra_id = (account.raw_user_meta_data->>'mitra_id')::uuid
FROM auth.users AS account
WHERE account.id = profile.id
  AND profile.mitra_id IS NULL
  AND COALESCE(account.raw_user_meta_data->>'mitra_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

CREATE OR REPLACE FUNCTION public.descendant_ids(p_ancestor uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE tree AS (
    SELECT id FROM public.profiles WHERE parent_id = p_ancestor
    UNION
    SELECT child.id FROM public.profiles AS child JOIN tree ON child.parent_id = tree.id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) FROM tree;
$$;

CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance bigint NOT NULL DEFAULT 0,
  pending_balance bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IDR',
  status text NOT NULL DEFAULT 'active',
  last_ledger_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('credit', 'debit')),
  amount bigint NOT NULL CHECK (amount > 0),
  balance_after bigint NOT NULL,
  reference_type text,
  reference_id uuid,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_code text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  product_id uuid,
  product_name_snapshot text NOT NULL,
  category_slug_snapshot text NOT NULL,
  customer_number text NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  cost_price bigint NOT NULL DEFAULT 0,
  sell_price bigint NOT NULL DEFAULT 0,
  profit bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
  provider_reference text,
  provider_response jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.transaction_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  details jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_status_history ENABLE ROW LEVEL SECURITY;

INSERT INTO public.wallets (user_id, balance, status)
SELECT id, 0, 'active'
FROM public.profiles
WHERE role IN ('super_admin', 'mitra', 'submitra', 'loket')
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_accounts (
  id text PRIMARY KEY,
  balance bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_accounts (id, balance)
VALUES ('__pusat__', 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ledger_control (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  json_imported_at timestamptz
);

INSERT INTO public.ledger_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fund_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  ticket_id uuid,
  actor_id uuid,
  account_id text NOT NULL,
  counterparty_id text,
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount bigint NOT NULL CHECK (amount > 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  route text NOT NULL CHECK (route IN ('pusat', 'jaringan', 'produksi')),
  kind text,
  note text NOT NULL,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_fund_entries_account ON public.fund_entries (account_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_fund_entries_actor ON public.fund_entries (actor_id, at DESC);

CREATE TABLE IF NOT EXISTS public.deposit_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  applicant_name text NOT NULL,
  applicant_code text,
  applicant_role text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  base_amount bigint NOT NULL,
  unique_code text NOT NULL,
  transfer_amount bigint NOT NULL,
  bank text NOT NULL,
  account_number text NOT NULL,
  account_holder text NOT NULL,
  transfer_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'cancelled', 'reversed')),
  route text NOT NULL CHECK (route IN ('pusat', 'jaringan')),
  approver_id uuid,
  upline_name text,
  upline_role text,
  funded_by text,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  claimed_at timestamptz
);

ALTER TABLE public.deposit_tickets ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS deposit_one_open_ticket
  ON public.deposit_tickets (applicant_id, route)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_deposit_tickets_applicant ON public.deposit_tickets (applicant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loket_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  client_ref text NOT NULL,
  category text NOT NULL,
  product text NOT NULL,
  customer_number text NOT NULL,
  customer_name text,
  amount bigint NOT NULL CHECK (amount >= 0),
  tagihan bigint,
  denda bigint,
  admin_fee bigint,
  collfee bigint,
  period text,
  loket_code text,
  loket_name text,
  parent_id uuid,
  status text NOT NULL DEFAULT 'simulated' CHECK (status = 'simulated'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loket_id, client_ref)
);

CREATE INDEX IF NOT EXISTS idx_payment_simulations_loket ON public.payment_simulations (loket_id, created_at DESC);

ALTER TABLE public.transactions ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'production';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS customer_name text;

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.wallet_ledger'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%reference_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.wallet_ledger DROP CONSTRAINT %I', constraint_name);
  END LOOP;
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.transactions'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%channel%'
  LOOP
    EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.wallet_ledger
  ADD CONSTRAINT wallet_ledger_reference_type_check
  CHECK (reference_type IS NULL OR reference_type IN ('topup', 'transaction', 'refund', 'adjustment', 'fee', 'deposit', 'distribusi', 'reversal'));

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_channel_production
  CHECK (channel = 'production');

CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_idempotency
  ON public.transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.platform_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_simulations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ledger_control FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fund_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.deposit_tickets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payment_simulations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.wallets FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.transaction_status_history FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ledger_role(p_actor uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  row jsonb;
  stored text;
  active boolean;
BEGIN
  SELECT to_jsonb(p) INTO row FROM public.profiles p WHERE p.id = p_actor;
  IF row IS NULL THEN RETURN ''; END IF;
  stored := lower(replace(COALESCE(row->>'role', ''), '-', '_'));
  IF stored IN ('superadmin', 'super_admin') THEN stored := 'super_admin';
  ELSIF stored IN ('sub_mitra', 'submitra') THEN stored := 'submitra';
  ELSIF stored NOT IN ('mitra', 'loket') THEN RETURN '';
  END IF;
  IF row ? 'is_active' AND row->>'is_active' IS NOT NULL THEN
    active := (row->>'is_active')::boolean;
  ELSIF row ? 'status' THEN
    active := COALESCE(row->>'status', 'active') IN ('active', 'aktif');
  ELSE
    active := true;
  END IF;
  IF NOT active THEN RETURN ''; END IF;
  RETURN stored;
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_network(p_actor uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::uuid[])
  FROM (
    SELECT p_actor AS id
    UNION
    SELECT unnest(public.descendant_ids(p_actor))
    UNION
    SELECT id FROM public.profiles WHERE parent_id = p_actor
    UNION
    SELECT id FROM public.profiles WHERE created_by = p_actor
  ) people
  WHERE id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.ledger_can_see(p_actor uuid, p_account text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  role text := public.ledger_role(p_actor);
BEGIN
  IF role = '' THEN RETURN false; END IF;
  IF role = 'super_admin' THEN RETURN true; END IF;
  IF p_account = '__pusat__' THEN RETURN false; END IF;
  IF p_account !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN p_account::uuid = ANY(public.ledger_network(p_actor));
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_ticket_json(t public.deposit_tickets)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'loketId', t.applicant_id,
    'loketName', t.applicant_name,
    'loketCode', t.applicant_code,
    'amount', t.amount,
    'baseAmount', t.base_amount,
    'uniqueCode', t.unique_code,
    'transferAmount', t.transfer_amount,
    'bank', t.bank,
    'accountNumber', t.account_number,
    'accountHolder', t.account_holder,
    'transferAt', t.transfer_at,
    'expiresAt', t.expires_at,
    'status', t.status,
    'route', t.route,
    'approverId', t.approver_id,
    'applicantRole', t.applicant_role,
    'uplineName', t.upline_name,
    'uplineRole', t.upline_role,
    'fundedBy', t.funded_by,
    'decidedBy', t.decided_by,
    'createdAt', t.created_at,
    'decidedAt', t.decided_at,
    'claimedAt', t.claimed_at
  );
$$;

CREATE OR REPLACE FUNCTION public.ledger_sale_json(
  p_id uuid, p_loket uuid, p_code text, p_name text, p_category text, p_product text,
  p_customer text, p_customer_name text, p_amount bigint, p_tagihan bigint, p_denda bigint,
  p_admin bigint, p_collfee bigint, p_period text, p_parent uuid, p_status text, p_channel text, p_at timestamptz
) RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_id, 'loketId', p_loket, 'loketCode', p_code, 'loketName', p_name,
    'category', p_category, 'product', p_product, 'customerNumber', p_customer,
    'customerName', COALESCE(p_customer_name, ''), 'amount', p_amount,
    'tagihan', COALESCE(p_tagihan, 0), 'denda', COALESCE(p_denda, 0),
    'adminFee', COALESCE(p_admin, 0), 'collfee', COALESCE(p_collfee, 0),
    'period', COALESCE(p_period, ''), 'parentId', p_parent, 'status', p_status,
    'channel', p_channel, 'createdAt', p_at
  );
$$;

CREATE OR REPLACE FUNCTION public.ledger_move(
  p_account text,
  p_delta bigint,
  p_actor uuid,
  p_ticket uuid,
  p_counterparty text,
  p_route text,
  p_kind text,
  p_note text,
  p_idem text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  next_balance bigint;
  entry_id uuid;
  direction text;
  ref_type text;
  wallet public.wallets%ROWTYPE;
BEGIN
  IF p_delta = 0 THEN RAISE EXCEPTION 'SALDO:Nominal tidak valid.'; END IF;
  IF p_idem IS NOT NULL THEN
    SELECT balance_after INTO next_balance FROM public.fund_entries WHERE idempotency_key = p_idem;
    IF FOUND THEN RETURN next_balance; END IF;
  END IF;

  direction := CASE WHEN p_delta > 0 THEN 'credit' ELSE 'debit' END;
  IF p_account = '__pusat__' THEN
    INSERT INTO public.platform_accounts (id, balance) VALUES ('__pusat__', 0) ON CONFLICT (id) DO NOTHING;
    SELECT balance INTO next_balance FROM public.platform_accounts WHERE id = '__pusat__' FOR UPDATE;
    next_balance := next_balance + p_delta;
    IF next_balance < 0 THEN RAISE EXCEPTION 'SALDO:Saldo Utama tidak cukup.'; END IF;
    UPDATE public.platform_accounts SET balance = next_balance, updated_at = now() WHERE id = '__pusat__';
  ELSE
    IF p_account !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'SALDO:Akun saldo tidak valid.';
    END IF;
    INSERT INTO public.wallets (user_id, balance, status)
    VALUES (p_account::uuid, 0, 'active')
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO wallet FROM public.wallets WHERE user_id = p_account::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SALDO:Dompet tidak ditemukan.'; END IF;
    IF wallet.status = 'frozen' THEN RAISE EXCEPTION 'SALDO:Dompet dibekukan.'; END IF;
    next_balance := wallet.balance + p_delta;
    IF next_balance < 0 THEN RAISE EXCEPTION 'SALDO:Saldo tidak cukup.'; END IF;
    ref_type := CASE
      WHEN p_kind = 'distribusi' THEN 'distribusi'
      WHEN p_route = 'produksi' AND p_delta > 0 THEN 'refund'
      WHEN p_route = 'produksi' THEN 'transaction'
      WHEN p_note ILIKE '%batal%' OR p_note ILIKE '%pengembalian%' THEN 'reversal'
      ELSE 'deposit'
    END;
    INSERT INTO public.wallet_ledger (wallet_id, user_id, entry_type, amount, balance_after, reference_type, reference_id, description, created_by)
    VALUES (wallet.id, p_account::uuid, direction, abs(p_delta), next_balance, ref_type, p_ticket, p_note, p_actor)
    RETURNING id INTO entry_id;
    UPDATE public.wallets SET balance = next_balance, last_ledger_id = entry_id WHERE id = wallet.id;
  END IF;

  INSERT INTO public.fund_entries (id, ticket_id, actor_id, account_id, counterparty_id, direction, amount, balance_after, route, kind, note, idempotency_key)
  VALUES (COALESCE(entry_id, gen_random_uuid()), p_ticket, p_actor, p_account, p_counterparty, direction, abs(p_delta), next_balance, p_route, p_kind, p_note, p_idem);
  RETURN next_balance;
EXCEPTION
  WHEN unique_violation THEN
    SELECT balance_after INTO next_balance FROM public.fund_entries WHERE idempotency_key = p_idem;
    IF FOUND THEN RETURN next_balance; END IF;
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_api(p_action text, p_actor uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  role text;
  target text;
  amount bigint;
  ticket public.deposit_tickets%ROWTYPE;
  balance bigint;
  pool bigint;
  funder text;
  action text;
  sale public.transactions%ROWTYPE;
  simulation public.payment_simulations%ROWTYPE;
  client_ref text;
  outcome text;
  channel text;
  note text;
  from_balance bigint;
  to_balance bigint;
  ref uuid;
  visible uuid[];
  fresh_code text;
  code_try integer;
BEGIN
  IF p_action = 'import' THEN
    RETURN public.ledger_import_snapshot(COALESCE(p_payload, '{}'::jsonb));
  END IF;

  role := public.ledger_role(p_actor);
  IF role = '' THEN
    RETURN jsonb_build_object('error', 'Sesi tidak valid atau akun tidak aktif.', 'status', 401);
  END IF;
  visible := public.ledger_network(p_actor);

  IF p_action = 'balance' THEN
    target := COALESCE(NULLIF(p_payload->>'userId', ''), p_actor::text);
    IF target = '__pusat__' THEN
      IF role <> 'super_admin' THEN RETURN jsonb_build_object('error', 'Saldo Utama hanya untuk Super Admin.', 'status', 403); END IF;
      SELECT platform_accounts.balance INTO balance FROM public.platform_accounts WHERE platform_accounts.id = '__pusat__';
      RETURN jsonb_build_object('balance', COALESCE(balance, 0), 'status', 200);
    END IF;
    IF NOT public.ledger_can_see(p_actor, target) THEN
      RETURN jsonb_build_object('error', 'Anda tidak dapat melihat saldo ini.', 'status', 403);
    END IF;
    SELECT w.balance INTO balance FROM public.wallets w WHERE w.user_id = target::uuid;
    RETURN jsonb_build_object('balance', COALESCE(balance, 0), 'status', 200);
  END IF;

  IF p_action = 'balances' THEN
    RETURN jsonb_build_object('status', 200, 'wallets', (
      SELECT COALESCE(jsonb_object_agg(rows.account_id, rows.balance), '{}'::jsonb)
      FROM (
        SELECT w.user_id::text AS account_id, w.balance
        FROM public.wallets w
        WHERE role = 'super_admin' OR w.user_id = ANY(visible)
        UNION ALL
        SELECT platform_accounts.id, platform_accounts.balance FROM public.platform_accounts WHERE role = 'super_admin'
      ) rows
    ));
  END IF;

  IF p_action = 'activity' THEN
    RETURN jsonb_build_object('status', 200, 'marks', (
      SELECT COALESCE(jsonb_object_agg(account_id, at_ms), '{}'::jsonb)
      FROM (
        SELECT account_id, (EXTRACT(EPOCH FROM max(at)) * 1000)::bigint AS at_ms
        FROM (
          SELECT applicant_id::text AS account_id, created_at AS at FROM public.deposit_tickets
          UNION ALL
          SELECT loket_id::text, created_at FROM public.payment_simulations
          UNION ALL
          SELECT user_id::text, created_at FROM public.transactions
        ) events
        GROUP BY account_id
      ) grouped
    ));
  END IF;

  IF p_action = 'tickets' THEN
    RETURN jsonb_build_object('status', 200, 'tickets', (
      SELECT COALESCE(jsonb_agg(public.ledger_ticket_json(t) ORDER BY t.created_at DESC), '[]'::jsonb)
      FROM public.deposit_tickets t
      WHERE CASE
        WHEN role = 'loket' THEN t.applicant_id = p_actor
        WHEN role = 'super_admin' THEN true
        WHEN role = 'mitra' THEN t.applicant_id = p_actor OR (t.route = 'jaringan' AND t.approver_id = p_actor) OR t.applicant_id = ANY(visible)
        ELSE t.applicant_id = p_actor OR (t.route <> 'jaringan' AND t.applicant_id = ANY(visible)) OR t.applicant_id = ANY(visible)
      END
    ));
  END IF;

  IF p_action = 'mutations' THEN
    RETURN jsonb_build_object('status', 200, 'mutations', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id, 'at', e.at, 'ticketId', e.ticket_id, 'actorId', e.actor_id,
        'accountId', e.account_id, 'counterpartyId', e.counterparty_id, 'direction', e.direction,
        'amount', e.amount, 'balanceAfter', e.balance_after, 'route', e.route, 'kind', e.kind, 'note', e.note
      ) ORDER BY e.at DESC), '[]'::jsonb)
      FROM public.fund_entries e
      WHERE CASE
        WHEN role = 'super_admin' THEN true
        WHEN role = 'loket' THEN e.account_id = p_actor::text
        ELSE e.account_id <> '__pusat__' AND (
          e.account_id = ANY(SELECT unnest(visible)::text) OR e.actor_id = p_actor
          OR (e.counterparty_id IS NOT NULL AND e.counterparty_id = ANY(SELECT unnest(visible)::text))
        )
      END
    ));
  END IF;

  IF p_action = 'sales' THEN
    RETURN jsonb_build_object('status', 200, 'sales', (
      SELECT COALESCE(jsonb_agg(public.ledger_sale_json(
        tx.id, tx.user_id, '', '', tx.category_slug_snapshot, tx.product_name_snapshot,
        tx.customer_number, tx.customer_name, tx.amount, tx.amount, 0, 0, 0, '', NULL::uuid,
        tx.status, 'production', tx.created_at
      ) ORDER BY tx.created_at DESC), '[]'::jsonb)
      FROM public.transactions tx
      WHERE tx.channel = 'production'
        AND (role = 'super_admin' OR tx.user_id = ANY(visible))
    ));
  END IF;

  IF p_action = 'simulations' THEN
    IF role <> 'loket' THEN
      RETURN jsonb_build_object('status', 200, 'simulations', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('status', 200, 'simulations', (
      SELECT COALESCE(jsonb_agg(public.ledger_sale_json(
        s.id, s.loket_id, s.loket_code, s.loket_name, s.category, s.product,
        s.customer_number, s.customer_name, s.amount, s.tagihan, s.denda, s.admin_fee, s.collfee,
        s.period, s.parent_id, s.status, 'simulation', s.created_at
      ) ORDER BY s.created_at DESC), '[]'::jsonb)
      FROM public.payment_simulations s
      WHERE s.loket_id = p_actor
    ));
  END IF;

  IF p_action = 'create_ticket' THEN
    IF role NOT IN ('loket', 'mitra', 'submitra') THEN
      RETURN jsonb_build_object('error', 'Hanya Mitra, Sub Mitra, atau Loket yang dapat membuat tiket deposit.', 'status', 403);
    END IF;
    IF COALESCE(p_payload->>'route', 'pusat') = 'jaringan' THEN
      RETURN jsonb_build_object('error', 'Setoran deposit hanya ke rekening pusat.', 'status', 400);
    END IF;
    amount := round(COALESCE((p_payload->>'amount')::numeric, 0))::bigint;
    IF amount < 10000 THEN
      RETURN jsonb_build_object('error', 'Nominal deposit minimal Rp10.000.', 'status', 400);
    END IF;
    UPDATE public.deposit_tickets
    SET status = 'cancelled', decided_at = now()
    WHERE applicant_id = p_actor AND status = 'pending' AND expires_at IS NOT NULL AND expires_at <= now();
    IF EXISTS (
      SELECT 1 FROM public.deposit_tickets AS open_ticket
      WHERE open_ticket.applicant_id = p_actor AND open_ticket.route = 'pusat' AND open_ticket.status = 'pending'
    ) THEN
      RETURN jsonb_build_object('error', 'Masih ada tiket pada jalur yang sama yang menunggu keputusan.', 'status', 409);
    END IF;
    FOR code_try IN 1..30 LOOP
      fresh_code := lpad(((floor(random() * 900) + 100)::int)::text, 3, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.deposit_tickets
        WHERE status = 'pending' AND unique_code = fresh_code AND (expires_at IS NULL OR expires_at > now())
      );
    END LOOP;
    INSERT INTO public.deposit_tickets (
      applicant_id, applicant_name, applicant_code, applicant_role, amount, base_amount, unique_code,
      transfer_amount, bank, account_number, account_holder, transfer_at, expires_at, status, route,
      approver_id, upline_name, upline_role
    ) VALUES (
      p_actor,
      COALESCE(NULLIF(p_payload->>'loketName', ''), 'Pemohon'),
      NULLIF(p_payload->>'loketCode', ''),
      role,
      amount,
      amount,
      fresh_code,
      amount + fresh_code::bigint,
      p_payload->>'bank',
      p_payload->>'accountNumber',
      p_payload->>'accountHolder',
      now(),
      now() + interval '6 hours',
      'pending',
      'pusat',
      NULL,
      NULLIF(p_payload->>'uplineName', ''),
      NULLIF(p_payload->>'uplineRole', '')
    ) RETURNING * INTO ticket;
    RETURN jsonb_build_object('status', 200, 'ticket', public.ledger_ticket_json(ticket));
  END IF;

  IF p_action = 'claim_ticket' THEN
    SELECT * INTO ticket FROM public.deposit_tickets WHERE id = (p_payload->>'id')::uuid AND applicant_id = p_actor FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Tiket deposit tidak ditemukan.', 'status', 404); END IF;
    IF ticket.status <> 'pending' THEN
      RETURN jsonb_build_object('error', 'Hanya tiket yang masih menunggu yang dapat ditandai sudah ditransfer.', 'status', 409);
    END IF;
    IF ticket.expires_at IS NOT NULL AND ticket.expires_at <= now() THEN
      RETURN jsonb_build_object('error', 'Waktu pembayaran tiket sudah habis.', 'status', 409);
    END IF;
    UPDATE public.deposit_tickets SET claimed_at = COALESCE(claimed_at, now()) WHERE id = ticket.id RETURNING * INTO ticket;
    RETURN jsonb_build_object('status', 200, 'ticket', public.ledger_ticket_json(ticket));
  END IF;

  IF p_action = 'cancel_ticket' THEN
    SELECT * INTO ticket FROM public.deposit_tickets WHERE id = (p_payload->>'id')::uuid AND applicant_id = p_actor FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Tiket deposit tidak ditemukan.', 'status', 404); END IF;
    IF ticket.status <> 'pending' THEN
      RETURN jsonb_build_object('error', 'Hanya tiket yang masih menunggu yang dapat dibatalkan.', 'status', 409);
    END IF;
    UPDATE public.deposit_tickets SET status = 'cancelled', decided_at = now() WHERE id = ticket.id RETURNING * INTO ticket;
    RETURN jsonb_build_object('status', 200, 'ticket', public.ledger_ticket_json(ticket));
  END IF;

  IF p_action = 'decide_ticket' THEN
    IF role <> 'super_admin' THEN
      RETURN jsonb_build_object('error', 'Hanya Super Admin yang dapat menyetujui tiket deposit ke rekening pusat.', 'status', 403);
    END IF;
    action := p_payload->>'action';
    IF action NOT IN ('approve', 'cancel', 'pending', 'void') THEN
      RETURN jsonb_build_object('error', 'Aksi tidak valid.', 'status', 400);
    END IF;
    SELECT * INTO ticket FROM public.deposit_tickets WHERE id = (p_payload->>'id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Tiket deposit tidak ditemukan.', 'status', 404); END IF;
    IF ticket.route <> 'pusat' THEN
      RETURN jsonb_build_object('error', 'Anda tidak dapat memutuskan tiket deposit ini.', 'status', 403);
    END IF;
    IF action = 'approve' AND ticket.expires_at IS NOT NULL AND ticket.expires_at <= now() THEN
      RETURN jsonb_build_object('error', 'Waktu tiket sudah lewat. Tiket ini tidak menambah saldo.', 'status', 409);
    END IF;
    funder := COALESCE(ticket.funded_by, '');
    SELECT wallets.balance INTO balance FROM public.wallets WHERE wallets.user_id = ticket.applicant_id;
    balance := COALESCE(balance, 0);

    IF action = 'approve' THEN
      IF ticket.status <> 'pending' THEN
        RETURN jsonb_build_object('error', 'Hanya setoran menunggu yang dapat disetujui.', 'status', 409);
      END IF;
      pool := public.ledger_move('__pusat__', -ticket.amount, p_actor, ticket.id, ticket.applicant_id::text, 'pusat', NULL, 'Saldo Utama berpindah ke ' || ticket.applicant_name, ticket.id::text || ':approve:pusat');
      balance := public.ledger_move(ticket.applicant_id::text, ticket.amount, p_actor, ticket.id, '__pusat__', 'pusat', NULL, 'Saldo masuk dari Saldo Utama', ticket.id::text || ':approve:applicant');
      UPDATE public.deposit_tickets
      SET status = 'approved', funded_by = '__pusat__', decided_by = p_actor, decided_at = now()
      WHERE id = ticket.id RETURNING * INTO ticket;
    ELSIF action = 'cancel' THEN
      IF ticket.status <> 'pending' THEN
        RETURN jsonb_build_object('error', 'Hanya setoran menunggu yang dapat ditolak.', 'status', 409);
      END IF;
      UPDATE public.deposit_tickets SET status = 'cancelled', decided_by = p_actor, decided_at = now() WHERE id = ticket.id RETURNING * INTO ticket;
    ELSIF action = 'void' OR (action = 'pending' AND ticket.status = 'approved') THEN
      IF ticket.status <> 'approved' AND action = 'void' THEN
        RETURN jsonb_build_object('error', 'Hanya setoran sukses yang dapat ditarik menjadi dibatalkan.', 'status', 409);
      END IF;
      IF ticket.status = 'approved' THEN
        balance := public.ledger_move(ticket.applicant_id::text, -ticket.amount, p_actor, ticket.id, NULLIF(funder, ''), ticket.route, NULL, 'Pembatalan deposit pusat', ticket.id::text || ':' || action || ':rollback');
        IF funder = '__pusat__' THEN
          pool := public.ledger_move('__pusat__', ticket.amount, p_actor, ticket.id, ticket.applicant_id::text, 'pusat', NULL, 'Pengembalian alokasi saldo', ticket.id::text || ':' || action || ':restore');
          IF EXISTS (SELECT 1 FROM public.fund_entries WHERE idempotency_key = ticket.id::text || ':approve:bank-in') THEN
            PERFORM public.ledger_move('__pusat__', -ticket.amount, p_actor, ticket.id, ticket.applicant_id::text, 'pusat', NULL, 'Pembatalan uang masuk transfer bank', ticket.id::text || ':' || action || ':bank-in-reverse');
          END IF;
        END IF;
      END IF;
      UPDATE public.deposit_tickets
      SET status = CASE WHEN action = 'void' THEN 'reversed' ELSE 'pending' END,
          funded_by = NULL,
          decided_by = CASE WHEN action = 'pending' THEN NULL ELSE p_actor END,
          decided_at = CASE WHEN action = 'pending' THEN NULL ELSE now() END
      WHERE id = ticket.id RETURNING * INTO ticket;
    ELSIF action = 'pending' THEN
      UPDATE public.deposit_tickets SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ticket.id RETURNING * INTO ticket;
    END IF;

    IF ticket.funded_by = '__pusat__' OR funder = '__pusat__' THEN
      SELECT platform_accounts.balance INTO pool FROM public.platform_accounts WHERE platform_accounts.id = '__pusat__';
    END IF;
    RETURN jsonb_build_object('status', 200, 'ticket', public.ledger_ticket_json(ticket), 'balance', COALESCE(balance, 0), 'poolBalance', COALESCE(pool, 0), 'funderId', COALESCE(ticket.funded_by, funder, p_actor::text));
  END IF;

  IF p_action = 'distribute' THEN
    IF role <> 'mitra' THEN
      RETURN jsonb_build_object('error', 'Hanya Mitra yang dapat mendistribusikan saldo ke loketnya.', 'status', 403);
    END IF;
    target := p_payload->>'loketId';
    amount := round(COALESCE((p_payload->>'amount')::numeric, 0))::bigint;
    IF amount < 1000 THEN
      RETURN jsonb_build_object('error', 'Nominal distribusi minimal Rp1.000.', 'status', 400);
    END IF;
    IF target IS NULL OR target::uuid = p_actor OR NOT (target::uuid = ANY(visible)) THEN
      RETURN jsonb_build_object('error', 'Loket ini tidak berada di jaringan Anda.', 'status', 403);
    END IF;
    IF public.ledger_role(target::uuid) <> 'loket' THEN
      RETURN jsonb_build_object('error', 'Saldo hanya dapat dikirim ke loket di jaringan Anda.', 'status', 403);
    END IF;
    ref := gen_random_uuid();
    from_balance := public.ledger_move(p_actor::text, -amount, p_actor, ref, target, 'jaringan', 'distribusi', 'Distribusi saldo ke ' || COALESCE(p_payload->>'loketName', 'Loket'), ref::text || ':from');
    to_balance := public.ledger_move(target, amount, p_actor, ref, p_actor::text, 'jaringan', 'distribusi', 'Distribusi saldo dari Mitra', ref::text || ':to');
    RETURN jsonb_build_object('status', 200, 'id', ref, 'fromBalance', from_balance, 'toBalance', to_balance);
  END IF;

  IF p_action = 'credit' THEN
    IF role <> 'super_admin' THEN
      RETURN jsonb_build_object('error', 'Hanya Super Admin yang dapat membagi saldo.', 'status', 403);
    END IF;
    target := p_payload->>'userId';
    amount := round(COALESCE((p_payload->>'amount')::numeric, 0))::bigint;
    IF amount = 0 THEN RETURN jsonb_build_object('error', 'Nominal tidak valid.', 'status', 400); END IF;
    IF target IS NULL OR target = '' THEN RETURN jsonb_build_object('error', 'Akun tujuan tidak valid.', 'status', 400); END IF;
    IF target <> '__pusat__' AND public.ledger_role(target::uuid) NOT IN ('mitra', 'submitra', 'loket', 'super_admin') THEN
      RETURN jsonb_build_object('error', 'Akun tujuan tidak dapat menerima saldo.', 'status', 403);
    END IF;
    ref := gen_random_uuid();
    balance := public.ledger_move(target, amount, p_actor, ref, NULL, 'pusat', NULL, COALESCE(NULLIF(p_payload->>'note', ''), 'Penyesuaian saldo Super Admin'), ref::text);
    RETURN jsonb_build_object('status', 200, 'balance', balance);
  END IF;

  IF p_action = 'record_sale' THEN
    IF role <> 'loket' THEN
      RETURN jsonb_build_object('error', 'Hanya Loket yang dapat membayar dari saldo.', 'status', 403);
    END IF;
    channel := CASE WHEN p_payload->>'channel' = 'production' THEN 'production' ELSE 'simulation' END;
    outcome := COALESCE(p_payload->>'outcome', 'success');
    client_ref := NULLIF(trim(COALESCE(p_payload->>'clientRef', '')), '');
    amount := round(COALESCE((p_payload->>'amount')::numeric, 0))::bigint;
    IF client_ref IS NULL THEN
      RETURN jsonb_build_object('error', 'Transaksi tidak memiliki kunci unik.', 'status', 400);
    END IF;
    IF amount < 1000 THEN
      RETURN jsonb_build_object('error', 'Nominal pembayaran minimal Rp1.000.', 'status', 400);
    END IF;
    IF NULLIF(p_payload->>'category', '') IS NULL OR NULLIF(p_payload->>'product', '') IS NULL OR NULLIF(p_payload->>'customerNumber', '') IS NULL THEN
      RETURN jsonb_build_object('error', 'Kategori, produk, dan nomor pelanggan wajib diisi.', 'status', 400);
    END IF;

    IF channel = 'simulation' THEN
      INSERT INTO public.payment_simulations (
        loket_id, client_ref, category, product, customer_number, customer_name, amount, tagihan, denda,
        admin_fee, collfee, period, loket_code, loket_name, parent_id, status
      ) VALUES (
        p_actor, client_ref, p_payload->>'category', p_payload->>'product', p_payload->>'customerNumber',
        NULLIF(p_payload->>'customerName', ''), amount,
        COALESCE((p_payload->>'tagihan')::bigint, 0), COALESCE((p_payload->>'denda')::bigint, 0),
        COALESCE((p_payload->>'adminFee')::bigint, 0), COALESCE((p_payload->>'collfee')::bigint, 0),
        NULLIF(p_payload->>'period', ''), NULLIF(p_payload->>'loketCode', ''), NULLIF(p_payload->>'loketName', ''),
        NULLIF(p_payload->>'parentId', '')::uuid, 'simulated'
      ) ON CONFLICT (loket_id, client_ref) DO NOTHING
      RETURNING * INTO simulation;
      IF NOT FOUND THEN
        SELECT * INTO simulation FROM public.payment_simulations WHERE loket_id = p_actor AND client_ref = client_ref;
      END IF;
      SELECT w.balance INTO balance FROM public.wallets w WHERE w.user_id = p_actor;
      RETURN jsonb_build_object(
        'status', 200,
        'balance', COALESCE(balance, 0),
        'duplicate', simulation.client_ref IS NOT NULL,
        'sale', public.ledger_sale_json(simulation.id, simulation.loket_id, simulation.loket_code, simulation.loket_name, simulation.category, simulation.product, simulation.customer_number, simulation.customer_name, simulation.amount, simulation.tagihan, simulation.denda, simulation.admin_fee, simulation.collfee, simulation.period, simulation.parent_id, simulation.status, 'simulation', simulation.created_at)
      );
    END IF;

    IF outcome NOT IN ('pending', 'success', 'failed', 'refund') THEN
      RETURN jsonb_build_object('error', 'Status transaksi tidak valid.', 'status', 400);
    END IF;

    SELECT * INTO sale FROM public.transactions WHERE user_id = p_actor AND idempotency_key = client_ref FOR UPDATE;
    IF outcome = 'refund' THEN
      IF NOT FOUND OR sale.status <> 'success' THEN
        IF FOUND AND sale.status = 'refunded' THEN
          SELECT w.balance INTO balance FROM public.wallets w WHERE w.user_id = p_actor;
          RETURN jsonb_build_object('status', 200, 'balance', COALESCE(balance, 0), 'sale', public.ledger_sale_json(sale.id, sale.user_id, '', '', sale.category_slug_snapshot, sale.product_name_snapshot, sale.customer_number, sale.customer_name, sale.amount, sale.amount, 0, 0, 0, '', NULL, sale.status, 'production', sale.created_at));
        END IF;
        RETURN jsonb_build_object('error', 'Hanya transaksi produksi yang berhasil yang dapat dikembalikan.', 'status', 409);
      END IF;
      balance := public.ledger_move(p_actor::text, sale.amount, p_actor, sale.id, NULL, 'produksi', NULL, 'Pengembalian transaksi ' || sale.invoice_code, client_ref || ':refund');
      UPDATE public.transactions SET status = 'refunded', completed_at = now() WHERE id = sale.id RETURNING * INTO sale;
      INSERT INTO public.transaction_status_history (transaction_id, old_status, new_status, changed_by, reason)
      VALUES (sale.id, 'success', 'refunded', p_actor, 'Refund saldo');
      RETURN jsonb_build_object('status', 200, 'balance', balance, 'sale', public.ledger_sale_json(sale.id, sale.user_id, '', '', sale.category_slug_snapshot, sale.product_name_snapshot, sale.customer_number, sale.customer_name, sale.amount, sale.amount, 0, 0, 0, '', NULL, sale.status, 'production', sale.created_at));
    END IF;

    IF FOUND AND sale.status IN ('success', 'failed', 'refunded') THEN
      SELECT w.balance INTO balance FROM public.wallets w WHERE w.user_id = p_actor;
      RETURN jsonb_build_object('status', 200, 'balance', COALESCE(balance, 0), 'duplicate', true, 'sale', public.ledger_sale_json(sale.id, sale.user_id, '', '', sale.category_slug_snapshot, sale.product_name_snapshot, sale.customer_number, sale.customer_name, sale.amount, sale.amount, 0, 0, 0, '', NULL, sale.status, 'production', sale.created_at));
    END IF;

    IF NOT FOUND THEN
      INSERT INTO public.transactions (
        invoice_code, user_id, product_name_snapshot, category_slug_snapshot, customer_number, customer_name,
        amount, cost_price, sell_price, profit, status, channel, idempotency_key, note
      ) VALUES (
        'MN' || to_char(now(), 'YYYYMMDDHH24MISS') || substr(md5(random()::text), 1, 6),
        p_actor, p_payload->>'product', lower(p_payload->>'category'), p_payload->>'customerNumber',
        NULLIF(p_payload->>'customerName', ''), amount, amount, amount, 0, 'pending', 'production', client_ref,
        NULLIF(p_payload->>'customerName', '')
      ) RETURNING * INTO sale;
    END IF;

    IF outcome = 'failed' THEN
      UPDATE public.transactions SET status = 'failed', completed_at = now() WHERE id = sale.id RETURNING * INTO sale;
      INSERT INTO public.transaction_status_history (transaction_id, old_status, new_status, changed_by, reason)
      VALUES (sale.id, 'pending', 'failed', p_actor, 'Transaksi gagal tanpa potong saldo');
      SELECT w.balance INTO balance FROM public.wallets w WHERE w.user_id = p_actor;
      RETURN jsonb_build_object('status', 200, 'balance', COALESCE(balance, 0), 'sale', public.ledger_sale_json(sale.id, sale.user_id, '', '', sale.category_slug_snapshot, sale.product_name_snapshot, sale.customer_number, sale.customer_name, sale.amount, sale.amount, 0, 0, 0, '', NULL, sale.status, 'production', sale.created_at));
    END IF;

    IF outcome = 'pending' THEN
      SELECT w.balance INTO balance FROM public.wallets w WHERE w.user_id = p_actor;
      RETURN jsonb_build_object('status', 200, 'balance', COALESCE(balance, 0), 'sale', public.ledger_sale_json(sale.id, sale.user_id, '', '', sale.category_slug_snapshot, sale.product_name_snapshot, sale.customer_number, sale.customer_name, sale.amount, sale.amount, 0, 0, 0, '', NULL, sale.status, 'production', sale.created_at));
    END IF;

    note := 'Pembayaran ' || (p_payload->>'product');
    balance := public.ledger_move(p_actor::text, -amount, p_actor, sale.id, NULL, 'produksi', NULL, note, client_ref || ':debit');
    UPDATE public.transactions SET status = 'success', completed_at = now() WHERE id = sale.id RETURNING * INTO sale;
    INSERT INTO public.transaction_status_history (transaction_id, old_status, new_status, changed_by, reason)
    VALUES (sale.id, 'pending', 'success', p_actor, 'Pembayaran berhasil');
    RETURN jsonb_build_object('status', 200, 'balance', balance, 'sale', public.ledger_sale_json(sale.id, sale.user_id, NULLIF(p_payload->>'loketCode', ''), NULLIF(p_payload->>'loketName', ''), sale.category_slug_snapshot, sale.product_name_snapshot, sale.customer_number, sale.customer_name, sale.amount, COALESCE((p_payload->>'tagihan')::bigint, sale.amount), COALESCE((p_payload->>'denda')::bigint, 0), COALESCE((p_payload->>'adminFee')::bigint, 0), COALESCE((p_payload->>'collfee')::bigint, 0), NULLIF(p_payload->>'period', ''), NULLIF(p_payload->>'parentId', '')::uuid, sale.status, 'production', sale.created_at));
  END IF;

  RETURN jsonb_build_object('error', 'Permintaan saldo tidak dikenali.', 'status', 404);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'SALDO:%' THEN
      RETURN jsonb_build_object('error', substr(SQLERRM, 7), 'status', 409);
    END IF;
    IF SQLSTATE = '23505' THEN
      RETURN jsonb_build_object('error', 'Data yang sama sudah tercatat. Muat ulang, lalu coba lagi.', 'status', 409);
    END IF;
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_import_snapshot(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  entry jsonb;
  account text;
  ticket_id uuid;
  sale_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ledger_control WHERE json_imported_at IS NOT NULL) THEN
    RETURN jsonb_build_object('imported', false, 'reason', 'already');
  END IF;
  IF EXISTS (SELECT 1 FROM public.fund_entries) OR EXISTS (SELECT 1 FROM public.deposit_tickets) THEN
    UPDATE public.ledger_control SET json_imported_at = now() WHERE id = 1;
    RETURN jsonb_build_object('imported', false, 'reason', 'database-already-used');
  END IF;

  FOR account, entry IN SELECT key, value FROM jsonb_each(COALESCE(p->'wallets', '{}'::jsonb))
  LOOP
    IF account = '__pusat__' THEN
      UPDATE public.platform_accounts SET balance = GREATEST(balance, COALESCE((entry)::text::bigint, 0)), updated_at = now() WHERE id = '__pusat__';
    ELSIF account ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      BEGIN
        INSERT INTO public.wallets (user_id, balance, status)
        VALUES (account::uuid, COALESCE((entry)::text::bigint, 0), 'active')
        ON CONFLICT (user_id) DO UPDATE SET balance = CASE WHEN public.wallets.balance = 0 THEN EXCLUDED.balance ELSE public.wallets.balance END;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;

  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(p->'tickets', '[]'::jsonb))
  LOOP
    BEGIN
      ticket_id := (entry->>'id')::uuid;
    INSERT INTO public.deposit_tickets (
      id, applicant_id, applicant_name, applicant_code, applicant_role, amount, base_amount, unique_code,
      transfer_amount, bank, account_number, account_holder, transfer_at, expires_at, status, route,
      approver_id, upline_name, upline_role, funded_by, decided_by, created_at, decided_at
    ) VALUES (
      ticket_id,
      (entry->>'loketId')::uuid,
      COALESCE(entry->>'loketName', 'Pemohon'),
      entry->>'loketCode',
      COALESCE(entry->>'applicantRole', 'loket'),
      COALESCE((entry->>'amount')::bigint, 0),
      COALESCE((entry->>'baseAmount')::bigint, (entry->>'amount')::bigint, 0),
      COALESCE(entry->>'uniqueCode', '000'),
      COALESCE((entry->>'transferAmount')::bigint, (entry->>'amount')::bigint, 0),
      COALESCE(entry->>'bank', '-'),
      COALESCE(entry->>'accountNumber', '-'),
      COALESCE(entry->>'accountHolder', '-'),
      COALESCE((entry->>'transferAt')::timestamptz, now()),
      (entry->>'expiresAt')::timestamptz,
      COALESCE(entry->>'status', 'pending'),
      CASE WHEN entry->>'route' = 'jaringan' THEN 'jaringan' ELSE 'pusat' END,
      NULLIF(entry->>'approverId', '')::uuid,
      entry->>'uplineName',
      entry->>'uplineRole',
      NULLIF(entry->>'fundedBy', ''),
      NULLIF(entry->>'decidedBy', '')::uuid,
      COALESCE((entry->>'createdAt')::timestamptz, now()),
      (entry->>'decidedAt')::timestamptz
    ) ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  UPDATE public.deposit_tickets
  SET status = 'cancelled', decided_at = COALESCE(decided_at, now())
  WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= now();

  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(p->'mutations', '[]'::jsonb))
  LOOP
    BEGIN
      INSERT INTO public.fund_entries (id, at, ticket_id, actor_id, account_id, counterparty_id, direction, amount, balance_after, route, kind, note, idempotency_key)
      VALUES (
        COALESCE((entry->>'id')::uuid, gen_random_uuid()),
        COALESCE((entry->>'at')::timestamptz, now()),
        NULLIF(entry->>'ticketId', '')::uuid,
        NULLIF(entry->>'actorId', '')::uuid,
        entry->>'accountId',
        NULLIF(entry->>'counterpartyId', ''),
        CASE WHEN entry->>'direction' = 'debit' THEN 'debit' ELSE 'credit' END,
        GREATEST(COALESCE((entry->>'amount')::bigint, 1), 1),
        GREATEST(COALESCE((entry->>'balanceAfter')::bigint, 0), 0),
        CASE WHEN entry->>'route' = 'jaringan' THEN 'jaringan' ELSE 'pusat' END,
        NULLIF(entry->>'kind', ''),
        COALESCE(entry->>'note', 'Mutasi lama'),
        'import:' || COALESCE(entry->>'id', gen_random_uuid()::text)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(p->'sales', '[]'::jsonb))
  LOOP
    BEGIN
      sale_id := (entry->>'id')::uuid;
      INSERT INTO public.payment_simulations (
        id, loket_id, client_ref, category, product, customer_number, customer_name, amount, tagihan, denda,
        admin_fee, collfee, period, loket_code, loket_name, parent_id, status, created_at
      ) VALUES (
        sale_id,
        (entry->>'loketId')::uuid,
        'import:' || sale_id::text,
        COALESCE(entry->>'category', 'lainnya'),
        COALESCE(entry->>'product', 'Pembayaran'),
        COALESCE(entry->>'customerNumber', '-'),
        entry->>'customerName',
        COALESCE((entry->>'amount')::bigint, 0),
        (entry->>'tagihan')::bigint,
        (entry->>'denda')::bigint,
        (entry->>'adminFee')::bigint,
        (entry->>'collfee')::bigint,
        entry->>'period',
        entry->>'loketCode',
        entry->>'loketName',
        NULLIF(entry->>'parentId', '')::uuid,
        'simulated',
        COALESCE((entry->>'createdAt')::timestamptz, now())
      ) ON CONFLICT (loket_id, client_ref) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  UPDATE public.ledger_control SET json_imported_at = now() WHERE id = 1;
  RETURN jsonb_build_object('imported', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('imported', false, 'reason', SQLERRM);
END;
$$;

DROP POLICY IF EXISTS "wallets_select_scope" ON public.wallets;
CREATE POLICY "wallets_select_scope" ON public.wallets FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR user_id = ANY(public.descendant_ids(auth.uid()))
  OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin' AND COALESCE(is_active, true))
);

DROP POLICY IF EXISTS "ledger_select_scope" ON public.wallet_ledger;
CREATE POLICY "ledger_select_scope" ON public.wallet_ledger FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR user_id = ANY(public.descendant_ids(auth.uid()))
  OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin' AND COALESCE(is_active, true))
);

DROP POLICY IF EXISTS "tx_select_scope" ON public.transactions;
CREATE POLICY "tx_select_scope" ON public.transactions FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR user_id = ANY(public.descendant_ids(auth.uid()))
  OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin' AND COALESCE(is_active, true))
);

REVOKE ALL ON FUNCTION public.ledger_role(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_network(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_can_see(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_ticket_json(public.deposit_tickets) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_sale_json(uuid, uuid, text, text, text, text, text, text, bigint, bigint, bigint, bigint, bigint, text, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_move(text, bigint, uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_api(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_import_snapshot(jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ledger_api(text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_import_snapshot(jsonb) TO service_role;
