-- Attendance -- office-IP containment test (file 4 of 4).
--
-- Exists as an RPC because PostgREST cannot express the inet containment
-- operator (>>=) as a filter, and because the test belongs in Postgres anyway:
-- its inet/cidr operators handle IPv4, IPv6 and prefix lengths correctly, where
-- a hand-rolled JS subnet match is the usual source of bugs in this kind of
-- check. Called only from lib/attendance-network.ts on the service-role client.
--
-- An unparseable p_ip makes the cast raise; the caller catches that and treats
-- it as off-network, which is the safe direction.
create or replace function public.attendance_ip_allowed(p_ip text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.attendance_networks
    where is_active and cidr >>= p_ip::inet
  );
$$;

-- Never reachable from a browser with a user's own JWT: the punch route is the
-- only thing that may ask this question, and it asks on the service role.
revoke all on function public.attendance_ip_allowed(text) from public, anon, authenticated;
grant all on function public.attendance_ip_allowed(text) to service_role;
