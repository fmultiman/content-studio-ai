# Foundation Audit (DS-1A)

## Estado atual
A aplicação encontra-se estruturada sobre Tailwind CSS V4 e shadcn/ui.
Os tokens CSS atuais residem em `app/globals.css`. Todo o mapeamento de variáveis é importado via `@theme inline` padrão do Tailwind v4. 
A auditoria constatou extrema disciplina na ausência de cores utilitárias diretas (ex: `bg-red-500` não existe na codebase), tudo é derivado de tokens base ou extensões semânticas.

## Valores encontrados

### Cores (Variáveis CSS existentes no shadcn)
- **Backgrounds**: `--background`, `--card`, `--popover`, `--sidebar`
- **Textos**: `--foreground`, `--card-foreground`, `--muted-foreground`, `--primary-foreground`, `--sidebar-foreground`
- **Bordas e Rings**: `--border`, `--input`, `--ring`, `--sidebar-border`, `--sidebar-ring`
- **Ações / Estados**: `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`
- **Charts**: `--chart-1` a `--chart-5`

A declaração é feita primariamente usando a notação moderna `oklch`.

### Tipografia
- **Font-families**: Usando `'Geist'` para sans-serif e `'Geist Mono'` para monospace.
- **Tamanhos e Pesos**: Tailwind defaults base (e.g., `text-sm`, `text-xs`, `font-semibold`).

### Espaçamento e Geometria
- **Radius**: `--radius` base em `0.625rem` (`10px`). Com variações sm (6px), md (8px), lg (10px), xl (14px).

## Duplicações
- **Tokens de Sidebar vs Base**: Atualmente há forte sobreposição semântica entre `--sidebar` / `--sidebar-foreground` e `--background` / `--foreground`, ou `--sidebar-border` e `--border`.
- **Ações secundárias**: `--secondary` e `--muted` compartilham valores quase idênticos no modo light.

## Hardcoded Values
- **Cores**: Ausência quase total de cores hardcoded na sintaxe arbitrária do Tailwind (nenhum `bg-[#xxx]`). Exceção: `bg-black/70` e `text-white/85` em modais de vídeo específicos.
- **Tipografia**: Encontrados valores diretos injetados via arbitrários como `text-[0.68rem]`, `text-[10px]`, `text-[9px]`, `text-[11px]`, `text-[0.8rem]` especialmente em metadados (`channel-piece-media-section.tsx`, `media-picker-dialog.tsx`, calendário e badges pequenos).
- **Bordas**: Uso ocasional de espessura de borda arbitrária como `border-[1.5px]` em gráficos.

## Compatibilidade shadcn
O ecossistema utiliza as variáveis oficiais padrão do shadcn/ui. O Tailwind V4 mapeia automaticamente essas propriedades em utilitários funcionais.
Qualquer mudança na paleta fundamental precisará respeitar o formato `oklch(l c h)` ou estender os papéis sem quebrar componentes nativos (como o Popover, Card, Input).

## Riscos
- Substituir as cores e sintaxe de variáveis pode quebrar a paleta Tailwind v4 embutida.
- A migração de tamanhos `text-[10px]` para tokens `caption` ou `micro` precisa de readequação e teste visual para não estourar badges densos.
- Há a ausência de tokens para os estados *Warning*, *Success* e *Info*, que o produto já necessita para os `StatusBadge` e `StateMessage` mapeados no UX-H4. O sistema usa apenas `--destructive`.
