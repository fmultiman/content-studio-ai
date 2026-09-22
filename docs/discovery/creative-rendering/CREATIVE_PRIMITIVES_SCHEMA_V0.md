# Creative Primitives Schema V0

**Status:** Implementation-prep draft  
**Produto:** Content Agent Studio  
**Escopo:** schemas compartilhados pela Creative Rendering Layer  
**Depende de:** `RENDER_ARCHITECTURE_V0.md`, `STATIC_RENDER_MANIFEST_V0.md`, `TIMELINE_MANIFEST_V0_REFINEMENT.md`, `TEMPLATE_REGISTRY_V0.md`

---

## 1. Objetivo

Transformar as primitivas conceituais já definidas em contratos TypeScript/Zod próximos do formato implementável, sem criar ainda migrations, tabelas ou dependência de Remotion.

Este documento concentra os tipos compartilhados por static render, timeline e templates:

- `CanvasSpec`;
- `TemplateRef`;
- `IdentitySnapshotRef`;
- `AssetRef`;
- `VisualTokensSnapshot`;
- `MotionSpec`;
- `TransitionSpec`;
- `OutputRole`.

A regra central continua sendo:

> O domínio e os manifests descrevem intenção e estrutura. O renderer traduz essa estrutura para tecnologia concreta.

---

## 2. Convenções de schema

Direção recomendada para o spike:

```ts
import {z} from "zod";
```

Preferências:

- objetos de contrato usam `.strict()` quando possível;
- ids são strings não vazias;
- dimensões e frames são inteiros;
- valores normalizados usam faixa `0..1`;
- versões de contrato são literais;
- versões de template são strings explícitas;
- campos opcionais só existem quando há semântica clara;
- evitar `z.any()`;
- `unknown` é aceito apenas onde outro schema será responsável pela validação.

O código abaixo é **contrato conceitual**. Antes da implementação, o agente deve reconciliar nomes, aliases e estilo Zod com o repositório atual.

---

## 3. Identificadores básicos

```ts
export const RefSchema = z.string().trim().min(1);

export const SchemaVersionSchema = z.string().trim().min(1);

export const TemplateVersionSchema = z.string().trim().min(1);
```

Semver é recomendado para template version, mas o primeiro spike não precisa bloquear implementação por uma regex excessivamente rígida.

---

## 4. CanvasSpec

```ts
export const CanvasSpecSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    unit: z.literal("px"),
  })
  .strict();

export type CanvasSpec = z.infer<typeof CanvasSpecSchema>;
```

Regras:

- o manifest final sempre fixa width e height;
- canal pode sugerir preset, mas não substitui dimensão explícita;
- aspect ratio é derivável;
- limites máximos pertencem à infraestrutura/render adapter.

Presets podem existir fora do contrato:

```ts
const CANVAS_PRESETS = {
  instagramPortrait: {width: 1080, height: 1350, unit: "px"},
  verticalVideo: {width: 1080, height: 1920, unit: "px"},
  youtube: {width: 1920, height: 1080, unit: "px"},
} satisfies Record<string, CanvasSpec>;
```

---

## 5. TemplateRef

```ts
export const TemplateScopeSchema = z.enum(["system", "project"]);

export const TemplateRefSchema = z
  .object({
    id: z.string().trim().min(1),
    version: TemplateVersionSchema,
    variant: z.string().trim().min(1).optional(),
    scope: TemplateScopeSchema,
  })
  .strict();

export type TemplateRef = z.infer<typeof TemplateRefSchema>;
```

Invariante:

> `TemplateRef.id` nunca identifica implicitamente o Project.

Exemplo correto:

```json
{
  "id": "editorial.documentary-card",
  "version": "0.1.0",
  "variant": "cover",
  "scope": "system"
}
```

---

## 6. IdentitySnapshotRef

```ts
export const IdentitySnapshotRefSchema = z
  .object({
    snapshot_ref: RefSchema,
    token_profile: z.string().trim().min(1).optional(),
  })
  .strict();

export type IdentitySnapshotRef = z.infer<
  typeof IdentitySnapshotRefSchema
>;
```

O snapshot é parte da reprodutibilidade.

Ele não precisa ser uma tabela no V0. Pode inicialmente apontar para um artifact, fixture ou estrutura resolvida em memória.

---

## 7. FocalPoint

