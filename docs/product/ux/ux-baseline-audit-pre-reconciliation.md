# UX Baseline Audit - Pre-Reconciliation

**Date:** 2026-06-26  
**Environment tested:** local app at `http://localhost:3000`  
**Scope:** practical UX and experience architecture audit before the current Project Identity / Production reconciliation.  
**Method:** browser-first exploration as a new user, without reading internal architecture or Project Identity documentation before the first pass.

---

## 1. Executive Summary

At the time of this audit, Content Agent Studio communicated a promising but split product model.

The product already had the foundations of a project-oriented creative production platform: Project, Project Identity, Production, drafts, media, and editorial content. The strongest signal was the Project detail page, where project context, style, identity, and Productions appeared together.

However, the end-to-end experience still oscillated between two models:

- a persistent workspace organized by Project, identity, and Production;
- a set of global generation tools grouped in the same dashboard.

The critical finding was:

> Images and Videos required a Production, but the Production did not provide a visible path to start those creations.

This meant the intended architecture existed conceptually, but the navigational surface did not yet let a user complete the central workflow.

The product direction was judged correct. The recommendation was not a broad redesign, but reconciliation: make navigation, state, and terminology tell the same story.

---

## 2. Methodology

The audit intentionally began from the UI, not from documentation.

Steps performed:

1. Logged in with the provided test account.
2. Observed the first page after login.
3. Created a test Project.
4. Added context, style tags, and Project Identity.
5. Created a Production inside the Project.
6. Tested Images, Videos, Editorial Content, Gallery, Files, Settings, refresh, browser back, and return paths.
7. Created small test records only through the UI.
8. Did not inspect or edit code during the first pass.

Evidence types were separated as:

- **Observation:** directly seen in the browser.
- **Interpretation:** meaning inferred from the interface.
- **Hypothesis:** plausible explanation not fully proven in that pass.
- **Recommendation:** proposed intervention.

---

## 3. Product Perceived From The UI

**Observed product:** a beta AI content creation application with Projects, Images, Videos, Editorial Content, Files, Gallery, and Settings.

**Perceived user:** creators, content teams, marketers, or producers working with AI-generated visual and editorial assets.

**Perceived problem solved:** create and organize AI-assisted creative work while preserving enough context to continue later.

**Primary unit of work perceived:** ambiguous.

Early screens suggested the primary unit was the tool: Image, Video, Content. The Project detail page suggested the primary unit was Project. Once a Production was created, a third candidate emerged: Production.

**Role of Project:** a persistent context and identity container. It appeared stronger than a simple folder because it included context, style profile, evaluation mode, structured identity, and Productions.

**Role of Images and Videos:** ambiguous. In the sidebar and dashboard they appeared to be global tools. Inside the modules, they later required a Production.

**Role of drafts:** fragmented. Drafts appeared in the Image module, but Gallery did not reflect the same draft count. Loading a draft produced positive feedback without restoring an editable state when no Production context was available.

---

## 4. Flows Tested

| Flow | Entry Point | Steps | Result | Continuity |
|---|---|---|---|---|
| Login | `/login` | Filled email/password and entered | Login succeeded after a short delay | Good after success |
| Dashboard | after login | Observed quick actions and metrics | Encouraged "Criar Projeto", "Gerar Imagem", "Gerar Video" | Weak: recent activity empty |
| Projects list | sidebar | Opened Projects | Empty state was clear | Good |
| Create Project | Projects > New Project | Added name, description, AI context, style tags | Project created; modal initially remained visible | Good after closing modal |
| Project detail | clicked project | Viewed context, style, identity, Productions | Strong project context page | Good |
| Project Identity | Project detail > Structure identity | Filled purpose, audience, visual identity, voice, principles, restrictions, preferences | Identity saved and displayed | Good |
| Create Production | Project detail > New Production | Added intention and title | Production created inside Project | Partial: no operational workspace visible yet |
| Images | sidebar | Opened Images | First showed global editor / project optional, then Production required | Poor |
| Image draft | Image module | Clicked existing draft | Toast said draft loaded, editor remained blocked | Poor |
| Videos | sidebar | Opened Videos | First showed global editor / project optional, then Production required | Poor |
| Editorial Content | sidebar | Created content with Project | Content created, but "Criar e abrir" did not open workspace | Poor |
| Files | sidebar | Observed library | Clearer project/pasta organization | Reasonable |
| Gallery | sidebar | Observed empty state | Gallery showed zero drafts while Images showed one draft | Weak |
| Settings | sidebar | Viewed Automation and API | Automation centered on image generation | N/A |

