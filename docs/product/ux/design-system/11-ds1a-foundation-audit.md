# Foundation Audit (DS-1A)

## Estado atual
A aplicacao esta estruturada sobre Tailwind CSS v4 e shadcn/ui.
Os tokens CSS atuais residem em `app/globals.css`, com mapeamento via `@theme inline`.
O codigo usa majoritariamente os tokens tecnicos do shadcn nas primitivas (`bg-background`, `text-foreground`, `border-border`, `bg-card`), mas ainda convive com muitas decisoes locais de produto em shell, cards, estados e CTA. Portanto, a base atual nao pode ser descrita como "somente tokens base ou extensoes semanticas".

## Valores encontrados

### Cores (variaveis CSS existentes no shadcn)
- **Backgrounds**: `--background`, `--card`, `--popover`, `--sidebar`
- **Textos**: `--foreground`, `--card-foreground`, `--muted-foreground`, `--primary-foreground`, `--sidebar-foreground`
- **Bordas e rings**: `--border`, `--input`, `--ring`, `--sidebar-border`, `--sidebar-ring`
- **Acoes / estados**: `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`
- **Charts**: `--chart-1` a `--chart-5`

A declaracao e feita em `oklch`.
Os unicos escopos de tema confirmados no codigo atual sao `:root` e `.dark` em `app/globals.css`.

### Tipografia
- **Font families**: `'Geist'` para sans-serif e `'Geist Mono'` para monospace em `app/globals.css`, com carregamento tambem em `app/layout.tsx`.
- **Padrao dominante**: `text-xs`, `text-sm`, `text-base`, `text-2xl`, `text-3xl`, `font-medium`, `font-semibold`.
- **Excecoes concretas**:
  - `components/layout/sidebar.tsx`: `text-[0.68rem]`
  - `components/publication/channel-piece-media-section.tsx`: `text-[10px]`
  - `components/publication/media-picker-dialog.tsx`: `text-[9px]`, `text-[10px]`, `text-[11px]`
  - `components/ui/calendar.tsx`: `text-[0.8rem]`

### Espacamento e geometria
- **Radius base**: `--radius` em `0.625rem` (`10px`) com variacoes `sm`, `md`, `lg`, `xl` em `app/globals.css`
- **Padroes dominantes**: `rounded-md`, `rounded-lg`, `rounded-xl`
- **Excecoes concretas**:
  - `components/ui/checkbox.tsx`: `rounded-[4px]`
  - `components/ui/chart.tsx`: `rounded-[2px]`
  - `components/ui/tabs.tsx`: `p-[3px]`
- **Max-widths e dimensoes locais recorrentes**:
  - `max-w-3xl`, `max-w-4xl`, `max-w-5xl`, `max-w-7xl`
  - `w-[210px]`, `w-[180px]`, `min-w-[180px]`, `min-w-[240px]`
  - `h-16`, `h-9`, `h-8`, `max-h-[90vh]`

### Elevacao e translucidez
- **Primitivas shadcn**:
  - `components/ui/card.tsx`: `shadow-sm`
  - `components/ui/dialog.tsx`, `components/ui/alert-dialog.tsx`, `components/ui/dropdown-menu.tsx`: `shadow-lg`
  - `components/ui/chart.tsx`: `shadow-xl`
- **Padrao dominante nas superficies do produto**:
  - `border-border/50 bg-card/30 backdrop-blur-sm`
  - Repetido em `components/layout/header.tsx`, `components/layout/sidebar.tsx`, `components/projects/project-list.tsx`, `app/(dashboard)/configuracoes/page.tsx`, `app/(dashboard)/imagens/page.tsx`, `app/(dashboard)/videos/page.tsx` e varias outras superficies

### Motion
- **Primitivas shadcn**: animacoes de `dialog`, `alert-dialog`, `dropdown-menu`, `sheet`, `toast`
- **Produto**: `transition-all`, `transition-colors`, `transition-opacity` e `transition-transform` em navegacao, cards interativos e grids selecionaveis
- **Exemplos concretos**:
  - `components/layout/sidebar.tsx`
  - `components/projects/project-list.tsx`
  - `components/dashboard/continuation-hub.tsx`
  - `app/(dashboard)/posts/page.tsx`

