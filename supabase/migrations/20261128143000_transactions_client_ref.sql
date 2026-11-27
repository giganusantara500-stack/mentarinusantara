-- Pembayaran menyimpan kunci unik di idempotency_key. Beberapa jalur SQL
-- juga membaca kolom client_ref. Tabel transactions dari skema awal tidak
-- punya kolom itu, sehingga Postgres menolak pembayaran dengan 42703.
-- Migrasi ini menambahkan kolom tersebut, menyalin kunci yang sudah ada,
-- dan menamai ulang variabel PL/pgSQL agar tidak bentrok dengan kolom baru.
-- Aman dijalankan dua kali.

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS client_ref text;

DO $tables$
BEGIN
  IF to_regclass('public.payment_simulations') IS NOT NULL THEN
    ALTER TABLE public.payment_simulations ADD COLUMN IF NOT EXISTS client_ref text;
  END IF;
END
$tables$;

UPDATE public.transactions
SET client_ref = btrim(idempotency_key)
WHERE (client_ref IS NULL OR btrim(client_ref) = '')
  AND idempotency_key IS NOT NULL
  AND btrim(idempotency_key) <> '';

CREATE INDEX IF NOT EXISTS idx_transactions_client_ref
  ON public.transactions (user_id, client_ref);

DO $unique_ref$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.transactions
    WHERE client_ref IS NOT NULL AND btrim(client_ref) <> ''
    GROUP BY user_id, client_ref
    HAVING count(*) > 1
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'transactions_user_client_ref_uidx'
  ) THEN
    CREATE UNIQUE INDEX transactions_user_client_ref_uidx
      ON public.transactions (user_id, client_ref)
      WHERE client_ref IS NOT NULL AND btrim(client_ref) <> '';
  END IF;
END
$unique_ref$;

CREATE OR REPLACE FUNCTION public.sync_transaction_client_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.client_ref, '')), '') IS NULL THEN
    NEW.client_ref := NULLIF(btrim(COALESCE(NEW.idempotency_key, '')), '');
  END IF;
  IF NULLIF(btrim(COALESCE(NEW.idempotency_key, '')), '') IS NULL THEN
    NEW.idempotency_key := NULLIF(btrim(COALESCE(NEW.client_ref, '')), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_sync_client_ref ON public.transactions;
CREATE TRIGGER transactions_sync_client_ref
  BEFORE INSERT OR UPDATE OF client_ref, idempotency_key ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_transaction_client_ref();

REVOKE ALL ON FUNCTION public.sync_transaction_client_ref() FROM PUBLIC, anon, authenticated;

DO $fn$
DECLARE
  src text;
BEGIN
  BEGIN
    src := replace(pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure), chr(13), '');
  EXCEPTION
    WHEN undefined_function THEN
      RAISE NOTICE 'ledger_api belum terpasang. Kolom client_ref tetap ditambahkan.';
      RETURN;
  END;

  IF position('pay_ref text;' IN src) = 0 AND position('client_ref text;' IN src) > 0 THEN
    src := replace(src, 'client_ref', 'pay_ref');
    src := regexp_replace(src, 'loket_id,\s*pay_ref,', 'loket_id, client_ref,', 'g');
    src := regexp_replace(src, '\(loket_id,\s*pay_ref\)', '(loket_id, client_ref)', 'g');
    src := replace(src, 'simulation.pay_ref', 'simulation.client_ref');
    src := replace(src, 'AND pay_ref = pay_ref', 'AND client_ref = pay_ref');
    IF position('(idempotency_key = pay_ref OR client_ref = pay_ref)' IN src) = 0 THEN
      src := replace(src, 'idempotency_key = pay_ref', '(idempotency_key = pay_ref OR client_ref = pay_ref)');
    END IF;
    IF position('pay_ref text;' IN src) = 0 OR position('pay_ref = pay_ref' IN src) > 0 THEN
      RAISE EXCEPTION 'Fungsi ledger_api tidak dapat dipisahkan dari kolom client_ref dengan aman.';
    END IF;
    EXECUTE src;
  END IF;

  RAISE NOTICE 'Kolom client_ref transaksi siap dipakai.';
END
$fn$;
