# Migration Strategy

> Atualizacao pos-UX-H4: este documento continua sendo um guia de sequenciamento para DS-1 em diante. Ele nao substitui os contratos reconciliados em `10-post-ux-h4-reconciliation.md`. `PageHeader`, `ContextMetadata`, `StatusBadge` e `StateMessage` ja existem como contratos comprovados na aplicacao; DS-1 devera formalizar sua anatomia visual, tokens e governanca, nao redescobri-los.

A migracao para o Design System V1 continua exigindo uma abordagem cirurgica, em camadas progressivas. O objetivo e formalizar visualmente o que o produto aprovou sem quebrar fluxos reais nem reabrir as decisoes semanticas consolidadas no UX-H4.

## Fases de Migracao (DS-1 a DS-8)

### DS-1 - Foundations and Semantic Tokens

**O que e:** criacao das variaveis CSS semanticas globais, mapeamento inicial de tons, espacamento, radius, elevacao e tipografia.
**Atuacao:** `globals.css`, `tailwind.config.*`, `app/layout.*` e documentacao de foundations.
**Risco:** baixo a medio; pode revelar hardcodes legados e contrastes insuficientes.

### DS-2 - Shared Shell and Page Structure

**O que e:** formalizacao visual e documental dos arquetipos estruturais de topo ja aprovados. `PageHeader` deixa de ser apenas implementacao funcional e passa a ter anatomia visual canonica.
**Atuacao:** `components/layout`, containers compartilhados e espacamento estrutural entre header e conteudo.
**Risco:** medio; nao pode reabrir o contrato de um unico `h1` nem competir com workspaces.

### DS-3 - Cards, Lists and Metadata

**O que e:** formalizacao visual das familias de cards e consolidacao das listas responsivas aprovadas em H4B1, com metadata e badges em ordem estavel. `StatusBadge` ganha variante visual formal sem reabrir o contrato semantico.
**Atuacao:** Dashboard, Projetos, Imagens, Videos, Galeria, Conteudos e Arquivos.
**Risco:** medio; diferencas de entidade precisam continuar visiveis.

### DS-4 - Forms, Dialogs and Settings

**O que e:** consolidacao visual de formularios, feedback inline, states operacionais, dialogs e tabs de Configuracoes, aproveitando os contratos aprovados em H4B4.
**Atuacao:** formularios compartilhados, modais e superficie de Configuracoes.
**Risco:** medio; nao deve virar framework global de forms ou states.

### DS-5 - Project Surfaces

**O que e:** refinamento das superficies dependentes de `Project`, incluindo detalhes estruturais, `Project Identity` e transicoes com `Production`, agora ja apoiadas pelos contratos de header, metadata, status e states.
**Atuacao:** modulos ligados a `/projetos/`.
**Risco:** medio; precisa preservar a diferenca entre detalhe estrutural e workspace.

### DS-6 - Image Workspace

**O que e:** formalizacao visual do workspace de Imagens, sem reabrir contratos de provider, retry ou listas responsivas.
**Atuacao:** paineis, grupos de campos, blocos de resultado e callouts operacionais.
**Risco:** medio a alto; nao deve mascarar estados reais com visual excessivo.

### DS-7 - Video Workspace

**O que e:** equivalente de Imagens para Videos, respeitando cenas, imagem-base, storyboard e publicacao rapida.
**Atuacao:** paineis de cena, feedback inline e blocos de operacao do modulo de Videos.
**Risco:** medio a alto; precisa preservar diferencas de dominio entre os modulos irmaos.

### DS-8 - Visual QA and Cleanup

**O que e:** limpeza final de classes legadas, verificacao transversal de acessibilidade, motion, iconografia e refinamento sistemico.
**Atuacao:** QA transversal e eliminacao de resquicios fora do contrato DS-1.
**Risco:** medio; nao deve virar redesign aberto.

## Pagina piloto recomendada

Para iniciar DS-1 a DS-3, a rota mais segura continua sendo **`/projetos`**.

### Justificativa

- representativa: combina `PageHeader`, CTA principal, filtros, cards estruturais e metadata sem a complexidade dos workspaces multimodais;
- risco controlado: impacto transacional menor que Imagens, Videos e Galeria;
- leitura clara: boa superficie para validar tipografia, espacamento, botoes e cards sem efeitos colaterais de providers, signed URLs ou cenas;
- continuidade com UX-H4: foi rota piloto no H4B2 e continua adequada para consolidacao visual.

## Criterios de aceitacao por lote

- contratos funcionais intactos;
- nenhuma regressao de responsividade;
- nenhuma reabertura de decisoes semanticas do UX-H4;
- compatibilidade mobile sem overflow horizontal;
- separacao clara entre contrato comprovado e visual formalizado no DS-1.
