-- Tiket deposit dari browser saat /api/deposits tidak tersedia.
-- Pemanggil hanya bisa bertindak sebagai auth.uid(). Aman dijalankan ulang.

CREATE OR REPLACE FUNCTION public.own_deposit_request(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  role text;
  amount bigint;
  fresh_code text;
  code_try integer;
  ticket public.deposit_tickets%ROWTYPE;
  profile jsonb;
  parent jsonb;
  actor_name text;
  actor_code text;
  parent_name text;
  parent_role text;
BEGIN
  IF actor IS NULL THEN
    RETURN jsonb_build_object('error', 'Sesi tidak valid. Silakan login ulang.', 'status', 401);
  END IF;

  role := public.ledger_role(actor);
  IF role = '' THEN
    RETURN jsonb_build_object('error', 'Sesi tidak valid atau akun tidak aktif.', 'status', 401);
  END IF;

  IF p_action = 'list' THEN
    RETURN jsonb_build_object(
      'status', 200,
      'tickets', COALESCE((public.ledger_api('tickets', actor, '{}'::jsonb))->'tickets', '[]'::jsonb),
      'mutations', COALESCE((public.ledger_api('mutations', actor, '{}'::jsonb))->'mutations', '[]'::jsonb),
      'balance', COALESCE(((public.ledger_api('balance', actor, jsonb_build_object('userId', actor)))->>'balance')::numeric, 0)
    );
  END IF;

  IF p_action = 'create' THEN
    IF role NOT IN ('loket', 'mitra', 'submitra') THEN
      RETURN jsonb_build_object('error', 'Hanya Mitra, Sub Mitra, atau Loket yang dapat membuat tiket deposit.', 'status', 403);
    END IF;
    IF COALESCE(p_payload->>'bank', 'BRI') <> 'BRI' THEN
      RETURN jsonb_build_object('error', 'Rekening tujuan yang dipilih tidak dikenali.', 'status', 400);
    END IF;
    IF COALESCE(p_payload->>'route', 'pusat') = 'jaringan' THEN
      RETURN jsonb_build_object('error', 'Setoran deposit hanya ke rekening pusat.', 'status', 400);
    END IF;
    amount := round(COALESCE((p_payload->>'amount')::numeric, 0))::bigint;
    IF amount < 10000 THEN
      RETURN jsonb_build_object('error', 'Nominal deposit minimal Rp10.000.', 'status', 400);
    END IF;

    SELECT to_jsonb(p) INTO profile FROM public.profiles p WHERE p.id = actor;
    actor_name := COALESCE(NULLIF(profile->>'full_name', ''), NULLIF(profile->>'username', ''), 'Pemohon');
    actor_code := NULLIF(profile->>'loket_code', '');
    IF NULLIF(profile->>'parent_id', '') IS NOT NULL THEN
      SELECT to_jsonb(parent_profile) INTO parent
      FROM public.profiles AS parent_profile
      WHERE parent_profile.id = (profile->>'parent_id')::uuid;
      parent_name := COALESCE(NULLIF(parent->>'full_name', ''), NULLIF(parent->>'username', ''), 'Upline');
      parent_role := public.ledger_role((profile->>'parent_id')::uuid);
    END IF;
    IF parent_name IS NULL THEN
      parent_name := 'Pusat';
      parent_role := 'super_admin';
    END IF;

    UPDATE public.deposit_tickets
    SET status = 'cancelled', decided_at = now()
    WHERE applicant_id = actor AND status = 'pending' AND expires_at IS NOT NULL AND expires_at <= now();

    IF EXISTS (
      SELECT 1 FROM public.deposit_tickets AS open_ticket
      WHERE open_ticket.applicant_id = actor
        AND open_ticket.route = 'pusat'
        AND open_ticket.status = 'pending'
    ) THEN
      RETURN jsonb_build_object('error', 'Masih ada tiket pada jalur yang sama yang menunggu keputusan.', 'status', 409);
    END IF;

    FOR code_try IN 1..30 LOOP
      fresh_code := lpad(((floor(random() * 900) + 100)::int)::text, 3, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.deposit_tickets
        WHERE status = 'pending' AND unique_code = fresh_code AND (expires_at IS NULL OR expires_at > now())
      );
    END LOOP;

    INSERT INTO public.deposit_tickets (
      applicant_id, applicant_name, applicant_code, applicant_role, amount, base_amount, unique_code,
      transfer_amount, bank, account_number, account_holder, transfer_at, expires_at, status, route,
      approver_id, upline_name, upline_role
    ) VALUES (
      actor,
      actor_name,
      actor_code,
      role,
      amount,
      amount,
      fresh_code,
      amount + fresh_code::bigint,
      'BRI',
      '686601009504534',
      'Aris Purwanto',
      now(),
      now() + interval '6 hours',
      'pending',
      'pusat',
      NULL,
      NULLIF(parent_name, ''),
      NULLIF(COALESCE(NULLIF(parent_role, ''), 'super_admin'), '')
    ) RETURNING * INTO ticket;

    RETURN jsonb_build_object('status', 200, 'ticket', public.ledger_ticket_json(ticket));
  END IF;

  IF COALESCE(p_payload->>'id', '') = '' THEN
    RETURN jsonb_build_object('error', 'Tiket yang dipilih tidak ditemukan.', 'status', 400);
  END IF;

  IF p_action = 'cancel' THEN
    RETURN public.ledger_api('cancel_ticket', actor, jsonb_build_object('id', p_payload->>'id'));
  END IF;
  IF p_action = 'claim' THEN
    RETURN public.ledger_api('claim_ticket', actor, jsonb_build_object('id', p_payload->>'id'));
  END IF;
  IF p_action = 'decide' THEN
    RETURN public.ledger_api('decide_ticket', actor, jsonb_build_object('id', p_payload->>'id', 'action', p_payload->>'decision'));
  END IF;

  RETURN jsonb_build_object('error', 'Aksi tiket deposit tidak dikenali.', 'status', 404);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'Masih ada tiket deposit yang menunggu keputusan.', 'status', 409);
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM, 'status', 500);
END;
$$;

REVOKE ALL ON FUNCTION public.own_deposit_request(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.own_deposit_request(text, jsonb) TO authenticated;
