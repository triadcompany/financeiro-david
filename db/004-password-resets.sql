create table auth.password_resets(
 token_hash text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null
);
create index on auth.password_resets(user_id);
create index on auth.password_resets(expires_at);
revoke all on auth.password_resets from public,authenticated,anon;
