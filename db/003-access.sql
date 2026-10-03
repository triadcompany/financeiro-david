-- Every public row is protected even when the API selects without a family filter.
do $$ declare t text; begin
 foreach t in array array['pessoas','categorias','contas','cartoes','lancamentos'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy familia_acesso on public.%I to authenticated using (familia_id in (select financeiro_privado.minhas_familias())) with check (familia_id in (select financeiro_privado.minhas_familias()))',t);
 end loop;
end $$;
alter table public.familias enable row level security;
create policy familia_acesso on public.familias to authenticated using(id in(select financeiro_privado.minhas_familias()));
revoke insert,update on public.familias,public.pessoas from authenticated;
grant select on public.familias,public.pessoas,public.lancamentos to authenticated;
revoke all on schema auth from public;
grant usage on schema auth to authenticated;
revoke all on auth.users,auth.sessions from authenticated,anon,public;
