# Changelog

## v1.5.0 — 2026-08-10

- **Progress bars.** A heading can show a bar for the tasks beneath it, with the count beside it. Opt in per section from its `⋯` menu or with **Supertask: Progress Bar** on the caret's section, or switch it on for every heading in Settings.
- A heading counts its **direct** tasks. A sub-checklist stays its own business — unless that parent task has a bar of its own, in which case its numbers roll up into the heading too. Put the caret on a task with sub-tasks and run the same command to give it one.
- Canceled tasks count as resolved, so a section with nothing left to do reaches the end of the bar.

## v1.4.5 — 2026-08-10

- **Menus follow the theme.** The date box's dropdowns kept their dark surface after a switch to a light theme. The theme is now read from the app's own light/dark marker (the previous check sampled a background that is transparent, so it always answered "dark"), rechecked whenever the theme changes and again every time a menu opens.
- The **unit label** next to the interval ("day", "week") was nearly invisible on light themes; it now takes the box's own text colour.
- **Repeat rules clean up after themselves.** Trashing a repeating page retires its rule, and its laid-out copies with it.

## v1.4.4 — 2026-08-10

Everything below is new since v1.0.0.

### Repeating pages

- **Pages repeat, not just todos.** The date box on a page — from a collection view, a page reference or a live search — carries the full Repeat rule. Because every collection names its fields differently, the Custom panel asks which **date field** the rule drives, and optionally which **status field + value** means done and what that status should **reset to**. When that value lands on the page, the date advances and the status resets. Your last choices are remembered per collection.

### Leave a trail

- **Keep Done Copies** — ticking leaves the finished task exactly where it stood, with its date, backlinks and history intact, while a fresh copy carries the repeat to the next occurrence.
- **All Occurrences** — the whole series is laid out up front as real tasks or real pages, so a year of rent is visible and summable today. The series stays reconciled: shorten the end date and the surplus copies go, extend it and the missing ones appear; completed copies are history and are never touched. Editing the rule from any copy edits the whole series. Capped at 100.
- **Name Copies** — laid-out occurrences can name themselves from a template, so twelve identical "Rent" pages become *Rent – September*, *Rent – October*, … Tokens for the title, the occurrence number, and the copy's own month, date, day, week and year; everything else in the template is literal text, so the separator is yours. The original always keeps its own name, and renaming it later never ripples into the series.
- **End Repeat** now offers Never, After *n* times, or On Date with a compact month picker.

### Everywhere else

- **Windows and Linux key commands**, audited against Thymer's own keymap and Electron's accelerators: hashtags on `Ctrl+1`–`Ctrl+9`, statuses on `Alt+1`–`Alt+9`, nudges on `Alt++`/`Alt+-`, the date box on `Ctrl+Shift+S`. Settings and the shortcuts card show the chords for your platform.
- **Thymer's Tasks view is a first-class surface** — every shortcut and the date box work on the focused row there, not just in the editor.
- Typing in the plugin's own fields is no longer swallowed by the view behind them.
- Many refinements across the date box, its menus and Settings.

## v1.0.0 — 2026-08-08

First public release.

- **Keyboard hashtags** — `⌘1`–`⌘9` tag the caret's line with your own hashtags (timeblocks, priorities, contexts — configurable in Settings). Same key again clears. Tags are swapped in place, never shuffled to the end of the line.
- **Task status from the keyboard** — `⌃1`–`⌃9` set the caret line's status: In Progress, Important, Alert, Starred, Billable, Discuss, Blocked, Clear, Done. Same chord again clears.
- **Dates without the mouse** — `⌃+` / `⌃−` nudge a date one day; `⌘⇧S` opens a date box with a month calendar, Thymer's own date parser (`tomorrow`, `next monday`, `week 10`…), time toggle, end dates and a Clear button. Works on a todo's own date, on a page's Due Date from collection views, and inside live searches.
- **Repeating tasks** — a Repeat rule on any dated todo (daily/weekly/monthly/yearly plus a full custom grammar: weekday sets, month days, ordinals like "the last Friday", end dates). Ticking a repeating task un-ticks it and moves it to the next occurrence, either on the schedule or counted from completion.
- **Group and order sections** — per heading (the `⋯` menu) or globally (Settings): group tasks under status roofs (Starred … Done, with Done starting collapsed and canceled sinking below done), group by your own hashtags in `⌘`-digit order, or keep a flat list sorted by status. Untagged/unflagged tasks can gather under a Todo roof. Tasks arriving from anywhere — moved in, captured, typed — file themselves.
