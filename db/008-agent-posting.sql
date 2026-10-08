alter table public.north_agent_drafts drop constraint if exists north_agent_drafts_status_check;
alter table public.north_agent_drafts add constraint north_agent_drafts_status_check check(status in ('pending','confirmed_preview','discarded','posted'));
