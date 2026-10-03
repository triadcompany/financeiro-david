-- Finanças David e Carol — atualização cumulativa, preservando os dados existentes.
-- Execute TODO o arquivo em uma nova consulta do SQL Editor do Supabase.
begin;

alter table public.contas drop constraint if exists contas_tipo_check;
alter table public.contas add constraint contas_tipo_check check(tipo in ('bancaria','dinheiro','poupanca','investimento'));
alter table public.cartoes add column if not exists limite numeric(14,2) check(limite>=0);
create unique index if not exists categorias_familia_id_uq on public.categorias(familia_id,id);

create table if not exists public.fin_subcategorias(
 id uuid primary key default gen_random_uuid(), familia_id uuid not null references public.familias(id),
 categoria_id uuid not null, nome text not null check(length(trim(nome))>0),
 foreign key(familia_id,categoria_id) references public.categorias(familia_id,id),
 unique(familia_id,categoria_id,nome),unique(familia_id,id)
);
create table if not exists public.fin_metas(
 id uuid primary key default gen_random_uuid(),familia_id uuid not null references public.familias(id),
 nome text not null check(length(trim(nome))>0),pessoa_id uuid,valor_alvo numeric(14,2) not null check(valor_alvo>0),prazo date,ativa boolean not null default true,
 foreign key(familia_id,pessoa_id) references public.pessoas(familia_id,id), unique(familia_id,id)
);
create table if not exists public.fin_orcamentos(
 id uuid primary key default gen_random_uuid(),familia_id uuid not null references public.familias(id),
 categoria_id uuid not null,mes date not null check(extract(day from mes)=1),valor numeric(14,2) not null check(valor>0),
 foreign key(familia_id,categoria_id) references public.categorias(familia_id,id),unique(familia_id,categoria_id,mes)
);
create table if not exists public.fin_planos(
 id uuid primary key,familia_id uuid not null references public.familias(id),
 modalidade text not null check(modalidade in ('unico','parcelado','recorrente')),
 dados jsonb not null,inicio date not null,fim date,frequencia text not null default 'mensal' check(frequencia in ('mensal','semanal','quinzenal','trimestral','anual')),
 quantidade integer not null default 1 check(quantidade between 1 and 600),ativo boolean not null default true,
 criado_em timestamptz not null default now(),unique(familia_id,id)
);
create table if not exists public.fin_movimentos(
 id uuid primary key default gen_random_uuid(),familia_id uuid not null references public.familias(id),pessoa_id uuid,
 tipo text not null check(tipo in ('entrada','saida','transferencia','aporte','resgate','rendimento','perda','pagamento_fatura','reserva','liberacao','ajuste')),
 descricao text not null check(length(trim(descricao))>0),valor numeric(14,2) not null check(valor>0),
 data_prevista date not null,data_realizada date,status text not null default 'pendente' check(status in ('pendente','concluido','cancelado')),
 forma text not null default 'pix',conta_id uuid,destino_id uuid,cartao_id uuid,categoria_id uuid,subcategoria_id uuid,meta_id uuid,
 fatura_mes date,plano_id uuid,ordem integer not null default 1,total_parcelas integer not null default 1,
 origem_legacy uuid unique,criado_em timestamptz not null default now(),
 foreign key(familia_id,pessoa_id) references public.pessoas(familia_id,id),
 foreign key(familia_id,conta_id) references public.contas(familia_id,id),
 foreign key(familia_id,destino_id) references public.contas(familia_id,id),
 foreign key(familia_id,cartao_id) references public.cartoes(familia_id,id),
 foreign key(familia_id,categoria_id) references public.categorias(familia_id,id),
 foreign key(familia_id,subcategoria_id) references public.fin_subcategorias(familia_id,id),
 foreign key(familia_id,meta_id) references public.fin_metas(familia_id,id),
 foreign key(familia_id,plano_id) references public.fin_planos(familia_id,id),
 unique(plano_id,ordem),
 check((status='concluido' and data_realizada is not null) or (status<>'concluido' and data_realizada is null)),
 check(fatura_mes is null or extract(day from fatura_mes)=1),
 check(conta_id is null or destino_id is null or conta_id<>destino_id),
 check((forma='credito' and tipo='saida' and cartao_id is not null and conta_id is null) or forma<>'credito'),
 check(tipo not in ('transferencia','aporte','resgate') or (conta_id is not null and destino_id is not null)),
 check(tipo<>'pagamento_fatura' or (conta_id is not null and cartao_id is not null and fatura_mes is not null)),
 check(tipo not in ('reserva','liberacao') or (meta_id is not null and conta_id is not null)),
 check(tipo not in ('entrada','saida') or categoria_id is not null)
);
create index if not exists fin_movimentos_familia_data on public.fin_movimentos(familia_id,data_prevista);
create index if not exists fin_movimentos_cartao_fatura on public.fin_movimentos(cartao_id,fatura_mes);
create table if not exists public.fin_convites(
 id uuid primary key default gen_random_uuid(),familia_id uuid not null references public.familias(id),pessoa_id uuid not null,
 email text not null,token uuid not null unique default gen_random_uuid(),expira_em timestamptz not null default now()+interval '7 days',usado boolean not null default false,
 foreign key(familia_id,pessoa_id) references public.pessoas(familia_id,id)
);

