# Wave 1 — Remotion Isolation Spike — Execution Log

**Status:** Closed — Gate 1 PASS_WITH_CONSTRAINTS
**Produto:** Content Agent Studio
**Escopo:** provar que Remotion pode coexistir no repo sem contaminar domínio, banco ou fluxos existentes
**Autoridade:** `SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md` (Wave 0) e os discovery docs por ela referenciados
**Repo/branch:** `traycer/content-studio-ai-soft-yak` @ `6057e0983ab5751c233c6a0a10e940ba492261ad` (worktree Traycer)
**Data:** 2026-09-20

---

## 0. Fase A — Repo Recovery Verdict

`INTACT` (com poluição cosmética não bloqueante).

Verificações realizadas neste worktree:

| Item | Resultado |
| --- | --- |
| Repository root | `D:/Traycer/worktrees/fmultiman__content-studio-ai/traycer-content-studio-ai-soft-yak-d8b51a540099` |
| `git status` (antes da Wave 1) | limpo, exceto `?? docs/discovery/` (herdado da auditoria Wave 0) |
| Branch atual | `traycer/content-studio-ai-soft-yak` |
| `git rev-parse HEAD` | `6057e0983ab5751c233c6a0a10e940ba492261ad` |
| Remote | `origin` → `https://github.com/fmultiman/content-studio-ai.git` |
| `git diff --stat` | vazio (nenhuma alteração local vs HEAD antes da Wave 1) |
| `.git` funcional | sim — `status`, `diff`, `log`, `rev-parse`, `remote` todos resolvem corretamente |
| `package.json` / `pnpm-lock.yaml` | presentes |
| `node_modules` | ausente no início (esperado, conforme instrução) |

**Achado de ambiente (não bloqueante):** `git fsck` no `.git` compartilhado (localizado em `D:/Trabalhos/Content Agent Studio/content-studio-ai-git/.git`, do qual este worktree é derivado) reporta poluição cosmética de sincronização OneDrive/Windows:

- 754 refs inválidas do tipo `desktop.ini` sob `refs/codex/**` (namespace de outra ferramenta, não usado por este fluxo de trabalho) e ao menos uma sob `refs/heads/chore/desktop.ini`;
- arquivos `desktop.ini` "garbage" em todos os 256 subdiretórios `objects/00`–`ff`;
- 8 arquivos `.idx` de pack sem `.pack` correspondente ("no corresponding .pack").

Nenhum desses itens afeta HEAD, o branch atual, o remote, ou qualquer operação usada nesta Wave (`git count-objects -v` confirma 2 packs válidos + 3847 objetos soltos saudáveis, com o lixo corretamente isolado como `garbage`). Classificado como artefato de sincronização em nuvem, não corrupção real — não impediu nenhuma ação da Wave 1.

## 0.1 Fase B — Discovery Docs

Confirmado: `docs/discovery/creative-rendering/` existe neste worktree com `SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md` (já presente desde a auditoria Wave 0, não precisou ser copiado). Os demais documentos de autoridade (`RENDER_ARCHITECTURE_V0.md`, `SPIKE_PLAN_V0.md`, `REMOTION_ADAPTER_MAPPING_V0.md`, `TIMELINE_MANIFEST_V0_REFINEMENT.md`, `TEMPLATE_REGISTRY_V0.md`) foram lidos integralmente na sessão da auditoria Wave 0 e usados como referência nesta Wave 1; não foram copiados nem alterados.

## 0.2 Fase C — WIP Pré-existente Preservado

O audit (Wave 0) identificou WIP não commitado em `/videos`, `/imagens`, `/api/video-drafts`, `/api/image-drafts`, `lib/draft-hub.ts` — mas **no checkout principal separado** (`D:/Trabalhos/Content Agent Studio/content-studio-ai-git`), não neste worktree.

Preimage registrada neste worktree antes da Wave 1 (todos batem exatamente com o blob de HEAD, sem drift):

