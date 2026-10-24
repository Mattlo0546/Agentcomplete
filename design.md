# Prompt Enhance — Design System

Every screen, component and state in this product follows this file **strictly**. If a need is not covered here, extend this file first, then build. Mockups live in `docs/mockups/`; the prototype source is `docs/prototype/`.

## 1. Direction — "Editor's Margin"

The prompt is a manuscript; Prompt Enhance is the editor working in its margin. The page is quiet, warm paper/ink. Suggestions arrive as **proof marks**: ghost text in pencil grey, insertions underlined in ink green, deletions struck in red, and a single **amber marker** colour reserved for the thing that needs the user's attention right now (the active suggestion, the focused option, the `Tab` key cap).

Rules that make it coherent:

1. **Amber means "pending decision"** — never decoration. At most one amber element group per viewport.
2. **Monospace = machine data or prompt text** (prompt editor, request ids, positions, models, latency). Sans = UI chrome.
3. **No decorative text.** No page subtitles, card blurbs, helper sentences or captions. Labels, real data, accessible names and actionable errors only.
4. **Hairlines, not boxes.** Structure comes from 1 px rules and spacing; cards only where content is a discrete, selectable object (question options, knowledge rows).
5. **Calm motion.** Things fade/slide 120–180 ms; nothing bounces.

## 2. Tokens

Implemented as shadcn/ui CSS variables (Tailwind v4, `oklch`). Light is `:root`, dark is `.dark` (next-themes, `attribute="class"`, default `system`).

### 2.1 Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `oklch(0.985 0.004 85)` | `oklch(0.165 0.006 70)` | app canvas (paper / ink) |
| `--foreground` | `oklch(0.235 0.012 70)` | `oklch(0.93 0.008 85)` | body text |
| `--card` | `oklch(1 0 0)` | `oklch(0.2 0.007 70)` | editor sheet, option cards |
| `--card-foreground` | = foreground | = foreground | |
| `--popover` / `-foreground` | = card | = card | |
| `--muted` | `oklch(0.955 0.006 85)` | `oklch(0.235 0.008 70)` | rails, table header, chips |
| `--muted-foreground` | `oklch(0.52 0.012 70)` | `oklch(0.68 0.01 80)` | secondary labels, metadata |
| `--ghost` | `oklch(0.68 0.01 75)` | `oklch(0.52 0.01 75)` | ghost-text autocomplete |
| `--border` | `oklch(0.905 0.007 80)` | `oklch(0.29 0.008 70)` | hairlines |
| `--input` | `oklch(0.88 0.008 80)` | `oklch(0.32 0.008 70)` | field borders |
| `--ring` | `oklch(0.75 0.15 70)` | `oklch(0.75 0.14 70)` | focus ring (amber) |
| `--primary` | `oklch(0.235 0.012 70)` | `oklch(0.93 0.008 85)` | primary buttons (ink) |
| `--primary-foreground` | `oklch(0.985 0.004 85)` | `oklch(0.165 0.006 70)` | |
| `--secondary` / `-foreground` | = muted / foreground | = muted / foreground | |
| `--accent` | `oklch(0.955 0.006 85)` | `oklch(0.26 0.008 70)` | hover rows (shadcn accent) |
| `--marker` | `oklch(0.8 0.15 75)` | `oklch(0.78 0.14 72)` | **amber**: pending decision |
| `--marker-soft` | `oklch(0.95 0.05 85)` | `oklch(0.3 0.05 70)` | amber tint behind active option |
| `--marker-foreground` | `oklch(0.3 0.06 60)` | `oklch(0.9 0.08 85)` | text on marker-soft |
| `--insert` | `oklch(0.52 0.12 150)` | `oklch(0.75 0.13 150)` | diff insertion text/underline |
| `--insert-soft` | `oklch(0.95 0.04 150)` | `oklch(0.3 0.05 150)` | insertion background |
| `--destructive` | `oklch(0.56 0.19 27)` | `oklch(0.68 0.17 25)` | deletions, errors, delete |
| `--destructive-soft` | `oklch(0.96 0.03 25)` | `oklch(0.3 0.06 25)` | deletion background |
| `--success` | `oklch(0.6 0.13 150)` | `oklch(0.72 0.13 150)` | status 2xx dot |
| `--warning` | `oklch(0.72 0.14 75)` | `oklch(0.78 0.13 75)` | slow / degraded dot |

Contrast: foreground/background ≥ 12:1; muted-foreground/background ≥ 4.6:1; ghost/card ≈ 2.6:1 by design (ghost is non-committed text and is always paired with the `Tab` cap).

### 2.2 Type

- Sans: **Geist** (`next/font` `geist`), weights 400/500/600.
- Mono: **Geist Mono**, weights 400/500.
- Features: `"ss01"`, tabular numbers (`font-variant-numeric: tabular-nums`) everywhere numbers align.

