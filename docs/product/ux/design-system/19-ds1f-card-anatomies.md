# DS-1F - Card Anatomies

## Objetivo

Estabelecer anatomias coerentes para familias reais de cards do Content Agent Studio sem criar um card universal, sem paralelismo por tema e sem redesign amplo de paginas.

## Inventario auditado

- `Project cards`
- `Production cards`
- `Content cards`
- `Image draft cards`
- `Video draft cards`
- `Gallery media cards`
- `File cards`
- `Dashboard continuation cards`
- `compact row cards`
- `selection cards`
- `summary/stat cards`

## Taxonomia aprovada

### Entity card

- uso: `Project`, `Production`, `Content`
- ordem: titulo -> descricao -> metadata -> status -> acoes
- regra: sem eyebrow redundante quando a rota ja define a familia

### Media card

- uso: `Galeria`, `Arquivos`
- ordem: midia -> titulo/status -> metadata -> acoes
- regra: a midia continua protagonista; sem overlay decorativo

### Work item card

- uso: rascunhos de `Imagens`, `Videos`, continuidade equivalente
- ordem: titulo -> contexto -> `Project` -> `Production` -> status -> atualizado -> acoes
- regra: cards e lista compartilham a mesma ordem semantica

### Compact row card

- uso: modo Lista de rascunhos e itens compactos equivalentes em `Production`
- ordem: titulo -> metadata densa -> acoes do item
- regra: cada item e uma unidade individual; nao existe card externo coletivo com divisorias

### Selection card

- fora do escopo de migracao nesta rodada

### Summary/stat card

- fora do escopo de migracao nesta rodada

## Contratos congelados

### Eyebrow

- opcional
- usar somente quando adiciona contexto operacional real
- nao usar quando rota, secao, badge ou titulo ja explicam o tipo
- nunca repetir `IMAGEM` + `Imagem`, `PROJECT` em `/projetos`, `PRODUCTION` em listas homogeneas

### Lista de rascunhos

- `Imagens` e `Videos` em modo Lista usam `compact row cards` individuais
- Lista e Cards compartilham:
  - ordem semantica
  - status
  - metadata
  - hierarquia de acoes
  - conteudo funcional
- diferem apenas em densidade e arranjo

## Primitivas e tokens

### Tokens pequenos adicionados

- `--card-background`
- `--card-background-hover`
- `--card-border`
- `--card-border-hover`
- `--card-title`
- `--card-description`
- `--card-metadata-label`
- `--card-metadata-value`
- `--card-media-background`
- `--card-selected-background`
- `--card-selected-border`

### Primitivas compostas adicionadas

- `CardEyebrow`
- `CardMedia`
- `CardActions`

### Primitivas refinadas

- `Card`
- `CardTitle`
- `CardDescription`
- `ContextMetadata` com variante `dense`

## Pilotos aprovados

- `components/projects/project-list.tsx`
- `app/(dashboard)/projetos/[id]/page.tsx`
- `components/dashboard/continuation-hub.tsx`
- `app/(dashboard)/imagens/page.tsx`
- `app/(dashboard)/videos/page.tsx`
- `app/(dashboard)/galeria/page.tsx`

## Expansao controlada aprovada

### Call sites migrados

- `app/(dashboard)/arquivos/page.tsx`
  - `File cards` agora usam `CardMedia`, `CardTitle`, `ContextMetadata dense` e `CardActions`
- `app/(dashboard)/conteudos/page.tsx`
  - `Content cards` alinham titulo, metadata densa e acao primaria na mesma anatomia de entity card
- `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`
  - rows de `Imagens`, `Videos` e `Conteudos editoriais` migradas para compact/work item cards individuais

### Call sites mantidos sem migracao nesta rodada

- `selection cards`
  - motivo: familia diferente, sem equivalencia direta comprovada
- `summary/stat cards`
  - motivo: exigem contrato proprio e nao se beneficiam de copiar entity/media cards
- formularios, layouts e cards de configuracao
  - motivo: fora do escopo do DS-1F
- listas sem equivalencia clara
  - motivo: decisao transversal pertence ao DS-1H

## Metadata

- ordem consistente por familia
- labels e values explicitos
- modo `dense` para rows compactas e cards operacionais
- wrap preservado sem grades rigidas por pagina

## Acoes

- primaria inequívoca por papel real
- secundarias e complementares mantidas no contrato do DS-1E
- `CardActions` reduz dispersao e estabiliza wrap responsivo

## Status

- continuam semanticamente separados do tema
- badges nao substituem titulo ou tipo
- Studio nao converte status em brand

## Midia

- `Galeria` preserva protagonismo visual da imagem
- `Arquivos` preserva separacao entre thumbnail, chrome e metadata
- sem overlays decorativos sobre thumbnails

## Temas

### Light / Dark / System

- continuam usando a mesma anatomia
- nao dependem da atmosfera Studio

### Studio

- mesma anatomia estrutural
- apenas acrescenta linguagem do tema ja aprovada: superfícies, gradacao, microtipografia legitima e borda superior discreta onde ja existe

## Acessibilidade

- sem card inteiro clicavel quando existem acoes internas
- metadata textual preservada
- foco continua nos controles internos
- titulos e acoes principais continuam explicitamente legiveis

## Responsividade

- contratos validados em `1600`, `1280`, `1024`, `768` e `390`
- `390px` continua com o shell estrutural legado fora do escopo
- DS-1F nao introduz correcao escondida do shell mobile

## Smoke desta rodada

### Validado diretamente

- `Projetos`
- `Project detail`
- `Imagens` em Lista e Cards
- `Videos` em Lista e Cards
- `Galeria`
- `Arquivos`
- `Conteudos`
- rows compactas de `Production` por inspecao de codigo, typecheck e smoke autenticado

### Evidencias principais

- eyebrows redundantes removidos dos pilotos
- rows de Lista agora sao cards individuais
- metadata e acoes seguem a mesma ordem semantica entre Lista e Cards
- `Arquivos` e `Conteudos` passaram a consumir o mesmo contrato compartilhado
- sem overflow horizontal novo observado nos pilotos expandidos; o shell legado de `390px` permanece fora do escopo

## Itens nao migrados

- selection cards
- summary/stat cards
- superficies que exigem nova anatomia

## Deferido para DS-1G

- consolidar familias realmente adotadas como primitivas oficiais
- revisar usos locais remanescentes fora das primitivas
- formalizar ou remover primitivas que nao tiverem reuso comprovado

## Deferido para DS-1H

- decidir onde faz sentido oferecer Lista/Cards
- adocao transversal rota por rota
- hardening responsivo final
- shell estrutural em `390px`

## Riscos

- ainda existem call sites locais que usam `Card` parcialmente e podem precisar da consolidacao do DS-1G
- algumas superficies mistas podem demandar contrato proprio em vez de herdar entity/media/work item

## Resultado

DS-1F comprova uma taxonomia real de cards e expande apenas para familias equivalentes, sem universalizacao forcada e sem redesign amplo.