---

## 5. Prioritized Findings

| ID | Finding | Evidence Observed | Category | Severity | Confidence |
|---|---|---|---|---|---|
| D1 | Production was required for Images/Videos, but Production had no visible action to create them | Production card had Edit/Delete only; Images/Videos said to access from a Production | Flow blocker | Critical | High |
| D2 | Global navigation contradicted Production-required behavior | Sidebar and dashboard offered Image/Video as direct actions | Conceptual inconsistency | High | High |
| D3 | Images/Videos briefly showed a global editor with optional Project before switching to Production required | Both screens rendered "Projeto opcional" before the blocking state | Feedback problem | High | High |
| D4 | Image draft could be "loaded" without becoming editable | Toast "Rascunho carregado"; page still blocked by Production requirement | Continuity problem | High | High |
| D5 | Editorial content button promised "Criar e abrir" but left user in list | Created content remained listed in `/conteudos` | Feedback problem | High | High |
| D6 | Created Editorial Content had no obvious open/edit action | Clicking the title did not open it in the tested state | Flow blocker | High | Medium |
| D7 | Dashboard did not help resume existing work | Project, Production, and content existed; recent activity remained empty | Continuity problem | Medium | High |
| D8 | Project, Project, Produção, and Production were mixed in PT/EN | Texts used "Este Project", "Crie uma Production", "Projeto" | Conceptual inconsistency | Medium | High |
| D9 | Production added a promising layer but no operational consequence | It contained intention/type but no visible create-media path | Comprehension problem | High | High |
| D10 | Project Identity was clear in Project detail but not visible at creation time | Identity saved, but Images/Videos did not show which identity would be inherited | Possibly resolved by Project Identity | Medium | Medium |
| D11 | Gallery and Image drafts were disconnected | Image module showed one draft; Gallery showed Rascunhos (0) | Conceptual inconsistency | Medium | High |
| D12 | Files communicated project organization better than generated media | Files showed project/pasta structure; media modules blocked or contradicted | Navigation inconsistency | Medium | High |
| D13 | Required Project validation in Content appeared after submit | "Projeto *" field empty, create button active, then toast | Feedback problem | Low | High |
| D14 | Production title suggestion could interfere with manual edit | Suggested text and manual title became concatenated | Feedback problem | Medium | Medium |
| D15 | Project list metric was narrow | Project showed "0 imagens" despite identity, Production, and content | Absence | Low | High |

---

## 6. Mental Model Divergences

- The system said "start with Images or Videos"; the flow required starting from a Production.
- A Project looked like the center of identity and continuity, but navigation treated it as one peer among tools.
- Production looked like the next unit of work, but only offered metadata and management actions.
- A draft looked resumable, but loading it did not necessarily restore an editable workspace.
- Gallery looked like the home of results and drafts, but did not reflect Image drafts shown elsewhere.
- Editorial Content looked like it had a workspace, but the tested create/open path did not open one.

---

## 7. Problematic Flows

`Dashboard -> Gerar Imagem -> expected: create image -> actual: Production required -> consequence: user does not know where to start`

`Project with Production -> look for media actions -> expected: create image/video inside Production -> actual: only edit/delete Production -> consequence: central workflow blocked`

