# Timeline Schema V0

**Status:** Implementation-prep draft  
**Produto:** Content Agent Studio  
**Escopo:** schema Zod conceitual para `TimelineManifest V0`  
**Depende de:** `CREATIVE_PRIMITIVES_SCHEMA_V0.md`

---

## 1. Objetivo

Transformar a Timeline Manifest neutra já definida na arquitetura de vídeo em uma estrutura validável, mantendo separadas:

- intenção narrativa (`Scene Plan`);
- decisões temporais (`Timeline Manifest`);
- aparência (`Template`);
- execução (`Renderer Adapter`).

---

## 2. Frame

```ts
export const FrameSchema = z.number().int().nonnegative();

export const PositiveFrameCountSchema =
  z.number().int().positive();
```

Assembly normaliza tempo para frames.

---

## 3. Timeline specification

```ts
export const TimelineSpecificationSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    duration_frames: PositiveFrameCountSchema,
  })
  .strict();
```

O primeiro spike deve usar fps inteiro, mas o schema não precisa impedir fps fracionário até a auditoria de requisitos.

---

## 4. Tracks

```ts
export const TimelineTrackKindSchema = z.enum([
  "video",
  "audio",
  "overlay",
  "caption",
]);

export const TimelineTrackSchema = z
  .object({
    id: RefSchema,
    kind: TimelineTrackKindSchema,
    order: z.number().int().nonnegative(),

    muted: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict();
```

`locked` é informação de UI/edição.

Não altera semântica de render.

---

## 5. Segment base

```ts
const TimelineSegmentBaseSchema = z
  .object({
    id: RefSchema,
    track_id: RefSchema,

    scene_plan_ref: RefSchema.optional(),

    start_frame: FrameSchema,
    duration_frames: PositiveFrameCountSchema,

    transition_out: TransitionSpecSchema.optional(),
  })
  .strict();
```

---

## 6. Media segment

```ts
export const MediaSegmentPayloadSchema = z
  .object({
    asset_ref: RefSchema,

    source_in_frame: FrameSchema.optional(),
    source_out_frame: FrameSchema.optional(),

    fit: AssetFitSchema.optional(),

    transform: z
      .object({
        scale: z.number().positive().optional(),

        position: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const MediaSegmentSchema =
  TimelineSegmentBaseSchema.extend({
    kind: z.literal("media"),
    payload: MediaSegmentPayloadSchema,
  });
```

Aqui `scale` representa decisão concreta de montagem.

Isso é diferente de `MotionSpec.intensity`, que continua semântico.

---

## 7. Template segment

```ts
export const TemplateSegmentPayloadSchema = z
  .object({
    template: TemplateRefSchema,

    content: ContentBindingsSchema,

    assets: z.record(
      z.string().trim().min(1),
      AssetRefSchema,
    ),

    motion: MotionSpecSchema.optional(),
  })
  .strict();

export const TemplateSegmentSchema =
  TimelineSegmentBaseSchema.extend({
    kind: z.literal("template"),
    payload: TemplateSegmentPayloadSchema,
  });
```

Este é o principal ponto de compartilhamento com static render.

---

## 8. Audio segment

```ts
export const AudioSegmentPayloadSchema = z
  .object({
    asset_ref: RefSchema,

    gain: z.number().nonnegative().default(1),

    source_in_frame: FrameSchema.optional(),
    source_out_frame: FrameSchema.optional(),

    fade_in_frames: FrameSchema.optional(),
    fade_out_frames: FrameSchema.optional(),
  })
  .strict();

export const AudioSegmentSchema =
  TimelineSegmentBaseSchema.extend({
    kind: z.literal("audio"),
    payload: AudioSegmentPayloadSchema,
  });
```

Mastering/loudness final continua fora da Timeline V0.

---

## 9. Text segment

Text segment é útil para overlays simples que não justificam um template completo.

