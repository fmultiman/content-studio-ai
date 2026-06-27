# UX-H4A - Auditoria de consistencia visual e padronizacao das telas internas

Data: 2026-06-27  
Branch auditada: `discovery/ux-visual-consistency-h4`  
Escopo: discovery autenticado e inspecao de codigo. Nenhuma correcao de UI foi implementada nesta rodada.

## 1. Contexto

O UX-H3 reconciliou a arquitetura de navegacao, o Dashboard, os hubs globais de Imagens e Videos, a Galeria e a Sidebar. Esta auditoria avalia se as telas internas agora parecem pertencer ao mesmo produto e se usam padroes consistentes para hierarquia, densidade, cards, listas, filtros, avisos, estados e acoes.

Pergunta central:

```text
As telas parecem partes do mesmo produto e seguem os mesmos padroes de hierarquia, densidade, cards, listas, filtros, avisos e acoes?
```

## 2. Metodologia

Foram combinadas tres fontes:

- leitura dos documentos H1, H2 e H3;
- inspecao dos componentes e paginas atuais;
- navegacao autenticada no browser em desktop e larguras estreitas.

Telas auditadas:

- `/dashboard`;
- `/projetos`;
- `/projetos/[projectId]`;
- `/projetos/[projectId]/producoes/[productionId]`;
- `/imagens`;
- `/videos`;
- `/conteudos`;
- `/galeria`;
- `/arquivos`;
- `/configuracoes`.

Viewports considerados:

- desktop normal: aproximadamente `1280px`;
- desktop/tablet intermediario: `1024px` e `768px`;
- mobile estreito: `390px`.

Observacao: em algumas rotas contextuais, o browser entrou em estados de carregamento ou workspace com dados existentes. Quando o browser nao era suficiente para reproduzir todos os estados, a conclusao foi cruzada com o codigo real.

## 3. Sumario executivo

Nao foram encontrados problemas P0. O produto esta navegavel e a reconciliacao estrutural do UX-H3 permanece valida.

O principal problema P1 e a densidade do modo Lista nos hubs de Imagens, Videos e Galeria. As linhas usam muitas colunas fixas e acoes largas em breakpoints que ainda podem ser estreitos, o que causa colisao visual ou leitura comprimida em desktop estreito/tablet. Esse e o primeiro lote recomendado para implementacao.

Ha tambem inconsistencias P1/P2 de hierarquia: a Galeria renderiza dois `h1` visiveis, Dashboard usa uma hierarquia propria com saudacao em `h2`, Conteudos usa um heading uppercase de secao, e Projetos usa descricao/acao sem um padrao compartilhado de `PageHeader`.

O produto ja tem bons padroes emergentes:

- `ViewModeToggle` e `useViewModePreference`;
- cards de retomada com contexto Project/Production;
- estados vazios mais contextuais;
- Sidebar reconciliada;
- Galeria separada de Imagens.

A proxima fase deve consolidar padroes leves, nao criar um design system generico.

## 4. Matriz de inconsistencias

