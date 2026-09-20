# Wave 3 — Runtime Resolution Layer

**Status:** Gate 3 fechado — `PASS`
**Data:** 2026-09-20
**Base:** `b5061fb` (`feat: neutral Creative Rendering schemas (Wave 2)`)
**Escopo:** resolução fixture-only, renderer-neutral, sem execução Remotion

## 1. Resultado

A cadeia de runtime foi implementada e exercitada sem banco, Supabase, S3,
HTTP ou renderer:

```text
manifest desconhecido
  → Zod structural validation
  → template registry resolution
  → variant/content/asset binding validation
  → identity snapshot resolution
  → local fixture asset resolution
  → ResolvedStaticRenderInput / ResolvedTimelineInput
```

Os dois manifests passam pelo mesmo pipeline para identidades diferentes. O
core não possui branch por Project, Portal ou outro cliente.

## 2. Paths reais

```text
lib/creative/
  assets/resolve-asset.ts
  identity/fixtures.ts
  identity/resolve-identity-snapshot.ts
  resolution/diagnostics.ts
  resolution/resolve-static-render.ts
  resolution/resolve-timeline.ts
  templates/registry.ts
  __tests__/runtime-resolution.test.ts

public/creative-fixtures/
  acme-labs-hero-01.svg
  comunidades-alternativas-logo-v1.svg
  terra-una-documentary-photo-01.svg
```

Os contratos de entrada continuam em `lib/schemas/creative/`, sem alteração
de semântica da Wave 2. Os SVGs são fixtures locais pequenos e não são
componentes visuais do Documentary Card; a composição visual permanece
explicitamente fora desta Wave.

## 3. Template Registry

`lib/creative/templates/registry.ts` contém um mapa estático em código com:

- `editorial.documentary-card@0.1.0`, `scope: system`;
- variants `cover` e `info`;
- modos `still` e `video`;
- canvases `1080x1350` e `1080x1920`;
- `component_key: editorial.documentary-card` (chave opaca, sem import React);
- schemas da Wave 2 selecionados por variant;
- motion permitido: `none`, `fade`, `slow_push`, `slow_pan`.

API principal:

- `listTemplates()`;
- `resolveTemplate(ref)`;
- `selectTemplateBindingSchemas(resolved)`;
- `validateTemplateContent(...)`;
- `validateTemplateAssetBindings(...)`;
- `validateTemplateCanvas(...)`;
- `validateTemplateMode(...)`;
- `validateTemplateMotion(...)`.

Erros estruturados incluem `template_not_found`,
`template_version_not_found`, `variant_not_supported`,
`canvas_not_supported`, `content_invalid`, `asset_binding_invalid` e
`motion_not_supported`.

Cover reutiliza `DocumentaryCardCoverContentSchema` e
`DocumentaryCardCoverAssetsSchema`; portanto `hero` continua obrigatório.
Info reutiliza os schemas de info e não exige `hero`. Não foi adicionado
`AssetRef.role`, nem slot especulativo global.

## 4. Identity fixtures

`resolveIdentitySnapshot()` resolve deterministicamente:

- `fixture:identity:comunidades-alternativas:v1` — tipografia Fraunces/Source
  Sans 3, paleta clara e logo fixture;
- `fixture:identity:acme-labs:v1` — tipografia Space Grotesk/Inter, paleta
  escura e tokens diferentes.

Ambos são validados por `VisualTokensSnapshotSchema`. Snapshot ausente produz
`identity_not_found`. Nenhuma Project Identity persistida foi lida ou
alterada; não há Font Catalog, Font Picker ou `FontRef` persistente nesta
Wave.

## 5. Asset fixtures

`resolveAsset()` aceita somente `AssetRef.type === 'fixture'` nesta camada e
retorna `ResolvedAsset` runtime-only com `path`, `url`, MIME, dimensões,
checksum/version, focal point e alt quando fornecidos.

Refs locais cobertos:

- `fixture:asset:terra-una:documentary-photo-01`;
- `fixture:asset:acme-labs:hero-01`;
- `fixture:asset:comunidades-alternativas:logo-v1`.