```ts
export const TextSegmentPayloadSchema = z
  .object({
    text: z.string().min(1),

    role: z.enum([
      "title",
      "subtitle",
      "label",
      "lower_third",
      "source",
    ]),

    motion: MotionSpecSchema.optional(),
  })
  .strict();

export const TextSegmentSchema =
  TimelineSegmentBaseSchema.extend({
    kind: z.literal("text"),
    payload: TextSegmentPayloadSchema,
  });
```

A aparência concreta do role ainda vem de tokens/template de sistema.

Se isso crescer demais, deve virar template em vez de acumular propriedades.

---

## 10. Caption segment

```ts
export const CaptionSegmentPayloadSchema = z
  .object({
    text: z.string().min(1),
    speaker_ref: RefSchema.optional(),
  })
  .strict();

export const CaptionSegmentSchema =
  TimelineSegmentBaseSchema.extend({
    kind: z.literal("caption"),
    payload: CaptionSegmentPayloadSchema,
  });
```

No V0, captions também podem continuar como artifact externo.

Portanto este segment é permitido, mas não obrigatório.

---

## 11. Segment union

```ts
export const TimelineSegmentSchema =
  z.discriminatedUnion("kind", [
    MediaSegmentSchema,
    TemplateSegmentSchema,
    AudioSegmentSchema,
    TextSegmentSchema,
    CaptionSegmentSchema,
  ]);
```

---

## 12. Scene type versus segment kind

Não chamar `kind` de “tipo de cena”.

Eles representam coisas diferentes.

### Scene Plan

Pode ter no futuro algo como:

```text
visual_mode:
  documentary_photo
  talking_head
  b_roll
  quote
  diagram
  archival
  generated_visual
```

Isso descreve intenção.

### Timeline Segment

Tem:

```text
media
template
audio
text
caption
```

Isso descreve uma decisão concreta de montagem.

Uma Scene Plan pode produzir vários Timeline Segments.

---

## 13. Captions artifact binding

```ts
export const CaptionsBindingSchema = z
  .object({
    artifact_ref: RefSchema,
    mode: z.enum([
      "burned_in",
      "sidecar",
      "none",
    ]),
  })
  .strict();
```

---

## 14. Render intent

```ts
export const TimelineRenderIntentSchema = z
  .object({
    purpose: z.enum([
      "preview",
      "rough_cut",
      "final",
    ]),

    container: VideoContainerSchema.optional(),

    audio: z.boolean(),

    captions: z
      .enum(["burned_in", "sidecar", "none"])
      .optional(),
  })
  .strict();
```

Não contém renderer.

---

## 15. TimelineManifestSchema

```ts
export const TimelineManifestSchema = z
  .object({
    schema_version: z.literal("timeline.v0"),
    manifest_id: RefSchema,

    context: z
      .object({
        project_ref: RefSchema,
        production_ref: RefSchema,
        video_work_ref: RefSchema,
      })
      .strict(),

    specification: TimelineSpecificationSchema,

    identity: IdentitySnapshotRefSchema,

    tracks: z.array(TimelineTrackSchema).min(1),

    segments: z.array(TimelineSegmentSchema),

    assets: z.record(
      z.string().trim().min(1),
      AssetRefSchema,
    ),

    captions: CaptionsBindingSchema.optional(),

    render_intent: TimelineRenderIntentSchema,
  })
  .strict();
```

---

## 16. Semantic validation pass

Zod estrutural não é suficiente.

Depois do parse:

```ts
validateTimelineSemantics(manifest)
```

deve verificar:

1. ids de tracks são únicos;
2. ids de segments são únicos;
3. `track_id` existe;
4. `start_frame + duration_frames` não ultrapassa a duração;
5. `source_out_frame > source_in_frame`;
6. `asset_ref` existe no asset map quando a referência é interna;
7. template ref resolve;
8. template content/assets passam schemas específicos;
9. motion preset é suportado pelo template;
10. transition duration é válida;
11. tracks e segment kinds são compatíveis;
12. identity snapshot resolve.

