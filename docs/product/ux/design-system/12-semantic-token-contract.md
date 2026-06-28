# Semantic Token Contract (DS-1A)

## Arquitetura em camadas
A arquitetura de tokens seguira um formato pragmatico de 4 camadas, mantendo compatibilidade tecnica com Tailwind e shadcn/ui sem confundir essa compatibilidade com a semantica completa do produto.

- **Layer 1 - Foundation / Scale Tokens**: escalas fisicas aprovadas pelo DS. Incluem neutros, brand accents, estados, tipografia, radius, elevacao, motion e espacamento. Nao significam "adotar toda a escala padrao do Tailwind"; cada familia precisa declarar subconjunto permitido e excecoes.
- **Layer 2 - Semantic Tokens**: o nucleo do Design System. Representam funcao (`--canvas`, `--surface-translucent`, `--border-default`, `--warning`).
- **Layer 3 - Theme Mappings**: os valores aplicados nas classes de modo (`.dark`, futuro `studio` ou equivalente) alterando as mesmas variaveis sem mudar DOM, anatomia ou responsividade.
- **Layer 4 - Component Tokens**: restrito. So entram quando a camada semantica nao consegue expressar a necessidade sem vazar acoplamento para outras familias. O ponto de partida e preservar os tokens tecnicos do shadcn ja existentes, como `--sidebar-*`.

## Compatibilidade tecnica vs semantica do produto

### Camada de compatibilidade shadcn
Esta camada existe para manter primitivas como `Button`, `Input`, `Card`, `Dialog`, `Tabs`, `DropdownMenu` e `Sidebar` funcionando com utilitarios padrao (`bg-background`, `text-foreground`, `border-border`, `bg-popover`, `ring-ring`).

### Camada semantica do Content Studio
Esta camada expressa a linguagem real do produto e nao pode depender apenas de `--background`, `--foreground`, `--card`, `--muted` e `--accent`.
O produto ja exige papeis mais especificos para:
- canvas vs superficie translucida
- texto principal vs descricao vs metadata vs inverse
- borda estrutural vs borda de enfase vs foco
- CTA principal do Studio vs acao secundaria neutra
- info, success, warning e danger
- selecao, destaque e estados de colecao/workspace

## Taxonomia e nomenclatura
A camada semantica estende a base atual do shadcn e adiciona os papeis exigidos pelo UX-H4.

### Canvas e superficies
| Nomenclatura | Responsabilidade | Status shadcn |
| --- | --- | --- |
| `canvas` | Fundo principal da aplicacao | Mapeia para `--background` |
| `surface` | Fundo de cards padrao e popovers | Mapeia para `--card` / `--popover` |
| `surface-subtle` | Paineis internos embutidos e caixas de apoio | Novo / a definir; nao assumir `muted` automaticamente |
| `surface-elevated` | Elementos flutuantes, drawers, menus | Estende `surface` com elevacao |
| `surface-overlay` | Fundo para modais (dimmer) | Compatibilidade com overlay atual do `Dialog`; sem semantica final fechada |
| `surface-translucent` | Paineis com blur/translucidez recorrentes no produto | Novo |

### Texto
| Nomenclatura | Responsabilidade | Status shadcn |
| --- | --- | --- |
| `text-primary` | Textos vitais e de maxima leitura | Mapeia para `--foreground` |
| `text-secondary` | Descricoes e metadata base | Novo / a definir |
| `text-muted` | Placeholder e detalhes secundarios | Mapeia para `--muted-foreground` |
| `text-inverse` | Contraste forcado em superficies brand | Mapeia para `*-foreground` nativos |

### Bordas
| Nomenclatura | Responsabilidade | Status shadcn |
| --- | --- | --- |
| `border-subtle` | Divisores sutis e separadores internos | Novo / a definir |
| `border-default` | Delimitador padrao de cards e paineis | Mapeia para `--border` |
| `border-emphasis` | Delimitador acentuado para selecao, drag e destaque | Novo / nao reduzir a `ring` automaticamente |
| `border-focus` | Acessibilidade e foco visivel | Compatibilidade com `--ring` |

### Acoes e estados
| Nomenclatura | Responsabilidade | Status shadcn |
| --- | --- | --- |
| `action-primary` | Acao principal (CTA) | Mapeia inicialmente para `--primary`, mas precisa contemplar o CTA brand do produto |
| `action-secondary` | Acoes neutras | Mapeia para `--secondary` |
| `selection` | Destaque de item ativo/selecionado | Novo / a definir |
| `danger` / `destructive` | Delecao e erros graves | Mapeia para `--destructive` |
| `success`, `warning`, `info` | Pilares de states, badges e callouts | Novos |

## Foundation scales obrigatorias

### Cores
O DS nao aprova automaticamente toda a escala do Tailwind.
Cada familia precisa declarar:
- subconjunto adotado
- papel semantico permitido
- onde a familia pode aparecer
- quando o uso direto e proibido

### Tipografia
Os roles tipograficos devem ser ligados a uma escala fechada de tamanhos, pesos e line-height. O contrato nao deve deixar cada componente escolher livremente entre `text-xs`, `text-sm`, `text-base` e arbitrarios.

Roles minimos:
- `page-title`
- `section-title`
- `card-title`
- `body`
- `metadata`
- `caption`

### Espacamento
O contrato precisa formalizar uma malha curta para shell, secoes, cards, grupos de campo e acoes. Max-widths e min-widths locais so podem sobreviver como excecao documentada.

### Radius, elevacao e motion
`rounded-md`, `rounded-lg`, `rounded-xl`, `shadow-sm`, `shadow-lg`, blur e transicoes hoje aparecem em muitas superficies. O contrato precisa decidir:
- quais niveis entram na escala oficial
- quais continuam apenas como compatibilidade tecnica
- onde translucidez e glow sao proibidos

## Regras para escalas Tailwind
- O Tailwind e material tecnico disponivel, nao decisao automatica do DS
- Cada foundation scale deve declarar um subconjunto adotado
- Utilitarios fora do subconjunto adotado so podem aparecer como excecao documentada
- Roles semanticos devem impedir que cada componente escolha arbitrariamente entre varios tamanhos, tons ou radius

## Anti-patterns
1. **Dependencia excessiva de valores hardcoded (hex)**: proibido introduzir cores fixas arbitrarias nas classes (ex: `bg-[#FF0000]`)
2. **Explosao de tokens de componente**: nao criar `--card-border`, `--button-border`, `--modal-border` quando `surface-*`, `border-*` e `action-*` resolvem
3. **Ignorar heranca de cor**: evitar estilizar icones com classes proprias se eles puderem herdar `currentColor`
4. **Confundir default do Tailwind com decisao do DS**: utilitarios existentes nao equivalem a aprovacao automatica
5. **Subir token de componente cedo demais**: se um caso ainda cabe em semantic tokens, ele nao deve virar token proprio

## Regras para component tokens
Somente utilizar component tokens (Layer 4) quando um componente tiver semantica de dominio particular e conflituosa.

Exemplo valido aprovado:
- `--sidebar-*`, porque a Sidebar ja e uma camada tecnica propria do shadcn e pode manter compatibilidade separada da superficie principal

Exemplos que ainda nao justificam component token:
- card padrao do produto
- callout de estado
- badge semantica
- CTA principal
- painel translucido recorrente

Esses casos devem ser resolvidos primeiro por foundation scales + semantic tokens + theme mappings.
