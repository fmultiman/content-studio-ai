# Template Descriptor Schema V0

**Status:** Implementation-prep draft  
**Produto:** Content Agent Studio  
**Escopo:** schema do Template Registry e fronteira do template React  
**Depende de:** `CREATIVE_PRIMITIVES_SCHEMA_V0.md`

---

## 1. Objetivo

Definir o contrato que permite ao Content Agent Studio descobrir e validar templates sem conhecer sua implementação concreta.

O Descriptor responde:

- qual é o template;
- qual versão;
- qual scope;
- quais modos suporta;
- quais variants;
- quais canvases;
- quais schemas de content/assets;
- quais motion presets;
- quais tokens de identidade exige;
- qual component key o Registry resolve.

---

## 2. TemplateId

```ts
export const TemplateIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
```

Exemplo:

```text
editorial.documentary-card
```

Não usar nome de Project em system template.

---

## 3. Modes

```ts
export const TemplateModeSchema = z.enum([
  "still",
  "video",
]);
```

Um template pode suportar um ou ambos.

---

## 4. Variants

V0 mantém variants como ids simples.

```ts
export const TemplateVariantIdSchema = z
  .string()
  .trim()
  .min(1);
```

Exemplos:

```text
cover
standard
quote
source
closing
```

Quando variants precisarem de metadata própria, o Descriptor poderá evoluir sem alterar TemplateRef.

---

## 5. Canvas support

```ts
export const CanvasSupportSchema = z.discriminatedUnion(
  "strategy",
  [
    z
      .object({
        strategy: z.literal("fixed"),
        size: CanvasSpecSchema,
      })
      .strict(),

    z
      .object({
        strategy: z.literal("declared_sizes"),
        sizes: z.array(CanvasSpecSchema).min(1),
      })
      .strict(),

    z
      .object({
        strategy: z.literal("fluid"),
        min_width: z.number().int().positive().optional(),
        min_height: z.number().int().positive().optional(),
        max_width: z.number().int().positive().optional(),
        max_height: z.number().int().positive().optional(),
      })
      .strict(),
  ],
);
```

Primeiro spike:

```text
declared_sizes
```

com pelo menos:

```text
1080x1350
1080x1920
```

---

## 6. Schema keys

Descriptor não serializa Zod.

Ele registra chaves resolvíveis em código.

```ts
export const TemplateSchemaRefsSchema = z
  .object({
    content: RefSchema,
    assets: RefSchema,
  })
  .strict();
```

Exemplo:

```json
{
  "content": "editorial.documentary-card.content.v0",
  "assets": "editorial.documentary-card.assets.v0"
}
```

---

## 7. Capabilities

```ts
export const TemplateCapabilitiesSchema = z
  .object({
    motion_presets: z
      .array(MotionPresetSchema)
      .default(["none"]),

    supports_transparency: z
      .boolean()
      .default(false),
  })
  .strict();
```

Um `MotionSpec` só é válido se o template suportar aquele preset.

---

## 8. Identity requirements

```ts
export const IdentityTokenPathSchema =
  z.string().trim().min(1);

export const IdentityRequirementsSchema =
  z.array(IdentityTokenPathSchema);
```

Exemplo:

```ts
[
  "typography.display",
  "typography.body",
  "colors.background",
  "colors.foreground",
  "spacing.safe_area",
  "brand.logo_asset_ref",
]
```

O template recebe `VisualTokensSnapshot`, não Project Identity bruta.

---

## 9. Overflow policy

Texto variável exige contrato.

```ts
export const OverflowPolicySchema = z.enum([
  "reject",
  "truncate",
  "fit_within_range",
  "alternate_variant",
  "human_review",
]);
```

O Descriptor pode declarar defaults:

```ts
export const TemplateTextPolicySchema = z
  .object({
    default_overflow_policy: OverflowPolicySchema,
  })
  .strict();
```

Limites específicos de cada campo continuam no content schema do template.

---

## 10. Component key

```ts
export const ComponentKeySchema =
  z.string().trim().min(1);
```

O Descriptor guarda:

```text
editorial-documentary-card
```

O Registry mapeia isso para o componente React.

Manifest nunca guarda import path.

---

## 11. TemplateDescriptorSchema

```ts
export const TemplateDescriptorSchema = z
  .object({
    id: TemplateIdSchema,
    version: TemplateVersionSchema,
    scope: TemplateScopeSchema,

    label: z.string().trim().min(1),

    supported_modes: z
      .array(TemplateModeSchema)
      .min(1),

    variants: z
      .array(TemplateVariantIdSchema)
      .min(1),

    canvas_support: CanvasSupportSchema,

    schemas: TemplateSchemaRefsSchema,

    capabilities: TemplateCapabilitiesSchema,

    identity_requirements:
      IdentityRequirementsSchema.default([]),

    text_policy:
      TemplateTextPolicySchema.optional(),

    component_key: ComponentKeySchema,
  })
  .strict();
```

---

## 12. Project-scoped descriptor

Um template de Project pode usar o mesmo Descriptor acrescido de contexto no Registry:

```ts
type RegisteredTemplate = {
  descriptor: TemplateDescriptor;
  project_ref?: string;
  component: React.ComponentType<...>;
};
```

Regra:

```text
scope=system
→ project_ref ausente

scope=project
→ project_ref obrigatório no registro
```

Isso pode ser validado na API do Registry.

---

## 13. Content schema do primeiro template

Exemplo conceitual:

```ts
export const DocumentaryCardContentSchema = z
  .object({
    eyebrow: z.string().trim().min(1).max(48).optional(),

    title: z.string().trim().min(1).max(120),

    subtitle: z.string().trim().min(1).max(220).optional(),

    source_line: z.string().trim().min(1).max(160).optional(),

    footer: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
```

