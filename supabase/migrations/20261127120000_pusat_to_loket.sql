-- Transfer Saldo Utama (__pusat__) ke loket, bukan dari dompet pribadi Super Admin.
-- Kunci clientRef mencegah potongan ganda. Tarik saldo DigiFlazz hanya menambah
-- setoran baru; penurunan karena transaksi tidak memotong Saldo Utama lagi.
-- Aman dijalankan dua kali.

DO $fix$
DECLARE
  src text;
  old_mid text := $old$    target := p_payload->>'loketId';
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
    RETURN jsonb_build_object('status', 200, 'id', ref, 'fromBalance', from_balance, 'toBalance', to_balance);$old$;
  new_mid text := $new$    target := p_payload->>'loketId';
    amount := round(COALESCE((p_payload->>'amount')::numeric, 0))::bigint;
    idem := NULLIF(trim(COALESCE(p_payload->>'clientRef', '')), '');
    IF amount < 1000 THEN
      RETURN jsonb_build_object('error', 'Nominal distribusi minimal Rp1.000.', 'status', 400);
    END IF;
    IF idem IS NOT NULL AND idem !~ '^[A-Za-z0-9:_-]{8,80}$' THEN
      RETURN jsonb_build_object('error', 'Kunci transfer tidak valid.', 'status', 400);
    END IF;
    IF target IS NULL OR target !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('error', 'Loket tujuan tidak valid.', 'status', 400);
    END IF;
    IF public.ledger_role(target::uuid) <> 'loket' THEN
      RETURN jsonb_build_object('error', 'Saldo hanya dapat dikirim ke loket.', 'status', 403);
    END IF;
    IF idem IS NOT NULL AND EXISTS (SELECT 1 FROM public.fund_entries WHERE idempotency_key = idem || ':from') THEN
      SELECT platform_accounts.balance INTO from_balance FROM public.platform_accounts WHERE platform_accounts.id = '__pusat__';
      SELECT w.balance INTO to_balance FROM public.wallets w WHERE w.user_id = target::uuid;
      RETURN jsonb_build_object('status', 200, 'duplicate', true, 'fromBalance', COALESCE(from_balance, 0), 'toBalance', COALESCE(to_balance, 0));
    END IF;
    ref := gen_random_uuid();
    IF idem IS NULL THEN idem := ref::text; END IF;
    from_balance := public.ledger_move('__pusat__', -amount, p_actor, ref, target, 'jaringan', 'distribusi', 'Distribusi saldo ke ' || COALESCE(p_payload->>'loketName', 'Loket'), idem || ':from');
    to_balance := public.ledger_move(target, amount, p_actor, ref, '__pusat__', 'jaringan', 'distribusi', 'Distribusi saldo dari Super Admin', idem || ':to');
    RETURN jsonb_build_object('status', 200, 'id', ref, 'fromBalance', from_balance, 'toBalance', to_balance);$new$;
BEGIN
  src := pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure);
  src := replace(
    src,
    'IF role <> ''mitra'' THEN
      RETURN jsonb_build_object(''error'', ''Hanya Mitra yang dapat mendistribusikan saldo ke loketnya.'', ''status'', 403);
    END IF;',
    'IF role <> ''super_admin'' THEN
      RETURN jsonb_build_object(''error'', ''Hanya Super Admin yang dapat mendistribusikan saldo ke Loket.'', ''status'', 403);
    END IF;'
  );
  src := replace(
    src,
    'IF role <> ''super_admin'' THEN
      RETURN jsonb_build_object(''error'', ''Hanya Super Admin yang dapat mendistribusikan saldo ke Mitra, Sub Mitra, dan Loket.'', ''status'', 403);
    END IF;',
    'IF role <> ''super_admin'' THEN
      RETURN jsonb_build_object(''error'', ''Hanya Super Admin yang dapat mendistribusikan saldo ke Loket.'', ''status'', 403);
    END IF;'
  );
  IF position('ledger_move(''__pusat__'', -amount, p_actor, ref, target' IN src) = 0 THEN
    IF position('idem text;' IN src) = 0 THEN
      src := regexp_replace(src, 'ref uuid;[[:space:]]+visible uuid\[\]', 'ref uuid;' || chr(10) || '  idem text;' || chr(10) || '  visible uuid[]');
    END IF;
    IF position('idem text;' IN src) = 0 THEN
      RAISE EXCEPTION 'Migrasi saldo tidak menemukan deklarasi ref uuid pada ledger_api.';
    END IF;
    IF position(old_mid IN src) = 0 THEN
      RAISE EXCEPTION 'Blok distribusi ledger_api tidak dikenali.';
    END IF;
    src := replace(src, old_mid, new_mid);
    EXECUTE src;
  END IF;
END
$fix$;

CREATE OR REPLACE FUNCTION public.ledger_sync_provider(p_actor uuid, p_deposit bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $sync$
DECLARE
  role text;
  mark bigint;
  delta bigint;
  balance bigint;
  wallets bigint;
  credited bigint := 0;
  has_mark boolean;
BEGIN
  role := public.ledger_role(p_actor);
  IF role <> 'super_admin' THEN
    RETURN jsonb_build_object('error', 'Hanya Super Admin yang dapat menarik saldo DigiFlazz.', 'status', 403);
  END IF;
  IF p_deposit IS NULL OR p_deposit < 0 THEN
    RETURN jsonb_build_object('error', 'Saldo DigiFlazz tidak valid.', 'status', 400);
  END IF;

  SELECT platform_accounts.balance INTO mark
  FROM public.platform_accounts
  WHERE platform_accounts.id = '__digiflazz__';
  has_mark := FOUND;

  SELECT COALESCE(sum(w.balance), 0) INTO wallets FROM public.wallets w;
  SELECT COALESCE(platform_accounts.balance, 0) INTO balance
  FROM public.platform_accounts
  WHERE platform_accounts.id = '__pusat__';
  balance := COALESCE(balance, 0);

  IF NOT has_mark THEN
    IF balance = 0 AND wallets = 0 AND p_deposit > 0 THEN
      balance := public.ledger_move('__pusat__', p_deposit, p_actor, NULL, '__digiflazz__', 'pusat', NULL, 'Setoran awal dari saldo DigiFlazz', 'digiflazz-sync:initial:' || p_deposit::text);
      credited := p_deposit;
    END IF;
    INSERT INTO public.platform_accounts (id, balance)
    VALUES ('__digiflazz__', p_deposit)
    ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
    RETURN jsonb_build_object('status', 200, 'balance', COALESCE(balance, 0), 'providerBalance', p_deposit, 'credited', credited, 'consumed', 0, 'initial', true);
  END IF;

  delta := p_deposit - COALESCE(mark, 0);
  IF delta > 0 THEN
    balance := public.ledger_move('__pusat__', delta, p_actor, NULL, '__digiflazz__', 'pusat', NULL, 'Setoran DigiFlazz masuk ke Saldo Utama', 'digiflazz-sync:' || COALESCE(mark, 0)::text || ':' || p_deposit::text);
    credited := delta;
  END IF;
  UPDATE public.platform_accounts
  SET balance = p_deposit, updated_at = now()
  WHERE id = '__digiflazz__';
  RETURN jsonb_build_object(
    'status', 200,
    'balance', COALESCE(balance, 0),
    'providerBalance', p_deposit,
    'credited', credited,
    'consumed', CASE WHEN delta < 0 THEN -delta ELSE 0 END,
    'initial', false
  );
END;
$sync$;

REVOKE ALL ON FUNCTION public.ledger_sync_provider(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_sync_provider(uuid, bigint) TO service_role;
