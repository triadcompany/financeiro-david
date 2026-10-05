# NORTH — identidade e interface

Um norte para sua vida financeira. Clareza hoje. Tranquilidade amanhã.

## Arquivos e composição

- `dist/north-tokens.css`: paleta, tipografia local Poppins (400/500/600/700), cores semânticas, gráficos, espaçamentos, raios, sombras, foco e movimento.
- `dist/north.css`: identidade aplicada aos componentes existentes, navegação, autenticação, formulários, cards, gráficos, tabelas, assistente e diálogos. É carregado após as folhas de layout existentes.
- `dist/north-ui.mjs`: apresentação do menu recolhível e mobile, Escape e rótulos acessíveis. Não acessa dados nem APIs.
- `dist/assets/north-compass*.svg`: bússola vetorial, seta voltada ao norte, quatro interrupções no círculo e detalhe âmbar.
- `dist/assets/north-app.svg` e `.png`: ícone de aplicativo; favicon usa o símbolo vetorial.
- `dist/assets/fonts/`: fontes auto-hospedadas e licença OFL. Não depende de Google Fonts ou CDN.

## Uso dos tokens

Utilizar `var(--north-primary)` para ações principais e navegação, `--north-secondary` para elementos secundários, `--north-background` para o fundo e `--north-graphite` para texto. Cards usam `--north-surface`, `--north-border`, `--north-radius` e `--north-shadow`.

Sálvia e âmbar são cores de indicadores; textos pequenos usam as variações de maior contraste `--north-positive` e `--north-warning`. Estados devem continuar acompanhados de texto ou ícone. Vermelho fica reservado a estados críticos e ações destrutivas. Gráficos compartilham `--north-chart-1` a `--north-chart-8`, legendas e valores em Real brasileiro.

O menu muda para gaveta em até 900 px. Cards e formulários usam uma coluna em até 620 px. As tabelas e gráficos largos mantêm rolagem dentro do próprio componente. Respeitar `prefers-reduced-motion` e foco visível ao adicionar componentes.

## Escopo desta atualização

Exclusivamente visual. Banco, migrações, autenticação, APIs, rotas e cálculos preservados. O Assistente NORTH mantém o funcionamento existente; a identidade não implica integração nova com IA.

## Verificação

Revisadas as nove áreas existentes com dados vazios e preenchidos em 1440, 820, 390 e 320 px; login, cadastro, recuperação e redefinição; menus; modais de lançamento, conta, cartão, objetivo, orçamento, categoria e subcategoria; faturas e relatórios. Testes financeiros, servidor, autenticação e fluxo de lançamentos mantidos.
