# DS-1B Token Infrastructure

## Objetivo
Implementar a infraestrutura tecnica de tokens e o mecanismo unico de tema para sustentar os proximos lotes do DS-1 sem iniciar migracao visual ampla.

## Estado anterior
- `app/globals.css` continha apenas a camada tecnica de variaveis do shadcn em `:root` e `.dark`
- o layout raiz fixava `dark` no `<html>`
- `next-themes` ja estava instalado, mas nao era a fonte de verdade do app
- Configuracoes alterava tema com `document.documentElement.classList` e `localStorage` manual
- nao existiam tokens semanticos de produto expostos ao Tailwind v4

## Arquitetura implementada
- **Layer 1 - Foundation scales**: atmosfera placeholder, elevacao e geometria minima
- **Layer 2 - Semantic product tokens**: canvas, superficies, texto, bordas, acoes, estados
- **Layer 3 - Theme mappings**: `:root` e `.dark` continuam como mappings ativos
- **Layer 4 - Component tokens**: nenhum novo token de componente criado nesta rodada
- **Layer 5 - shadcn compatibility aliases**: aliases tecnicos preservados e sem ciclos

## Direcao adotada
Nesta rodada, os **tokens do produto apontam para os valores atuais do shadcn** sempre que isso preserva o baseline visual.
Isso reduz risco, evita ciclos entre variaveis CSS e deixa a camada semantica pronta para consumo futuro sem exigir migracao ampla agora.

## Variaveis criadas

### Superficies
- `--canvas`
- `--surface`
- `--surface-subtle`
- `--surface-elevated`
- `--surface-overlay`
- `--surface-translucent`
- `--surface-interactive`
- `--surface-selected`

### Texto
- `--text-primary`
- `--text-secondary`
- `--text-muted`
- `--text-disabled`
- `--text-inverse`
- `--text-link`

### Bordas, selecao e foco
- `--border-subtle`
- `--border-default`
- `--border-emphasis`
- `--border-selected`
- `--border-danger`
- `--border-focus`
- `--focus-ring`
- `--selection-background`
- `--selection-foreground`

### Acoes
- `--action-primary`
- `--action-primary-hover`
- `--action-primary-foreground`
- `--action-secondary`
- `--action-secondary-hover`
- `--action-secondary-foreground`
- `--action-ghost-hover`
- `--action-destructive`
- `--action-destructive-hover`

### Estados
- `--success`
- `--success-foreground`
- `--warning`
- `--warning-foreground`
- `--danger`
- `--danger-foreground`
- `--info`
- `--info-foreground`
- `--unavailable`
- `--disabled`

### Atmosfera placeholder
- `--atmosphere-primary`
- `--atmosphere-secondary`
- `--grid-color`
- `--glow-soft`
- `--glow-strong`

### Elevacao e geometria minima
- `--elevation-low`
- `--elevation-medium`
- `--elevation-high`
- `--radius-control`
- `--radius-card`
- `--radius-panel`
- `--radius-modal`
- `--control-height`
- `--dense-control-height`

## Compatibilidade shadcn
As variaveis abaixo foram preservadas como camada tecnica:
- `--background`
- `--foreground`
- `--card`
- `--card-foreground`
- `--popover`
- `--popover-foreground`
- `--primary`
- `--primary-foreground`
- `--secondary`
- `--secondary-foreground`
- `--muted`
- `--muted-foreground`
- `--accent`
- `--accent-foreground`
- `--destructive`
- `--border`
- `--input`
- `--ring`
- `--sidebar-*`

Os aliases `--color-*` ja usados pelo shadcn/Tailwind v4 permaneceram e foram complementados com aliases semanticos como `--color-canvas`, `--color-surface`, `--color-text-primary`, `--color-border-subtle`, `--color-focus-ring` e correlatos.

## Mecanismo de tema

### Fonte unica de verdade
`next-themes` passou a ser a fonte unica de verdade do tema na interface.

### Integracao
- `ThemeProvider` integrado ao layout raiz
- `ThemePreferenceBootstrap` integrado ao layout autenticado do dashboard
- `<html>` sem classe `dark` fixa
- `suppressHydrationWarning` no layout
- `attribute="class"`
- `defaultTheme="dark"`
- `enableSystem`
- `disableTransitionOnChange`

### Persistencia
- persistencia de tema delegada ao `next-themes`
- remocao de `localStorage` manual relacionado ao tema
- `user_settings.theme` permanece como espelho persistido no backend, atualizado no ato de salvar Configuracoes
- a chave de persistencia local do provider foi explicitada como `theme`

### Hidratacao
- o layout usa configuracao segura para App Router
- o bootstrap remoto nao bloqueia a renderizacao
- Configuracoes espera a montagem antes de refletir o valor ativo nos botoes do seletor
- a preferencia remota nao reaplica o tema em toda montagem; ela so pode inicializar a sessao quando nao existir preferencia local valida
- ausencia temporaria de sessao nao conta como bootstrap concluido

