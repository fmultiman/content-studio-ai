# Wave 2 — Neutral Schemas — Execution Log

**Status:** Closed — Gate 2 PASS
**Produto:** Content Agent Studio
**Escopo:** implementar os contratos TypeScript/Zod neutros da Creative Rendering Layer
**Autoridade:** `SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md` (Wave 0), `WAVE_1_REMOTION_ISOLATION_SPIKE.md` (Wave 1), e os decision closures C2/C5/C6/C7 fornecidos nesta rodada
**Repo/branch:** `traycer/content-studio-ai-soft-yak` @ HEAD `9c240ce` no início da Wave 2 (worktree Traycer)
**Data:** 2026-09-20

---

## 0. Pre-flight

| Item | Resultado |
| --- | --- |
| Branch | `traycer/content-studio-ai-soft-yak` |
| `git status` (início) | limpo |
| HEAD | `9c240ce` (feat: Remotion isolation spike — Wave 1), com `68f83ce` (docs: audit Wave 0) no histórico |
| WIP antigo (`/videos`, `/imagens`, `image-drafts`, `video-drafts`, `draft-hub.ts`) | confirmado intocado (blob idêntico a HEAD antes e depois da Wave 2) |
| pull/reset/stash | nenhum executado |

**Correção factual no registro da Wave 1 (não é uma nova auditoria):** a Wave 1 citou "39 rotas"/"38 rotas" a partir do contador interno de build do Next `Generating static pages (38/38)`, que mede apenas páginas estáticas (`○`), não o total de rotas. Contagem correta, obtida por listagem direta de `app/**`: **48 rotas pré-existentes** (17 `page.tsx` + 31 `route.ts`) + 1 nova (`app/dev/creative-preview/page.tsx`) = 49 rotas em arquivo; a tabela impressa pelo `pnpm build` soma 50 linhas porque inclui a entrada sintética `/_not-found`, gerada pelo Next e não correspondente a um arquivo do projeto. Corrigido em `WAVE_1_REMOTION_ISOLATION_SPIKE.md` §2.7/§2.8/§3 com uma nota de correção explícita — nenhum outro conteúdo da Wave 1 foi alterado (confirmado por `git diff` restrito a `remotion/`, `scripts/creative/`, `app/dev/`, `lib/creative/`: vazio).

---

## 1. Local implementado

Conforme a auditoria (`lib/schemas/creative/`, não `lib/creative/schemas/`):

```
lib/schemas/creative/
  primitives.ts             # Ref, CanvasSpec, TemplateRef, IdentitySnapshotRef, FocalPoint, AssetRef,
                             # TypographyRole, VisualTokensSnapshot, MotionSpec, TransitionSpec,
                             # SequenceContext, StaticOutputFormat, VideoContainer, ContentBindings
  static-render.ts           # StaticRenderManifestSchema (+ source/context/output/metadata)
  timeline.ts                # TimelineSpecification, TimelineTrack, segment union, TimelineManifestSchema
  template-descriptor.ts     # TemplateDescriptorSchema, CanvasSupport, capabilities, overflow policy
  documentary-card.ts        # DocumentaryCardCoverContent/Assets, DocumentaryCardInfoContent/Assets
  validation.ts              # ValidationIssue/ValidationResult + validateTimelineSemantics()
  __tests__/
    fixtures.ts               # não é teste (não casa *.test.ts) — fixtures Portal + neutras compartilhadas
    primitives.test.ts
    static-render.test.ts
    timeline.test.ts
    template-descriptor.test.ts
    documentary-card.test.ts
    isolation.test.ts         # nenhum import de remotion/react/next/supabase/S3 na pasta
    neutrality.test.ts        # nenhum literal "Comunidades Alternativas"/"Terra Una" nos módulos de contrato
```

Nenhuma abstração além dessa lista foi criada (sem barrel/index, sem pasta por template, sem factory de fixtures) — o repo já usa import direto por arquivo (`lib/schemas/project-identity.ts`) e fixtures inline nos testes; segui o mesmo padrão, com um único arquivo `fixtures.ts` compartilhado porque múltiplos arquivos de teste reutilizam os mesmos manifests válidos.

---

## 2. Decisões C2/C5/C6/C7 — como foram aplicadas

