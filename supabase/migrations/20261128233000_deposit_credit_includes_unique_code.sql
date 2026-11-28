-- Persetujuan deposit memindahkan nominal transfer, termasuk angka unik.
-- Kode 433 pada transfer Rp50.433 ikut masuk ke saldo pemohon dan ke mutasi.
-- Pembatalan tetap membalik nominal yang benar-benar sudah dipindahkan.
-- Aman dijalankan dua kali.

DO $credit$
DECLARE
  src text;
  patched text;
BEGIN
  src := replace(pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure), chr(13), '');
  IF position('credit_amount := COALESCE(NULLIF(ticket.transfer_amount, 0), ticket.amount)' in src) > 0 THEN
    RAISE NOTICE 'Persetujuan deposit sudah memindahkan nominal transfer termasuk kode unik.';
    RETURN;
  END IF;
  IF position('amount bigint;' in src) = 0 THEN
    RAISE EXCEPTION 'Variabel amount pada ledger_api tidak ditemukan.';
  END IF;
  patched := replace(src, 'amount bigint;', 'amount bigint;' || chr(10) || '  credit_amount bigint;');
  patched := replace(
    patched,
    '-ticket.amount, p_actor, ticket.id, ticket.applicant_id::text, ''pusat'', NULL, ''Saldo Utama berpindah ke '' || ticket.applicant_name',
    '-credit_amount, p_actor, ticket.id, ticket.applicant_id::text, ''pusat'', NULL, ''Saldo Utama berpindah ke '' || ticket.applicant_name || '' termasuk kode unik '' || COALESCE(ticket.unique_code, '''')'
  );
  patched := replace(
    patched,
    'ticket.applicant_id::text, ticket.amount, p_actor, ticket.id, ''__pusat__'', ''pusat'', NULL, ''Saldo masuk dari Saldo Utama''',
    'ticket.applicant_id::text, credit_amount, p_actor, ticket.id, ''__pusat__'', ''pusat'', NULL, ''Saldo masuk termasuk kode unik '' || COALESCE(ticket.unique_code, '''')'
  );
  patched := replace(
    patched,
    'IF action = ''approve'' THEN',
    'IF action = ''approve'' THEN' || chr(10) || '      credit_amount := COALESCE(NULLIF(ticket.transfer_amount, 0), ticket.amount);'
  );
  patched := replace(
    patched,
    'SET status = ''approved'', funded_by = ''__pusat__'', decided_by = p_actor, decided_at = now()',
    'SET status = ''approved'', amount = credit_amount, funded_by = ''__pusat__'', decided_by = p_actor, decided_at = now()'
  );
  IF position('credit_amount := COALESCE' in patched) = 0
     OR position('Saldo masuk dari Saldo Utama' in patched) > 0
     OR position('amount = credit_amount' in patched) = 0 THEN
    RAISE EXCEPTION 'Pola persetujuan deposit tidak ditemukan. Migrasi dihentikan.';
  END IF;
  EXECUTE patched;
  RAISE NOTICE 'Persetujuan deposit sekarang memindahkan nominal transfer termasuk kode unik.';
END
$credit$;
