/*
# Super Admin dashboard: kartu hari ini, laporan akun, dan perkembangan jaringan

Memperluas fungsi get_superadmin_dashboard agar seluruh kartu dan laporan Super Admin bersumber dari database.

1. Ringkasan (summary) tambahan
- today_tx: jumlah transaksi hari ini (zona Asia/Jakarta).
- today_volume: nilai transaksi berhasil hari ini.
- today_cms: CMS hari ini, didefinisikan sebagai profit transaksi berhasil (harga jual dikurangi harga modal).
- total_mitra, total_submitra, total_loket: jumlah akun per peran dalam cakupan filter.

2. Data baru
- accounts: laporan per akun Mitra, Sub Mitra, dan Loket (transaksi, nilai berhasil, CMS, deposit, saldo) pada rentang tanggal terpilih.
- network_growth: jumlah akun baru per peran, 12 bulan terakhir.

3. Keamanan
- Tetap hanya untuk Super Admin aktif, EXECUTE hanya untuk authenticated.
- Tidak ada tabel atau data yang diubah.
*/

CREATE OR REPLACE FUNCTION public.get_superadmin_dashboard(
  p_start date,
  p_end date,
  p_root uuid DEFAULT NULL,
  p_tz text DEFAULT 'Asia/Jakarta'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_month_from timestamptz;
  v_today date := (now() AT TIME ZONE p_tz)::date;
  v_today_from timestamptz;
  v_today_to timestamptz;
  v_scope uuid[];
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_end < p_start OR p_end - p_start > 366 THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;

  v_from := p_start::timestamp AT TIME ZONE p_tz;
  v_to := (p_end + 1)::timestamp AT TIME ZONE p_tz;
  v_month_from := (date_trunc('month', p_end::timestamp) - interval '11 months') AT TIME ZONE p_tz;
  v_today_from := v_today::timestamp AT TIME ZONE p_tz;
  v_today_to := (v_today + 1)::timestamp AT TIME ZONE p_tz;

  IF p_root IS NOT NULL THEN
    v_scope := ARRAY[p_root] || COALESCE(public.descendant_ids(p_root), ARRAY[]::uuid[]);
  END IF;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'total_tx', (
        SELECT count(*) FROM public.transactions t
        WHERE t.created_at >= v_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
      ),
      'success_tx', (
        SELECT count(*) FROM public.transactions t
        WHERE t.status = 'success' AND t.created_at >= v_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
      ),
      'failed_tx', (
        SELECT count(*) FROM public.transactions t
        WHERE t.status = 'failed' AND t.created_at >= v_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
      ),
      'pending_tx', (
        SELECT count(*) FROM public.transactions t
        WHERE t.status = 'pending' AND t.created_at >= v_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
      ),
      'volume', COALESCE((
        SELECT sum(t.amount) FROM public.transactions t
        WHERE t.status = 'success' AND t.created_at >= v_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
      ), 0),
      'profit', COALESCE((
        SELECT sum(t.profit) FROM public.transactions t
        WHERE t.status = 'success' AND t.created_at >= v_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
      ), 0),
      'deposit_total', COALESCE((
        SELECT sum(l.amount) FROM public.wallet_ledger l
        WHERE l.reference_type = 'topup' AND l.entry_type = 'credit'
          AND l.created_at >= v_from AND l.created_at < v_to AND (v_scope IS NULL OR l.user_id = ANY (v_scope))
      ), 0),
      'total_balance', COALESCE((
        SELECT sum(w.balance) FROM public.wallets w WHERE v_scope IS NULL OR w.user_id = ANY (v_scope)
      ), 0),
      'active_accounts', (
        SELECT count(*) FROM public.profiles p
        WHERE p.role <> 'super_admin' AND p.status = 'active' AND (v_scope IS NULL OR p.id = ANY (v_scope))
      ),
      'total_mitra', (
        SELECT count(*) FROM public.profiles p WHERE p.role = 'mitra' AND (v_scope IS NULL OR p.id = ANY (v_scope))
      ),
      'total_submitra', (
        SELECT count(*) FROM public.profiles p WHERE p.role = 'submitra' AND (v_scope IS NULL OR p.id = ANY (v_scope))
      ),
      'total_loket', (
        SELECT count(*) FROM public.profiles p WHERE p.role = 'loket' AND (v_scope IS NULL OR p.id = ANY (v_scope))
      ),
      'today_tx', (
        SELECT count(*) FROM public.transactions t
        WHERE t.created_at >= v_today_from AND t.created_at < v_today_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
      ),
      'today_volume', COALESCE((
        SELECT sum(t.amount) FROM public.transactions t
        WHERE t.status = 'success' AND t.created_at >= v_today_from AND t.created_at < v_today_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
      ), 0),
      'today_cms', COALESCE((
        SELECT sum(t.profit) FROM public.transactions t
        WHERE t.status = 'success' AND t.created_at >= v_today_from AND t.created_at < v_today_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
      ), 0)
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', to_char(g.d, 'YYYY-MM-DD'),
        'count', COALESCE(s.cnt, 0),
        'volume', COALESCE(s.vol, 0),
        'profit', COALESCE(s.prf, 0)
      ) ORDER BY g.d), '[]'::jsonb)
      FROM generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') AS g(d)
      LEFT JOIN (
        SELECT (t.created_at AT TIME ZONE p_tz)::date AS d,
          count(*) AS cnt,
          sum(t.amount) FILTER (WHERE t.status = 'success') AS vol,
          sum(t.profit) FILTER (WHERE t.status = 'success') AS prf
        FROM public.transactions t
        WHERE t.created_at >= v_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
        GROUP BY 1
      ) s ON s.d = g.d::date
    ),
    'monthly', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'month', to_char(g.m, 'YYYY-MM'),
        'count', COALESCE(s.cnt, 0),
        'volume', COALESCE(s.vol, 0),
        'profit', COALESCE(s.prf, 0)
      ) ORDER BY g.m), '[]'::jsonb)
      FROM generate_series(
        date_trunc('month', p_end::timestamp) - interval '11 months',
        date_trunc('month', p_end::timestamp),
        interval '1 month'
      ) AS g(m)
      LEFT JOIN (
        SELECT date_trunc('month', t.created_at AT TIME ZONE p_tz) AS m,
          count(*) AS cnt,
          sum(t.amount) FILTER (WHERE t.status = 'success') AS vol,
          sum(t.profit) FILTER (WHERE t.status = 'success') AS prf
        FROM public.transactions t
        WHERE t.created_at >= v_month_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
        GROUP BY 1
      ) s ON s.m = g.m
    ),
    'network_growth', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'month', to_char(g.m, 'YYYY-MM'),
        'mitra', COALESCE(s.mitra, 0),
        'submitra', COALESCE(s.submitra, 0),
        'loket', COALESCE(s.loket, 0)
      ) ORDER BY g.m), '[]'::jsonb)
      FROM generate_series(
        date_trunc('month', p_end::timestamp) - interval '11 months',
        date_trunc('month', p_end::timestamp),
        interval '1 month'
      ) AS g(m)
      LEFT JOIN (
        SELECT date_trunc('month', p.created_at AT TIME ZONE p_tz) AS m,
          count(*) FILTER (WHERE p.role = 'mitra') AS mitra,
          count(*) FILTER (WHERE p.role = 'submitra') AS submitra,
          count(*) FILTER (WHERE p.role = 'loket') AS loket
        FROM public.profiles p
        WHERE p.role <> 'super_admin'
          AND p.created_at >= v_month_from AND p.created_at < v_to
          AND (v_scope IS NULL OR p.id = ANY (v_scope))
        GROUP BY 1
      ) s ON s.m = g.m
    ),
    'recent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'invoice', r.invoice_code,
        'product', r.product_name_snapshot,
        'customer', r.customer_number,
        'amount', r.amount,
        'profit', r.profit,
        'status', r.status,
        'created_at', r.created_at,
        'user_name', COALESCE(NULLIF(p.business_name, ''), NULLIF(p.full_name, ''), p.email)
      ) ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT t.* FROM public.transactions t
        WHERE t.created_at >= v_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
        ORDER BY t.created_at DESC
        LIMIT 10
      ) r
      LEFT JOIN public.profiles p ON p.id = r.user_id
    ),
    'accounts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'role', a.role,
        'name', a.name,
        'parent_name', a.parent_name,
        'status', a.status,
        'tx_count', a.tx_count,
        'volume', a.volume,
        'cms', a.cms,
        'deposit', a.deposit,
        'balance', a.balance
      ) ORDER BY a.volume DESC, a.name), '[]'::jsonb)
      FROM (
        SELECT p.id, p.role, p.status,
          COALESCE(NULLIF(p.business_name, ''), NULLIF(p.full_name, ''), p.email) AS name,
          (
            SELECT COALESCE(NULLIF(pp.business_name, ''), NULLIF(pp.full_name, ''), pp.email)
            FROM public.profiles pp WHERE pp.id = p.parent_id
          ) AS parent_name,
          (
            SELECT count(*) FROM public.transactions t
            WHERE t.user_id = p.id AND t.created_at >= v_from AND t.created_at < v_to
          ) AS tx_count,
          (
            SELECT COALESCE(sum(t.amount), 0) FROM public.transactions t
            WHERE t.user_id = p.id AND t.status = 'success' AND t.created_at >= v_from AND t.created_at < v_to
          ) AS volume,
          (
            SELECT COALESCE(sum(t.profit), 0) FROM public.transactions t
            WHERE t.user_id = p.id AND t.status = 'success' AND t.created_at >= v_from AND t.created_at < v_to
          ) AS cms,
          (
            SELECT COALESCE(sum(l.amount), 0) FROM public.wallet_ledger l
            WHERE l.user_id = p.id AND l.reference_type = 'topup' AND l.entry_type = 'credit'
              AND l.created_at >= v_from AND l.created_at < v_to
          ) AS deposit,
          COALESCE((SELECT w.balance FROM public.wallets w WHERE w.user_id = p.id), 0) AS balance
        FROM public.profiles p
        WHERE p.role <> 'super_admin' AND (v_scope IS NULL OR p.id = ANY (v_scope))
        ORDER BY p.created_at DESC
        LIMIT 500
      ) a
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_superadmin_dashboard(date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_superadmin_dashboard(date, date, uuid, text) TO authenticated;
