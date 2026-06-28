# Structural Mapping

A Matriz de Correspondência abaixo centraliza o de-para (arquitetura proposta versus estado atual) de cada superfície.

## Confiança de Estados

* **CONFIRMED**: Padrão claramente sustentado pelo produto atual e auditado sem restrições graves.
* **CANDIDATE**: Recomendação forte, baseada em boas práticas (ou inspirada no Hermes), mas ainda exige validação de um humano.
* **UX-H4 DEPENDENT**: Depende de decisão/correção em andamento na auditoria `UX-H4*` (ex: listas, densidade responsiva).
* **DEFERRED**: Não será consolidado na V1 inicial. Pode sofrer refatorações mais profundas posteriormente (ex: Arquivos, Conteudos editoriais completos).

## Matriz de Correspondencia

| Superficie | Arquétipo Recomendado | Estrutura Atual | Estrutura Recomendada | Componentes Compartilhados Candidatos | Responsividade | Tema | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Dashboard** | Operational Overview | Sections (H2/H3), Cards retomada | PageHeader, MetricStrip, Activity Feed | PageHeader, OperationalCard, StatusBadge | Duas colunas -> Stack | Default | CANDIDATE |
| **Projects** | Entity Collection | Cards de grid simples | PageHeader, FilterBar, EntityGrid | PageHeader, FilterBar, OperationalCard | Grid -> Stack | Default | CANDIDATE |
| **Project Detail** | Context Workspace | Master-detail solto | Tabs, SectionHeaders, ContextBadge | SectionHeader, StatusBadge | Max-w-4xl, Stack | Default | CANDIDATE |
| **Project Identity**| Context Workspace | Grid/Stack de callouts | PageHeader, InfoCallout, SettingCard | ContextBadge, InfoCallout | Stack | Default | CONFIRMED |
| **Productions** | Context Workspace | Abas, Paineis de step | Tabs globais, SplitWorkspace | SplitWorkspace, ContextBadge, LoadingState | Grid -> Drawer/Stack | Default | DEFERRED |
| **Images Hub** | Entity Collection | FilterCard, Lista tabular falha/Grids | PageHeader, FilterBar, ResponsiveEntityList | FilterBar, ListRow, StatusBadge, ViewModeToggle | 2-faixas -> Stack | Default | CONFIRMED |
| **Videos Hub** | Entity Collection | FilterCard, Lista tabular falha/Grids | PageHeader, FilterBar, ResponsiveEntityList | FilterBar, ListRow, StatusBadge, ViewModeToggle | 2-faixas -> Stack | Default | CONFIRMED |
| **Galeria** | Filtered Library | FilterCard, Lista densa/Grids visuais | PageHeader, FilterCard, OutputCard Grid | PageHeader, OutputCard, StatusBadge, EmptyState | 2-faixas -> Stack | Default | CONFIRMED |
| **Drafts / Conteúdos**| Split Workspace | Inline text filtros, cards brutos | FilterBar simplificada, EditorialItemCard | PageHeader, FilterBar, EmptyState | Master/Detail -> Drawer | Default | DEFERRED |
| **Assets/Arquivos** | Entity Collection | Bibliotecas, Upload zone | Tabs: Upload vs Browser. Grade visual. | SectionHeader, ListRow, ViewModeToggle | Denso (Requer revisão) | Default | DEFERRED |
| **Settings** | Settings Surface | Tabs densas e modais soltos | Sidebar nav local, SettingsSection, FieldGroup | SettingsSection, WarningCallout, FieldGroup | Nav top/lateral -> Stack | Default | CANDIDATE |
| **Auth** | Authentication Surface| Centralizado | Preservar minimalismo | - | Stack | Default | CONFIRMED |

## Componentes Estruturais (Sistema de Composicao Candidato)

### 1. `PageHeader`
* **Responsabilidade:** Única fonte do `<h1>` da pagina, provendo descricao auxiliar, badges globais (ex: Identity) e acao primaria de criacao.
* **Uso:** Todas as rotas base (`/dashboard`, `/imagens`, `/videos`, etc).
* **O que não deve conter:** Listas, metricas complexas, filtros densos.
* **Variantes:** Default (Title, Subtitle), WithAction, WithBadge.
* **Risco de abstracao:** Medio, precisa lidar bem com larguras flexiveis de CTA.

### 2. `FilterBar` (Ou `FilterCard`)
* **Responsabilidade:** Controle de busca (Search), dropdowns de estado e Project.
* **Uso:** Hubs e Bibliotecas.
* **O que não deve conter:** Ações que mudam paginas nao relacionadas ao filtro atual (ex: Criar Novo), que pertencem ao Header.
* **Responsividade:** Em telas estreitas, quebra para blocos de inputs stackados.

### 3. `ResponsiveEntityList` / `ListRow`
* **Responsabilidade:** Apresentar entidades mantendo coerencia e consistencia nos metadados.
* **Uso:** Hubs (`/imagens`, `/videos`) e Galeria (modo list).
* **Dependencias:** Fortemente acoplado aos achados do `UX-H4B1`.
* **Comportamento responsivo:** Quebra de Grid tabulado em 2-faixas, escondendo headers abstratos, e convertendo para stack compacto em Mobile.

### 4. `OutputCard`
* **Responsabilidade:** Representar outputs midiaticos de alta fidelidade (Thumbnails + Metadados rapidos + Acoes secundarias).
* **Uso:** Galeria e Arquivos.
* **Risco de abstracao:** Baixo.

### 5. Callouts (`InfoCallout`, `WarningCallout`)
* **Responsabilidade:** Informacao inline permanente (ex: "Voce não tem Provider configurado" ou "Project Identity herdado").
* **Uso:** Project Identity, Configuracoes, Productions Workspace.
* **Variantes:** Info (Azul/Violeta discreto), Warning (Amarelo/Laranja), Error (Vermelho).
* **Risco de abstracao:** Muito baixo, altamente recomentavel criar um `Alert` estendido do Shadcn.
