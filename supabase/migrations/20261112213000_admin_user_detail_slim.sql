-- Fungsi ini mengikuti kolom profiles yang benar-benar ada:
-- id, username, role, is_active, created_at, updated_at.
-- Detail lain (nama, kota, telepon, email kontak) disimpan di auth user_metadata
-- oleh layanan internal /api/update-account agar tidak bergantung pada kolom yang belum ada.

create or replace function public.admin_get_user_detail(p_target_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or actor.is_active is false then
    raise exception 'Sesi tidak berhak melihat detail akun';
  end if;
  select * into target from public.profiles where id = p_target_uid;
  if target.id is null then
    raise exception 'Data tidak ditemukan';
  end if;
  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', target.id,
      'username', target.username,
      'role', target.role,
      'status', case when target.is_active is false then 'suspended' else 'active' end,
      'created_at', target.created_at,
      'updated_at', target.updated_at
    )
  );
end;
$$;

create or replace function public.admin_update_user_details(
  p_target_uid uuid,
  p_full_name text default null,
  p_username text default null,
  p_phone text default null,
  p_business_name text default null,
  p_address text default null,
  p_parent_id uuid default null,
  p_status text default null,
  p_loket_type text default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or actor.role not in ('super_admin', 'mitra', 'submitra') or actor.is_active is false then
    raise exception 'Anda tidak dapat mengubah akun ini';
  end if;
  update public.profiles
  set username = coalesce(nullif(lower(p_username), ''), username),
      is_active = case when p_status = 'suspended' then false when p_status = 'active' then true else is_active end,
      updated_at = now()
  where id = p_target_uid;
  if not found then
    raise exception 'Data tidak ditemukan';
  end if;
  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.admin_get_user_detail(uuid) to authenticated;
grant execute on function public.admin_update_user_details(uuid, text, text, text, text, text, uuid, text, text, text) to authenticated;
