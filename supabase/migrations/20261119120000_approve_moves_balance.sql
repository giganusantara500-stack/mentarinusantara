-- Saldo Utama bisa dibaca, lalu saat tiket disetujui saldo itu berkurang dan pindah ke pemohon.
-- Tempel seluruh isi file ini di SQL Editor, lalu klik Run. Aman dijalankan dua kali.

DO $fix$
DECLARE
  src text;
BEGIN
  src := pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure);
  src := replace(src, 'SELECT balance INTO balance FROM public.platform_accounts WHERE id = ''__pusat__''', 'SELECT platform_accounts.balance INTO balance FROM public.platform_accounts WHERE platform_accounts.id = ''__pusat__''');
  src := replace(src, 'SELECT id, balance FROM public.platform_accounts WHERE role = ''super_admin''', 'SELECT platform_accounts.id, platform_accounts.balance FROM public.platform_accounts WHERE role = ''super_admin''');
  src := replace(src, 'SELECT balance INTO balance FROM public.wallets WHERE user_id = ticket.applicant_id', 'SELECT wallets.balance INTO balance FROM public.wallets WHERE wallets.user_id = ticket.applicant_id');
  src := replace(src, 'SELECT balance INTO pool FROM public.platform_accounts WHERE id = ''__pusat__''', 'SELECT platform_accounts.balance INTO pool FROM public.platform_accounts WHERE platform_accounts.id = ''__pusat__''');
  src := replace(src, 'jsonb_object_agg(account_id, balance)', 'jsonb_object_agg(rows.account_id, rows.balance)');
  src := replace(src, 'PERFORM public.ledger_move(''__pusat__'', ticket.amount, p_actor, ticket.id, ticket.applicant_id::text, ''pusat'', NULL, ''Uang masuk dari transfer bank'', ticket.id::text || '':approve:bank-in'');', '');
  src := replace(src, 'Alokasi saldo dari transfer bank untuk ', 'Saldo Utama berpindah ke ');
  src := replace(src, 'Deposit disetujui Super Admin', 'Saldo masuk dari Saldo Utama');
  EXECUTE src;
  RAISE NOTICE 'Perbaikan berhasil dipasang.';
END
$fix$;