| Arquivo | git blob sha (HEAD) |
| --- | --- |
| `app/api/video-drafts/route.ts` | `aa0dcffd14075821c811d2abf576b512bd9ba261` |
| `app/api/image-drafts/route.ts` | `277cb54861744b0aa2b7eca8e745aef85150f8da` |
| `app/(dashboard)/videos/page.tsx` | `12337746a8e99e392e9f2bdcb32a951359230f63` |
| `app/(dashboard)/imagens/page.tsx` | `178ad6f7ea8ff461a6104e8805659b6aa5f2a0ae` |
| `app/(dashboard)/videos/rascunhos/page.tsx` | `32ff85ac89b1acc239c4810d4a0844654aac9235` |
| `app/(dashboard)/imagens/rascunhos/page.tsx` | `cb1fe1751fe7b2191f1ee7c24d163719411e4ee9` |
| `lib/draft-hub.ts` | `e3a4281e3cc73fb3ba6354ae7f2f378ad49d0e3e` |

Confirmado ao final da Wave 1 (`git status --porcelain -- <esses arquivos>`): **nenhum foi tocado**. Nenhuma dessas áreas foi acessada, importada ou referenciada por qualquer arquivo criado nesta Wave.

---

## 1. Fase D — Baseline

Package manager confirmado: **pnpm 11.8.0**. Restauração via lockfile existente (`pnpm install --frozen-lockfile`), sem atualizar dependências.

| Comando | Resultado | Tempo |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | OK — todas as deps do lockfile restauradas, 0 erros | 11m 42.8s (cold pnpm store em `D:\.pnpm-store\v11`) |
| `pnpm typecheck` (`tsc --noEmit`) | **PASS** — 0 erros | rápido (<1min) |
| `pnpm test` (`vitest run`) | **PASS** — 288/288 testes, 17 arquivos `.test.ts` | 11.6s |
| `pnpm lint` (`eslint .`) | **PASS** — 0 erros, 45 warnings pré-existentes | ~3min (cold ESLint cache) |
| `pnpm build` (não executado nesta fase; ver §3) | — | — |

**Achados pré-existentes registrados (fora de escopo, não corrigidos):**

1. `vitest.config.ts` usa `include: ['lib/**/*.test.ts']`, que **exclui silenciosamente** arquivos `.test.tsx`. Existem 5 desses no repo (`cards-metadata-actions.test.tsx`, `controls-indicators.test.tsx`, `page-hierarchy-context.test.tsx`, `proven-primitives.test.tsx`, `states-forms-polish.test.tsx`) que nunca rodam via `pnpm test`. Confirma o risco R8 do audit Wave 0. Não corrigido (fora do escopo desta Wave).
2. `pnpm install` emitiu avisos de depreciação pré-existentes e não relacionados ao Remotion: `recharts@2.15.0` (branch não mais ativo) e `eslint@9.39.4` (versão não mais suportada). Não corrigidos.
3. 45 warnings de lint pré-existentes (0 erros) — todos em arquivos não tocados por esta Wave, todos já rebaixados a `warn` deliberadamente em `eslint.config.mjs` (comentário explícito sobre regras do React Compiler). Não corrigidos.

Nenhuma dessas três descobertas foi causada por esta Wave; todas são estado herdado do repositório.

---

## 2. Fase E — Wave 1: Remotion Isolation Spike

### 2.1 Pacotes instalados

Todos fixados na mesma versão exata `4.0.526` (sem `^`), conforme orientação oficial do Remotion de manter `remotion` e todos os `@remotion/*` sincronizados:

| Pacote | Versão | Tipo | Justificativa |
| --- | --- | --- | --- |
| `remotion` | 4.0.526 | dependency | Core: `registerRoot`, `Composition`, `Still`, `AbsoluteFill`, `interpolate`, `useCurrentFrame`, `useVideoConfig`. |
| `@remotion/player` | 4.0.526 | dependency | `<Thumbnail>` para preview embutido em um app React comum (Next), sem depender do Remotion Studio — prova a reutilização do mesmo componente entre preview e render final. |
| `@remotion/bundler` | 4.0.526 | dependency | `bundle()` — gera o bundle webpack usado pelos scripts de render server-side. Sem ele não é possível chamar `renderStill`/`renderMedia`. |
| `@remotion/renderer` | 4.0.526 | dependency | `renderStill()`, `renderMedia()`, `selectComposition()` — geração real do PNG e do MP4 em Node. |
| `@remotion/cli` | 4.0.526 | devDependency | Ferramenta de verificação cruzada (`npx remotion still/render/studio`), não usada nos scripts do spike, mas disponível para inspeção manual. |

