create table if not exists public.north_agent_conversations (
 user_id uuid primary key references auth.users(id) on delete cascade,
 draft_id uuid references public.north_agent_drafts(id) on delete set null,
 missing_field text,
 state jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '24 hours')
);
revoke all on public.north_agent_conversations from public,anon,authenticated;