| ID | Area | Viewport | Componente | Problema | Evidencia | Impacto | Prioridade | Correcao recomendada | Arquivos provaveis | Risco |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H4A-LIST-01 | Imagens, Videos, Galeria | desktop estreito/tablet | Lista | Textos e acoes competem horizontalmente no modo Lista. | Grids com colunas fixas: Imagens/Videos usam `md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_120px_150px_170px]`; Galeria usa `lg:grid-cols-[72px_minmax(180px,1.3fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_100px_120px_220px]`. | Quebra leitura, contexto Project/Production e acoes. | P1 | Definir padrao responsivo de lista: desktop largo com colunas, desktop estreito em duas faixas, mobile empilhado; reduzir acoes visiveis ou quebra-las em segunda linha. | `app/(dashboard)/imagens/page.tsx`, `app/(dashboard)/videos/page.tsx`, `app/(dashboard)/galeria/page.tsx` | Medio, afeta hubs ja aprovados. |
| H4A-HIER-01 | Galeria | todos | Page header | A tela exibe dois `h1` visiveis com o texto `Galeria`. | Browser autenticado: headers `H1: Galeria`, `H1: Galeria`; codigo usa `<Header title="Galeria" />` e `h1` interno. | Hierarquia duplicada e leitura assistiva confusa. | P1 | Criar regra: Header global pode carregar titulo operacional, mas conteudo interno deve usar `h2` ou o Header deve aceitar descricao/acoes e ser a unica fonte do `h1`. | `app/(dashboard)/galeria/page.tsx`, `components/layout/header.tsx` | Baixo. |
| H4A-HIER-02 | Dashboard | todos | Page hierarchy | Dashboard tem `H1: Dashboard`, `H2: Ola...`, varios `H3`; outras paginas nao tem essa camada de saudacao. | Browser: Dashboard mostra `H1`, `H2`, secoes `H3`. | Nao bloqueia, mas cria padrao unico dificil de comparar. | P2 | Definir se saudacao e hero operacional ou texto auxiliar; manter `Continuar trabalhando` como primeira secao visivel. | `components/dashboard/continuation-hub.tsx` | Baixo. |
| H4A-HIER-03 | Conteudos | todos | Section header | Lista usa `H2: Conteudos editoriais` em uppercase enquanto hubs usam `Rascunhos recentes` com descricao. | Browser e codigo em `app/(dashboard)/conteudos/page.tsx`. | A pagina parece anterior aos padroes H3. | P2 | Reconciliar Conteudos como hub editorial com header de secao, filtros e estados semelhantes aos hubs de midia. | `app/(dashboard)/conteudos/page.tsx` | Medio, envolve fluxo editorial. |
| H4A-FILTER-01 | Galeria | 768/desktop estreito | Filter bar | Filtro usa grid denso com cinco colunas incluindo acao `auto`. | `md:grid-cols-[minmax(180px,1.4fr)_..._auto]`. | Pode comprimir controles e quebrar labels em tablet. | P2 | Padronizar filter bar: busca larga, selects em grid fluido, acao limpar no final ou abaixo em tablet. | `app/(dashboard)/galeria/page.tsx`; padrao futuro `FilterBar` | Baixo. |
| H4A-FILTER-02 | Conteudos | todos | Filtros | Usa `ToggleGroup` + selects em linha flexivel, diferente dos cards de filtro de Imagens/Videos/Galeria. | Codigo em `app/(dashboard)/conteudos/page.tsx`. | Padrao visual fragmentado. | P2 | Definir quando usar filter card, inline filters ou segmented controls. | `app/(dashboard)/conteudos/page.tsx` | Baixo. |
| H4A-CARD-01 | Dashboard, Imagens, Videos, Galeria, Projects | todos | Cards | Cards equivalentes usam padding, radius, acoes e metadata diferentes. | `rounded-xl p-5`, `rounded-lg p-4`, `CardContent p-4`, cards visuais de Galeria. | Aparencia de modulos criados em fases distintas. | P2 | Definir familias: operational card, media output card, compact list card, empty state card. Nao criar card universal. | componentes/paginas dos modulos | Medio. |
| H4A-ACTION-01 | Conteudos, Galeria, Imagens/Videos | mobile | Acoes | Verbos e pesos variam: `Abrir`, `Visualizar`, `Ver Production`, `Continuar Production`, `Criar e abrir`. | Codigo e browser. | Usuario aprende padroes por tela, nao por produto. | P2 | Ordem e verbos: acao principal = abrir/continuar; contexto = Ver Production; asset = Visualizar/Baixar. | varias paginas | Baixo. |
| H4A-META-01 | Cards/listas | todos | Metadata | Ordem de Project, Production, status e data varia por tela. | Cards de Dashboard, hubs e Galeria diferem. | Comparacao e varredura ficam mais lentas. | P2 | Ordem padrao: tipo/status, titulo, Project, Production, data, acoes. Em midia visual, thumbnail precede titulo. | hubs, galeria, dashboard | Baixo. |
| H4A-STATE-01 | Loading | todos | Loading | Alguns estados tem texto contextual; outros apenas spinner. | Projetos: `Carregando projetos...`; Conteudos apenas spinner; Configuracoes apenas spinner. | Menor confianca em telas lentas. | P2 | Padronizar loading contextual com `role=status` e texto curto. | paginas de lista e configs | Baixo. |
| H4A-CALLOUT-01 | Configuracoes, Identity, workspaces | todos | Informacao/aviso | Callouts usam estilos semelhantes para dica, warning, contexto e indisponibilidade. | Configuracoes usa blocos violet/amber; identity usa strips/cards; provider ausente usa mensagens especificas. | Semantica visual pouco clara. | P2 | Taxonomia: `InlineHint`, `InfoCallout`, `WarningCallout`, `ErrorState`, `ContextBadge`. | componentes futuros | Baixo. |
| H4A-FORM-01 | Configuracoes e forms | 390 | Formularios/tabs | Tabs de Configuracoes tem 5 colunas; labels ficam ocultos em mobile. | Codigo usa `TabsList className="grid w-full grid-cols-5"` com labels hidden em `sm`. | Icones podem virar navegacao pouco explicita. | P2 | Avaliar tabs scrollaveis/empilhadas ou labels curtos em mobile. | `app/(dashboard)/configuracoes/page.tsx` | Medio. |
| H4A-RESP-01 | Arquivos | 390 | Biblioteca/lista | Browser mediu muitos cards/containers em mobile e 4 controles; a tela parece densa e ainda anterior a reconciliacao de bibliotecas. | Browser `/arquivos` em 390: sem overflow global, mas alta densidade. | Bibliotecas Galeria/Arquivos nao tem paridade visual. | P2 | Deixar para UX de Arquivos: separar uploads, insumos e biblioteca com padroes da Galeria onde fizer sentido. | `app/(dashboard)/arquivos/page.tsx` | Medio. |
| H4A-TEXT-01 | Imagens/Videos | codigo | Copy | Ainda ha textos sem acento em alguns trechos (`sera`, `geracao`, `avaliacao`, `Titulo`, `Video`). | Codigo dos hubs. | Refinamento perceptivel em PT-BR. | P3 | Corrigir acentuacao em lote de polish, sem misturar com densidade. | `app/(dashboard)/imagens/page.tsx`, `app/(dashboard)/videos/page.tsx` | Baixo. |
| H4A-ICON-01 | Header | todos | Botoes de icone | Botao de notificacoes no Header e icone sem label visivel. | `components/layout/header.tsx`. | Acessibilidade/clareza. | P3 | Adicionar `aria-label` e revisar se notificacao e funcional ou decorativa. | `components/layout/header.tsx` | Baixo. |

