---
kind: prompt
title: Build an accessible React dialog with keyboard verification
---
Use when the requested React interaction is genuinely a modal dialog.

**Goal:** Implement `<dialog task>` using the project's existing accessible component primitives and visual language.

**Context:** Identify the trigger, dialog title, form fields, cancellation behavior and successful outcome. Confirm `<initial focus target>` based on the content and action risk.

**Work:** Give controls accessible names and connect validation errors to their inputs. Keep background content noninteractive while modal. Contain keyboard focus, support forward and reverse Tab navigation, handle Escape consistently, and restore focus to the trigger or a sensible successor after closing.

**Guardrails:** Prefer native elements and established primitives. Do not declare a dialog modal while leaving background controls operable. Preserve typed values when recoverable errors occur.

**Verification:** Exercise opening, submission failure, success and cancellation with keyboard only. Check visible focus, screen-reader naming and a narrow viewport. Report checks actually performed; automated accessibility scans alone do not establish full accessibility.

Sources: [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [W3C keyboard interaction guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/).