---

## 17. Compatibilidade track / segment

Direção inicial:

```text
video   → media, template
overlay → template, text
audio   → audio
caption → caption
```

Não precisa tornar isso rígido antes de confrontar a UI/engine real.

Mas qualquer flexibilização deve ser explícita.

---

## 18. Motion e zoom

Exemplo de domínio:

```json
{
  "motion": {
    "preset": "slow_push",
    "intensity": 0.35
  }
}
```

A Timeline não armazena:

```json
{
  "scaleStart": 1,
  "scaleEnd": 1.067,
  "easing": "..."
}
```

Esses números pertencem à implementação do preset no template/adapter.

Isso permite ajustar qualidade de motion sem migrar manifests históricos, desde que a versão do template permaneça fixada.

---

## 19. Relação com Remotion

Mapping conceitual:

```text
Timeline segment
→ <Sequence from=... durationInFrames=...>
→ resolved React component
```

Template segment:

```text
TemplateRef
→ Registry
→ component
→ motion preset
→ frame-based animation
```

O adapter pode usar primitives como `useCurrentFrame`, `interpolate` e `spring`.

A Timeline não conhece essas APIs.

---

## 20. Exemplo mínimo do spike

```json
{
  "schema_version": "timeline.v0",
  "manifest_id": "fixture:timeline:documentary-card:01",

  "context": {
    "project_ref": "fixture:project:comunidades-alternativas",
    "production_ref": "fixture:production:terra-una-reel",
    "video_work_ref": "fixture:video-work:terra-una-reel"
  },

  "specification": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "duration_frames": 180
  },

  "identity": {
    "snapshot_ref": "fixture:identity:comunidades-alternativas:v1",
    "token_profile": "default"
  },

  "tracks": [
    {
      "id": "visual-main",
      "kind": "video",
      "order": 0
    }
  ],

  "segments": [
    {
      "id": "segment-01",
      "track_id": "visual-main",
      "start_frame": 0,
      "duration_frames": 180,
      "kind": "template",
      "payload": {
        "template": {
          "id": "editorial.documentary-card",
          "version": "0.1.0",
          "variant": "cover",
          "scope": "system"
        },
        "content": {
          "eyebrow": "Comunidade em foco",
          "title": "Terra Una"
        },
        "assets": {
          "hero": {
            "type": "fixture",
            "ref": "fixture:asset:terra-una:documentary-photo-01"
          }
        },
        "motion": {
          "preset": "slow_push",
          "intensity": 0.35
        }
      }
    }
  ],

  "assets": {},

  "render_intent": {
    "purpose": "preview",
    "container": "mp4",
    "audio": false,
    "captions": "none"
  }
}
```

---

## 21. VideoDraft bridge

Não alterar VideoDraft no primeiro spike.

Depois:

```text
VideoDraft scenes
→ importer/normalizer
→ Scene Plan draft
→ Assembly
→ Timeline Manifest
```

Nunca:

```text
VideoDraft.scenes JSON
→ Remotion diretamente como contrato definitivo
```

---

## 22. Testes mínimos

```text
✓ timeline mínima válida
✓ track ids únicos
✓ segment ids únicos
✓ segmento aponta para track existente
✓ rejeitar duração zero
✓ rejeitar segmento fora da duração total
✓ validar template binding
✓ validar motion suportado
✓ validar asset refs
✓ rejeitar renderer-specific fields no root
✓ preservar Scene Plan separado de Timeline
```

---

## 23. Decisões V0

1. Frames são unidade canônica do spike.
2. Timeline usa union discriminada de segments.
3. Template segment é o elo com o sistema visual compartilhado.
4. Scene type não será confundido com segment kind.
5. Zoom/pan/fade entram como `MotionSpec`.
6. Números concretos de animação ficam no template/adapter.
7. Semantic validation ocorre após Zod estrutural.
8. Remotion permanece derivação.
