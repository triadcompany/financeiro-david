-- WhatsApp ownership verification and individual user linkage.
create table if not exists public.north_whatsapp_links (
 user_id uuid primary key references auth.users(id) on delete cascade,
 phone text not null unique,
 verified_at timestamptz not null default now()
);
create table if not exists public.north_whatsapp_challenges (
 user_id uuid primary key references auth.users(id) on delete cascade,
 phone text not null,
 code_hash text not null,
 expires_at timestamptz not null,
 attempts int not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists north_whatsapp_challenges_expires on public.north_whatsapp_challenges(expires_at);
revoke all on public.north_whatsapp_links, public.north_whatsapp_challenges from public;