| Role | Font | Size / line | Weight | Tracking |
|---|---|---|---|---|
| `title` (tab heading) | Sans | 18 / 24 | 600 | -0.01em |
| `section` | Sans | 13 / 18 | 600 | 0 |
| `label` (uppercase metadata) | Mono | 11 / 16 | 500 | 0.06em, uppercase |
| `body` | Sans | 14 / 20 | 400 | 0 |
| `small` | Sans | 12 / 16 | 400 | 0 |
| `prompt` (editor) | Mono | 15 / 26 | 400 | 0 |
| `prompt-narrow` | Mono | 14 / 24 | 400 | 0 |
| `data` (ids, latency) | Mono | 12 / 16 | 400 | 0 |

### 2.3 Space, radius, elevation

- Spacing scale (px): 2, 4, 6, 8, 12, 16, 20, 24, 32, 40. Page gutter 24 (wide) / 16 (narrow).
- Radius: `--radius: 0.5rem` → sm 4, md 6, lg 8, xl 12. Editor sheet and dialogs use lg; chips and key caps use sm; pills (tag chips) use full.
- Elevation: no shadows on static surfaces. Popovers/dialogs: `0 8px 24px -8px oklch(0.2 0.01 70 / 0.18)` + 1 px border.
- Hairline: `1px solid var(--border)`.

### 2.4 Motion (Motion library)

| Event | Animation |
|---|---|
| Ghost text appears | opacity 0 → 1, 120 ms ease-out |
| Question card enters | y 8 → 0 + opacity, 180 ms `[0.2, 0, 0, 1]` |
| Diff preview | height auto, 160 ms |
| Tab switch | opacity crossfade 120 ms |
| Requesting indicator | 3-dot amber pulse, 900 ms loop |

`prefers-reduced-motion`: all transitions become instant.

### 2.5 Iconography

Lucide, 16 px (UI), 14 px inside chips, stroke 1.75. Tab icons: Refine `pen-line`, Knowledge `library`, Activity `activity`, Settings `settings-2`.

## 3. Layout

### Wide (≥ 1024 px)

`react-resizable-panels`, three columns:

1. **Rail** 56 px fixed — product mark, four tab icons (with tooltips), theme toggle at bottom.
2. **Main** min 520 px — tab content.
3. **Inspector** default 340 px, 280–480 resizable, collapsible — contextual detail (Refine: knowledge used + pipeline; Knowledge: selected item; Activity: selected log).

A 1 px resize handle with a 6 px hit area; on hover the handle tints `--marker`.

### Medium (768–1023 px)

Rail + Main; Inspector becomes a right sheet opened from a header button.

### Narrow (< 768 px — docked Codex panel, phone)

Single column. Top bar 48 px (tab title + one contextual action). Bottom tab bar 56 px with icon + label. Inspector content becomes a bottom sheet (drawer). Gutter 16 px. Touch targets ≥ 44 px.

## 4. Components

All built on shadcn/ui primitives; styles co-located with each component (Tailwind classes in the component file, plus a sibling `*.module.css` only for things Tailwind cannot express, e.g. caret-layer alignment).

### 4.1 PromptEditor

- Card sheet, radius lg, 1 px border, padding 20 (wide) / 16 (narrow). Min height 280 / 160.
- Implementation: `<textarea>` with an aligned mirror layer behind it that renders committed text transparently and then the ghost suffix in `--ghost`. Same font metrics; scroll synchronised.
- Footer row inside the sheet (hairline above, 36 px): left — revision & cursor as `data` (`rev 7 · 142:142`); right — character count and **Send to Codex** button (primary, sm).
- Focus: border → `--ring`, 3 px ring at 25 % opacity.
- Ghost text shows only when cursor is at the end and the response is current. Accept `Tab` (also → on narrow via chip tap), dismiss `Esc`, any edit/cursor move hides it.
- Inline hint after ghost text: `KeyCap "Tab"` in marker style (amber border, marker-foreground text). Only element in amber while ghost is visible.

### 4.2 RequestIndicator

Inline in editor footer left, replaces `rev` text while waiting: three 4 px amber dots pulsing. Accessible name "Generating suggestion". No text.

### 4.3 QuestionCard

- Appears below the editor (wide) or above the keyboard as a bottom-docked card (narrow).
- Header: `label` "QUESTION" in muted mono, then question in `section` style, 15/22, foreground. Dismiss button (ghost icon `x`, accessible name "Decline all options").
- Options: vertical list of selectable rows (radio-group semantics), 44 px min, radius md, 1 px border. Keyboard: `1`–`9` selects, ↑/↓ moves, `Enter` previews/confirms, `Esc` declines all.
- Selected option: `--marker-soft` background, `--marker` 1 px border, leading 16 px number key cap.
- Footer: **Decline all** (ghost) left, **Apply** (primary) right; Apply disabled until an option is selected.

### 4.4 DiffPreview

