# Page Archetypes

Este documento define e agrupa as telas atuais do Content Agent Studio em padroes de layout comuns (Arquétipos). O objetivo é padronizar a estrutura em todas as paginas que sirvam ao mesmo proposito, facilitando a aplicacao de estilos universais e contratos responsivos consistentes.

## Arquétipos

### 1. Operational Overview
- **Propósito:** Oferecer um painel agregador (Dashboard), unindo metricas rapidas com colecoes de entidades principais para retomada rapida de trabalho (continuacao).
- **Estrutura Recomendada:**
  - `PageHeader` (Hero com saudação, métricas chave ou acoes globais, ex: "Continuar trabalhando")
  - `MetricStrip` (Seccao superior com contadores macro e indicadores de estado)
  - `CollectionPanel` (Grupo de `OperationalCard`s, listagens compactas de retomar projetos ou drafts recentes)
- **Densidade:** Média/Baixa, baseada em blocos. Sem grandes grids fechados.
- **Exemplos Atuais:** `/dashboard`.
- **Referencia Hermes:** Tab "Overview" (Radar, Metrics, Operations Grid).

### 2. Entity Collection (Hub / Library)
- **Propósito:** Pagina de gerenciamento e pesquisa de volume massivo de entidades similares com metadados estruturados, onde a varredura e a acao sao primordiais.
- **Estrutura Recomendada:**
  - `PageHeader` (Com H1, Descricao e `ViewModeToggle`)
  - `FilterBar` ou `FilterCard` (Search, Project, Status, Clear)
  - `EntityGrid` ou `ResponsiveEntityList` (Colecoes em Grid para modo visual ou List para tabular/2-faixas).
- **Densidade:** Alta. Foco em ler metadados (Project/Production/Data).
- **Exemplos Atuais:** `/imagens`, `/videos`, `/projetos` (futuro).
- **Referencia Hermes:** Tab "Tasks" / "Agents" ou Lists.

### 3. Filtered Library (Visual Asset Output)
- **Propósito:** Otimizado estritamente para visualizacao e recuperacao de outputs de midia finais. Diferente do hub, a entidade de valor e a midia final visual, e nao o draft (rascunho).
- **Estrutura Recomendada:**
  - `PageHeader`
  - `FilterRail` lateral ou `FilterCard` colapsavel top.
  - Grade Mista, priorizando Visual Asset Cards densos de Thumbnail.
- **Densidade:** Alta (Grade de midia) / Tabular restrita.
- **Exemplos Atuais:** `/galeria`, `/arquivos` (uploads visuais).
- **Referencia Hermes:** Composições visuais flexiveis / "Split views" com grid dominante.

### 4. Split Workspace (Master-Detail)
- **Propósito:** Editar configuracoes extensas ou textos onde a navegação entre recursos é a esqueda (ou topo em mobile) e o edicao detalhada é a direita (principal).
- **Estrutura Recomendada:**
  - Header compacto
  - `SplitWorkspace` (PanelEsquerdo `1fr`, Reader/DetailPanel `2-3fr`).
- **Densidade:** Média. Focado em legibilidade do Reader/DetailPanel.
- **Exemplos Atuais:** `/conteudos` (quando um post é aberto para edição ao lado de index), Layouts Master-detail.
- **Referencia Hermes:** Tab "Content" (Listagem e Visualização).

### 5. Context / Generation Workspace
- **Propósito:** O espaco de fluxo para criacao multimodal (ex: Production Workspace ou Editores). Area complexa, necessita de Paineis de estado, tabs isoladas por contexto e formulários em bloco.
- **Estrutura Recomendada:**
  - `PageHeader` com Metadados da entidade pai (Project/Production e StatusBadge).
  - Tabs superiores.
  - Abas contendo `FieldGroup`s e paineis parciais divididos (Contexto herdado, Edição ativa, Output).
- **Densidade:** Muito Alta, dividida logicamente.
- **Exemplos Atuais:** `/projetos/[projectId]/producoes/[productionId]`, Projeto Identidade, Images/Videos em modo edicao/criacao.

### 6. Settings / Administration Surface
- **Propósito:** Controle isolado, focado num escopo fechado de configuracoes de usuario, faturamento, chaves API (Providers).
- **Estrutura Recomendada:**
  - Navigation Lateral ou Tabs primárias.
  - `SettingsSection` (com Callouts de Information e Forms estruturados).
- **Densidade:** Baixa. Legibilidade vertical com blocos formais e descritivos.
- **Exemplos Atuais:** `/configuracoes`, `/projetos/[projectId]` (Setup Basico).

### 7. Authentication Surface
- **Propósito:** Tela estrita para login e signup.
- **Estrutura Recomendada:** Container pequeno centralizado em viewports vazios. Sem Shell complexa.
- **Exemplos Atuais:** `/auth/login`.
