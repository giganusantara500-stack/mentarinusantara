-- Tarikan DigiFlazz hanya menambah Saldo Utama sebesar setoran yang benar-benar baru.
-- Pemakaian transaksi menurunkan saldo DigiFlazz dan menaikkan biaya pokok tercatat
-- dengan jumlah yang sama, jadi angka itu tidak ditarik lagi. Penanda tidak pernah
-- diturunkan, jadi pembacaan yang naik-turun tidak mengkredit saldo dua kali.
-- Aman dijalankan dua kali.

INSERT INTO public.platform_accounts (id, balance)
VALUES ('__digiflazz__', 0)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ledger_money_snapshot(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $snap$
DECLARE
  role text;
  pusat bigint;
  fee bigint;
  wallets bigint;
  used bigint;
BEGIN
  role := public.ledger_role(p_actor);
  IF role <> 'super_admin' THEN
    RETURN jsonb_build_object('error', 'Hanya Super Admin yang dapat melihat rekonsiliasi saldo.', 'status', 403);
  END IF;
  SELECT COALESCE(platform_accounts.balance, 0) INTO pusat FROM public.platform_accounts WHERE id = '__pusat__';
  SELECT COALESCE(platform_accounts.balance, 0) INTO fee FROM public.platform_accounts WHERE id = '__fee__';
  SELECT COALESCE(sum(w.balance), 0) INTO wallets FROM public.wallets w;
  SELECT COALESCE(sum(tx.cost_price), 0) INTO used
  FROM public.transactions tx
  WHERE tx.status = 'success' AND tx.channel = 'production';
  RETURN jsonb_build_object(
    'status', 200,
    'pusat', COALESCE(pusat, 0),
    'fee', COALESCE(fee, 0),
    'wallets', COALESCE(wallets, 0),
    'providerUsed', COALESCE(used, 0)
  );
END;
$snap$;

REVOKE ALL ON FUNCTION public.ledger_money_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_money_snapshot(uuid) TO service_role;

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
  used bigint;
  basis bigint;
  basis_mark bigint;
  has_basis boolean;
  delta bigint;
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
  SELECT COALESCE(platform_accounts.balance, 0) INTO pusat
  FROM public.platform_accounts WHERE id = '__pusat__';
  pusat := COALESCE(pusat, 0);
  SELECT COALESCE(sum(tx.cost_price), 0) INTO used
  FROM public.transactions tx
  WHERE tx.status = 'success' AND tx.channel = 'production';
  used := COALESCE(used, 0);
  basis := p_deposit + used;

  IF NOT has_basis THEN
    IF pusat = 0 AND wallets = 0 AND p_deposit > 0 THEN
      balance := public.ledger_move('__pusat__', p_deposit, p_actor, NULL, '__digiflazz__', 'pusat', NULL, 'Setoran awal dari saldo DigiFlazz', 'digiflazz-sync:initial:' || p_deposit::text);
      credited := p_deposit;
      pusat := balance;
    ELSE
      balance := pusat;
    END IF;
    INSERT INTO public.platform_accounts (id, balance)
    VALUES ('__digiflazz_basis__', basis)
    ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
    INSERT INTO public.platform_accounts (id, balance)
    VALUES ('__digiflazz__', p_deposit)
    ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
    RETURN jsonb_build_object('status', 200, 'balance', COALESCE(balance, pusat), 'providerBalance', p_deposit, 'credited', credited, 'consumed', 0, 'initial', true);
  END IF;

  SELECT platform_accounts.balance INTO basis_mark
  FROM public.platform_accounts
  WHERE id = '__digiflazz_basis__'
  FOR UPDATE;
  basis_mark := COALESCE(basis_mark, 0);
  delta := basis - basis_mark;
  IF delta > 0 THEN
    balance := public.ledger_move('__pusat__', delta, p_actor, NULL, '__digiflazz__', 'pusat', NULL, 'Setoran baru DigiFlazz masuk ke Saldo Utama', 'digiflazz-basis:' || basis_mark::text || ':' || basis::text);
    credited := delta;
    UPDATE public.platform_accounts
    SET balance = basis, updated_at = now()
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
    'initial', false
  );
END;
$sync$;
