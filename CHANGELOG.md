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
