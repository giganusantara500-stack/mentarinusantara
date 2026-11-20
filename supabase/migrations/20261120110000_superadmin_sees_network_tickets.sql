/*
  Super Admin melihat seluruh tiket deposit, termasuk jalur jaringan
  dari Mitra, Sub Mitra, dan Loket.

  Mitra, Sub Mitra, dan Loket tetap dibatasi ke tiket sendiri atau
  applicant yang ada di jaringan mereka. Keputusan saldo pusat tetap
  hanya untuk tiket route pusat.
*/

DO $fix$
DECLARE
  src text;
BEGIN
  src := pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure);
  IF position('WHEN role = ''super_admin'' THEN t.route = ''pusat''' in src) = 0 THEN
    RAISE NOTICE 'Daftar tiket Super Admin sudah mencakup semua jalur.';
    RETURN;
  END IF;
  src := replace(
    src,
    'WHEN role = ''super_admin'' THEN t.route = ''pusat''',
    'WHEN role = ''super_admin'' THEN true'
  );
  EXECUTE src;
  RAISE NOTICE 'Tiket jalur jaringan sekarang tampil untuk Super Admin.';
END
$fix$;
