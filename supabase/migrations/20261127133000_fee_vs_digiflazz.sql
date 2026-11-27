-- Fee internal Mentari dicatat di akun __fee__, terpisah dari biaya DigiFlazz.
-- Loket tetap dipotong harga jual penuh. Selisihnya masuk fee internal dan tidak
-- mengurangi saldo DigiFlazz. Refund mengembalikan fee yang sama.
-- Pencocokan refund dan pembayaran memakai penanda :refund dan :debit, karena
-- spasi pada fungsi yang sudah terpasang tidak selalu sama dengan file asal.
-- Aman dijalankan dua kali.

INSERT INTO public.platform_accounts (id, balance)
VALUES ('__fee__', 0), ('__digiflazz__', 0)
ON CONFLICT (id) DO NOTHING;

DO $fix$
DECLARE
  src text;
  move_src text;
  changed boolean := false;
  patched text;
  found text[];
  old_move text := $old$  IF p_account = '__pusat__' THEN
    INSERT INTO public.platform_accounts (id, balance) VALUES ('__pusat__', 0) ON CONFLICT (id) DO NOTHING;
    SELECT balance INTO next_balance FROM public.platform_accounts WHERE id = '__pusat__' FOR UPDATE;
    next_balance := next_balance + p_delta;
    IF next_balance < 0 THEN RAISE EXCEPTION 'SALDO:Saldo Utama tidak cukup.'; END IF;
    UPDATE public.platform_accounts SET balance = next_balance, updated_at = now() WHERE id = '__pusat__';$old$;
  new_move text := $new$  IF p_account IN ('__pusat__', '__fee__') THEN
    INSERT INTO public.platform_accounts (id, balance) VALUES (p_account, 0) ON CONFLICT (id) DO NOTHING;
    SELECT balance INTO next_balance FROM public.platform_accounts WHERE id = p_account FOR UPDATE;
    next_balance := next_balance + p_delta;
    IF next_balance < 0 AND p_account = '__pusat__' THEN RAISE EXCEPTION 'SALDO:Saldo Utama tidak cukup.'; END IF;
    IF next_balance < 0 THEN RAISE EXCEPTION 'SALDO:Fee internal tidak cukup untuk dikembalikan.'; END IF;
    UPDATE public.platform_accounts SET balance = next_balance, updated_at = now() WHERE id = p_account;$new$;
  old_balance text := $old$    IF target = '__pusat__' THEN
      IF role <> 'super_admin' THEN RETURN jsonb_build_object('error', 'Saldo Utama hanya untuk Super Admin.', 'status', 403); END IF;
      SELECT platform_accounts.balance INTO balance FROM public.platform_accounts WHERE platform_accounts.id = '__pusat__';
      RETURN jsonb_build_object('balance', COALESCE(balance, 0), 'status', 200);
    END IF;$old$;
  new_balance text := $new$    IF target IN ('__pusat__', '__fee__') THEN
      IF role <> 'super_admin' THEN RETURN jsonb_build_object('error', 'Saldo platform hanya untuk Super Admin.', 'status', 403); END IF;
      SELECT platform_accounts.balance INTO balance FROM public.platform_accounts WHERE platform_accounts.id = target;
      RETURN jsonb_build_object('balance', COALESCE(balance, 0), 'status', 200);
    END IF;$new$;
  old_refund text := $old$      balance := public.ledger_move(p_actor::text, sale.amount, p_actor, sale.id, NULL, 'produksi', NULL, 'Pengembalian transaksi ' || sale.invoice_code, client_ref || ':refund');
      UPDATE public.transactions SET status = 'refunded', completed_at = now() WHERE id = sale.id RETURNING * INTO sale;$old$;
  new_refund text := $new$      balance := public.ledger_move(p_actor::text, sale.amount, p_actor, sale.id, NULL, 'produksi', NULL, 'Pengembalian transaksi ' || sale.invoice_code, client_ref || ':refund');
      IF COALESCE(sale.profit, 0) > 0 THEN
        PERFORM public.ledger_move('__fee__', -sale.profit, p_actor, sale.id, p_actor::text, 'produksi', 'fee', 'Pengembalian fee internal Mentari ' || sale.invoice_code, client_ref || ':fee-reverse');
      END IF;
      UPDATE public.transactions SET status = 'refunded', completed_at = now() WHERE id = sale.id RETURNING * INTO sale;$new$;
  refund_insert text := $fee$
      IF COALESCE(sale.profit, 0) > 0 THEN
        PERFORM public.ledger_move('__fee__', -sale.profit, p_actor, sale.id, p_actor::text, 'produksi', 'fee', 'Pengembalian fee internal Mentari ' || sale.invoice_code, client_ref || ':fee-reverse');
      END IF;$fee$;
  old_sale text := $old$    note := 'Pembayaran ' || (p_payload->>'product');
    balance := public.ledger_move(p_actor::text, -amount, p_actor, sale.id, NULL, 'produksi', NULL, note, client_ref || ':debit');
    UPDATE public.transactions SET status = 'success', completed_at = now() WHERE id = sale.id RETURNING * INTO sale;$old$;
  new_sale text := $new$    provider_cost := CASE
      WHEN COALESCE(p_payload->>'providerCost', '') ~ '^[0-9]+$' THEN (p_payload->>'providerCost')::bigint
      ELSE 0
    END;
    IF provider_cost <= 0 OR provider_cost > amount THEN
      provider_cost := GREATEST(0, amount
        - CASE WHEN COALESCE(p_payload->>'adminFee', '') ~ '^[0-9]+$' THEN (p_payload->>'adminFee')::bigint ELSE 0 END
        - CASE WHEN COALESCE(p_payload->>'collfee', '') ~ '^[0-9]+$' THEN (p_payload->>'collfee')::bigint ELSE 0 END);
    END IF;
    IF provider_cost > amount THEN provider_cost := amount; END IF;
    internal_fee := GREATEST(0, amount - provider_cost);
    note := 'Pembayaran ' || COALESCE(p_payload->>'product', '')
      || '. Biaya DigiFlazz ' || provider_cost::text
      || '. Fee internal Mentari ' || internal_fee::text || '.';
    balance := public.ledger_move(p_actor::text, -amount, p_actor, sale.id, NULL, 'produksi', NULL, note, client_ref || ':debit');
    IF internal_fee > 0 THEN
      PERFORM public.ledger_move('__fee__', internal_fee, p_actor, sale.id, p_actor::text, 'produksi', 'fee', 'Fee internal Mentari. Tidak mengurangi saldo DigiFlazz.', client_ref || ':fee');
    END IF;
    UPDATE public.transactions
      SET status = 'success', completed_at = now(), cost_price = provider_cost, sell_price = amount, profit = internal_fee
      WHERE id = sale.id RETURNING * INTO sale;$new$;
  sale_pat text := $pat$note[[:space:]]*:=[[:space:]]*'Pembayaran '[^;]*;[[:space:]]*balance[[:space:]]*:=[[:space:]]*public\.ledger_move\([^;]*':debit'[[:space:]]*\)[[:space:]]*;[[:space:]]*UPDATE[[:space:]]+public\.transactions[[:space:]]+SET[[:space:]]+status[[:space:]]*=[[:space:]]*'success'[^;]*;$pat$;
  sale_loose text := $pat$balance[[:space:]]*:=[[:space:]]*public\.ledger_move\([^;]*':debit'[[:space:]]*\)[[:space:]]*;[[:space:]]*UPDATE[[:space:]]+public\.transactions[[:space:]]+SET[[:space:]]+status[[:space:]]*=[[:space:]]*'success'[^;]*;$pat$;
