# UX Production Hardening Results

**Data:** 2026-06-26  
**Escopo:** UX-H1 - hardening imediato da Production e continuidade.  
**Restricao:** nao houve alteracao de schema, banco, migrations, Project Identity, Prompt Generator, Image Evaluator, dashboard, sidebar, Galeria ou Arquivos.

---

## Escopo executado

- Separacao segura entre titulo, intencao e Project no workspace e cards de Production.
- Breadcrumb da Production usando o titulo resolvido, sem concatenar intencao ou Project.
- Retorno explicito de Conteudo Editorial para a Production quando `production_id` existe.
- Loadings contextuais para Production, entregaveis da Production e reabertura de drafts de imagem/video.
- Fallback visivel para `/projetos?new=true` durante refresh/carregamento.
- Ajuste das quatro tabs da Production para quatro colunas.
- Correcao localizada de texto quebrado em Video e de toast relacionado a rascunhos.

---

## Problemas reproduzidos ou confirmados

- `grid-cols-5` existia no workspace da Production com apenas quatro abas.
- A tela de Video continha `Novo VÃƒÂ­deo` em um botao diretamente relacionado ao fluxo.
- Imagens e Videos podiam renderizar o formulario antes de concluir a hidratacao de `draft=` e `production=`.
- O detalhe de Conteudo Editorial nao oferecia retorno explicito para a Production vinculada.
- `/projetos?new=true` tinha fallback/loading pouco informativo no refresh.

O titulo concatenado foi tratado como compatibilidade historica de apresentacao. A criacao/edicao atual de Production envia `title` e `intention` separados, e as rotas `POST/PATCH /api/productions` persistem esses campos separadamente apos `trim()`. Nao foi encontrada concatenacao nova na persistencia atual. Quando um valor salvo historicamente vier poluido no padrao `intencao + Project + titulo`, a UI resolve um titulo de exibicao sem alterar os dados persistidos.

---

## Causa

- A Production ja usava `production.title`, mas nao tinha uma camada de apresentacao para lidar com titulos historicamente poluidos.
- A causa atual nao esta nas rotas de persistencia de Production; elas continuam gravando `title` e `intention` como campos distintos.
- O workspace tinha loadings apenas com spinner, permitindo percepcao de vazio temporario.
- Imagens/Videos dependiam de `isDataReady`, mas o fallback principal ainda permitia a composicao do formulario antes da hidratacao.
- O detalhe editorial conhecia `production_id`, mas navegava como hub de Conteudos.
- O layout das tabs ficou com contagem fixa desatualizada.

---

## Correcoes

- Criado helper `resolveProductionDisplay` para separar titulo, intencao e breadcrumb sem mutar dados, com heuristica restrita ao padrao legado `intencao + Project + titulo`.
- Criados helpers de mensagens de loading e path de retorno para Production.
- Production workspace passou a usar titulo resolvido em header, breadcrumb, card e dialog de delete.
- Cards de Production no Project passaram a usar titulo e intencao resolvidos.
- Detalhe editorial mostra breadcrumb contextual e botao `Voltar para a Produção` quando ha Production vinculada.
- Imagens/Videos mostram loading contextual antes de hidratar draft/contexto.
- `/projetos?new=true` mostra fallback visivel com `Carregando projetos...`.
- Tabs da Production usam `grid-cols-4`.
- `Novo Vídeo` e `As alterações foram salvas.` foram corrigidos no escopo tocado.

---

## Arquivos alterados

- `app/(dashboard)/projetos/page.tsx`
- `app/(dashboard)/projetos/[id]/page.tsx`
- `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`
- `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx`
- `app/(dashboard)/imagens/page.tsx`
- `app/(dashboard)/videos/page.tsx`
- `lib/ux-production-hardening.ts`
- `lib/__tests__/ux-production-hardening.test.ts`
- `docs/README.md`
- `docs/product/ux/ux-production-hardening-results.md`

---

## Testes e validacao

- `pnpm.cmd test -- lib/__tests__/ux-production-hardening.test.ts`
- `pnpm.cmd test`
- `pnpm.cmd typecheck`
- `pnpm.cmd lint` retornou 0 erros e warnings preexistentes fora do escopo.
- `pnpm.cmd build` ficou bloqueado por falha de rede ao baixar `Geist` e `Geist Mono` via `next/font`.
- `pnpm.cmd validate` ficou sujeito ao mesmo bloqueio ambiental do build, pois executa `typecheck && lint && build`.

Validacao local por HTTP:

- `GET /projetos?new=true -> 200`
- `GET /videos -> 200`
- `GET /imagens?draft=test&project=test&production=test -> 200`

Validacao interativa no browser ficou limitada por falha de inicializacao do plugin de navegador embutido no sandbox.

Fluxo ainda recomendado para smoke humano:

`Project -> Production -> Imagem -> Production -> Video -> Production -> Conteudo Editorial -> Production`

e para:

`/projetos?new=true -> refresh`

---

## Adiados para UX-H2 / UX-H3

- Comunicacao visual da heranca de Project Identity.
- Reconciliacao do dashboard.
- Navegacao global de Imagens/Videos como hubs ou workspaces.
- Escopo final da Galeria.
- Arquivos vinculados a Production.
- Nomenclatura geral Conteudos/Publicacoes/Distribution.
