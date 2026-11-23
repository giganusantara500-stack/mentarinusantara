-- Kerangka H2H. Kredensial provider tidak disimpan di tabel ini.
-- Secret hanya dibaca Edge Function dari environment Supabase.
-- Aman dijalankan ulang.

CREATE TABLE IF NOT EXISTS public.h2h_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  cost_price bigint NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS h2h_products_sku_key ON public.h2h_products (lower(sku));

CREATE TABLE IF NOT EXISTS public.h2h_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  actor_role text NOT NULL CHECK (actor_role IN ('super_admin', 'mitra', 'submitra', 'loket')),
  sku text NOT NULL,
  category text NOT NULL,
  customer_number text NOT NULL,
  amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  cost_price bigint NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  provider_reference text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS h2h_transactions_ref_id_key ON public.h2h_transactions (ref_id);
CREATE INDEX IF NOT EXISTS h2h_transactions_actor_idx ON public.h2h_transactions (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS h2h_transactions_status_idx ON public.h2h_transactions (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.h2h_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid REFERENCES public.h2h_transactions (id) ON DELETE SET NULL,
  ref_id text NOT NULL,
  actor_id uuid,
  endpoint_host text,
  endpoint_path text,
  outcome text NOT NULL CHECK (outcome IN ('skipped', 'sent', 'error')),
  http_status integer,
  request_body jsonb,
  response_body jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS h2h_request_logs_ref_idx ON public.h2h_request_logs (ref_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.h2h_callback_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid REFERENCES public.h2h_transactions (id) ON DELETE SET NULL,
  ref_id text NOT NULL,
  provider_status text,
  applied_status text,
  duplicate boolean NOT NULL DEFAULT false,
  signature_checked boolean NOT NULL DEFAULT false,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS h2h_callback_logs_ref_idx ON public.h2h_callback_logs (ref_id, created_at DESC);

ALTER TABLE public.h2h_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.h2h_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.h2h_request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.h2h_callback_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.h2h_products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.h2h_transactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.h2h_request_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.h2h_callback_logs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.h2h_product_json(p public.h2h_products, p_include_cost boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_include_cost THEN jsonb_build_object(
      'id', p.id, 'sku', p.sku, 'name', p.name, 'category', p.category,
      'costPrice', p.cost_price, 'active', p.status = 'active'
    )
    ELSE jsonb_build_object(
      'id', p.id, 'sku', p.sku, 'name', p.name, 'category', p.category,
      'active', p.status = 'active'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.h2h_tx_json(t public.h2h_transactions, p_include_cost boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_include_cost THEN jsonb_build_object(
      'id', t.id, 'refId', t.ref_id, 'actorId', t.actor_id, 'actorRole', t.actor_role,
      'sku', t.sku, 'category', t.category, 'customerNumber', t.customer_number,
      'amount', t.amount, 'costPrice', t.cost_price, 'status', t.status,
      'providerReference', t.provider_reference, 'note', t.note,
      'createdAt', t.created_at, 'updatedAt', t.updated_at, 'completedAt', t.completed_at
    )
    ELSE jsonb_build_object(
      'id', t.id, 'refId', t.ref_id, 'actorId', t.actor_id, 'actorRole', t.actor_role,
      'sku', t.sku, 'category', t.category, 'customerNumber', t.customer_number,
      'amount', t.amount, 'status', t.status,
      'providerReference', t.provider_reference, 'note', t.note,
      'createdAt', t.created_at, 'updatedAt', t.updated_at, 'completedAt', t.completed_at
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.h2h_api(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  role text;
  see_cost boolean;
  v_sku text;
  v_name text;
  v_category text;
  v_cost bigint;
  v_active boolean;
  v_ref text;
  v_customer text;
  v_amount bigint;
  v_product public.h2h_products%ROWTYPE;
  v_tx public.h2h_transactions%ROWTYPE;
  v_existing public.h2h_transactions%ROWTYPE;
BEGIN
  IF actor IS NULL THEN
    RETURN jsonb_build_object('error', 'Sesi tidak valid. Silakan login ulang.', 'status', 401);
  END IF;
  role := public.ledger_role(actor);
  IF role = '' THEN
    RETURN jsonb_build_object('error', 'Sesi tidak valid atau akun tidak aktif.', 'status', 401);
  END IF;
  IF role NOT IN ('super_admin', 'mitra', 'submitra', 'loket') THEN
    RETURN jsonb_build_object('error', 'Peran ini tidak dapat memakai jalur H2H.', 'status', 403);
  END IF;
  see_cost := role = 'super_admin';

  IF p_action = 'products' THEN
    RETURN jsonb_build_object(
      'status', 200,
      'products', COALESCE((
        SELECT jsonb_agg(public.h2h_product_json(p, see_cost) ORDER BY p.category, p.sku)
        FROM public.h2h_products p
        WHERE see_cost OR p.status = 'active'
      ), '[]'::jsonb)
    );
  END IF;

  IF p_action = 'save_product' THEN
    IF role <> 'super_admin' THEN
      RETURN jsonb_build_object('error', 'Hanya Super Admin yang dapat mengubah pemetaan produk H2H.', 'status', 403);
    END IF;
    v_sku := left(btrim(COALESCE(p_payload->>'sku', '')), 64);
    v_name := left(btrim(COALESCE(p_payload->>'name', '')), 120);
    v_category := left(btrim(COALESCE(p_payload->>'category', '')), 40);
    v_active := COALESCE((p_payload->>'active')::boolean, true);
    IF v_sku !~ '^[A-Za-z0-9._-]{1,64}$' OR v_name = '' OR v_category = '' THEN
      RETURN jsonb_build_object('error', 'Kode produk, nama, dan kategori wajib diisi.', 'status', 400);
    END IF;
    IF COALESCE(p_payload->>'costPrice', '') !~ '^[0-9]+$' THEN
      RETURN jsonb_build_object('error', 'Harga modal tidak valid.', 'status', 400);
    END IF;
    v_cost := (p_payload->>'costPrice')::bigint;
    INSERT INTO public.h2h_products (sku, name, category, cost_price, status, created_by, updated_at)
    VALUES (v_sku, v_name, v_category, v_cost, CASE WHEN v_active THEN 'active' ELSE 'inactive' END, actor, now())
    ON CONFLICT ((lower(sku))) DO UPDATE
      SET name = EXCLUDED.name,
          category = EXCLUDED.category,
          cost_price = EXCLUDED.cost_price,
          status = EXCLUDED.status,
          updated_at = now()
    RETURNING * INTO v_product;
    RETURN jsonb_build_object('status', 200, 'product', public.h2h_product_json(v_product, true));
  END IF;

  IF p_action = 'prepare' THEN
    IF role NOT IN ('loket', 'mitra', 'submitra', 'super_admin') THEN
      RETURN jsonb_build_object('error', 'Peran ini tidak dapat membuat transaksi H2H.', 'status', 403);
    END IF;
    v_sku := left(btrim(COALESCE(p_payload->>'sku', '')), 64);
    v_customer := left(btrim(COALESCE(p_payload->>'customerNumber', '')), 32);
    v_ref := left(btrim(COALESCE(p_payload->>'refId', '')), 64);
    IF v_sku = '' OR v_customer !~ '^[A-Za-z0-9._+-]{4,32}$' THEN
      RETURN jsonb_build_object('error', 'Kode produk dan nomor pelanggan wajib diisi.', 'status', 400);
    END IF;
    IF v_ref <> '' AND v_ref !~ '^[A-Za-z0-9._:-]{8,64}$' THEN
      RETURN jsonb_build_object('error', 'Kode referensi tidak valid.', 'status', 400);
    END IF;
    SELECT * INTO v_product FROM public.h2h_products WHERE lower(sku) = lower(v_sku) AND status = 'active';
    IF v_product.id IS NULL THEN
      RETURN jsonb_build_object('error', 'Produk H2H tidak aktif atau tidak ditemukan.', 'status', 404);
    END IF;
    IF COALESCE(p_payload->>'amount', '') = '' THEN
      v_amount := v_product.cost_price;
    ELSIF p_payload->>'amount' !~ '^[0-9]+$' THEN
      RETURN jsonb_build_object('error', 'Nominal transaksi tidak valid.', 'status', 400);
    ELSE
      v_amount := (p_payload->>'amount')::bigint;
    END IF;
    IF v_ref = '' THEN
      v_ref := 'MN' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    END IF;

    SELECT * INTO v_existing FROM public.h2h_transactions WHERE ref_id = v_ref;
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.actor_id <> actor THEN
        RETURN jsonb_build_object('error', 'Kode referensi sudah dipakai.', 'status', 409);
      END IF;
      RETURN jsonb_build_object('status', 200, 'duplicate', true, 'transaction', public.h2h_tx_json(v_existing, see_cost));
    END IF;

    BEGIN
      INSERT INTO public.h2h_transactions (
        ref_id, actor_id, actor_role, sku, category, customer_number, amount, cost_price, status
      ) VALUES (
        v_ref, actor, role, v_product.sku, v_product.category, v_customer, v_amount, v_product.cost_price, 'pending'
      )
      RETURNING * INTO v_tx;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT * INTO v_existing FROM public.h2h_transactions WHERE ref_id = v_ref;
        IF v_existing.actor_id IS DISTINCT FROM actor THEN
          RETURN jsonb_build_object('error', 'Kode referensi sudah dipakai.', 'status', 409);
        END IF;
        RETURN jsonb_build_object('status', 200, 'duplicate', true, 'transaction', public.h2h_tx_json(v_existing, see_cost));
    END;
    RETURN jsonb_build_object('status', 200, 'duplicate', false, 'transaction', public.h2h_tx_json(v_tx, see_cost));
  END IF;

  IF p_action = 'list' THEN
    RETURN jsonb_build_object(
      'status', 200,
      'transactions', COALESCE((
        SELECT jsonb_agg(public.h2h_tx_json(t, see_cost) ORDER BY t.created_at DESC)
        FROM (
          SELECT * FROM public.h2h_transactions t
          WHERE CASE
            WHEN role = 'super_admin' THEN true
            WHEN role IN ('mitra', 'submitra') THEN t.actor_id = ANY(public.ledger_network(actor))
            ELSE t.actor_id = actor
          END
          ORDER BY t.created_at DESC
          LIMIT 100
        ) t
      ), '[]'::jsonb)
    );
  END IF;

  IF p_action = 'logs' THEN
    IF role <> 'super_admin' THEN
      RETURN jsonb_build_object('error', 'Riwayat permintaan H2H hanya dapat dibuka Super Admin.', 'status', 403);
    END IF;
    RETURN jsonb_build_object(
      'status', 200,
      'requests', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', l.id, 'refId', l.ref_id, 'actorId', l.actor_id, 'host', l.endpoint_host,
          'path', l.endpoint_path, 'outcome', l.outcome, 'httpStatus', l.http_status,
          'request', l.request_body, 'response', l.response_body, 'error', l.error, 'createdAt', l.created_at
        ) ORDER BY l.created_at DESC)
        FROM (SELECT * FROM public.h2h_request_logs ORDER BY created_at DESC LIMIT 100) l
      ), '[]'::jsonb),
      'callbacks', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', c.id, 'refId', c.ref_id, 'providerStatus', c.provider_status,
          'appliedStatus', c.applied_status, 'duplicate', c.duplicate,
          'signatureChecked', c.signature_checked, 'payload', c.payload, 'createdAt', c.created_at
        ) ORDER BY c.created_at DESC)
        FROM (SELECT * FROM public.h2h_callback_logs ORDER BY created_at DESC LIMIT 100) c
      ), '[]'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object('error', 'Aksi H2H tidak dikenali.', 'status', 404);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'Permintaan H2H gagal diproses.', 'status', 500);
END;
$$;

CREATE OR REPLACE FUNCTION public.h2h_service(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text;
  v_status text;
  v_provider text;
  v_tx public.h2h_transactions%ROWTYPE;
  v_duplicate boolean := false;
  v_applied text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('error', 'Aksi ini hanya dapat dijalankan dari server.', 'status', 403);
  END IF;

  IF p_action = 'log_request' THEN
    v_ref := left(btrim(COALESCE(p_payload->>'refId', '')), 64);
    IF v_ref = '' OR COALESCE(p_payload->>'outcome', '') NOT IN ('skipped', 'sent', 'error') THEN
      RETURN jsonb_build_object('error', 'Catatan permintaan H2H tidak lengkap.', 'status', 400);
    END IF;
    INSERT INTO public.h2h_request_logs (
      transaction_id, ref_id, actor_id, endpoint_host, endpoint_path, outcome, http_status, request_body, response_body, error
    ) VALUES (
      NULLIF(p_payload->>'transactionId', '')::uuid,
      v_ref,
      NULLIF(p_payload->>'actorId', '')::uuid,
      NULLIF(left(COALESCE(p_payload->>'host', ''), 200), ''),
      NULLIF(left(COALESCE(p_payload->>'path', ''), 300), ''),
      p_payload->>'outcome',
      NULLIF(p_payload->>'httpStatus', '')::integer,
      p_payload->'request',
      p_payload->'response',
      NULLIF(left(COALESCE(p_payload->>'error', ''), 500), '')
    );
    RETURN jsonb_build_object('status', 200);
  END IF;

  IF p_action = 'apply_callback' THEN
    v_ref := left(btrim(COALESCE(p_payload->>'refId', '')), 64);
    v_provider := lower(left(btrim(COALESCE(p_payload->>'providerStatus', '')), 40));
    IF v_ref = '' THEN
      RETURN jsonb_build_object('error', 'Callback tanpa kode referensi.', 'status', 400);
    END IF;
    v_status := CASE
      WHEN v_provider IN ('success', 'sukses', 'ok', '00', '0') THEN 'success'
      WHEN v_provider IN ('pending', 'process', 'proses', '') THEN 'pending'
      ELSE 'failed'
    END;

    SELECT * INTO v_tx FROM public.h2h_transactions WHERE ref_id = v_ref FOR UPDATE;
    IF v_tx.id IS NULL THEN
      INSERT INTO public.h2h_callback_logs (ref_id, provider_status, applied_status, duplicate, signature_checked, payload)
      VALUES (v_ref, NULLIF(v_provider, ''), NULL, false, COALESCE((p_payload->>'signatureChecked')::boolean, false), p_payload->'payload');
      RETURN jsonb_build_object('error', 'Transaksi untuk callback ini tidak ditemukan.', 'status', 404);
    END IF;

    v_duplicate := v_tx.status <> 'pending' OR v_status = 'pending';
    v_applied := v_tx.status;
    IF v_tx.status = 'pending' AND v_status IN ('success', 'failed') THEN
      UPDATE public.h2h_transactions
      SET status = v_status,
          provider_reference = COALESCE(NULLIF(left(COALESCE(p_payload->>'providerReference', ''), 80), ''), provider_reference),
          note = COALESCE(NULLIF(left(COALESCE(p_payload->>'note', ''), 240), ''), note),
          updated_at = now(),
          completed_at = now()
      WHERE id = v_tx.id
      RETURNING * INTO v_tx;
      v_applied := v_tx.status;
      v_duplicate := false;
    END IF;

    INSERT INTO public.h2h_callback_logs (
      transaction_id, ref_id, provider_status, applied_status, duplicate, signature_checked, payload
    ) VALUES (
      v_tx.id, v_ref, NULLIF(v_provider, ''), v_applied, v_duplicate,
      COALESCE((p_payload->>'signatureChecked')::boolean, false), p_payload->'payload'
    );
    RETURN jsonb_build_object('status', 200, 'duplicate', v_duplicate, 'transaction', public.h2h_tx_json(v_tx, true));
  END IF;

  RETURN jsonb_build_object('error', 'Aksi server H2H tidak dikenali.', 'status', 404);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'Callback H2H gagal diproses.', 'status', 500);
END;
$$;

REVOKE ALL ON FUNCTION public.h2h_product_json(public.h2h_products, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.h2h_tx_json(public.h2h_transactions, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.h2h_api(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.h2h_service(text, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.h2h_api(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.h2h_service(text, jsonb) TO service_role;