### C5 — Variants

`variants: ['cover', 'info']` é o único conjunto anunciável nos testes de `TemplateDescriptorSchema` (`"standard"` nunca aparece). Dois schemas de content dedicados em vez de um objeto com flags:

- `DocumentaryCardCoverContentSchema`: `eyebrow?`, `title`, `subtitle?`, `source_line?`, `detail_note?` — todos `.strict()`.
- `DocumentaryCardInfoContentSchema`: `title`, `intro?`, `body_blocks` (`min(1).max(2)`, strings simples, sem rich text), `fact_cards` (`min(1).max(2)`), `source_line?`, `annotation?`.
- `DocumentaryCardFactCardSchema`: `primary`, `secondary?`, `tertiary?`.

Testado: info com 0 fact_cards rejeitado, com 3 rejeitado, com 1 ou 2 aceito; cover sem `title` rejeitado.

### C6 — footer vs detail_note

`DocumentaryCardCoverContentSchema` usa `detail_note?`; **nenhum campo `footer` existe** em nenhum schema desta Wave. Teste dedicado (`documentary-card.test.ts` → "rejects an unknown field, e.g. a generic footer") prova que `footer` é rejeitado por `.strict()`.

### C2 — video_work_ref

`TimelineContextSchema.video_work_ref` é `RefSchema.optional()`. Nenhuma tabela, migration ou placeholder persistente foi criado. Testado: a fixture Portal do Timeline omite `video_work_ref` e ainda assim é válida (`result.data.context.video_work_ref` é `undefined` após o parse).

### C7 — sequence / composition / role

- **SequenceContext:** `primitives.ts` define `SequenceContextSchema` (`index: int positive`, `total: int positive`, `.refine(index <= total)`), `.strict()`. É opcional em `StaticRenderManifest.sequence` e em `TemplateSegmentPayload.sequence` — não depende do Documentary Card. A aparência ("1/10", torn-paper tag, capsule) não entra no schema. Testado: `index > total` rejeitado, campo desconhecido rejeitado, uso opcional em ambos os manifests.
- **Composition:** `composition`, `density`, `artifact_plan` **não foram adicionados** a nenhum schema global nesta Wave. `StaticRenderManifestSchema` é `.strict()` e rejeita explicitamente um campo `composition` na raiz (teste dedicado). Esses conceitos pertencem à implementação versionada do template/variant, não ao manifest neutro.
- **Role:** `AssetRefSchema` **não tem** campo `role`. Teste dedicado confirma que `'role'` não está entre as chaves do schema (`Object.keys(AssetRefSchema.shape)`). A semântica hero/evidence/decoration continua derivada do slot do template (ex.: `DocumentaryCardCoverAssetsSchema.hero` é obrigatório; `DocumentaryCardInfoAssetsSchema` não tem `hero`).

---

## 3. Schemas implementados (lista completa)

