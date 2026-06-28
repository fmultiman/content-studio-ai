# Current UI Inventory

Este inventario documenta as rotas visíveis e superficies do Content Agent Studio com base na estrutura atual.

## Rotas Principais e Superficies

| Rota / URL | Superficie (Nome) | Objetivo | Entidade Principal | Componentes Chave | Padrão Responsivo Atual | Dependência UX-H4 |
| --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | Dashboard | Ponto central de retomada operacional e metricas. | Projects, Productions, Rascunhos | Cards de retomada, sections | Desktop/mobile basico, secoes stackadas | Menor, foca em hierarquia visual |
| `/projetos` | Projects | Listagem de Projetos globais. | Project | Cards pequenos | Cards em Grid / stack | Nao prioritario, sem overlap de tabela |
| `/projetos/[id]` | Project Detail | Espaco de trabalho contextual do Projeto. | Project | Abas, Paineis | Stack basico, container max-w-4xl | Depende de padronizacao de Form / Abas |
| `/projetos/[id]/identidade` | Project Identity | Definicao de Identidade e tom do Projeto | Project Identity | Cards, Callouts contextuais | Nao avaliado profundamente na lista | Nao |
| `/projetos/[id]/producoes/[id]`| Productions / Workspace | Modulo de geracao e fluxo multimodal | Production | Tabs, Paineis de geracao | Abas e grids interativos | Pendente revisao de hierarquia |
| `/imagens` | Imagens Hub | Central global de geracao visual e rascunhos | Image / Draft | FilterCard, ViewModeToggle, ListRow, Cards | Duas faixas em desktop, stack mobile | Sim (resolvido H4B1) |
| `/videos` | Videos Hub | Central global de rascunhos de video | Video / Draft | FilterCard, ViewModeToggle, ListRow, Cards | Duas faixas em desktop, stack mobile | Sim (resolvido H4B1) |
| `/conteudos` | Editorial Content | Central de textos e rascunhos editoriais | Draft / Texto | ToggleGroup inline, Cards clicaveis | Inicial, sem refinamento | Sim (UX-H4B2/B3) |
| `/galeria` | Galeria | Biblioteca global de assets gerados | Output Asset | Preview, ViewModeToggle, Cards visuais | Cards default, Lista: tabular -> stack | Sim (resolvido H4B1) |
| `/arquivos` | Assets (Arquivos) | Uploads globais e insumos de midia | Uploaded Asset | Bibliotecas de pastas | Altamente condensado em mobile | Sim (fases posteriores) |
| `/configuracoes` | Settings | Preferencias do sistema e do usuario | Usuario / Workspace | Abas laterais/superiores | Tabs com labels ocultos em mobile | Sim (UX-H4B4) |
| `/auth/login` | Auth | Autenticacao e acesso inicial | Usuario | Formulario centrado | Centralizado | Nao |

## Problemas e Inconsistencias (UX-H4A Findings)

1. **Hierarquia de Texto:** Paginas usam hierarquias diferentes (Galeria tem 2 H1, Dashboard usa H2 como saudacao e secoes em H3, Conteudos usa text-transform uppercase para titulo).
2. **Cards:** O visual dos Cards esta fragmentado em diferentes formatos, tamanhos (paddings) e raio da borda (radius), dependendo se foram feitos para Dashboard, Hubs ou Projetos antigos.
3. **Filtros:** Multiplos formatos de filtro operam simultaneamente no produto (Cards grandes, Filter Cards densos, Filtros inline textuais).
4. **Botoes / Acoes:** Multiplos verbos semelhantes ("Visualizar", "Abrir", "Ver Production") com posicoes distintas, confundindo usuarios sobre se o asset e o foco ou se o direcionamento de pagina e o foco.
5. **Estados:** Empty States, Loadings e avisos (Callouts) foram desenvolvidos com variados pesos visuais, uns com apenas spinner, outros densos de descricao.

## Loading e Empty States

As superficies possuem estados variados:
- **Loading:** Varia desde mensagens em bloco (Projetos) ate simples text-less spinners (Conteudos e Configuracoes).
- **Empty States:** Alguns hubs possuem respostas personalizadas ("sem Project", "sem Production") enquanto a Galeria tem um tratamento robusto de falha/reinicio com o recente UX-H4B1.
- **Erros:** Acessos perdidos e indisponibilidades carecem de uma linguagem unica (WarningCallout vs InfoCallout).
