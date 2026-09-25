# CREATIVE EDITOR VIDEO — STATIC PARITY AND DOCK POLISH V1

Status: implemented (Phase 0 audit was written before any code change).
Starting SHA: `5f924bad8008acff7e36867caa8b1cdcb59791e3` (CREATIVE_EDITOR_VIDEO_FOUNDATION_V1_COMPLETE).
Local HEAD = `origin/main` = remote `main` = Vercel Production (GitHub deployment `6656172073`, success) = `5f924ba`.

Goal: STATIC CREATIVE EDITOR + TEMPORAL CAPABILITIES = VIDEO CREATIVE EDITOR. The current executable Static editor (`app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx`) is the UX authority for shared behavior.

## Phase 0 — factual Static ↔ Video parity audit (code at `5f924ba`)

**Terminology.** "Dockview" in this repo is the `dockview-react` library, already used — only as window infrastructure — by the SHARED `components/creative/editor/creative-workbench.tsx` (one Canvas panel + one floating Inspector group; docking/DnD disabled). Video already renders through that same component. No library is added, restored or replaced.

**Classes.** 1 = SHARED SEMANTICS (converge/reuse) · 2 = VIDEO-SPECIFIC · 3 = STATIC-SPECIFIC · 4 = ACCIDENTAL DIVERGENCE (fix now) · 5 = DEFERRED TEMPORAL MODEL QUESTION.

