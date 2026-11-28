-- Transaksi yang sempat tercatat gagal tidak boleh mengunci status itu
-- bila DigiFlazz kemudian menyatakan Sukses. Potongan saldo tetap idempotent
-- lewat kunci :debit, jadi sinkronisasi ulang tidak memotong dua kali.
-- Aman dijalankan dua kali.

DO $reopen$
DECLARE
  src text;
  patched text;
BEGIN
  BEGIN
    src := replace(pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure), chr(13), '');
  EXCEPTION
    WHEN undefined_function THEN
      RAISE NOTICE 'ledger_api belum terpasang. Lewati pembukaan status gagal.';
      RETURN;
  END;

  IF position('sale.status = ''failed'' AND outcome <> ''success''' IN src) > 0 THEN
    RAISE NOTICE 'ledger_api sudah membuka transaksi gagal yang ternyata sukses.';
    RETURN;
  END IF;

  patched := regexp_replace(
    src,
    'sale\.status IN \(''success'', ''failed'', ''refunded''\)',
    '(sale.status IN (''success'', ''refunded'') OR (sale.status = ''failed'' AND outcome <> ''success''))'
  );

  IF patched = src THEN
    RAISE EXCEPTION 'Blok status final pada ledger_api tidak dikenali. Transaksi gagal yang ternyata sukses belum bisa dipotong saldonya.';
  END IF;

  EXECUTE patched;
  RAISE NOTICE 'Transaksi gagal yang ternyata sukses di DigiFlazz sekarang memotong saldo loket.';
END
$reopen$;
