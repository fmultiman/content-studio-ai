# DS-1G - Proven Primitives

## Objetivo

Consolidar apenas as primitivas comprovadas apos DS-1E e DS-1F, remover wrappers UI sem call site real, formalizar a fonte canonica do sistema de toast e registrar quais estruturas permanecem locais por desenho.

## Resultado desta rodada

- nenhuma pagina foi redesenhada;
- nenhum tema foi reaberto;
- nenhuma anatomia de card foi alterada alem da remocao de APIs inativas;
- nenhuma primitiva nova especulativa foi criada;
- DS-1H nao foi iniciado.

## Matriz final

| Primitiva | Categoria | Evidencia resumida | Acao |
| --------- | --------- | ------------------ | ---- |
| `Button` | PROVEN | ampla reutilizacao em rotas e componentes | preservada |
| `Badge` | PROVEN | badges genericos e de metadata ativos | preservada |
| `StatusBadge` | PROVEN | status semantico em Projects, Dashboard, Galeria, Conteudos e drafts | preservada |
| `StateMessage` | PROVEN | empty, filtered empty e feedback em multiplas rotas | preservada |
| `Input` | PROVEN | formularios e filtros ativos | preservada |
| `Textarea` | PROVEN | formularios editoriais e multimodais | preservada |
| `Select` | PROVEN | filtros, formularios e configuracoes | preservada |
| `Tabs` | PROVEN | Configuracoes, Production e fluxos locais aprovados | preservada |
| `Switch` | PROVEN | configuracoes e avaliacao de imagem | preservada |
| `RadioGroup` | PROVEN | intensidade Studio central e estavel | preservada |
| `DropdownMenu` | PROVEN | header, cards e acoes contextuais | preservada |
| `Dialog` | PROVEN | formularios, media picker e fluxos de confirmacao | preservada |
| `Card` + `CardHeader` + `CardTitle` + `CardDescription` + `CardContent` | PROVEN | base compartilhada dos cards reais apos DS-1F | preservadas |
| `CardMedia` | PROVEN | Galeria e Arquivos com anatomia real de media | preservada |
| `CardActions` | PROVEN | pilotos e expansao controlada do DS-1F | preservada |
| `ContextMetadata` | PROVEN | cards e rows reais, inclusive modo `dense` | preservada |
| `PageHeader` | PROVEN | hubs e paginas de colecao | preservada |
| `ViewModeToggle` | PROVEN | Galeria, Imagens e Videos | preservada |
| `Checkbox` | PROVEN WITH CLEANUP | call sites reais, mas ainda nao universalizados | preservada |
| `Tooltip` | PROVEN WITH CLEANUP | fundacao interna necessaria do sidebar | preservada |
| `FieldError` | PROVEN WITH CLEANUP | uso repetido, mas ainda limitado a formularios especificos | preservada |
| `ToggleGroup` | PROVEN WITH CLEANUP | usado em filtros/modos pontuais, sem ampliacao artificial | preservada |
| `Sheet` | LOCAL BY DESIGN | fundacao interna do sidebar | preservada |
| `stats-cards`, `image-input-section`, `image-result`, `prompt-section` | LOCAL BY DESIGN | wrappers locais com semantica propria | preservados |
| `CardEyebrow` | DEPRECATED | sem call site ativo apos reversao dos pilotos | removida |
| `CardFooter` | DEPRECATED | sem call site real | removida |
| `components/ui/use-toast.ts` | DUPLICATED | copia do store canonico sem imports reais | removida |
| `components/ui/sonner.tsx` | UNUSED | nenhuma montagem, nenhum call site, linguagem duplicada | removida |
| `progress`, `popover`, `button-group`, `input-group`, `form`, `empty`, `spinner`, `command`, `drawer`, `hover-card`, `context-menu`, `table` | UNUSED | zero imports por caminho, sem barrel e sem dependencia funcional ativa | removidos |

## Toast canonico

O contrato ativo do sistema de toast fica explicitamente:

- `hooks/use-toast.ts`
  store e hook canonicos;
