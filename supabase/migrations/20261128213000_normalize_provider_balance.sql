-- Normalisasi saldo mengikuti DigiFlazz. Selisih yang masih di Saldo Utama
-- diturunkan, selisih yang belum masuk dinaikkan satu kali, lalu titik acuan
-- dipasang supaya tarikan berikutnya tidak menghitung angka yang sama.
-- Dompet loket tidak diubah. Aman dijalankan dua kali.

CREATE TABLE IF NOT EXISTS public.balance_normalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL,
  provider_balance bigint NOT NULL,
  pusat_before bigint NOT NULL,
  pusat_after bigint NOT NULL,
  wallets bigint NOT NULL,
  fee bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('credit', 'debit', 'none')),
  amount bigint NOT NULL CHECK (amount >= 0),
  remaining bigint NOT NULL DEFAULT 0,
  note text NOT NULL,
  idempotency_key text UNIQUE
);

ALTER TABLE public.balance_normalizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.balance_normalizations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.balance_normalizations TO service_role;

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
  added bigint := 0;
  balance bigint;
  headroom bigint;
  mark bigint;
  direction text;
  moved bigint;
  note text;
  idem text;
  logged boolean := false;
BEGIN
  role := public.ledger_role(p_actor);
  IF role <> 'super_admin' THEN
    RETURN jsonb_build_object('error', 'Hanya Super Admin yang dapat menormalkan saldo.', 'status', 403);
  END IF;
  IF p_deposit IS NULL OR p_deposit < 0 THEN
    RETURN jsonb_build_object('error', 'Saldo DigiFlazz tidak valid.', 'status', 400);
  END IF;

  PERFORM 1 FROM public.platform_accounts WHERE id = '__digiflazz_basis__' FOR UPDATE;
  PERFORM 1 FROM public.platform_accounts WHERE id = '__pusat__' FOR UPDATE;
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
  added := GREATEST(-excess, 0);
  IF reduce > 0 THEN
    direction := 'debit';
    moved := reduce;
    note := 'Normalisasi menurunkan Saldo Utama agar mengikuti saldo DigiFlazz';
    idem := 'digiflazz-normalize:' || pusat::text || ':' || (pusat - reduce)::text || ':' || p_deposit::text;
    balance := public.ledger_move('__pusat__', -reduce, p_actor, NULL, '__digiflazz__', 'pusat', 'normalisasi', note, idem);
  ELSIF added > 0 THEN
    direction := 'credit';
    moved := added;
    note := 'Normalisasi memasukkan selisih DigiFlazz ke Saldo Utama';
    idem := 'digiflazz-normalize:' || pusat::text || ':' || (pusat + added)::text || ':' || p_deposit::text;
    balance := public.ledger_move('__pusat__', added, p_actor, NULL, '__digiflazz__', 'pusat', 'normalisasi', note, idem);
  ELSE
    direction := 'none';
    moved := 0;
    balance := pusat;
    note := 'Saldo sudah mengikuti DigiFlazz';
    idem := NULL;
  END IF;

  IF direction = 'none' AND GREATEST(excess, 0) > 0 THEN
    direction := 'none';
    note := 'Normalisasi tidak mengambil saldo yang sudah ada di dompet loket';
    idem := 'digiflazz-normalize:stuck:' || pusat::text || ':' || wallets::text || ':' || fee::text || ':' || p_deposit::text;
  END IF;

  basis := p_deposit + used;
  headroom := p_deposit - (COALESCE(balance, pusat) + wallets + fee);
  mark := basis - GREATEST(headroom, 0);
  INSERT INTO public.platform_accounts (id, balance)
  VALUES ('__digiflazz_basis__', mark)
  ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
  INSERT INTO public.platform_accounts (id, balance)
  VALUES ('__digiflazz__', p_deposit)
  ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();

  IF idem IS NOT NULL THEN
    INSERT INTO public.balance_normalizations (
      actor_id, provider_balance, pusat_before, pusat_after, wallets, fee,
      direction, amount, remaining, note, idempotency_key
    ) VALUES (
      p_actor, p_deposit, pusat, COALESCE(balance, pusat), wallets, fee,
      direction, moved, GREATEST(excess - reduce, 0), note, idem
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    logged := true;
  END IF;

  RETURN jsonb_build_object(
    'status', 200,
    'balance', COALESCE(balance, pusat),
    'providerBalance', p_deposit,
    'reduced', CASE WHEN direction = 'debit' THEN moved ELSE 0 END,
    'added', CASE WHEN direction = 'credit' THEN moved ELSE 0 END,
    'remaining', GREATEST(excess - reduce, 0),
    'shortfall', 0,
    'direction', direction,
    'logged', logged
  );
END;
$align$;
