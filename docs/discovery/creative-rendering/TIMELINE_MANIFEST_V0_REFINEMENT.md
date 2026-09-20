# Timeline Manifest V0 — Refinement for Template-Based Rendering


**Status:** refinement of an existing decided concept
**Produto:** Content Agent Studio
**Escopo:** preservar a Timeline Manifest neutra definida no workflow de vídeo e torná-la compatível com o novo Template Registry


---


## 1. Autoridade anterior


A arquitetura de vídeo já decidiu:


~~~
VISUAL_PLANNING
→ Scene Plan
→ MEDIA_PREPARATION
→ Asset Manifest
→ ASSEMBLY
→ Timeline Manifest
→ renderer/editor adapters
~~~


Também decidiu:


- Scene Plan não é timeline;
- Edit Decisions não são Scene Plan;
- Timeline Manifest é neutra;
- Remotion, FFmpeg e formatos de editores são adapters;
- falha de adapter não invalida a Timeline Manifest.


Este documento não substitui essas decisões.


Ele refina o contrato para permitir reutilização de templates e componentes visuais compartilhados com peças estáticas.


## 2. Nova relação


~~~
Scene Plan
    ↓
Assembly
    ↓
Timeline Manifest
    ├── media segments
    ├── audio segments
    ├── captions
    └── template bindings
              ↓
        Template Registry
              ↓
        Renderer Adapter
              ↓
        preview / render
~~~


O Template Registry não vira fonte de verdade da montagem.


A Timeline Manifest continua definindo tempo, tracks, segmentos e relações concretas de edição.


## 3. Responsabilidades separadas


Scene Plan responde: o que deve acontecer visual e narrativamente?


Timeline Manifest responde: o que acontece exatamente, em qual track e em qual intervalo?


Template responde: como determinado bloco visual é desenhado?


Renderer responde: como transformar essa estrutura em mídia executável?


Estas quatro responsabilidades não devem colapsar.


## 4. Estrutura conceitual refinada


~~~
{
  "schema_version": "timeline.v0",
  "manifest_id": "...",


  "context": {
    "project_ref": "...",
    "production_ref": "...",
    "video_work_ref": "..."
  },


  "specification": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "duration_frames": 1800
  },


  "identity": {
    "snapshot_ref": "...",
    "token_profile": "default"
  },


  "tracks": [],
  "segments": [],
  "captions": null,
  "assets": {},
  "render_intent": {}
}
~~~


## 5. Tempo V0


Direção recomendada para o spike: usar frames como unidade canônica.


Razões:


- renderer de vídeo trabalha naturalmente com frames;
- evita drift de ponto flutuante;
- simplifica preview reproduzível;
- permite derivar segundos a partir de fps.


Campos:


~~~
start_frame
duration_frames
source_in_frame?
source_out_frame?
~~~


Outros stages podem aceitar segundos, mas Assembly normaliza para frames.


Esta é recomendação de implementação, não uma decisão histórica anterior.


## 6. Tracks


Categorias iniciais:


~~~
video
audio
overlay
caption
~~~


Proposta:


~~~
type TimelineTrack = {
  id: string;
  kind: "video" | "audio" | "overlay" | "caption";
  order: number;
  muted?: boolean;
  locked?: boolean;
};
~~~


Locked é metadata de edição/UI, não obrigação para renderer.


## 7. Segment


Base:


~~~
type TimelineSegment = {
  id: string;
  track_id: string;
  scene_plan_ref?: string;


  start_frame: number;
  duration_frames: number;


  kind:
    | "media"
    | "template"
    | "text"
    | "audio"
    | "caption";


  payload: unknown;
};
~~~


Payload deve ser discriminado e validado por kind.


## 8. Media segment


Representa asset temporal concreto.


~~~
{
  "kind": "media",
  "payload": {
    "asset_ref": "asset_01",
    "source_in_frame": 120,
    "source_out_frame": 360,
    "fit": "cover",
    "transform": {
      "scale": 1,
      "position": {
        "x": 0.5,
        "y": 0.5
      }
    }
  }
}
~~~


Isto é Edit Decision, não Scene Plan.


## 9. Template segment


Nova integração principal deste refinamento.


~~~
{
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
        "type": "library_file",
        "ref": "asset_01"
      }
    },


    "motion": {
      "preset": "slow_push",
      "intensity": 0.35
    }
  }
}
~~~


A Timeline conhece motion semântico limitado.


Ela não conhece APIs do Remotion.


## 10. Motion V0


Evitar animation AST genérica no primeiro ciclo.


Usar presets semanticamente definidos pelo sistema/template.


Exemplos:


~~~
none
fade
slow_push
slow_pan
rise
reveal
crossfade
~~~


Contrato sugerido:


~~~
type MotionSpec = {
  preset: string;
  intensity?: number;
  direction?: "up" | "down" | "left" | "right";
};
~~~


Cada template declara quais presets suporta.


O adapter traduz preset para implementação concreta.


## 11. Reutilização com StaticRenderManifest


### Static


~~~
StaticRenderManifest
→ template
→ content
→ assets
→ still
~~~


### Video


~~~
TimelineSegment kind=template
→ template
→ content
→ assets
→ motion
→ frames
~~~


A interseção compartilhada é:


~~~
TemplateRef
ContentBindings
AssetBindings
IdentitySnapshot
VisualTokens
~~~


Não é necessário forçar StaticRenderManifest a possuir timeline.


## 12. Identity na timeline


