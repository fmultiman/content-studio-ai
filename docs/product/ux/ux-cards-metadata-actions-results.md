# UX-H4B3 - Cards, metadata e acoes

Data: 2026-06-28  
Branch: `feat/ux-cards-metadata-actions-h4b3`

## Escopo

Este lote reconciliou a camada interna das superfícies operacionais do Studio:

- familias de cards;
- ordem e peso de metadata;
- badges e status;
- acoes principais e secundarias;
- verbos de acao;
- continuidade entre Cards e Lista.

O resultado ficou alinhado conceitualmente ao briefing aprovado do DS-0R, sem afirmar leitura direta de documentos indisponiveis nesta branch e sem implementar DS-1.

## Inventario de familias

Familias consolidadas nesta rodada:

- `ContinuationCard`: Dashboard para Productions, itens recentes e Projects recentes;
- `ProjectCard`: colecao estrutural em `/projetos`;
- `ProductionCard`: cards de Production em `/projetos/[id]`;
- `DraftCard`: Imagens e Videos, em Cards e Lista;
- `GeneratedOutputCard`: Galeria, em Cards e Lista;
- `EditorialContentCard`: lista editorial em `/conteudos`;
- `FileCard`: biblioteca de uploads em `/arquivos`.

Nao foi criado um `UniversalCard`.

## Divergencias encontradas

Antes da implementacao havia quatro grupos principais de divergencia:

1. metadata na ordem errada ou comprimida:
   - status antes do titulo em alguns cards;
   - Project e Production em ordens diferentes;
   - datas e contexto misturados em uma linha unica.
2. acoes com verbos e peso visual diferentes:
   - `Abrir`, `Abrir Project`, `Ver`, `Visualizar`, `Continuar Production`;
   - cards clicaveis sem acao explicita.
3. badges inconsistentes:
   - mesmo status com variantes diferentes;
   - badges visuais disputando espaco com titulo.
4. familias equivalentes com densidade interna diferente:
   - Dashboard, Projetos, Conteudos, Galeria e Arquivos pareciam evoluidos em fases separadas.

## Contrato de metadata

Ordem consolidada quando os campos existem:

```text
titulo
descricao ou resumo
Project
Production
status
tipo/origem quando relevante
atualizado
acoes
```

Regras aplicadas:

- `Project` sempre antes de `Production`;
- status passa a ter peso secundario e nao ocupa o lugar do titulo;
- data permanece como informacao secundaria;
- fallbacks legados continuam explicitos, como `Sem Production associada`;
- Cards e Lista continuam representando a mesma entidade com semantica equivalente.

## Contrato de acoes

Regras consolidadas:

- proxima acao natural de navegacao: `Abrir`;
- continuidade operacional: `Continuar Production`;
- visualizacao de asset: `Visualizar`;
- retorno contextual: `Abrir origem`;
- navegacao estrutural para Production: `Ver Production`;
- download: `Baixar`;
- acoes destrutivas continuam secundarias e fora da linha principal quando possivel.

## Verbos harmonizados

Verbos finais por familia:

- Dashboard:
  - `Continuar Production`
  - `Abrir`
- Projetos:
  - `Abrir`
- Productions em Project detail:
  - `Abrir`
- Drafts de Imagens e Videos:
  - `Abrir`
  - `Ver Production`
- Galeria:
  - `Visualizar`
  - `Abrir origem`
  - `Ver Production`
  - `Baixar`
- Conteudos:
  - `Abrir`
- Arquivos:
  - `Visualizar`
  - `Baixar`

## Badges e status

Foi introduzido `StatusBadge` para reduzir variacao de badge sem criar um sistema novo de tokens.

Tons aplicados:

- positivo:
  - `Aprovada`
  - `Pronto`
  - `Ativa`
- aviso:
  - `Gerando`
- perigo:
  - `Rejeitada`
- neutro:
  - `Rascunho`
  - `Arquivado`

Status continuam textuais e nao dependem apenas de cor.

## Abstracoes criadas

- `components/ui/context-metadata.tsx`
  - composicao simples de label + value;
  - sem conhecimento de dominio.
- `components/ui/status-badge.tsx`
  - padrao leve para texto + tom visual;
  - sem novo sistema de cores.

## Abstracoes recusadas

Foram explicitamente evitados:

- `UniversalCard`;
- `EntityCardConfig`;
- menu global de tres pontos para todo o produto;
- data grid generico;
- camada de acao universal escondendo semantica de dominio.

## Paginas alteradas

### Dashboard

- cards de continuidade ganharam metadata mais clara;
- itens recentes agora mostram `Project`, `Production`, `Status` e `Atualizado` em ordem consistente;
- Projects recentes passaram a usar `Abrir` como navegacao explicita.

### Projetos

- cards deixaram de depender do clique no container inteiro;
- acao principal ficou explicita em `Abrir`;
- metadata enganosa de `0 imagens` foi removida;
- status e atualizacao ficaram visiveis e honestos.

### Project detail

- cards de Production passaram a ter acao primaria explicita;
- tipo de Production continua distinto de status;
- metadata ficou mais clara sem transformar Production em card de Project.

### Imagens e Videos

- H4B1 permaneceu preservado;
- Cards e Lista agora exibem `Project`, `Production`, `Status` e `Atualizado` com a mesma ordem;
- `meta` (`Prompt gerado`, `Sem prompt`, `2 cenas`) ficou visivel perto do titulo;
- verbos continuam espelhados entre os dois modulos.

### Galeria