## 5. Analise especifica das Listas

### Achado principal

O modo Lista foi introduzido como padrao nos hubs de Imagens/Videos e alternativa na Galeria. O padrao ainda nao esta maduro para larguras intermediarias.

Imagens e Videos:

```text
Titulo | Project | Production | Status | Atualizado | Acoes
```

Galeria:

```text
Imagem | Titulo | Project | Production | Status | Atualizado | Acoes
```

### Causa

- Ha muitas colunas competindo por largura.
- Acoes tem largura fixa alta.
- Project e Production sao textos longos e importantes.
- O breakpoint de lista tabular aparece cedo demais em Imagens/Videos (`md`).
- O cabecalho de colunas continua assumindo tabela mesmo quando o conteudo pede layout de duas faixas.
- A lista usa truncation, mas nao resolve colisao perceptiva quando varias colunas ficam estreitas.

### Recomendacao

Padrao de lista:

```text
Desktop largo:
colunas alinhadas.

Desktop estreito/tablet:
linha em duas faixas:
1. thumbnail/tipo + titulo + status
2. Project + Production + data + acoes

Mobile:
item empilhado compacto, sem cabecalho de colunas.
```

Headings de coluna devem desaparecer antes do layout empilhado, provavelmente abaixo de `lg` para itens com seis ou sete colunas.