| Contrato | Arquivo | Notas |
| --- | --- | --- |
| `RefSchema`, `SchemaVersionSchema`, `TemplateVersionSchema` | `primitives.ts` | strings não vazias, `.trim()` |
| `CanvasSpecSchema` | `primitives.ts` | width/height int positivos, `unit: 'px'` |
| `TemplateScopeSchema`, `TemplateRefSchema` | `primitives.ts` | `scope: system\|project` |
| `IdentitySnapshotRefSchema` | `primitives.ts` | `snapshot_ref` + `token_profile?` |
| `FocalPointSchema` | `primitives.ts` | `x`,`y` em `0..1` |
| `AssetTypeSchema`, `AssetFitSchema`, `AssetRefSchema` | `primitives.ts` | sem `role` (C7) |
| `FontStyleSchema`, `TypographyRoleSchema`, `ColorTokenSchema`, `SafeAreaSchema`, `SpacingTokensSchema`, `BrandTokensSchema`, `VisualTokensSnapshotSchema` | `primitives.ts` | tamanho de fonte/layout ficam fora — só family/weight/style |
| `MotionPresetSchema`, `MotionDirectionSchema`, `MotionSpecSchema` | `primitives.ts` | presets semânticos, sem keyframes |
| `TransitionPresetSchema`, `TransitionSpecSchema` | `primitives.ts` | |
| `SequenceContextSchema` | `primitives.ts` | decisão C7 |
| `StaticOutputFormatSchema`, `VideoContainerSchema` | `primitives.ts` | |
| `ContentBindingsSchema` | `primitives.ts` | `z.record(string, unknown)` — opaco no core |
| `StaticRenderSourceTypeSchema`, `StaticRenderSourceSchema`, `StaticRenderContextSchema`, `StaticRenderOutputSchema`, `StaticRenderMetadataSchema`, `StaticRenderManifestSchema` | `static-render.ts` | `sequence?` incluído; `content`/`assets` opacos |
| `FrameSchema`, `PositiveFrameCountSchema`, `TimelineSpecificationSchema`, `TimelineContextSchema` | `timeline.ts` | `video_work_ref?` (C2) |
| `TimelineTrackKindSchema`, `TimelineTrackSchema` | `timeline.ts` | |
| `MediaSegmentPayloadSchema`/`Schema`, `TemplateSegmentPayloadSchema`/`Schema`, `AudioSegmentPayloadSchema`/`Schema`, `TextSegmentPayloadSchema`/`Schema`, `CaptionSegmentPayloadSchema`/`Schema`, `TimelineSegmentSchema` (`discriminatedUnion('kind', ...)`) | `timeline.ts` | `TemplateSegmentPayload.sequence?` (C7) |
| `CaptionsBindingSchema`, `TimelineRenderIntentSchema`, `TimelineManifestSchema` | `timeline.ts` | |
| `TemplateIdSchema`, `TemplateModeSchema`, `TemplateVariantIdSchema`, `CanvasSupportSchema` (`discriminatedUnion('strategy', ...)`), `TemplateSchemaRefsSchema`, `TemplateCapabilitiesSchema`, `IdentityTokenPathSchema`/`IdentityRequirementsSchema`, `OverflowPolicySchema`, `TemplateTextPolicySchema`, `ComponentKeySchema`, `TemplateDescriptorSchema` | `template-descriptor.ts` | |
| `DocumentaryCardCoverContentSchema`, `DocumentaryCardCoverAssetsSchema` | `documentary-card.ts` | decisões C5/C6 |
| `DocumentaryCardFactCardSchema`, `DocumentaryCardInfoContentSchema`, `DocumentaryCardInfoAssetsSchema` | `documentary-card.ts` | decisão C5 |
| `ValidationIssue`, `ValidationResult`, `validateTimelineSemantics()` | `validation.ts` | ver §4 |

Todos os objetos de contrato usam `.strict()`; todos os enums fechados; `z.infer` é a única fonte de tipo (nenhuma interface duplicada manualmente) — mesmo padrão de `lib/schemas/project-identity.ts`.

---

## 4. Validação semântica implementada vs. deferida

Implementado em `validateTimelineSemantics()` (roda **depois** do `TimelineManifestSchema.parse()`):

- ids de track únicos;
- ids de segment únicos;
- `track_id` referenciado existe;
- segmento não ultrapassa `specification.duration_frames`;
- `source_out_frame > source_in_frame` quando ambos presentes (segment `media`).

`SequenceContext.index <= total` é validado **estruturalmente** via `.refine()` no próprio Zod schema (não precisa de função semântica separada — já cobre os testes "sequence index > total rejeitado" pedidos).

**Deferido explicitamente para a Wave 3** (documentado em comentário no topo de `validation.ts`, requer Template Registry / Identity Resolver / Asset Resolver, nenhum dos quais existe ainda):

- template id/version resolve no Registry;
- `content`/`assets` do template passam pelo schema específico da variant;
- motion preset é suportado pelo template resolvido;
- identity snapshot realmente resolve;
- `asset_ref` aponta para um asset real;
- compatibilidade track/segment além da forma estrutural.

Nenhuma tentativa foi feita de implementar essas validações nesta Wave.

---

## 5. Testes

