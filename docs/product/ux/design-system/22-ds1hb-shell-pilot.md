# DS-1H-B - Shell Pilot and Decision

## Status

- pilot implemented and validated in code
- desktop rail approved as the shell direction
- compact top utility bar approved as the global utility surface
- conventional mobile drawer approved as the mobile navigation contract
- transversal rollout deferred to DS-1H-C

## Objective

Validate, with reversible code, whether the Content Studio shell should move from the previous full sidebar pattern to a compact shell composition built from:

- top utility bar
- floating/collapsible desktop rail
- conventional mobile drawer

This round did not authorize:

- top navigation as the primary navigation model
- drag or docking
- internal redesign of pages
- transversal rollout

## Initial Architecture

Before the pilot:

- `app/(dashboard)/layout.tsx`
  - mounted the dashboard area and theme bootstrap
- page-level header call sites
  - still carried shell-era responsibilities mixed with local page chrome
- `components/layout/sidebar.tsx`
  - represented the previous shell navigation implementation
- `components/ui/sidebar.tsx`
  - already provided responsive sidebar infrastructure, mobile sheet integration, tooltip support, and desktop gap/container behavior
- `lib/sidebar-navigation.ts`
  - already contained the canonical navigation groups and active-route matching

## Final Architecture

The pilot was implemented through a thin Studio-specific shell adapter:

- `components/layout/studio-shell.tsx`
  - owns shell state and composition
  - centralizes `desktopPreference`, `effectiveMode`, `lastVisibleMode`, mobile drawer state, trigger contract, rail rendering, utility bar, and content offsets
- `lib/studio-shell-state.ts`
  - owns constants, types, persistence keys, and the preference/effective-mode helpers
- `components/ui/sidebar.tsx`
  - remains the shared primitive
  - received the minimal mobile `SheetContent` class forwarding needed so the Studio shell can style the drawer surface without forking the primitive
- `app/(dashboard)/layout.tsx`
  - integrates the shell with minimal layout coupling

Reversibility remained explicit:

- the shell logic is concentrated in the new adapter
- navigation still comes from `lib/sidebar-navigation.ts`
- no page internals were redesigned
- no second app shell was duplicated

## Top Utility Bar

Approved contract:

- full-width bar from `left: 0` to `right: 0`
- height: `3.125rem` (`50px`)
- compact visual presence
- left side:
  - global navigation trigger
  - product symbol
  - `Content Studio` label only on larger widths
- center:
  - reserved future slot for `Global Search / Command Palette`
- right side:
  - notifications
  - settings
  - avatar / account dropdown

The top utility bar is global shell chrome, not a relocated page header:

- page titles stay in the pages
- local actions stay in the pages
- `PageHeader` was not globalized

## Desktop Rail

### Expanded

- floating palette below the top utility bar
- labels visible
- groups visible
- moderate width with readable labels
- pushes content
- internal local control:
  - `Compactar navegação`

Measured shell geometry:

- effective content offset: `152px`
- rendered rail width observed in smoke:
  - Light/Dark: about `133px`
  - Studio Balanced: about `130px`

Constants:

- expanded width token: `9.5rem`

### Compact

- icon-only rail
- icons stay centered
- no group letters
- groups distinguished by spacing
- real tooltip support via the shared sidebar primitive
- local internal control:
  - `Expandir navegação`

Measured shell geometry:

- effective content offset: `52px`
- rendered rail width observed in smoke: about `50px`

Constants:

- compact width token: `3.25rem`

### Hidden

- no visible desktop rail
- no reserved content width
- restoration happens only through the global header trigger
- content uses the recovered width immediately

Measured shell geometry:

- content offset returns to `0`

## State Model

The pilot separates persisted preference from effective rendering:

- `desktopPreference`
  - `expanded | compact | hidden`
- `effectiveMode`
  - `expanded | compact | hidden | mobile-drawer`

Rules:

- mobile does not overwrite `desktopPreference`
- width constraints can temporarily force an effective compact mode without changing the persisted desktop choice
- invalid persisted values fall back safely
- local storage is read only on the client
- writes happen only after initialization

Storage:

- `studio-shell-desktop-preference`
- `studio-shell-last-visible-mode`

## lastVisibleMode

`lastVisibleMode` preserves the last non-hidden desktop rail mode:

- `expanded/compact -> hidden`
  - stores the previous visible mode
- `hidden -> restore`
  - returns to the stored visible mode

Validated behavior:

- `compact -> hidden -> restore`
  - returns to `compact`
- `expanded -> hidden -> restore`
  - returns to `expanded`

## Breakpoints

Final contract:

- `<= 768px`
  - `mobile-drawer`
- `769px - 1279px`
  - effective compact mode
- `>= 1280px`
  - desktop preference respected

Constants:

- mobile breakpoint: `768`
- wide breakpoint: `1280`

## Mobile Drawer

Approved final contract:

- a conventional drawer, not a desktop rail nested inside another panel
- one visual surface only
- full viewport height
- width intentionally capped and not proportional to tablet width
- settings removed from navigation and kept in the header utility area
- no compact/expand control inside the mobile drawer

Final measured width:

- `390px` viewport
  - `187px` measured in smoke
  - approved candidate nominal width: `188px`