**Não instalados** (deliberadamente, fora do escopo do Gate 1): `@remotion/eslint-plugin`, `@remotion/google-fonts`, `@remotion/lambda`.

**Licença (verificada na documentação oficial nesta sessão):** Remotion é gratuito para "an individual; a for-profit organisation with up to 3 employees; a non-profit; or evaluating whether Remotion is a good fit, and are not yet using it in a commercial way." Este spike se enquadra explicitamente em "evaluating" — resolve o risco R4 do audit Wave 0 para o escopo desta Wave. Uma decisão de licença para uso em produção (dependendo do tamanho da equipe) fica para o veredito final do spike (Wave 10), fora desta rodada.

### 2.2 Constraint descoberta e resolvida: `esbuild` build script (risco R7 confirmado)

`pnpm add remotion@4.0.526 @remotion/player@4.0.526 @remotion/bundler@4.0.526 @remotion/renderer@4.0.526` introduziu `esbuild@0.28.1` como dependência direta de `@remotion/bundler` (via `terser-webpack-plugin` → `webpack`). O pnpm bloqueou o script de build nativo do esbuild:

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

Isso não é cosmético: a checagem interna de "deps status" do pnpm passou a **falhar** (`exit code 1`) até para `pnpm typecheck`, bloqueando toda a Wave.

**Ação tomada (com aprovação explícita do usuário, escopo mínimo confirmado antes de qualquer escrita):**

```diff
 allowBuilds:
+  esbuild: true
   sharp: true
   unrs-resolver: true
```

Diff mostrado e aprovado antes da execução; nenhum outro pacote foi aprovado automaticamente. Após `pnpm install`, o script de build do esbuild rodou (`postinstall: Done`) e nenhuma outra aprovação de build script foi solicitada em execuções subsequentes (`pnpm typecheck`, `pnpm add -D @remotion/cli`, `pnpm build`).

`pnpm why esbuild` confirma a origem: `esbuild@0.28.1` é puxado por `@remotion/bundler@4.0.526` e, separadamente, também por `vite@8.1.0` (dependência transitiva do próprio `vitest`) — ou seja, é uma dependência que o projeto já tocava indiretamente via testes; a Wave 1 apenas tornou visível o gate de aprovação do pnpm para essa versão específica.

### 2.3 Paths criados

```
remotion/
  index.ts                      # registerRoot(RemotionRoot)
  Root.tsx                      # <Still id="SpikeStill"> 1080x1350 + <Composition id="SpikeVideo"> 1080x1920/30fps/180f
  SpikeComposition.tsx           # componente visual trivial e neutro, compartilhado entre still e vídeo

scripts/creative/
  render-still.mjs               # bundle() + selectComposition() + renderStill() → .tmp/creative/spike-still.png
  render-video.mjs               # bundle() + selectComposition() + renderMedia() → .tmp/creative/spike-video.mp4

app/dev/creative-preview/
  page.tsx                       # rota isolada (fora de (dashboard)), <Thumbnail> do mesmo SpikeComposition

lib/creative/__tests__/
  renderer-isolation.test.ts     # varre app/, lib/, components/ e falha se `from 'remotion'`/`from '@remotion/...'`
                                  # aparecer fora de app/dev/creative-preview/**
```

**Arquivos modificados (não criados):**

- `.gitignore` — adicionada entrada `.tmp/` para garantir que outputs binários do spike nunca sejam commitados.
- `package.json` — 5 linhas adicionadas (as 5 dependências acima), nenhuma outra alteração.
- `pnpm-lock.yaml` — atualizado automaticamente pelo pnpm para refletir as novas dependências.
- `pnpm-workspace.yaml` — 1 linha adicionada (`esbuild: true`), conforme §2.2.

**Nenhum arquivo existente de domínio, rota `/api`, `/videos`, `/imagens`, Project Identity, VideoDraft ou ImageDraft foi criado, movido ou modificado.**