Os números são **pontos de partida para o spike**, não padrões universais de produto.

O preview real deverá validar se esses limites fazem sentido.

---

## 14. Asset schema do primeiro template

```ts
export const DocumentaryCardAssetsSchema = z
  .object({
    hero: AssetRefSchema,

    logo: AssetRefSchema.optional(),
  })
  .strict();
```

Preferência:

- `hero` vem do manifest;
- `logo` normalmente vem da identidade;
- override explícito pode existir quando necessário.

---

## 15. Onde vivem margem, tipografia e layout

### Descriptor

Declara capabilities e requirements.

Não contém pixels de layout detalhados.

### Visual Tokens

Fornecem:

- font family;
- weight;
- colors;
- safe-area default;
- brand assets.

### React template

Define:

- grid;
- padding;
- margin;
- font-size;
- line-height;
- max-width;
- crop;
- overlays;
- hierarchy;
- canvas-specific adjustments.

Exemplo conceitual:

```ts
const layoutByCanvas = {
  "1080x1350": {
    paddingX: 72,
    paddingTop: 72,
    paddingBottom: 72,
    titleSize: 78,
    titleLineHeight: 0.95,
  },

  "1080x1920": {
    paddingX: 72,
    paddingTop: 96,
    paddingBottom: 108,
    titleSize: 86,
    titleLineHeight: 0.94,
  },
};
```

Esses valores pertencem ao template versionado.

Não ao manifest.

---

## 16. React template boundary

Contrato conceitual:

```ts
export type TemplateComponentProps<TContent> = {
  content: TContent;

  assets: ResolvedAssets;

  tokens: VisualTokensSnapshot;

  canvas: CanvasSpec;

  mode: "still" | "video";

  frame?: number;
  durationFrames?: number;

  motion?: MotionSpec;
};
```

O component:

- não consulta banco;
- não carrega Production;
- não decide Project;
- não gera texto editorial;
- não escolhe asset por conta própria.

Tudo entra por props já resolvidas.

---

## 17. Font loading boundary

O template pede uma família via tokens.

A infraestrutura do renderer garante que ela esteja carregada.

Conceitualmente:

```text
VisualTokens
→ font registry
→ renderer bootstrap
→ template render
```

Não colocar `loadFont()` dentro de cada card se isso puder ser centralizado.

Para reprodutibilidade, fontes locais/versionadas são preferíveis quando a licença permitir.

---

## 18. Motion implementation boundary

Descriptor declara:

```text
motion_presets:
  none
  fade
  slow_push
```

Manifest escolhe:

```json
{
  "preset": "slow_push",
  "intensity": 0.35
}
```

Template/adaptador implementa:

```text
frame
→ progress
→ scale / translate / opacity
```

O preset deve ser determinístico dentro de uma versão do template.

---

## 19. Registry API

```ts
registerTemplate(
  descriptor,
  schemas,
  component,
  options?
);

resolveTemplate(templateRef, context?);

validateTemplateBindings(
  templateRef,
  content,
  assets,
  context?,
);

listTemplates(filters?);

listTemplateVariants(templateRef, context?);
```

No spike, o registry pode ser um mapa TypeScript estático.

---

## 20. ResolvedTemplate

```ts
type ResolvedTemplate = {
  descriptor: TemplateDescriptor;

  contentSchema: z.ZodType;

  assetsSchema: z.ZodType;

  component: React.ComponentType<
    TemplateComponentProps<unknown>
  >;
};
```

Este objeto é de runtime.

Não precisa ser serializado.

---

## 21. Primeiro Descriptor

```json
{
  "id": "editorial.documentary-card",
  "version": "0.1.0",
  "scope": "system",
  "label": "Documentary Card",

  "supported_modes": [
    "still",
    "video"
  ],

  "variants": [
    "cover",
    "standard"
  ],

  "canvas_support": {
    "strategy": "declared_sizes",
    "sizes": [
      {
        "width": 1080,
        "height": 1350,
        "unit": "px"
      },
      {
        "width": 1080,
        "height": 1920,
        "unit": "px"
      }
    ]
  },

  "schemas": {
    "content": "editorial.documentary-card.content.v0",
    "assets": "editorial.documentary-card.assets.v0"
  },

  "capabilities": {
    "motion_presets": [
      "none",
      "fade",
      "slow_push"
    ],
    "supports_transparency": false
  },

  "identity_requirements": [
    "typography.display",
    "typography.body",
    "colors.background",
    "colors.foreground",
    "spacing.safe_area"
  ],

  "text_policy": {
    "default_overflow_policy": "human_review"
  },

  "component_key": "editorial-documentary-card"
}
```

---

## 22. Testes mínimos

```text
✓ resolve template system
✓ rejeitar id inválido
✓ rejeitar mode desconhecido
✓ rejeitar canvas não suportado
✓ rejeitar variant inexistente
✓ validar content schema
✓ validar assets schema
✓ rejeitar motion não suportado
✓ detectar identity token faltante
✓ component não acessa banco
✓ mesma versão mantém comportamento determinístico
✓ dois Projects usam mesmo system template com tokens diferentes
```

---

## 23. Decisões V0

1. Descriptor é serializável.
2. Componente React não é serializado.
3. Variants começam simples.
4. Canvas começa por declared sizes.
5. Font sizes e margens pertencem ao template versionado.
6. Brand typography/colors entram via Visual Tokens.
7. Overflow policy é explícita.
8. Motion capability é declarada pelo template.
9. Font loading pertence à infraestrutura do renderer.
10. Primeiro template continua genérico e reutilizável.
