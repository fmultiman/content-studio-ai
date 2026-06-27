# UX-H3A Results - Dashboard Continuation Hub

Data: 2026-06-27  
Branch: `feat/ux-dashboard-continuation-hub`  
Escopo: implementar apenas o UX-H3A, transformando o Dashboard em centro de retomada de trabalho.

## Estado anterior

O Dashboard anterior comunicava principalmente escolha de ferramentas:

- saudacao com a pergunta "O que voce gostaria de criar hoje?";
- metricas acima da area operacional;
- acoes rapidas `Criar Projeto`, `Gerar Imagem` e `Gerar Video`;
- `Atividade Recente` sem dados reais.

As acoes `Gerar Imagem` e `Gerar Video` levavam a rotas globais que exigem Production, criando um caminho contraditorio para usuarios recorrentes e novos.

## Contrato aplicado

A entidade principal de retomada agora e `Production`.

Prioridade visual aplicada:

```text
Continuar trabalhando
-> Productions recentes
-> Itens recentes
-> Projects recentes
-> Criar com contexto
-> Resumo
```

O Dashboard nao implementa UX-H3B, UX-H3C ou UX-H3D. Imagens globais, Videos globais, Galeria, Arquivos e Sidebar nao foram alterados.

## Dados usados

As consultas server-side usam dados do usuario autenticado e preservam RLS:

- `projects`
- `productions`
- `image_drafts`
- `video_drafts`
- `editorial_contents`

Nao foram criadas tabelas, migrations, APIs ou activity logs.

## Secoes implementadas

### Continuar trabalhando

Mostra Productions recentes com:

- titulo resolvido para evitar o padrao legado concatenado;
- Project;
- intencao resumida;
- contadores de imagens, videos e conteudos editoriais;
- data de atividade calculada a partir da Production e dos entregaveis recentes relacionados;
- acao explicita `Continuar Production`.

### Itens recentes

Mostra ImageDraft, VideoDraft e EditorialContent recentes.

Cada item exibe:

- tipo;
- titulo ou fallback;
- Project;
- Production quando houver;
- status;
- data;
- acao `Abrir`.

Links preservam `project`, `production` e `draft` quando existem. Conteudos sem Production continuam abrindo pelo detalhe editorial seguro.

### Projects recentes

Mostra Projects recentes com:

- nome;
- descricao resumida;
- quantidade de Productions;
- indicador curto de identidade/contexto;
- acao `Abrir Project`.

O formulario de Project Identity nao foi duplicado no Dashboard.

### Criar

Substitui CTAs contraditorios por acoes contextuais:

- `Continuar Production`, quando existe Production recente;
- `Nova Production`, apontando para um Project existente ou para a lista de Projects;
- `Novo Project`.

Nao ha CTA principal para Imagem ou Video sem Production.

### Resumo

Metricas foram movidas para posicao secundaria e renomeadas para dados alinhados ao modelo atual:

- Projects;
- Productions;
- Rascunhos de imagem;
- Rascunhos de video;
- Conteudos.

O contador antigo de prompts foi removido do Dashboard porque nao ajuda a retomada operacional desta fase.

## Estados

- Sem Projects: orienta criar um Project.
- Project sem Production: orienta abrir Projects e criar uma Production.
- Sem itens recentes: orienta continuar uma Production.
- Erro parcial de carregamento: mostra mensagem segura e permite atualizar a pagina.
- Loading: por ser Server Component, a pagina renderiza apos as queries; nao exibe zeros prematuros durante hidratacao client-side.

## Acessibilidade e responsividade

- Cards clicaveis possuem botoes ou links explicitos.
- Links tem labels compreensiveis.
- Datas usam formato legivel em PT-BR.
- Badges usam texto, nao apenas cor.
- Layout usa grids responsivos e stack em telas estreitas.
- Nao foi criado carrossel.

## Performance

O Dashboard combina consultas paralelas limitadas:

- Projects recentes: 6;
- Productions recentes: 10;
- drafts/conteudos recentes: 20 por tipo.

Os contadores de entregaveis por Production sao calculados em memoria a partir desses conjuntos recentes. Isso evita N+1 queries, mas significa que a atividade exibida e uma leitura operacional recente, nao um historico completo.

## Testes

Criado `lib/__tests__/dashboard-continuation.test.ts` cobrindo:

- ordenacao de Productions por atividade real;
- titulo resolvido de Production;
- rota nested de Production;
- contadores de imagens, videos e conteudos;
- links de itens recentes preservando Project/Production;
- conteudo sem Production;
- Projects recentes e status de identidade/contexto;
- estados vazios;
- ausencia de painel inutil de atividade recente;
- nao mutacao dos objetos de entrada.

## Browser

Fluxos de smoke autenticados executados em `http://localhost:3000/dashboard`:

```text
Dashboard
-> Continuar trabalhando
-> Productions recentes
-> Itens recentes
-> Projects recentes
-> Criar
-> Resumo
```

Evidencias:

- `Continuar trabalhando` aparece acima das metricas.
- `Gerar Imagem` e `Gerar Video` nao aparecem mais como CTAs principais.
- `Atividade Recente` vazia foi removida.
- Os links `Continuar Production` apontam para `/projetos/[projectId]/producoes/[productionId]`.
- Item recente de imagem abre `/imagens` com `draft`, `project` e `production`.
- Conteudo sem Production continua com fallback seguro.
- Dashboard em largura estreita disponivel no browser nao apresentou overflow horizontal.

Limitacao observada no smoke:

- Ao abrir diretamente a Production autenticada usada no teste, a pagina de Production permaneceu no loading contextual `Carregando Production...` nesta sessao local. O destino do link do Dashboard estava correto, e nao houve erro de console no browser. A investigacao aprofundada da rota de Production ficou fora do UX-H3A porque o Dashboard nao altera essa pagina.

Estados sem Project, Project sem Production e item legado sem Production foram cobertos por testes unitarios dos helpers.

## Validacao tecnica

- `pnpm.cmd test`: aprovado, 230 testes.
- `pnpm.cmd typecheck`: aprovado.
- `pnpm.cmd lint`: aprovado com 0 erros e 50 warnings preexistentes fora dos arquivos do UX-H3A.
- `pnpm.cmd build`: bloqueado no sandbox por download de `next/font` / Google Fonts (`Geist` e `Geist Mono`).
- `pnpm.cmd validate`: executou typecheck e lint, depois bloqueou no mesmo erro ambiental de build por Google Fonts (`Geist` e `Geist Mono`).

## Limitacoes

- Nao foi criado feed generico de activity log.
- `updated_at` da Production pode nao refletir toda atividade de entregaveis; por isso a UI calcula `activityAt` a partir de drafts/conteudos recentes quando disponiveis.
- `Nova Production` nao abre um seletor global complexo; ela direciona para Project/Projects.
- Galeria, Imagens globais, Videos globais, Arquivos e Sidebar permanecem para UX-H3B/H3C/H3D.

## Itens adiados

- UX-H3B: reconciliar Imagens/Videos globais como hubs.
- UX-H3C: reconciliar Galeria.
- UX-H3D: sidebar, agrupamento e nomenclatura global.
- Rota global dedicada de Productions.
- Activity log persistente.
- Seletor global Project -> Production para criacao de entregaveis.
