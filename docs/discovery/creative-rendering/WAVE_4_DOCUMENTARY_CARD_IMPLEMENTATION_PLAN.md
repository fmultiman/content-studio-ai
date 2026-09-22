# Wave 4A — Documentary Card implementation plan

**Template:** `editorial.documentary-card@0.1.0`
**Variants:** `cover`, `info`
**Status:** plan fechado antes da implementação visual

## 1. Leitura visual das referências

Pack A fornece a disciplina estrutural: hierarquia editorial previsível,
headline legível, ritmo entre lâminas, densidade controlada, fonte/source
claros e espaço negativo suficiente. A composição deve funcionar mesmo sem
decoração.

Pack B adiciona a linguagem material: campo de papel, planos rasgados,
fragmentos arquivais, fita/pin, fotografias/documentos levemente inclinados,
botânica, rabiscos e annotations periféricas. A assimetria é deliberada,
mas a leitura continua ancorada em uma grade invisível.

Regra de síntese: estrutura editorial do Pack A + materialidade organic-collage
do Pack B. Organicidade será produzida por planos fixos e determinísticos, não
por aleatoriedade nem por pixel-copy das imagens.

## 2. Conteúdo, Identity, template e decoração

| Classe | Responsabilidade | Exemplos V0 |
| --- | --- | --- |
| Content | dados resolvidos do manifest | `title`, `subtitle`, `body_blocks`, `fact_cards`, `source_line` |
| Identity | tokens compilados do Project | famílias/pesos display/body, cores, safe area, logo/mark |
| Template/layout | regras versionadas da family/variant | zonas, escala tipográfica, limites, crop, artifact plan |
| Decoration | primitives locais subordinadas | papel, tape/pin, botanical, linework, grain, annotation |
| Evidence | asset documental com provenance | hero cover; nesta Wave recebido como asset já resolvido |

O core não terá texto, logo, paleta ou branch do Portal hardcoded. Decoration
sintética nunca será apresentada como evidence.

## 3. Variants

### Cover

- Hero/evidence obrigatório e dominante, com `cover`/focal point conforme
  `ResolvedAsset`.
- Headline forte em stacked-paper plane; eyebrow, subtitle e source abaixo da
  hierarquia do título.
- `detail_note` em cartão de papel opcional.
- Brand vem de `tokens.brand`, sem logo do fixture embutido no componente.
- Sequence marker usa `SequenceContext`; a aparência é tag/papel discreta.
- Plano determinístico `cover-collage-01`: hero à direita, headline paper,
  backing, detail note, brand inferior, 2–4 planes, 1–3 tape/pins, 0–2
  annotations.

### Info

- Hero não é necessário; o layout deve funcionar com `assets` vazio.
- Headline e body ficam na zona primária; 1–2 fact cards formam o segundo
  foco, sem virar tabela ou dashboard.
- `intro`, `source_line` e `annotation` são auxiliares; annotation jamais
  contém informação essencial.
- Plano determinístico `info-collage-01`: headline paper, body à esquerda,
  cards empilhados à direita, decoração nas bordas e brand discreto.
- A ausência de supporting illustration não altera a legibilidade.

## 4. Primitives locais do spike

Não será criada a Visual Primitive Library nem o Harness. A implementação usa
somente fixtures SVG/CSS inline, com nomes semânticos e responsabilidades
limitadas:

- `paper-plane` / `torn-paper` via backgrounds e clip-path determinísticos;
- `tape`/`pin` como formas simples;
- `botanical` e `network-line` como SVG ornamental;
- `scribble`/`annotation` como traço de baixa ênfase;
- `grain` por textura CSS sutil;
- `hero-frame`/`fact-card` como wrappers de artifact.

Textos reais permanecem DOM/React text. O hero é o único asset documental
obrigatório da cover; os demais elementos são decoration.

## 5. Layers e ordem relativa

