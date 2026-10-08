-- Isolated draft store: never changes balances, installments, card bills or movements.
create table if not exists public.north_agent_drafts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 external_event_id text not null,
 payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','confirmed_preview','discarded')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,external_event_id),
 check(jsonb_typeof(payload)='object')
);
create index if not exists north_agent_drafts_user_created_idx on public.north_agent_drafts(user_id,created_at desc);
revoke all on public.north_agent_drafts from public;
