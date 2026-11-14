-- Aktifkan kembali penolakan top-up dompet di luar Super Admin.
-- Fungsi ini SECURITY DEFINER dan mengubah saldo, jadi pemeriksaan peran wajib jalan.

CREATE OR REPLACE FUNCTION public.admin_topup_wallet(
  p_target_uid uuid,
  p_amount bigint,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w public.wallets%ROWTYPE;
  new_balance bigint;
  ledger_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Jumlah harus positif';
  END IF;
  IF p_amount > 100000000000 THEN
    RAISE EXCEPTION 'Jumlah melebihi batas';
  END IF;

  SELECT * INTO w FROM public.wallets WHERE user_id = p_target_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dompet tidak ditemukan';
  END IF;
  IF w.status = 'frozen' THEN
    RAISE EXCEPTION 'Dompet dibekukan';
  END IF;

  new_balance := w.balance + p_amount;

  INSERT INTO public.wallet_ledger (wallet_id, user_id, entry_type, amount, balance_after, reference_type, description, created_by)
  VALUES (w.id, p_target_uid, 'credit', p_amount, new_balance, 'topup', p_description, auth.uid())
  RETURNING id INTO ledger_id;

  UPDATE public.wallets SET balance = new_balance, last_ledger_id = ledger_id
  WHERE id = w.id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'wallet_topup', 'wallet', p_target_uid,
    jsonb_build_object('amount', p_amount, 'balance_after', new_balance, 'description', p_description));

  RETURN jsonb_build_object('success', true, 'new_balance', new_balance, 'ledger_id', ledger_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_topup_wallet(uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_topup_wallet(uuid, bigint, text) TO authenticated;