## 6. Cards

### Observacoes

- Dashboard usa cards operacionais de retomada com `rounded-xl`, `p-5`, acao a direita.
- Itens recentes e Projects recentes usam cards menores (`rounded-lg`, `p-4`).
- Hubs de Imagens/Videos usam cards de rascunho com icone, badges, metadata e acoes.
- Galeria usa cards visuais com thumbnail como elemento dominante.
- Conteudos usa cards clicaveis inteiros, com icone externo, sem acao explicita equivalente a `Abrir`.

### Padrao recomendado

Nao criar um card universal. Criar familias:

- `OperationalCard`: Production, Project, retomada.
- `DraftCard`: Imagem/Video em trabalho.
- `OutputCard`: Galeria visual.
- `EditorialItemCard`: conteudo textual/editorial.
- `EmptyStateCard`: estados vazios e erros.

Regras comuns:

- radius maximo `rounded-xl` apenas para blocos principais; cards internos podem usar `rounded-lg`;
- acoes explicitas sempre visiveis quando o card tambem e clicavel;
- metadata sempre depois do titulo e antes da descricao longa;
- `Project` antes de `Production`;
- data em texto curto e consistente.

## 7. Cards / Lista por pagina

| Pagina | Classificacao recomendada | Justificativa |
| --- | --- | --- |
| Dashboard | Cards apenas | Retomada por blocos operacionais; lista densa nao agrega agora. |
| Projetos | Cards ou lista futura opcional | Hoje Projects sao poucos e estruturais; lista pode ser util depois para volume. |
| Project detalhe | Nao aplicavel / secoes | E workspace estrutural, nao colecao simples. |
| Production workspace | Nao aplicavel / tabs e paineis | Workspace multimodal. |
| Imagens | Lista padrao + Cards | Hub operacional de rascunhos; lista precisa refinamento responsivo. |
| Videos | Lista padrao + Cards | Mesmo padrao de Imagens. |
| Conteudos | Lista/card editorial a definir | Pode se beneficiar de lista compacta, mas precisa contrato editorial proprio. |
| Galeria | Cards padrao + Lista | Biblioteca visual; cards sao o modo principal. |
| Arquivos | Lista ou grid por tipo a definir | Biblioteca de uploads/insumos ainda nao reconciliada. |
| Configuracoes | Nao aplicavel | Formularios e tabs. |

## 8. Hierarquia de paginas

### Problemas encontrados

- Galeria duplica `h1`.
- Dashboard tem saudacao em `h2` e secoes em `h3`.
- Conteudos usa secao uppercase como `h2`.
- Projetos usa descricao e CTA em uma linha sem um componente de cabecalho compartilhado.
- Hubs de Imagens/Videos tem uma estrutura mais clara: titulo, descricao, criacao, rascunhos.

### Padrao recomendado para Page Header

```text
H1 unico:
nome da area.

Descricao curta:
uma frase sobre papel da area.

Acao primaria:
uma acao principal no maximo.

Acoes secundarias:
links ou botoes outline, abaixo ou a direita.

Metricas:
abaixo do header, nunca competindo com o titulo.
```

O Header global atual pode continuar existindo, mas o produto precisa decidir se ele e o `h1` real da pagina ou apenas barra superior. Evitar dois `h1` visiveis.

## 9. Informacoes, avisos e callouts

### Taxonomia recomendada

- `InlineHint`: texto curto abaixo de campo ou controle.
- `ContextBadge`: status compacto como `Identidade herdada`.
- `InfoCallout`: contexto util e persistente, discreto.
- `WarningCallout`: risco ou configuracao ausente.
- `ErrorState`: erro de carregamento/acao com tentativa novamente.
- `SuccessToast`: confirmacao transitoria.