| Concern | Static (current code) | Video (current code) | Class | Action |
|---|---|---|---|---|
| Top header | Back · "Creative Editor" · `Static · <channel format> · Slide N` · Contexto dropdown · render status · save status · Salvar · Baixar ZIP · Gerar PNG | Back · "Creative Editor" · `Video · Reel 9:16 · Cena N` · Contexto · render status/Ver vídeo · **Voltar ao salvo + Auto-save** · save status · Salvar · Renderizar vídeo | 1 / 4 | Voltar ao salvo + Auto-save live in Static's bottom toolbar ("Estado do slide") → move to Video's bottom toolbar ("Estado do vídeo"). ZIP/PNG = 3; Ver vídeo/Renderizar = 2. |
| Workbench | `CreativeWorkbench` fills header→bottom; Canvas panel holds viewport + bottom toolbar | same `CreativeWorkbench`, but CENAS/TIMELINE is a **separate page row below it** | 4 | Move the temporal region INTO the workbench canvas panel as a bottom authoring dock. |
| Preview region | Canvas viewport, `flex-1`, centered by `canvasOrigin` | Player viewport `flex-1 overflow-auto`, flex-centered | 4 | Same viewport model (origin + pan). |
| Viewport zoom | − / select (`Fit · N%`, 25–150%) / + ; `ZOOM_LEVELS` + `stepZoom` **local to the Static page** | select only (Fit, 25/33/50%), no −/+ | 4 | Extract levels + step to `lib/creative/authoring/viewport.ts`; extract the controls to a shared component used by both. |
| Fit / Center / 100% | "…" menu: Ajustar à tela / Centralizar / 100% centralizado (`applyViewportAction`) | Fit only | 4 | Reuse the same actions/menu. |
| Pan / hand | pointer drag on viewport (grab cursor), wheel pans (floating only), `clampPan` keeps 80px visible | none; Player `clickToPlay` consumes clicks | 4 | Reuse the same pan hook. Player gets `pointer-events:none` (like the Canvas) and `clickToPlay` off; playback stays on transport/Space. |
| Viewport vs authored | camera never dirty | zoom never dirty | 1 | Keep; test. |
| Floating Inspector (move/resize/bounds/min/close) | shared `CreativeWorkbench` (`initialInspectorPaletteBox` ≤ 80% of workbench height, `constrainPaletteBox`, minimize = titlebar dblclick/[−], close [×]) | same component | 1 | Already shared. |
| Inspector vertical bounds | workbench = full editor height | workbench shrunk by the permanent CENAS/TIMELINE row | 4 | Fixed by the dock-inside-workbench move. |
| Inspector reopen launcher | `PanelRight` button in the bottom toolbar zoom group | same, in transport bar | 1 | Keep in the shared zoom-controls group. |
| Inspector UI state persistence | not persisted (session memory only) | same | 1 | Keep. |
| Inspector tabs | Template · Conteúdo · Assets · Estilo · Elementos | Template · Conteúdo · Assets · Estilo · Motion (no Elementos) | 4 (+2) | Tabs → Template · Conteúdo · Assets · Estilo · Elementos · Motion. Motion is a Video extension. |
| Template tab | selector + Estrutura/Aparência buttons + description + `TemplateFamilyAnatomy` + `TemplateAnatomy` | free text "Documentary Card · Capa" + video name + metadata | 4 / 5 | Reuse `TemplateFamilyAnatomy` + `TemplateAnatomy` for the ACTUAL render template (`DEFAULT_TEMPLATE_ID`, layout `cover`), read-only. Template/layout selection per Scene is not representable in VideoScene → 5. |
| Conteúdo | per-layout fields (title, text…) | Scene description (brief) + prompt assistance | 2 / 5 | The adapter's title is a placeholder `Cena N`. Scene text content is a temporal-model question → 5. |
| Assets | `AssetSlotCard` per slot: thumbnail, slot label, origin badge (Template/Projeto/Imagem gerada), name, "Usado por", Trocar, Usar padrão | bespoke card: thumbnail, name, "Escolher/Trocar da Biblioteca", "Usar padrão do Template" | 4 | Reuse `AssetSlotCard` for the Scene's hero slot. The resource is derived from `VideoScene.library_file_id` (else the adapter's fixture hero), same origin labels. Other material slots are not VideoScene state → 5. |
| Estilo | `StyleSourcePanel` | same (unitLabel "cena") | 1 | Keep. |
| Elementos | `ElementLayers`: stack order, visibility (eye), per-element tuning/transforms, persisted per slide | tab absent | 4 / 5 | The video render paints the DEFAULT stack of `cover` (`resolveElementStack(undefined,'cover')`, no tuning, no hidden set). Expose that stack read-only via `ElementLayers` (new `readOnly` mode). Per-Scene element editing is not representable in VideoScene → 5 (documented gap). No tracks. |
| Motion | n/a | Motion tab (movement → semantic preset) | 2 | Keep, after Elementos. |
| Reset/default | Voltar ao salvo; Restaurar padrão do Template (per slide); Ordem padrão; Usar padrão | Voltar ao salvo; Usar padrão do Template (asset) | 1 / 3 | Voltar ao salvo + Usar padrão shared. "Restaurar padrão do Template" / "Ordem padrão" have no VideoScene equivalent → 3. |
| Responsive fallback | `< 1024px` → `StackedWorkbench` (Canvas, then Inspector) | same + page-level lower row | 1 / 4 | Keep `StackedWorkbench`; the dock goes inside the canvas slot; small screens get a compact dock. |
| Bottom toolbar | slide nav · zoom group (+launcher) · Estado do slide | transport + preview-zoom select (+launcher) | 1 / 2 | Same geography: transport = 2 (replaces slide nav); zoom group = shared component; "Estado do vídeo" group = shared semantics. |
| Collection navigation | slide pager (numbers, add, remove) in the bottom toolbar | CENAS cards + TIMELINE in a separate row | 2 | Scenes have duration/motion/temporal ranges → CENAS/TIMELINE dock, not a pager. |

**Deferred (class 5), recorded, not solved here:** per-Scene template/layout/appearance, per-Scene text content, per-Scene element stack/visibility/transforms, and material-slot overrides. Also whether any Element becomes temporal (Element ≠ Track stays OPEN in both directions).

## Implementation record

### Shared implementations (reused, not imitated)