Fixture ausente produz `asset_not_found`; `library_file`, `image`,
`production_artifact` e `external` produzem explicitamente
`asset_type_not_supported` nesta Wave. Não há LibraryFile real, S3, signed
URL, upload ou fetch externo.

## 6. Resolved input shapes

Os outputs são tipos runtime-only e não contêm Composition id, Player,
`renderStill`, Chromium, bundle path ou configuração de renderer.

```ts
type ResolvedStaticRenderInput = {
  manifest: StaticRenderManifest
  resolvedTemplate: { ref: Required<TemplateRef>; descriptor: TemplateDescriptor }
  tokens: VisualTokensSnapshot
  resolvedAssets: Record<string, ResolvedAsset>
  diagnostics: RuntimeDiagnostic[]
}

type ResolvedTimelineInput = {
  manifest: TimelineManifest
  tokens: VisualTokensSnapshot
  resolvedAssets: Record<string, ResolvedAsset>
  resolvedTemplateSegments: Array<{
    segment: TemplateSegment
    resolvedTemplate: { ref: Required<TemplateRef>; descriptor: TemplateDescriptor }
    resolvedAssets: Record<string, ResolvedAsset>
  }>
  diagnostics: RuntimeDiagnostic[]
}
```

Timeline mantém frames como unidade canônica. A fixture mínima tem
`1080x1920`, `30 fps`, `180 frames`, um track visual e um template segment
cover com `slow_push`; nenhuma API de `Sequence` do Remotion é usada.

## 7. Diagnostics

Todos os resolvers retornam o formato previsível `valid`, `errors`,
`warnings` e `value` quando válido. Cada erro tem pelo menos `kind`, `code`,
`message` e, quando aplicável, `path`/`issues`.

As categorias são:

- `schema_error` — parse Zod ou invariantes semânticas da Timeline;
- `template_error` — registry, canvas, modo ou motion;
- `binding_error` — content/assets incompatíveis com a variant;
- `identity_error` — snapshot não encontrado;
- `asset_error` — fixture ausente ou tipo não suportado.

## 8. Testes e baseline

`lib/creative/__tests__/runtime-resolution.test.ts` cobre registry,
variants, canvases, motion, identity A/B/missing, tokens diferentes, asset
fixture/missing/unsupported, static cover/info/second project, erros de
schema/binding/identity/asset, timeline mínima, content/motion/asset
inválidos e ausência de texto `remotion` no output resolvido.

Resultado focado Wave 3 + Wave 2: **92/92 testes** (9 arquivos). A suite
completa, typecheck, lint e build foram executados no fechamento desta Wave;
qualquer warning de lint permanece o baseline preexistente e não foi
reclassificado como falha desta camada.

WIP histórico em `/videos`, `/imagens`, `/api/video-drafts`,
`/api/image-drafts` e `lib/draft-hub.ts` permaneceu intocado. Nenhum binário,
credencial, migration ou output de render foi adicionado.

## 9. Deferred / constraints

- Não existe ainda resolução de `library_file`, S3 ou Supabase.
- Não existe integração com Project Identity real; snapshots continuam
  fixture-only.
- Não existe Documentary Card React, Primitive Library, authoring/editor,
  VideoWork ou persistência de render execution.
- O registry ainda é estático e não tem descoberta, version negotiation ou
  custom project templates.
- Resolução de segmentos não-template apenas preserva esses segmentos no
  manifest; o trabalho desta Wave é o binding de template/documentary-card.
- Remotion permanece adapter posterior; esta camada não o importa.

## 10. Gate 3 Verdict

### **PASS**

`StaticRenderManifest → ResolvedStaticRenderInput` e
`TimelineManifest → ResolvedTimelineInput` funcionam com fixtures locais;
cover/info usam os schemas corretos; identity A/B são determinísticas e
diferentes; assets locais resolvem; o segundo Project percorre exatamente o
mesmo caminho; os diagnósticos são previsíveis; os resolvers não dependem de
Remotion, banco ou storage real; e não houve regressão conhecida.

Wave 4 — composição visual real — permanece deliberadamente não iniciada.
