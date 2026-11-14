/*
# Tutup akses anonim ke fungsi istimewa

## Ringkasan
Beberapa fungsi berhak istimewa (SECURITY DEFINER) di schema publik bisa dipanggil oleh
pengguna yang belum login melalui jalur API. Migration ini mencabut izin tersebut.

## Perubahan
1. Fungsi admin dan fungsi internal trigger/wallet dicabut dari PUBLIC dan anon.
2. Fungsi pembantu yang dipakai aturan akses (is_super_admin, descendant_ids, dll.) tetap
   bisa dipanggil oleh pengguna yang sudah login.

## Catatan
- Tidak ada data yang diubah atau dihapus.
- Pemeriksaan hak Super Admin di dalam setiap fungsi admin tetap berlaku.
*/

REVOKE EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid, bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_subuser(text, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_manage_announcement(text, uuid, text, text, text, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_manage_product(text, uuid, text, text, text, bigint, bigint, boolean, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_pricing_rule(uuid, uuid, bigint, bigint, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_toggle_user_status(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_topup_wallet(uuid, bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_own_profile(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_wallet() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_network_summary() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_effective_sell_price(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_active_role(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_self_or_descendant(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.descendant_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
