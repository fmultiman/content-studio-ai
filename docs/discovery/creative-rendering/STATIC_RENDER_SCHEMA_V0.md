# Static Render Schema V0

**Status:** Implementation-prep draft  
**Produto:** Content Agent Studio  
**Escopo:** schema Zod conceitual do `StaticRenderManifest V0`  
**Depende de:** `CREATIVE_PRIMITIVES_SCHEMA_V0.md`

---

## 1. Objetivo

Converter o contrato conceitual de `StaticRenderManifest` em uma estrutura validável suficientemente próxima da implementação para permitir o primeiro Shared Creative Rendering Spike.

O schema base valida estrutura comum.

O `Template Registry` continua responsável por validar `content` e slots de `assets`.

---

## 2. Source

```ts
export const StaticRenderSourceTypeSchema = z.enum([
  "channel_piece",
  "editorial_content",
  "production",
  "manual",
  "fixture",
]);

export const StaticRenderSourceSchema = z
  .object({
    type: StaticRenderSourceTypeSchema,
    ref: RefSchema.optional(),
  })
  .strict();
```

Regra sugerida:

- `fixture` pode usar refs fictícios explícitos;
- records persistidos devem usar refs reais;
- `manual` pode temporariamente não ter ref.

---

## 3. Context

```ts
export const StaticRenderContextSchema = z
  .object({
    project_ref: RefSchema,
    production_ref: RefSchema.optional(),
  })
  .strict();
```

V0 mantém `project_ref` obrigatório porque identidade e resolução de assets dependem do Project.

---

## 4. Identity binding

Usa a primitive:

```ts
IdentitySnapshotRefSchema
```

O manifest não carrega a Project Identity completa.

---

## 5. Output

```ts
export const StaticRenderOutputSchema = z
  .object({
    format: StaticOutputFormatSchema,
    role: z.string().trim().min(1).optional(),
    quality_profile: z.string().trim().min(1).optional(),
    transparent: z.boolean().optional(),
  })
  .strict();
```

`quality_profile` é intenção técnica estável, não flags de renderer.

Exemplo:

```text
social-high
thumbnail-fast
archive-lossless
```

A existência concreta desses presets será responsabilidade da infraestrutura.

---

## 6. Metadata controlada

```ts
export const StaticRenderMetadataSchema = z
  .object({
    fixture: z.boolean().optional(),
    fixture_purpose: z.string().trim().min(1).optional(),
    not_a_database_record: z.boolean().optional(),
    source_verification_required_before_publication:
      z.boolean().optional(),
    locale: z.string().trim().min(1).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
```

Não usar metadata como escape hatch para propriedades de layout ou renderer.

---

## 7. StaticRenderManifestSchema

```ts
export const StaticRenderManifestSchema = z
  .object({
    schema_version: z.literal("static-render.v0"),
    manifest_id: RefSchema,

    source: StaticRenderSourceSchema,

    context: StaticRenderContextSchema,

    template: TemplateRefSchema,

    canvas: CanvasSpecSchema,

    identity: IdentitySnapshotRefSchema,

    content: ContentBindingsSchema,

    assets: z.record(
      z.string().trim().min(1),
      AssetRefSchema,
    ),

    output: StaticRenderOutputSchema,

    metadata: StaticRenderMetadataSchema.optional(),
  })
  .strict();
```

---

## 8. Segundo estágio de validação

O manifest base não sabe que `editorial.documentary-card` exige `title` e `hero`.

Fluxo correto:

```ts
const manifest =
  StaticRenderManifestSchema.parse(input);

const template =
  resolveTemplate(manifest.template);

template.contentSchema.parse(manifest.content);
template.assetsSchema.parse(manifest.assets);

validateCanvas(template, manifest.canvas);
validateIdentityRequirements(template, tokens);
```

Isso preserva a separação:

```text
core contract
≠
template-specific contract
```

---

## 9. Regra para project-scoped template

Se:

```ts
manifest.template.scope === "project"
```

o resolver deve usar:

```ts
manifest.context.project_ref
```

para restringir a descoberta.

O template id ainda não incorpora o nome do Project.

---

## 10. Fixture atual do Portal

O fixture `PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json` já exercita:

- `source.type = fixture`;
- Project e Production refs fictícios;
- template genérico `editorial.documentary-card`;
- canvas `1080x1350`;
- identity snapshot;
- conteúdo editorial;
- hero asset;
- PNG;
- `carousel_item`;
- metadata explicitamente marcada como fixture.

Ele deve se tornar o primeiro teste de parsing quando o schema for implementado.

---

## 11. Validações cruzadas sugeridas

### 11.1 Transparência

Se:

```text
transparent = true
```

o adapter/template deve confirmar capability correspondente.

Isso não precisa ser validado somente pelo Zod base.

### 11.2 Project template

`scope=project` sem `project_ref` é impossível no schema atual porque project_ref já é obrigatório.

### 11.3 Asset refs

O schema estrutural confirma a forma.

A existência real do asset é um validation gate posterior.

### 11.4 Canvas

O schema confirma dimensão positiva.

O Registry confirma se o template suporta aquele canvas.

---

## 12. Result model

Recomendação para validação do pipeline:

```ts
type ValidationIssue = {
  code: string;
  path?: string;
  message: string;
  severity: "warning" | "error";
};

type StaticRenderValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};
```

Zod pode continuar lançando/retornando erros estruturais; esse modelo serve para validations semânticas posteriores.

---

## 13. Overflow

Overflow não deve gerar mutação silenciosa do manifest.

Possível resultado:

```json
{
  "code": "content_overflow_risk",
  "path": "content.title",
  "severity": "warning",
  "message": "Title exceeds the recommended length for variant cover."
}
```

A solução pertence ao template:

- human review;
- variant alternativa;
- fit dentro de limites;
- truncation explícita;
- rejeição.

---

## 14. Manifest versus resolved render input

O manifest permanece neutro.

Antes do renderer, uma etapa interna pode produzir:

```ts
type ResolvedStaticRenderInput = {
  manifest: StaticRenderManifest;
  template: ResolvedTemplate;
  tokens: VisualTokensSnapshot;
  resolvedAssets: Record<string, ResolvedAsset>;
};
```

`ResolvedAsset` pode conter URLs/paths temporários.

Ele **não** é persistido como fonte de verdade.

---

## 15. Relação com Remotion

O adapter pode mapear:

```text
StaticRenderManifest
→ ResolvedStaticRenderInput
→ Remotion <Still>
→ image render
```

A existência de `<Still>` é detalhe de adapter.

O schema não contém `compositionId`.

---

## 16. Testes mínimos

```text
✓ parse fixture válido
✓ rejeitar schema_version incorreta
✓ rejeitar canvas negativo
✓ rejeitar template sem version
✓ rejeitar asset sem ref
✓ rejeitar campo desconhecido no root
✓ permitir source fixture
✓ permitir project scoped template
✓ separar erro estrutural de template validation
✓ garantir que Portal não apareça em enum ou branch de core
```

---

## 17. Decisões V0

1. `project_ref` é obrigatório.
2. `production_ref` continua opcional no contrato estático.
3. `content` é validado em duas etapas.
4. `assets` usam `AssetRef`.
5. Metadata passa a ter shape controlado.
6. Template capability validation fica fora do schema base.
7. Resolução técnica de assets acontece depois do manifest.
8. Fixture do Portal é teste, não regra.