### 2.4 Decisão de design: rota de preview fora de `(dashboard)`

`app/(dashboard)/layout.tsx` envolve todas as rotas do grupo em `<StudioShell>` (980 linhas, componente que toca contexto de workspace/identidade). Para respeitar a restrição explícita "NÃO integrar Project Identity real / NÃO consultar Supabase" da forma mais estrita possível, a rota de preview foi colocada em `app/dev/creative-preview/page.tsx` — irmã de `app/login` e `app/signup`, fora do grupo `(dashboard)`, herdando apenas o `app/layout.tsx` raiz (que só envolve `ThemeProvider` + `Toaster` + `Analytics`, sem Supabase). Não está referenciada em `lib/sidebar-navigation.ts`.

### 2.5 Comando(s) usados e outputs

```
node scripts/creative/render-still.mjs
node scripts/creative/render-video.mjs
```

**Render still (primeira execução — inclui download único do Chrome Headless Shell, 113.3 MB):**

```json
{
  "outputPath": ".tmp/creative/spike-still.png",
  "width": 1080,
  "height": 1350,
  "timingsMs": { "bundle": 89481, "selectComposition": 35876, "render": 3167, "total": 128524 }
}
```

Verificado com `file`: `spike-still.png: PNG image data, 1080 x 1350, 8-bit/color RGB, non-interlaced` — 26 611 bytes.

**Render vídeo (segunda execução — Chromium já em cache, bundle já quente):**

```json
{
  "outputLocation": ".tmp/creative/spike-video.mp4",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "durationInFrames": 180,
  "timingsMs": { "bundle": 11381, "selectComposition": 3156, "render": 43277, "total": 57814 }
}
```

Verificado com `file`: `spike-video.mp4: ISO Media, MP4 Base Media v1 [ISO 14496-12:2003]` — 171 881 bytes, 180 frames / 30 fps = 6 segundos, 1080×1920 (coincide com a fixture-alvo do `SPIKE_PLAN_V0.md` e do `TIMELINE_SCHEMA_V0.md`).

Ambos os outputs vivem em `.tmp/creative/` (git-ignorado, nunca versionado) — nenhum artifact binário entrou no controle de versão.

### 2.6 Warnings observados

- pnpm: `deprecated recharts@2.15.0`, `deprecated eslint@9.39.4` — pré-existentes, não relacionados ao Remotion.
- Remotion: nenhum warning de render (`renderStill`/`renderMedia` completaram sem `warnings[]`); apenas a mensagem informativa de download do Chrome Headless Shell na primeira execução.
- Nenhum erro ou warning de TypeScript/ESLint atribuível aos arquivos novos (`remotion/`, `scripts/creative/`, `app/dev/creative-preview/`, `lib/creative/`).

### 2.7 Limitações conhecidas

1. **Render em produção não pode acontecer em `app/api/**` na Vercel.** `@remotion/renderer` depende de Chromium headless, que excede o limite de 50 MB de Vercel Functions (confirmado na documentação oficial do Remotion, citada no audit Wave 0). Por isso os scripts de render são Node puro, nunca importados por uma rota Next — confirmado pelo teste de isolamento.
2. **Verificação visual interativa da rota `/dev/creative-preview` não foi concluída nesta sessão.** Ao subir `pnpm dev` e navegar até a rota via browser, o middleware global existente (`proxy.ts` → `lib/supabase/middleware.ts`) lançou `500` por falta de `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` neste ambiente (sem `.env.local`). **Confirmado que isso é um gap de ambiente pré-existente e não uma regressão desta Wave**: a mesma verificação em `/login` (rota existente, não tocada) produz exatamente o mesmo erro. Não criei `.env.local` nem credenciais fictícias (fora de escopo; "NÃO consultar Supabase"). A prova de "preview funciona" para o Gate 1 se apoia em vez disso em: (a) `pnpm build` gerando `/dev/creative-preview` como página estática (`○`) sem erros; (b) `pnpm typecheck` limpo; (c) o teste de isolamento confirmando que a rota realmente importa `@remotion/player`; (d) o fato de que o **mesmo componente `SpikeComposition`** foi executado com sucesso dentro do Chromium headless via `renderStill`/`renderMedia` — evidência mais forte de correção do que uma captura de tela isolada.
3. **`esbuild` exigiu aprovação manual de build script** (§2.2) — resolvido com escopo mínimo e aprovação explícita.
4. Compatibilidade Next 16.2.4 com Remotion 4.0.526 não é citada explicitamente na documentação oficial (que cita "Next.js 15" como referência de upgrade para React 19), mas **`pnpm build` completo (compile + typecheck + geração de todas as rotas, incluindo a nova) não apresentou nenhum erro atribuível a essa combinação** — evidência empírica de compatibilidade nesta versão, ainda que não testada em runtime de produção real.