- `components/ui/toaster.tsx`
  renderer global montado em `app/layout.tsx`;
- `components/ui/toast.tsx`
  primitivas visuais radix.

Remocoes aprovadas:

- `components/ui/use-toast.ts`
- `components/ui/sonner.tsx`

## APIs de Card removidas

Foram removidas do contrato compartilhado:

- `CardEyebrow`
- `CardFooter`

Permanecem aprovadas:

- `Card`
- `CardHeader`
- `CardTitle`
- `CardDescription`
- `CardContent`
- `CardMedia`
- `CardActions`

## Componentes removidos

- `components/ui/use-toast.ts`
- `components/ui/sonner.tsx`
- `components/ui/progress.tsx`
- `components/ui/popover.tsx`
- `components/ui/button-group.tsx`
- `components/ui/input-group.tsx`
- `components/ui/form.tsx`
- `components/ui/empty.tsx`
- `components/ui/spinner.tsx`
- `components/ui/command.tsx`
- `components/ui/drawer.tsx`
- `components/ui/hover-card.tsx`
- `components/ui/context-menu.tsx`
- `components/ui/table.tsx`

## Dependencias removidas

- `sonner`
- `@radix-ui/react-progress`
- `@radix-ui/react-popover`
- `@radix-ui/react-hover-card`
- `@radix-ui/react-context-menu`
- `cmdk`
- `vaul`

## Tokens auditados

Foi feita auditoria final dos grupos:

- `control-*`
- `indicator-*`
- `card-*`
- `studio-*`

Nenhum token desses grupos foi removido nesta rodada.

Motivo:

- `control-*`, `indicator-*` e `card-*` continuam referenciados por primitivas ativas;
- `studio-*` continua necessario para shell, atmosfera e intensidades do tema Studio;
- nao houve evidencia suficiente de token morto que justificasse churn nominal ou risco amplo.

## Wrappers LOCAL BY DESIGN

Permanecem locais por funcao e anatomia propria:

- `components/dashboard/stats-cards.tsx`
- `components/images/image-input-section.tsx`
- `components/images/image-result.tsx`
- `components/images/prompt-section.tsx`

Tambem permanecem locais:

- header especial de detalhe de Project;
- header especial de workspace de Production;
- botoes nativos em superficies compostas, thumbnails selecionaveis e controles com comportamento proprio.

## Botoes locais migrados

Nenhuma migracao ampla foi forcada nesta rodada.

Direcao adotada:

- migrar apenas equivalencias obvias e de baixo risco;
- preservar botoes locais quando a semantica nao e a de um `Button` compartilhado;
- registrar esses casos como `LOCAL BY DESIGN` em vez de aumentar adocao artificial.

## Call sites consolidados

Consolidacao efetiva desta rodada:

- sistema de toast unificado no caminho canonico;
- contrato compartilhado de `Card` reduzido ao que realmente permaneceu em uso;
- indice documental atualizado para o lote DS-1G;
- teste de integridade adicionado para prevenir reintroducao silenciosa de duplicatas removidas.

## Call sites nao migrados

Permanecem fora de consolidacao automatica:

- headers especiais de detalhe/workspace;
- wrappers de estatistica e entrada multimodal;
- loaders de operacoes especificas;
- acoes compostas e areas interativas locais;
- superficies cuja equivalencia com uma primitiva compartilhada nao e completa.

## Riscos residuais

- podem existir wrappers locais semanticamente proximos entre si, mas ainda nao equivalentes o bastante para consolidacao segura;
- remocoes de scaffold shadcn reduzem entropia agora, mas futuras necessidades podem exigir reintroducao intencional;
- a padronizacao transversal final entre rotas continua dependente do lote DS-1H.

## Itens deferidos para DS-1H

- consolidacao transversal do que ainda estiver fora das primitivas comprovadas;
- decisao global sobre listas que realmente precisam de modo Lista/Cards;
- hardening responsivo final;
- revisao de fluxos especiais ainda montados localmente;
- alinhamento final entre superficies equivalentes rota por rota.