## Duplicacoes e padroes dominantes
- **Tokens de sidebar vs base**: ha sobreposicao entre `--sidebar*` e os papeis base `--background`, `--foreground`, `--border`
- **Acoes secundarias**: `--secondary` e `--muted` compartilham valores quase identicos no modo light
- **Superficie translucida repetida fora de token**: o trio `border-border/50 bg-card/30 backdrop-blur-sm` funciona hoje como pseudo-semantica de painel do produto
- **Brand accents repetidos fora de token**: gradientes `from-violet-600 to-cyan-500` e estados `violet`, `cyan`, `amber`, `emerald` aparecem em CTA, sidebar, badges, callouts e selecoes

## Hardcoded values
- **Hex arbitrario**: nao foram encontrados `bg-[#...]` ou `text-[#...]` nas amostras lidas
- **Cores utilitarias diretas**: existem muitas ocorrencias de `violet-*`, `cyan-*`, `amber-*`, `emerald-*`, `white` e `black` fora da camada de token
- **Exemplos concretos**:
  - `components/layout/sidebar.tsx`
  - `components/layout/header.tsx`
  - `components/ui/status-badge.tsx`
  - `components/ui/state-message.tsx`
  - `components/projects/project-form.tsx`
  - `app/(dashboard)/configuracoes/page.tsx`
  - `app/(dashboard)/posts/page.tsx`
- **Tipografia arbitraria**: `text-[0.68rem]`, `text-[10px]`, `text-[9px]`, `text-[11px]`, `text-[0.8rem]`
- **Bordas e tamanhos arbitrarios**: `border-[1.5px]`, `rounded-[2px]`, `rounded-[4px]`, `p-[3px]`

## Compatibilidade shadcn
O ecossistema usa as variaveis padrao do shadcn/ui e o Tailwind v4 as mapeia para utilitarios funcionais.
Qualquer mudanca precisa preservar compatibilidade tecnica com primitivas como `Button`, `Input`, `Card`, `Dialog`, `Tabs`, `DropdownMenu` e `Sidebar`.
Ao mesmo tempo, o produto nao cabe apenas nos papeis genericos do shadcn: `StatusBadge`, `StateMessage`, shells translucidos, CTA com gradiente e estados de selecao dependem hoje de classes utilitarias especificas do produto.

## Temas encontrados no codigo
- **Confirmado**: `:root` + `.dark` em `app/globals.css`
- **Infra de biblioteca presente, mas nao integrada**:
  - `components/theme-provider.tsx` usa `next-themes`
  - `components/ui/sonner.tsx` consome `useTheme`
- **Nao confirmado na aplicacao atual**:
  - `.theme-studio`
  - `[data-theme="studio"]`
  - qualquer mapping especifico para Studio
- **Risco tecnico atual**:
  - `app/layout.tsx` fixa `className="dark bg-background"` no `<html>`
  - `app/(dashboard)/configuracoes/page.tsx` troca classes manualmente no `document.documentElement` apenas entre `light`, `dark` e `system`

## Riscos de migracao
- Tratar cor utilitaria direta como excecao pequena subestima o tamanho real da migracao; hoje ela sustenta CTA, selecao, status e callouts do produto
- A migracao de tamanhos `text-[10px]` e similares para roles tipograficos exigira teste visual em badges, chips e media pickers densos
- Ha ausencia de tokens de estado para `warning`, `success` e `info` em `globals.css`, embora `StatusBadge` e `StateMessage` ja usem essas semanticas no codigo
- O produto usa translucidez e blur como linguagem dominante em varias superficies; sem decidir se isso vira token semantico ou excecao controlada, DS-1B corre o risco de apenas renomear classes
- O tema Studio ainda nao existe tecnicamente; juntar seu mapping com rollout de componentes e QA global no mesmo lote aumenta o risco de regressao