| Concern | Shared piece | Used by |
|---|---|---|
| Workbench + floating Inspector (move, resize, bounds, minimize, close, reopen) | `components/creative/editor/creative-workbench.tsx` (unchanged) | Static, Video |
| Preview viewport camera: Fit (12px margin), zoom, pan (drag + wheel on desktop), clamp, Ajustar / Centralizar / 100% | **new** `components/creative/editor/use-preview-viewport.ts`, extracted verbatim from the Static page; the pure math stays in `lib/creative/authoring/viewport.ts` (+ `VIEWPORT_ZOOM_LEVELS`, `stepViewportZoom`, moved out of the Static page) | Static (refactored to use it), Video |
| Zoom group − / Fit·N% / + / "…" (Ajustar à tela, Centralizar, 100% centralizado) + Inspector launcher slot | **new** `components/creative/editor/viewport-zoom-controls.tsx` (same markup and testids the Static toolbar had) | Static, Video |
| Asset slot card + resolver (thumbnail, slot, origin Template / Projeto / Imagem gerada, Usado por, Trocar, Usar padrão) | `AssetSlotCard` + `resolveSlotResource` (unchanged) | Static, Video (Scene hero) |
| Template anatomy | `TemplateFamilyAnatomy` + `TemplateAnatomy` (unchanged) | Static, Video |
| Camadas | `ElementLayers` + a new opt-in `readOnly` / `note` mode; Static behavior unchanged when absent | Static (editable), Video (read-only) |
| Estilo | `StyleSourcePanel` | Static, Video |
| Library picker | `ProjectLibraryAssetPicker` | Static, Video |

### Accidental divergences fixed

- CENAS/TIMELINE moved from a permanent page row into the workbench preview panel, as a **bottom authoring dock**.
- The Player viewport now uses the Static camera: pan/hand, −/+, the full zoom levels and Ajustar/Centralizar/100%. The Player no longer consumes clicks (`clickToPlay={false}`, `pointer-events:none` like the Canvas card); playback stays on the transport and Space.
- **Voltar ao salvo** and **Auto-save** moved from the header to the bottom toolbar ("Estado do vídeo"), where Static keeps them.
- The Inspector gained **Elementos**.
- Template and Assets tabs now reuse the Static components.
- The Timeline fills the dock height. The px/s readout moved to the zoom button tooltip; the permanent instruction text became a help tooltip.
- Narrow (stacked) layout: the transport bar wraps instead of hiding controls behind horizontal scroll.

### Intentional divergences (semantic reasons)

- **Transport (play / frame step / timecode)** in the bottom toolbar instead of the slide pager: time.
- **CENAS/TIMELINE dock** instead of the slide pager: Scenes carry duration, motion and temporal ranges.
- **Motion tab** (after Elementos): Video-only semantic movement.
- **Scene context header** in the Inspector (duration, move, remove): contextual timing, not a Timing tab.
- **Six tabs** show compact labels at the default 360px palette width, through a new container-query rule scoped to `[data-inspector-tabs='6']`; Static's five-tab rule is unchanged.
- **Template / Estrutura / Aparência are read-only** in Video: every Scene renders `editorial-documentary-collage-v1` / `cover` / Dark, since the adapter passes no template, layout or appearance. Selecting them per Scene is not representable in VideoScene (class 5).
- **No "Restaurar padrão do Template" / "Ordem padrão"** in Video: no per-Scene template state exists to restore.

### Bottom authoring dock

- `components/creative/video/authoring-dock.tsx` renders the view and the size controls; `lib/creative/video-editor/bottom-dock.ts` holds the pure geometry.
- **Modes:**
  - collapsed: the 36px bar only (CENAS | TIMELINE, summary, ⌄/⌃, expand);
  - normal: about 28% of the panel, 156–236px;
  - expanded: about 55%, capped so the Player area keeps ≥ 220px.
- **Handle:** drag resizes, dragging low collapses, double-click toggles, and ↑/↓/Enter work from the keyboard. Selecting a tab while collapsed opens the dock.
- **UI state only:** mode and height are React state, re-derived from the measured panel. They are not persisted anywhere, including localStorage, and never enter VideoDraft, TimelineManifest or render (tested).
- **Where it lives:** inside the workbench's preview panel, so the floating Inspector's host is the whole workbench. The Inspector floats over the Player and dock and can extend to the workbench bottom.

### Elementos — decision and explicit deferral

