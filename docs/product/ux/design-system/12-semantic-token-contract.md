# Semantic Token Contract (DS-1A)

## Arquitetura em camadas
A arquitetura de tokens seguirá um formato pragmático de 3 camadas principais, mantendo total compatibilidade com Tailwind e shadcn/ui.

- **Layer 1 — Foundation / Scale Tokens**: Não estão no código de produção diretamente. Representam paletas físicas puras (e.g., `gray-900`, `blue-500`). O Tailwind cuida destas se necessário, mas nosso modelo prioriza pular para a camada semântica.
- **Layer 2 — Semantic Tokens**: O núcleo do Design System. Representam função (e.g., `--canvas`, `--border-default`, `--success`).
- **Layer 3 — Theme Mappings**: Os valores aplicados nas classes de modo (e.g., `[data-theme="dark"]`, `.dark`, `.theme-studio`) alterando as variáveis.
- **Layer 4 — Component Tokens**: **Restrito**. Ocorre unicamente quando a composição for impossível apenas com Layer 2 sem impactar outros componentes. Em grande parte, delegados aos defaults do shadcn (ex: `--sidebar-background`).

## Taxonomia e Nomenclatura

A camada semântica estende a base atual do shadcn e adiciona os papéis exigidos pelo UX-H4.

### Canvas e Superfícies
| Nomenclatura | Responsabilidade | Status shadcn |
| --- | --- | --- |
| `canvas` | Fundo principal da aplicação. | Mapeia para `--background` |
| `surface` | Fundo de cards padrão e popovers. | Mapeia para `--card` / `--popover` |
| `surface-subtle` | Paineis internos embutidos. | **Novo / A definir** (ou `muted`) |
| `surface-elevated` | Elementos flutuantes, drawers. | Utiliza elevação via sombra, estende `surface` |
| `surface-overlay` | Fundo para modais (dimmer). | Usa bg-black/80 do `Dialog` |
| `surface-translucent`| Módulos glass, tabs. | **Novo** |

### Texto
| Nomenclatura | Responsabilidade | Status shadcn |
| --- | --- | --- |
| `text-primary` | Textos vitais e de máxima leitura. | Mapeia para `--foreground` |
| `text-secondary` | Descrições e metádata base. | **Novo / A definir** |
| `text-muted` | Placeholder, detalhes secundários de metadata. | Mapeia para `--muted-foreground` |
| `text-inverse` | Contraste forçado em superfícies brand. | Mapeia para `*-foreground` nativos |

### Bordas
| Nomenclatura | Responsabilidade | Status shadcn |
| --- | --- | --- |
| `border-subtle` | Divisores sutis, HRs. | **Novo / A definir** |
| `border-default` | Delimitador padrão de cards. | Mapeia para `--border` |
| `border-emphasis` | Delimitador acentuado (foco / drag). | Mapeia para `--ring` |

### Estados e Ações
O sistema introduz os 4 pilares taxonômicos (Success, Warning, Danger, Info).
| Nomenclatura | Responsabilidade | Status shadcn |
| --- | --- | --- |
| `action-primary` | Ação principal (CTA). | Mapeia para `--primary` |
| `action-secondary` | Ações neutras. | Mapeia para `--secondary` |
| `danger` / `destructive`| Pilares de deleção / Erros graves. | Mapeia para `--destructive` |
| `success`, `warning`, `info`| Pilares de states (StatusBadge, Callout). | **Novos** |

## Tipografia (Roles)
Não atrele tipografia puramente a componentes HTML, mas sim ao papel semântico que exercem (UX-H4):
- `page-title`: Título principal (h1 do PageHeader).
- `section-title`: Agrupadores dentro de um hub.
- `card-title`: Título prioritário de um card (Projeto/Produção).
- `body`: Texto padrão e descrições curtas.
- `metadata`: Metadados menores, rótulos utilitários.
- `caption`: O menor tamanho viável para textos periféricos. Substitui os `text-[10px]` e `text-[9px]` hardcoded.

## Anti-Patterns

1. **Dependência excessiva de valores hardcoded (Hex)**: Proibido introduzir cores fixas arbitrárias nas classes (ex: `bg-[#FF0000]`). Use apenas variáveis.
2. **Explosão de Tokens de Componente**: Não crie `--card-border`, `--button-border`, `--modal-border`. Use a camada semântica `--border-default` para manter a consistência de escala.
3. **Ignorar herança de cor de texto**: Evite estilizar ícones com classes próprias se eles puderem herdar (via `currentColor`) a cor do texto pai.

## Regras para Component Tokens
Somente utilize component tokens (Layer 4) quando um componente tiver uma semântica de domíno particular e conflituosa. 
Exemplo válido aprovado: o escopo `--sidebar-*` existente, já que a Sidebar costuma ter inversões de tema independentes da superfície principal em alguns layouts modernos.
