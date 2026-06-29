# DS-1C Light and Dark Baseline

## Objetivo
Estabelecer o baseline visual formal de `light` e `dark` usando a infraestrutura semantica do DS-1B, sem iniciar Studio e sem fazer migracao ampla de paginas ou componentes de dominio.

## Estado anterior
- o DS-1B havia criado a infraestrutura de tokens, o `ThemeProvider` unico e o bootstrap remoto da preferencia autenticada
- `light` e `dark` continuavam proximos ao baseline herdado do shadcn
- a aplicacao ainda apresentava pouca separacao visual entre canvas, shell, superficies, cards e controles
- a auditoria inicial mostrou que esse colapso de hierarquia aparecia com mais nitidez em rotas com listas densas e midia real

## Auditoria visual inicial

### Rotas auditadas
- Dashboard
- Projetos
- Projeto detail
- Production
- Imagens
- Videos
- Galeria
- Arquivos
- Configuracoes

### Larguras auditadas
- `1600`
- `1280`
- `1024`
- `768`
- `390`

### Matriz de problemas
| Area | Light atual | Dark atual | Problema | Token responsavel | Correcao proposta |
| --- | --- | --- | --- | --- | --- |
| Canvas geral | branco muito proximo das superficies | massa escura uniforme | falta de degrau entre fundo e conteudo | `canvas`, `surface` | separar canvas do primeiro plano sem trocar anatomia |
| Shell autenticado | header e sidebar quase somem sobre o fundo | header e sidebar colapsam com cards | shell perde presenca estrutural | `surface-translucent`, `border-subtle`, `elevation-low` | dar contraste suave e borda funcional |
| Cards base | card branco sobre canvas branco | card quase no mesmo valor do canvas | cards deixam de organizar leitura | `surface`, `surface-elevated`, `border-default` | reforcar plano base e elevacao minima |
| Inputs e selects | controle pouco distinguivel do fundo | campo escuro com pouca delimitacao | controles ficam lavados ou colapsados | `surface-interactive`, `border-default` | dar preenchimento e hover leves |
| Tabs | lista e trigger com pouco contraste | lista e trigger viram uma unica massa | navegacao secundaria perde hierarquia | `surface-subtle`, `surface`, `text-muted`, `border-default` | separar trilho, item ativo e item inativo |
| Dialog e overlay | modal correto, mas overlay discreto demais | overlay e painel pouco estratificados | profundidade insuficiente em camadas temporarias | `surface-overlay`, `surface-elevated`, `elevation-high` | reforcar profundidade sem glow |
| Toast destrutivo | vermelho dominante demais | vermelho pesado demais | feedback ganha peso desproporcional ao baseline | `danger`, `border-danger`, `surface-elevated` | manter destaque sem bloco solido |
| Texto secundario e muted | muted claro demais em algumas superficies | muted escuro demais em algumas superficies | perda de legibilidade auxiliar | `text-secondary`, `text-muted`, `text-disabled` | aproximar texto auxiliar do contraste util |
| Galeria e Arquivos com midia | miniaturas e cards disputam com branco do canvas | miniaturas se perdem em massa escura | midia real evidencia falta de estratificacao | `canvas`, `surface`, `surface-subtle` | reforcar degraus sem redesenhar cards |

## Direcao visual adotada

### Light
- clareza editorial
- superficies distinguiveis sem cair em branco puro total
- bordas discretas, mas visiveis
- leitura densa e profissional
- shell presente sem parecer barra decorativa

### Dark
- canvas escuro estratificado
- superficies diferenciaveis em mais de um degrau
- bordas perceptiveis
- profundidade por tom e sombra leve, nao por glow
- conforto para sessoes longas

### Relacao entre temas
- mesma anatomia
- mesma hierarquia
- mesmos papeis semanticos
- mesma acessibilidade
- mesma responsividade

## Tokens refinados

### Canvas e superficies
- `--canvas`
- `--surface`
- `--surface-subtle`
- `--surface-elevated`
- `--surface-overlay`
- `--surface-translucent`
- `--surface-interactive`

### Texto
- `--text-primary`
- `--text-secondary`
- `--text-muted`
- `--text-disabled`

### Bordas, foco e selecao
- `--border-subtle`
- `--border-default`
- `--border-emphasis`
- `--focus-ring`
- `--selection-background`
- `--selection-foreground`

### Elevacao
- `--elevation-low`
- `--elevation-medium`
- `--elevation-high`

## Aliases shadcn afetados
O baseline continuou na direcao definida no DS-1B:

```text
tokens semanticos do produto -> aliases tecnicos do shadcn/Tailwind v4
```

Os seguintes aliases tecnicos receberam refinamento indireto por valor:
- `--background`
- `--foreground`
- `--card`
- `--popover`
- `--secondary`
- `--muted`
- `--accent`
- `--border`
- `--input`
- `--ring`
- `--sidebar-background`
- `--sidebar-border`
- `--sidebar-accent`

