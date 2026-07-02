-- ============================================================================
-- create_owner.sql — Run ONCE to promote the first admin to Owner role.
-- Usage: psql "$DATABASE_URL" -v email="owner@example.com" -f create_owner.sql
-- Or paste into the Supabase SQL Editor replacing :email with the real email.
-- ============================================================================

do $$
declare
  v_user_id uuid;
begin
  -- Find the auth.users row for this email
  select id into v_user_id from auth.users where email = :'email';

  if v_user_id is null then
    raise exception 'No auth user found for email %. '
      'Create the user first via the Supabase Auth dashboard (Authentication → Users → Invite user).', :'email';
  end if;

  -- Upsert into admins with Owner role
  insert into public.admins (id, email, role, is_active)
  values (v_user_id, :'email', 'owner', true)
  on conflict (id) do update
    set role = 'owner', is_active = true, updated_at = now();

  raise notice 'Owner account created/updated for % (id: %)', :'email', v_user_id;
end;
$$;
