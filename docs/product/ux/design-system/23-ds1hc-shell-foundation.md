# DS-1H-C - Shell Foundation and Responsive Hardening

## Status

- shell oficial consolidado em codigo
- contrato estrutural unificado entre desktop, tablet e mobile
- shell legado anterior removido dos call sites ativos
- sem redesign visual amplo
- DS-1H-D nao iniciado

## Objective

Transformar o piloto aprovado em DS-1H-B na fundacao oficial do dashboard, removendo sobras da implementacao anterior e endurecendo contratos de:

- estado do shell
- navegacao
- largura e offset
- breakpoint
- scroll
- mobile

Esta rodada nao reabriu:

- desenho da top utility bar
- arquitetura de rotas
- busca global
- tipografia
- calibracao visual sistemica

## Official Architecture

O shell oficial agora e composto por:

- `app/(dashboard)/layout.tsx`
  - monta `StudioShell` como contrato unico do dashboard
- `components/layout/studio-shell.tsx`
  - shell adapter oficial do produto
  - concentra top utility bar, rail desktop, drawer mobile, trigger global, estado responsivo, foco, fechamento e offsets
- `components/layout/dashboard-page.tsx`
  - wrapper estrutural reutilizavel para alinhar largura, padding e scroll das paginas do dashboard
- `components/ui/sidebar.tsx`
  - primitive compartilhada e generica
  - continua responsavel apenas pela infraestrutura de sidebar/sheet/tooltip
- `lib/studio-shell-state.ts`
  - fonte canonica de estado, breakpoints, persistencia e medidas semanticas
- `lib/sidebar-navigation.ts`
  - fonte canonica de grupos, labels, icones, URLs e active state

## Code Removed

O lote removeu o shell anterior ja substituido pelo piloto:

- `components/layout/header.tsx`
- `components/layout/sidebar.tsx`
- `components/ui/use-mobile.tsx`

Tambem foram removidos:

- imports legados desses arquivos
- duplicacao de `MOBILE_BREAKPOINT`
- wrappers locais repetidos de pagina com `flex-1 overflow-auto p-6`

## Canonical State Contract

`lib/studio-shell-state.ts` e a unica fonte canonica para:

- `desktopPreference`
- `effectiveMode`
- `lastVisibleMode`
- defaults por viewport
- breakpoints aprovados
- chaves de persistencia
- validacao de valores persistidos

Na consolidacao final do H-C, a inicializacao client-safe do shell passou a usar snapshots com `useSyncExternalStore` em `components/layout/studio-shell.tsx` para:

- ler viewport sem bootstrap imperativo no corpo de `useEffect`
- manter hydration segura com snapshot de servidor estavel
- ler preferencia persistida e `lastVisibleMode` sem duplicar um segundo fluxo de inicializacao

Contrato oficial:

- `<= 768px` -> `mobile-drawer`
- `769px-1279px` -> `compact` efetivo
- `>= 1280px` -> preferencia desktop respeitada

Estados preservados:

- `expanded`
- `compact`
- `hidden`
- `mobile-drawer`

Persistencia continua local:

- `studio-shell-desktop-preference`
- `studio-shell-last-visible-mode`

## Canonical Navigation Contract

`lib/sidebar-navigation.ts` e a unica fonte canonica de navegacao do rail:

- grupos aprovados: `Workspace`, `Criacao`, `Bibliotecas`
- destinos aprovados: `Dashboard`, `Projetos`, `Conteudos`, `Imagens`, `Videos`, `Galeria`, `Arquivos`
- `Configurações` permanece fora do rail
- active state continua derivado da rota atual
- icones passam a viver junto do contrato de navegacao

## Width, Offset, and Surface Contract

As medidas relevantes do shell foram centralizadas em `lib/studio-shell-state.ts`:

- top utility bar height: `3.125rem` (`50px`)
- expanded rail width: `9.5rem`
- compact rail width: `3.25rem`
- mobile drawer width: `11.75rem`
- mobile drawer viewport cap: `56vw`
- rail top offset: `3.75rem`
- rail max height: `calc(100svh - 4.5rem)`
- rail radius: `1.25rem`
- page padding: `1.5rem`

Contrato estrutural preservado:

- wrapper estrutural transparente
- rail desktop como unica superficie visual lateral
- `main` ocupa a largura restante
- em `hidden`, `main` ocupa toda a largura util
- slot central da utility bar preservado para busca futura sem implementacao