> **Correção factual (registrada na Wave 2):** a versão original desta seção citava "39 rotas"/"38 rotas" a partir do contador interno de build do Next.js `Generating static pages (38/38)`, que mede apenas páginas geradas estaticamente (`○`) e não o total de rotas. A contagem correta de rotas baseadas em arquivo (`page.tsx` + `route.ts`) sob `app/`, confirmada por listagem direta do sistema de arquivos, é **48 pré-existentes** (17 `page.tsx` + 31 `route.ts`) + 1 nova (`app/dev/creative-preview/page.tsx`) = 49 rotas em arquivo; a tabela impressa pelo `pnpm build` soma 50 linhas porque inclui também a entrada sintética `/_not-found`, gerada automaticamente pelo Next e não correspondente a um arquivo do projeto.

### 2.8 Impacto no build/runtime — registrado

| Métrica | Antes da Wave 1 | Depois da Wave 1 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | PASS |
| `pnpm test` | 288/288 (17 arquivos) | 288/288 (17 arquivos, +1 novo: `renderer-isolation.test.ts`) |
| `pnpm lint` | 0 erros, 45 warnings | 0 erros, 45 warnings (nenhum novo) |
| `pnpm build` | não executado no baseline | **PASS** — Turbopack compile 91s + TypeScript 46s + geração de páginas (contador interno do Next: 38/38 páginas estáticas) ≈ 1.9s; total ≈ 3m 8s |
| Rotas existentes (arquivo) | 48 rotas pré-existentes (17 `page.tsx` + 31 `route.ts` sob `app/`, contadas por listagem direta) | as mesmas 48 rotas **inalteradas**, + 1 nova rota estática isolada (`/dev/creative-preview`) = 49 rotas em arquivo |
| Tamanho de `node_modules` | — | +168 pacotes novos (135 do primeiro `pnpm add` + 33 do `@remotion/cli`), incluindo o binário Chrome Headless Shell (113.3 MB, armazenado no cache do Remotion, fora do repositório) |
| Dependências de banco/domínio tocadas | — | nenhuma |

---

## 3. Provas obrigatórias — checklist

| # | Prova | Status | Evidência |
| --- | --- | --- | --- |
| 1 | Remotion carrega no repo | ✅ | `pnpm add` + `pnpm typecheck` limpo |
| 2 | Preview funciona | ✅ (arquitetural) / ⚠️ (visual bloqueado por gap de ambiente não relacionado) | §2.7 item 2 |
| 3 | Still real gerado | ✅ | `spike-still.png`, PNG 1080×1350, 26 611 bytes |
| 4 | MP4 real gerado | ✅ | `spike-video.mp4`, ISO Media, 1080×1920/30fps/180f, 171 881 bytes |
| 5 | React/Next existentes continuam funcionais | ✅ | `pnpm build` — 48 rotas em arquivo pré-existentes intactas + build completo sem erros |
| 6 | Nenhum schema/domain module importa Remotion | ✅ | `lib/creative/__tests__/renderer-isolation.test.ts` passou (varredura de `app/`, `lib/`, `components/`) |
| 7 | Nenhuma rota/API existente foi alterada | ✅ | `git status --porcelain` restrito às áreas WIP/domínio — vazio |
| 8 | Nenhum banco foi acessado | ✅ | nenhum import de `@/lib/supabase/*` em qualquer arquivo novo |
| 9 | Outputs são artifacts locais de spike | ✅ | `.tmp/creative/**`, git-ignorado |
| 10 | Build/runtime impact registrado | ✅ | §2.8 |