```ts
export const FocalPointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
```

Interpretação:

- `0,0` = canto superior esquerdo;
- `0.5,0.5` = centro;
- `1,1` = canto inferior direito.

Focal point é propriedade de uso do asset, não do renderer.

---

## 8. AssetRef

```ts
export const AssetTypeSchema = z.enum([
  "library_file",
  "image",
  "production_artifact",
  "external",
  "fixture",
]);

export const AssetFitSchema = z.enum([
  "cover",
  "contain",
  "fill",
]);

export const AssetRefSchema = z
  .object({
    type: AssetTypeSchema,
    ref: RefSchema,

    version: z.string().trim().min(1).optional(),
    checksum: z.string().trim().min(1).optional(),

    fit: AssetFitSchema.optional(),
    focal_point: FocalPointSchema.optional(),

    alt: z.string().trim().min(1).optional(),
  })
  .strict();

export type AssetRef = z.infer<typeof AssetRefSchema>;
```

Não incluir aqui:

- URL assinada temporária;
- caminho local de worker;
- bucket credentials;
- dados específicos do Remotion.

O adapter resolve `AssetRef` para uma mídia concreta durante a execução.

---

## 9. VisualTokensSnapshot

### 9.1 Fronteira

`Project Identity` continua semântica.

`VisualTokensSnapshot` é a compilação operacional necessária para um template.

Uma decisão importante para V0:

> Família tipográfica, pesos, cores, marca e preferências gerais podem vir dos tokens. Tamanho exato de fonte, line-height, posicionamento e grid continuam principalmente responsabilidade do template/variant/canvas.

Isso evita transformar Project Identity em layout pixel a pixel.

### 9.2 Typography tokens

```ts
export const FontStyleSchema = z.enum([
  "normal",
  "italic",
]);

export const TypographyRoleSchema = z
  .object({
    family: z.string().trim().min(1),
    weight: z.number().int().min(100).max(900),
    style: FontStyleSchema.default("normal"),

    letter_spacing_em: z.number().optional(),
    text_transform: z
      .enum(["none", "uppercase", "lowercase"])
      .optional(),
  })
  .strict();
```

V0 não exige `font_size_px` nos identity tokens.

O template determina, por exemplo:

```ts
cover + 1080x1350 → title 78px
cover + 1080x1920 → title 86px
```

mas usa a família/peso vindos dos tokens.

### 9.3 Color tokens

```ts
export const ColorTokenSchema = z.string().trim().min(1);
```

A implementação pode restringir depois para HEX/RGB/HSL/CSS Color quando o repositório mostrar a convenção mais adequada.

### 9.4 Spacing e safe area

```ts
export const SafeAreaSchema = z
  .object({
    top: z.number().nonnegative(),
    right: z.number().nonnegative(),
    bottom: z.number().nonnegative(),
    left: z.number().nonnegative(),
    unit: z.literal("px"),
  })
  .strict();

export const SpacingTokensSchema = z
  .object({
    unit: z.number().positive(),
    default_gap: z.number().nonnegative().optional(),
    safe_area: SafeAreaSchema.optional(),
  })
  .strict();
```

A `safe_area` é preferência/padrão visual.

O template pode exigir uma margem mínima maior para determinada composição.

### 9.5 Brand tokens

```ts
export const BrandTokensSchema = z
  .object({
    logo_asset_ref: RefSchema.optional(),
    mark_asset_ref: RefSchema.optional(),
  })
  .strict();
```

### 9.6 Snapshot completo

```ts
export const VisualTokensSnapshotSchema = z
  .object({
    schema_version: z.literal("visual-tokens.v0"),
    snapshot_ref: RefSchema,

    typography: z
      .object({
        display: TypographyRoleSchema,
        body: TypographyRoleSchema,
        label: TypographyRoleSchema.optional(),
      })
      .strict(),

    colors: z
      .object({
        background: ColorTokenSchema,
        foreground: ColorTokenSchema,
        muted: ColorTokenSchema.optional(),
        accent: ColorTokenSchema.optional(),
      })
      .strict(),

    spacing: SpacingTokensSchema,

    brand: BrandTokensSchema.optional(),
  })
  .strict();

export type VisualTokensSnapshot = z.infer<
  typeof VisualTokensSnapshotSchema
>;
```

---

