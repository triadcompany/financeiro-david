alter table public.contas add column if not exists padrao boolean not null default false;
create unique index if not exists contas_familia_padrao_uq on public.contas(familia_id) where padrao=true;
update public.contas c set padrao=true where c.ativa=true and not exists(select 1 from public.contas x where x.familia_id=c.familia_id and x.padrao=true) and (select count(*) from public.contas x where x.familia_id=c.familia_id and x.ativa=true)=1;