Uma Timeline Manifest deve fixar o snapshot visual predominante.


~~~
identity.snapshot_ref
~~~


Exceções por segmento ficam fora do V0.


Objetivo:


- reprodutibilidade;
- consistência;
- menos complexidade;
- evitar mistura silenciosa de identidades.


## 13. Assets


A Timeline não repete blobs completos de metadata em cada segmento.


Preferir mapa de assets:


~~~
assets: {
  "asset_01": {
    ...
  }
}
~~~


e segmentos usam asset_ref.


Assets podem apontar para LibraryFile, ProductionArtifact, prepared media, external reference validada ou fixture.


O adapter resolve referências para arquivos utilizáveis.


## 14. Áudio


Áudio permanece conceito temporal de primeira classe.


~~~
{
  "kind": "audio",
  "payload": {
    "asset_ref": "voice_01",
    "gain": 1,
    "fade_in_frames": 0,
    "fade_out_frames": 12
  }
}
~~~


Loudness final e mastering continuam pertencendo ao Finalization.


## 15. Captions


Captions podem ser representadas como artifact separado e ligadas à Timeline.


Possibilidade V0:


~~~
captions: {
  "artifact_ref": "captions_v2",
  "mode": "burned_in"
}
~~~


Uma track explícita pode ser usada quando a UI de Assembly precisar editar captions por segmento.


A decisão final depende da implementação atual.


## 16. Transições


Transição é relação temporal entre segmentos.


V0 pode manter preset simples:


~~~
transition_out: {
  "preset": "crossfade",
  "duration_frames": 12
}
~~~


Evitar efeitos específicos de engine.


## 17. Render intent


Indica objetivo técnico, não renderer.


~~~
{
  "purpose": "rough_cut",
  "container": "mp4",
  "audio": true,
  "captions": "burned_in"
}
~~~


Não colocar configurações de worker, Lambda, Chromium ou comandos FFmpeg na Timeline.


Esses valores entram em RenderExecution ou adapter config.


## 18. Relação com VideoDraft atual


VideoDraft existente deve ser preservado.


Campos conhecidos:


~~~
order
description
prompt
image_url
duration
movement
~~~


Eles podem alimentar Scene Plan ou um importer.


Não migrar automaticamente video_drafts.scenes para Timeline Manifest sem validação.


Bridge futura possível:


~~~
VideoDraft
→ normalize legacy scenes
→ draft Scene Plan
→ human/AI review
→ Assembly
→ Timeline Manifest
~~~


## 19. Timeline Manifest versus Remotion Composition


A Remotion Composition é derivada.


~~~
Timeline Manifest
      ↓
Remotion Adapter
      ↓
composition props
      ↓
React tree
      ↓
render
~~~


Nunca usar Composition TSX como única representação da montagem.


Isso preserva troca de renderer, export para editor, auditoria, testes de domínio e reprodutibilidade.


## 20. TypeScript conceitual


~~~
type TimelineManifest = {
  schema_version: "timeline.v0";
  manifest_id: string;


  context: {
    project_ref: string;
    production_ref: string;
    video_work_ref: string;
  };


  specification: {
    width: number;
    height: number;
    fps: number;
    duration_frames: number;
  };


  identity: {
    snapshot_ref: string;
    token_profile?: string;
  };


  tracks: TimelineTrack[];
  segments: TimelineSegment[];


  assets: Record<string, AssetRef>;


  captions?: {
    artifact_ref: string;
    mode: "burned_in" | "sidecar" | "none";
  };


  render_intent: {
    purpose: "preview" | "rough_cut" | "final";
    container?: "mp4" | "webm" | "mov";
    audio: boolean;
  };
};
~~~


Contrato conceitual. Deve ser confrontado com o repositório antes da implementação.


## 21. Validation gates


Antes de render:


- fps válido;
- duração total válida;
- tracks existentes;
- segmentos apontam para tracks válidas;
- segmentos não possuem duração negativa;
- assets referenciados existem;
- template id/version resolve no Registry;
- content passa pelo schema do template;
- motion preset é suportado;
- nenhum asset obrigatório está missing;
- identity snapshot resolve;
- render intent é compatível.


Warnings podem existir sem invalidar preview.


Final render deve ter gate mais estrito.


## 22. Versionamento


Timeline Manifest deve ser artifact versionado.


~~~
timeline_v1
→ rough_cut_v1
→ review
→ changes requested
→ timeline_v2
→ rough_cut_v2
~~~


Não sobrescrever silenciosamente uma timeline que já originou artifact revisado ou aprovado.


## 23. Primeiro spike


A primeira Timeline de teste não precisa implementar vídeo completo.


Basta:


- 1 track visual;
- 1 track de áudio opcional;
- 1 template segment;
- 1 asset hero;
- 1 motion preset;
- 5 a 6 segundos;
- 1080x1920;
- preview;
- render.


Ela deve reutilizar o mesmo template do fixture estático.


## 24. Decisões deste refinamento


1. Timeline Manifest existente é preservada.
2. Template Registry entra como dependência de composição, não como domínio.
3. Segmento template permite compartilhar design com peças estáticas.
4. Remotion continua derivado por adapter.
5. StaticRenderManifest não ganha timeline artificial.
6. Motion V0 começa por presets, não animation AST universal.
7. Identidade visual predominante é fixada no nível da Timeline.
8. Primeiro spike pode usar frames como unidade canônica.
9. VideoDraft legado não é promovido diretamente para timeline.