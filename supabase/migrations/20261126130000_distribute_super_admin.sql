-- Distribusi saldo langsung hanya boleh dijalankan Super Admin.
-- Persetujuan deposit tetap memindahkan Saldo Utama ke pemohon.
-- Aman dijalankan dua kali.

DO $fix$
DECLARE
  src text;
BEGIN
  src := pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure);
  src := replace(
    src,
    'IF role <> ''mitra'' THEN
      RETURN jsonb_build_object(''error'', ''Hanya Mitra yang dapat mendistribusikan saldo ke loketnya.'', ''status'', 403);
    END IF;',
    'IF role <> ''super_admin'' THEN
      RETURN jsonb_build_object(''error'', ''Hanya Super Admin yang dapat mendistribusikan saldo ke Mitra, Sub Mitra, dan Loket.'', ''status'', 403);
    END IF;'
  );
  EXECUTE src;
END
$fix$;
