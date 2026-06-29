# DS-1E Controls and Indicators

## Objetivo
Elevar os controles e indicadores compartilhados do produto para a linguagem visual aprovada do Design System V1, reduzindo a aparencia generica de shadcn sem:

- alterar anatomias de pagina;
- criar componentes paralelos por tema;
- redesenhar familias de cards de dominio;
- confundir brand com semantica de estado.

O DS-1E atua sobre primitivas compartilhadas, estados visuais e alguns usos locais que escapavam do sistema.

## Escopo Fechado
Esta rodada refinou de forma sistemica:

- `Button` e icon buttons;
- `Input`, `Textarea` e `Select`;
- `Tabs`;
- `Switch`, `Checkbox` e `RadioGroup`;
- `Badge` e `StatusBadge`;
- indicadores de loading, progress e feedback;
- `Toast`, `DropdownMenu` e `Tooltip`;
- foco, selected, disabled e destructive;
- alguns chips, counters e estados locais que ainda usavam classes diretas.

Ficaram fora desta rodada:

- redesenho estrutural de `PageHeader`;
- familias de cards de dominio;
- reanatomizacao de filtros por pagina;
- revisao ampla de badges contextuais por vertical;
- shell estrutural de `390px`.

## Auditoria Inicial

### Primitivas ativas
Auditoria de codigo confirmou como primitivas reais em uso:

- `components/ui/button.tsx`
- `components/ui/input.tsx`
- `components/ui/textarea.tsx`
- `components/ui/select.tsx`
- `components/ui/tabs.tsx`
- `components/ui/switch.tsx`
- `components/ui/checkbox.tsx`
- `components/ui/radio-group.tsx`
- `components/ui/badge.tsx`
- `components/ui/status-badge.tsx`
- `components/ui/state-message.tsx`
- `components/ui/progress.tsx`
- `components/ui/skeleton.tsx`
- `components/ui/toast.tsx`
- `components/ui/dropdown-menu.tsx`
- `components/ui/tooltip.tsx`

### Componentes realmente ativos
- O sistema ativo de feedback continua sendo `Toaster` + `useToast` + `toast.tsx`.
- `sonner.tsx` existe no repositorio, mas nao e a linguagem de feedback ativa do shell autenticado atual.
- `StatusBadge` era semanticamente estreito demais para o vocabulario do produto.
- `SelectTrigger`, `TabsTrigger` e varios botoes locais ainda carregavam classes diretas que achatavam os mappings do DS.

### Problemas observados
- botoes ainda pareciam muito proximos do baseline generico de shadcn;
- `outline`, `ghost` e `secondary` nem sempre tinham hierarquia clara;
- varios controles dependiam demais de `primary` cru para estados checked/selected;
- `StatusBadge` misturava semantica operacional com uma taxonomia muito pobre;
- `Select` e `Input` perdiam contraste ou identidade por overrides locais;
- estados disabled e loading estavam corretos funcionalmente, mas pouco distintos visualmente;
- alguns usos locais ainda aplicavam violeta/ciano diretamente onde o correto era semantica de estado.

## Taxonomia de Controles

### Fundacao semantica
O DS-1E consolidou uma camada pequena e compartilhada de tokens para controles:

- `control-background`
- `control-background-hover`
- `control-background-active`
- `control-background-strong`
- `control-border`
- `control-border-hover`
- `control-text`
- `control-placeholder`
- `control-focus`
- `control-disabled-background`
- `control-disabled-border`
- `control-disabled-text`
- `control-readonly-background`

### Indicadores semanticos
Tambem foi consolidada uma camada de indicadores:

- `indicator-brand`
- `indicator-neutral`
- `indicator-success`
- `indicator-warning`
- `indicator-danger`
- `indicator-info`
- `indicator-unavailable`

Esses papeis sao unicos entre temas. `Light`, `Dark`, `System` e `Studio` mapeiam os mesmos contratos.

## Botoes