do $$ declare t text;begin
 foreach t in array array['fin_subcategorias','fin_metas','fin_orcamentos','fin_planos','fin_movimentos','fin_convites'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 execute format('drop policy if exists familia_acesso on public.%I',t);
 execute format('create policy familia_acesso on public.%I to authenticated using (familia_id in (select financeiro_privado.minhas_familias())) with check (familia_id in (select financeiro_privado.minhas_familias()))',t);
 end loop;
end $$;

create or replace function public.fin_data_mes(p_mes date,p_dia integer) returns date language sql immutable set search_path='' as $$
 select (date_trunc('month',p_mes)::date + (least(p_dia,extract(day from (date_trunc('month',p_mes)+interval '1 month - 1 day'))::int)-1));
$$;
create or replace function public.fin_primeira_fatura(p_data date,p_fecha integer,p_vence integer) returns date language plpgsql immutable set search_path='' as $$
declare c date;d date;begin
 if p_fecha is null or p_vence is null then return null;end if;
 c=date_trunc('month',p_data)::date;
 if p_data>=public.fin_data_mes(c,p_fecha) then c=(c+interval '1 month')::date;end if;
 d=public.fin_data_mes(c,p_vence);
 if d<=public.fin_data_mes(c,p_fecha) then d=public.fin_data_mes((c+interval '1 month')::date,p_vence);end if;
 return date_trunc('month',d)::date;
end $$;

-- Datas combinadas, apenas quando ainda não foram preenchidas.
update public.cartoes set dia_fechamento=coalesce(dia_fechamento,case when nome='Itaú Azul' then 2 else 4 end),dia_vencimento=coalesce(dia_vencimento,case when nome='Itaú Azul' then 9 else 10 end)
where nome in ('Itaú Azul','Inter Carol','Porto Seguro');

-- Subcategorias iniciais, sem alterar os nomes das categorias existentes.
insert into public.fin_subcategorias(familia_id,categoria_id,nome)
select c.familia_id,c.id,v.sub from public.categorias c join (values
 ('Moradia','Aluguel'),('Moradia','Condomínio'),('Moradia','Manutenção'),('Moradia','Móveis'),
 ('Contas da casa','Água'),('Contas da casa','Energia'),('Contas da casa','Internet'),('Contas da casa','Gás'),
 ('Alimentação','Supermercado'),('Alimentação','Padaria'),('Restaurantes e delivery','Restaurante'),('Restaurantes e delivery','Delivery'),
 ('Transporte','Combustível'),('Transporte','Aplicativos'),('Transporte','Manutenção'),('Transporte','Seguro'),
 ('Saúde','Consultas'),('Saúde','Exames'),('Saúde','Farmácia'),('Saúde','Plano de saúde'),
 ('Cuidados pessoais e vestuário','Roupas'),('Cuidados pessoais e vestuário','Calçados'),('Cuidados pessoais e vestuário','Cabelo'),('Cuidados pessoais e vestuário','Cosméticos'),
 ('Lazer e viagens','Passeios'),('Lazer e viagens','Eventos'),('Lazer e viagens','Hospedagem'),
 ('Educação','Cursos'),('Educação','Livros'),('Educação','Mensalidades'),
 ('Assinaturas','Streaming'),('Assinaturas','Aplicativos'),('Assinaturas','Serviços digitais')
) as v(cat,sub) on c.nome=v.cat and c.tipo='saida'
on conflict(familia_id,categoria_id,nome) do nothing;

-- Importação idempotente: mantém lançamentos originais e evita copiar duas vezes.
insert into public.fin_movimentos(id,familia_id,pessoa_id,tipo,descricao,valor,data_prevista,data_realizada,status,forma,conta_id,cartao_id,categoria_id,fatura_mes,origem_legacy)
select l.id,l.familia_id,l.pessoa_id,l.tipo,l.descricao,l.valor,
 case when l.forma='credito' then coalesce(public.fin_data_mes(public.fin_primeira_fatura(l.data_ocorrencia,c.dia_fechamento,c.dia_vencimento),c.dia_vencimento),l.data_ocorrencia) else l.data_ocorrencia end,
 case when l.forma<>'credito' and l.data_ocorrencia<=current_date then l.data_ocorrencia end,
 case when l.forma='credito' or l.data_ocorrencia>current_date then 'pendente' else 'concluido' end,l.forma,l.conta_id,l.cartao_id,l.categoria_id,
 case when l.forma='credito' then public.fin_primeira_fatura(l.data_ocorrencia,c.dia_fechamento,c.dia_vencimento) end,l.id
from public.lancamentos l left join public.cartoes c on c.id=l.cartao_id
on conflict do nothing;

create or replace function public.fin_gerar_plano(p_id uuid,p_ate date default (current_date+interval '24 months')::date) returns integer
language plpgsql set search_path='' as $$
declare p public.fin_planos;d jsonb;i integer;dt date;fm date;n integer;v numeric;centavos bigint;cont integer:=0;st text;real date;venc integer;begin
 select * into p from public.fin_planos where id=p_id;
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
 v=case when p.modalidade='parcelado' then ((centavos/n)+case when i<(centavos%n) then 1 else 0 end)::numeric/100 else centavos::numeric/100 end;
 fm=nullif(d->>'fatura_mes','')::date;
 if d->>'forma'='credito' then
 if fm is null or venc is null then raise exception 'Configure o vencimento e a primeira fatura.';end if;
 fm=(date_trunc('month',fm)+make_interval(months=>case when p.modalidade='parcelado' then i else (extract(year from dt)::int-extract(year from p.inicio)::int)*12+extract(month from dt)::int-extract(month from p.inicio)::int end))::date;
 dt=public.fin_data_mes(fm,venc);
 end if;
 st=case when i=0 and d->>'status'='concluido' and d->>'forma'<>'credito' then 'concluido' else 'pendente' end;
 real=case when st='concluido' then coalesce(nullif(d->>'data_realizada','')::date,p.inicio) end;
 insert into public.fin_movimentos(familia_id,pessoa_id,tipo,descricao,valor,data_prevista,data_realizada,status,forma,conta_id,destino_id,cartao_id,categoria_id,subcategoria_id,meta_id,fatura_mes,plano_id,ordem,total_parcelas)
 values(p.familia_id,nullif(d->>'pessoa_id','')::uuid,d->>'tipo',d->>'descricao',v,dt,real,st,d->>'forma',nullif(d->>'conta_id','')::uuid,nullif(d->>'destino_id','')::uuid,nullif(d->>'cartao_id','')::uuid,nullif(d->>'categoria_id','')::uuid,nullif(d->>'subcategoria_id','')::uuid,nullif(d->>'meta_id','')::uuid,fm,p.id,i+1,case when p.modalidade='parcelado' then n else 1 end)
 on conflict(plano_id,ordem) do nothing;
 if found then cont=cont+1;end if;
 end loop;return cont;
end $$;
create or replace function public.fin_criar(p_id uuid,p_familia uuid,p_modalidade text,p_inicio date,p_fim date,p_frequencia text,p_quantidade integer,p_dados jsonb) returns uuid
language plpgsql set search_path='' as $$
begin
 if p_inicio is null or p_inicio<'2000-01-01' or p_inicio>'2100-01-01' then raise exception 'Informe uma data entre 2000 e 2100.';end if;
 if p_fim is not null and p_fim<p_inicio then raise exception 'O término deve ser posterior ao início.';end if;
 if p_dados->>'forma'='credito' and p_frequencia in ('semanal','quinzenal') then raise exception 'Recorrência no crédito: use frequência mensal, trimestral ou anual.';end if;
 insert into public.fin_planos(id,familia_id,modalidade,dados,inicio,fim,frequencia,quantidade) values(p_id,p_familia,p_modalidade,p_dados,p_inicio,p_fim,p_frequencia,p_quantidade) on conflict(id) do nothing;
 perform public.fin_gerar_plano(p_id,greatest((current_date+interval '24 months')::date,(p_inicio+interval '24 months')::date));
 return p_id;
end $$;
create or replace function public.fin_atualizar_recorrencias() returns integer language plpgsql set search_path='' as $$
declare p record;n integer:=0;begin
 for p in select id from public.fin_planos where ativo and modalidade='recorrente' loop n=n+public.fin_gerar_plano(p.id);end loop;return n;
end $$;

-- Atualiza só campos descritivos/financeiros das ocorrências futuras ainda pendentes.
create or replace function public.fin_editar(p_id uuid,p_futuras boolean,p_descricao text,p_valor numeric,p_pessoa uuid,p_categoria uuid,p_subcategoria uuid,p_data date,p_real date default null) returns void language plpgsql set search_path='' as $$
declare m public.fin_movimentos;begin
 select * into m from public.fin_movimentos where id=p_id for update;if not found then raise exception 'Lançamento não encontrado.';end if;
 if p_futuras and m.plano_id is not null then
 update public.fin_movimentos set descricao=p_descricao,valor=p_valor,pessoa_id=p_pessoa,categoria_id=p_categoria,subcategoria_id=p_subcategoria where plano_id=m.plano_id and ordem>=m.ordem and status='pendente';
 update public.fin_planos set dados=dados||jsonb_build_object('descricao',p_descricao,'valor',p_valor,'pessoa_id',p_pessoa,'categoria_id',p_categoria,'subcategoria_id',p_subcategoria) where id=m.plano_id and modalidade='recorrente';
 else update public.fin_movimentos set descricao=p_descricao,valor=p_valor,pessoa_id=p_pessoa,categoria_id=p_categoria,subcategoria_id=p_subcategoria,data_prevista=p_data,fatura_mes=case when forma='credito' then date_trunc('month',p_data)::date else fatura_mes end,data_realizada=case when status='concluido' then coalesce(p_real,data_realizada) else null end where id=p_id;end if;
end $$;
create or replace function public.fin_cancelar(p_id uuid,p_futuras boolean) returns void language plpgsql set search_path='' as $$
declare m public.fin_movimentos;begin
 select * into m from public.fin_movimentos where id=p_id for update;if not found then raise exception 'Lançamento não encontrado.';end if;
 if p_futuras and m.plano_id is not null then
 update public.fin_movimentos set status='cancelado',data_realizada=null where plano_id=m.plano_id and ordem>=m.ordem and status='pendente';
 update public.fin_planos set ativo=false where id=m.plano_id;
 else update public.fin_movimentos set status='cancelado',data_realizada=null where id=p_id;end if;
end $$;

-- Reserva automática do aporte/resgate: meta_id identifica a destinação, sem duplicar o saldo.
create or replace function public.fin_validar_movimento() returns trigger language plpgsql set search_path='' as $$
declare c public.categorias;sc public.fin_subcategorias;begin
 if new.forma<>'credito' and new.conta_id is null then raise exception 'Informe a conta.';end if;
 if new.forma='credito' and new.fatura_mes is null then raise exception 'Informe a fatura da compra.';end if;
 if new.categoria_id is not null then select * into c from public.categorias where id=new.categoria_id;
 if new.tipo in ('entrada','saida') and c.tipo<>new.tipo then raise exception 'Categoria incompatível com o tipo.';end if;end if;
 if new.subcategoria_id is not null then select * into sc from public.fin_subcategorias where id=new.subcategoria_id;
 if sc.categoria_id is distinct from new.categoria_id then raise exception 'Subcategoria incompatível.';end if;end if;
 if new.status='concluido' and new.data_realizada>current_date then raise exception 'Movimentação futura deve ficar pendente.';end if;
 if new.forma='credito' and new.status='concluido' then raise exception 'Dê baixa pelo pagamento da fatura.';end if;
 return new;
end $$;
drop trigger if exists fin_validar_movimento on public.fin_movimentos;
create trigger fin_validar_movimento before insert or update on public.fin_movimentos for each row execute function public.fin_validar_movimento();

create or replace function public.fin_aceitar_convite(p_token uuid) returns text language plpgsql security definer set search_path='' as $$
declare c public.fin_convites;u uuid;email_usuario text;confirmado timestamptz;begin
 u=auth.uid();if u is null then raise exception 'Faça login antes de aceitar.';end if;
 select email,email_confirmed_at into email_usuario,confirmado from auth.users where id=u;
 if confirmado is null then raise exception 'Confirme seu e-mail antes de aceitar.';end if;
 select * into c from public.fin_convites where token=p_token and not usado and expira_em>now() for update;
 if not found or lower(c.email)<>lower(email_usuario) then raise exception 'Convite inválido, expirado ou destinado a outro e-mail.';end if;
 if exists(select 1 from public.pessoas where usuario_id=u and id<>c.pessoa_id) then raise exception 'Este usuário já tem um cadastro vinculado.';end if;
 update public.pessoas set usuario_id=u where id=c.pessoa_id and familia_id=c.familia_id and (usuario_id is null or usuario_id=u);
 if not found then raise exception 'Cadastro já vinculado a outra pessoa.';end if;
 update public.fin_convites set usado=true where id=c.id;return 'Acesso vinculado com sucesso';
end $$;

create or replace function public.fin_checar_reservas() returns trigger language plpgsql set search_path='' as $$
declare a record;reservado numeric;saldo numeric;negativo boolean;begin
 -- Serializa a verificação dentro da família.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(new.familia_id,old.familia_id)::text,0));
 for a in select * from public.contas where familia_id=coalesce(new.familia_id,old.familia_id) loop
 select coalesce(sum(case when tipo in ('reserva','aporte') then valor else -valor end),0) into reservado
 from public.fin_movimentos where familia_id=a.familia_id and meta_id is not null and status='concluido'
 and ((tipo='aporte' and destino_id=a.id) or (tipo in ('reserva','liberacao','resgate') and conta_id=a.id));
 select exists(select 1 from public.fin_movimentos where familia_id=a.familia_id and meta_id is not null and status='concluido'
 and ((tipo='aporte' and destino_id=a.id) or (tipo in ('reserva','liberacao','resgate') and conta_id=a.id))
 group by meta_id having sum(case when tipo in ('reserva','aporte') then valor else -valor end)<0) into negativo;
 if negativo then raise exception 'A retirada excede a reserva do objetivo nessa conta.';end if;
 if new.tipo in ('reserva','aporte') and new.status='concluido' and new.meta_id is not null and (new.conta_id=a.id or new.destino_id=a.id) then
 if a.saldo_inicial is null then raise exception 'Cadastre o saldo inicial antes de reservar valores.';end if;
 select coalesce(a.saldo_inicial,0)+coalesce(sum(case
 when tipo in ('reserva','liberacao') or forma='credito' then 0
 when tipo in ('transferencia','aporte','resgate') then (case when destino_id=a.id then valor else 0 end)-(case when conta_id=a.id then valor else 0 end)
 when conta_id=a.id and tipo in ('entrada','rendimento') then valor
 when conta_id=a.id then -valor else 0 end),0) into saldo
 from public.fin_movimentos where familia_id=a.familia_id and status='concluido' and data_realizada>=a.data_saldo_inicial;
 if reservado>saldo then raise exception 'A reserva excede o saldo livre desta conta. Confira saldo inicial e movimentações.';end if;
 end if;
 end loop;
 return coalesce(new,old);
end $$;
drop trigger if exists fin_checar_reservas on public.fin_movimentos;
create trigger fin_checar_reservas after insert or update or delete on public.fin_movimentos for each row execute function public.fin_checar_reservas();

-- Nenhuma função de escrita é pública para visitantes sem login.
do $$ declare r record;begin
 for r in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fin_%' loop
 execute format('revoke all on function %s from public,anon',r.assinatura);
 execute format('grant execute on function %s to authenticated',r.assinatura);
 end loop;
end $$;
-- A versão antiga permanece para leitura, mas novos lançamentos passam pela estrutura unificada.
revoke insert,update,delete on public.lancamentos from authenticated;
commit;
select 'Atualização financeira instalada. Volte ao painel e clique em Verificar atualização.' as resultado;
