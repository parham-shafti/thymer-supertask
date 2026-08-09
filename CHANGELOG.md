# Changelog

## v1.0.0 — 2026-08-08

First public release.

- **Keyboard hashtags** — `⌘1`–`⌘9` tag the caret's line with your own hashtags (timeblocks, priorities, contexts — configurable in Settings). Same key again clears. Tags are swapped in place, never shuffled to the end of the line.
- **Task status from the keyboard** — `⌃1`–`⌃9` set the caret line's status: In Progress, Important, Alert, Starred, Billable, Discuss, Blocked, Clear, Done. Same chord again clears.
- **Dates without the mouse** — `⌃+` / `⌃−` nudge a date one day; `⌘⇧S` opens a date box with a month calendar, Thymer's own date parser (`tomorrow`, `next monday`, `week 10`…), time toggle, end dates and a Clear button. Works on a todo's own date, on a page's Due Date from collection views, and inside live searches.
- **Repeating tasks** — a Repeat rule on any dated todo (daily/weekly/monthly/yearly plus a full custom grammar: weekday sets, month days, ordinals like "the last Friday", end dates). Ticking a repeating task un-ticks it and moves it to the next occurrence, either on the schedule or counted from completion.
- **Group and order sections** — per heading (the `⋯` menu) or globally (Settings): group tasks under status roofs (Starred … Done, with Done starting collapsed and canceled sinking below done), group by your own hashtags in `⌘`-digit order, or keep a flat list sorted by status. Untagged/unflagged tasks can gather under a Todo roof. Tasks arriving from anywhere — moved in, captured, typed — file themselves.

## v1.1.0 — 2026-08-09

- **Windows and Linux key commands.** The chords now adapt to the platform: hashtags on `Ctrl+1`–`Ctrl+9`, task statuses on `Alt+1`–`Alt+9`, date nudges on `Alt++`/`Alt+-` (`Ctrl`+plus/minus is the zoom there), and the date box on `Ctrl+Shift+S`. Audited against Thymer's own Windows/Linux keymap and Electron's menu accelerators; the exclusive-modifier matching also keeps AltGr combinations (which report Ctrl+Alt) from misfiring on European layouts.
- The Settings panel and the Shortcuts card show the chords for your platform instead of Mac glyphs everywhere.

## v1.2.0 — 2026-08-09

- **Repeating PAGES.** The date box on a page (from a collection view, a page reference or a live search) now carries the full Repeat rule. The Custom panel gains record-mode pickers: which **date field** the rule drives (every collection names its dates differently), and optionally which **status field + value** means done — when that value lands on the page, the date advances and the status resets (to a chosen value, or clears). Without a status trigger the rule still powers the forward trail.
- **Leave a trail**, for todos and pages alike, chosen in the Custom panel:
  - **Completed copies stay** — ticking leaves a done copy on the old date right where the task stood (it files itself under a Done roof when the section is grouped) and the original moves on.
  - **Lay out all occurrences** — with an Until date, every future occurrence is created up front as a real todo or page (Expenses with a repeat become visible months ahead for budgeting). The series is remembered: shorten the Until and superfluous copies are removed, extend it and the missing ones are laid out — completed copies are history and are never touched. Ticking an occurrence just completes it; nothing advances. Capped at 100 copies.

## v1.1.0 – v1.3.9 — 2026-08-09 (unreleased batch)

- **Windows and Linux key commands** with platform-aware labels (Ctrl+1..9 hashtags, Alt+1..9 statuses, Alt+plus/minus nudges, Ctrl+Shift+S date box).
- **Task statuses from the keyboard** in a settings-defined shortcut order.
- **Repeating pages**: the date box on a page carries the full Repeat rule, driven by a chosen date field with a chosen status field + value as the done trigger (advance + reset). Per-collection defaults remember your last choices.
- **Leave a Trail**: completed copies stay behind on tick (the original stays done, a fresh copy carries the rule), or lay out every occurrence up front with a remembered, reconciling series.
- **End Repeat**: Never / After n times / On Date with a compact month picker.
- **The Tasks view** is a first-class surface for every command.
- Dozens of UI refinements across the date box, menus and settings.
