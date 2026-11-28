-- Saldo Utama tidak boleh naik melebihi saldo DigiFlazz setelah dompet jaringan
-- dan fee internal dihitung. Setarakan baseline menurunkan kelebihan yang masih
-- ada di Saldo Utama dan memasang titik acuan baru. Dompet loket tidak dikurangi.
-- Aman dijalankan dua kali.

CREATE OR REPLACE FUNCTION public.ledger_sync_provider(p_actor uuid, p_deposit bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $sync$
DECLARE
  role text;
  pusat bigint;
  wallets bigint;
  fee bigint;
  used bigint;
  basis bigint;
  basis_mark bigint;
  has_basis boolean;
  delta bigint;
  headroom bigint;
  apply bigint;
  balance bigint;
  credited bigint := 0;
BEGIN
  role := public.ledger_role(p_actor);
  IF role <> 'super_admin' THEN
    RETURN jsonb_build_object('error', 'Hanya Super Admin yang dapat menarik saldo DigiFlazz.', 'status', 403);
  END IF;
  IF p_deposit IS NULL OR p_deposit < 0 THEN
    RETURN jsonb_build_object('error', 'Saldo DigiFlazz tidak valid.', 'status', 400);
  END IF;

  PERFORM 1 FROM public.platform_accounts WHERE id = '__digiflazz_basis__' FOR UPDATE;
  has_basis := FOUND;
  SELECT COALESCE(sum(w.balance), 0) INTO wallets FROM public.wallets w;
  SELECT COALESCE(platform_accounts.balance, 0) INTO pusat FROM public.platform_accounts WHERE id = '__pusat__';
  SELECT COALESCE(platform_accounts.balance, 0) INTO fee FROM public.platform_accounts WHERE id = '__fee__';
  pusat := COALESCE(pusat, 0);
  fee := COALESCE(fee, 0);
  wallets := COALESCE(wallets, 0);
  SELECT COALESCE(sum(tx.cost_price), 0) INTO used
  FROM public.transactions tx
  WHERE tx.status = 'success' AND tx.channel = 'production';
  used := COALESCE(used, 0);
  basis := p_deposit + used;
  headroom := p_deposit - (pusat + wallets + fee);

  IF NOT has_basis THEN
    apply := GREATEST(0, LEAST(p_deposit, headroom));
    IF pusat = 0 AND wallets = 0 AND fee = 0 AND apply > 0 THEN
      balance := public.ledger_move('__pusat__', apply, p_actor, NULL, '__digiflazz__', 'pusat', NULL, 'Setoran awal dari saldo DigiFlazz', 'digiflazz-sync:initial:' || apply::text || ':' || p_deposit::text);
      credited := apply;
      pusat := balance;
    ELSE
      balance := pusat;
      apply := 0;
    END IF;
    INSERT INTO public.platform_accounts (id, balance)
    VALUES ('__digiflazz_basis__', basis - GREATEST(p_deposit - (COALESCE(balance, pusat) + wallets + fee), 0))
    ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
    INSERT INTO public.platform_accounts (id, balance)
    VALUES ('__digiflazz__', p_deposit)
    ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
    RETURN jsonb_build_object('status', 200, 'balance', COALESCE(balance, pusat), 'providerBalance', p_deposit, 'credited', credited, 'consumed', 0, 'capped', headroom < p_deposit AND credited = 0, 'initial', true);
  END IF;

  SELECT platform_accounts.balance INTO basis_mark
  FROM public.platform_accounts WHERE id = '__digiflazz_basis__' FOR UPDATE;
  basis_mark := COALESCE(basis_mark, 0);
  delta := basis - basis_mark;
  apply := LEAST(GREATEST(delta, 0), GREATEST(headroom, 0));
  IF apply > 0 THEN
    balance := public.ledger_move('__pusat__', apply, p_actor, NULL, '__digiflazz__', 'pusat', NULL, 'Setoran baru DigiFlazz masuk ke Saldo Utama', 'digiflazz-basis:' || basis_mark::text || ':' || (basis_mark + apply)::text);
    credited := apply;
    UPDATE public.platform_accounts
    SET balance = basis_mark + apply, updated_at = now()
    WHERE id = '__digiflazz_basis__';
  ELSE
    balance := pusat;
  END IF;
  INSERT INTO public.platform_accounts (id, balance)
  VALUES ('__digiflazz__', p_deposit)
  ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
  RETURN jsonb_build_object(
    'status', 200,
    'balance', COALESCE(balance, pusat),
    'providerBalance', p_deposit,
    'credited', credited,
    'consumed', GREATEST(0, -delta),
    'capped', delta > 0 AND apply = 0,
    'initial', false
  );
END;
$sync$;

CREATE OR REPLACE FUNCTION public.ledger_align_provider(p_actor uuid, p_deposit bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $align$
DECLARE
  role text;
  pusat bigint;
  wallets bigint;
  fee bigint;
  used bigint;
  basis bigint;
  excess bigint;
  reduce bigint;
  balance bigint;
  headroom bigint;
  mark bigint;
BEGIN
  role := public.ledger_role(p_actor);
  IF role <> 'super_admin' THEN
    RETURN jsonb_build_object('error', 'Hanya Super Admin yang dapat menyetarakan saldo.', 'status', 403);
  END IF;
  IF p_deposit IS NULL OR p_deposit < 0 THEN
    RETURN jsonb_build_object('error', 'Saldo DigiFlazz tidak valid.', 'status', 400);
  END IF;

  PERFORM 1 FROM public.platform_accounts WHERE id IN ('__pusat__', '__digiflazz_basis__') FOR UPDATE;
  SELECT COALESCE(platform_accounts.balance, 0) INTO pusat FROM public.platform_accounts WHERE id = '__pusat__';
  SELECT COALESCE(platform_accounts.balance, 0) INTO fee FROM public.platform_accounts WHERE id = '__fee__';
  SELECT COALESCE(sum(w.balance), 0) INTO wallets FROM public.wallets w;
  SELECT COALESCE(sum(tx.cost_price), 0) INTO used
  FROM public.transactions tx
  WHERE tx.status = 'success' AND tx.channel = 'production';
  pusat := COALESCE(pusat, 0);
  fee := COALESCE(fee, 0);
  wallets := COALESCE(wallets, 0);
  used := COALESCE(used, 0);
  excess := pusat + wallets + fee - p_deposit;
  reduce := LEAST(pusat, GREATEST(excess, 0));
  IF reduce > 0 THEN
    balance := public.ledger_move('__pusat__', -reduce, p_actor, NULL, '__digiflazz__', 'pusat', NULL, 'Penyetaraan Saldo Utama ke saldo DigiFlazz', 'digiflazz-align:' || pusat::text || ':' || (pusat - reduce)::text || ':' || p_deposit::text);
  ELSE
    balance := pusat;
  END IF;
  basis := p_deposit + used;
  headroom := p_deposit - (COALESCE(balance, pusat - reduce) + wallets + fee);
  mark := basis - GREATEST(headroom, 0);
  INSERT INTO public.platform_accounts (id, balance)
  VALUES ('__digiflazz_basis__', mark)
  ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
  INSERT INTO public.platform_accounts (id, balance)
  VALUES ('__digiflazz__', p_deposit)
  ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
  RETURN jsonb_build_object(
    'status', 200,
    'balance', COALESCE(balance, pusat - reduce),
    'providerBalance', p_deposit,
    'reduced', reduce,
    'remaining', GREATEST(excess - reduce, 0),
    'shortfall', GREATEST(-excess, 0)
  );
END;
$align$;

REVOKE ALL ON FUNCTION public.ledger_align_provider(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_align_provider(uuid, bigint) TO service_role;
