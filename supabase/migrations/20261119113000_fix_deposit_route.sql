-- Perbaikan singkat: pembuatan tiket ditolak karena nama kolom route bentrok.
-- Tempel seluruh isi file ini di SQL Editor, lalu klik Run. Aman dijalankan dua kali.

DO $fix$
DECLARE
  src text;
BEGIN
  src := pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure);
  IF position('deposit_tickets.route' in src) > 0 OR position('open_ticket.route' in src) > 0 THEN
    RAISE NOTICE 'Perbaikan sudah terpasang.';
    RETURN;
  END IF;
  IF position('AND route = ''pusat''' in src) = 0 THEN
    RAISE EXCEPTION 'Pola lama tidak ditemukan. Perbaikan belum dipasang.';
  END IF;
  src := replace(src, 'AND route = ''pusat''', 'AND deposit_tickets.route = ''pusat''');
  EXECUTE src;
  RAISE NOTICE 'Perbaikan berhasil dipasang.';
END
$fix$;