`Images -> click draft -> expected: resume editing -> actual: success toast but blocked screen -> consequence: false recovery`

`Conteudos -> Criar e abrir -> expected: open editorial workspace -> actual: stays in list -> consequence: continuity break`

`Production -> fill intention -> expected: controllable suggested title -> actual: automatic suggestion mixed with manual text -> consequence: predictability loss`

---

## 8. Excesses

- Dashboard quick actions for Image and Video were premature while those flows required Production.
- Sidebar placed Projects, Images, Videos, Content, Files, and Gallery at the same level while their ownership model was unresolved.
- English domain terms inside Portuguese UI increased cognitive load.
- Dashboard metrics did not yet help resume Project, Production, or content work.

---

## 9. Absences

- A visible action in Production to create Image, Video, or Content.
- Persistent indication of "you are working in Project X / Production Y".
- Display of which Project Identity would be inherited during creation.
- Real recent activity on the dashboard.
- A reliable path to resume Editorial Content.
- Reconciliation between Image drafts and Gallery counts.
- Stable loading states that avoid showing contradictory rules.

---

## 10. What Should Not Be Changed Yet

- No broad redesign was recommended.
- The Project detail page should be preserved; it already communicated persistence better than the dashboard.
- Structured Project Identity was not considered excess. It was understandable in context.
- Files/Arquivos already communicated project organization reasonably well.
- A long onboarding wizard was not necessary; the issue was broken flow reconciliation, not lack of tutorial.
- More tooltips were not the answer. The real paths needed to work first.

---

## 11. Hypotheses Related To Project Identity

Project Identity could solve:

- why Project context matters;
- continuity across creations;
- style and governance inheritance;
- evaluation of images against identity;
- the sense that Project is more than a folder.

Project Identity alone would not solve:

- missing Production-to-Image/Video entry points;
- content creation not opening a workspace;
- draft loading without editing;
- dashboard oriented by tools;
- Gallery/draft inconsistency.

Main risk:

> If Project Identity stays hidden from the act of creation, users will experience it as an administrative form rather than a production engine.

---

## 12. Recommendations From Baseline

| Priority | Recommendation | Minimum Intervention | Expected Benefit |
|---|---|---|---|
| 1 | Add media/content actions to Production | Buttons for Create Image, Create Video, Create Content | Unblocks central workflow |
| 2 | Adjust dashboard quick actions | Prefer "continue project/production" when Production is required | Reduces false starts |
| 3 | Stabilize Images/Videos loading state | Do not render optional-project editor before Production rule is resolved | Prevents contradiction |
| 4 | Fix draft recovery | Either open editable draft or explain/link missing Production context | Restores trust |
| 5 | Match "Criar e abrir" behavior | Navigate to editorial workspace or rename button | Honest feedback |
| 6 | Add open/edit action for Editorial Content | Visible Open/Edit button on list items | Enables resumption |
| 7 | Normalize PT/EN domain language | Use Projeto and Produção consistently in UI | Lowers cognitive load |
| 8 | Show inherited identity during creation | "Using Project Identity from X" block | Makes identity operational |
| 9 | Define Gallery scope | Include drafts or state it is only final results | Reduces fragmentation |
| 10 | Add real recent work to dashboard | Projects/Productions/contents recently updated | Supports daily return |

---

## 13. Verdict

1. **Was the product direction correct?** Yes. Project + identity + Production was a strong direction.
2. **Did the UX architecture support the concept?** Partially. Project detail supported it; dashboard and global tools contradicted it.
3. **Was the product project-oriented end to end?** Not yet.
4. **What needed resolution before expansion?** The route from Project/Production to creation and resumption of Image, Video, and Editorial Content.
5. **What could wait?** Advanced metrics, long onboarding, visual redesign, advanced automation, new navigation areas.
6. **Was broad reformulation necessary?** No. Reconciliation and refinement were the right next step.