- **What is shown:** the tab shows the ACTUAL element stack the video renders and the final MP4 paints: the default Template's `cover` layout with its default order, through `resolveElementStack(undefined, 'cover')`, which is exactly what DocumentaryCard does in video mode. The list is read-only and backed by the registry, never a copy.
- **Gap:** per-Scene element order, visibility, tuning and transforms are not representable in VideoScene, so no persistence was fabricated.
- **Element vs Track:** deliberately UNDECIDED in both directions. Timeline Lite still exposes only the primary Scene structure. No per-element tracks, spans, keyframes or rows.

### Assets — convergence

- A Scene's primary image is the Static `hero` slot: `VideoScene.library_file_id` is the hero override, via `sceneHeroSlotState`. Static's `resolveSlotResource` and `AssetSlotCard` render it.
- The Template default is the same file the render adapter uses (`documentary-card-hero-01.webp`, tested).
- **Trocar** opens the same picker. **Usar padrão** clears `library_file_id`.
- Material slots (paper, tape, …) are not VideoScene state → class 5, documented.

### Persistence boundaries

- **Authored truth:** VideoDraft + VideoScene[], saved through the unchanged PATCH.
- **Never persisted:** dock mode/height, Inspector geometry, Player zoom/pan, Timeline zoom/scroll, playhead and selection.
- After reload, the dock returns to normal and the zoom to Fit (validated).
- No new Timeline authority.

### Timeline non-expansion

Unchanged semantics: primary Scenes, contiguous, reorder, right-edge duration, snap, temporal zoom, scroll. No source in/out, ripple/roll/slip/slide, gaps, B-roll/audio/caption tracks, waveform, keyframes or nested timelines. **Player viewport zoom/pan ≠ Timeline temporal zoom/scroll**: separate state, separate components.

### Render regression

- Final render path, worker and adapter are untouched. `TimelineComposition` is unchanged in this mission.
- Local real render from the editor (production DB + VPS): execution `e80633c6-2306-41f6-aefc-cf7847d20b35` queued → completed.
  - Output: 1080×1920 MP4, 2.6 MB, 9.216s, matching the authored 3 + 2.17 + 4s.
  - The Output Player loaded it (readyState 4); the Live Player has no `<video>`; `/api/gallery/video-outputs` lists it.

### Validation (local `next dev` against production Supabase/VPS, draft `7b12b65d…`, 3 Scenes with real Library assets)

**1440×900, window rendering at ~62 fps**
- **Dock**

  | State | Dock | Player (Fit) |
  |---|---|---|
  | normal | 221px | 280×498 (26%) |
  | collapsed | 36px | 384×683 (36%) |
  | expanded | 433px | 160×286 (15%) |

  - Handle drag: 371px, then collapsed at 36px; double-click returned it to normal.
- **Inspector**
  - Default 360×540 inside a 790px workbench.
  - Stretched to the workbench bottom (887/888), over the dock.
  - Minimize → 38px, restore, close → launcher, reopen at the remembered box.
- **Viewport**
  - − / + (26→40→33%), drag pan to 180,90 (cursor grabbing), Centralizar → 0,0, Ajustar → Fit.
  - Save status stayed "Salvo" throughout (viewport never dirties).
- **Timeline**
  - Playback advanced in real time; playhead == Player frame in every sample; pause stable.
  - Temporal zoom 3.2 → 6.4 px/f; horizontal scroll.
  - Drag-reorder with the insertion indicator: ranges 0/83/148.
  - Right-edge trim at 88f snapped to the second: 90f.
  - Ruler scrub → 30 (Player == playhead).
  - TIMELINE block selection → header "Cena 2", Inspector "Cena 2 de 3", CENAS card pressed.
- **Inspector tabs**
  - Six tabs, with compact labels at 360px.
  - Template: Editorial Documentary Collage · Cover · Dark, with anatomy.
  - Elementos: 10 real layers, read-only, no grip.
  - Motion: the current value.
- **Assets:** Imagem gerada → Usar padrão (Template) → Trocar to `pack-a-005` (Projeto). The Player painted the new image at the Scene start.
- **Persistence:** Salvar, reload → CENAS 3s / 2.17s / 4s. DB durations 3 / 2.1667 / 4, motion static / pan_left / zoom_in, bindings `086cbeb9` / `4cd37593` / `da41299e`, 8 keys each.