BEGIN
  old_move := replace(old_move, chr(13), '');
  new_move := replace(new_move, chr(13), '');
  old_balance := replace(old_balance, chr(13), '');
  new_balance := replace(new_balance, chr(13), '');
  old_refund := replace(old_refund, chr(13), '');
  new_refund := replace(new_refund, chr(13), '');
  old_sale := replace(old_sale, chr(13), '');
  new_sale := replace(new_sale, chr(13), '');
  move_src := replace(pg_get_functiondef('public.ledger_move(text,bigint,uuid,uuid,text,text,text,text,text)'::regprocedure), chr(13), '');
  IF position('p_account IN (''__pusat__'', ''__fee__'')' IN move_src) = 0 THEN
    IF position(old_move IN move_src) = 0 THEN
      RAISE EXCEPTION 'Blok akun platform pada ledger_move tidak dikenali.';
    END IF;
    EXECUTE replace(move_src, old_move, new_move);
  END IF;

  src := replace(pg_get_functiondef('public.ledger_api(text,uuid,jsonb)'::regprocedure), chr(13), '');
  IF position('provider_cost bigint;' IN src) = 0 THEN
    IF position('note text;' IN src) = 0 THEN
      RAISE EXCEPTION 'Deklarasi ledger_api tidak dikenali.';
    END IF;
    src := regexp_replace(src, 'note text;', 'note text;' || chr(10) || '  provider_cost bigint;' || chr(10) || '  internal_fee bigint;');
    changed := true;
  END IF;
  IF position('target IN (''__pusat__'', ''__fee__'')' IN src) = 0 THEN
    IF position(old_balance IN src) = 0 THEN
      RAISE EXCEPTION 'Blok saldo platform pada ledger_api tidak dikenali.';
    END IF;
    src := replace(src, old_balance, new_balance);
    changed := true;
  END IF;
  IF position(':fee-reverse' IN src) = 0 THEN
    IF position(old_refund IN src) > 0 THEN
      src := replace(src, old_refund, new_refund);
    ELSE
      found := regexp_match(src, $refund$':refund'[[:space:]]*\)[[:space:]]*;$refund$);
      IF found IS NULL THEN
        RAISE EXCEPTION 'Blok pengembalian transaksi pada ledger_api tidak dikenali. Cuplikan: %',
          substr(src, GREATEST(position('refund' IN lower(src)) - 180, 1), 520);
      END IF;
      src := replace(src, found[1], found[1] || refund_insert);
    END IF;
    changed := true;
  END IF;
  IF position('Fee internal Mentari' IN src) = 0 THEN
    IF position(old_sale IN src) > 0 THEN
      src := replace(src, old_sale, new_sale);
    ELSE
      found := regexp_match(src, sale_pat);
      IF found IS NULL THEN
        found := regexp_match(src, sale_loose);
      END IF;
      IF found IS NULL THEN
        RAISE EXCEPTION 'Blok pembayaran transaksi pada ledger_api tidak dikenali. Cuplikan: %',
          substr(src, GREATEST(position(':debit' IN src) - 180, 1), 520);
      END IF;
      src := replace(src, found[1], new_sale);
    END IF;
    changed := true;
  END IF;
  IF changed THEN
    patched := src;
    EXECUTE patched;
  END IF;
  RAISE NOTICE 'Pencatatan fee internal Mentari sudah terpasang.';
END
$fix$;
