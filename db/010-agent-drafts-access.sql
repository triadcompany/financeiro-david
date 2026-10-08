-- Permit the authenticated posting transaction to read and update only its own drafts.
alter table public.north_agent_drafts enable row level security;
revoke all on public.north_agent_drafts from public,anon;
grant select,update on public.north_agent_drafts to authenticated;
drop policy if exists north_agent_drafts_owner on public.north_agent_drafts;
create policy north_agent_drafts_owner on public.north_agent_drafts for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
