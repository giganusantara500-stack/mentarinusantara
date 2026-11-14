/*
# Super Admin dashboard data function

Menambahkan satu fungsi baca khusus Super Admin yang mengembalikan seluruh data dashboard dalam satu panggilan.

1. Fungsi baru
- `get_superadmin_dashboard(p_start, p_end, p_root, p_tz)` mengembalikan JSON berisi:
  - `summary`: jumlah transaksi (total, sukses, gagal, pending), nilai transaksi sukses, profit sukses, total deposit (top-up dompet), total saldo dompet, jumlah akun aktif.
  - `daily`: ringkasan per hari untuk rentang tanggal yang dipilih (hari tanpa transaksi tetap muncul dengan nilai 0).
  - `monthly`: ringkasan per bulan untuk 12 bulan terakhir sampai tanggal akhir.
  - `recent`: 10 transaksi terbaru dalam rentang yang dipilih.
- Filter jaringan: jika `p_root` diisi, hanya data milik mitra tersebut beserta seluruh turunannya. Jika kosong, semua jaringan.

2. Keamanan
- Fungsi hanya bisa dijalankan oleh akun Super Admin aktif; selain itu dikembalikan error 42501.
- Fungsi berjalan dengan hak pemilik karena membaca data lintas jaringan, sehingga pemeriksaan peran di awal fungsi wajib.
- EXECUTE dicabut dari PUBLIC dan anon, lalu hanya diberikan ke authenticated.

3. Catatan
- Rentang tanggal maksimal 366 hari.
- Tidak ada tabel baru dan tidak ada data yang diubah.
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
      )
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
        'user_name', COALESCE(NULLIF(p.full_name, ''), p.email)
      ) ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT t.* FROM public.transactions t
        WHERE t.created_at >= v_from AND t.created_at < v_to AND (v_scope IS NULL OR t.user_id = ANY (v_scope))
        ORDER BY t.created_at DESC
        LIMIT 10
      ) r
      LEFT JOIN public.profiles p ON p.id = r.user_id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_superadmin_dashboard(date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_superadmin_dashboard(date, date, uuid, text) TO authenticated;