- outputs ganharam a mesma gramatica entre Cards e Lista;
- status deixou de competir com o titulo;
- `Abrir origem` passou a ficar disponivel junto das demais acoes quando valido;
- `Ver Production` e `Baixar` continuam condicionais;
- preview e dialogo permaneceram intactos no contrato.

### Conteudos

- card editorial passou a ter acao explicita `Abrir`;
- contexto `Project` e `Production` deixou de ficar comprimido em uma linha unica;
- status e atualizacao ganharam peso consistente.

### Arquivos

- arquivos agora deixam visivel o `Project` e a `Pasta`;
- imagens ganharam `Visualizar` explicito, sem depender apenas da thumbnail;
- `Baixar` permanece disponivel;
- a biblioteca continua distinta da Galeria.

## Preservacao de H4B1 e H4B2

Continuaram preservados:

- listas responsivas de Imagens, Videos e Galeria;
- Page Header e hierarquia de paginas;
- filtros, preferencias, rotas e queries existentes;
- preview, download e origem da Galeria;
- distincoes entre hubs, bibliotecas e workspaces.

## Responsividade

Verificado durante implementacao para:

- `1600px`
- `1280px`
- `1024px`
- `768px`
- `390px`

Direcoes preservadas:

- acoes podem quebrar linha;
- metadata continua legivel sem overflow;
- badges nao comprimem o titulo;
- Cards e Lista permanecem coerentes entre desktop e mobile.

## Acessibilidade

- acoes principais ficaram explicitas em texto;
- navegacao deixou de depender mais de cards inteiros clicaveis em superficies estruturais;
- status continuam textuais;
- metadata usa relacao semantica de label e valor;
- acoes indisponiveis saem do DOM quando nao se aplicam na Galeria.

## Testes

Cobertura focada atualizada em:

- `lib/__tests__/cards-metadata-actions.test.tsx`
- `lib/__tests__/dashboard-continuation.test.ts`
- `lib/__tests__/draft-hub.test.ts`
- `lib/__tests__/gallery-output-library.test.ts`
- `lib/__tests__/page-hierarchy-context.test.tsx`

Validacoes principais:

- `Project` antes de `Production`;
- status textual;
- verbos consistentes;
- equivalencia semantica entre Cards e Lista;
- preservacao de preview, origem, Production e download na Galeria;
- distincoes entre Arquivos e outputs;
- preservacao de H4B1 e H4B2.

## Itens deixados para H4B4

- estados globais de empty/error/loading/success;
- callouts globais;
- formularios e tabs mobile;
- consolidacao ampla de copy;
- refinamentos de densidade em workspaces internos fora do escopo de cards/listas.

## Riscos residuais

- algumas telas ainda usam copy historica ou strings com acentuacao inconsistente fora deste lote;
- a biblioteca de Arquivos ainda e mais densa que a Galeria e pode merecer um lote proprio de superficie;
- os cards internos de workspace na pagina de Production nao foram transformados em um sistema transversal, apenas mantidos compatveis com o contrato geral.

## Plano de smoke

Checklist recomendado:

```text
/dashboard
/projetos
/projetos/[id]
/imagens
/videos
/galeria
/conteudos
/arquivos
```

Validar em Cards e Lista quando existirem:

- ordem de metadata;
- verbos finais;
- acoes condicionais;
- badges/status;
- ausencia de overflow;
- preservacao de H4B1 e H4B2.

## Resultado do smoke autenticado

O smoke autenticado foi aprovado em desktop, tablet e mobile, com confirmacao final humana dos fluxos criticos.

Superficies aprovadas:

- Dashboard;
- cards de Project em `/projetos`;
- cards de Production em `/projetos/[id]`;
- Imagens em Cards e Lista;
- Videos em Cards e Lista;
- Galeria em Cards e Lista;
- Conteudos;
- Arquivos dentro dos dados operacionais disponiveis.

Confirmacoes transversais do smoke:

- familias de cards mantiveram linguagem coerente sem perder diferencas de entidade;
- contrato de metadata permaneceu legivel, com `Project` antes de `Production`;
- fallback `Sem Production associada` permaneceu claro;
- labels de status encontrados no ambiente permaneceram textuais, incluindo `Ativo`, `Ativa`, `Rascunho`, `Gerada` e `Aprovada`;
- verbos finais permaneceram semanticamente coerentes: `Abrir`, `Continuar Production`, `Visualizar`, `Ver Production`, `Abrir origem` e `Baixar`;
- Cards e Lista continuaram semanticamente equivalentes em Imagens, Videos e Galeria;
- responsividade aprovada em `1280px`, `768px` e `390px`, com spot-check adicional em `1600px`;
- acessibilidade pratica preservada, com acoes explicitas em texto, badges com label e ausencia de overflow horizontal;
- contratos aprovados em H4B1 e H4B2 permaneceram intactos.

Spot-checks adicionais:

- Conteudos: o spot-check humano final confirmou que a acao `Abrir` navega para o destino editorial correto.
- Arquivos: nao havia itens operacionais suficientes para validar `Visualizar` e `Baixar` sem fabricar dados. Esse ponto permanece como cobertura condicionada aos dados disponiveis, nao como falha do lote.

Relacao com o DS-0R:

- o resultado permaneceu alinhado conceitualmente ao briefing aprovado do DS-0R;
- as decisoes de cards, metadata e acoes ficam registradas aqui para futura reconciliacao unica com o Design System apos H4B4.

## Conclusao final

`UX-H4B3 SMOKE APROVADO - READY FOR FINAL VALIDATION`