### Achados

- Configuracoes usa callouts coloridos para dica e automacao.
- Project Identity usa indicadores e cards contextuais.
- Provider ausente usa mensagens de erro/indisponibilidade.
- Esses padroes sao semanticamente diferentes, mas visualmente ainda proximos em peso e espaco.

## 10. Filtros e controles

### Achados

- Imagens/Videos usam filter card com quatro campos.
- Galeria usa card de filtros com cinco colunas.
- Conteudos usa `ToggleGroup` e selects inline.
- Arquivos usa controles de biblioteca com upload/pastas.
- View toggle tem padrao compartilhado, mas posicao e visibilidade dependem da pagina.

### Padrao recomendado

```text
FilterBar:
busca primeiro;
Project antes de Production;
status/tipo depois;
limpar filtros no final;
ViewModeToggle alinhado ao titulo da colecao;
em mobile, controles empilhados com labels visiveis.
```

Variacoes permitidas:

- `FilterCard` para hubs densos;
- `InlineFilters` para paginas simples;
- `SegmentedStatus` quando status e o eixo principal, como Conteudos.

## 11. Botoes e acoes

### Problemas

- `Abrir`, `Visualizar`, `Continuar`, `Criar e abrir` e `Ver Production` aparecem em hierarquias diferentes.
- Alguns cards sao clicaveis inteiros; outros dependem de botao explicito.
- Download e Production aparecem lado a lado, mas em alguns modos a largura de acoes pressiona o conteudo.

### Recomendacao

Ordem e linguagem:

```text
Continuar / Abrir:
retomar workspace ou draft.

Visualizar:
abrir preview sem edicao.

Ver Production:
ir ao contexto de origem.

Baixar:
baixar asset.

Criar:
iniciar entidade nova.
```

Nao usar multiplos botoes primarios na mesma linha sem hierarquia clara.

## 12. Metadata e badges

Ordem recomendada:

```text
Tipo ou status
Titulo
Project
Production
Data
Origem ou provider, quando necessario
```

Regras:

- Project antes de Production.
- Status como badge quando afeta acao ou compreensao.
- Tipo como badge apenas quando ha mistura de tipos.
- Datas em formato consistente.
- Evitar repetir labels longas quando a secao ja comunica o tipo.

## 13. Estados

### Padroes bons ja existentes

- Dashboard tem estados contextuais por Project/Production.
- Imagens/Videos diferenciam sem Project, sem Production e sem draft.
- Galeria diferencia output vazio de filtro sem resultado.

### Lacunas

- Conteudos e Configuracoes ainda usam spinners mais genericos.
- Erros e estados vazios tem pesos visuais variados.
- Loading deveria usar estrutura semelhante ao conteudo esperado.

Padrao recomendado:

```text
Loading:
texto contextual e role=status.

Empty:
titulo, descricao e CTA coerente.

Filtered empty:
mensagem curta e acao limpar filtros.

Error:
mensagem segura e Tentar novamente.

Unavailable:
estado explicito para provider/configuracao ausente.
```

## 14. Formularios e workspaces internos

Areas observadas:

- Project form;
- Project Identity;
- Production workspace;
- Imagem;
- Video;
- Conteudos;
- Configuracoes.

Achados:

- Configuracoes concentra muitas abas e cards com padroes antigos.
- Production workspace e Project Identity usam secoes mais contextuais, mas ainda com pesos variados.
- Imagem/Video tem workspaces ricos, mas seus paineis de resultado, provider e contexto nao compartilham uma taxonomia visual unica.
- Conteudos ainda parece mais simples e menos reconciliado que os hubs de midia.

Recomendacao: deixar formularios/workspaces para lote posterior, depois de resolver lista, header e filtros.

## 15. Responsividade

### Observacoes confirmadas

