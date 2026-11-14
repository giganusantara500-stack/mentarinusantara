/*
# Izinkan pembacaan profil sesuai jaringan dan tambah ringkasan Mitra

## Latar belakang
Tabel profiles hanya memiliki kebijakan SELECT untuk baris milik sendiri. Akibatnya
Super Admin dan Mitra tidak dapat membaca daftar Mitra, Sub Mitra, atau Loket di
jaringan mereka, sehingga daftar Manajemen tetap kosong.

## Perubahan
1. Kebijakan SELECT tambahan pada profiles:
   - Super Admin dapat membaca seluruh profil.
   - Pengguna dapat membaca profil di bawah jaringannya (descendant_ids).
   Kebijakan lama (baris sendiri) tetap berlaku.
2. get_network_summary untuk Mitra dan Sub Mitra menambah jumlah Sub Mitra (sub_mitra_count)
   dan jumlah Loket (loket_count) di bawah jaringannya.

## Keamanan
- Tidak ada kebijakan INSERT, UPDATE, atau DELETE baru pada profiles.
- Role, parent_id, dan status tetap tidak dapat diubah klien.
- Tidak ada data yang diubah atau dihapus.
*/

DROP POLICY IF EXISTS "profiles_select_super_admin" ON public.profiles;
CREATE POLICY "profiles_select_super_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "profiles_select_network" ON public.profiles;
CREATE POLICY "profiles_select_network" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = ANY(public.descendant_ids(auth.uid())));

CREATE OR REPLACE FUNCTION public.get_network_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
my_role text;
my_id uuid := auth.uid();
desc_ids uuid[];
BEGIN
SELECT role INTO my_role FROM public.profiles WHERE id = my_id;
IF NOT FOUND THEN RETURN jsonb_build_object('error','no_profile'); END IF;

IF my_role = 'super_admin' THEN
RETURN jsonb_build_object(
'role', my_role,
'total_mitra', (SELECT count(*) FROM public.profiles WHERE role='mitra'),
'total_submitra', (SELECT count(*) FROM public.profiles WHERE role='submitra'),
'total_loket', (SELECT count(*) FROM public.profiles WHERE role='loket'),
'active_users', (SELECT count(*) FROM public.profiles WHERE status='active' AND role != 'super_admin'),
'total_balance', COALESCE((SELECT sum(balance) FROM public.wallets), 0),
'total_tx', (SELECT count(*) FROM public.transactions),
'success_tx', (SELECT count(*) FROM public.transactions WHERE status='success'),
'tx_volume', COALESCE((SELECT sum(amount) FROM public.transactions WHERE status='success'), 0)
);
END IF;

desc_ids := COALESCE(public.descendant_ids(my_id), ARRAY[]::uuid[]);
RETURN jsonb_build_object(
'role', my_role,
'descendants', cardinality(desc_ids),
'direct_children', (SELECT count(*) FROM public.profiles WHERE parent_id = my_id),
'sub_mitra_count', (SELECT count(*) FROM public.profiles WHERE role='submitra' AND id = ANY(desc_ids)),
'loket_count', (SELECT count(*) FROM public.profiles WHERE role='loket' AND id = ANY(desc_ids)),
'total_balance', COALESCE((SELECT sum(balance) FROM public.wallets WHERE user_id = ANY(desc_ids) OR user_id = my_id), 0),
'total_tx', (SELECT count(*) FROM public.transactions WHERE user_id = ANY(desc_ids) OR user_id = my_id),
'success_tx', (SELECT count(*) FROM public.transactions WHERE status='success' AND (user_id = ANY(desc_ids) OR user_id = my_id)),
'tx_volume', COALESCE((SELECT sum(amount) FROM public.transactions WHERE status='success' AND (user_id = ANY(desc_ids) OR user_id = my_id)), 0)
);
END;
$function$;
