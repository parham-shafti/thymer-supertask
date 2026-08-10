# Changelog

## v1.6.0 — 2026-08-10

- **Progress bars follow the line everywhere it is rendered.** A bar switched on for a heading or a parent task now also shows on that line's **live search results**, on **transclusions** of it, and in Thymer's **Tasks view** — same bar, same count, no extra setup.
- **…and they survive a reload, and pages you have never opened.** A bar can only be counted from the line's sub-tasks, and those load with the page they live on — so on the surfaces above, where the line's home page is usually closed, there was nothing to count and no bar appeared. Counts are now remembered between sessions, and any line rendered somewhere without one has its page fetched in the background and counted there. This is what makes the two global switches mean what they say: every heading, and every todo with sub-tasks, wherever it shows up.
- **The `⋯` menu now appears on any line showing a bar**, however the bar got there. It used to require having switched that line on by hand, so anything lit by a global switch had no way back into the menu to turn it off, or to set grouping and ordering. A heading with no tasks under it still shows nothing.
- In the Tasks view the bar sits **tight under the line's location** instead of a row's height below it.
- Settings written on one device are no longer ignored by another when both were saved in the same moment, which could leave a switch reading as on while doing nothing.
- **Two switches instead of one**, in a new *Progress Bar Toggles* section at the top of Settings: **On every heading** and **On every todo with sub-tasks**. The old single switch only ever lit headings; parent todos can now have their own default. A section's `⋯` menu or **Supertask: Progress Bar** still overrides both.
- The Settings heading shows the **running version**.
- Switching theme no longer rescans the workspace on every keystroke. The watcher was listening to a class attribute Thymer rewrites constantly while you type and select; it now watches the theme itself, debounced.

## v1.5.2 — 2026-08-10

- Progress bars: the unfilled part of the bar is readable again on dark themes. v1.5.1 darkened both halves; only the filled half was meant to change.
- The global progress-bar switch has its own box at the top of Settings, named **Global Progress bar** — it was buried inside Task Status Settings.

## v1.5.1 — 2026-08-10

- Progress bars sit **darker in dark themes**, against an almost-black track. The fill now follows your accent colour directly; it used to be mixed with the text colour, which brightened it on dark themes and darkened it on light ones.
- **Progress bar** moved to the top of a section's `⋯` menu, above a divider, and is highlighted while it is on.
- The `⋯` button now also appears on a heading that only has a progress bar, so you can always get back in to switch it off. Turning ordering off leaves the button in place while the bar is still on.
- Switching theme re-measures the `⋯` button and the bars instead of leaving them at their old positions.

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