## 10. Onde ficam margem e fonte

### Project Identity / Visual Tokens

Pode definir:

- família;
- peso;
- estilo;
- cor;
- logo;
- unidade de spacing;
- safe area padrão;
- preferências gerais.

### Template

Define:

- `font-size`;
- `line-height`;
- grid;
- padding real;
- posicionamento;
- largura máxima de texto;
- relação foto/texto;
- comportamento por canvas;
- política de overflow.

### Manifest

Fornece:

- conteúdo;
- asset;
- template;
- variant;
- canvas;
- identity snapshot.

Evitar no manifest:

```json
{
  "titleFontSize": 84,
  "left": 72,
  "top": 1040
}
```

salvo se um template específico declarar formalmente esses parâmetros como overrides.

---

## 11. MotionSpec

V0 usa linguagem semântica curta.

```ts
export const MotionPresetSchema = z.enum([
  "none",
  "fade",
  "slow_push",
  "slow_pan",
  "rise",
  "reveal",
]);

export const MotionDirectionSchema = z.enum([
  "up",
  "down",
  "left",
  "right",
]);

export const MotionSpecSchema = z
  .object({
    preset: MotionPresetSchema,
    intensity: z.number().min(0).max(1).optional(),
    direction: MotionDirectionSchema.optional(),
  })
  .strict();

export type MotionSpec = z.infer<typeof MotionSpecSchema>;
```

Não colocar no V0:

- keyframes arbitrários;
- função JS;
- easing custom serializado;
- expressão CSS;
- AST universal de animação.

### Interpretação

`intensity` não significa diretamente `scale`.

Exemplo:

```text
slow_push + intensity=0.35
```

pode ser traduzido pelo template/adapter para um zoom sutil.

O mesmo preset em outro template pode ter amplitude diferente.

---

## 12. TransitionSpec

```ts
export const TransitionPresetSchema = z.enum([
  "cut",
  "crossfade",
  "fade_through",
]);

export const TransitionSpecSchema = z
  .object({
    preset: TransitionPresetSchema,
    duration_frames: z.number().int().positive().optional(),
  })
  .strict();

export type TransitionSpec = z.infer<
  typeof TransitionSpecSchema
>;
```

Motion pertence a um elemento/segmento.

Transition descreve a relação de passagem entre segmentos.

---

## 13. Render output roles

```ts
export const StaticOutputFormatSchema = z.enum([
  "png",
  "jpeg",
  "webp",
]);

export const VideoContainerSchema = z.enum([
  "mp4",
  "webm",
  "mov",
]);
```

Não acoplar codec/engine avançado às primitivas de domínio no spike inicial.

---

## 14. ContentBindings

O core não conhece o shape de conteúdo de cada template.

```ts
export const ContentBindingsSchema = z.record(
  z.string(),
  z.unknown(),
);
```

Este schema só confirma que há um objeto serializável.

A validação real acontece em:

```text
manifest base schema
→ resolveTemplate()
→ template.contentSchema.parse(content)
```

O mesmo princípio vale para asset slots.

---

## 15. Regras de reprodutibilidade

Para um output ser considerado reproduzível, o conjunto efetivo deve permitir recuperar:

- manifest version;
- template id/version;
- identity snapshot;
- asset refs;
- asset versions/checksums quando disponíveis;
- canvas;
- conteúdo;
- motion/transition semânticos;
- renderer execution metadata separadamente.

---

## 16. O que fica explicitamente fora

- Remotion `interpolate()`;
- Remotion `spring()`;
- React imports;
- CSS classes;
- Tailwind tokens;
- worker configuration;
- URLs assinadas;
- paths de filesystem;
- FFmpeg flags.

Esses elementos pertencem às implementações.

---

## 17. Decisões V0

1. Primitivas compartilhadas terão schemas Zod.
2. Objetos centrais devem preferir `.strict()`.
3. Focal points usam coordenadas normalizadas.
4. Visual Tokens não substituem Project Identity.
5. Font family/peso são tokens; tamanho/layout ficam predominantemente no template.
6. Safe area pode nascer da Identity compilada, mas template pode impor mínimo.
7. Motion começa por presets semânticos.
8. Transition é conceito separado de Motion.
9. Nenhuma primitive importa Remotion.
10. Persistência definitiva continua adiada até o spike.
