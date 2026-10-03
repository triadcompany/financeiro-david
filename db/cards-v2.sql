-- Atualização de cartões, datas de compra e exclusão definitiva.
-- Execute todo o arquivo no SQL Editor. Preserva os lançamentos existentes.
begin;
alter table public.fin_movimentos add column if not exists data_compra date;
alter table public.fin_movimentos add column if not exists cobranca_efetivada boolean not null default false;
create table if not exists public.fin_exclusoes(
 movimento_id uuid primary key,
 familia_id uuid not null references public.familias(id),
 plano_id uuid,ordem integer,
 foreign key(familia_id,plano_id) references public.fin_planos(familia_id,id),
 unique(plano_id,ordem)
);
alter table public.fin_exclusoes enable row level security;
drop policy if exists familia_acesso on public.fin_exclusoes;
create policy familia_acesso on public.fin_exclusoes to authenticated
using(familia_id in(select financeiro_privado.minhas_familias()))
with check(familia_id in(select financeiro_privado.minhas_familias()));
revoke all on public.fin_exclusoes from public,anon,authenticated;
grant select,insert on public.fin_exclusoes to authenticated;

create or replace function public.fin_data_ocorrencia(p_inicio date,p_ordem integer,p_frequencia text)
returns date language sql immutable set search_path='' as $$
 select case when p_frequencia='semanal' then p_inicio+(p_ordem-1)*7
 when p_frequencia='quinzenal' then p_inicio+(p_ordem-1)*14
 else public.fin_data_mes((date_trunc('month',p_inicio)+make_interval(months=>(p_ordem-1)*case p_frequencia when 'anual' then 12 when 'trimestral' then 3 else 1 end))::date,extract(day from p_inicio)::int) end;
$$;
-- Usa a data original do plano ou do lançamento anterior, nunca o vencimento como data de compra.
update public.fin_movimentos m set data_compra=case when p.modalidade='parcelado' then p.inicio else public.fin_data_ocorrencia(p.inicio,m.ordem,p.frequencia) end,
 cobranca_efetivada=(m.forma='credito' and p.inicio<=current_date and (p.modalidade<>'recorrente' or m.ordem=1))
from public.fin_planos p where m.plano_id=p.id and m.data_compra is null;
update public.fin_movimentos m set data_compra=l.data_ocorrencia,
 cobranca_efetivada=(m.forma='credito' and l.data_ocorrencia<=current_date)
from public.lancamentos l where m.origem_legacy=l.id and m.data_compra is null;
update public.fin_movimentos set data_compra=coalesce(data_realizada,data_prevista)
where forma<>'credito' and data_compra is null;

create or replace function public.fin_marcar_exclusao() returns trigger language plpgsql set search_path='' as $$
begin
 insert into public.fin_exclusoes(movimento_id,familia_id,plano_id,ordem)
 values(old.id,old.familia_id,old.plano_id,old.ordem) on conflict do nothing;
 return old;
end $$;
drop trigger if exists fin_marcar_exclusao on public.fin_movimentos;
create trigger fin_marcar_exclusao before delete on public.fin_movimentos for each row execute function public.fin_marcar_exclusao();
create or replace function public.fin_gerar_plano(p_id uuid,p_ate date default (current_date+interval '24 months')::date) returns integer
language plpgsql set search_path='' as $$
declare p public.fin_planos;d jsonb;i integer;dt date;fm date;n integer;v numeric;centavos bigint;cont integer:=0;st text;real date;venc integer;compra date;begin
 select * into p from public.fin_planos where id=p_id for update;
 if not found or not p.ativo then return 0;end if;
 d=p.dados;n=case when p.modalidade='parcelado' then p.quantidade else 1 end;
 centavos=round((d->>'valor')::numeric*100)::bigint;
 if centavos<n then raise exception 'O valor é pequeno demais para o número de parcelas.';end if;
 select dia_vencimento into venc from public.cartoes where id=nullif(d->>'cartao_id','')::uuid;
 for i in 0..11999 loop
 if p.modalidade<>'recorrente' and i>=n then exit;end if;
 if p.modalidade='unico' then dt=p.inicio;
 elsif p.frequencia='semanal' then dt=p.inicio+i*7;
 elsif p.frequencia='quinzenal' then dt=p.inicio+i*14;
 else dt=public.fin_data_mes((date_trunc('month',p.inicio)+make_interval(months=>i*case p.frequencia when 'anual' then 12 when 'trimestral' then 3 else 1 end))::date,extract(day from p.inicio)::int);end if;
 if p.modalidade='recorrente' and (dt>p_ate or (p.fim is not null and dt>p.fim)) then exit;end if;
 if exists(select 1 from public.fin_exclusoes e where e.plano_id=p.id and e.ordem=i+1) then continue;end if;
 compra=case when p.modalidade='parcelado' then p.inicio else dt end;
 v=case when p.modalidade='parcelado' then ((centavos/n)+case when i<(centavos%n) then 1 else 0 end)::numeric/100 else centavos::numeric/100 end;
 fm=nullif(d->>'fatura_mes','')::date;
 if d->>'forma'='credito' then
 if fm is null or venc is null then raise exception 'Configure o vencimento e a primeira fatura.';end if;
 fm=(date_trunc('month',fm)+make_interval(months=>case when p.modalidade='parcelado' then i else (extract(year from dt)::int-extract(year from p.inicio)::int)*12+extract(month from dt)::int-extract(month from p.inicio)::int end))::date;
 dt=public.fin_data_mes(fm,venc);
 end if;
 st=case when i=0 and d->>'status'='concluido' and d->>'forma'<>'credito' then 'concluido' else 'pendente' end;
 real=case when st='concluido' then coalesce(nullif(d->>'data_realizada','')::date,p.inicio) end;
 insert into public.fin_movimentos(familia_id,pessoa_id,tipo,descricao,valor,data_prevista,data_realizada,status,forma,conta_id,destino_id,cartao_id,categoria_id,subcategoria_id,meta_id,fatura_mes,plano_id,ordem,total_parcelas,data_compra,cobranca_efetivada)
 values(p.familia_id,nullif(d->>'pessoa_id','')::uuid,d->>'tipo',d->>'descricao',v,dt,real,st,d->>'forma',nullif(d->>'conta_id','')::uuid,nullif(d->>'destino_id','')::uuid,nullif(d->>'cartao_id','')::uuid,nullif(d->>'categoria_id','')::uuid,nullif(d->>'subcategoria_id','')::uuid,nullif(d->>'meta_id','')::uuid,fm,p.id,i+1,case when p.modalidade='parcelado' then n else 1 end,compra,(d->>'forma'='credito' and compra<=current_date and (p.modalidade<>'recorrente' or i=0)))
 on conflict(plano_id,ordem) do nothing;
 if found then cont=cont+1;end if;
 end loop;return cont;
