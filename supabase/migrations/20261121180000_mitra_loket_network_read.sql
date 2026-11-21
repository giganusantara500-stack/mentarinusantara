-- Loket yang dibuat di bawah Mitra atau Sub Mitra harus terbaca oleh Mitra.
-- Hubungan yang hanya tersimpan di metadata akun disalin ke profiles,
-- lalu descendant_ids mengikuti parent_id, mitra_id, dan created_by.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mitra_id uuid;

UPDATE public.profiles AS profile
SET parent_id = (account.raw_user_meta_data->>'parent_id')::uuid
FROM auth.users AS account
WHERE account.id = profile.id
  AND profile.parent_id IS NULL
  AND COALESCE(account.raw_user_meta_data->>'parent_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.profiles AS profile
SET created_by = (account.raw_user_meta_data->>'created_by')::uuid
FROM auth.users AS account
WHERE account.id = profile.id
  AND profile.created_by IS NULL
  AND COALESCE(account.raw_user_meta_data->>'created_by', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.profiles AS profile
SET mitra_id = (account.raw_user_meta_data->>'mitra_id')::uuid
FROM auth.users AS account
WHERE account.id = profile.id
  AND profile.mitra_id IS NULL
  AND COALESCE(account.raw_user_meta_data->>'mitra_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.profiles AS child
SET mitra_id = parent.id
FROM public.profiles AS parent
WHERE child.parent_id = parent.id
  AND child.mitra_id IS NULL
  AND parent.role = 'mitra';

UPDATE public.profiles AS child
SET mitra_id = COALESCE(parent.mitra_id, parent.parent_id)
FROM public.profiles AS parent
WHERE child.parent_id = parent.id
  AND child.mitra_id IS NULL
  AND parent.role IN ('submitra', 'sub_mitra')
  AND COALESCE(parent.mitra_id, parent.parent_id) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.descendant_ids(p_ancestor uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE tree AS (
    SELECT id
    FROM public.profiles
    WHERE parent_id = p_ancestor
       OR mitra_id = p_ancestor
       OR created_by = p_ancestor
    UNION
    SELECT child.id
    FROM public.profiles AS child
    JOIN tree ON child.parent_id = tree.id
      OR child.created_by = tree.id
  )
  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::uuid[])
  FROM tree
  WHERE id IS DISTINCT FROM p_ancestor;
$$;