## Configuracoes de Aparencia
- o seletor continua expondo apenas `light`, `dark` e `system`
- a pagina passou a usar `useTheme`
- foram removidas manipulacoes manuais de `classList`
- o tema salvo em configuracoes continua persistido em `user_settings`, mas a aplicacao do tema na UI ocorre via `next-themes`
- a pagina de Configuracoes nao executa mais bootstrap remoto
- precedencia adotada:
  - se `next-themes` ja tiver uma preferencia local valida, ela vence
  - se nao existir preferencia local valida, `user_settings.theme` pode inicializar a UI quando for `light`, `dark` ou `system`
  - se nenhum valor valido existir, permanece o `defaultTheme="dark"`
- apos mudanca explicita do usuario, o tema e atualizado imediatamente no `next-themes` e o mesmo valor segue para `user_settings` no salvamento

## Bootstrap autenticado
- o bootstrap remoto mora no layout autenticado do dashboard, nao no `ThemeProvider` e nao em Configuracoes
- antes de consultar o backend, ele verifica `THEME_STORAGE_KEY`
- se a preferencia local for valida, o bootstrap encerra sem consultar ou aplicar valor remoto
- se a preferencia local estiver ausente ou invalida, o bootstrap aguarda autenticacao resolvida e consulta `user_settings.theme` para o usuario autenticado atual
- a aplicacao remota aceita apenas `light`, `dark` ou `system`
- a consulta remota ocorre no maximo uma vez por usuario autenticado em cada montagem
- falhas de consulta nao contam como sucesso silencioso e geram `console.error`

## Correcao de bootstrap
- uma versao intermediaria do DS-1B marcava o bootstrap como concluido cedo demais, antes de a autenticacao estar resolvida
- isso permitia o fluxo: layout autenticado monta, `getUser()` ainda nao devolve usuario, o efeito encerra, e a preferencia remota nunca mais e tentada naquele ciclo
- havia tambem uma janela de corrida entre a leitura inicial da autenticacao e o registro do listener de auth
- a correcao moveu a decisao para um orquestrador que diferencia:
  - aguardando autenticacao
  - aguardando usuario autenticado
  - preferencia local valida
  - consulta remota aplicada
  - consulta remota sem valor valido
  - falha de consulta observavel
- o bootstrap agora registra `onAuthStateChange` antes de consultar `getSession()`, reduzindo o risco de perder a disponibilidade da sessao logo apos o login

## Smoke humano final
- smoke humano aprovado para o contrato funcional do DS-1B
- fluxo observado:
  - novo navegador abre a tela de login em `dark`, o que permanece aceitavel por ausencia de usuario autenticado
  - apos autenticacao, a preferencia remota `light` e lida de `user_settings.theme` e aplicada ao layout autenticado
- nao foram observados hydration errors nesse fluxo
- `Studio` permaneceu ausente e nao selecionavel

## Limitacao residual deferida
- foi observado um flash breve pos-login, com permanencia aproximada de 1 segundo em `dark` antes da aplicacao de `light`
- essa limitacao foi conscientemente deferida nesta rodada e nao bloqueia a aprovacao do DS-1B
- uma eliminacao futura desse flash nao deve introduzir:
  - hydration mismatch
  - bloqueio excessivo de renderizacao
  - nova fonte de verdade para tema
- a fase mais adequada para reavaliar esse refinamento e o DS-1C, durante a consolidacao do baseline `light` e `dark`

## Light, dark e system
- **light**: suportado pelo provider e pelo mapping atual
- **dark**: continua equivalente ao baseline anterior, sem depender de classe fixa no HTML
- **system**: continua disponivel na experiencia, agora resolvido pelo `next-themes`

## Studio nesta rodada
Studio continua:

```text
PROPOSED - NO CURRENT CODE SUPPORT
```

Nesta rodada:
- nao foi incluido no seletor
- nao foi incluido na lista de temas do provider
- nao ganhou paleta definitiva
- nao ganhou glow, glass ou dot grid visiveis
- recebeu apenas preparacao estrutural indireta pela existencia dos tokens semanticos e dos placeholders de atmosfera

## Arquivos alterados
- `app/globals.css`
- `app/layout.tsx`
- `app/(dashboard)/layout.tsx`
- `app/(dashboard)/configuracoes/page.tsx`
- `components/theme-preference-bootstrap.tsx`
- `components/theme-provider.tsx`
- `lib/theme.ts`
- `lib/theme-bootstrap.ts`
- `lib/__tests__/theme-infrastructure.test.ts`
- `docs/product/ux/design-system/README.md`
- este documento

## Testes e checks
- teste direcionado novo para helpers de tema, tokens obrigatorios, integracao do provider e remocao do mecanismo manual
- checks previstos para esta rodada:
  - `pnpm test -- --run lib/__tests__/theme-infrastructure.test.ts`
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm lint`, somente se funcional

## Limites desta rodada
- sem migracao ampla de classes
- sem redesenho de paginas
- sem alteracao de anatomias, hierarquia, responsividade ou comportamento do UX-H4
- sem exposicao de Studio ao usuario
- sem paleta Studio final
- sem migracao de `StatusBadge`, `StateMessage`, sidebar, header, cards ou paginas

## Pendencias para DS-1C
- validar baseline light e dark com consumo local dos novos tokens
- comecar a substituir usos futuros por classes semanticas de forma controlada

## Pendencias para DS-1D
- definir mecanismo tecnico final de ativacao de Studio
- mapear paleta definitiva, atmosfera, glow e eventuais limites de translucidez