77 testes novos em 7 arquivos, todos em `lib/schemas/creative/__tests__/`, seguindo o padrão `describe/it/expect` do repo (`vitest`, glob `lib/**/*.test.ts` — mesma convenção da Wave 1's `renderer-isolation.test.ts`).

| Arquivo | Cobertura |
| --- | --- |
| `primitives.test.ts` | CanvasSpec, TemplateRef, AssetRef (sem `role`), FocalPoint, SequenceContext (incl. index>total), MotionSpec/TransitionSpec — positivos e negativos |
| `static-render.test.ts` | fixture Portal válida; fixture neutra (Acme Labs) válida; `schema_version` inválido; canvas negativo; TemplateRef sem version; AssetRef sem ref; campo raiz desconhecido (`composition`) rejeitado; `sequence.index > total` rejeitado; `production_ref` opcional |
| `timeline.test.ts` | fixture Portal válida; fixture neutra válida; `video_work_ref` ausente e válido (C2); `schema_version` inválido; tracks vazio rejeitado; duração zero rejeitada; `kind` desconhecido rejeitado; campo raiz desconhecido rejeitado; `sequence` do template segment > total rejeitado; **semânticas**: track inexistente, segmento fora da duração, ids duplicados (track/segment), `source_out <= source_in` |
| `template-descriptor.test.ts` | descriptor válido; variants == `['cover','info']`; default de `identity_requirements`; id inválido (maiúsculas); mode inválido; variants vazio; `canvas_support` fixed e inválido; campo raiz desconhecido |
| `documentary-card.test.ts` | cover completo/mínimo/neutro válidos; cover sem title rejeitado; `footer` rejeitado (C6); title acima do limite rejeitado; cover assets sem hero rejeitado; info com 1 e 2 fact_cards válidos; info neutro válido; info sem fact_cards rejeitado; info com 3 fact_cards rejeitado; info sem body_blocks rejeitado; info sem title rejeitado; info assets sem hero é válido |
| `isolation.test.ts` | nenhum import de `remotion`/`@remotion/*`/`react`/`next`/Supabase/S3 em `lib/schemas/creative/**`; todo import é `zod` ou relativo (`./...`) |
| `neutrality.test.ts` | nenhum literal `"Comunidades Alternativas"`/`"Terra Una"` em qualquer módulo de contrato (fixtures ficam de fora da varredura, propositalmente) |

Fixtures em `fixtures.ts`: uma família Portal (`comunidades-alternativas`/`terra-una`, espelhando `PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json`) e uma família totalmente neutra (`acme-labs`/`launch-week`), ambas usadas nos testes de `static-render` e `timeline` — cumpre a exigência de ao menos um fixture não-Portal.

---

## 6. Resultados

| Comando | Antes da Wave 2 (baseline Wave 1) | Depois da Wave 2 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | **PASS** |
| `pnpm test` | 288/288 (17 arquivos) | **365/365 (24 arquivos)** — +77 testes, +7 arquivos, 0 regressão |
| `pnpm lint` | 0 erros, 45 warnings | **0 erros, 45 warnings** — nenhum warning novo, nenhum nos arquivos de `lib/schemas/creative/**` |
| `pnpm build` | PASS | **PASS** — mesmas rotas, sem alteração de output (schemas não são importados por nenhuma rota ainda) |

Um bug foi encontrado e corrigido **dentro da própria Wave 2** (não é uma regressão pré-existente): a primeira versão de `isolation.test.ts` usava uma regex de linha única (`/^import .*$/gm`) que não reconhecia imports multi-linha (`import {\n  X,\n} from './primitives'`), causando 2 falsos positivos. Corrigido para extrair todas as cláusulas `from '...'` via `matchAll` antes de validar o especificador — 77/77 passam após a correção.

---

## 7. Divergências registradas dos discovery docs (não decisões novas — apenas onde a implementação diverge do exemplo textual mais antigo)

1. `TEMPLATE_DESCRIPTOR_SCHEMA_V0.md §21` lista `variants: ['cover', 'standard']` no exemplo de descriptor — **superseded** pela decisão C5 desta Wave e pelos documentos mais recentes (`EDITORIAL_DOCUMENTARY_CARD_ANATOMY_V0.md`, `EDITORIAL_DOCUMENTARY_CARD_FIXTURES_V0.md`), que já tratam `cover`+`info` como as duas primeiras variants reais. O teste `template-descriptor.test.ts` afirma isso explicitamente.
2. `PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json` usa `footer` no lugar de `detail_note`. Por decisão C6, `footer` não é um campo do contrato V0; o fixture JSON original permanece como registro histórico do formato de manifest cru (não foi editado), mas o fixture usado nos testes desta Wave (`fixtures.ts`) não usa `footer`.
3. Os pseudo-manifests de `EDITORIAL_DOCUMENTARY_CARD_FIXTURES_V0.md §18/§29` incluem `sequence` no nível raiz e `composition.{density, artifact_plan}` — por decisão C7, `sequence` entra como `SequenceContext` (implementado), mas `composition`/`density`/`artifact_plan` **não** entram no manifest neutro nesta Wave; pertencem à implementação futura do template/variant.
4. Nenhum documento antigo precisou ser reescrito — todos permanecem como estavam; esta seção apenas registra onde a Wave 2 optou por seguir a decisão mais recente em vez do exemplo textual mais antigo, conforme instruído.

---

## 8. Fora do escopo (confirmado não tocado)

Template Registry runtime, Identity Resolver, Asset Resolver, componente React do Documentary Card, alteração de preview, Project Identity real, banco/Supabase, migrations, API, VideoDraft, ImageDraft, Visual Primitive Library, Font Picker, render do layout Pack B, Wave 3. Nenhum desses itens foi criado ou iniciado.

A implementação Remotion da Wave 1 (`remotion/`, `scripts/creative/`, `app/dev/creative-preview/`, `lib/creative/__tests__/renderer-isolation.test.ts`) não foi modificada — confirmado por `git diff` vazio nesses paths.

---

## 9. Gate 2 Verdict

## **PASS**

- Schemas neutros implementados conforme a lista completa da missão (§3), reconciliados com o padrão real do repo (`lib/schemas/`, Zod 3, `.strict()`, `z.infer`, testes `describe/it/expect`).
- Fixtures válidas passam (Portal e neutra); fixtures inválidas falham de forma previsível, com o `code`/mensagem esperado quando aplicável (validação semântica) ou `success:false` estrutural (Zod).
- Nenhuma dependência de `remotion`/`@remotion/*` em nenhum contrato — provado por teste automatizado (`isolation.test.ts`), complementando a varredura mais ampla já existente da Wave 1.
- Nenhum banco, nenhuma migration, nenhuma integração de domínio real.
- Nenhum WIP antigo tocado (confirmado por diff de blob).
- Suite completa sem regressão: 365/365 testes, mesmos warnings de lint, mesmo resultado de build.
- Wave 1 não foi adulterada — apenas uma correção factual isolada e explicitamente registrada (contagem de rotas).

---

## 10. Recomendação objetiva para Wave 3

Prosseguir para a **Wave 3 — Runtime Resolution Layer** conforme `SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md` §15 / `SPIKE_PLAN_V0.md` Wave 3, construindo sobre os schemas desta Wave:

1. `lib/creative/templates/registry.ts` — `registerTemplate`/`resolveTemplate`/`validateTemplateBindings`/`listTemplates` como mapa estático em código (sem banco), retornando por ora um componente placeholder para `editorial.documentary-card@0.1.0`.
2. `lib/creative/identity/resolve-identity-snapshot.ts` — resolve `IdentitySnapshotRef` para `VisualTokensSnapshot` a partir de fixtures (reaproveitar as fixtures Portal/Acme Labs já escritas em `lib/schemas/creative/__tests__/fixtures.ts` como ponto de partida, mas como *dados*, não como import de teste).
3. `lib/creative/assets/resolve-asset.ts` — resolve `AssetRef{type:'fixture'}` para um caminho local (sem tocar S3/library_files ainda).
4. Ao final da Wave 3, produzir `ResolvedStaticRenderInput` e `ResolvedTimelineInput` (tipos novos, prováveis em `lib/creative/resolve/`) sem que nenhum deles importe Remotion — estender o teste de isolamento (`lib/creative/__tests__/renderer-isolation.test.ts` da Wave 1 já cobre `lib/**` automaticamente; validar que continua passando).
5. Não implementar ainda o componente React do Documentary Card nem o Template Registry final com banco — a Wave 3, pelo próprio plano, ainda aceita um componente placeholder.