### Ajustes aplicados
- `default` passou a ter hierarquia mais clara e menos aparencia de retangulo roxo generico;
- `secondary` foi separado visualmente de inputs e cards;
- `outline` ganhou borda funcional e hover perceptivel sem desaparecer no Light;
- `ghost` passou a ter hover, pressed e foco mais claros;
- `destructive` foi mantido semanticamente em `danger`, sem contaminar-se por cor de brand;
- `icon-only` preservou alvo acessivel e recebeu os mesmos contratos de foco/disabled.

### Studio
No Studio, o refinamento veio por tokens e atmosfera, nao por componente paralelo:

- maior integracao com shell e superficies;
- borda e contraste mais tecnicos;
- presenca de accent controlada;
- sem glow global em botoes.

## Forms

### Input e Textarea
Refinados para:

- separar-se melhor do canvas e dos paineis;
- preservar placeholder legivel;
- sustentar foco em todos os temas;
- manter disabled compreensivel sem virar apenas baixo contraste;
- respeitar `readOnly` visualmente.

### Select
Refinado em:

- trigger;
- dropdown;
- itens selecionados;
- estados de foco e teclado;
- tokens de fundo/borda para sobreviver a overrides locais.

Nao houve mudanca de anatomia nem de altura estrutural global.

## Tabs e Segmented Controls
`TabsList` e `TabsTrigger` passaram a usar o mesmo contrato de controles:

- trilho distinto;
- estado ativo perceptivel sem depender so de cor;
- foco preservado;
- `Studio` usa a microtipografia tecnica ja aprovada;
- `Light` e `Dark` preservam sua tipografia padrao.

Essa base atende:

- tabs de Configuracoes;
- toggles como Lista/Cards;
- seletores equivalentes de estados compartilhados.

## Switch, Checkbox e Radio
Refinados para:

- checked/unchecked legiveis inclusive em grayscale;
- foco visivel;
- disabled compreensivel;
- separacao entre brand e semantica de estado;
- sem glow excessivo.

O controle de intensidade Studio permaneceu no mesmo contrato, sem redesign amplo.

## Badges, Chips e Indicadores

### Badge
`Badge` foi ampliado para contemplar:

- `default`
- `secondary`
- `outline`
- `success`
- `warning`
- `info`
- `neutral`

Isso permitiu reduzir classes locais cruas para metadata e chips simples.

### StatusBadge
`StatusBadge` passou a aceitar:

- `neutral`
- `positive`
- `success`
- `warning`
- `danger`
- `info`
- `draft`
- `approved`
- `generated`
- `unavailable`

Semantica operacional continua separada de brand:

- `success`, `warning`, `danger` e `info` nao usam violeta/ciano como substituto;
- `draft`, `approved` e `generated` continuam semanticamente distintos, mas agora dentro do mesmo sistema.

### Chips, counters e metadata
O lote DS-1E nao cria uma nova familia de chips. Em vez disso:

- reaproveita `Badge` quando o papel e metadata compacta;
- usa `StatusBadge` quando o papel e operacional;
- permite counters mais tecnicos via tipografia/contraste nos temas Studio;
- corrige usos locais que estavam visualmente deslocados.

## Loading, Skeleton e Progress
Refinamentos aplicados:

- `Skeleton` subordinado ao conteudo, sem competir visualmente;
- `Progress` alinhado aos tokens semanticos e aos temas;
- `StateMessage` mais claro para diferenciar loading, vazio, erro e indisponibilidade;
- base pronta para respeitar `prefers-reduced-motion` sem exigir animacao nova.

O DS-1E nao otimiza performance de Galeria. Ele apenas melhora a comunicacao visual do estado intermediario.

## Toasts e Feedback
O contrato visual ativo ficou centralizado em `toast.tsx`:

- titulo e mensagem legiveis;
- significado sustentado por icone e texto, nao apenas por cor;
- dismiss acessivel;
- destructive controlado;
- Studio continua atmosferico sem transformar toast em painel neon.

`sonner.tsx` permanece fora da linguagem ativa desta rodada.

## Focus, Selected, Disabled e Destructive
O DS-1E consolidou um comportamento mais consistente para:

- `focus-visible`;
- `selected`;
- `pressed`;
- `active`;
- `checked`;
- `disabled`;
- `destructive`.

Principios mantidos:

- nada depende apenas de cor;
- foco nao desloca layout;
- glow nao e o unico indicador;
- Studio pode usar violeta/ciano no foco, mas sem exagero;
- `Light` e `Dark` preservam papeis semanticos aprovados no DS-1C.

## Relacao com Studio
O DS-1E nao cria `StudioButton`, `StudioTabs` ou equivalentes.

O Studio herda as mesmas primitivas e recebe refinamento por:

- mappings de tema;
- tokens de controle;
- tipografia tecnica onde ja havia aprovacao;
- atmosfera e glass seletivo ja definidos no DS-1D.

Resultado esperado por intensidade:

- `Soft`: controles mais contidos, ainda claramente Studio;
- `Balanced`: baseline oficial e recomendado;
- `Expressive`: maior presenca atmosferica sem mudar anatomia, semantica ou comportamento.

## Acessibilidade
Validacoes desta rodada cobrem:

- contraste de texto e placeholder;
- foco visivel;
- navegacao por teclado;
- estados disabled compreensiveis;
- destructive semanticamente separado de brand;
- loading distinto de vazio;
- indicadores nao dependentes apenas de cor;
- alvos clicaveis preservados nas primitivas refinadas.

## Responsividade
O lote foi validado para manter:

- wrap de botoes;
- filtros e tabs sem overflow horizontal novo;
- footers de modal utilizaveis;
- dropdowns e selects operaveis;
- areas clicaveis preservadas.

O problema estrutural preexistente do shell em `390px` permanece fora do escopo e nao foi corrigido escondido nesta rodada.

## Smoke
O smoke do DS-1E foi conduzido sobre:

- `Light`
- `Dark`
- `System`
- `Studio Soft`
- `Studio Balanced`
- `Studio Expressive`

Rotas principais usadas como referencia:

- Dashboard;
- Projetos;
- Project detail;
- Production;
- Imagens;
- Videos;
- Arquivos;
- Configuracoes;
- modal real;
- tabs;
- inputs;
- selects;
- toast;
- foco;
- loading.

Conclusao do smoke:

- `Light`, `Dark` e `System` permaneceram estaveis;
- Studio ganhou uma linguagem de controles mais refinada sem virar outro sistema;
- midia permaneceu protagonista em Galeria e Arquivos;
- nao houve evidencia de redesign estrutural amplo.

## Itens Deferidos

### DS-1F - Card Anatomies
- hierarquia interna dos cards;
- acoes e metadata por familia de card;
- badges contextuais;
- consistencia entre cards de midia, Project, Production e conteudo;
- bordas superiores por contexto.

### DS-1G - Proven Primitives
- consolidacao dos padroes realmente usados;
- remocao ou formalizacao de primitivas inativas;
- revisao de `sonner.tsx`;
- adocao consistente dos controles compartilhados;
- usos locais ainda fora das primitivas.

### DS-1H - Pilot and Adoption
- consistencia transversal entre rotas;
- decisao sobre quais listas precisam de visualizacao Lista/Cards;
- alinhamento entre filtros e modos de visualizacao;
- revisao de rotas ainda fora do padrao;
- hardening responsivo;
- problema estrutural do shell em `390px`.

Importante:

```text
nem toda lista deve receber Lista/Cards automaticamente
```

Essa decisao depende do conteudo, densidade e necessidade operacional de cada rota e sera auditada posteriormente.

### Refinamento visual final
Depois do DS-1H:

- comparacao global com Hermes;
- grid Studio;
- detalhes de glow;
- bordas e microdetalhes;
- consistencia de botoes, tabs e badges;
- revisao visual rota por rota.

## Riscos e Observacoes
- ainda existem usos locais que poderao ser absorvidos por primitivas futuras, mas o lote atual ja removeu os mais visiveis;
- `sonner.tsx` continua no repositorio e deve permanecer documentado como linguagem inativa ate eventual consolidacao;
- refinamentos mais profundos em cards e indicadores contextuais pertencem a DS-1F, DS-1G e DS-1H, nao a esta rodada;
- o `build` de producao completa e demorado no ambiente local, mas concluiu apos janela maior do que o timeout padrao das ferramentas.