- `768px` viewport
  - `187px` measured in smoke
  - no excessive proportional growth on tablet

Implementation direction:

- width class: `min(11.75rem, 56vw)`
- compact internal padding
- labels preserved
- touch targets preserved

### Single-Surface Fix

Previous mobile structure:

- `SheetContent`
  - first visible surface
- `#studio-shell-navigation`
  - second visible surface with its own border/radius/shadow

Final mobile structure:

- `SheetContent`
  - the only visible surface
- internal navigation container
  - transparent structural content only

Root cause:

- the desktop floating toolbar anatomy had initially been reused inside the mobile drawer

Fix:

- `components/ui/sidebar.tsx`
  - forwards mobile `className` to `SheetContent`
- `components/layout/studio-shell.tsx`
  - renders a dedicated mobile drawer composition instead of nesting the desktop rail surface

Validated:

- `navHasOwnSurface = false`
- no duplicated rounded inner panel
- no residual overflow

## Focus and Accessibility

Validated contracts:

- `nav` landmark remains present
- active route uses `aria-current`
- global trigger keeps an accessible name
- internal compact/expand control keeps an accessible name
- compact mode does not depend only on hover
- tooltips remain available in compact desktop mode
- mobile drawer:
  - closes on `Esc`
  - closes on outside click
  - closes after navigation
  - returns focus to the trigger
- focus-visible states remain separate from active-route styling

## Animations

Transition duration:

- `200ms`

Validated transitions:

- `expanded -> hidden`
- `compact -> hidden`
- `hidden -> expanded`
- `hidden -> compact`

Observed results:

- rail geometry stays stable during exit and restoration
- the internal compact/expand control remains present during the motion
- the active item retains its width during the transition
- icons do not jump upward mid-animation
- compact hidden exit leaves directly from compact geometry
- restoration respects `lastVisibleMode`

## Navigation

Canonical navigation source:

- `lib/sidebar-navigation.ts`

Groups preserved:

- Workspace
  - Dashboard
  - Projetos
  - Conteúdos
- Criação
  - Imagens
  - Vídeos
- Bibliotecas
  - Galeria
  - Arquivos

`Configurações` is no longer in the rail or drawer and is available through:

- top utility bar gear action
- avatar dropdown action

## Profile

Profile remains preserved in the top utility bar:

- avatar is always available
- dropdown contains:
  - user name
  - user email
  - `Configurações`
  - `Sair`

Name and email are no longer always exposed as permanent shell chrome.

## Routes and Smoke Coverage

Pilot route validation included shell behavior on:

- `/dashboard`
- `/configuracoes`
- `/galeria`
- `/imagens`
- mobile navigation route changes through real navigation links

The shell remained global, but page internals were not redesigned.

## Theme Validation

Validated shell anatomy:

- `Light`
- `Dark`
- `Studio Balanced`

Desktop smoke:

- `1600px`
  - expanded
  - compact
  - hidden
- `1280px`
  - expanded
  - compact
  - hidden

Mobile smoke:

- `768px`
  - drawer closed
  - drawer open
- `390px`
  - drawer closed
  - drawer open

Validated across those checks:

- top utility bar present and full width
- trigger present
- logo present
- notifications present
- settings present
- avatar present
- rail present on desktop states
- drawer present on mobile states
- active route visible
- no horizontal overflow
- no duplicated mobile surface

## Tests and Verification

Added / updated targeted shell coverage for:

- default desktop behavior
- effective mode derivation
- persistence sanitization
- `lastVisibleMode`
- hidden/compact/expanded contracts
- mobile drawer composition
- header future center slot
- no theme-specific shell branching

Final technical closure requires:

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm lint`
- `git diff --check`

## Limitations

- browser smoke remained focused on shell structure and behavior, not exhaustive page-by-page visual QA
- theme switching in browser validation was performed through the real Settings UI and confirmed at runtime, but not expanded into exhaustive route-by-route visual auditing
- rail and drawer shadows were intentionally not reopened for local visual tuning in this closeout

## Deferred Work

### Calibracao sistemica de sombras e superficies

Future refinement should audit the interaction between:

- `surface`
- `surface-translucent`
- `border`
- `radius`
- `backdrop-filter`
- elevation tokens
- Studio atmosphere
- canvas background

Explicit finding:

- isolated local `box-shadow` tweaks did not reproduce the reference HTML recipe reliably
- the problem is systemic and should be solved as a closed visual recipe, not as scattered shell overrides

### Auditoria futura de consistencia visual

References:

- Hermes
  - atmosphere, shell, control board
- Koourse
  - cards, modals, overlays, density, compositional consistency

Future objective:

- turn isolated tokens into closed visual recipes

### Overlays and Floating Surfaces

Future audit scope:

- Dialog
- Modal
- Drawer
- Popover
- Dropdown
- Tooltip
- Toast
- Command Palette
- media preview

Not implemented in this round.

## Final Decision

- desktop rail
  - approved
- compact top utility bar
  - approved
- conventional mobile drawer
  - approved
- DS-1H-C transversal rollout
  - allowed, but not started in this round

## Verdict

`DS-1H-B RAIL APROVADO - READY FOR IMPLEMENTATION`
