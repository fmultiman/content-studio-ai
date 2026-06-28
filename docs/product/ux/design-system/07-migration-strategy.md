# Migration Strategy

A migracao para o Design System V1 requer uma abordagem cirurgica, baseada em camadas progressivas. As mudancas nunca devem quebrar a compatibilidade dos fluxos atuais do usuario. A meta é gradativamente trocar primitivos isolados e classes soltas por estruturas consolidadas.

## Fases de Migração (DS-1 a DS-8)

### DS-1 — Foundations and Semantic Tokens
**O que é:** Criacao das variaveis CSS globais semanticas (Theme and Token Proposal). Alteracao leve no Tailwind Config para usar estas variaveis no lugar de cores estaticas.
**Atuacao:** `globals.css`, `tailwind.config.ts`, `app/layout.tsx`.
**Risco:** Baixo, mas pode gerar quebras de contraste em componentes hardcoded.

### DS-2 — Shared Shell and Page Structure
**O que é:** Consolidacao dos arquétipos estruturais de topo. Implementacao do componente `PageHeader`. Padronizacao do `Sidebar` e envolucro global de container (`Shell`).
**Atuacao:** Modulos compartilhados (`components/layout`).

### DS-3 — Cards, Lists and Metadata
**O que é:** Implementacao das familias de cards e consolidacao de Listas e Tabelas, aproveitando a correcao densa feita no UX-H4B1. Implantacao do `StatusBadge`.
**Atuacao:** Hubs de Imagens, Videos, Galeria, Dashboard (OperationalCards).

### DS-4 — Forms, Dialogs and Settings
**O que é:** Reconciliacao dos componentes de entrada de dados, espacamentos e tabs de paineis configuracionais. Callouts passam a ser usados para informar ao usuario o status das operacoes.
**Atuacao:** `/configuracoes`, Modais e Popovers globais.

### DS-5 — Project Surfaces
**O que é:** Refatoracao das superficies dependentes de `Project`, incluindo `Project Detail`, formataçao correta do fluxo de `Project Identity` com callouts e badges canonicos.
**Atuacao:** Modulos ligados a `/projetos/`.

### DS-6 — Image Workspace
**O que é:** Uniformizacao de geracao, edicao e visualizacao da feature Imagens de alta fidelidade usando as pecas dos lotes anteriores. Implementacao solida do OutputCard e FilterBar.

### DS-7 — Video Workspace
**O que é:** Pareado com o de imagens, focando em lidar com a apresentacao (cards) de timeline e rascunhos em geracao iterativa.

### DS-8 — Visual QA and Cleanup
**O que é:** Remocao fina de qualquer classe legada estatica que permaneceu viva; garantia do padrao AAA de acessibilidade; refinamento estético profundo do tema `Studio`. Resolucao das pendencias categorizadas como DEFERRED.

---

## Pagina Piloto Recomendada

Para a execucao conjunta de DS-1 a DS-3 (como validacao visual interativa dos 3 Temas), recomendamos que a implementacao comece **pela Rota de Projetos (`/projetos`)**.

### Justificativa do Piloto

- **Representativa:** O modulo "Projetos" e um modulo hub (Entity Collection) com PageHeader, lista/grid de entidades, botoes primarios e acesso rapido, testando 70% dos componentes base.
- **Risco Controlado:** Tem impacto transacional menor que as ferramentas de geracao pesada (Images/Videos) ou os workspaces mutaveis da Production. Erros pontuais de display nela nao estragam prompts ou outputs.
- **Sem Complexidade Adicional:** Permite comparar esteticamente de imediato as abas de "Light", "Dark", "Studio" num espaco amplo com dados ja preenchiveis em banco (cards the texto).
- **Evitar Imagens/Videos primeiro:** Imagens e Videos contem logica de estado complexa (gerando, finalizado, assinaturas falhas) recem tratadas no UX-H4. Mexer nelas em paralelo a um design token system pode trazer falsos-positivos de erro e regressions.

## Criterios de Aceitacao (Para cada Lote)
- Contratos funcionais intactos (Criar / Editar / Listar).
- Compatibilidade absoluta (mobile-ready, no horizontal overflow).
- Temas trocaveis sem reflesh via provider.