```text
z00 surface (dark cover / light info)
z05 texture/grain
z10 ambient botanical/network
z15 background paper planes
z20 headline paper / content backing
z25 content text and body
z30 hero backing + hero evidence (cover)
z35 fact-card backings (info)
z40 fact cards / detail note
z45 tape/pin overlaps
z50 secondary annotations
z60 brand + sequence marker
z65 restrained foreground fragments
```

Blocos principais de leitura não serão rotacionados. Hero, fact cards e
fragmentos podem variar aproximadamente entre `-4deg` e `+4deg`, sempre por
artifact plan fixo.

## 6. Spacing, safe areas e canvases

O componente recebe `canvas` e calcula um layout específico, nunca escala
cegamente o 4:5 para 9:16.

- `1080x1350`: safe area aproximada 72px horizontal, 72px superior e 84px
  inferior; title até 3 linhas; cover hero no lado direito; info com body e
  cards em colunas assimétricas.
- `1080x1920`: safe area aproximada 72px horizontal, 96px superior e 120px
  inferior; title até 4 linhas; maior respiro vertical e hero mais alto, sem
  deformar o DNA do 4:5.
- Safe areas vêm de `tokens.spacing.safe_area` quando disponíveis; os valores
  acima são defaults do template, não campos de manifest.
- Espaço negativo obrigatório: decoration nunca preencherá toda a tela nem
  encobrirá texto essencial.

## 7. Typography e dark/light

O componente usa `tokens.typography.display` para eyebrow/title e
`tokens.typography.body` para subtitle/body/source/facts. Family e weight vêm
da Identity; sizes, line-height, max-lines e overflow são decisões da
variant.

- Cover dark: background/foreground/accent dos tokens, overlay inferior sutil
  para preservar contraste do hero e papel claro para headline.
- Info light: background claro e foreground escuro, paper planes verdes/kraft
  derivados da paleta, cards com contraste suficiente.
- Se a family não estiver disponível no runtime desta Wave, o CSS usará a
  family string resolvida com fallback controlado; nenhum provider externo é
  buscado pela variant.

## 8. Motion compatível

`mode: still` ignora frame e motion e renderiza o estado final determinístico.

`mode: video` aceita `frame`, `durationInFrames` e `motion` sem mudar o
contrato de content:

- `none`: estado final;
- `fade`: entrada discreta de conteúdo/brand;
- `slow_push`: zoom sutil no hero respeitando focal point, com clamp e sem pan
  aleatório.

Timing interno de referência para 180 frames/30fps: hero contínuo; eyebrow
8–24; title 12–36; subtitle/body 20–44; source 28–52; detail/facts 36–60;
brand 44–68. Decoration permanece quase estática.

## 9. Entrada e integração

`DocumentaryCard` receberá dados já resolvidos, equivalentes a:

```ts
{
  variant,
  content,
  assets,
  tokens,
  canvas,
  mode,
  motion?,
  sequence?
}
```

Não receberá Project/Production, manifest cru, Supabase, S3 ou handle de
banco. O Registry continuará neutro; o `component_key` será ligado ao
componente apenas na borda visual. A árvore será reutilizável pelo preview e
por um futuro adapter de still/video.

## 10. Preview e evidências

A rota isolada `/dev/creative-preview` será atualizada para selecionar
tecnicamente cover/info, canvas 4:5/9:16 e Identity A/B, sem persistência ou
Supabase. Serão geradas evidências locais ignoradas pelo Git para:

- cover 1080x1350;
- info 1080x1350;
- cover 1080x1920;
- pelo menos uma peça com Identity B.

## 11. Fora desta Wave

- Visual Primitive Library/Harness reais, upload ou LibraryFile/S3;
- Project Identity persistida, Font Catalog/Picker ou provider de fontes;
- editor drag/resize, authoring state persistido ou APIs de render;
- integração VideoDraft/ImageDraft e alterações em `/videos`/`/imagens`;
- novos templates, Pack B completo ou Wave 5.