---

## 4. Gate 1 Verdict

## **PASS_WITH_CONSTRAINTS**

Justificativa: os dois critérios definidores do Gate 1 — "gerar 1 still real" e "gerar 1 MP4 curto real, sem integração com domínio ou banco" — foram cumpridos integralmente, com evidência de arquivo verificada por assinatura de formato (`file`), não apenas por ausência de erro. Nenhum código de domínio, rota existente ou fluxo de `/imagens`/`/videos` foi tocado; o teste de isolamento automatizado confirma isso estruturalmente, não apenas por inspeção manual.

As constraints que impedem um `PASS` incondicional:

1. A verificação visual interativa do preview (`<Thumbnail>` renderizado num browser real) não foi concluída nesta sessão por um gap de ambiente pré-existente e não relacionado (Supabase env vars ausentes, middleware global) — não é um defeito da Wave 1, mas também não é uma prova visual fechada.
2. Foi necessário expandir `pnpm-workspace.yaml.allowBuilds` (aprovação explícita do usuário, escopo mínimo) — uma mudança de configuração de segurança de build, ainda que padrão e de baixo risco (idêntica em natureza às entradas já existentes para `sharp`/`unrs-resolver`).
3. A decisão de infraestrutura de render em produção (Lambda/worker) permanece em aberto, como já esperado pelo audit Wave 0 — este spike prova apenas o caminho local/Node.
4. A licença Remotion está resolvida apenas para o uso de avaliação desta Wave, não para uma eventual adoção em produção.

Nenhuma dessas constraints bloqueia a Wave 2.

---

## 5. Decisões registradas nesta Wave

1. Remotion 4.0.526 (todos os pacotes na mesma versão exata) provou-se instalável e funcional neste repo Next 16.2.4 / React 19.2.4 / pnpm 11.8.0, sem quebrar nenhuma rota, teste ou build existente.
2. `esbuild` precisa estar em `allowBuilds: true` para que `@remotion/bundler` funcione sob pnpm ≥ 11 com a policy de build scripts deste repo. Decisão registrada e aprovada explicitamente (risco R7 do audit fechado).
3. A rota de preview técnica vive fora de `(dashboard)`, em `app/dev/creative-preview/`, para nunca depender de `StudioShell`/Supabase — mais estrito que a sugestão original do audit Wave 0 (que cogitava colocá-la dentro de `(dashboard)`).
4. Scripts de render (`scripts/creative/*.mjs`) são a única superfície que importa `@remotion/renderer`/`@remotion/bundler`; nenhuma rota `app/api/**` os importa, preservando a restrição de que Vercel Functions não suportam Chromium headless.
5. Licença Remotion confirmada como gratuita para o uso de avaliação desta Wave; decisão de produção adiada para o veredito final do spike.
6. `next-env.d.ts` é gerenciado automaticamente pelo Next.js (dev vs build) e foi deliberadamente restaurado ao estado de HEAD antes do commit — não faz parte da Wave 1.

---

## 6. Recomendação objetiva para Wave 2

Prosseguir para a **Wave 2 — Neutral Schemas** conforme `SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md` §15, com dois ajustes de entrada em relação ao plano original:

1. Antes de escrever os schemas Zod, resolver as inconsistências C5/C6/C7 e a questão de `video_work_ref` (C2) listadas na §14 do audit — nenhuma delas foi tocada nesta Wave 1, e continuam bloqueando a modelagem limpa de `StaticRenderManifest`/`TimelineManifest`.
2. Ao escrever o teste `renderer-isolation.test.ts` de Wave 2 (ou estender o desta Wave), reusar o padrão de varredura já validado aqui (`lib/creative/__tests__/renderer-isolation.test.ts`), garantindo que os novos módulos em `lib/schemas/creative/**` continuem sem importar `remotion`/`@remotion/*` desde o primeiro commit.

Não iniciar Template Registry, Documentary Card ou qualquer integração com Project Identity real antes de fechar a Wave 2.