Nenhum ciclo novo entre variaveis foi introduzido.

## Correcoes locais minimas
- `sidebar` e `header`: passaram a usar superficie translucida, borda semantica e elevacao baixa
- `card` base: passou a usar `border-border-default` e `shadow-elevation-low`
- `dialog`: overlay e painel passaram a responder ao baseline semantico
- `tabs`: trilho e trigger ativo ganharam separacao coerente com o baseline
- `input`, `textarea` e `select`: controles passaram a usar `surface-interactive`
- `toast` radix: estado destrutivo foi suavizado para nao dominar a hierarquia

## Rotas e elementos validados
- Dashboard
- Projetos
- Projeto detail
- Production
- Galeria
- Arquivos
- Configuracoes
- modal
- inputs
- select
- tabs
- toast
- foco
- loading e estado carregado em Galeria e Arquivos
- conteudo abaixo da primeira dobra em Production, Galeria e Arquivos

## Larguras validadas
- `1600`
- `1280`
- `1024`
- `768`
- `390`

## Contraste e acessibilidade
- texto primario, secundario e muted permaneceram legiveis em `light` e `dark`
- bordas funcionais ficaram perceptiveis sem endurecer demais a UI
- foco continuou visivel em modal e controles
- selecao de texto ganhou cores semanticas em ambos os temas
- overlays e dialogs passaram a ter separacao mais clara
- links, estados e acoes continuaram distinguiveis sem redesenho de DOM

## Diferencas visuais
- `light` deixou de colapsar canvas, shell e cards em uma massa branca unica
- `dark` deixou de aproximar canvas, shell, cards e overlays do mesmo preto/cinza
- Galeria e Arquivos com midia real passaram a mostrar melhor separacao entre conteudo visual e superficie do app
- o baseline permaneceu contido: sem glow, sem glass generalizado e sem visual gamer

## Flash pos-login
- o flash breve `dark -> light` apos login permanece como limitacao residual herdada do DS-1B
- nao houve ampliacao do problema nesta rodada
- a eliminacao desse flash continua melhor avaliada em rodada futura sem introduzir nova fonte de verdade, hydration mismatch ou bloqueio excessivo

## STRUCTURAL ISSUE - OUT OF DS-1C SCOPE
- **problema**: compressao estrutural do shell e da area util em `390px`
- **rotas afetadas observadas**: Dashboard, Galeria e Arquivos
- **largura observada**: `390px`
- **evidencia de que nao e problema de token**:
  - a compressao aparece mesmo quando o baseline cromatico melhora
  - o problema se manifesta na distribuicao estrutural do shell e da area de conteudo, nao no contraste entre superficies
  - a mesma limitacao aparece em telas com e sem midia real
- **risco transversal**: pode afetar densidade, ergonomia e leitura em multiplas rotas autenticadas
- **recomendacao**: tratar em rodada dedicada de shell/responsividade antes ou durante o DS-1H

## Riscos e limites
- `components/ui/sonner.tsx` foi alinhado ao baseline, mas o app atual usa o toaster radix em `components/ui/toast.tsx`
- o baseline nao migrou familias de cards de dominio, `StatusBadge`, `StateMessage`, `ContextMetadata` ou `PageHeader`
- `violet/cyan` locais foram preservados quando atuam como brand accent util e nao quebram contraste
- nenhuma paleta Studio foi iniciada

## Itens deferidos para DS-1D
- identidade visual Studio
- atmosfera definitiva
- glow
- glass
- ativacao visual do tema Studio

## Itens deferidos para DS-1E
- controles e indicadores de dominio
- revisao visual especifica de badges, estados e acoes contextualizadas

## Itens deferidos para DS-1H
- piloto de adocao ampla
- revisao transversal de shell/responsividade em mobile estreito
- eventuais ajustes finos de hierarquia fora das primitivas base

## Arquivos alterados
- `app/globals.css`
- `components/layout/header.tsx`
- `components/layout/sidebar.tsx`
- `components/ui/card.tsx`
- `components/ui/dialog.tsx`
- `components/ui/input.tsx`
- `components/ui/select.tsx`
- `components/ui/sonner.tsx`
- `components/ui/tabs.tsx`
- `components/ui/textarea.tsx`
- `components/ui/toast.tsx`
- `docs/product/ux/design-system/README.md`
- este documento

## Validacao executada
- smoke visual em `light` e `dark`
- validacao com midia real em Galeria e Arquivos
- verificacao de conteudo abaixo da primeira dobra
- verificacao de modal, tabs, inputs, select, toast e foco
- verificacao de console sem novos erros
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build` para registrar o estado do baseline dentro das limitacoes do ambiente
