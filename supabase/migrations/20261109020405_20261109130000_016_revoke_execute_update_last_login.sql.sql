/*
# Revoke execute on update_last_login_at from all roles

The trigger function update_last_login_at() is SECURITY DEFINER and should only
be called by the trigger on auth.users, not via the REST API.
*/

REVOKE EXECUTE ON FUNCTION public.update_last_login_at() FROM PUBLIC, anon, authenticated;
