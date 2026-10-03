# Finanças • David e Carol

Painel financeiro independente para VPS: frontend existente, API Node.js e PostgreSQL. Não precisa de Supabase para funcionar. O esquema `auth` e os nomes das rotas são internos e preservam compatibilidade com as regras financeiras; não instalam nem chamam serviços Supabase.

## Publicar no EasyPanel

1. Crie um projeto, por exemplo `financeiro`.
2. Crie um serviço **Postgres**, use PostgreSQL 17 e armazenamento persistente. Mantenha o banco na rede interna. Copie a URL interna em Credentials.
3. Crie um serviço **App**, fonte GitHub `triadcompany/financeiro-david`, branch `main`, Build Path `/`.
4. Builder **Dockerfile**, arquivo `Dockerfile`. Porta HTTP da aplicação: **3000**.
5. Configure as variáveis abaixo em Environment. Nunca salve senhas no repositório.

```dotenv
DATABASE_URL=URL_INTERNA_DO_POSTGRES
NODE_ENV=production
PORT=3000
TZ=America/Sao_Paulo
APP_ORIGIN=https://SEU_DOMINIO
TRUST_PROXY=1
```

`APP_ORIGIN` deve ser exatamente a origem HTTPS usada para acessar o painel, sem barra final. `TRUST_PROXY=1` pressupõe um proxy entre o visitante e o app; ajuste se sua rede tiver outros proxies. Não exponha a porta do app diretamente fora do proxy.

6. Configure domínio e HTTPS e clique Deploy. O início executa migrações versionadas e inicia o servidor. Use um banco dedicado, com usuário que possa criar esquema/roles (o usuário postgres do serviço). O código financeiro atende cada requisição com o papel restrito `authenticated` e isolamento por família.
7. Verifique `/health` e os logs. Depois configure os usuários, conforme o cenário abaixo.

## Primeiro acesso: escolha o cenário correto

### Vou manter os lançamentos atuais

**Não crie a família inicial antes da importação.** Exporte e importe como descrito abaixo. Depois, na console SQL do Postgres, consulte:

```sql
select id, nome from public.pessoas order by nome;
```

Na console do serviço App, crie/redefina o acesso de cada pessoa usando o ID correspondente:

```sh
bash
read -r -p 'E-mail: ' USER_EMAIL
read -r -s -p 'Nova senha (mínimo 12 caracteres): ' USER_PASSWORD
read -r -p 'ID da pessoa: ' PERSON_ID
export USER_EMAIL USER_PASSWORD PERSON_ID
npm run user
unset USER_EMAIL USER_PASSWORD PERSON_ID
```

As senhas antigas do Supabase não são transferidas. O comando mantém o vínculo da pessoa aos registros existentes e encerra suas sessões anteriores. Use também esse comando para redefinir uma senha esquecida.

### Quero começar com banco vazio

Na console do App, execute os mesmos comandos acima, **sem PERSON_ID**. O comando cria David, Carol e os três cartões já planejados. Depois entre no painel com o e-mail/senha escolhidos. Em Cadastros e acesso, crie um convite para Carol. Compartilhe o link de forma privada. O link concede acesso ao cadastro indicado; não há envio automático de e-mail nem serviço de confirmação de e-mail.

## Transferir dados do Supabase

A migração real depende de exportar os dados da conta atual. O repositório contém somente código, nunca os lançamentos pessoais. Antes de exportar, pause novos lançamentos para não perder mudanças entre a cópia e a troca. Faça também um backup completo do banco antigo.

Em computador com Node 22+, configure no ambiente `SUPABASE_URL`, `SUPABASE_KEY` (publishable/anon), `SUPABASE_EMAIL`, `SUPABASE_PASSWORD`. Use sua conta normal; não é necessária a service_role. Então:

```sh
npm run export:supabase
```

O arquivo privado será `backups/export.json`, ignorado pelo Git. Ele inclui somente as famílias acessíveis à conta usada. Transfira-o por um canal privado para a VPS, nunca pelo GitHub. A importação exige um banco destino migrado e sem famílias:

```sh
npm run import:data -- /caminho/privado/export.json
```

A importação é transacional, preserva IDs e compara contagens. Se houver um campo do esquema original não mapeado, ela cancela e informa o campo em vez de descartá-lo. Nesse caso, adapte o esquema antes de tentar novamente. Ela não exclui registros do Supabase. Convites e lançamentos são dados privados.

Após importar: configure os acessos por PERSON_ID, compare saldos por conta, totais de cada fatura, parcelas, recorrências e reservas de objetivos. Teste o acesso de Carol e um lançamento/exclusão. Só passe a usar a VPS como sistema principal após essa conferência. Mantenha a versão antiga disponível para retorno até validar a migração. Nunca lance dados nas duas versões simultaneamente.

## Backups e manutenção

Ative backups agendados do Postgres no EasyPanel e guarde uma cópia fora da VPS. Teste uma restauração em banco separado. Faça backup antes de atualizar. O Docker não contém dados financeiros: a persistência fica no volume do Postgres.

Atualizações de código entram pelo GitHub e Deploy no EasyPanel. As migrações executam uma vez por nome, com trava para impedir execução concorrente. Não altere uma migração já aplicada; adicione outra.

## Desenvolvimento e testes

```sh
npm ci
npm test
npm run test:server
npm run migrate
npm start
```

Configure DATABASE_URL antes de migrar/iniciar. Não existe integração bancária automática ou interpretação de PDF/áudio: os lançamentos por mensagem usam interpretação local. Limite de cartão é estimado, com cobranças futuras recorrentes separadas das cobranças efetivadas.

O cálculo de caixa mantém transferências neutras e não duplica compras no cartão e pagamentos de fatura. As permissões de família são aplicadas no PostgreSQL. Senhas usam scrypt com salt; sessões são revogáveis e seus tokens são armazenados apenas como hash no banco.

A versão VPS foi preparada sem alterar o site hospedado anterior. A transferência dos dados reais e a implantação na VPS precisam ser realizadas e conferidas no ambiente do proprietário.