**Responsive (Video)**
- 1440, 1366, 1280, 1200, 1100 and 1024 → floating layout, no horizontal page scroll, Inspector inside the workbench and not covering the Player, no header overlaps.
- 768 and 390 → stacked layout, no page overflow. The transport wraps with all controls visible (after the wrap fix). CENAS/TIMELINE stays available in a normal-height dock.

**Static regression (same local session)**
- Canvas Fit 53% centered, − / + (75 / 50%), pan (100,50), Centralizar → 0,0, Ajustar → Fit.
- Slide → 2. Elementos: 14 rows with grips, eyes and an open panel. Assets slot cards with origins. Inspector close / launcher / reopen. Save status unchanged.
- ZIP export `200 application/zip` (18.4 MB); Gerar PNG present.

**Automated**
- `pnpm test`: 89 files / 1137 tests.
- `pnpm typecheck`: OK. ESLint (changed sources): 0 problems. `pnpm build`: OK.

**Environment notes (not product defects)**
- The embedded test browser renders only while its window is on screen. When covered: 0 rAF/s, ResizeObserver and CSS animations stall, Fit falls back, and Radix exit animations never emit `animationend`. The automation dispatches `animationend` to unmount closed dialogs.
- The Static responsive re-check at 1024/390 ran while the window was not rendering and is inconclusive; it is repeated in the production smoke.

### Delivery and production smoke

- **Implementation commit:** `ac2a81b132507e92124e31678cf922f7a0927e91` ("feat: video creative editor static parity and bottom dock").
  - Local HEAD = `origin/main` = remote `main`.
  - Vercel Production deployment `6665861722` (vercel[bot]) = `success` for that SHA. The Vercel MCP has no access to this team, so the SHA is confirmed through GitHub deployment statuses.
- **Production smoke** (`https://content.multihuman.com.br`, authenticated, draft `7b12b65d…`, window rendering at 62 fps):
  - **Video structure:** dock inside the workbench; tabs Template/Conteúdo/Assets/Estilo/Elementos/Motion; "Estado do vídeo" group in the bottom toolbar, no longer in the header; shared zoom controls; Player `pointer-events:none`. The saved state loaded (3s / 2.17s / 4s, equal to the DB).
  - **Dock**

    | State | Dock | Player (Fit) |
    |---|---|---|
    | normal | 221px | 280×498 (26%) |
    | collapsed | 36px | 384×683 (36%) |
    | expanded | 433px | 160×286 (15%) |

    Identical to local.
  - **Playback:** advanced (0 → 37 in 1.5s); playhead == Player on every sample; pause stable at 39.
  - **Player viewport:** zoom 33%, pan 120,60, Centralizar → 0,0. Stayed "Salvo".
  - **Final render:** Renderizar vídeo → `a6e090c8-19a4-473f-abc1-9d5248ccfee0` completed, 1080×1920 MP4 of 2.6 MB. The output URL resolves; the Output Player loaded 9.216s (readyState 4); `/api/gallery/video-outputs` lists it.
  - **Static:** Canvas; Fit 53% → 75% → 50%; pan 60,30; next slide → Slide 2; Inspector close / launcher / reopen; "Salvo"; ZIP button present. Responsive: 1440 Fit 53% floating, 1024 Fit 42% floating, 390 Fit 29% stacked. The Canvas stays inside the viewport and there is no page overflow.
- No worker or runtime deployment.

### Known remaining gaps (not solved here)

- Per-Scene Template/layout/appearance, text content, element order/visibility/tuning, and material-slot overrides are not representable in VideoScene (class 5; next authoring-model decision).
- The Scene hero is the only authored asset slot in Video.
- **Element ≠ Track:** undecided. Gate B — main visual + B-roll + lower third + continuous audio — remains the next temporal-model mission, with its authority decision (see CREATIVE_EDITOR_VIDEO_FOUNDATION_V1 §14–15).
- The six-tab Inspector uses compact labels at the default palette width; full labels appear when the palette is widened.
- The Remotion license notice still logs in the console; `acknowledgeRemotionLicense` is the owner's decision.