- Rotas principais auditadas nao apresentaram overflow horizontal global em `1280px` ou `390px`.
- O problema de Lista e local: conteudo colide/comprime dentro do grid de linhas.
- Sidebar H3D permaneceu fora do escopo de correcao H4A, mas a estrutura atual nao deve ser alterada nesta fase.
- Galeria e Arquivos em mobile concentram muitos cards/containers, entao densidade precisa ser avaliada no lote de biblioteca/formularios.

### Recomendacao de breakpoints

```text
>= 1280px:
listas tabulares completas.

1024px a 1279px:
listas com menos colunas ou acoes em segunda faixa.

768px a 1023px:
item compacto de duas faixas; sem cabecalho de colunas longo.

< 768px:
item empilhado; sem tabela horizontal; acoes quebram linha.
```

## 16. Consistencia de componentes

| Padrao | Estado atual | Recomendacao |
| --- | --- | --- |
| PageHeader | Precisa consolidar | Criar/ajustar padrao leve para H1 unico, descricao e acoes. |
| ViewModeToggle | Ja existe | Manter; apenas padronizar posicao e labels por pagina. |
| FilterBar | Precisa criar | Consolidar busca, Project, Production, status e limpar filtros. |
| ListRow | Precisa criar/consolidar | Prioridade alta por causa do overlap. |
| MetadataGroup | Precisa criar | Reduzir divergencias de Project/Production/status/data. |
| StatusBadge | Precisa consolidar | Mapear cores e labels por dominio. |
| EmptyState | Precisa consolidar | Ha bons exemplos, mas duplicados. |
| ContextCallout | Precisa criar | Taxonomia para identidade, provider, dicas e avisos. |
| PreviewDialog | Nao deve ser universal agora | Galeria e Arquivos podem compartilhar principios, nao necessariamente componente. |
| Card | Nao deve ser universal | Criar familias, nao um card unico. |

## 17. Plano de implementacao em lotes

### UX-H4B1 - Lists and responsive density

Escopo:

- corrigir listas de Imagens, Videos e Galeria;
- definir `ListRow` ou padrao local compartilhado;
- mover acoes para segunda faixa em larguras intermediarias;
- garantir equivalencia Cards/Lista.

Critérios:

- sem sobreposicao horizontal;
- sem overflow;
- Project e Production legiveis;
- acoes alcancaveis;
- mobile empilhado.

Risco: medio, porque toca hubs recem-aprovados.

### UX-H4B2 - Page hierarchy and contextual messaging

Escopo:

- resolver H1 duplicado da Galeria;
- definir padrao de PageHeader;
- harmonizar Dashboard, Projetos, Conteudos, Galeria e Arquivos;
- criar taxonomia de callouts.

Risco: baixo a medio.

### UX-H4B3 - Cards, metadata and actions

Escopo:

- alinhar card families;
- padronizar ordem de metadata;
- revisar verbos de acao;
- reduzir pesos visuais divergentes.

Risco: medio por amplitude visual.

### UX-H4B4 - States, forms and final polish

Escopo:

- loading, empty, error e unavailable;
- Configuracoes, Conteudos, Project Identity, Production workspace;
- acentuacao e copies residuais;
- tabs e formularios responsivos.

Risco: medio; deve ser subdividido se crescer.

## 18. Itens fora de escopo

- corrigir o overlap de Lista nesta rodada;
- criar componentes;
- alterar Sidebar;
- implementar drawer mobile;
- alterar banco, schema, dominio ou rotas;
- redesenhar o produto;
- revisar toda a terminologia Project/Production.

## 19. Conclusao

O produto esta estruturalmente coerente depois do UX-H3, mas visualmente ainda mostra marcas das fases anteriores. A prioridade imediata e a densidade responsiva das Listas. Em seguida, o produto deve consolidar um padrao de header, filtros, metadata, callouts e estados.

Conclusao:

```text
UX-H4A AUDIT COMPLETE — READY FOR IMPLEMENTATION PLANNING
```