end $$;

create or replace function public.fin_excluir(p_id uuid,p_escopo text default 'somente') returns integer
language plpgsql set search_path='' as $$
declare m public.fin_movimentos; pid uuid; n integer;begin
 if p_escopo not in ('somente','proximos','serie') then raise exception 'Opção inválida.';end if;
 select plano_id into pid from public.fin_movimentos where id=p_id;
 if pid is not null then perform 1 from public.fin_planos where id=pid for update;end if;
 select * into m from public.fin_movimentos where id=p_id for update;
 if not found then
 if exists(select 1 from public.fin_exclusoes where movimento_id=p_id) then return 0;end if;
 raise exception 'Lançamento não encontrado.';end if;
 if m.plano_id is not null and p_escopo in ('proximos','serie') then
 update public.fin_planos set ativo=false where id=m.plano_id;
 delete from public.fin_movimentos where plano_id=m.plano_id and (p_escopo='serie' or ordem>=m.ordem);
 else delete from public.fin_movimentos where id=m.id;end if;
 get diagnostics n=row_count;return n;
end $$;

create or replace function public.fin_editar_compra(p_id uuid,p_futuras boolean,p_descricao text,p_valor numeric,p_pessoa uuid,p_categoria uuid,p_subcategoria uuid,p_data date,p_real date,p_compra date)
returns void language plpgsql set search_path='' as $$
begin
 perform public.fin_editar(p_id,p_futuras,p_descricao,p_valor,p_pessoa,p_categoria,p_subcategoria,p_data,p_real);
 if not p_futuras then update public.fin_movimentos set data_compra=p_compra where id=p_id;end if;
end $$;

create or replace function public.fin_confirmar_cobranca(p_id uuid,p_efetivada boolean) returns void
language plpgsql set search_path='' as $$
declare m public.fin_movimentos;p public.fin_planos;begin
 select * into m from public.fin_movimentos where id=p_id for update;
 if not found or m.forma<>'credito' or m.status='cancelado' then raise exception 'Compra não encontrada.';end if;
 if p_efetivada and (m.data_compra is null or m.data_compra>current_date) then raise exception 'Confira a data da compra antes de confirmar a cobrança.';end if;
 select * into p from public.fin_planos where id=m.plano_id;
 if p.modalidade='parcelado' then
 update public.fin_movimentos set cobranca_efetivada=p_efetivada where plano_id=m.plano_id and status<>'cancelado';
 else update public.fin_movimentos set cobranca_efetivada=p_efetivada where id=m.id;end if;
end $$;
create or replace function public.fin_versao_cartoes() returns integer language sql stable set search_path='' as $$select 2;$$;
-- Impede reimportação caso o script inicial seja executado novamente.
delete from public.fin_movimentos m using public.fin_exclusoes e where m.id=e.movimento_id;
do $$ declare r record;begin
 for r in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fin_%' loop
 execute format('revoke all on function %s from public,anon',r.assinatura);
 execute format('grant execute on function %s to authenticated',r.assinatura);
 end loop;
end $$;
commit;
select 'Atualização dos cartões instalada. Volte ao painel e clique em Verificar atualização.' as resultado;