## Scroll Contract

O shell passa a assumir um contrato explicito de scroll:

- `document/body`
  - sem overflow estrutural horizontal aprovado no smoke
- `main`
  - `overflow-y-auto`
  - `overflow-x-hidden`
  - scrollbar principal permanece no canto direito
- rail desktop
  - scroll interno proprio quando necessario
  - sem induzir scroll global indevido
- drawer mobile
  - superficie unica com scroll interno quando necessario
- top utility bar
  - permanece estavel

Para reduzir variacao entre rotas, o wrapper `DashboardPage` substitui wrappers locais repetidos e padroniza o container principal.

## Mobile Contract

Contrato preservado do DS-1H-B:

- drawer convencional
- largura final aprovada
- labels visiveis
- sem compact mode no mobile
- sem `Configurações` no drawer
- fechamento por navegacao
- fechamento por `Esc`
- clique fora
- retorno de foco ao trigger global
- overlay e empilhamento funcionais

## Accessibility Notes

Validacoes confirmadas nesta rodada:

- `banner`, `main` e navegacao presentes como landmarks
- `aria-current` preservado pelo active state canonico
- tooltips preservados no compact
- trigger global unico
- drawer responde a `Esc`
- foco retorna ao trigger apos fechamento do drawer
- navegacao continua acionavel por teclado
- sem branch estrutural por tema

## Route Validation

Smoke transversal executado em:

- `/dashboard`
- `/projetos`
- `/projetos/[id]` via URL real existente
- `/projetos/[id]/producoes/[productionId]` via URL real existente
- `/conteudos`
- `/posts`
- `/imagens`
- `/videos`
- `/galeria`
- `/arquivos`
- `/configuracoes`

Resultados estruturais observados:

- shell carregado em todas as rotas auditadas
- top utility bar global presente
- active state correto para as areas canonicas do rail
- `Configurações` continua global, fora do rail
- sem overflow horizontal estrutural nos smokes executados
- paginas especiais (`posts`, detalhe de projeto, workspace de producao) mantiveram seus headers locais e conteudo proprio

## Responsive Validation

Larguras auditadas:

- `1600`
- `1280`
- `1024`
- `769`
- `768`
- `390`

Resultados principais:

- `1600` e `1280`
  - `expanded`, `compact` e `hidden` ativos sem shell paralelo
- `1024` e `769`
  - `expanded` persistido degrada para `compact` efetivo como aprovado
- `768` e `390`
  - drawer mobile ativo com rail desktop removido da composicao visivel
- nos smokes executados nao houve overflow horizontal estrutural

## Theme Validation

Validacao estrutural executada em:

- `Light`
- `Dark`
- `Studio Balanced`

Spot-check executado em:

- `Studio Soft`
- `Studio Expressive`

Resultado:

- o mesmo shell oficial permaneceu ativo em todos os temas
- nao foi identificado branch estrutural por tema
- a rodada nao reabriu sombras, tipografia ou calibracao visual sistemica

## Test and Verification

Executado nesta rodada:

- testes direcionados
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm lint`
- `git diff --check`
- smoke manual transversal em browser autenticado

Resultado:

- `pnpm test`: aprovado
- `pnpm typecheck`: aprovado
- `pnpm build`: aprovado
- `pnpm lint`: sem erros bloqueantes do lote; warnings globais permaneceram fora do escopo de DS-1H-C
- `git diff --check`: sem erro estrutural de diff; apenas avisos locais de fim de linha no ambiente Windows

## Limitations

- a verificacao de scroll permaneceu focada em comportamento estrutural, nao em polimento visual por pagina
- `posts`, detalhe de projeto e workspace de producao continuam com peculiaridades locais esperadas e fora de redesign nesta rodada
- existe um item local nao versionado em `docs/product/ux/design-system/labs/` fora da lista ideal de artefatos locais permitidos; ele nao foi tocado por DS-1H-C

## Deferred

Permanece deferido para lotes posteriores:

- implementacao da Global Search / Command Palette
- qualquer redesign de pagina ou toolbar
- ajustes visuais especificos de `Posts`
- ajustes visuais especificos de project detail
- overlays e refinamentos amplos de superficie
- evolucoes posteriores de shell em DS-1H-D / DS-1H-E
