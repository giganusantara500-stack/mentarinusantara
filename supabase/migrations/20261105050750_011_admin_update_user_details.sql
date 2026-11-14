/*
# Edit detail akun dalam jaringan

1. Fungsi baru
- `admin_update_user_details` mengubah nama lengkap, username, nomor HP, nama usaha, alamat, atasan, dan status sebuah akun.
- Super Admin dapat mengubah semua akun kecuali Super Admin lain dan dirinya sendiri.
- Mitra, Sub Mitra dapat mengubah akun di bawah jaringannya. Atasan baru harus berada di jaringan pemanggil.

2. Fungsi lama dihapus
- `admin_set_user_role` hanya mengizinkan Super Admin dan hanya mengubah atasan serta status. Seluruh halaman kelola akun kini memakai fungsi baru ini.

3. Keamanan
- Fungsi SECURITY DEFINER, EXECUTE dicabut dari PUBLIC dan anon, hanya diberikan ke authenticated.
- Setiap pemanggilan memeriksa peran dan jaringan di dalam fungsi.
- Perubahan dicatat di audit_logs.

4. Catatan
- Role akun tidak dapat diubah lewat fungsi ini.
- Email tidak diubah di sini karena terikat ke Supabase Auth.
*/

CREATE OR REPLACE FUNCTION public.admin_update_user_details(
  p_target_uid uuid,
  p_full_name text,
  p_username text,
  p_phone text,
  p_business_name text,
  p_address text,
  p_parent_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller_is_super boolean := public.is_super_admin();
  target_profile public.profiles%ROWTYPE;
  parent_profile public.profiles%ROWTYPE;
  normalized_username text := lower(btrim(p_username));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_target_uid = auth.uid() THEN
    RAISE EXCEPTION 'Tidak dapat mengubah akun sendiri';
  END IF;

  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengguna tidak ditemukan';
  END IF;
  IF target_profile.role = 'super_admin' THEN
    RAISE EXCEPTION 'Tidak dapat mengubah Super Admin';
  END IF;
  IF NOT caller_is_super AND NOT (p_target_uid = ANY(public.descendant_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF p_status NOT IN ('pending', 'active', 'suspended') THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;
  IF NOT caller_is_super AND p_status = 'pending' THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;

  IF btrim(coalesce(p_full_name, '')) = '' OR btrim(coalesce(p_phone, '')) = ''
     OR btrim(coalesce(p_business_name, '')) = '' OR btrim(coalesce(p_address, '')) = '' THEN
    RAISE EXCEPTION 'Semua field wajib diisi';
  END IF;
  IF normalized_username !~ '^[a-z0-9_.]{3,30}$' THEN
    RAISE EXCEPTION 'Username hanya boleh huruf kecil, angka, titik, dan garis bawah (3-30 karakter)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = normalized_username AND id <> p_target_uid
  ) THEN
    RAISE EXCEPTION 'Username sudah digunakan';
  END IF;

  IF p_parent_id IS NULL THEN
    RAISE EXCEPTION 'Atasan wajib dipilih';
  END IF;
  SELECT * INTO parent_profile FROM public.profiles WHERE id = p_parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atasan tidak ditemukan';
  END IF;
  IF NOT caller_is_super AND NOT (p_parent_id = auth.uid() OR p_parent_id = ANY(public.descendant_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Atasan berada di luar jaringan Anda';
  END IF;
  IF target_profile.role = 'mitra' AND parent_profile.role <> 'super_admin' THEN
    RAISE EXCEPTION 'Mitra harus di bawah Super Admin';
  END IF;
  IF target_profile.role = 'submitra' AND parent_profile.role <> 'mitra' THEN
    RAISE EXCEPTION 'Sub Mitra harus di bawah Mitra';
  END IF;
  IF target_profile.role = 'loket' AND parent_profile.role <> 'submitra' THEN
    RAISE EXCEPTION 'Loket harus di bawah Sub Mitra';
  END IF;

  UPDATE public.profiles
  SET full_name = btrim(p_full_name),
      username = normalized_username,
      phone = btrim(p_phone),
      business_name = btrim(p_business_name),
      address = btrim(p_address),
      parent_id = p_parent_id,
      status = p_status
  WHERE id = p_target_uid;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'update_user_details', 'profile', p_target_uid,
    jsonb_build_object(
      'old_parent_id', target_profile.parent_id,
      'new_parent_id', p_parent_id,
      'old_status', target_profile.status,
      'new_status', p_status,
      'old_username', target_profile.username,
      'new_username', normalized_username
    ));

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_update_user_details(uuid, text, text, text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_details(uuid, text, text, text, text, text, uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_set_user_role(uuid, text, uuid, text);