- Rendered inside the QuestionCard under the selected option, before Apply.
- Shows the resulting prompt region with ±40 chars context, mono 13/20.
- Inserted text: `--insert` colour on `--insert-soft`, 1 px underline. Deleted text: `--destructive` on `--destructive-soft`, line-through.
- Edit count as `data`: `2 edits · +46 −0`.

### 4.5 KnowledgeUsed (Inspector, Refine)

- Section "Knowledge used". Rows: kind icon (`file-text` skill, `message-square-quote` prompt, `workflow` graph), title, relevance score as `data` right aligned, kept/dropped state (dropped rows muted with strike-free 50 % opacity, behind a "Show dropped (n)" toggle).
- If general enhancement was used: single row "General enhancement" with `sparkles` icon.
- Section "Pipeline": four steps — Tags, Retrieve, Judge, Generate — each with latency `data` and a status dot. Tags step lists extracted tag chips.

### 4.6 TagChip

Pill, height 22, padding 0 8, `small` 12/16, `--muted` background, mono optional for tag names. Selected (filter): foreground background, background text. Similarity, when shown, appended as `data` `0.87`.

### 4.7 KnowledgeList

TanStack Virtual list; row 64 px (wide) / 72 px (narrow). Row: kind icon, title (500), summary truncated to one line in muted (this is product data, not decoration), up to 3 tag chips + `+n`, updated date `data`. Selected row: `--accent` background + 2 px left inset in foreground.

Toolbar: search input (icon `search`, placeholder "Search knowledge"), kind segmented control (All / Skills / Prompts / Graphs), tag filter combobox, **Add knowledge** primary button.

### 4.8 KnowledgeDetail

Title (`title`), kind + created/updated `data`, tags (chips with similarity-free display), Summary section, Body section (mono 13/20, scroll, markdown rendered for skills), actions: Delete (destructive outline, confirm dialog). Edit regenerates summary + tags on save.

### 4.9 AddKnowledgeDialog

Dialog (wide) / full-height sheet (narrow). Fields: Kind (segmented), Title, Body (mono textarea, accepts paste or `.md` file drop). Primary **Add**. After submit the dialog shows progress steps (Summarise → Tag → Embed → Save) then the generated Summary and Tags (tags removable / addable) and **Done**. Validation errors inline under the field in destructive.

### 4.10 LogTable (Activity)

Toolbar: segmented (All / AI calls / API calls), status filter (All / 2xx / 4xx / 5xx), search by request id.
Virtual table, row 40 px, columns: time (`HH:mm:ss.SSS`), kind badge, operation, model, status dot + code, latency (right), tokens in/out (right). Rows sharing a request id are grouped under an API row with disclosure.
Narrow: rows become 2-line items (operation + latency / request id + time).

### 4.11 LogDetail (Inspector)

Request id (copy button), timeline of the pipeline calls with bars proportional to latency, status, tokens, sanitized error block (mono, destructive-soft). No payload section: payloads are never stored (decision D1).

### 4.12 OutcomeSummary (Activity header)

Four stat figures in a row (no cards): Suggestions, Accepted %, Declined %, p50 latency — `title`-size tabular numbers with `label` captions. Plus "Classifier" figure: last trained date + AUC, from Snowflake.

### 4.13 Settings

Grouped forms with hairline separators; each group has a `section` heading only.
- Backend: URL input, health status (dot + `data` latency), **Test** button.
- Suggestions: Trigger delay (slider 150–1500 ms, default 400), Autocomplete on/off, Questions on/off, Max options (2–6).
- Appearance: Theme (System / Light / Dark segmented).
- Logging: Payloads `Not stored` and Retention `30 days` as read-only `data` values (decisions D1/D2 fixed them; no controls), stored entry count, **Clear logs** (destructive, confirm dialog).
- Snowflake: export status, last export time, **Export now**, **Retrain**.

### 4.14 Feedback

- Sonner toasts, bottom-right (wide) / top (narrow), only for async outcomes (knowledge added, export finished) and errors with an action ("Retry").
- Inline error in editor footer when `/enhance` fails: destructive dot + `data` status (`502 · upstream model`) + **Retry** text button.
- Empty states: a single label + one action (e.g. "No knowledge yet" + **Add knowledge**). No illustrations, no explanatory sentences.

## 5. Accessibility

- All icon-only buttons have accessible names; tabs are `role="tablist"`.
- Ghost text is announced via an `aria-live="polite"` region ("Suggestion available, press Tab to accept") — screen-reader-only, not visible text.
- Focus visible on everything (amber ring); question options fully keyboard operable.
- Respect reduced motion; colour is never the only signal (diff uses underline/strikethrough; status uses code text).

## 6. Content rules

- Sentence case for labels and buttons. Verbs on buttons ("Apply", "Add knowledge", "Send to Codex").
- Numbers: latency `412 ms`, tokens `1.2k / 86`, scores `0.87`, dates `24 Oct 14:02`.
- Realistic data in mockups and fixtures; never lorem ipsum.
