-- Persetujuan deposit memindahkan nominal transfer, termasuk kode unik.
-- Transfer Rp50.886 dengan kode 886 masuk utuh ke saldo pemohon.
-- Saldo Utama berkurang dengan angka yang sama, jadi jumlah Saldo Utama + dompet tidak berubah.
-- Tiket yang sudah disetujui hanya ditambah selisih kodenya, satu kali.
-- Aman dijalankan dua kali.

CREATE OR REPLACE FUNCTION public.ledger_apply_deposit_credit(p_actor uuid, p_ticket uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ticket public.deposit_tickets%ROWTYPE;
  base_value bigint;
  code_value bigint;
  transfer_value bigint;
  credit_amount bigint;
  booked bigint;
  unique_booked bigint;
  gap bigint;
  balance bigint;
  pool bigint;
  pusat_key text;
  loket_key text;
  note_pusat text;
  note_loket text;
  failure text;
BEGIN
  SELECT * INTO ticket FROM public.deposit_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Tiket deposit tidak ditemukan.', 'status', 404);
  END IF;
  IF ticket.route <> 'pusat' THEN
    RETURN jsonb_build_object('error', 'Anda tidak dapat memutuskan tiket deposit ini.', 'status', 403);
  END IF;
  IF ticket.status NOT IN ('pending', 'approved') THEN
    RETURN jsonb_build_object('error', 'Hanya setoran menunggu yang dapat disetujui.', 'status', 409);
  END IF;
  IF ticket.status = 'pending' AND ticket.expires_at IS NOT NULL AND ticket.expires_at <= now() THEN
    RETURN jsonb_build_object('error', 'Waktu tiket sudah lewat. Tiket ini tidak menambah saldo.', 'status', 409);
  END IF;

  base_value := COALESCE(NULLIF(ticket.base_amount, 0), ticket.amount, 0);
  code_value := CASE
    WHEN COALESCE(ticket.unique_code, '') ~ '^[0-9]{1,3}$' THEN ticket.unique_code::bigint
    ELSE 0
  END;
  transfer_value := COALESCE(ticket.transfer_amount, 0);
  IF transfer_value >= base_value + code_value AND base_value + code_value > 0 THEN
    credit_amount := transfer_value;
  ELSIF code_value > 0 THEN
    credit_amount := base_value + code_value;
  ELSE
    credit_amount := GREATEST(transfer_value, base_value);
  END IF;
  IF credit_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Nominal transfer tidak valid.', 'status', 400);
  END IF;

  SELECT amount INTO booked
  FROM public.fund_entries
  WHERE idempotency_key = ticket.id::text || ':approve:applicant';
  booked := COALESCE(booked, 0);
  SELECT amount INTO unique_booked
  FROM public.fund_entries
  WHERE idempotency_key = ticket.id::text || ':approve:unique';
  booked := booked + COALESCE(unique_booked, 0);
  gap := credit_amount - booked;

  IF ticket.status = 'approved' AND (gap <= 0 OR gap > 999) THEN
    gap := 0;
  END IF;
  IF gap < 0 THEN
    gap := 0;
  END IF;

  IF gap > 0 THEN
    IF booked = 0 THEN
      pusat_key := ticket.id::text || ':approve:pusat';
      loket_key := ticket.id::text || ':approve:applicant';
      note_pusat := 'Saldo Utama berpindah ke ' || ticket.applicant_name || ' termasuk kode unik ' || COALESCE(ticket.unique_code, '');
      note_loket := 'Saldo masuk termasuk kode unik ' || COALESCE(ticket.unique_code, '');
    ELSE
      pusat_key := ticket.id::text || ':approve:unique:pusat';
      loket_key := ticket.id::text || ':approve:unique';
      note_pusat := 'Kode unik ' || COALESCE(ticket.unique_code, '') || ' ikut keluar dari Saldo Utama ke ' || ticket.applicant_name;
      note_loket := 'Kode unik ' || COALESCE(ticket.unique_code, '') || ' masuk ke saldo';
    END IF;
    BEGIN
      pool := public.ledger_move('__pusat__', -gap, p_actor, ticket.id, ticket.applicant_id::text, 'pusat', NULL, note_pusat, pusat_key);
      balance := public.ledger_move(ticket.applicant_id::text, gap, p_actor, ticket.id, '__pusat__', 'pusat', NULL, note_loket, loket_key);
    EXCEPTION
      WHEN OTHERS THEN
        failure := SQLERRM;
        IF failure LIKE 'SALDO:%' THEN
          failure := substr(failure, 7);
        END IF;
        RETURN jsonb_build_object('error', failure, 'status', 409);
    END;
  END IF;

  SELECT COALESCE(SUM(fund_entries.amount), 0) INTO booked
  FROM public.fund_entries
  WHERE fund_entries.idempotency_key IN (
    ticket.id::text || ':approve:applicant',
    ticket.id::text || ':approve:unique'
  );
  SELECT wallets.balance INTO balance FROM public.wallets WHERE wallets.user_id = ticket.applicant_id;

  IF booked <= 0 THEN
    RETURN jsonb_build_object('error', 'Nominal transfer tidak masuk ke saldo.', 'status', 409);
  END IF;

  IF ticket.status = 'pending' THEN
    UPDATE public.deposit_tickets
    SET status = 'approved',
        amount = booked,
        funded_by = '__pusat__',
        decided_by = p_actor,
        decided_at = now()
    WHERE id = ticket.id
    RETURNING * INTO ticket;
  ELSIF ticket.amount IS DISTINCT FROM booked THEN
    UPDATE public.deposit_tickets
    SET amount = booked
    WHERE id = ticket.id
    RETURNING * INTO ticket;
  END IF;

  SELECT platform_accounts.balance INTO pool FROM public.platform_accounts WHERE platform_accounts.id = '__pusat__';
  RETURN jsonb_build_object(
    'status', 200,
    'ticket', public.ledger_ticket_json(ticket),
    'balance', COALESCE(balance, 0),
    'poolBalance', COALESCE(pool, 0),
    'funderId', COALESCE(ticket.funded_by, '__pusat__')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_approve_deposit(p_actor uuid, p_ticket uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role text;
BEGIN
  role := public.ledger_role(p_actor);
  IF role <> 'super_admin' THEN
    RETURN jsonb_build_object('error', 'Aksi ini tidak diizinkan.', 'status', 403);
  END IF;
  RETURN public.ledger_apply_deposit_credit(p_actor, p_ticket);
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_apply_deposit_credit(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_approve_deposit(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_apply_deposit_credit(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_approve_deposit(uuid, uuid) TO service_role;

DO $redirect$
DECLARE
  src text;
  marker text := 'IF action = ''approve'' THEN';
  hits int;
BEGIN
  src := replace(pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure), chr(13), '');
  IF position('RETURN public.ledger_approve_deposit(p_actor, ticket.id)' in src) > 0 THEN
    RAISE NOTICE 'ledger_api sudah mengalihkan persetujuan ke nominal transfer.';
  ELSE
    hits := (length(src) - length(replace(src, marker, ''))) / length(marker);
    IF hits = 1 THEN
      src := replace(src, marker, marker || chr(10) || '      RETURN public.ledger_approve_deposit(p_actor, ticket.id);');
      EXECUTE src;
      RAISE NOTICE 'Persetujuan lewat ledger_api sekarang memindahkan nominal transfer termasuk kode unik.';
    ELSE
      RAISE WARNING 'Pengalihan ledger_api dilewati (% kemunculan). API tetap memakai ledger_approve_deposit.', hits;
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Pengalihan ledger_api dilewati: %. API tetap memakai ledger_approve_deposit.', SQLERRM;
END
$redirect$;

DO $own$
DECLARE
  src text;
  old_call text := 'public.ledger_api(''decide_ticket'', actor, jsonb_build_object(''id'', p_payload->>''id'', ''action'', p_payload->>''decision''))';
  new_call text := 'CASE WHEN COALESCE(p_payload->>''decision'', '''') = ''approve'' THEN public.ledger_approve_deposit(actor, (p_payload->>''id'')::uuid) ELSE public.ledger_api(''decide_ticket'', actor, jsonb_build_object(''id'', p_payload->>''id'', ''action'', p_payload->>''decision'')) END';
BEGIN
  src := replace(pg_get_functiondef('public.own_deposit_request(text,jsonb)'::regprocedure), chr(13), '');
  IF position('ledger_approve_deposit(actor' in src) > 0 THEN
    RAISE NOTICE 'Permintaan deposit sendiri sudah memakai nominal transfer.';
  ELSIF position(old_call in src) = 0 THEN
    RAISE WARNING 'own_deposit_request tidak dialihkan. API tetap memakai ledger_approve_deposit.';
  ELSE
    src := replace(src, old_call, new_call);
    EXECUTE src;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'own_deposit_request tidak dialihkan: %. API tetap memakai ledger_approve_deposit.', SQLERRM;
END
$own$;

DO $backfill$
DECLARE
  rec record;
  actor uuid;
  result jsonb;
BEGIN
  FOR rec IN
    SELECT id, decided_by
    FROM public.deposit_tickets
    WHERE status = 'approved' AND route = 'pusat' AND funded_by = '__pusat__'
  LOOP
    BEGIN
      actor := rec.decided_by;
      IF actor IS NULL THEN
        SELECT e.actor_id INTO actor
        FROM public.fund_entries e
        WHERE e.idempotency_key = rec.id::text || ':approve:applicant'
        LIMIT 1;
      END IF;
      IF actor IS NULL THEN
        RAISE WARNING 'Tiket % tidak punya pelaku persetujuan, kode unik belum dikoreksi.', rec.id;
        CONTINUE;
      END IF;
      result := public.ledger_apply_deposit_credit(actor, rec.id);
      IF result ? 'error' THEN
        RAISE WARNING 'Tiket %: %', rec.id, result->>'error';
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'Tiket % gagal dikoreksi: %', rec.id, SQLERRM;
    END;
  END LOOP;
END
$backfill$;

NOTIFY pgrst, 'reload schema';
