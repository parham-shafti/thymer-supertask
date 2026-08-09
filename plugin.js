/**
 * Supertask (formerly Reschedule) — supercharged tasks without leaving the
 * keyboard: dates, timeblock hashtags, repeats, and order-by-status.
 *
 *   ⌘1 … ⌘9          set the timeblock hashtag on the caret's line
 *                    (#earlymorning #morning #latemorning #lunch #afternoon
 *                     #lateafternoon #dinner #evening #lateevening)
 *   ⌃+ / ⌃−          move the date one day forward / back
 *   ⌘⇧S              open the date box (calendar + type any date)
 *
 * ⌘ carries the timeblocks and the date box, ⌃ the one-day nudges. Anything
 * further out is a job for the date box, which is why the old ⌃⇧1–9 / ⌃⌥1–9
 * multi-day jumps were removed.
 *
 * AUDIT WARNING, learned the hard way: when extracting Thymer's default keymap
 * from the bundle, action ids contain UNDERSCORES. A regex of
 * `action:"([a-zA-Z.]+)",key:"..."` silently drops 40 bindings, including
 * global.launch_cmdpal_jump (⌘K) and global.journal_gohome (⌘J), both of which
 * were then wrongly reported as free. Use `[a-zA-Z._]+`. ⌘⇧S was cleared against
 * the corrected extraction AND against a raw substring search of the whole
 * bundle (0 hits for "Shift+S") AND the Electron accelerator list.
 *
 * ⌘⇧K was asked for and is NOT usable: it is Thymer's editor.url, and Thymer
 * registers its dispatcher with window.addEventListener("keydown", fn, true) at
 * app start, i.e. capture phase, before any plugin loads. Its handler therefore
 * runs first and a plugin cannot suppress it. Freeing it means rebinding
 * editor.url in Thymer's own Customize Keyboard Shortcuts, which a plugin has no
 * API to write.
 *
 * WHICH DATE MOVES
 * Every command resolves its target the same way, so one set of chords covers
 * both halves of the GTD system:
 *
 *   1. a focused row in a collection view  → that page's "Due Date" property
 *   2. a PAGE returned by a live search    → that page's "Due Date" property
 *   3. the caret's line carries a date     → that date
 *   4. the caret's line IS a page reference (one ref and nothing else)
 *                                          → the referenced page's "Due Date"
 *   5. anything else                       → a new date on the line, counted
 *                                            from today
 *
 * Rule 4 is deliberately strict, the same test Duplicate uses: a prose todo that
 * merely mentions [[Some Project]] moves its OWN date, never the project's.
 *
 * All of it works inside a live search, which needs the virtual-row remap in
 * editorSelection() — see the comment there.
 *
 * "Due Date" is looked up by NAME, not by field id. Every collection gives it a
 * different id (FVAMB0XBXED8FA5 in Actions, FHPCHCJ6WR8Q1F9 in Deals,
 * _dyn_due_date_datetime in the dynamic ones), so a name lookup is the only
 * thing that reaches all of them without hardcoding 30 ids.
 *
 * WHY THE DATE BOX IS OURS AND NOT THYMER'S
 * Thymer DOES have a native date picker, but it is reached through the `@` menu
 * ("Assign due date") as an insert flow at the caret. Two things put it out of
 * reach here: it assigns a date to the line you are on, so it can do nothing
 * about a PAGE's Due Date property, and the editor ignores synthetic input, so a
 * plugin cannot open it for you. The date chip itself is not a way in either —
 * verified over CDP against 1.0.18, `span.lineitem-datetime` carries a
 * `clickable` class but clicking it NAVIGATES TO THAT DAY'S JOURNAL, and
 * right-click offers no menu.
 *
 * So the date box is ours: a month grid plus a text field parsed with
 * `DateTime.parseDateTimeString`, which is Thymer's OWN parser, so "tomorrow",
 * "next monday", "aug 13", "week 10", "Q1 2024", "3 days from now" and "monday
 * to friday" behave exactly as they do when you type a date into a line. Typing
 * moves the grid to the month you named, so you can see which day it lands on.
 *
 * WHY NOT ⌥
 * ⌥1…⌥9 would eat @ $ | { and friends on a Swedish Mac layout, and ⌥←/⌥→ are
 * Thymer's own nav.wordLeft/wordRight. Audited against the shipped keymap: no
 * digit is bound on ANY modifier, and macOS only claims ⌃0 (Electron zoom
 * reset), so the ⌘ digit block is free. Timeblocks match on e.code, so the
 * physical 1–9 row works on any layout; the +/- nudges match on the character
 * instead, see match().
 */

/* ==== RECURRENCE ENGINE — start (test-recurrence.mjs extracts this verbatim) ====
 *
 * Apple Calendar's model, which is schedule-based: occurrences fall where the
 * RULE says, not N days after you happened to tick the last one. Ticking late
 * therefore never shifts the rhythm, and past occurrences are skipped rather
 * than piling up.
 *
 *   { f:'d', n:3, a:20260806 }                    every 3 days
 *   { f:'w', n:1, a:…, wd:[4] }                   every week on Friday
 *   { f:'m', n:1, a:…, md:[14] }                  every month on the 14th
 *   { f:'m', n:2, a:…, ord:1,  od:1 }             first Tuesday, every 2 months
 *   { f:'m', n:1, a:…, ord:-1, od:'day' }         last day of the month
 *   { f:'y', n:1, a:…, mo:[7], md:[14] }          every 14 August
 *
 * f  frequency d|w|m|y      n  interval (every n)      a  anchor date, YMD int
 * wd weekdays, 0=Mon..6=Sun                            mo months, 0=Jan..11=Dec
 * md month days, 1..31                                 ord 1..5, -1 last, -2 next to last
 * od 'day' | 'weekday' | 'weekendday' | 0..6           (used with ord)
 * u  until, YMD int — the rule stops firing past this date (Apple's End Repeat)
 */
function recurYmdToDate(n) { return new Date(Math.floor(n / 10000), (Math.floor(n / 100) % 100) - 1, n % 100); }
function recurDateToYmd(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function recurWeekday(d) { return (d.getDay() + 6) % 7; } /* Mon = 0 */

/* Monday of that date's week, so "every 2 weeks" has a stable phase. */
function recurWeekStart(d) {
	const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	x.setDate(x.getDate() - recurWeekday(x));
	return x;
}

/* Which day-of-month the ordinal rule picks in the month containing d, or 0. */
function recurOrdinalDay(d, ord, od) {
	const y = d.getFullYear();
	const m = d.getMonth();
	const last = new Date(y, m + 1, 0).getDate();
	const days = [];
	for (let day = 1; day <= last; day++) {
		const wd = recurWeekday(new Date(y, m, day));
		let ok;
		if (od === 'day') ok = true;
		else if (od === 'weekday') ok = wd <= 4;
		else if (od === 'weekendday') ok = wd >= 5;
		else ok = wd === od;
		if (ok) days.push(day);
	}
	if (!days.length) return 0;
	if (ord > 0) return days[ord - 1] || 0;
	return days[days.length + ord] || 0; /* -1 last, -2 next to last */
}

function recurMatches(rule, ymd) {
	if (!rule || !rule.f || !rule.a) return false;
	const n = Math.max(1, rule.n || 1);
	const d = recurYmdToDate(ymd);
	const a = recurYmdToDate(rule.a);
	if (ymd < rule.a) return false;

	const dayOfMonthOk = () => {
		if (rule.ord) return d.getDate() === recurOrdinalDay(d, rule.ord, rule.od);
		const md = rule.md && rule.md.length ? rule.md : [a.getDate()];
		if (md.indexOf(d.getDate()) >= 0) return true;
		/* a 31st rule still has to fire in a 30-day month, so clamp to the end */
		const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
		return d.getDate() === last && md.some((x) => x > last);
	};

	if (rule.f === 'd') {
		const days = Math.round((d - a) / 86400000);
		return days >= 0 && days % n === 0;
	}
	if (rule.f === 'w') {
		const wd = rule.wd && rule.wd.length ? rule.wd : [recurWeekday(a)];
		if (wd.indexOf(recurWeekday(d)) < 0) return false;
		const weeks = Math.round((recurWeekStart(d) - recurWeekStart(a)) / 604800000);
		return weeks >= 0 && weeks % n === 0;
	}
	if (rule.f === 'm') {
		const months = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth());
		return months >= 0 && months % n === 0 && dayOfMonthOk();
	}
	if (rule.f === 'y') {
		const years = d.getFullYear() - a.getFullYear();
		if (years < 0 || years % n !== 0) return false;
		const mo = rule.mo && rule.mo.length ? rule.mo : [a.getMonth()];
		if (mo.indexOf(d.getMonth()) < 0) return false;
		return dayOfMonthOk();
	}
	return false;
}

/* First occurrence strictly after fromYmd. Scans forward a bounded number of
 * days, which is simpler and far harder to get wrong than closed-form maths,
 * and is instant at these horizons. Returns 0 if the rule never fires again. */
function recurNext(rule, fromYmd) {
	if (!rule || !rule.f) return 0;
	const n = Math.max(1, rule.n || 1);
	const horizon = rule.f === 'y' ? 366 * (n + 1) + 400 : rule.f === 'm' ? 31 * (n + 1) + 400 : 366 * 2;
	let d = recurYmdToDate(Math.max(fromYmd, rule.a || fromYmd));
	if (recurDateToYmd(d) <= fromYmd) d.setDate(d.getDate() + 1);
	for (let i = 0; i < horizon; i++) {
		const ymd = recurDateToYmd(d);
		if (ymd > fromYmd && recurMatches(rule, ymd)) return ymd;
		d.setDate(d.getDate() + 1);
	}
	return 0;
}

/* Human summary for the picker row, e.g. "Every 3 days", "Every week on Fri". */
const RECUR_DAYNAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const RECUR_MONTHNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RECUR_ORDNAMES = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-2': 'next to last', '-1': 'last' };
function recurLabel(rule) {
	const base = recurLabelBase(rule);
	if (!rule || !rule.f || !rule.u) return base;
	return base + ' until ' + (rule.u % 100) + ' ' + RECUR_MONTHNAMES[Math.floor(rule.u / 100) % 100 - 1] + ' ' + Math.floor(rule.u / 10000);
}
function recurLabelBase(rule) {
	if (!rule || !rule.f) return 'Never';
	if (rule.from === 'c') {
		const n2 = Math.max(1, rule.n || 1);
		const unit = { d: 'day', w: 'week', m: 'month', y: 'year' }[rule.f];
		return (n2 === 1 ? 'Every ' + unit : 'Every ' + n2 + ' ' + unit + 's') + ' after completion';
	}
	const n = Math.max(1, rule.n || 1);
	const every = (unit) => (n === 1 ? 'Every ' + unit : 'Every ' + n + ' ' + unit + 's');
	const ordPart = () => RECUR_ORDNAMES[String(rule.ord)] + ' '
		+ (typeof rule.od === 'number' ? RECUR_DAYNAMES[rule.od] : rule.od === 'weekday' ? 'weekday' : rule.od === 'weekendday' ? 'weekend day' : 'day');
	if (rule.f === 'd') return every('day');
	if (rule.f === 'w') {
		const wd = (rule.wd && rule.wd.length ? rule.wd : []).slice().sort((x, y) => x - y);
		return every('week') + (wd.length ? ' on ' + wd.map((i) => RECUR_DAYNAMES[i]).join(', ') : '');
	}
	if (rule.f === 'm') {
		if (rule.ord) return every('month') + ' on the ' + ordPart();
		const md = (rule.md && rule.md.length ? rule.md : []).slice().sort((x, y) => x - y);
		return every('month') + (md.length ? ' on the ' + md.join(', ') : '');
	}
	if (rule.f === 'y') {
		const mo = (rule.mo && rule.mo.length ? rule.mo : []).slice().sort((x, y) => x - y);
		return every('year') + (mo.length ? ' in ' + mo.map((i) => RECUR_MONTHNAMES[i]).join(', ') : '')
			+ (rule.ord ? ' on the ' + ordPart() : '');
	}
	return 'Never';
}
/* The OTHER half of the model, which Apple has no equivalent for because a
 * calendar event is never "done": count the interval from the day it was
 * actually ticked. "Var tredje dag" for the plants means three days after you
 * watered, not three days after the schedule said you should have.
 *   from:'a' (default) = schedule, the Apple behaviour
 *   from:'c'           = count from completion
 * Only the interval applies in 'c' mode; weekday and month-day selections are
 * meaningless there and are ignored. */
function recurAddInterval(ymd, f, n) {
	const d = recurYmdToDate(ymd);
	if (f === 'd') { d.setDate(d.getDate() + n); return recurDateToYmd(d); }
	if (f === 'w') { d.setDate(d.getDate() + n * 7); return recurDateToYmd(d); }
	/* months and years clamp, so the 31st and 29 Feb survive short targets */
	const day = d.getDate();
	const t = new Date(d.getFullYear() + (f === 'y' ? n : 0), d.getMonth() + (f === 'm' ? n : 0), 1);
	const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
	t.setDate(Math.min(day, last));
	return recurDateToYmd(t);
}

/* The single entry point the completion handler uses. In schedule mode the
 * floor is max(due, today) so a task ticked late lands on the next FUTURE
 * occurrence instead of dredging up the ones that were missed. An `u` (until)
 * date ends the rule: an advance landing past it returns 0, in BOTH modes. */
function recurAdvance(rule, dueYmd, todayYmd) {
	if (!rule || !rule.f) return 0;
	const n = Math.max(1, rule.n || 1);
	const next = rule.from === 'c'
		? recurAddInterval(todayYmd, rule.f, n)
		: recurNext(rule, Math.max(dueYmd || 0, todayYmd || 0));
	return rule.u && next > rule.u ? 0 : next;
}

/* Every occurrence STRICTLY AFTER fromYmd up to and including the rule's
 * until date — the forward-trail expansion set. Schedule-based rules only:
 * "counted from completion" has no future schedule to lay out (each date
 * depends on when you actually tick), so it returns []. The cap is a safety
 * net against a distant until on a daily rule; hitting it is reported by the
 * caller, not silently truncated here — the caller can compare lengths. */
function recurOccurrences(rule, fromYmd, cap) {
	if (!rule || !rule.f || !rule.u || rule.from === 'c') return [];
	const out = [];
	let cur = fromYmd || 0;
	const max = Math.max(1, cap || 100);
	while (out.length < max) {
		const next = recurNext(rule, cur);
		if (!next || next <= cur) break;
		if (next > rule.u) break;
		out.push(next);
		cur = next;
	}
	return out;
}

/* The day of occurrence #n, where the ANCHOR IS OCCURRENCE #1 — Apple's
 * "End Repeat: After n times". Schedule-based rules only (completion mode
 * cannot know future days); returns 0 when it cannot answer. */
function recurNthOccurrence(rule, anchorYmd, n) {
	if (!rule || !rule.f || rule.from === 'c' || !anchorYmd || !n || n < 1) return 0;
	let cur = anchorYmd;
	for (let i = 1; i < Math.min(n, 500); i++) {
		const next = recurNext(rule, cur);
		if (!next || next <= cur) return 0;
		cur = next;
	}
	return cur;
}

/* ==== RECURRENCE ENGINE — end ==== */

/* The DEFAULT timeblock set — Parham's day, in order. Since v0.11.0 users can
 * replace these per workspace via "Supertask: Settings" (slots
 * stored in config custom.rs_prefs + a localStorage mirror); this array is the
 * fallback when nothing is configured. Order here IS the ⌘-digit order. */
const TIMEBLOCKS = [
	{ code: 'Digit1', tag: '#earlymorning', label: 'Early Morning' },
	{ code: 'Digit2', tag: '#morning', label: 'Morning' },
	{ code: 'Digit3', tag: '#latemorning', label: 'Late Morning' },
	{ code: 'Digit4', tag: '#lunch', label: 'Lunch' },
	{ code: 'Digit5', tag: '#afternoon', label: 'Afternoon' },
	{ code: 'Digit6', tag: '#lateafternoon', label: 'Late Afternoon' },
	{ code: 'Digit7', tag: '#dinner', label: 'Dinner' },
	{ code: 'Digit8', tag: '#evening', label: 'Evening' },
	{ code: 'Digit9', tag: '#lateevening', label: 'Late Evening' },
];

const TIMEBLOCK_DEFAULT_SLOTS = TIMEBLOCKS.map((t) => ({ tag: t.tag, title: t.label }));

/* ORDER BY STATUS — the fixed collector order, per Parham's spec 2026-08-08
 * (Discuss moved before Blocked per his menu mock, 2026-08-08 pm): unflagged
 * tasks stay at the top with no heading in GROUP mode, then Starred, Alert,
 * Important, Billable, In Progress, Discuss, Blocked, and Done last with
 * Canceled under the same roof (Done on top, Canceled at the bottom inside
 * it). A collector row only exists while it has tasks. Activation is PER
 * HEADING: the mode lives as an rs_order meta property ('all' | 'done') on
 * the heading line itself, so it syncs across devices and each section
 * decides for itself — plus optional GLOBAL grouping choices in settings
 * (rs_prefs.globalBins) applied to every heading without an explicit conf. */
/* Collector rows read as "<flag icon> <status name>" — Thymer's OWN flag
 * icons (mined from the palette's set_flag_* commands), so a collector looks
 * like the status it gathers, not like a label we invented. Since v0.16.0
 * they are H5 HEADING lines (his ask), so they fold natively and read as
 * structure. */
const ORDER_BINS = [
	{ key: 'starred', label: 'Starred', icon: 'ti-star', statuses: ['starred'] },
	{ key: 'alert', label: 'Alert', icon: 'ti-alert-triangle', statuses: ['alert'] },
	{ key: 'important', label: 'Important', icon: 'ti-alert-square', statuses: ['important'] },
	{ key: 'billable', label: 'Billable', icon: 'ti-currency-dollar', statuses: ['billable'] },
	{ key: 'started', label: 'In Progress', icon: 'ti-player-play', statuses: ['started'] },
	{ key: 'discuss', label: 'Discuss', icon: 'ti-help', statuses: ['discuss'] },
	{ key: 'waiting', label: 'Blocked', icon: 'ti-player-pause', statuses: ['waiting'] },
	/* the no-status roof (his ask): SECOND TO LAST — under every status
	 * group, directly above Done (moved from first, his 2026-08-08 late
	 * call). Only meaningful alongside at least one REAL status group;
	 * binForStatus enforces that. binOrderTidy() re-seats collectors that
	 * were created under the old first-position rank. */
	{ key: 'tasks', label: 'Todo', icon: 'ti-checkbox', statuses: ['none'] }, /* was "Tasks" until 0.17.2 */
	{ key: 'done', label: 'Done', icon: 'ti-check', statuses: ['done', 'canceled'] },
];

/* The ⌃1-⌃9 STATUS SHORTCUT order (his call 2026-08-08 late) — deliberately
 * NOT the ORDER_BINS roof order: this is keyboard ergonomics (In Progress on
 * ⌃1), while the roofs keep the document order he designed. The settings
 * rows and the Shortcuts card render in THIS order. */
const STATUS_SHORTCUTS = ['started', 'important', 'alert', 'starred', 'billable', 'discuss', 'waiting', 'tasks', 'done'];

/* PLATFORM: the chords and their labels differ off the Mac. Audited against
 * the bundle's Windows/Linux keymap AND Electron's menu accelerators
 * (2026-08-09): digits 1-9 are free on Ctrl and Alt everywhere (only Ctrl+0
 * is bound, sidebar focus), Ctrl+Shift+S is free (Ctrl+S = save), but
 * Ctrl+Plus/Minus are Electron's ZOOM accelerators on PC — hence Alt for the
 * nudges there. Win/Meta is avoided entirely on PC (the OS owns it). The
 * exclusive-modifier guards double as an AltGr shield: AltGr reports
 * ctrl+alt together and matches nothing. */
const IS_MAC = /Mac|iPhone|iPad|iPod/.test((navigator.platform || '') + (navigator.userAgent || ''));
/* labels for settings, the shortcuts card and toasts */
const KEY_TAG = (n) => (IS_MAC ? '⌘' : 'Ctrl+') + n;
const KEY_STATUS = (n) => (IS_MAC ? '⌃' : 'Alt+') + n;
const KEY_BOX = IS_MAC ? '⌘⇧S' : 'Ctrl+Shift+S';
const KEY_NUDGE = IS_MAC ? '⌃+ / ⌃−' : 'Alt++ / Alt+−';


const DUE_DATE_FIELD = 'Due Date';

/* The focused item in each collection view type — same selectors as Duplicate.
 * Every view tags its focused element, so there is no need to reach into the
 * view component's internal focus state. */
const CARD_SELECTORS = [
	'.board-card.is-focused[data-guid]',
	'.gallery-view-card.is-focused[data-guid]',
	'.collection-list-card.is-focused[data-guid]',
];

/* The native command palette's surface and typography, so the date box reads as
 * a first-party popover and follows the theme. Same variable chain as the Move
 * To / Quick Capture picker. */
/* ONLY the shell. The calendar inside deliberately carries Thymer's own
 * datepicker class names so the app's global stylesheet renders it — do not
 * restyle .day / .weekday / .datepicker-* here or the two will drift apart.
 *
 * TYPE SCALE — four sizes, nothing else:
 *   11.5px                   the uppercase header only
 *   13px                     the base: every row, menu item, form field, button
 *   var(--text-size-small)   the text input only, the primary field
 *   var(--text-size-smaller) secondary chips (+ End date, the repeat value)
 * .rs-repmenu is a BODY child, so it inherits the body size, not .rs-pop's —
 * it must set the base size itself or its options render bigger than the box. */
const CSS = `
.rs-pop {
	position: fixed; z-index: 99999; width: 320px;
	background: var(--cmdpal-bg-color, var(--app-bg, #26262b));
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
	border: 1px solid rgba(127,127,127,.4);
	border-radius: var(--radius-larger, 10px);
	box-shadow: 0 16px 48px rgba(0,0,0,.5);
	overflow: hidden; font-size: 13px; padding-bottom: 2px;
}
.rs-head {
	padding: 8px 12px; border-bottom: 1px solid rgba(127,127,127,.18);
	user-select: none; font-weight: 600; opacity: .75; font-size: 11.5px;
	text-transform: uppercase; letter-spacing: .04em;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rs-input {
	width: 100%; box-sizing: border-box; border: none; outline: none;
	padding: 9px 12px; font-size: var(--text-size-small, .875rem);
	font-family: inherit; background: transparent;
	color: var(--cmdpal-fg-color, var(--text-color, #eee));
	border-bottom: 1px solid rgba(127,127,127,.18);
}
.rs-timerow {
	display: flex; align-items: center; justify-content: space-between;
	padding: 5px; line-height: 1.5;
}
.rs-timetoggle { display: flex; gap: 6px; align-items: center; }
.rs-timelbl { font-size: 13px; cursor: pointer; }
.rs-time {
	background: transparent; color: inherit; font-family: inherit;
	border: 1px solid rgba(127,127,127,.35); border-radius: 4px; padding: 1px 4px;
}
.rs-addend { cursor: pointer; font-size: var(--text-size-smaller); }
/* end-date mode is ARMED: the next day click picks the end, and the control
 * must say so — silently arming the mode looked exactly like a dead button */
.rs-addend.rs-armed {
	color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	font-weight: 600;
}
.rs-foot {
	display: flex; align-items: center; justify-content: space-between; gap: 10px;
	padding: 7px 12px; border-top: 1px solid rgba(127,127,127,.18);
	margin-top: 4px;
}
.rs-result { font-weight: 600; }
.rs-result.rs-bad { opacity: .5; font-weight: 400; }
.rs-reprow {
	display: flex; align-items: center; justify-content: space-between; gap: 10px;
	padding: 5px 7px; line-height: 1.5; cursor: pointer; border-radius: 6px;
	margin: 0 5px;
}
.rs-reprow:hover { background: rgba(127,127,127,.16); }
/* right-aligned so a long value ("Every 2 years after completion") wraps away
 * from the Repeat label instead of mashing into it */
.rs-repval { display: inline-flex; align-items: center; gap: 3px; font-size: var(--text-size-smaller); text-align: right; }
.rs-repnow {
	padding: 2px 8px; border-radius: 4px;
	border: 1px solid rgba(127,127,127,.3);
	background: var(--ed-button-bg, transparent);
}
.rs-reprow:hover .rs-repnow { background: rgba(127,127,127,.22); }
/* Never stays quiet; a real rule lights up so it reads at a glance. The accent
 * is mixed 60/40 with the theme's TEXT colour, which darkens it on light
 * themes and lightens it on dark ones — --color-primary-500 alone washed out
 * in light mode. The set chip keeps an accent-tinted background on hover too,
 * because the grey hover plate made the value harder to read. */
.rs-repnow.rs-set {
	color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	border-color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	background: color-mix(in srgb, var(--color-primary-500, #3aa37f) 12%, transparent);
	font-weight: 600;
}
.rs-reprow:hover .rs-repnow.rs-set { background: color-mix(in srgb, var(--color-primary-500, #3aa37f) 20%, transparent); }
/* fixed and parented to <body>: .rs-pop has overflow:hidden, so a menu inside
 * it gets guillotined at the edge (Parham hit exactly that) */
.rs-repmenu {
	position: fixed; z-index: 100000; min-width: 170px;
	/* a whisper off the surface so the menu never melts into it: 7% of the
	 * fg mixed into the bg = slightly lighter on dark themes, slightly
	 * darker on light ones (his call — subtle, not loud). 4px = the radius
	 * standard. */
	background: var(--rs-menu-bg, #2A2A31); /* set at load: his exact hex on dark themes, a safe mix on light */
	border: 1px solid rgba(127,127,127,.4); border-radius: 4px;
	box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 4px; overflow: hidden;
	font-size: 13px;
	/* a touch off pure fg — full white popped too hard (his call) */
	color: var(--rs-menu-fg, #D5D4D4); /* set at load: his exact hex on dark, theme fg on light */
}
.rs-repmenu div { padding: 5px 10px; border-radius: 5px; cursor: pointer; white-space: nowrap; }
.rs-repmenu > div:hover { background: rgba(127,127,127,.2); } /* DIRECT children only — nested datepicker cells must not repaint */
.rs-repmenu div.rs-on { color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor)); font-weight: 600; }
.rs-custom { padding: 8px 12px 10px; border-top: 1px solid rgba(127,127,127,.18); }
.rs-custom label { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.rs-custom label span:first-child { opacity: .6; min-width: 118px; flex: 0 0 auto; }
.rs-custom input {
	background: transparent; color: inherit; font-family: inherit; font-size: 13px;
	border: 1px solid rgba(127,127,127,.35); border-radius: 4px; padding: 3px 7px;
}
.rs-custom .rs-int { width: 52px; }
.rs-unit { color: var(--rs-menu-fg, #D5D4D4); }
.rs-custom .rs-until { width: 132px; }
.rs-until.rs-bad-date { border-color: rgba(220,90,90,.7); }
.rs-cnt {
	width: 46px; background: transparent; color: inherit; font-family: inherit; font-size: 13px;
	border: 1px solid rgba(127,127,127,.35); border-radius: 4px; padding: 1px 4px;
}
.rs-minical { width: 248px; padding: 10px 10px 14px; }
.rs-minical .datepicker-header { display: flex; align-items: center; }
.rs-mc-nav { cursor: pointer; padding: 0 6px; opacity: .55; user-select: none; }
.rs-mc-nav:hover { opacity: 1; }
.rs-custom input[type="radio"], .rs-custom input[type="checkbox"] {
	border: none; padding: 0; width: auto;
	accent-color: var(--color-primary-500, #3aa37f);
}
/* the day / month-day / month grids: multi-select toggle cells */
.rs-days, .rs-mdays, .rs-months { display: grid; gap: 3px; margin: 3px 0 5px; }
.rs-days { grid-template-columns: repeat(7, 1fr); }
.rs-mdays { grid-template-columns: repeat(7, 1fr); }
.rs-months { grid-template-columns: repeat(4, 1fr); }
.rs-cell {
	text-align: center; padding: 2px 0; border-radius: 4px; cursor: pointer;
	user-select: none; border: 1px solid rgba(127,127,127,.25);
}
.rs-cell:hover { background: rgba(127,127,127,.16); }
.rs-cell.is-on {
	color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	border-color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	background: color-mix(in srgb, var(--color-primary-500, #3aa37f) 14%, transparent);
	font-weight: 600;
}
.rs-ordrow { display: flex; gap: 6px; padding: 2px 0 4px 22px; }
/* the half of the monthly/yearly choice that is not active, greyed like Apple */
.rs-dim { opacity: .4; pointer-events: none; }
/* Plugin-drawn dropdowns replace the native <select>: the macOS menu renders
 * at the SYSTEM font size (unstylable, reported too small) and can close
 * without firing change, stranding focus outside the box — the original
 * Enter-dead bug. Our own menu keeps typography, focus and keys in-house. */
.rs-sel {
	display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
	font-size: 13px; padding: 3px 8px; border-radius: 4px; /* the 4px standard */
	border: 1px solid rgba(127,127,127,.35);
}
.rs-sel:hover { background: rgba(127,127,127,.16); }
.rs-sel .ti-chevron-down { opacity: .5; font-size: .85em; }
.rs-clear {
	cursor: pointer; font-size: 13px; white-space: nowrap;
	padding: 3px 9px; border-radius: 5px;
	border: 1px solid rgba(127,127,127,.3);
}
.rs-clear:hover { background: rgba(127,127,127,.2); }
/* ── Settings modal, on Dumb Folders' design language: centered panel on
 * cmdpal tokens, h1 + sentence-case sub, bordered rows with borderless
 * inputs, quiet 28px icon buttons. ─────────────────────────────────────── */
.rs-back {
	position: fixed; inset: 0; z-index: 99998;
	background: rgba(0, 0, 0, .38);
	display: flex; align-items: center; justify-content: center;
	padding: 24px;
}
.rs-panel {
	position: relative; z-index: 99999;
	width: min(480px, 100%); max-height: min(680px, calc(100dvh - 48px));
	overflow-y: auto;
	padding: 22px 24px 22px; border-radius: var(--radius-larger, 6px);
	background: var(--cmdpal-bg-color, var(--app-bg, #26262b));
	border: 1px solid rgba(127,127,127,.4);
	box-shadow: 0 24px 64px rgba(0,0,0,.5);
	font-size: var(--text-size-small, .875rem);
	color: var(--cmdpal-fg-color, var(--text-color, inherit));
}
.rs-panel h1 { font-size: var(--text-size-large, 1.0625rem); font-weight: 700; margin: 0 0 16px; }
/* each section in its own quiet frame — boundaries read at a glance; radius
 * 4px everywhere (his call) */
.rs-p-secbox {
	/* 20% — 12% all but vanished on light themes (his report) */
	border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
	border-radius: 4px; padding: 12px 14px;
	margin-bottom: 14px;
}
.rs-p-secbox .rs-p-sec { margin: 0; }
.rs-p-secbox .rs-p-secsub { margin: 8px 0 10px; }
.rs-p-secbox .rs-p-list { margin-bottom: 0; }
.rs-p-sub { opacity: .6; margin: 0 0 18px; font-size: var(--text-size-smaller, .8125rem); line-height: 1.5; }
.rs-p-close {
	position: absolute; top: 14px; right: 14px;
	display: flex; align-items: center; justify-content: center;
	width: 28px; height: 28px; border: 0; border-radius: var(--radius-normal, 4px);
	background: transparent; color: inherit; opacity: .5; cursor: pointer; font-size: 15px;
}
.rs-p-close:hover { opacity: 1; background: color-mix(in srgb, currentColor 14%, transparent); }
.rs-p-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.rs-p-row {
	display: flex; align-items: center; gap: 7px;
	padding: 6px 10px; border-radius: 4px;
	border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	background: color-mix(in srgb, currentColor 4%, transparent);
	min-height: 40px; box-sizing: border-box; /* checkbox rows match the
	hashtag rows' height (theirs comes from the 28px buttons) */
}
.rs-p-row:hover {
	background: color-mix(in srgb, currentColor 8%, transparent);
	border-color: color-mix(in srgb, currentColor 20%, transparent);
}
/* keycap chips — ONE look for every shortcut in the panel (his call:
 * they sat on different sides and bare ^1 read poorly) */
.rs-p-key {
	display: inline-flex; align-items: center; justify-content: center;
	min-width: 30px; padding: 1px 6px; flex: 0 0 auto;
	border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
	border-radius: 4px;
	background: color-mix(in srgb, currentColor 6%, transparent);
	font-size: var(--text-size-xsmall, .75rem); font-weight: 600; opacity: .75;
}
.rs-p-where { opacity: .45; font-size: var(--text-size-xsmall, .75rem); white-space: nowrap; }
.rs-p-editcol { display: flex; flex-direction: column; gap: 4px; }
.rs-p-editcol input {
	width: 100%; font: inherit; color: inherit; box-sizing: border-box;
	background: color-mix(in srgb, currentColor 12%, transparent);
	border: 0; border-radius: var(--radius-normal, 4px); padding: 3px 7px; outline: none;
}
.rs-p-name { flex: 1 1 auto; min-width: 0; }
.rs-p-name input {
	width: 100%; font: inherit; color: inherit; box-sizing: border-box;
	background: color-mix(in srgb, currentColor 12%, transparent);
	border: 0; border-radius: var(--radius-normal, 4px); padding: 3px 7px; outline: none;
}
.rs-p-acts { display: flex; align-items: center; flex: 0 0 auto; }
.rs-p-btn {
	display: flex; align-items: center; justify-content: center;
	width: 28px; height: 28px; border-radius: var(--radius-normal, 4px); cursor: pointer;
	border: 0; background: transparent; color: inherit; font-size: 14px; opacity: .6;
}
.rs-p-btn:hover { opacity: 1; background: color-mix(in srgb, currentColor 14%, transparent); }
.rs-p-btn.is-danger:hover { background: color-mix(in srgb, var(--enum-red-bg, #d64545) 40%, transparent); }
.rs-p-add {
	display: inline-flex; align-items: center; gap: 6px;
	height: 26px; padding: 0 8px; border: 0; border-radius: var(--radius-normal, 4px);
	background: transparent; color: inherit; cursor: pointer;
	font: inherit; font-size: var(--text-size-smaller, .8125rem); font-weight: 600; opacity: .6;
}
.rs-p-add:hover { opacity: 1; background: color-mix(in srgb, currentColor 14%, transparent); }
.rs-p-add .ti { font-size: 13px; }
.rs-p-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; }
.rs-p-save {
	border: 0; border-radius: var(--radius-normal, 4px); cursor: pointer;
	padding: 6px 16px; font: inherit; font-weight: 600;
	background: var(--ed-button-primary-bg, #4caea1);
	color: var(--ed-button-primary-fg, #101010);
}
.rs-p-save:hover { filter: brightness(1.08); }
.rs-hint { opacity: .5; font-size: var(--text-size-smaller); }
.rs-p-sec { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; }
.rs-p-sec-label {
	flex: 1 1 auto;
	font-size: var(--text-size-smaller, .8125rem); font-weight: 700;
	letter-spacing: .06em; text-transform: uppercase; opacity: .65;
}
.rs-p-sec-add {
	display: inline-flex; align-items: center; gap: 5px;
	height: 24px; padding: 0 8px; border: 0; border-radius: var(--radius-normal, 4px);
	background: transparent; color: inherit; cursor: pointer;
	font: inherit; font-size: var(--text-size-xsmall, .75rem); font-weight: 600; opacity: .6;
}
.rs-p-sec-add:hover { opacity: 1; background: color-mix(in srgb, currentColor 14%, transparent); }
.rs-p-sec-add .ti { font-size: 13px; }
.rs-p-row.is-editing { border-color: color-mix(in srgb, var(--ed-button-primary-bg, #4caea1) 60%, transparent); }
/* the Ordering status rows: labels so the whole row toggles; identical
 * .rs-p-row shell as the hashtag rows so the two sections share one voice */
.rs-p-switch { cursor: pointer; gap: 10px; }
.rs-p-switch input { accent-color: var(--ed-button-primary-bg, #4caea1); margin: 0; }
.rs-p-ic { width: 16px; flex: 0 0 auto; text-align: center; font-size: 14px; opacity: .65; }
/* foldable section headers */
.rs-p-fold { cursor: pointer; user-select: none; }
.rs-p-fold:hover .rs-p-sec-label { opacity: .8; }
.rs-p-chev { flex: 0 0 auto; font-size: 11px; opacity: .5; }
/* ── The order menu, per his mock (2026-08-08): airy rows; each status row
 * wears the SAME flag icon as its collector; an ENABLED status is accent-
 * coloured (icon + label), a disabled one plain; the active MODE row is a
 * quiet fill; no checkmarks or controls anywhere. ───────────────────────── */
/* Base text: 86% of the theme's own fg — equals his #DADADB on the dark
 * theme (dadadb ≈ 86% of white) but stays DARK on light themes, where the
 * hardcoded hex was nearly invisible (his light-mode report). The row fills
 * ride currentColor, so they self-correct too. Accent .rs-on rows override.
 * 4px radius on box AND row fills (2px too sharp, 8px/6px too round). */
.rs-ordmenu {
	min-width: 240px; padding: 6px; border-radius: 4px;
	color: color-mix(in srgb, var(--cmdpal-fg-color, var(--text-color, #dadadb)) 86%, transparent);
	/* softer lift than the repmenu default — the .5 black read harsh (his call) */
	box-shadow: 0 2px 8px rgba(0,0,0,.10), 0 8px 28px rgba(0,0,0,.16);
}
.rs-ordmenu .rs-om-row {
	display: flex; align-items: center; gap: 12px; white-space: nowrap;
	padding: 8px 13px; border-radius: 4px; font-weight: 400;
}
.rs-ordmenu .rs-om-row .rs-om-ic { width: 17px; flex: 0 0 auto; font-size: 15px; opacity: .6; text-align: center; }
.rs-ordmenu .rs-om-row.rs-om-cur {
	background: color-mix(in srgb, currentColor 13%, transparent);
	color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 70%, var(--text-color, currentColor));
}
/* the highlight SHIFTS while hovering the other mode row — without this the
 * active row's fill sat flush against the hovered row's fill (his report) */
.rs-ordmenu:has(.rs-om-row[data-m]:hover) .rs-om-row.rs-om-cur:not(:hover) { background: transparent; }
.rs-ordmenu .rs-om-row.rs-on {
	color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 70%, var(--text-color, currentColor));
}
.rs-ordmenu .rs-om-row.rs-on .rs-om-ic { opacity: .9; }
.rs-ordmenu .rs-om-sep { height: 1px; padding: 0; margin: 6px 4px; background: color-mix(in srgb, currentColor 14%, transparent); }
.rs-om-sep { height: 1px; padding: 0; margin: 6px 4px; background: color-mix(in srgb, currentColor 14%, transparent); }
/* ── The ⋯ chip next to an ordered heading (overlay layer, like Thymer's
 * own hover buttons — NEVER a node inside the line) ─────────────────────── */
.rs-ord-btn {
	/* position + z-index are set inline: absolute inside the heading's own
	 * scroll container (rides the scroll, sticky bars cover it), fixed on
	 * the body only as a fallback */
	display: flex; align-items: center; justify-content: center;
	width: 22px; height: 20px; border-radius: 4px; cursor: pointer;
	font-size: 13px; opacity: .45;
	background: color-mix(in srgb, currentColor 10%, transparent);
}
.rs-ord-btn:hover { opacity: 1; background: color-mix(in srgb, currentColor 18%, transparent); }
`;

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

class Plugin extends AppPlugin {
	onLoad() {
		this.busy = false;
		this.recurBusy = new Set();
		/* Session cache guid → rule (or null): the desktop client's in-memory
		 * state can DROP props.rs_recur right after our own writes to a line
		 * (mobile, which merely syncs, keeps it — his report). The cache
		 * overrides the state scan in refreshRepeatStyle so the glyph survives,
		 * and backs readRule so the picker cannot show "Never" for a line we
		 * KNOW carries a rule — committing from that lie would wipe the rule. */
		this.recurKnown = new Map();
		/* guid → {to, at}: the last advance we performed. Third layer of the
		 * no-double-advance defence (with the recurBusy burst guard and the
		 * status re-check): a replayed done-event whose line already sits on
		 * the date we just moved it to is a replay, not a new tick. */
		this.lastAdvance = new Map();
		/* heading guid → order conf: same transient-props insurance as recurKnown */
		this.orderKnown = new Map();
		/* bin guid → key: the writing client can transiently lose rs_sweep_bin
		 * off a collector it just created — teardown then no longer recognises
		 * it as ours and leaves it behind (his In Progress leftover) */
		this.binKnown = new Map();

		/* Preferences: timeblock slots (per-user hashtags for ⌘1–9) and the
		 * done-sweep switch. Seeded synchronously from the localStorage mirror,
		 * reconciled by rev against config custom.rs_prefs when it loads —
		 * config alone is not enough (web never round-trips custom, and a
		 * config-file deploy wipes it; see THYMER-LESSONS §2). */
		this.tbSlots = TIMEBLOCK_DEFAULT_SLOTS.slice();
		this.prefsRev = 0;
		/* GLOBAL grouping (settings): the statuses every heading without an
		 * explicit rs_order groups automatically. Empty = off (the default) —
		 * the ticked statuses ARE the switch; a separate master toggle read
		 * as "select all" and was dropped (his 0.16.3 report). */
		this.globalBins = [];
		/* PAGE RECURRENCE rules, keyed by record guid — records have no meta-
		 * property API in the sandbox (bundle-verified), so the rules live in
		 * the plugin's synced config (custom.rs_prefs.pageRules) with the
		 * localStorage mirror. Config writes happen ONLY on rule edits (they
		 * reload the plugin — the documented saveConfiguration behaviour),
		 * never on an advance: the advance derives everything from the
		 * record's live property values. Rule shape = the engine fields plus
		 * dp (date field id), sp (status field id, optional), dv (the value
		 * of sp that means done), rv (reset value; empty = clear), tr, and
		 * copies {ymd: recordGuid} for the forward-trail series. */
		this.pageRules = {};
		/* last-used field choices per collection — DEFAULTS for the pickers,
		 * never a forced wiring (his 1.2.2 verdict) */
		this.pageDefaults = {};
		this.applySlots(this.tbSlots);
		try {
			const ls = JSON.parse(localStorage.getItem('rs_prefs') || 'null');
			if (ls) this.applyPrefs(ls);
		} catch (e) {}
		this.loadPrefsFromConfig();
		this.sweepPending = new Set();
		this.sweepArrival = new Map();
		/* arrival sweeps skipped because the caret sat on the line — re-tried
		 * once the caret has moved on (see drainDeferredArrivals) */
		this.deferredArrivals = new Set();
		/* heading guid → children signature, for the state-driven arrival scan */
		this.sectionSig = new Map();
		/* EACH registration in its own try — one stale event name must not
		 * silently kill the ones after it (types.d.ts is stale in places) */
		try {
			this.recurHandler = this.events.on('lineitem.updated', (ev) => this.onLineUpdated(ev), { collection: '*' });
		} catch (e) {}
		/* ARRIVALS: a line moved or created under an ordered heading (Move To,
		 * Quick Capture, typing) fires no status-change event, so it stranded
		 * below the collectors (his report). These events are the PRECISE
		 * hook when they fire; arrivalScan() on the refresh cycle is the
		 * belt-and-braces that works even if they never do. */
		try {
			this.moveHandler = this.events.on('lineitem.moved', (ev) => {
				if (ev && ev.lineItemGuid) this.scheduleSweep(ev.lineItemGuid, true);
				this.scheduleBinGC();
			}, { collection: '*' });
		} catch (e) {}
		try {
			this.createHandler = this.events.on('lineitem.created', (ev) => {
				if (ev && ev.lineItemGuid) this.scheduleSweep(ev.lineItemGuid, true);
			}, { collection: '*' });
		} catch (e) {}
		try {
			/* DELETING a task fires neither updated nor moved — without this
			 * an emptied collector survived its last child (his report) */
			this.deleteHandler = this.events.on('lineitem.deleted', () => this.scheduleBinGC(), { collection: '*' });
		} catch (e) {}
		try {
			this.recordHandler = this.events.on('record.updated', (ev) => this.onRecordUpdated(ev).catch(() => {}), { collection: '*' });
		} catch (e) {}
		this.pop = null;

		this.style = document.createElement('style');
		this.style.textContent = CSS;
		document.head.appendChild(this.style);
		/* menu surface: his exact #2A2A31 on dark themes; on light ones a mix
		 * a touch darker than the surface (the hex would be a black slab) */
		try {
			const bg = getComputedStyle(document.body).backgroundColor;
			const m = bg && bg.match(/\d+/g);
			const lum = m ? (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) : 0;
			document.documentElement.style.setProperty('--rs-menu-bg', lum < 128
				? '#2A2A31'
				: 'color-mix(in srgb, var(--cmdpal-bg-color, #fff) 94%, var(--cmdpal-fg-color, #000))');
			document.documentElement.style.setProperty('--rs-menu-fg', lum < 128
				? '#D5D4D4'
				: 'var(--cmdpal-fg-color, var(--text-color, #333))');
		} catch (e) {}

		this.hotkeyHandler = (e) => {
			/* arrival sweeps use this to tell TYPING from a merely parked
			 * caret — see the arrival guard in sweep() */
			this.lastKeyAt = Date.now();
			const act = this.match(e);
			/* never swallow keys typed into our own box — except the ⌘⇧S toggle,
			 * which closes the box from anywhere, focus included */
			if (this.pop && this.pop.contains(e.target)) {
				if (act && act.kind === 'pick') { e.preventDefault(); e.stopPropagation(); if (this.cancelPicker) this.cancelPicker(); }
				return;
			}
			if (!act) return;
			e.preventDefault();
			e.stopPropagation();
			this.run(act);
		};
		window.addEventListener('keydown', this.hotkeyHandler, true);

		this.repStyle = document.createElement('style');
		document.head.appendChild(this.repStyle);
		this.refreshRepeatStyle();

		/* collector-row cosmetics (icon/text alignment), guid-keyed like the
		 * repeat glyph — a stylesheet, never a touched line */
		this.binStyle = document.createElement('style');
		document.head.appendChild(this.binStyle);
		this.refreshBinStyle();

		/* Rows appearing OUTSIDE lineitem.updated — a live search rendering its
		 * virtual rows, a page opening — need a repeat-style rebuild too, or the
		 * glyph never shows there. The observer only ever regenerates our own
		 * stylesheet (the doctrine forbids touching LINES, and refreshRepeatStyle
		 * no-ops when the CSS is unchanged); the filter skips the span-level
		 * mutations typing produces, so nothing runs per keystroke. */
		this.domObserver = new MutationObserver((muts) => {
			for (const m of muts) {
				/* removed rows matter too: folding a section can REMOVE its
				 * rows, and a stale ⋯ chip floated over whatever took the
				 * heading's place (his fold report). .matches works on
				 * detached nodes. */
				for (const list of [m.addedNodes, m.removedNodes]) {
					for (const n of list) {
						if (n.nodeType !== 1) continue;
						if ((n.matches && n.matches('.listitem, .tasks-view-row'))
							|| (n.querySelector && n.querySelector('.listitem, .tasks-view-row'))) {
							this.scheduleRepeatRefresh();
							return;
						}
					}
				}
			}
		});
		this.domObserver.observe(document.body, { childList: true, subtree: true });

		/* the ⋯ chips next to ordered headings: parented inside each heading's
		 * scroll container (zero scroll lag), tracked here for cleanup */
		this.orderBtns = new Map();
		this.orderScroll = () => {
			/* the chips follow the content EVERY FRAME (cached guids, measure
			 * only) — the 120ms debounce alone made the fixed-position chips
			 * visibly lag and hop during scroll (his recording) */
			if (!this.orderRaf) {
				this.orderRaf = requestAnimationFrame(() => {
					this.orderRaf = 0;
					if (!this.dead) this.refreshOrderButtons(false);
				});
			}
			if (this.orderScrollPending) return;
			this.orderScrollPending = true;
			setTimeout(() => {
				this.orderScrollPending = false;
				if (this.dead) return;
				this.refreshOrderButtons(); /* full rescan settles the tail */
				this.drainDeferredArrivals(); /* caret moves ride pointerup */
			}, 120);
		};
		window.addEventListener('scroll', this.orderScroll, true);
		window.addEventListener('resize', this.orderScroll);
		/* folding is a click, and a fold that only re-layouts (no row added or
		 * removed) escapes both the observer and scroll — reposition after any
		 * pointer release so a chip never outlives its heading's visibility */
		window.addEventListener('pointerup', this.orderScroll, true);
		this.refreshOrderButtons();

		/* once the app settles: upgrade pre-v0.16.0 text collectors to H5
		 * headings, then re-fold every Done group (it always STARTS collapsed;
		 * an unfold mid-session is respected until the next load) */
		setTimeout(() => {
			if (this.dead) return;
			const after = () => {
				if (this.dead) return;
				this.collapseDoneBins();
				this.relabelBins().catch(() => {});
				this.scheduleBinGC(); /* also re-seats collectors on rank changes */
			};
			this.upgradeBins().then(after).catch(after);
		}, 2000);

		this.cmd = this.ui.addCommandPaletteCommand({
			/* ti-calendar-clock is NOT in Thymer's Tabler subset (0 hits in
			 * appui.css) — it rendered blank; calendar-bolt exists */
			label: 'Supertask: Set a Date',
			icon: 'ti-calendar-bolt',
			onSelected: () => this.openPicker(),
		});
		this.cmd2 = this.ui.addCommandPaletteCommand({
			label: 'Supertask: Shortcuts',
			icon: 'ti-keyboard',
			onSelected: () => this.showShortcuts(),
		});
		this.cmd3 = this.ui.addCommandPaletteCommand({
			label: 'Supertask: Settings',
			icon: 'ti-tags',
			onSelected: () => this.openSettings(),
		});
		this.cmd5 = this.ui.addCommandPaletteCommand({
			label: 'Supertask: Group by Status',
			icon: 'ti-list-search',
			onSelected: () => this.toggleOrder({ m: 'g', k: ORDER_BINS.map((b) => b.key) }).catch(() => {}),
		});
		this.cmd6 = this.ui.addCommandPaletteCommand({
			label: 'Supertask: Order by Status',
			icon: 'ti-list-search',
			onSelected: () => this.toggleOrder({ m: 's', k: [] }).catch(() => {}),
		});
		this.cmd7 = this.ui.addCommandPaletteCommand({
			label: 'Supertask: Group Done Tasks',
			icon: 'ti-check',
			onSelected: () => this.toggleOrder({ m: 'g', k: ['done'] }).catch(() => {}),
		});
		this.cmd8 = this.ui.addCommandPaletteCommand({
			label: 'Supertask: Group by Hashtags',
			icon: 'ti-tag',
			/* preset built at CLICK time so it always reflects the current
			 * ⌘1-9 slots from settings */
			onSelected: () => this.toggleOrder({ m: 'h', k: (this.tbSlots || []).map((s) => s.tag).concat(['tasks', 'done']) }).catch(() => {}),
		});
	}

	onUnload() {
		this.dead = true; /* pending sweep/unsweep timers check this */
		this.closeSettings();
		this.closePicker();
		try { if (this.recurHandler) this.events.off(this.recurHandler); } catch (e) {}
		try { if (this.moveHandler) this.events.off(this.moveHandler); } catch (e) {}
		try { if (this.createHandler) this.events.off(this.createHandler); } catch (e) {}
		try { if (this.deleteHandler) this.events.off(this.deleteHandler); } catch (e) {}
		try { if (this.recordHandler) this.events.off(this.recordHandler); } catch (e) {}
		try { if (this.domObserver) this.domObserver.disconnect(); } catch (e) {}
		this.domObserver = null;
		this.recurKnown = null;
		this.lastAdvance = null;
		this.orderKnown = null;
		this.binKnown = null;
		try { if (this.repStyle) this.repStyle.remove(); } catch (e) {}
		this.repStyle = null;
		try { if (this.binStyle) this.binStyle.remove(); } catch (e) {}
		this.binStyle = null;
		if (this.hotkeyHandler) {
			window.removeEventListener('keydown', this.hotkeyHandler, true);
			this.hotkeyHandler = null;
		}
		if (this.orderScroll) {
			window.removeEventListener('scroll', this.orderScroll, true);
			window.removeEventListener('resize', this.orderScroll);
			window.removeEventListener('pointerup', this.orderScroll, true);
			this.orderScroll = null;
		}
		if (this.orderBtns) {
			for (const [, b] of this.orderBtns) { try { b.remove(); } catch (e) {} }
			this.orderBtns = null;
		}
		try { if (this.style) this.style.remove(); } catch (e) {}
		try { if (this.cmd) this.cmd.remove(); } catch (e) {}
		try { if (this.cmd2) this.cmd2.remove(); } catch (e) {}
		try { if (this.cmd3) this.cmd3.remove(); } catch (e) {}
		try { if (this.cmd5) this.cmd5.remove(); } catch (e) {}
		try { if (this.cmd6) this.cmd6.remove(); } catch (e) {}
		try { if (this.cmd7) this.cmd7.remove(); } catch (e) {}
		try { if (this.cmd8) this.cmd8.remove(); } catch (e) {}
		this.style = this.cmd = this.cmd2 = this.cmd3 = this.cmd5 = this.cmd6 = this.cmd7 = this.cmd8 = null;
	}

	// ---- key matching -------------------------------------------------------

	/* Ctrl is required and Meta must be absent, so ⌘-anything keeps its meaning.
	 * Everything matches on e.code: ⌃⇧2 reports e.key "@" on a Swedish layout and
	 * something else again elsewhere, but always e.code "Digit2". */
	match(e) {
		const code = e.code;
		/* one modifier family per JOB, exclusive guards throughout. Mac:
		 * ⌘=hashtags/box, ⌃=status/nudge. PC: Ctrl=hashtags/box, Alt=
		 * status/nudge (Ctrl+± is Electron zoom there, and Win/Meta belongs
		 * to the OS). Digits and S match on e.code so keyboard layout is
		 * irrelevant; the nudges match the CHARACTER (+/=/-/_) because on
		 * Swedish Pro those caps sit elsewhere than on US. Same chord again
		 * clears (hashtags and statuses alike). */
		const tagMod = IS_MAC
			? (e.metaKey && !e.ctrlKey && !e.altKey)
			: (e.ctrlKey && !e.metaKey && !e.altKey);
		const statusMod = IS_MAC
			? (e.ctrlKey && !e.metaKey && !e.altKey)
			: (e.altKey && !e.metaKey && !e.ctrlKey);

		if (tagMod && !e.shiftKey) {
			const tb = (this.timeblocks || TIMEBLOCKS).find((t) => t.code === code);
			if (tb) return { kind: 'timeblock', tb };
		}
		if (tagMod && e.shiftKey && code === 'KeyS') return { kind: 'pick' };

		if (!statusMod) return null;
		if (!e.shiftKey && /^Digit[1-9]$/.test(code)) {
			const key = STATUS_SHORTCUTS[+code.slice(5) - 1];
			const b = key && ORDER_BINS.find((x) => x.key === key);
			if (b) return { kind: 'status', status: b.key === 'tasks' ? 'none' : b.statuses[0], label: b.label };
		}
		/* '?' is deliberately NOT accepted — on Swedish Pro that is Shift on
		 * the + key, and ⌃⇧? is Thymer's own fold shortcut */
		const k = e.key;
		if (k === '+' || k === '=') return { kind: 'shift', days: 1 };
		if (k === '-' || k === '_') return { kind: 'shift', days: -1 };
		return null;
	}

	async run(act) {
		/* ⌘⇧S toggles: open when closed, cancel (with the caret put back) when open */
		if (act.kind === 'pick') return this.pop ? (this.cancelPicker && this.cancelPicker()) : this.openPicker();
		if (this.busy) return;
		this.busy = true;
		try {
			if (act.kind === 'timeblock') await this.setTimeblock(act.tb);
			else if (act.kind === 'shift') await this.shift(act.days);
			else if (act.kind === 'status') await this.setStatus(act);
		} catch (e) {
			this.toast('Failed: ' + ((e && e.message) || e));
		} finally {
			this.busy = false;
		}
	}

	/* ⌃digit: set the caret line's task status. Same status again clears it
	 * (the timeblock toggle idiom, flagged as my call); Todo (⌃8) is an
	 * explicit clear. The write fires the normal status event, so recurrence
	 * advance and the ordering sweeps run exactly as if the status was set
	 * by hand. Works on virtual live-search rows via editorSelection's remap. */
	async setStatus(act) {
		const line = this.lineSelection();
		if (!line || !line.lineGuid || !line.pageGuid) { this.toast('Put the caret on a task line first.'); return; }
		const pl = await this.pageLines(line.pageGuid);
		const li = pl && pl.byG.get(line.lineGuid);
		if (!li) { this.toast('Could not read that line.'); return; }
		let cur = null;
		try { cur = await li.getTaskStatus(); } catch (e) {}
		const next = (act.status !== 'none' && cur === act.status) ? 'none' : act.status;
		let ok = false;
		try { ok = await li.setTaskStatus(next); } catch (e) {}
		if (!ok) { this.toast('That line does not take a task status.'); return; }
		this.toast(next === 'none' ? 'Status cleared' : act.label);
	}

	// ---- preferences: timeblock slots + sweep switch ------------------------

	/* An ordered list of {tag, title}; POSITION = the ⌘digit (max 9). The
	 * TITLE is what the UI shows (rows, toasts, the shortcuts card); the tag
	 * is what lands on the line. Older prefs stored bare strings or
	 * {tag,label} — both migrate on read. */
	applySlots(slots) {
		if (!Array.isArray(slots)) return;
		const out = [];
		for (const sIn of slots) {
			if (out.length >= 9) break;
			let tag = '';
			let title = '';
			if (typeof sIn === 'string') tag = sIn;
			else if (sIn) { tag = sIn.tag || ''; title = String(sIn.title || sIn.label || '').trim(); }
			tag = String(tag).trim().replace(/\s+/g, '');
			if (!tag) continue;
			if (tag[0] !== '#') tag = '#' + tag;
			if (tag.length > 1 && !out.some((x) => x.tag === tag)) out.push({ tag, title });
		}
		this.tbSlots = out;
		this.timeblocks = out.map((s2, i) => ({ code: 'Digit' + (i + 1), tag: s2.tag, label: s2.title || s2.tag.slice(1) }));
		this.timeblockTags = new Set(out.map((s2) => s2.tag));
	}

	applyPrefs(p) {
		if (!p) return;
		if (Array.isArray(p.slots)) this.applySlots(p.slots);
		/* older prefs carried a `sweep` field — obsolete since ordering moved
		 * to per-heading rs_order meta; ignored on read */
		if (Array.isArray(p.globalBins)) {
			this.globalBins = p.globalBins.filter((k) => ORDER_BINS.some((b) => b.key === k));
		}
		if (p.pageRules && typeof p.pageRules === 'object') this.pageRules = p.pageRules;
		if (p.pageDefaults && typeof p.pageDefaults === 'object') this.pageDefaults = p.pageDefaults;
		/* legacy master switch (v0.16.2/0.16.3): off meant off regardless of
		 * the stored choices; on with no stored choices meant Done only */
		if (p.doneGlobal === false) this.globalBins = [];
		else if (p.doneGlobal === true && !Array.isArray(p.globalBins)) this.globalBins = ['done'];
		this.prefsRev = Math.max(this.prefsRev || 0, p.rev || 0);
	}

	async loadPrefsFromConfig() {
		try {
			const all = await this.data.getAllGlobalPlugins();
			const me = (all || []).find((g) => g && g.getGuid && g.getGuid() === this.getGuid());
			this.selfPluginApi = me || null;
			const conf = me && me.getConfiguration && me.getConfiguration();
			const p = conf && conf.custom && conf.custom.rs_prefs;
			if (p && (p.rev || 0) > (this.prefsRev || 0)) this.applyPrefs(p);
		} catch (e) {}
	}

	/* localStorage first (survives config clobbers and the web read gap), then
	 * write-through to config for other devices. NOTE: saveConfiguration
	 * reloads the plugin, so this is always the LAST thing an interaction does. */
	async savePrefs() {
		const p = { rev: Date.now(), slots: this.tbSlots, globalBins: (this.globalBins || []).slice(), pageRules: this.pageRules || {}, pageDefaults: this.pageDefaults || {} };
		this.prefsRev = p.rev;
		try { localStorage.setItem('rs_prefs', JSON.stringify(p)); } catch (e) {}
		try {
			if (!this.selfPluginApi) await this.loadPrefsFromConfig();
			const me = this.selfPluginApi;
			if (me) {
				const conf = me.getConfiguration();
				conf.custom = conf.custom || {};
				conf.custom.rs_prefs = p;
				await me.saveConfiguration(conf);
			}
		} catch (e) {}
	}

	/* Every hashtag currently loaded in the workspace, for the tag picker. */
	knownHashtags() {
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const out = new Set();
		for (const g in byGuid) {
			const st = byGuid[g];
			if (!st || st.is_trashed || st.is_deleted) continue;
			const ts = st.text_segments || [];
			for (let i = 0; i + 1 < ts.length; i += 2) {
				if (String(ts[i]) === 'hashtag' && typeof ts[i + 1] === 'string' && ts[i + 1].length > 1) out.add(ts[i + 1]);
			}
		}
		return Array.from(out).sort();
	}

	/* The settings modal: plain DOM on the box's tokens, no native selects, no
	 * panel (edits things already on screen — Parham's rule). Two sections:
	 * timeblock rows (position = ⌘digit, search-picker over the workspace's
	 * REAL hashtags, + Add, ✕ remove) and the sweep (enable switch + status
	 * GROUPS: each group = one collector heading + the statuses it gathers,
	 * so Done+Canceled or Important+In Progress can share a roof). The modal
	 * edits a DRAFT; nothing applies until Save. */
	openSettings() {
		this.closeSettings();
		const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
		const draft = { slots: this.tbSlots.slice() };
		const back = document.createElement('div');
		back.className = 'rs-back';
		const panel = document.createElement('div');
		panel.className = 'rs-panel';
		back.appendChild(panel);
		document.body.appendChild(back);
		this.settingsEls = [back];

		/* Dumb Folders' interaction model: rows are DISPLAY by default (the tag
		 * as the row's name), the pencil flips one row into edit mode, the
		 * trash removes, "+ New" in the section header adds a row in edit
		 * mode. Changes apply LIVE; the config write happens ON CLOSE, because
		 * saveConfiguration reloads the plugin and must be the last act. */
		let editIdx = -1;
		let dirty = false;

		const commitEdit = () => {
			const inp = panel.querySelector('.rs-tb-tag');
			if (!inp) { editIdx = -1; return; }
			const i = +inp.getAttribute('data-i');
			const tag = inp.value.trim();
			const titleInp = panel.querySelector('.rs-tb-title');
			const title = titleInp ? titleInp.value.trim() : '';
			if (tag) draft.slots[i] = { tag, title };
			else draft.slots.splice(i, 1);
			dirty = true;
			editIdx = -1;
			this.applySlots(draft.slots);
			draft.slots = this.tbSlots.slice(); /* read back sanitized */
		};

		/* both sections ALWAYS start collapsed (his call) — fold state lives
		 * only for the life of the open modal, nothing persisted */
		const fold = { ordering: true, hashtags: true };
		const sec = (id, label, extra) =>
			'<div class="rs-p-sec rs-p-fold" data-sec="' + id + '">'
			+ '<span class="rs-p-chev ti ' + (fold[id] ? 'ti-chevron-right' : 'ti-chevron-down') + '"></span>'
			+ '<span class="rs-p-sec-label">' + label + '</span>' + (extra || '') + '</div>';
		const render = () => {
			/* a folded section is just its header inside the frame; unfolded
			 * = header + description + rows. Each section wears its own frame
			 * (.rs-p-secbox) so the boundaries read at a glance (his ask). */
			const orderingBody = fold.ordering ? '' :
				'<p class="rs-p-sub rs-p-secsub">Ticked statuses are grouped under every heading as tasks change; '
				+ 'the Done group starts collapsed. Nothing ticked turns it off, and a section’s ⋯ menu always overrides it. '
				+ 'The ' + KEY_STATUS(1) + ' to ' + KEY_STATUS(9) + ' shortcuts set a line’s status anywhere, ticked or not; the same chord again clears it.</p>'
				+ '<div class="rs-p-list">'
				+ STATUS_SHORTCUTS.map((key, i) => {
					const b = ORDER_BINS.find((x) => x.key === key);
					if (!b) return '';
					const on = (this.globalBins || []).indexOf(b.key) >= 0;
					return '<label class="rs-p-row rs-p-switch"><span class="rs-p-key">' + KEY_STATUS(i + 1) + '</span>'
						+ '<input type="checkbox" class="rs-gb" data-k="' + b.key + '"' + (on ? ' checked' : '') + '>'
						+ '<span class="rs-p-ic ti ' + b.icon + '"></span>'
						+ '<span class="rs-p-name">' + b.label + '</span></label>';
				}).join('')
				+ '</div>';
			panel.innerHTML = '<button type="button" class="rs-p-close ti ti-x"></button>'
				+ '<h1>Supertask Settings</h1>'
				+ '<div class="rs-p-secbox">' + sec('ordering', 'Task Status Settings') + orderingBody + '</div>'
				+ '<div class="rs-p-secbox">'
				+ sec('hashtags', 'Hashtags Settings',
					(!fold.hashtags && draft.slots.length < 9 ? '<button type="button" class="rs-p-sec-add rs-tb-add"><span class="ti ti-plus"></span>New</button>' : ''))
				+ (fold.hashtags ? '' :
					'<p class="rs-p-sub rs-p-secsub">' + KEY_TAG(1) + ' to ' + KEY_TAG(9) + ' tag the current line; the row is the key. '
					+ 'Use anything your flow sorts by: timeblocks, priorities, statuses.</p>'
					+ '<div class="rs-p-list">'
				+ draft.slots.map((slot, i) => {
					const so = typeof slot === 'string' ? { tag: slot, title: '' } : (slot || { tag: '', title: '' });
					return i === editIdx
						? '<div class="rs-p-row is-editing"><span class="rs-p-key">' + KEY_TAG(i + 1) + '</span>'
							+ '<span class="rs-p-name rs-p-editcol">'
							+ '<input class="rs-tb-title" spellcheck="false" placeholder="Title (shown in the UI)" value="' + esc(so.title) + '">'
							+ '<input class="rs-tb-tag" data-i="' + i + '" spellcheck="false" placeholder="#hashtag" value="' + esc(so.tag) + '">'
							+ '</span>'
							+ '<span class="rs-p-acts"><button type="button" class="rs-p-btn rs-tb-ok ti ti-check"></button></span></div>'
						: '<div class="rs-p-row"><span class="rs-p-key">' + KEY_TAG(i + 1) + '</span>'
							+ '<span class="rs-p-name">' + esc(so.title || so.tag) + '</span>'
							+ (so.title ? '<span class="rs-p-where">' + esc(so.tag) + '</span>' : '')
							+ '<span class="rs-p-acts">'
							+ '<button type="button" class="rs-p-btn rs-tb-edit ti ti-pencil" data-i="' + i + '"></button>'
							+ '<button type="button" class="rs-p-btn is-danger rs-tb-x ti ti-trash" data-i="' + i + '"></button>'
							+ '</span></div>';
				}).join('')
				+ '</div>')
				+ '</div>'
				+ '<p class="rs-p-sub" style="margin:12px 0 0">Saved when this window closes.</p>';
			const inp = panel.querySelector('.rs-tb-tag');
			if (inp) { inp.focus({ preventScroll: true }); inp.select(); }
		};

		const suggest = (inp) => {
			const q = inp.value.replace(/^#/, '').toLowerCase();
			const items = this.knownHashtags()
				.filter((t) => !q || t.toLowerCase().indexOf(q) >= 0)
				.slice(0, 10)
				.map((t) => [t, t]);
			if (!items.length) { document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove()); this.repMenu = null; return; }
			this.openSelMenu(inp, items, inp.value, (v) => { inp.value = v; commitEdit(); render(); });
		};

		panel.addEventListener('input', (e) => {
			if (e.target.classList && e.target.classList.contains('rs-tb-tag')) suggest(e.target);
		});
		panel.addEventListener('change', (e) => {
			const cl = e.target.classList;
			if (cl && cl.contains('rs-gb')) {
				const key = e.target.getAttribute('data-k');
				const cur = (this.globalBins || []).slice();
				this.globalBins = e.target.checked
					? (cur.indexOf(key) >= 0 ? cur : cur.concat([key]))
					: cur.filter((x) => x !== key);
				dirty = true;
			}
		});
		panel.addEventListener('click', (e) => {
			const t = e.target.closest ? e.target.closest('button') : null;
			if (!t) {
				const h = e.target.closest ? e.target.closest('.rs-p-fold') : null;
				if (h) {
					const id = h.getAttribute('data-sec');
					fold[id] = !fold[id];
					if (editIdx >= 0) commitEdit();
					render();
				}
				return;
			}
			if (t.classList.contains('rs-tb-add')) {
				if (editIdx >= 0) commitEdit();
				if (draft.slots.length < 9) { draft.slots.push({ tag: '', title: '' }); editIdx = draft.slots.length - 1; }
				render();
			} else if (t.classList.contains('rs-tb-edit')) {
				if (editIdx >= 0) commitEdit();
				editIdx = +t.getAttribute('data-i');
				render();
			} else if (t.classList.contains('rs-tb-ok')) {
				commitEdit();
				render();
			} else if (t.classList.contains('rs-tb-x')) {
				if (editIdx >= 0) commitEdit();
				draft.slots.splice(+t.getAttribute('data-i'), 1);
				dirty = true;
				this.applySlots(draft.slots);
				draft.slots = this.tbSlots.slice();
				render();
			} else if (t.classList.contains('rs-p-close')) {
				this.closeSettings();
			}
		});

		/* the close-time persist: slots are already live via applySlots */
		this.settingsSave = () => {
			if (editIdx >= 0) commitEdit();
			if (!dirty) return;
			this.toast('Settings saved');
			this.savePrefs(); /* last — saveConfiguration reloads the plugin */
		};

		back.addEventListener('pointerdown', (e) => { if (e.target === back) this.closeSettings(); });
		this.settingsKeys = (e) => {
			if (!this.settingsEls) return;
			if (e.key === 'Escape') {
				e.preventDefault(); e.stopPropagation();
				if (editIdx >= 0) { commitEdit(); render(); return; } /* first Esc just leaves edit mode */
				this.closeSettings();
			} else if (e.key === 'Enter') {
				e.preventDefault(); e.stopPropagation();
				if (editIdx >= 0) { commitEdit(); render(); }
			}
		};
		window.addEventListener('keydown', this.settingsKeys, true);
		render();
	}

	closeSettings() {
		const pendingSave = this.settingsEls ? this.settingsSave : null;
		if (this.settingsKeys) { window.removeEventListener('keydown', this.settingsKeys, true); this.settingsKeys = null; }
		if (this.settingsEls) { for (const el of this.settingsEls) { try { el.remove(); } catch (e) {} } this.settingsEls = null; }
		document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
		this.repMenu = null;
		this.settingsSave = null;
		if (pendingSave) { try { pendingSave(); } catch (e) {} }
	}

	// ---- reading what the caret is on ---------------------------------------

	activePanelEl() {
		try {
			const p = this.ui.getActivePanel();
			const el = p && p.getElement && p.getElement();
			if (el) return el.closest('.panel') || el;
		} catch (e) {}
		return null;
	}

	focusedViewRecord(panel) {
		if (!panel) return null;
		const cell = panel.querySelector('.table-view-cell.is-focused');
		if (cell) {
			if (cell.classList.contains('is-editing')) return { err: 'editing' };
			const row = cell.closest('.table-view-row[data-guid]');
			if (row) return { guid: row.getAttribute('data-guid') };
		}
		for (const sel of CARD_SELECTORS) {
			const el = panel.querySelector(sel);
			if (!el) continue;
			if (el.classList.contains('is-title-editing')) return { err: 'editing' };
			return { guid: el.getAttribute('data-guid') };
		}
		return null;
	}

	/* The live editor selection, read from the global listview registry — there
	 * is no SDK selection API. state.text_segments is pair-encoded:
	 * [type, data, type, data, …]. */
	editorSelection() {
		const lv = this.activeListview();
		const sel = lv && lv.selection;
		const caret = sel && sel._caret && sel._caret.pos;
		if (!caret || !caret.list_item || !caret.list_item.state) return null;
		let st = caret.list_item.state;

		/* A row inside a LIVE SEARCH is not the line it appears to be. Query
		 * results render as VIRTUAL rows: an ephemeral V-guid that is absent from
		 * itemsByGuid, `rguid` null, EMPTY text_segments, and `props.itemref`
		 * holding the guid of the REAL line. Read the virtual row directly and
		 * every command sees a blank line on no page and quietly does nothing —
		 * which is exactly how this behaved in Parham's GTD views. Remap first,
		 * then all the rest of the plugin works there unchanged. */
		/* The guid of the row as RENDERED. In a live search that is the virtual
		 * row's V-guid, not the real line's, and it is the only one that exists
		 * in the DOM where the user is looking — caret placement has to use it. */
		const domGuid = st.guid;

		/* The SAME remap covers EMBEDS: a transclusion / block-ref line is a
		 * REAL line (not virtual) with empty segments and props.itemref
		 * pointing at the target. Without it, commands acted on the
		 * transclusion line itself — the picker opened but its write landed in
		 * a line that renders no text (his report), and ⌃+/− built a date
		 * there too. The empty-segments check keeps ordinary lines (which
		 * never carry itemref) out of the remap even if that ever changes. */
		if (st.props && st.props.itemref && (st.is_virtual || !(st.text_segments || []).length)) {
			const target = st.props.itemref;
			/* A live search returns PAGES as well as lines, and a page row's
			 * itemref is a RECORD guid. Ask the data layer which it is. An earlier
			 * version tested "is it absent from itemsByGuid?" and that is WRONG —
			 * record guids ARE in that map (verified live), so page results were
			 * silently treated as lines and every command did nothing. */
			if (this.data.getRecord(target)) {
				return { segments: [], lineGuid: null, pageGuid: null, recordGuid: target, domGuid };
			}
			const real = ((window.g_universe && window.g_universe.itemsByGuid) || {})[target];
			if (!real) return null;
			st = real;
		}

		const ts = st.text_segments || [];
		const segments = [];
		for (let i = 0; i + 1 < ts.length; i += 2) segments.push({ type: String(ts[i]), text: ts[i + 1] });
		/* props carries our own rs_recur meta, so the picker can show the repeat
		 * rule that is already on the line instead of always saying Never */
		return { segments, lineGuid: st.guid, pageGuid: st.rguid, domGuid, props: st.props || null };
	}

	/* The focused (or selected) row in Thymer's TASKS VIEW — a first-class
	 * surface for every command since v1.3.0 (his ask: some users live
	 * there). Rows carry the LINE guid directly; there is no editor caret,
	 * so noCaret tells every write path to skip caret work. */
	tasksViewSelection() {
		let el = document.activeElement instanceof HTMLElement
			? document.activeElement.closest('.tasks-view-row[data-guid]') : null;
		if (!el) el = document.querySelector('.tasks-view-row.is-selected[data-guid]');
		if (!el) return null;
		const guid = el.getAttribute('data-guid');
		const st = ((window.g_universe && window.g_universe.itemsByGuid) || {})[guid];
		if (!st || !st.rguid) return null;
		const ts = st.text_segments || [];
		const segments = [];
		for (let i = 0; i + 1 < ts.length; i += 2) segments.push({ type: String(ts[i]), text: ts[i + 1] });
		return { segments, lineGuid: st.guid, pageGuid: st.rguid, domGuid: st.guid, props: st.props || null, noCaret: true };
	}

	/* editor caret first, tasks-view row second — the shared line resolver */
	lineSelection() {
		return this.editorSelection() || this.tasksViewSelection();
	}

	/* Which date a command should act on. See the header for the order. */
	dateTarget() {
		const view = this.focusedViewRecord(this.activePanelEl());
		if (view) {
			if (view.err === 'editing') return { err: 'Finish editing that cell first.' };
			return { kind: 'record', guid: view.guid };
		}
		const line = this.lineSelection();
		if (!line) return null;
		/* a page returned by a live search: its Due Date is the only date there is */
		if (line.recordGuid) {
			return this.data.getRecord(line.recordGuid) ? { kind: 'record', guid: line.recordGuid, domGuid: line.domGuid } : null;
		}
		if (!line.lineGuid || !line.pageGuid) return null;

		const segs = line.segments || [];
		if (segs.some((s) => s.type === 'datetime')) {
			line.caret = this.captureCaret(line.domGuid || line.lineGuid);
			return { kind: 'line', line };
		}

		/* A lone page reference is the GTD result row: act on the PAGE's Due
		 * Date. Anything else on the line and it is a todo in its own right.
		 * domGuid rides along so the picker can anchor to the rendered row. */
		const refs = segs.filter((s) => s.type === 'ref');
		const other = segs.filter((s) => s.type !== 'ref'
			&& !(typeof s.text === 'string' && s.text.trim() === ''));
		if (refs.length === 1 && !other.length) {
			const guid = refs[0].text && refs[0].text.guid;
			if (guid && this.data.getRecord(guid)) return { kind: 'record', guid, domGuid: line.domGuid || line.lineGuid };
		}
		line.caret = this.captureCaret(line.domGuid || line.lineGuid);
		return { kind: 'line', line };
	}

	targetLabel(t) {
		if (!t || t.err) return '';
		if (t.kind === 'record') {
			const rec = this.data.getRecord(t.guid);
			return DUE_DATE_FIELD + ' · ' + ((rec && rec.getName()) || 'page');
		}
		return 'Date on this line';
	}

	/* Which listview the caret is in. hasFocus() is the honest answer but it goes
	 * false whenever the window itself is not focused, and with a split view
	 * open, falling straight through to listviews[0] silently edits the OTHER
	 * panel's line. So containment in the active panel is the second test, and a
	 * listview with no caret position at all is never chosen over one that has
	 * one. */
	activeListview() {
		const lvs = (window.g_universe && window.g_universe.listviews) || [];
		if (!lvs.length) return null;
		const hasCaret = (v) => {
			try { return !!(v.selection && v.selection._caret && v.selection._caret.pos && v.selection._caret.pos.list_item); } catch (e) { return false; }
		};
		for (const v of lvs) {
			try { if (v.hasFocus && v.hasFocus() && hasCaret(v)) return v; } catch (e) {}
		}
		const panel = this.activePanelEl();
		if (panel) {
			for (const v of lvs) {
				try { if (v.$container && panel.contains(v.$container) && hasCaret(v)) return v; } catch (e) {}
			}
		}
		return lvs.find(hasCaret) || null;
	}

	/* The page's record (with the future-journal fallback) plus its line items
	 * and a guid lookup — shared by lineItem() and the done sweep. */
	async pageLines(pageGuid) {
		let rec = this.data.getRecord(pageGuid);
		if (!rec) rec = await this.journalRecord(pageGuid);
		if (!rec) return null;
		try {
			const all = await rec.getLineItems(false);
			return { rec, all, byG: new Map(all.map((x) => [x.guid, x])) };
		} catch (e) { return null; }
	}

	async lineItem(line) {
		const pl = await this.pageLines(line.pageGuid);
		return (pl && pl.byG.get(line.lineGuid)) || null;
	}

	/* A journal day that has not MATERIALIZED yet (tomorrow and later) has a
	 * SYNTHETIC page guid — S-<collectionGuid>-P…-YYYYMMDD — that
	 * data.getRecord() cannot resolve, so every command on such a page died
	 * with "Could not read that line" (his report, on tomorrow's journal).
	 * getJournalRecord() is the way in. Ported from Move To, including its
	 * hard-won detail: the user ref MUST carry the USER guid — passing the
	 * collection guid silently creates a parallel duplicate journal page. */
	async journalRecord(pageGuid) {
		const m = /^S-([A-Z0-9]+)-.+-(\d{8})$/.exec(pageGuid || '');
		if (!m) return null;
		try {
			const cols = await this.data.getAllCollections();
			const journals = (cols || []).filter((c) => { try { return c.isJournalPlugin && c.isJournalPlugin(); } catch (e) { return false; } });
			const col = journals.find((c) => c.guid === m[1]) || journals[0];
			if (!col) return null;
			let userGuid = null;
			try { userGuid = (window.g_universe && window.g_universe.userId) || null; } catch (e) {}
			if (!userGuid) {
				try {
					const us = await this.data.getActiveUsers();
					const self = (us || []).find((u) => u && (u.is_self || (u._getRow && u._getRow().is_self))) || (us || [])[0];
					userGuid = self && (self.guid || (self._getRow && self._getRow().guid));
				} catch (e) {}
			}
			if (!userGuid) return null;
			const wsGuid = (window.g_universe && window.g_universe.workspaceGuid) || null;
			const y = +m[2].slice(0, 4);
			const mo = +m[2].slice(4, 6) - 1;
			const d = +m[2].slice(6, 8);
			return await col.getJournalRecord({ workspaceGuid: wsGuid, guid: userGuid }, DateTime.dateOnly(y, mo, d));
		} catch (e) { return null; }
	}

	// ---- date maths ---------------------------------------------------------

	/* Shift a DateTimeValue by N days, keeping everything else: a date-only tag
	 * stays date-only, a timed one keeps its time, a range keeps its length.
	 * Rebuilding from getParts() rather than from toDate() is what preserves the
	 * date-only/date+time distinction (verified: date-only round-trips to
	 * {d:"YYYYMMDD"}, timed to {d,t:{t,tz}}). */
	shiftValue(value, days) {
		const dt = new DateTime(value);
		const out = this.shiftParts(dt, days);
		if (!out) return null;
		const end = dt.getRangeEnd();
		if (end) {
			const shiftedEnd = this.shiftParts(end, days);
			if (shiftedEnd) out.setRangeEnd(shiftedEnd);
		}
		return out;
	}

	shiftParts(dt, days) {
		const p = dt.getParts();
		if (p.year === undefined) return null; // time-only tag: nothing to move
		const d = new Date(p.year, p.month, p.day);
		d.setDate(d.getDate() + days);
		if (p.hours === undefined) return DateTime.dateOnly(d.getFullYear(), d.getMonth(), d.getDate());
		return DateTime.dateAndTime(d.getFullYear(), d.getMonth(), d.getDate(), p.hours, p.minutes || 0, p.seconds || 0);
	}

	fromToday(days) {
		const d = new Date();
		d.setDate(d.getDate() + days);
		return DateTime.dateOnly(d.getFullYear(), d.getMonth(), d.getDate());
	}

	/* Show the year whenever it is not the current one. Thymer's parser rolls a
	 * bare "Aug 5" forward to NEXT year once that day has passed, so without this
	 * the preview reads "Thu 5 Aug" for a date twelve months out. */
	label(dt) {
		const d = dt.toDate();
		const parts = dt.getParts();
		const opts = { weekday: 'short', month: 'short', day: 'numeric' };
		if (parts.year !== undefined && parts.year !== new Date().getFullYear()) opts.year = 'numeric';
		const day = d.toLocaleDateString(undefined, opts);
		if (parts.hours === undefined) return day;
		return day + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	// ---- reading and writing a target ---------------------------------------

	currentDate(t) {
		if (t.kind === 'record') {
			const rec = this.data.getRecord(t.guid);
			const prop = rec && rec.prop(DUE_DATE_FIELD);
			return prop ? prop.datetime() : null;
		}
		const seg = (t.line.segments || []).find((s) => s.type === 'datetime');
		return seg ? new DateTime(seg.text) : null;
	}

	async writeDate(t, dt) {
		if (t.kind === 'record') {
			const rec = this.data.getRecord(t.guid);
			if (!rec) { this.toast('Could not read that page.'); return false; }
			const ctx = t.pageCtx || {};
			const dpId = ctx.dp || DUE_DATE_FIELD;
			const prop = rec.prop(dpId);
			if (!prop) { this.toast('“' + (rec.getName() || 'That page') + '” has no ' + (ctx.dpl || dpId) + ' field.'); return false; }
			prop.set(dt.value());
			this.toast((rec.getName() || 'Page') + ' → ' + this.label(dt));
			/* the RULE rides in pageRules (synced config). savePrefs is the
			 * LAST act — saveConfiguration reloads the plugin. */
			if (t.ruleTouched) {
				t.ruleTouched = false;
				const rp = dt.getParts();
				const ymd = rp.year * 10000 + (rp.month + 1) * 100 + rp.day;
				const prev = this.pageRules[t.guid];
				if (t.pendingRule) {
					const rule = {
						...this.finalizeRule(t.pendingRule, ymd), dp: dpId,
						sp: ctx.sp || null, dv: ctx.dv || null, dvl: ctx.dvl || null,
						rv: ctx.rv || null, rvl: ctx.rvl || null,
						copies: (prev && prev.copies) || {},
					};
					this.pageRules[t.guid] = rule;
					if (t.collGuid) {
						this.pageDefaults[t.collGuid] = { dp: dpId, sp: rule.sp, dv: rule.dv, dvl: rule.dvl, rv: rule.rv, rvl: rule.rvl };
					}
					if (rule.tr === 'f' && !rule.u) this.toast('Forward trail needs an End repeat date — no copies laid out yet.');
					else if (!rule.sp) this.toast('No “Done when” field picked — nothing can advance this repeat; it only lays out copies.');
					try { await this.reconcilePageSeries(rec, rule); } catch (e) {}
					this.toast(recurLabel(rule) + ' on ' + (rec.getName() || 'page'));
					await this.savePrefs();
				} else if (prev) {
					try { await this.reconcilePageSeries(rec, { ...prev, tr: null }); } catch (e) {}
					delete this.pageRules[t.guid];
					this.toast('Repeat removed');
					await this.savePrefs();
				}
			}
			return true;
		}

		const li = await this.lineItem(t.line);
		if (!li) { this.toast('Could not read that line.'); return false; }
		const segs = li.segments.map((s) => ({ type: s.type, text: s.text }));
		const i = segs.findIndex((s) => s.type === 'datetime');

		/* Moving the caret is only ever right when we CREATE the date. If the line
		 * already had one, the caret is wherever Parham deliberately put it — very
		 * often at the end of the line, past the hashtags — and yanking it back to
		 * the date defeats the point of a keyboard shortcut. Only reposition on a
		 * fresh insert, and then only if the date ends up last; when a hashtag
		 * follows, go to the end of the line so typing carries on naturally. */
		let move = null;
		if (i >= 0) {
			segs[i] = { type: 'datetime', text: dt.value() };
			if (i === segs.length - 1) segs.push({ type: 'text', text: ' ' });
		} else {
			const at = this.insertDate(segs, dt);
			const trailing = segs.slice(at + 1).some((sg) => sg.type !== 'text' || (sg.text || '').trim());
			move = trailing ? 'eol' : 'datetime';
		}

		/* Write the RULE FIRST, then the segments. Both land on the same line, and
		 * doing it the other way round meant two renders back to back: the second
		 * one arrived after the caret had been placed, so it wiped the placement
		 * and could leave the date chip drawn without its styling. The segments
		 * must be the LAST write, so the render that settles is the one the caret
		 * work then runs against. The rule is anchored on the date being
		 * committed, which is what gives "every 2 weeks" a stable phase. */
		let seriesRule; /* reconciled AFTER the segment write settles */
		let seriesOrigin = null; /* rule edits made FROM a copy apply to the series */
		if (t.ruleTouched) {
			const rp = dt.getParts();
			const sid = t.line.props && t.line.props.rs_series;
			if (sid) {
				const plS = await this.pageLines(t.line.pageGuid);
				const origLi = plS && plS.byG.get(sid);
				if (origLi) {
					const oseg = (origLi.segments || []).find((s) => s.type === 'datetime');
					const op = oseg ? new DateTime(oseg.text).getParts() : null;
					const oymd = op && op.year !== undefined
						? op.year * 10000 + (op.month + 1) * 100 + op.day
						: rp.year * 10000 + (rp.month + 1) * 100 + rp.day;
					const rule = this.finalizeRule(t.pendingRule, oymd);
					await this.writeRule(origLi, rule);
					seriesOrigin = { pl: plS, li: origLi, rule, ymd: oymd };
				}
			} else {
				const rule = this.finalizeRule(t.pendingRule, rp.year * 10000 + (rp.month + 1) * 100 + rp.day);
				await this.writeRule(li, rule);
				seriesRule = rule; /* null included — that reconciles the series away */
			}
			t.ruleTouched = false;
		}
		await li.setSegments(segs);
		if (seriesOrigin) {
			this.reconcileLineSeries(seriesOrigin.pl.rec, seriesOrigin.li, seriesOrigin.rule, seriesOrigin.ymd).catch(() => {});
		} else if (seriesRule !== undefined) {
			const rp2 = dt.getParts();
			const pl2 = await this.pageLines(t.line.pageGuid);
			if (pl2) {
				this.reconcileLineSeries(pl2.rec, li, seriesRule, rp2.year * 10000 + (rp2.month + 1) * 100 + rp2.day)
					.catch(() => {});
			}
		}
		this.refreshRepeatStyle();
		const dom = t.line.domGuid || t.line.lineGuid;
		if (!t.line.noCaret) {
			if (move) await this.placeCaret(dom, move);
			else await this.restoreCaret(dom, t.line.caret);
		}
		this.toast(this.label(dt));
		return true;
	}

	/* New dates go in front of the trailing hashtags, which is where they sit on
	 * every existing line: "text <date> #timeblock". A separator is ALWAYS left
	 * after the date, never just before it: the date chip is inert to caret
	 * placement, so the span that follows it is the only thing we can aim at
	 * afterwards. Returns the index of the date segment. */
	insertDate(segs, dt) {
		const at = segs.findIndex((s) => s.type === 'hashtag');
		const where = at < 0 ? segs.length : at;
		const parts = [{ type: 'datetime', text: dt.value() }, { type: 'text', text: ' ' }];
		/* only add a leading separator when there is not already one, or a line
		 * ending in a space picks up a second one every time a date is set */
		if (this.needsGap(segs, where)) parts.unshift({ type: 'text', text: ' ' });
		segs.splice(where, 0, ...parts);
		return where + (parts.length === 3 ? 1 : 0);
	}

	/* True when segs[i-1] does not already end in whitespace. */
	needsGap(segs, i) {
		const prev = segs[i - 1];
		if (!prev) return false;
		return !(prev.type === 'text' && /\s$/.test(prev.text || ''));
	}

	/* ---- caret ----------------------------------------------------------
	 * setSegments does NOT move the caret: it stays at whatever offset it held,
	 * which is why setting a timeblock used to leave it stranded inside the tag.
	 * The only thing that moves it is a synthetic PointerEvent dispatched ON a
	 * segment's OWN span — dispatching at the .listitem (what elementFromPoint
	 * returns) does nothing — with clientX choosing the offset SPAN-RELATIVE, so
	 * a span's right edge lands the caret at its end. All verified live in
	 * 1.0.18. The datetime chip ignores this entirely, hence the guaranteed
	 * separator after every inserted date. */
	segmentSpans(lineGuid) {
		const li = document.querySelector('.listitem[data-guid="' + lineGuid + '"]');
		if (!li) return [];
		const all = Array.from(li.querySelectorAll('span[class*="lineitem-"]'));
		/* refs render a nested title span; keep only the outermost per segment */
		return all.filter((s) => !all.some((o) => o !== s && o.contains(s)));
	}

	/* Put the caret directly after the thing we just wrote.
	 *
	 * Do NOT address the target by segment index: Thymer MERGES adjacent text
	 * segments when the line is saved, so a 4-segment write can render as 3
	 * spans and the index silently points one segment too far — that is why the
	 * caret kept landing after the separator instead of against the date. Find
	 * the span by identity instead.
	 *
	 * `kind` is 'datetime' or 'hashtag'; `tag` is the hashtag text when it is
	 * one. A datetime chip refuses the caret, so for dates we aim at the LEFT
	 * edge of the span that follows it, which is the same visual position. */
	async placeCaret(lineGuid, kind, tag) {
		/* NOTE: this guid is the RENDERED row's, which inside a live search is the
		 * virtual V-guid and NOT the guid we wrote to. Passing the real line guid
		 * here finds nothing in the DOM, so the caret is never placed and focus is
		 * never restored — the row then looks focused and silently eats every
		 * keystroke until you click it. */
		let el = null;
		let atEnd = true;
		for (let i = 0; i < 24; i++) {
			const spans = this.segmentSpans(lineGuid);
			if (spans.length) {
				if (kind === 'eol') {
					/* Only ever used right after inserting a date, so wait for the
					 * chip to appear: measuring before the re-render gives the
					 * PREVIOUS layout, and the pointer then lands at the old x —
					 * which put the caret in front of the trailing hashtag rather
					 * than after it. */
					if (spans.some((sp) => /lineitem-datetime/.test(sp.className || ''))) {
						el = spans[spans.length - 1];
					}
				} else if (kind === 'hashtag') {
					el = spans.find((sp) => /lineitem-hashtag/.test(sp.className || '') && sp.textContent === tag) || null;
				} else {
					const at = spans.findIndex((sp) => /lineitem-datetime/.test(sp.className || ''));
					if (at >= 0 && spans[at + 1]) { el = spans[at + 1]; atEnd = false; }
				}
			}
			if (el) break;
			await new Promise((r) => setTimeout(r, 25));
		}
		if (!el) return;
		/* one more frame so the rect we are about to measure is the settled one */
		await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16)));

		const r = el.getBoundingClientRect();
		if (!r.width && !r.height) return;
		this.pointAt(el, atEnd ? r.right - 1 : r.left + 1, r.top + r.height / 2);
	}

	/* Calling focus() on #virtualinput-wrapper does NOT work on its own: verified
	 * live, the call is ignored and activeElement stays on <body>. The only thing
	 * that re-arms the editor after a write is a pointer landing on a line. So
	 * "leave the caret alone" is not an option — every write must end in a
	 * placement, and the way to honour where the user was standing is to put the
	 * caret BACK there rather than not to move it. */
	pointAt(el, x, y) {
		const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
			button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window };
		try {
			el.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1 }));
			el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
		} catch (e) {}
		try {
			const vi = document.getElementById('virtualinput-wrapper');
			if (vi) vi.focus({ preventScroll: true });
		} catch (e) {}
	}

	/* Where the caret sits, expressed against the RENDERED spans so it can be put
	 * back after setSegments rebuilds the row. Must be taken while the caret is
	 * still live — before the date box takes focus, not after. */
	captureCaret(domGuid) {
		const spans = this.segmentSpans(domGuid);
		if (!spans.length) return null;
		let cr = null;
		try {
			const lv = this.activeListview();
			const c = lv && lv.$carets && lv.$carets.querySelector('.listview-caret');
			cr = c && c.getBoundingClientRect();
		} catch (e) {}
		if (!cr) return null;
		for (let i = 0; i < spans.length; i++) {
			const r = spans[i].getBoundingClientRect();
			if (cr.left >= r.left - 2 && cr.left <= r.right + 2 && cr.top >= r.top - 4 && cr.top <= r.bottom + 4) {
				return { index: i, dx: cr.left - r.left };
			}
		}
		return { index: spans.length - 1, dx: null }; // past the last span = end of line
	}

	async restoreCaret(domGuid, snap) {
		await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
		const spans = this.segmentSpans(domGuid);
		if (!spans.length) return;
		if (!snap) {
			const l = spans[spans.length - 1];
			const b = l.getBoundingClientRect();
			this.pointAt(l, b.right - 1, b.top + b.height / 2);
			return;
		}
		let el = spans[Math.min(snap.index, spans.length - 1)];
		let dx = snap.dx;
		const at = spans.indexOf(el);
		/* the chip cannot hold the caret; fall to the start of whatever follows */
		if (/lineitem-datetime/.test(el.className || '') && spans[at + 1]) { el = spans[at + 1]; dx = 0; }
		const r = el.getBoundingClientRect();
		const x = dx === null ? r.right - 1 : Math.max(r.left + 1, Math.min(r.left + dx, r.right - 1));
		this.pointAt(el, x, r.top + r.height / 2);
	}

	/* The rule rides along on the line as an invisible meta property, so it
	 * survives edits, syncs with the line, and leaves the visible text alone —
	 * Parham's 51 existing #recurring lines can be given a rule without being
	 * retyped. */
	readRule(line) {
		try {
			const raw = (line && line.props && line.props.rs_recur) || null;
			if (raw) return JSON.parse(raw);
		} catch (e) {}
		/* props can transiently lose rs_recur after our own writes (see
		 * recurKnown in onLoad); fall back to what this session knows */
		const g = line && (line.lineGuid || line.guid);
		if (g && this.recurKnown && this.recurKnown.has(g)) return this.recurKnown.get(g);
		/* a forward-series COPY shows (and edits) the ORIGINAL's rule — his
		 * ask: standing on a future occurrence, the setting is right there */
		const sid = line && line.props && line.props.rs_series;
		if (sid) {
			const st = ((window.g_universe && window.g_universe.itemsByGuid) || {})[sid];
			try { if (st && st.props && st.props.rs_recur) return JSON.parse(st.props.rs_recur); } catch (e) {}
			if (this.recurKnown && this.recurKnown.has(sid)) return this.recurKnown.get(sid);
		}
		return null;
	}

	/* The record-mode rows of the Custom panel: which DATE field the rule
	 * drives, which STATUS field + value means done (optional — without it
	 * the rule only powers the forward trail), and what to reset the status
	 * to (default: clear). Field lists come from the collection's own config;
	 * value lists for record-type fields from the linked collections'
	 * records, loaded when the menu opens. Everything lands in t.pageCtx,
	 * which writeDate persists into the rule. */
	async wirePageRows(pop, t) {
		const rec = this.data.getRecord(t.guid);
		if (!rec) return;
		const { fields, collGuid } = await this.pageFields(rec);
		if (!fields.length) { this.toast('Could not read this collection’s fields.'); return; }
		/* last-used choices per collection are remembered as DEFAULTS only */
		const remembered = (this.pageDefaults && collGuid && this.pageDefaults[collGuid]) || null;
		t.collGuid = collGuid;
		const dateFields = fields.filter((f) => (f.type === 'datetime' || f.type === 'date') && f.active !== false && f.id !== 'created_at' && f.id !== 'updated_at');
		const statusFields = fields.filter((f) => (f.type === 'record' || f.type === 'choice') && f.active !== false && f.id !== 'parent_page');
		const prev = (this.pageRules && this.pageRules[t.guid]) || null;
		const defDate = (prev && dateFields.find((f) => f.id === prev.dp))
			|| (remembered && dateFields.find((f) => f.id === remembered.dp))
			|| dateFields.find((f) => (f.label || '') === DUE_DATE_FIELD)
			|| dateFields[0] || null;
		const seed = prev || remembered || {};
		t.pageCtx = {
			dp: defDate && defDate.id, dpl: defDate && defDate.label,
			sp: seed.sp, spl: null, dv: seed.dv, dvl: seed.dvl,
			rv: seed.rv, rvl: seed.rvl,
		};
		const prevSf = t.pageCtx.sp && statusFields.find((f) => f.id === t.pageCtx.sp);
		if (prevSf) t.pageCtx.spl = prevSf.label;

		const custom = pop.querySelector('.rs-custom');
		const holder = document.createElement('div');
		holder.className = 'rs-pagerows';
		holder.innerHTML = ''
			+ '<label><span>Date Field</span><span class="rs-sel rs-pf-date"><span class="rs-sel-lbl"></span><span class="ti ti-chevron-down"></span></span></label>'
			+ '<label><span>Done When</span><span class="rs-sel rs-pf-status"><span class="rs-sel-lbl"></span><span class="ti ti-chevron-down"></span></span></label>'
			+ '<label class="rs-pf-vrow" style="display:none"><span>Is Set To</span><span class="rs-sel rs-pf-dval"><span class="rs-sel-lbl"></span><span class="ti ti-chevron-down"></span></span></label>'
			+ '<label class="rs-pf-rrow" style="display:none"><span>Then Reset To</span><span class="rs-sel rs-pf-rval"><span class="rs-sel-lbl"></span><span class="ti ti-chevron-down"></span></span></label>';
		custom.insertBefore(holder, custom.firstChild);
		const dSel = holder.querySelector('.rs-pf-date');
		const sSel = holder.querySelector('.rs-pf-status');
		const vSel = holder.querySelector('.rs-pf-dval');
		const vRow = holder.querySelector('.rs-pf-vrow');
		const rSel = holder.querySelector('.rs-pf-rval');
		const rRow = holder.querySelector('.rs-pf-rrow');
		const lbl = (el, s2) => { el.querySelector('.rs-sel-lbl').textContent = s2 || '—'; };
		const paint = () => {
			lbl(dSel, t.pageCtx.dpl || t.pageCtx.dp);
			lbl(sSel, t.pageCtx.spl || (t.pageCtx.sp ? t.pageCtx.sp : 'pick a field'));
			vRow.style.display = t.pageCtx.sp ? '' : 'none';
			rRow.style.display = t.pageCtx.sp ? '' : 'none';
			lbl(vSel, t.pageCtx.dvl || (t.pageCtx.dv ? t.pageCtx.dv : 'pick a value'));
			lbl(rSel, t.pageCtx.rvl || (t.pageCtx.rv ? t.pageCtx.rv : 'cleared'));
			this.fit(pop);
		};
		/* value options for the chosen status field: choice options from the
		 * schema, or the linked collections' records */
		const valueItems = async (fdef) => {
			if (!fdef) return [];
			if (fdef.type === 'choice') {
				return ((fdef.choices || []).map((c) => [String(c.id), c.label || String(c.id)]));
			}
			/* record fields: the schema's filter_colguid names the linked
			 * collection; its records are the value space (wrappers carry a
			 * public .guid — bundle-verified) */
			const target = fdef.filter_colguid;
			if (!target) return [];
			const items = [];
			try {
				const all = await this.data.getAllCollections();
				const c = (all || []).find((x) => { try { return x.getGuid() === target; } catch (e) { return false; } });
				if (c) {
					const recs = await c.getAllRecords();
					for (const r2 of (recs || []).slice(0, 100)) {
						if (r2 && r2.guid) items.push([String(r2.guid), r2.getName() || String(r2.guid)]);
					}
				}
			} catch (e) {}
			return items;
		};
		dSel.addEventListener('click', () => {
			this.openSelMenu(dSel, dateFields.map((f) => [f.id, f.label || f.id]), t.pageCtx.dp, (v) => {
				const f = dateFields.find((x) => x.id === v);
				t.pageCtx.dp = v; t.pageCtx.dpl = f && f.label;
				paint();
			});
		});
		sSel.addEventListener('click', () => {
			const items = statusFields.map((f) => [f.id, f.label || f.id]);
			this.openSelMenu(sSel, items, t.pageCtx.sp || '', (v) => {
				const f = statusFields.find((x) => x.id === v);
				t.pageCtx.sp = v || null; t.pageCtx.spl = f && f.label;
				paint();
			});
		});
		vSel.addEventListener('click', async () => {
			const fdef = statusFields.find((x) => x.id === t.pageCtx.sp);
			const items = await valueItems(fdef);
			if (!items.length) { this.toast('No values found for that field.'); return; }
			this.openSelMenu(vSel, items, t.pageCtx.dv || '', (v) => {
				const it = items.find((x) => x[0] === v);
				t.pageCtx.dv = v; t.pageCtx.dvl = it && it[1];
				paint();
			});
		});
		rSel.addEventListener('click', async () => {
			const fdef = statusFields.find((x) => x.id === t.pageCtx.sp);
			const items = [['', 'cleared']].concat(await valueItems(fdef));
			this.openSelMenu(rSel, items, t.pageCtx.rv || '', (v) => {
				const it = items.find((x) => x[0] === v);
				t.pageCtx.rv = v || null; t.pageCtx.rvl = v ? (it && it[1]) : null;
				paint();
			});
		});
		paint();
	}

	// ---- page recurrence ------------------------------------------------------
	/* Repeats on PAGES (his spec 2026-08-09): the rule binds to a CHOSEN date
	 * field (every collection names its dates differently) and, optionally, a
	 * CHOSEN status field + value that means done — when that value lands on
	 * the record, the date field advances and the status resets (to rv, or
	 * clears). Without a status field the rule still powers the forward
	 * trail, which is the Expenses case: lay every future occurrence out as
	 * real records for budgeting. Double-advance is contained by reading the
	 * record's LIVE values at processing time plus the in-memory lastAdvance
	 * map — a cross-device echo inside that window is the accepted trade. */
	pagePropValues(prop) {
		const out = [];
		try { for (const t of prop.texts() || []) out.push(String(t)); } catch (e) {}
		try { for (const c of prop.selectedChoices() || []) out.push(String(c)); } catch (e) {}
		return out;
	}

	async setPagePropValue(prop, type, value) {
		try {
			if (type === 'choice') { prop.setChoice(value ? [value] : []); return; }
			prop.set(value ? [value] : []);
		} catch (e) {}
	}

	/* PluginRecord has NO getCollection() (types.d.ts lists it on events only
	 * — the 1.2.2 pickers died on exactly that). Sanctioned route instead:
	 * a record row's pguid IS its collection root guid (bundle-verified), and
	 * PluginCollectionAPI.getGuid() returns the same, so getAllCollections()
	 * finds the right wrapper. */
	async pageFields(rec) {
		try {
			const collGuid = rec._getRow ? (rec._getRow() || {}).pguid : null;
			const all = await this.data.getAllCollections();
			const coll = (all || []).find((c) => { try { return c.getGuid() === collGuid; } catch (e) { return false; } }) || null;
			const cfg = coll && coll.getConfiguration ? coll.getConfiguration() : null;
			return { coll, collGuid, fields: (cfg && cfg.fields) || [] };
		} catch (e) { return { coll: null, collGuid: null, fields: [] }; }
	}

	async onRecordUpdated(ev) {
		const guid = ev && ev.recordGuid;
		const rule = guid && this.pageRules && this.pageRules[guid];
		if (!rule) return;
		if (this.recurBusy.has(guid)) return;
		const rec = this.data.getRecord(guid);
		if (!rec) return;
		const spId = rule.sp;
		const dvVal = rule.dv;
		const dpId = rule.dp;
		const rvVal = rule.rv || null;
		if (!spId || !dvVal) return; /* advancing is ALWAYS status-driven */
		/* LIVE read, never the event payload: a replayed event against an
		 * already-reset record bails right here */
		const sprop = rec.prop(spId);
		if (!sprop || this.pagePropValues(sprop).indexOf(dvVal) < 0) return;
		const dprop = rec.prop(dpId);
		const cur = dprop && dprop.datetime();
		const p = cur && cur.getParts();
		if (!p || p.year === undefined) return;
		const due = p.year * 10000 + (p.month + 1) * 100 + p.day;
		const now = new Date();
		const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
		const la = this.lastAdvance && this.lastAdvance.get(guid);
		if (la && la.to === due && Date.now() - la.at < 8000) return; /* our own echo */
		const next = rule.tr === 'f' ? 0 : recurAdvance(rule, due, today);
		this.recurBusy.add(guid);
		try {
			const { fields } = await this.pageFields(rec);
			const sdef = fields.find((f) => f.id === spId) || {};
			if (!next) {
				/* forward-trail rules never advance (the series is laid out);
				 * an exhausted until ends the rule entirely */
				if (rule.tr !== 'f' && rule.u) {
					delete this.pageRules[guid];
					this.toast('Repeat finished for ' + (rec.getName() || 'page'));
					await this.savePrefs(); /* LAST — reloads the plugin */
				}
				return;
			}
			/* backwards trail: a completed copy stays behind on the old date */
			if (rule.tr === 'b') { try { await this.duplicateRecordShallow(rec); } catch (e2) {} }
			const nd = recurYmdToDate(next);
			const dt = p.hours === undefined
				? DateTime.dateOnly(nd.getFullYear(), nd.getMonth(), nd.getDate())
				: DateTime.dateAndTime(nd.getFullYear(), nd.getMonth(), nd.getDate(), p.hours, p.minutes || 0, 0);
			dprop.set(dt.value());
			await this.setPagePropValue(sprop, sdef.type, rvVal);
			if (this.lastAdvance) this.lastAdvance.set(guid, { to: next, at: Date.now() });
			this.toast((rec.getName() || 'Page') + ' → ' + this.label(dt) + '  ·  ' + recurLabel(rule));
		} finally {
			setTimeout(() => this.recurBusy.delete(guid), 1500);
		}
	}

	/* Duplicate a record with its property values — Reshape's proven recipe
	 * (createRecord, poll until readable, per-type value copy). */
	async duplicateRecordShallow(rec) {
		const { coll, fields } = await this.pageFields(rec);
		if (!coll) return null;
		let guid = null;
		try { guid = await coll.createRecord(rec.getName() || ''); } catch (e) {}
		if (!guid) return null;
		let dst = this.data.getRecord(guid);
		for (let i = 0; !dst && i < 16; i++) { await new Promise((r) => setTimeout(r, 120)); dst = this.data.getRecord(guid); }
		if (!dst) return null;
		for (const f of fields) {
			if (!f.active || f.read_only || f.type === 'dynamic') continue;
			if (f.id === 'title' || f.id === 'created_at' || f.id === 'updated_at' || f.id === 'collection' || f.id === 'parent_page' || f.id === 'banner') continue;
			const from = rec.prop(f.id);
			const to = dst.prop(f.id);
			if (!from || !to) continue;
			try {
				if (f.type === 'choice') { const c = from.selectedChoices(); if (c && c.length) to.setChoice(c); }
				else if (f.type === 'datetime' || f.type === 'date') { const d = from.datetime(); if (d) to.set(d.value()); }
				else if (f.type === 'number') { const n = f.many ? from.numbers() : from.number(); if (n !== null && n !== undefined && (!Array.isArray(n) || n.length)) to.set(n); }
				else if (f.type === 'text' || f.type === 'url') { const t2 = f.many ? from.texts() : from.text(); if (t2 && (!Array.isArray(t2) || t2.length)) to.set(t2); }
				else if (f.type === 'record' || f.type === 'user') { const g = from.texts(); if (g && g.length) to.set(f.many ? g : g[0]); }
			} catch (e) {}
		}
		return dst;
	}

	/* Forward-trail reconcile for a PAGE rule: rule.copies remembers every
	 * copy by occurrence day (his follow-up spec) — shorten the until and the
	 * superfluous NOT-completed copies are trashed, extend it and the missing
	 * days are laid out. Caller saves prefs afterwards. */
	async reconcilePageSeries(rec, rule) {
		if (!rule) return;
		rule.copies = rule.copies || {};
		const dprop = rec.prop(rule.dp);
		const cur = dprop && dprop.datetime();
		const p = cur && cur.getParts();
		const due = p && p.year !== undefined ? p.year * 10000 + (p.month + 1) * 100 + p.day : 0;
		const wanted = rule.tr === 'f' && due ? recurOccurrences({ ...rule, a: due }, due, 100) : [];
		if (rule.tr === 'f' && wanted.length === 100) this.toast('Forward trail capped at 100 copies');
		const wantedSet = new Set(wanted);
		for (const ymd of Object.keys(rule.copies)) {
			const occ = +ymd;
			if (wantedSet.has(occ)) { wantedSet.delete(occ); continue; }
			const copy = this.data.getRecord(rule.copies[ymd]);
			if (copy) {
				/* completed copies are history — never trashed */
				let doneNow = false;
				if (rule.sp && rule.dv) {
					const sp2 = copy.prop(rule.sp);
					doneNow = !!sp2 && this.pagePropValues(sp2).indexOf(rule.dv) >= 0;
				}
				if (!doneNow) { try { copy.trash(); } catch (e) {} }
			}
			delete rule.copies[ymd];
		}
		for (const occ of [...wantedSet].sort((a, b) => a - b)) {
			const dst = await this.duplicateRecordShallow(rec);
			if (!dst) continue;
			const d = recurYmdToDate(occ);
			const dt = p.hours === undefined
				? DateTime.dateOnly(d.getFullYear(), d.getMonth(), d.getDate())
				: DateTime.dateAndTime(d.getFullYear(), d.getMonth(), d.getDate(), p.hours, p.minutes || 0, 0);
			const dp2 = dst.prop(rule.dp);
			if (dp2) { try { dp2.set(dt.value()); } catch (e) {} }
			rule.copies[String(occ)] = dst.guid || null;
		}
	}

	/* FORWARD-TRAIL SERIES for a line (his spec 2026-08-09, incl. the
	 * follow-up): every copy carries rs_series = the original's guid and
	 * rs_occ = its occurrence day, so the series can be RECONCILED whenever
	 * the rule is edited — shorten the until and the now-superfluous copies
	 * are deleted (completed ones stay, they are history), extend it and the
	 * missing occurrences are laid out from the right day. Runs on every rule
	 * commit and on Clear; a rule without trail 'f' (or without an until, or
	 * counted from completion — recurOccurrences returns [] for both) simply
	 * reconciles to an empty set. Cap 100 copies, toasted when hit. */
	async reconcileLineSeries(rec, li, rule, dueYmd) {
		if (!rec || !li) return;
		const wanted = rule && rule.tr === 'f' ? recurOccurrences({ ...rule, a: dueYmd }, dueYmd, 100) : [];
		if (rule && rule.tr === 'f' && wanted.length === 100) this.toast('Forward trail capped at 100 copies');
		const all = await rec.getLineItems(false).catch(() => null);
		if (!all) return;
		const mine = [];
		let template = null;
		for (const x of all) {
			let raw = null;
			try { raw = x._getItem ? x._getItem() : null; } catch (e) {}
			if (!raw || raw.dlt) continue;
			if (x.guid === li.guid) template = { li: x, raw };
			if (raw.mp && raw.mp.rs_series === li.guid) mine.push({ li: x, occ: +raw.mp.rs_occ || 0 });
		}
		if (!template) return;
		const wantedSet = new Set(wanted);
		/* deletions first (fresh handles per delete — the stale-handle law) */
		for (const m of mine) {
			if (wantedSet.has(m.occ)) { wantedSet.delete(m.occ); continue; }
			let s = null;
			try { s = await m.li.getTaskStatus(); } catch (e) {}
			if (s === 'done' || s === 'canceled') continue; /* completed copies are history */
			const fresh = await this.freshLine(rec, m.li.guid);
			if (fresh) { try { await fresh.delete(); } catch (e) {} }
		}
		if (!wantedSet.size) return;
		/* creations: chronological, chained after the original (or after the
		 * last existing series copy). Deletes above invalidated handles, so
		 * take ONE fresh snapshot; creations do not invalidate. */
		const a2 = await rec.getLineItems(false).catch(() => null);
		if (!a2) return;
		const orig = a2.find((x) => x.guid === li.guid);
		if (!orig) return;
		const origRaw = orig._getItem ? orig._getItem() : null;
		const parentLi = origRaw && origRaw.pguid ? (a2.find((x) => x.guid === origRaw.pguid) || null) : null;
		const segsBase = orig.segments.map((s) => ({ type: s.type, text: s.text }));
		const di = segsBase.findIndex((s) => s.type === 'datetime');
		if (di < 0) return;
		const baseParts = new DateTime(segsBase[di].text).getParts();
		let anchorLi = orig;
		const kept = [];
		for (const x of a2) {
			let raw = null;
			try { raw = x._getItem ? x._getItem() : null; } catch (e) {}
			if (raw && !raw.dlt && raw.mp && raw.mp.rs_series === li.guid) kept.push({ li: x, occ: +raw.mp.rs_occ || 0 });
		}
		if (kept.length) anchorLi = kept[kept.length - 1].li; /* chain after the last existing copy */
		for (const occ of [...wantedSet].sort((a, b) => a - b)) {
			const d = recurYmdToDate(occ);
			const dt = baseParts.hours === undefined
				? DateTime.dateOnly(d.getFullYear(), d.getMonth(), d.getDate())
				: DateTime.dateAndTime(d.getFullYear(), d.getMonth(), d.getDate(), baseParts.hours, baseParts.minutes || 0, 0);
			const segs = segsBase.map((s) => ({ ...s }));
			segs[di] = { type: 'datetime', text: dt.value() };
			try {
				const copy = await rec.createLineItem(parentLi, anchorLi, 'task');
				if (!copy) continue;
				await copy.setMetaProperty('rs_series', li.guid);
				await copy.setMetaProperty('rs_occ', occ);
				await copy.setSegments(segs);
				anchorLi = copy;
			} catch (e) {}
		}
	}

	async writeRule(li, rule) {
		try {
			await li.setMetaProperty('rs_recur', rule ? JSON.stringify(rule) : null);
			if (this.recurKnown && li && li.guid) this.recurKnown.set(li.guid, rule || null);
		} catch (e) {}
	}

	/* Ticking a recurring task un-ticks it and moves it to the next occurrence.
	 * Our own write fires more lineitem.updated events, hence the guard — without
	 * it the handler re-enters itself and walks the date forward forever. */
	async onLineUpdated(ev) {
		/* String literals, not the documented status constants: types.d.ts lists
		 * them but they are NOT defined in the plugin sandbox, so referencing one
		 * throws and the handler dies silently. Verified live. */
		if (ev && ev.eventName === 'lineitem.updated') this.scheduleRepeatRefresh();
		if (!ev) return;
		/* order-by-status hooks: any status change is a candidate (sweep()
		 * checks the section's rs_order itself), and every event nudges the
		 * collector GC so hand-dragged-out tasks leave no empty collectors */
		if (typeof ev.status === 'string') this.scheduleSweep(ev.lineItemGuid);
		/* segment edits can change the line's SLOT TAG (⌘1-9, or typing one)
		 * — an arrival-class sweep reroutes it in hashtag sections; the
		 * typing guard keeps a line being written untouched */
		else if (ev.segments) this.scheduleSweep(ev.lineItemGuid, true);
		this.scheduleBinGC();
		if (ev.status !== 'done') return;
		const guid = ev.lineItemGuid;
		if (!guid || this.recurBusy.has(guid)) return;
		let li = null;
		try { li = await ev.getLineItem(); } catch (e) {}
		if (!li) return;
		/* The EVENT said done; make sure the LINE still is. A 'done' event can
		 * arrive again well after the fact (sync echo of the original tick,
		 * observed ~1s later — past the recurBusy window), and advancing on the
		 * echo walked the date one extra day. After our advance the status is
		 * already 'none', so a stale echo bails here. */
		try { if (await li.getTaskStatus() !== 'done') return; } catch (e) {}
		const rule = this.readRule(li);
		if (!rule || !rule.f) return;
		/* forward trail: the whole series is laid out as real copies, so a
		 * tick simply COMPLETES that occurrence — nothing advances */
		if (rule.tr === 'f') return;

		const segs = li.segments.map((x) => ({ type: x.type, text: x.text }));
		const i = segs.findIndex((x) => x.type === 'datetime');
		if (i < 0) return;
		const cur = new DateTime(segs[i].text);
		const p = cur.getParts();
		if (p.year === undefined) return;
		const due = p.year * 10000 + (p.month + 1) * 100 + p.day;
		const now = new Date();
		const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

		/* Replay dedupe: if the line already sits on the exact date WE advanced
		 * it to moments ago, this event is an echo of that tick, not a new one —
		 * advancing again is the observed "jumps one more day a second later".
		 * A genuine immediate re-tick within the window is the trade-off, and
		 * re-ticking a chore you just watched advance is not a real flow. */
		const la = this.lastAdvance && this.lastAdvance.get(guid);
		if (la && la.to === due && Date.now() - la.at < 8000) return;

		/* CROSS-DEVICE dedupe — the in-memory guards above only exist on the
		 * client that did the advance, and the plugin runs on EVERY client.
		 * A phone waking up later can process the original done-event against
		 * a store where the date has already synced to the advanced day while
		 * the status momentarily still reads done: its local guards all pass
		 * and the date walks ONE MORE step (his Aug 8 tick ending on Aug 10).
		 * So the advance leaves a token ON THE LINE (rs_adv meta property,
		 * synced like everything else): "advanced to t on day d". A done-event
		 * for a line whose due already equals a token minted TODAY is an
		 * advance that already happened somewhere — skip. Trade-offs, both
		 * documented: deliberately re-ticking the same chore twice in one day
		 * is ignored (push with ⌃+ instead), and an echo processed in the
		 * minutes right after midnight can slip the same-day check. */
		let adv = null;
		try { adv = li.props && li.props.rs_adv ? JSON.parse(li.props.rs_adv) : null; } catch (e2) {}
		if (adv && adv.t === due && adv.d === today) return;

		const next = recurAdvance(rule, due, today);
		if (!next) {
			/* an until-dated rule that has run out: this tick is FINAL. The task
			 * stays done; drop the rule so the glyph disappears and the line
			 * behaves like any other from here on. */
			if (rule.u) {
				this.recurBusy.add(guid);
				try {
					await this.writeRule(li, null);
					this.refreshRepeatStyle();
					this.toast('Repeat finished — stays done');
				} catch (e) {
				} finally {
					setTimeout(() => this.recurBusy.delete(guid), 1500);
				}
			}
			return;
		}
		const nd = recurYmdToDate(next);
		const dt = p.hours === undefined
			? DateTime.dateOnly(nd.getFullYear(), nd.getMonth(), nd.getDate())
			: DateTime.dateAndTime(nd.getFullYear(), nd.getMonth(), nd.getDate(), p.hours, p.minutes || 0, p.seconds || 0);
		/* A date RANGE moves as a BLOCK: the end shifts by the same number of
		 * days as the start, so "Mon–Fri every week" stays five days long.
		 * Before this, ticking a repeating range silently DROPPED the end date —
		 * his "repeat doesn't work with an end date" report. */
		const rEnd = cur.getRangeEnd();
		if (rEnd) {
			const ep = rEnd.getParts();
			if (ep.year !== undefined) {
				const shift = Math.round((nd - recurYmdToDate(due)) / 86400000);
				const ed = new Date(ep.year, ep.month, ep.day + shift);
				dt.setRangeEnd(ep.hours === undefined
					? DateTime.dateOnly(ed.getFullYear(), ed.getMonth(), ed.getDate())
					: DateTime.dateAndTime(ed.getFullYear(), ed.getMonth(), ed.getDate(), ep.hours, ep.minutes || 0, ep.seconds || 0));
			}
		}

		/* BACKWARDS TRAIL, corrected semantics (his 2026-08-09 report): the
		 * ticked ORIGINAL stays done — it IS the history, with its backlinks —
		 * and a fresh DUPLICATE carries the rule (and glyph) forward on the
		 * next date, taking the original's slot in the list. Every generation
		 * is a NEW line, which also sidesteps the same-day advance token that
		 * made the first version fire only once. The rs_adv token written on
		 * the original blocks another device replaying this done-event before
		 * the rule removal has synced. */
		if (rule.tr === 'b') {
			this.recurBusy.add(guid);
			try {
				const rec = await ev.getRecord();
				const all = rec ? await rec.getLineItems(false) : null;
				const meRaw = all ? (() => { const m = all.find((x) => x.guid === guid); try { return m && m._getItem ? m._getItem() : null; } catch (e2) { return null; } })() : null;
				const parentLi = meRaw && meRaw.pguid ? (all.find((x) => x.guid === meRaw.pguid) || null) : null;
				let beforeLi = null;
				if (all && meRaw) {
					let prevGuid = null;
					for (const x of all) {
						let r2 = null;
						try { r2 = x._getItem ? x._getItem() : null; } catch (e2) {}
						if (!r2 || r2.dlt || r2.pguid !== meRaw.pguid) continue;
						if (x.guid === guid) { beforeLi = prevGuid ? all.find((y) => y.guid === prevGuid) : null; break; }
						prevGuid = x.guid;
					}
				}
				const copy = rec && await rec.createLineItem(parentLi, beforeLi, 'task');
				if (copy) {
					await copy.setMetaProperty('rs_recur', JSON.stringify(rule));
					if (this.recurKnown) this.recurKnown.set(copy.guid, rule);
					const csegs = segs.map((s) => ({ ...s }));
					csegs[i] = { type: 'datetime', text: dt.value() };
					await copy.setSegments(csegs);
				}
				try { await li.setMetaProperty('rs_adv', JSON.stringify({ t: due, d: today })); } catch (e2) {}
				await this.writeRule(li, null);
				this.refreshRepeatStyle();
				this.toast('Done stays · next: ' + this.label(dt) + '  ·  ' + recurLabel(rule));
			} catch (e) {
			} finally {
				setTimeout(() => this.recurBusy.delete(guid), 1500);
			}
			return;
		}

		this.recurBusy.add(guid);
		try {
			/* Status FIRST, segments LAST — the doctrine holds here too: two
			 * writes to the same line and the one that must settle the render is
			 * the segment write. The old order (segments, then status) left the
			 * desktop state without props.rs_recur, which killed the glyph on
			 * the ticked line and made the Tasks view lose the due date. */
			await li.setTaskStatus('none');
			/* the cross-device token rides the line; segments stay LAST (doctrine) */
			try { await li.setMetaProperty('rs_adv', JSON.stringify({ t: next, d: today })); } catch (e2) {}
			segs[i] = { type: 'datetime', text: dt.value() };
			await li.setSegments(segs);
			this.recurKnown.set(guid, rule);
			if (this.lastAdvance) this.lastAdvance.set(guid, { to: next, at: Date.now() });
			this.toast('Next: ' + this.label(dt) + '  ·  ' + recurLabel(rule));
		} catch (e) {
		} finally {
			setTimeout(() => this.recurBusy.delete(guid), 1500);
		}
	}

	/* Coalesce refreshRepeatStyle: many triggers in a burst (a write's events,
	 * a search rendering its rows) become one rebuild. */
	scheduleRepeatRefresh() {
		if (this.repPending) return;
		this.repPending = true;
		setTimeout(() => {
			this.repPending = false;
			if (this.dead) return;
			this.refreshRepeatStyle();
			this.refreshBinStyle();
			this.refreshOrderButtons(); /* same cycle: rows just (re)rendered */
			this.arrivalScan();
			this.drainDeferredArrivals();
		}, 300);
	}

	// ---- order by status ------------------------------------------------------
	/* PER HEADING, never global (Parham, 2026-08-08): the mode lives as an
	 * rs_order meta property ON THE HEADING LINE — a JSON array of enabled bin
	 * keys — so it syncs across devices and each section decides for itself.
	 * Two palette commands set presets on the caret's section (all bins, or
	 * Done only), and the ⋯ button that appears next to an ordered heading
	 * opens a menu to fine-tune WHICH status rows are active there.
	 * Flagged tasks move under fixed-order collector rows (ORDER_BINS) at the
	 * bottom of the section; unflagged tasks stay at the top with no heading;
	 * a collector row only exists while it has tasks (GC below catches manual
	 * drag-outs too). Hiding/showing a collector's tasks = Thymer's own fold.
	 * Recurring tasks are never swept (they advance instead — the delay plus
	 * the status re-read lets that win). */
	binKeyOf(st) {
		if (!st) return null;
		const raw = (st.props && (st.props.rs_sweep_bin || (st.props.rs_done_bin ? 'done' : null)))
			|| (st.guid && this.binKnown && this.binKnown.get(st.guid)) /* in-session insurance */
			|| this.binKeyBySignature(st) /* survives everything, see below */
			|| null; /* rs_done_bin = v0.11.0 legacy */
		return raw === 'Done' ? 'done' : raw; /* v0.12.0 stored the label */
	}

	/* The writing client's stale props are NOT always transient — they can
	 * stay wrong for the whole session, and binKnown dies on every plugin
	 * reload (= every deploy). His symptom: turning grouping off dissolved
	 * ONLY the most recently created collector; the older ones were invisible
	 * to recognition. The identifier that survives everything is the CONTENT
	 * SIGNATURE: a text line whose segments are exactly our "<flag icon>
	 * <status name>" (or a legacy text-only label). A user line colliding
	 * with that exact icon+label pair as a child of an ordered heading is
	 * accepted as ours by design. */
	binKeyBySignature(st) {
		/* collectors are H5 headings since v0.16.0; 'text' is the legacy look */
		if (!st || (st.type && st.type !== 'text' && st.type !== 'heading')) return null;
		const ts = st.text_segments || [];
		if (String(ts[0]) === 'icon' && ts.length >= 4 && String(ts[2]) === 'text') {
			const icon = String(ts[1] || '');
			const txt = String(ts[3] || '').trim();
			const b = ORDER_BINS.find((x) => x.icon === icon && x.label === txt);
			if (b) return b.key;
			/* pre-0.17.2 Todo roofs were labelled "Tasks" — keep recognizing
			 * them until relabelBins/the migrate branch rewrites them */
			if (icon === 'ti-checkbox' && txt === 'Tasks') return 'tasks';
			/* hashtag roofs wear ti-tag + the SLOT's title (or bare tag) —
			 * only the ⌘1-9 slots from settings count, never other hashtags */
			if (icon === 'ti-tag') {
				const slot = (this.tbSlots || []).find((s2) =>
					(s2.title || s2.tag.slice(1)) === txt || s2.tag === txt || s2.tag.slice(1) === txt);
				if (slot) return slot.tag;
			}
		}
		if (String(ts[0]) === 'text' && ts.length === 2) {
			const txt = String(ts[1] || '').trim();
			const b = ORDER_BINS.find((x) => x.label === txt || x.label + ' Tasks' === txt || (x.key === 'done' && txt === 'Done Tasks'));
			if (b) return b.key;
		}
		return null;
	}

	/* Rank = collector order under a heading. Status roofs keep their list
	 * order; hashtag roofs rank by SLOT order (⌘1-9 = his day); Tasks and
	 * Done always close the section (50/60 leave room for both scales —
	 * only relative order matters, and modes never mix roofs for long). */
	binRank(key) {
		if (key && key[0] === '#') {
			const i = (this.tbSlots || []).findIndex((s) => s.tag === key);
			return i >= 0 ? i : -1;
		}
		const at = ORDER_BINS.findIndex((b) => b.key === key);
		if (at < 0) return -1;
		if (key === 'tasks') return 50;
		if (key === 'done') return 60;
		return at;
	}

	/* the def a roof renders from — static for statuses, derived from the
	 * CURRENT slot for hashtag roofs (a renamed slot self-heals its roof
	 * label on the next filing via placeInBin's migrate branch) */
	binDef(key) {
		if (key && key[0] === '#') {
			const slot = (this.tbSlots || []).find((s) => s.tag === key);
			return { key, label: slot ? (slot.title || slot.tag.slice(1)) : key.slice(1), icon: 'ti-tag', statuses: [] };
		}
		return ORDER_BINS.find((b) => b.key === key) || null;
	}

	/* the line's SLOT tag (settings ⌘1-9 only, never arbitrary hashtags);
	 * several slot tags on one line = the first in slot order wins */
	slotTagOf(st) {
		const ts = (st && st.text_segments) || [];
		const present = new Set();
		for (let i = 0; i + 1 < ts.length; i += 2) {
			if (String(ts[i]) === 'hashtag') present.add(String(ts[i + 1]));
		}
		if (!present.size) return null;
		for (const s of (this.tbSlots || [])) { if (present.has(s.tag)) return s.tag; }
		return null;
	}

	/* rs_order on a heading = JSON {m:'g'|'s', k:[bin keys]} — 'g' groups tasks
	 * under collector rows, 's' sorts them in place by status rank (with an
	 * optional Done group at the bottom when 'done' is in k). Legacy shapes
	 * (bare array, 'all', 'done') read as group mode. The session cache backs
	 * the read for the same transient-props reason as recurKnown — this is
	 * also what made "Turn off ordering" leave a populated Done collector
	 * behind (the dropped-bins list was computed from a props read that came
	 * back empty; dissolution now trusts the bins actually PRESENT instead). */
	orderConfOf(st) {
		const raw = st && st.props && st.props.rs_order;
		if (!raw) {
			/* cache the explicit OFF tombstone too — it must survive a
			 * transient props loss or the global conf slips through */
			if (raw === '' && st && st.guid && this.orderKnown) this.orderKnown.set(st.guid, null);
			return st && st.guid && this.orderKnown && this.orderKnown.has(st.guid) ? this.orderKnown.get(st.guid) : null;
		}
		if (raw === 'all') return { m: 'g', k: ORDER_BINS.map((b) => b.key) };
		if (raw === 'done') return { m: 'g', k: ['done'] };
		try {
			const a = JSON.parse(raw);
			let conf = null;
			if (Array.isArray(a)) {
				const keys = a.filter((k) => this.binRank(k) >= 0);
				conf = keys.length ? { m: 'g', k: keys } : null;
			} else if (a && (a.m === 'g' || a.m === 's' || a.m === 'h')) {
				conf = { m: a.m, k: (Array.isArray(a.k) ? a.k : []).filter((k) => this.binRank(k) >= 0) };
			}
			/* cache every SUCCESSFUL read: a later transient props loss must
			 * return this, not fall through to the GLOBAL conf — that fall-
			 * through is how an explicitly sorted section grew a status group
			 * (his Important-in-sort-mode report, 2026-08-08) */
			if (conf && st.guid && this.orderKnown) this.orderKnown.set(st.guid, conf);
			return conf;
		} catch (e) { return null; }
	}

	/* which collector rows a conf permits to EXIST */
	allowedBinKeys(conf) {
		if (!conf) return [];
		if (conf.m === 's') return conf.k.indexOf('done') >= 0 ? ['done'] : [];
		return conf.k; /* 'g' and 'h' */
	}

	/* which roof a task belongs under. Hashtag mode (m:'h', 2026-08-08 late):
	 * DONE WINS over any tag (a finished task never lingers in the day plan),
	 * then the line's slot tag, then the Tasks roof for the untagged (only
	 * alongside at least one real roof — same rule as status mode). */
	roofFor(conf, status, tag) {
		if (!conf) return null;
		if (conf.m === 'h') {
			if ((status === 'done' || status === 'canceled') && conf.k.indexOf('done') >= 0) return this.binDef('done');
			if (tag && conf.k.indexOf(tag) >= 0) return this.binDef(tag);
			if (conf.k.indexOf('tasks') >= 0 && conf.k.some((x) => x !== 'tasks')) return this.binDef('tasks');
			return null;
		}
		return this.binForStatus(this.allowedBinKeys(conf), status);
	}

	/* What sweep() acts on: the heading's explicit conf, else the GLOBAL
	 * grouping choices (settings, rs_prefs.globalBins) for any heading that
	 * never opted in.
	 * An explicit turn-off ('' tombstone, or a session-cached null) beats the
	 * global switch — a section the user switched off stays off. Only real
	 * HEADING lines qualify, so the switch can never grow collectors under a
	 * plain indented line. NOTE: the ⋯ chip (refreshOrderButtons) deliberately
	 * keys on the EXPLICIT conf only — a chip on every heading in the
	 * workspace would be noise. */
	effectiveOrderConf(headSt) {
		const explicit = this.orderConfOf(headSt);
		if (explicit) return explicit;
		if (!this.globalBins || !this.globalBins.length) return null;
		if (!headSt || headSt.type !== 'heading') return null;
		if (headSt.props && headSt.props.rs_order === '') return null;
		if (headSt.guid && this.orderKnown && this.orderKnown.has(headSt.guid)) return null;
		const k = this.globalBins.filter((x) => this.binRank(x) >= 0);
		return k.length ? { m: 'g', k } : null;
	}

	/* Sort rank (sort mode): the ORDER_BINS order, then NO-STATUS tasks at the
	 * bottom of the active list (his 2026-08-08 ask — untriaged sinks), with
	 * Done below them and Canceled last of all. My reading of "no status at
	 * the bottom": below every real status but still above the finished ones,
	 * because Done-last is his fixed spec; with the Done group on (the common
	 * config) no-status IS the bottom of the flat list. Flagged, easy to move. */
	rankOfStatus(status) {
		if (!status || status === 'none') return ORDER_BINS.length - 0.5;
		const at = ORDER_BINS.findIndex((b) => b.statuses.indexOf(status) >= 0);
		if (at < 0) return ORDER_BINS.length - 0.5;
		return status === 'canceled' ? at + 1.5 : at + 1;
	}

	binForStatus(keys, status) {
		if (!keys) return null;
		if (!status || status === 'none') {
			/* the Tasks roof gathers the status-less — but ONLY next to at
			 * least one real status group (a lone Tasks roof is just noise) */
			return keys.indexOf('tasks') >= 0 && keys.some((k) => k !== 'tasks')
				? ORDER_BINS.find((b) => b.key === 'tasks')
				: null;
		}
		return ORDER_BINS.find((b) => b.key !== 'tasks' && keys.indexOf(b.key) >= 0 && b.statuses.indexOf(status) >= 0) || null;
	}

	/* arrival=true marks a trigger that carries no user intent about the LINE
	 * ITSELF (it just moved in / got created) — sweep() then refuses to touch
	 * the line the caret is on. A status-change trigger within the same
	 * debounce window downgrades the pending sweep to non-arrival. */
	scheduleSweep(guid, arrival) {
		if (!guid || !this.sweepPending) return;
		if (this.sweepPending.has(guid)) {
			if (!arrival && this.sweepArrival) this.sweepArrival.set(guid, false);
			return;
		}
		this.sweepPending.add(guid);
		if (this.sweepArrival) this.sweepArrival.set(guid, !!arrival);
		setTimeout(() => {
			this.sweepPending.delete(guid);
			const arr = this.sweepArrival ? this.sweepArrival.get(guid) : false;
			if (this.sweepArrival) this.sweepArrival.delete(guid);
			if (!this.dead) this.sweep(guid, arr).catch(() => {});
		}, 1200);
	}

	async sweep(guid, arrival) {
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const st = byGuid[guid];
		if (!st || st.is_trashed || st.is_deleted || st.is_virtual || !st.rguid) return;
		if (st.props && (st.props.rs_recur || st.props.itemref)) return;
		if (this.binKeyOf(st)) return; /* never sweep a collector itself */
		if (arrival) {
			/* An arrival sweep never touches a line being WRITTEN — but a
			 * merely PARKED caret must not block it forever: he sends a task,
			 * clicks it to look at it, and the old guard then deferred the
			 * sweep indefinitely ("doesn't activate automatically", his
			 * report). Typing is what makes a caret line untouchable, so the
			 * guard now requires a keystroke within the last 3s; a deferred
			 * line retries by itself until the typing stops or the caret
			 * leaves (whichever comes first). */
			const sel = this.editorSelection();
			if (sel && sel.lineGuid === guid && Date.now() - (this.lastKeyAt || 0) < 3000) {
				if (this.deferredArrivals && !this.deferredArrivals.has(guid)) {
					this.deferredArrivals.add(guid);
					setTimeout(() => {
						if (this.dead || !this.deferredArrivals) return;
						this.deferredArrivals.delete(guid);
						this.scheduleSweep(guid, true);
					}, 3500);
				}
				return;
			}
		}

		/* where the task stands: directly under the heading, or inside a bin */
		let headSt = st.parent;
		let curBinSt = null;
		if (headSt && this.binKeyOf(headSt)) { curBinSt = headSt; headSt = headSt.parent; }
		if (!headSt || !headSt.guid) return;
		const conf = this.effectiveOrderConf(headSt);
		if (!conf) return; /* this section has not opted in */

		const pl = await this.pageLines(st.rguid);
		if (!pl) return;
		const li = pl.byG.get(guid);
		const headLi = pl.byG.get(headSt.guid);
		if (!li || !headLi) return;
		let status = null;
		try { status = await li.getTaskStatus(); } catch (e) {}
		/* re-read: a recurring advance has unticked by now */

		const tag = conf.m === 'h' ? this.slotTagOf(st) : null;
		const bin = this.roofFor(conf, status, tag);
		if (bin) {
			if (curBinSt && this.binKeyOf(curBinSt) === bin.key) {
				/* already under the right roof — but inside Done the internal
				 * order matters (done on top, canceled at the bottom), so a
				 * done↔canceled flip still needs a tidy. The tidy writes
				 * NOTHING when the bin is already ordered, which is what stops
				 * event echoes from cascading into a move storm. */
				if (bin.key === 'done') this.scheduleDoneTidy(curBinSt.guid);
				return;
			}
			await this.placeInBin(pl, li, headSt, headLi, bin, status);
			if (curBinSt) this.scheduleBinGC(); /* the old roof may just have emptied */
			return;
		}
		if (conf.m === 's') {
			/* sort mode: no roof for this status — file it AT ITS RANK in the
			 * flat list (actives by rank, no-status below them, done-ish last) */
			await this.sortPlace(pl, li, headSt, headLi, this.rankOfStatus(status), guid);
			if (curBinSt) this.scheduleBinGC();
			return;
		}
		if (curBinSt) { await this.moveOut(pl, li, headSt, headLi); return; }
		/* group mode, no roof for this status: a line that landed BELOW the
		 * collectors (Move To / Quick Capture sends, his report) belongs above
		 * them — the collectors keep the bottom of the section to themselves */
		const sibs = (headSt.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);
		const firstBinAt = sibs.findIndex((k) => this.binKeyOf(k));
		const myAt = sibs.findIndex((k) => k.guid === guid);
		if (firstBinAt >= 0 && myAt > firstBinAt) await this.moveOut(pl, li, headSt, headLi);
	}

	/* place a task after the LAST non-collector sibling of equal-or-lower
	 * rank; none at all = top of the section. Sibling ranks come from the
	 * API, not state props — state.props.done proved unreliable in practice
	 * (the sort pass read every rank as 0 and concluded "already sorted",
	 * his "order by status does nothing" report). */
	async sortPlace(pl, li, headSt, headLi, myRank, selfGuid) {
		const sibs = (headSt.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted && k.guid !== selfGuid && !this.binKeyOf(k));
		let after = null;
		for (const k of sibs) {
			const sli = pl.byG.get(k.guid);
			if (!sli) continue;
			let s = null;
			try { s = await sli.getTaskStatus(); } catch (e) {}
			if (this.rankOfStatus(s) <= myRank) after = k;
		}
		/* Already in place = NO write; that termination is what stops the
		 * arrival scan from cascading. "In place" is judged against the
		 * NEIGHBOURS, not one exact position: v0.16.2 compared prev against
		 * "the last sibling of my rank", so every line inside a run of
		 * equal-rank lines looked misplaced and was appended after its run —
		 * each move re-triggered the scan and the section rotated forever
		 * (his recording). Sorted means: nothing above me outranks me,
		 * nothing below me underranks me. */
		const all = (headSt.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);
		const myAt = all.findIndex((k) => k.guid === selfGuid);
		if (myAt >= 0) {
			/* judged against the nearest NON-collector neighbours. A roof
			 * sitting above me does NOT make me misplaced — the roof is the
			 * misplaced one, and binOrderTidy moves IT; when tasks tried to
			 * fix it themselves they leapfrogged each other forever (his
			 * 2026-08-09 recording). */
			let inPlace = true;
			let pAt = myAt - 1;
			while (pAt >= 0 && this.binKeyOf(all[pAt])) pAt--;
			if (pAt >= 0) {
				const pli = pl.byG.get(all[pAt].guid);
				let s = null;
				try { s = pli ? await pli.getTaskStatus() : null; } catch (e) {}
				if (this.rankOfStatus(s) > myRank) inPlace = false;
			}
			if (inPlace) {
				let nAt = myAt + 1;
				while (nAt < all.length && this.binKeyOf(all[nAt])) nAt++;
				if (nAt < all.length) {
					const nli = pl.byG.get(all[nAt].guid);
					let s = null;
					try { s = nli ? await nli.getTaskStatus() : null; } catch (e) {}
					if (this.rankOfStatus(s) < myRank) inPlace = false;
				}
			}
			if (inPlace) return;
		}
		const afterLi = after ? pl.byG.get(after.guid) : null;
		try { await li.move(headLi, afterLi || null); } catch (e) {}
	}

	/* Create-or-find the collector, INSERTED AT ITS RANK among the existing
	 * collectors at the bottom of the section, then file the task under it.
	 * The sibling snapshot for the ANCHOR comes fresh from getLineItems in
	 * document order (raw items: pguid = parent, mp = meta) — the state's
	 * children array LAGS freshly created siblings, which made simultaneous
	 * sweeps insert every collector at the same stale anchor and come out in
	 * REVERSE rank order (seen live in the e2e run). Note the mutation rule
	 * proven over CDP: create/setMetaProperty/setSegments do NOT invalidate
	 * existing handles; move/delete DO. */
	async placeInBin(pl, li, headSt, headLi, bin, status) {
		const rank = this.binRank(bin.key);
		const all = await pl.rec.getLineItems(false).catch(() => null);
		if (!all) return;
		const fresh = [];
		for (const x of all) {
			let it = null;
			try { it = x._getItem ? x._getItem() : null; } catch (e) {}
			if (!it || it.dlt || it.pguid !== headSt.guid) continue;
			const mp = it.mp || {};
			let key = mp.rs_sweep_bin || (mp.rs_done_bin ? 'done' : null)
				|| (this.binKnown && this.binKnown.get(x.guid)) || null;
			if (key === 'Done') key = 'done';
			fresh.push({ li: x, guid: x.guid, key });
		}
		const headLiF = all.find((x) => x.guid === headSt.guid) || headLi;
		const binEntry = fresh.find((f) => f.key === bin.key) || null;
		let binLi = binEntry ? binEntry.li : null;
		if (!binLi) {
			/* insert BEFORE the first collector of a higher rank; else last */
			let afterLi = fresh.length ? fresh[fresh.length - 1].li : null;
			const hi = fresh.find((f) => f.key && this.binRank(f.key) > rank);
			if (hi) {
				const at = fresh.indexOf(hi);
				afterLi = at > 0 ? fresh[at - 1].li : null; /* null = prepend = before it */
			}
			try {
				/* an H5 HEADING since v0.16.0 (his ask): folds natively, reads
				 * as structure. setHeadingSize only works on 'heading' lines
				 * (bundle: it guards on type, then writes mp.hsize). */
				binLi = await pl.rec.createLineItem(headLiF, afterLi || null, 'heading');
				/* meta first, segments LAST (doctrine); "<flag icon> <name>" so
				 * the row reads like the status it gathers ("✓ Done") */
				await binLi.setMetaProperty('rs_sweep_bin', bin.key);
				if (this.binKnown && binLi.guid) this.binKnown.set(binLi.guid, bin.key);
				try { await binLi.setHeadingSize(5); } catch (e2) {}
				await binLi.setSegments([{ type: 'icon', text: bin.icon }, { type: 'text', text: ' ' + bin.label }]);
				/* the Done group always STARTS collapsed (his ask) — fold it
				 * the moment it is born, before tasks land under it */
				if (bin.key === 'done') this.foldLines([binLi.guid]);
			} catch (e) { return; }
		} else {
			/* migrate a collector that predates the icon+name look */
			const binSt = (headSt.children || []).find((k) => k && k.guid === binEntry.guid);
			const ts = (binSt && binSt.text_segments) || [];
			if (ts.indexOf('icon') < 0 || String(ts).indexOf(bin.label) < 0) {
				try { await binLi.setSegments([{ type: 'icon', text: bin.icon }, { type: 'text', text: ' ' + bin.label }]); } catch (e) {}
			}
		}
		if (!binLi) return;
		/* done on top, canceled at the bottom (his ask): a canceled task
		 * APPENDS after the roof's last live child; everything else prepends
		 * (newest on top). The child list comes from the same fresh snapshot. */
		let afterKid = null;
		if (bin.key === 'done' && status === 'canceled' && binEntry) {
			for (const x of all) {
				let it = null;
				try { it = x._getItem ? x._getItem() : null; } catch (e) {}
				if (it && !it.dlt && it.pguid === binEntry.guid && x.guid !== li.guid) afterKid = x;
			}
		}
		try { await li.move(binLi, afterKid); } catch (e) {}
	}

	/* status no longer matches any active collector: back to the bottom of
	 * the active list = right before the first collector among the siblings */
	async moveOut(pl, li, headSt, headLi) {
		const sibs = (headSt.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);
		const firstBinAt = sibs.findIndex((k) => this.binKeyOf(k));
		const before = firstBinAt > 0 ? pl.byG.get(sibs[firstBinAt - 1].guid) : null;
		try { await li.move(headLi, before || null); } catch (e) { return; }
		this.scheduleBinGC();
	}

	/* Collector GC: a collector with no live children disappears — including
	 * when its tasks were dragged out BY HAND, which no status event reports. */
	scheduleBinGC() {
		if (this.binGCPending) return;
		this.binGCPending = true;
		setTimeout(() => {
			this.binGCPending = false;
			if (!this.dead) this.binGC().catch(() => {});
		}, 2500);
	}

	async binGC() {
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		for (const g in byGuid) {
			const st = byGuid[g];
			if (!st || st.is_trashed || st.is_deleted || st.is_virtual || !st.rguid) continue;
			if (!this.binKeyOf(st)) continue;
			const kids = (st.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);
			if (kids.length) continue;
			const pl = await this.pageLines(st.rguid);
			const li = pl && pl.byG.get(st.guid);
			if (li) { try { await li.delete(); } catch (e) {} }
		}
		await this.binOrderTidy();
	}

	/* Collectors under one heading must sit in ORDER_BINS rank order. New
	 * ones are inserted at rank by placeInBin; this pass re-seats EXISTING
	 * ones after a rank change (the Tasks roof moved from first to second-
	 * to-last, 2026-08-08). No writes when already ordered — the usual
	 * termination guard; rides the debounced binGC cycle. */
	async binOrderTidy() {
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const heads = new Map();
		for (const g in byGuid) {
			const st = byGuid[g];
			if (!st || st.is_trashed || st.is_deleted || st.is_virtual || !st.rguid) continue;
			if (!this.binKeyOf(st)) continue;
			const h = st.parent;
			if (h && h.guid && !heads.has(h.guid)) heads.set(h.guid, h);
		}
		for (const [hg, headSt] of heads) {
			const kids = (headSt.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);
			const bins = kids.filter((k) => this.binKeyOf(k));
			if (!bins.length) continue;
			const ranks = bins.map((k) => this.binRank(this.binKeyOf(k)));
			const ranksOk = ranks.every((r, i) => i === 0 || ranks[i - 1] <= r);
			/* collectors must also sit BELOW every ordinary row — a lone Done
			 * roof stranded ABOVE two tasks was never re-seated (the old
			 * bins<2 bail), and everything downstream assumes roofs-at-the-
			 * bottom, which set off the task leapfrog in his recording */
			const lastTaskAt = (() => { let at = -1; kids.forEach((k, i) => { if (!this.binKeyOf(k)) at = i; }); return at; })();
			const firstBinAt = kids.findIndex((k) => this.binKeyOf(k));
			if (ranksOk && (lastTaskAt < 0 || firstBinAt < 0 || firstBinAt > lastTaskAt)) continue; /* ordered */
			const pl = await this.pageLines(headSt.rguid);
			if (!pl) continue;
			const desired = bins.map((k, i) => ({ g: k.guid, r: ranks[i], i }))
				.sort((a, b) => a.r - b.r || a.i - b.i);
			/* re-seat after the last non-collector child, fresh handles per
			 * move (the stale-handle law) */
			const lastTask = [...kids].reverse().find((k) => !this.binKeyOf(k));
			let prevGuid = lastTask ? lastTask.guid : null;
			for (const d of desired) {
				const all = await pl.rec.getLineItems(false).catch(() => null);
				if (!all) return;
				const li = all.find((x) => x.guid === d.g);
				const headLi = all.find((x) => x.guid === hg);
				const anchor = prevGuid ? all.find((x) => x.guid === prevGuid) : null;
				if (li && headLi) { try { await li.move(headLi, anchor || null); } catch (e) {} }
				prevGuid = d.g;
			}
		}
	}

	/* Inside the Done roof: done tasks on top, canceled at the bottom (his
	 * 2026-08-08 ask). The tidy is a no-op when the bin is already ordered —
	 * that termination is what lets sweep() schedule it on every done-bin
	 * event (echoes included) without moves cascading into more events. */
	scheduleDoneTidy(binGuid) {
		if (!binGuid) return;
		if (!this.doneTidyPending) this.doneTidyPending = new Set();
		if (this.doneTidyPending.has(binGuid)) return;
		this.doneTidyPending.add(binGuid);
		setTimeout(() => {
			this.doneTidyPending.delete(binGuid);
			if (!this.dead) this.tidyDoneBin(binGuid).catch(() => {});
		}, 1500);
	}

	async tidyDoneBin(binGuid) {
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const binSt = byGuid[binGuid];
		if (!binSt || binSt.is_trashed || binSt.is_deleted || !binSt.rguid) return;
		if (this.binKeyOf(binSt) !== 'done') return;
		const pl = await this.pageLines(binSt.rguid);
		if (!pl) return;
		const all = await pl.rec.getLineItems(false).catch(() => null);
		if (!all) return;
		/* doc-order children + their statuses (API reads — reads never go
		 * stale, only move/delete invalidate handles) */
		const kids = [];
		for (const x of all) {
			let it = null;
			try { it = x._getItem ? x._getItem() : null; } catch (e) {}
			if (it && !it.dlt && it.pguid === binGuid) kids.push(x);
		}
		const statuses = [];
		for (const k of kids) {
			let s = null;
			try { s = await k.getTaskStatus(); } catch (e) {}
			statuses.push(s);
		}
		const firstC = statuses.indexOf('canceled');
		if (firstC < 0 || statuses.slice(firstC).every((s) => s === 'canceled')) return; /* ordered */
		/* move each canceled task (doc order) to the end — appending in doc
		 * order preserves their relative order; fresh handles per move */
		const cg = kids.filter((k, i) => statuses[i] === 'canceled').map((k) => k.guid);
		for (const g of cg) {
			const a2 = await pl.rec.getLineItems(false).catch(() => null);
			if (!a2) return;
			const binLi = a2.find((x) => x.guid === binGuid);
			const me = a2.find((x) => x.guid === g);
			let lastKid = null;
			for (const x of a2) {
				let it = null;
				try { it = x._getItem ? x._getItem() : null; } catch (e) {}
				if (it && !it.dlt && it.pguid === binGuid && x.guid !== g) lastKid = x;
			}
			if (me && binLi) { try { await me.move(binLi, lastKid); } catch (e) {} }
		}
	}

	/* Fold lines THE WAY THYMER DOES IT — fold state is per-client, not
	 * synced: a key "<workspaceGuid>_<lineGuid>" in localStorage
	 * "folded_items" (capped at 100, read once per listview construction into
	 * lv.fold_loaded_keys — both names unminified in app-4XFIUFOL). Writing
	 * both makes the fold stick for live views AND future sessions; the app's
	 * own unfold removes the key, so a user opening the group is respected
	 * until the next plugin load re-folds it ("always STARTS collapsed"). */
	foldLines(guids) {
		try {
			const u = window.g_universe;
			const ws = (u && u.workspace && u.workspace.guid) || (u && u.workspaceGuid) || null;
			if (!ws || !guids || !guids.length) return;
			const keys = guids.map((g) => ws + '_' + g);
			let cur = [];
			try { cur = JSON.parse(localStorage.getItem('folded_items') || '[]') || []; } catch (e) {}
			if (!Array.isArray(cur)) cur = [];
			for (const k of keys) { if (cur.indexOf(k) < 0) cur.push(k); }
			localStorage.setItem('folded_items', JSON.stringify(cur.slice(-100)));
			for (const lv of (u && u.listviews) || []) {
				if (lv && lv.fold_loaded_keys) for (const k of keys) lv.fold_loaded_keys.add(k);
			}
			/* nudge a re-layout so an already-rendered group actually closes */
			window.dispatchEvent(new Event('resize'));
		} catch (e) {}
	}

	/* State-driven arrival detection, independent of lineitem.moved/created
	 * actually firing (belt-and-braces — his v0.16.2 report says arrivals
	 * still stranded). Runs on the debounced refresh cycle: any ordered
	 * section whose CHILD LIST changed since last look gets every non-
	 * collector child scheduled for an arrival sweep. Sweeps are no-ops for
	 * lines already in place (that termination is the loop guard), so the
	 * cost of a changed section is bounded and a quiet section costs one
	 * string compare. Our own moves change the signature once more and the
	 * re-scan's sweeps all no-op. */
	arrivalScan() {
		if (!this.sectionSig) return;
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		for (const g in byGuid) {
			const st = byGuid[g];
			if (!st || st.is_trashed || st.is_deleted || st.is_virtual || !st.rguid) continue;
			const conf = this.effectiveOrderConf(st);
			if (!conf) continue;
			const kids = (st.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);
			/* the signature must reach INSIDE the collectors: a task appended
			 * as a child of the (collapsed) Done heading changed no direct
			 * child of the section, so the old signature never fired and the
			 * task just stayed there (his report) */
			let sig = '';
			const queue = [];
			/* in HASHTAG mode the routing key is the line's slot tag, and a
			 * tag edit changes no child list — bake the tag into each line's
			 * signature entry so retagging fires the sweep (his report: a
			 * tagged task never moved; ev.segments proved to be another
			 * stale-types field that never arrives at runtime) */
			const ent = (k) => k.guid + (conf.m === 'h' ? ':' + (this.slotTagOf(k) || '') : '');
			for (const k of kids) {
				sig += ent(k) + ',';
				if (this.binKeyOf(k)) {
					for (const kk of (k.children || [])) {
						if (kk && !kk.is_trashed && !kk.is_deleted) { sig += ent(kk) + ','; queue.push(kk.guid); }
					}
				} else {
					queue.push(k.guid);
				}
			}
			if (this.sectionSig.get(g) === sig) continue;
			this.sectionSig.set(g, sig);
			for (const q of queue) this.scheduleSweep(q, true);
			/* a shrunken signature can mean a deletion — let GC look */
			this.scheduleBinGC();
		}
	}

	/* arrivals skipped because the caret sat on them: retry once it has left */
	drainDeferredArrivals() {
		if (!this.deferredArrivals || !this.deferredArrivals.size) return;
		const sel = this.editorSelection();
		const cg = sel && sel.lineGuid;
		for (const g of [...this.deferredArrivals]) {
			if (g !== cg) {
				this.deferredArrivals.delete(g);
				this.scheduleSweep(g, true);
			}
		}
	}

	/* Collector rows: optically align the flag icon with the H5 text (his
	 * report: icons sat off the text line). The icon segment renders as
	 * span.lineitem-icon > span.ti (bundle-read). HARD-WON, keep both facts:
	 * (1) `vertical-align` on the glyph has ZERO effect in Thymer's line
	 * layout — proven over CDP 2026-08-08 by pixel-measuring screenshots at
	 * several offsets (identical ink rows every time), which is why three
	 * eyeballed/font-math attempts all "did nothing". Only `position:
	 * relative; top` moves it. (2) The calibrated value comes from that same
	 * ink measurement: the glyph sat exactly 2px high at 15.2px font, and
	 * `top: 0.13em` (= 2px there, scales with the heading size) zeroed the
	 * icon-vs-text ink centres to the pixel. Guid-keyed rules in a plugin-
	 * owned stylesheet — never a touched line. */
	refreshBinStyle() {
		if (!this.binStyle) return;
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const sels = [];
		for (const g in byGuid) {
			const st = byGuid[g];
			if (!st || st.is_trashed || st.is_deleted || st.is_virtual) continue;
			if (this.binKeyOf(st)) sels.push('.listitem[data-guid="' + g + '"] span.lineitem-icon .ti');
		}
		const css = sels.length
			? sels.join(',\n') + ' { position: relative; top: 0.13em; line-height: 1; }'
			: '';
		if (this.binStyle.textContent !== css) this.binStyle.textContent = css;
	}

	/* Re-label loaded collectors whose def changed (the Tasks→Todo rename,
	 * slot renames): one segment write per stale roof, skipping the caret's
	 * line. placeInBin's migrate branch does the same lazily on filing; this
	 * catches roofs that would otherwise sit stale until touched. */
	async relabelBins() {
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const sel = this.editorSelection();
		const caretGuid = sel && sel.lineGuid;
		for (const g in byGuid) {
			const st = byGuid[g];
			if (!st || st.is_trashed || st.is_deleted || st.is_virtual || !st.rguid || g === caretGuid) continue;
			const key = this.binKeyOf(st);
			if (!key) continue;
			const def = this.binDef(key);
			if (!def) continue;
			const ts = st.text_segments || [];
			if (String(ts[1]) === def.icon && String(ts[3] || '').trim() === def.label) continue;
			const pl = await this.pageLines(st.rguid);
			const li = pl && pl.byG.get(g);
			if (li) { try { await li.setSegments([{ type: 'icon', text: def.icon }, { type: 'text', text: ' ' + def.label }]); } catch (e) {} }
		}
	}

	/* onLoad pass: every loaded Done collector starts the session collapsed. */
	collapseDoneBins() {
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const guids = [];
		for (const g in byGuid) {
			const st = byGuid[g];
			if (!st || st.is_trashed || st.is_deleted || st.is_virtual) continue;
			if (this.binKeyOf(st) === 'done') guids.push(g);
		}
		if (guids.length) this.foldLines(guids);
	}

	/* One-shot onLoad migration: collectors created before v0.16.0 are plain
	 * text lines; the H5 look requires the 'heading' TYPE, and there is no
	 * type-change API (setHeadingSize refuses non-headings — bundle-verified),
	 * so each one is REBORN: new heading line right after it, children moved
	 * over (reverse order + fresh handles per move, the playbook's rules),
	 * old line deleted. Skipped while the caret sits inside the collector's
	 * subtree — never SDK-write what is being edited; it upgrades on the next
	 * load instead. Only reaches LOADED pages; far-away sections upgrade when
	 * their page next loads with a session in it. */
	async upgradeBins() {
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const sel = this.editorSelection();
		const caretGuid = sel && sel.lineGuid;
		const targets = [];
		for (const g in byGuid) {
			const st = byGuid[g];
			if (!st || st.is_trashed || st.is_deleted || st.is_virtual || !st.rguid) continue;
			if (st.type === 'heading') continue;
			const key = this.binKeyOf(st);
			if (key) targets.push({ guid: g, key });
		}
		for (const tg of targets) {
			const st = byGuid[tg.guid];
			if (!st || !st.parent || !st.parent.guid) continue;
			if (caretGuid && (tg.guid === caretGuid
				|| (st.children || []).some((k) => k && k.guid === caretGuid))) continue;
			const bin = this.binDef(tg.key);
			if (!bin) continue;
			const pl = await this.pageLines(st.rguid);
			if (!pl) continue;
			let all = await pl.rec.getLineItems(false).catch(() => null);
			if (!all) continue;
			const oldLi = all.find((x) => x.guid === tg.guid);
			const headLi = all.find((x) => x.guid === st.parent.guid);
			if (!oldLi || !headLi) continue;
			let nu = null;
			try {
				nu = await pl.rec.createLineItem(headLi, oldLi, 'heading');
				await nu.setMetaProperty('rs_sweep_bin', tg.key);
				try { await nu.setHeadingSize(5); } catch (e2) {}
				await nu.setSegments([{ type: 'icon', text: bin.icon }, { type: 'text', text: ' ' + bin.label }]);
			} catch (e) { continue; }
			if (!nu || !nu.guid) continue;
			if (this.binKnown) this.binKnown.set(nu.guid, tg.key);
			const kids = (st.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);
			for (let i = kids.length - 1; i >= 0; i--) {
				const a2 = await pl.rec.getLineItems(false).catch(() => null);
				if (!a2) break;
				const kli = a2.find((x) => x.guid === kids[i].guid);
				const nli = a2.find((x) => x.guid === nu.guid);
				if (kli && nli) { try { await kli.move(nli, null); } catch (e) {} }
			}
			const a3 = await pl.rec.getLineItems(false).catch(() => null);
			const ol = a3 && a3.find((x) => x.guid === tg.guid);
			if (ol) { try { await ol.delete(); } catch (e) {} }
			if (tg.key === 'done') this.foldLines([nu.guid]);
		}
	}

	/* The heading the caret's line belongs to (walking up through bins). */
	async currentHeading() {
		const line = this.editorSelection();
		if (!line || !line.lineGuid || !line.pageGuid) return null;
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const pl = await this.pageLines(line.pageGuid);
		if (!pl) return null;
		let cur = byGuid[line.lineGuid];
		while (cur && cur.guid) {
			const li = pl.byG.get(cur.guid);
			if (li) {
				let hs = 0;
				try { hs = await li.getHeadingSize(); } catch (e) {}
				if (hs) return { headSt: cur, headLi: li, pl };
			}
			cur = cur.parent;
		}
		return null;
	}

	/* The palette commands: presets on the caret's section. Toggling the same
	 * preset again turns ordering OFF and restores the flat list. */
	async toggleOrder(preset) {
		const t = await this.currentHeading();
		if (!t) { this.toast('Put the caret in a list under a heading first.'); return; }
		const cur = this.orderConfOf(t.headSt);
		const same = cur && cur.m === preset.m
			&& cur.k.length === preset.k.length && preset.k.every((k) => cur.k.indexOf(k) >= 0);
		const next = same ? null : preset;
		const name = preset.m === 's' ? 'Order by Status'
			: preset.m === 'h' ? 'Group by Hashtags'
				: (preset.k.length === 1 && preset.k[0] === 'done' ? 'Group Done Tasks' : 'Group by Status');
		this.toast(name + (next ? ': on for this section' : ': off — list restored'));
		await this.setOrderConf(t, next);
	}

	async setOrderConf(t, conf) {
		/* dropped collectors are computed from the bins actually PRESENT under
		 * the heading — never from a props read, which can be transiently
		 * empty on the writing client (the "Turn off left Done behind" bug) */
		const allowed = this.allowedBinKeys(conf);
		const present = (t.headSt.children || [])
			.filter((k) => k && !k.is_trashed && !k.is_deleted)
			.map((k) => this.binKeyOf(k))
			.filter((k, i, a) => k && a.indexOf(k) === i);
		const dropped = present.filter((k) => allowed.indexOf(k) < 0);
		/* '' as the off-tombstone, and NO abort on failure: setMetaProperty
		 * with null can throw, and the old catch{return} silently skipped the
		 * whole teardown — the real reason collectors kept surviving turn-off */
		try { await t.headLi.setMetaProperty('rs_order', conf ? JSON.stringify(conf) : ''); } catch (e) {}
		if (this.orderKnown) this.orderKnown.set(t.headSt.guid, conf || null);
		if (dropped.length) {
			await this.dissolveBins(t, dropped);
			/* the state tree lags the moves a beat; organizing against the
			 * stale children misses everything that just moved out */
			await new Promise((r) => setTimeout(r, 350));
		}
		if (conf) await this.organizeSection(t, conf);
		this.refreshOrderButtons();
	}

	/* Retroactive pass when a section opts in or its conf changes. Status
	 * comes straight off the STATE (props.done number map), so finding the
	 * candidates needs no per-line API calls. Group mode: every flagged task
	 * (and every task inside a bin) re-files itself via sweep(). Sort mode:
	 * one stable sort of the flat list by rank (reverse-prepend order), then
	 * done tasks file into the Done group when it is enabled. */
	async organizeSection(t, conf) {
		conf = conf || this.orderConfOf(t.headSt);
		if (!conf) return;
		const live = () => (t.headSt.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);

		/* statuses via the API, cached per pass — state.props.done reads 0 in
		 * practice, which silently no-opped the whole sort (his report) */
		const statusOf = async (guid) => {
			const li = t.pl.byG.get(guid);
			if (!li) return 'none';
			try { return (await li.getTaskStatus()) || 'none'; } catch (e) { return 'none'; }
		};

		if (conf.m === 's') {
			const tasks = live().filter((k) => !this.binKeyOf(k));
			const ranked = [];
			for (let i = 0; i < tasks.length; i++) {
				ranked.push({ k: tasks[i], i, r: this.rankOfStatus(await statusOf(tasks[i].guid)) });
			}
			ranked.sort((a, b) => a.r - b.r || a.i - b.i);
			const inOrder = ranked.every((x, i) => x.k.guid === tasks[i].guid);
			if (!inOrder) {
				for (let i = ranked.length - 1; i >= 0; i--) {
					/* fresh handles per move — stale ones no-op silently */
					const all = await t.pl.rec.getLineItems(false).catch(() => null);
					if (!all) break;
					const li = all.find((x) => x.guid === ranked[i].k.guid);
					const headLi = all.find((x) => x.guid === t.headSt.guid);
					if (li && headLi) { try { await li.move(headLi, null); } catch (e) {} }
				}
			}
		}

		const queue = [];
		for (const k of live()) {
			if (this.binKeyOf(k)) {
				for (const kk of (k.children || [])) { if (kk && !kk.is_trashed && !kk.is_deleted) queue.push(kk.guid); }
			} else if (conf.m === 's') {
				/* the sort above already placed everything; only done/canceled
				 * still need FILING, and only when the Done group is on */
				if (conf.k.indexOf('done') >= 0) {
					const s = await statusOf(k.guid);
					if (s === 'done' || s === 'canceled') queue.push(k.guid);
				}
			} else if (conf.m === 'h') {
				queue.push(k.guid); /* every line: tag, Done or Tasks decides */
			} else {
				const s = await statusOf(k.guid);
				/* unflagged tasks queue too when the Tasks roof is active —
				 * they file under it like any other status files under its own */
				if (s !== 'none' || this.binForStatus(this.allowedBinKeys(conf), 'none')) queue.push(k.guid);
			}
		}
		for (const g of queue) { try { await this.sweep(g); } catch (e) {} }
		/* the Done roof's internal order (done top, canceled bottom) — after
		 * the moves above settle a beat */
		setTimeout(() => {
			if (this.dead) return;
			for (const k of live()) {
				if (this.binKeyOf(k) === 'done') this.tidyDoneBin(k.guid).catch(() => {});
			}
		}, 600);
		this.scheduleBinGC();
	}

	/* Move the named bins' tasks back out (reverse order preserves their
	 * order — the playbook's move() rule) and delete the bins.
	 *
	 * FRESH HANDLES BEFORE EVERY MUTATION. Proven live over CDP (2026-08-08):
	 * PluginLineItem handles from one getLineItems snapshot go STALE after the
	 * first mutation in the record — the next move() returns null and the next
	 * delete() returns false, silently. That single fact was the entire
	 * "turn-off dissolves only the topmost collector" saga; five recognition
	 * theories died before the data pointed here. */
	async freshLine(rec, guid) {
		try {
			const all = await rec.getLineItems(false);
			return all.find((x) => x.guid === guid) || null;
		} catch (e) { return null; }
	}

	async dissolveBins(t, keysToDrop) {
		const { headSt, pl } = t;
		for (const binSt of [...(headSt.children || [])].filter((k) => k && !k.is_trashed && !k.is_deleted && this.binKeyOf(k) && keysToDrop.indexOf(this.binKeyOf(k)) >= 0)) {
			const sibs = (headSt.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);
			const firstBinAt = sibs.findIndex((k) => this.binKeyOf(k));
			const anchorGuid = firstBinAt > 0 ? sibs[firstBinAt - 1].guid : null;
			const binKids = (binSt.children || []).filter((k) => k && !k.is_trashed && !k.is_deleted);
			for (let i = binKids.length - 1; i >= 0; i--) {
				const all = await pl.rec.getLineItems(false).catch(() => null);
				if (!all) break;
				const kli = all.find((x) => x.guid === binKids[i].guid);
				const headLi = all.find((x) => x.guid === headSt.guid);
				const anchor = anchorGuid ? all.find((x) => x.guid === anchorGuid) : null;
				if (kli && headLi) { try { await kli.move(headLi, anchor || null); } catch (e) {} }
			}
			const binLi = await this.freshLine(pl.rec, binSt.guid);
			if (binLi) { try { await binLi.delete(); } catch (e) {} }
		}
	}

	// ---- the ⋯ button next to ordered headings --------------------------------
	/* Thymer's own +/⋯ affordances live in an OVERLAY layer, never inside the
	 * line (and so must ours — the never-insert-nodes doctrine). One chip per
	 * RENDERED ordered heading. Since v0.16.5 each chip is parented INSIDE its
	 * heading's SCROLL CONTAINER (absolute, never inside a line): it then
	 * rides the scroll natively at zero lag — the previous fixed-layer chip
	 * chased the content one frame behind, first via a 120ms debounce, then
	 * via rAF, and both wobbled (his two reports). Coordinates are solved by
	 * PLACE-MEASURE-CORRECT (the Reshape centerAt trick), immune to whatever
	 * coordinate space the container uses. Clicking opens the section menu. */
	scrollParentOf(el) {
		let p = el.parentElement;
		while (p && p !== document.body) {
			const cs = getComputedStyle(p);
			if (/(auto|scroll|overlay)/.test(cs.overflowY + ' ' + cs.overflowX)
				&& (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return p;
			p = p.parentElement;
		}
		return null;
	}

	refreshOrderButtons(fullScan) {
		if (!this.orderBtns) return;
		/* the byGuid sweep is the expensive half — cache the ordered-heading
		 * guids and let the scroll path (rAF, every frame) skip straight to
		 * measuring; the debounced cycle rebuilds the cache */
		if (fullScan !== false || !this.orderGuidCache) {
			const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
			this.orderGuidCache = [];
			for (const g in byGuid) {
				const st = byGuid[g];
				if (!st || st.is_trashed || st.is_deleted || !this.orderConfOf(st)) continue;
				this.orderGuidCache.push(g);
			}
		}
		const want = new Map(); /* domKey → {guid, rect} */
		for (const g of this.orderGuidCache) {
			const els = document.querySelectorAll('.listitem[data-guid="' + g + '"]');
			els.forEach((el, i) => {
				const r = el.getBoundingClientRect();
				/* a FOLDED-AWAY row can keep one dimension (width) while the
				 * other collapses — "!w && !h" let its chip float over whatever
				 * took its place (his fold report); either dimension gone = gone */
				if (r.width < 2 || r.height < 2) return;
				const spans = Array.from(el.querySelectorAll('span[class*="lineitem-"]'));
				const last = spans[spans.length - 1];
				/* anchor BOTH axes to the heading's own text span — the listitem
				 * box can be taller than the text (children/indent chrome), which
				 * floated the chip above the heading (his screenshot) */
				const lr = last ? last.getBoundingClientRect() : r;
				if (lr.width < 1 || lr.height < 1) return;
				/* OCCLUSION: the chip is position:fixed, so a heading scrolled
				 * under a sticky bar / covered by another surface kept its chip
				 * drawn on top. If the topmost element at the heading's own
				 * midpoint is not inside this row, the row is not the visible
				 * thing there — no chip. */
				const topEl = document.elementFromPoint(
					Math.min(lr.left + 8, lr.left + lr.width / 2),
					lr.top + lr.height / 2
				);
				if (!topEl || (!el.contains(topEl) && topEl !== el)) return;
				/* the chip sits after EVERYTHING the row renders — Thymer's
				 * backlink counter (.lineitem-backlink-pill, a line-button, so
				 * the span scan above misses it) extends past the text span and
				 * the chip landed on top of it (his report). When a pill is
				 * there, the chip also aligns to the PILL's box (top + height),
				 * so the two read as one row of controls. */
				let x = lr.right + 8;
				let box = null; /* the pill rect to mirror, when present */
				el.querySelectorAll('.lineitem-backlink-pill').forEach((p) => {
					const pr = p.getBoundingClientRect();
					if (!pr.width) return;
					if (pr.right + 6 > x) { x = pr.right + 6; box = pr; }
				});
				want.set(g + ':' + i, {
					guid: g, x,
					y: box ? box.top : lr.top + (lr.height - 20) / 2,
					h: box ? box.height : 20,
					parent: this.scrollParentOf(el) || document.body,
				});
			});
		}
		const seen = new Set();
		for (const [key, pos] of want) {
			let btn = this.orderBtns.get(key);
			/* the heading changed scroller (view rebuild, panel move) → remake */
			if (btn && btn.parentNode !== pos.parent) { try { btn.remove(); } catch (e) {} btn = null; }
			if (!btn) {
				btn = document.createElement('div');
				btn.className = 'rs-ord-btn ti ti-dots';
				btn.setAttribute('data-guid', pos.guid);
				/* inside a scroller: absolute + modest z so sticky bars cover
				 * it naturally; body fallback keeps the old fixed behaviour */
				if (pos.parent === document.body) {
					btn.style.position = 'fixed';
					btn.style.zIndex = '9000';
				} else {
					btn.style.position = 'absolute';
					btn.style.zIndex = '5';
				}
				btn.addEventListener('click', () => this.openOrderMenu(btn).catch(() => {}));
				pos.parent.appendChild(btn);
				this.orderBtns.set(key, btn);
			}
			btn.setAttribute('data-guid', pos.guid);
			/* PLACE-MEASURE-CORRECT: shift current offsets by the viewport
			 * error, whatever coordinate space the parent uses. Skip sub-pixel
			 * deltas so the steady state writes no styles at all. */
			const br = btn.getBoundingClientRect();
			const dx = pos.x - br.left;
			const dy = pos.y - br.top;
			if (Math.abs(dx) > 0.5) btn.style.left = ((parseFloat(btn.style.left) || 0) + dx) + 'px';
			if (Math.abs(dy) > 0.5) btn.style.top = ((parseFloat(btn.style.top) || 0) + dy) + 'px';
			if (btn.style.height !== (pos.h || 20) + 'px') btn.style.height = (pos.h || 20) + 'px';
			seen.add(key);
		}
		for (const [key, btn] of this.orderBtns) {
			if (!seen.has(key)) { try { btn.remove(); } catch (e) {} this.orderBtns.delete(key); }
		}
	}

	async openOrderMenu(btn) {
		const guid = btn.getAttribute('data-guid');
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const headSt = byGuid[guid];
		if (!headSt || !headSt.rguid) return;
		const pl = await this.pageLines(headSt.rguid);
		const headLi = pl && pl.byG.get(guid);
		if (!headLi) return;
		const t = { headSt, headLi, pl };

		document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
		const menu = document.createElement('div');
		menu.className = 'rs-repmenu rs-ordmenu';
		/* His mock (2026-08-08): mode rows are plain text, the active one gets a
		 * quiet row fill; status rows carry their collector's flag icon and an
		 * ENABLED status is accent-coloured — no checkmarks, no controls. The
		 * whole row is the click target. */
		const esc2 = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
		const row = (attr, cls, icon, label) =>
			'<div class="rs-om-row' + (cls ? ' ' + cls : '') + '" ' + attr + '>'
			+ (icon ? '<span class="rs-om-ic ti ' + icon + '"></span>' : '')
			+ '<span>' + label + '</span></div>';
		/* the LOCAL conf is the menu's source of truth while it is open — a
		 * re-read from props right after our own write can serve the OLD value
		 * (the transient-props story), which repainted stale state */
		let conf = this.orderConfOf(headSt) || { m: 'g', k: [] };
		const paint = () => {
			let html = row('data-m="g"', conf.m === 'g' ? 'rs-om-cur' : '', null, 'Group by Status')
				+ row('data-m="h"', conf.m === 'h' ? 'rs-om-cur' : '', null, 'Group by Hashtags')
				+ row('data-m="s"', conf.m === 's' ? 'rs-om-cur' : '', null, 'Order by Status')
				+ '<div class="rs-om-sep"></div>';
			if (conf.m === 'g') {
				html += ORDER_BINS.map((b) => row('data-k="' + b.key + '"', conf.k.indexOf(b.key) >= 0 ? 'rs-on' : '', b.icon, b.label)).join('');
			} else if (conf.m === 'h') {
				/* the ⌘1-9 slots from settings, in slot order — never other
				 * hashtags — plus the same Tasks/Done closers as group mode */
				html += (this.tbSlots || []).map((s) =>
					row('data-k="' + esc2(s.tag) + '"', conf.k.indexOf(s.tag) >= 0 ? 'rs-on' : '', 'ti-tag', esc2(s.title || s.tag.slice(1)))).join('');
				html += row('data-k="tasks"', conf.k.indexOf('tasks') >= 0 ? 'rs-on' : '', 'ti-checkbox', 'Todo');
				html += row('data-k="done"', conf.k.indexOf('done') >= 0 ? 'rs-on' : '', 'ti-check', 'Done');
			} else {
				/* the Done row wears the same icon + accent treatment as its
				 * group-mode sibling (his call) */
				html += row('data-k="done"', conf.k.indexOf('done') >= 0 ? 'rs-on' : '', 'ti-check', 'Done group at the bottom');
			}
			html += '<div class="rs-om-sep"></div>' + row('data-k="__off"', '', null, 'Turn off ordering');
			menu.innerHTML = html;
		};
		paint();
		document.body.appendChild(menu);
		const br = btn.getBoundingClientRect();
		const mh = menu.offsetHeight;
		const top = br.bottom + 4 + mh > window.innerHeight - 8 ? br.top - mh - 4 : br.bottom + 4;
		menu.style.top = Math.max(8, top) + 'px';
		menu.style.left = Math.max(8, Math.min(br.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
		this.repMenu = menu;
		const outside = (e) => { if (!menu.contains(e.target)) close(); };
		/* Enter finishes the multi-pick (his suggestion); Escape too when it
		 * reaches us (Electron can swallow it before any JS — playbook §8).
		 * Window capture, because the menu never holds focus. */
		const keys = (e) => {
			if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
		};
		const close = () => {
			document.removeEventListener('pointerdown', outside, true);
			window.removeEventListener('keydown', keys, true);
			menu.remove();
			if (this.repMenu === menu) this.repMenu = null;
		};
		setTimeout(() => {
			document.addEventListener('pointerdown', outside, true);
			window.addEventListener('keydown', keys, true);
		}, 0);
		/* The menu STAYS OPEN while picking status rows and switching modes —
		 * closing on the first pick forced a reopen per status (his report).
		 * It closes on: Turn off ordering, Enter, Escape, outside click.
		 * Clicking the already-active mode does NOTHING (his call — v0.15.x
		 * turned ordering off there, which kept surprising him); only Turn
		 * off ordering turns it off. Writes are serialized through a promise
		 * chain so rapid picks cannot interleave dissolve/organize passes. */
		let applying = Promise.resolve();
		const apply = () => {
			const c = { m: conf.m, k: conf.k.slice() };
			applying = applying.then(() => this.setOrderConf(t, c)).catch(() => {});
		};
		menu.addEventListener('click', (e) => {
			const r = e.target.closest('.rs-om-row');
			if (!r) return;
			const m = r.getAttribute('data-m');
			const k = r.getAttribute('data-k');
			if (k === '__off') {
				close();
				applying = applying.then(() => this.setOrderConf(t, null)).catch(() => {});
				return;
			}
			if (m) {
				if (m === conf.m) return;
				/* carry what translates: sort keeps only the Done group; the
				 * two group modes start from their full row sets */
				conf = m === 's'
					? { m: 's', k: conf.k.indexOf('done') >= 0 ? ['done'] : [] }
					: m === 'h'
						? { m: 'h', k: (this.tbSlots || []).map((s) => s.tag).concat(['tasks', 'done']) }
						: { m: 'g', k: ORDER_BINS.map((b) => b.key) };
				paint();
				apply();
				return;
			}
			if (!k) return;
			conf = { m: conf.m, k: conf.k.indexOf(k) >= 0 ? conf.k.filter((x) => x !== k) : conf.k.concat([k]) };
			paint();
			apply();
		});
	}

	/* Recurring lines get a repeat glyph in front of their date.
	 *
	 * The glyph is driven ENTIRELY from a stylesheet the plugin owns, keyed on
	 * each line's data-guid. Nothing on the line is touched — no inserted node
	 * (v0.9.0, which broke caret offsets) and no class on Thymer's chip (v0.9.2,
	 * which flickered: the editor re-renders the chip on every keystroke and
	 * drops the class, and the observer put it back a frame later, so the glyph
	 * blinked once per character). A stylesheet cannot be undone by a re-render,
	 * so it needs no observer and does no work while you type. */
	refreshRepeatStyle() {
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const has = new Set();
		for (const g in byGuid) {
			const st = byGuid[g];
			if (st && st.props && (st.props.rs_recur || st.props.rs_series)) has.add(g);
		}
		/* The session cache overrides the scan in both directions: props can
		 * transiently lose rs_recur on the client that just WROTE to the line
		 * (his desktop-loses-the-glyph-after-ticking report; mobile kept it). */
		if (this.recurKnown) {
			for (const [g, r] of this.recurKnown) { if (r) has.add(g); else has.delete(g); }
		}
		const guids = [...has];
		/* EMBEDS: a transclusion / block-ref is a REAL line whose props.itemref
		 * points at the target. The embedded copy renders under the EMBED
		 * line's own guid, so the target-keyed selector never matches it (his
		 * report: no glyph on an embedded repeating task). Map itemref → target
		 * exactly like the virtual rows below, but over itemsByGuid. Trashed
		 * transclusions linger in the map with flags — skip them. */
		for (const g in byGuid) {
			const st = byGuid[g];
			if (!st || st.is_trashed || st.is_deleted) continue;
			const ref = st.props && st.props.itemref;
			if (ref && has.has(ref)) guids.push(g);
		}
		/* A live search renders VIRTUAL rows: an ephemeral V-guid that is NEVER
		 * in itemsByGuid (the universe asserts is_virtual==false before adding),
		 * with props.itemref pointing at the real line. The chip the user sees
		 * carries the V-guid, so a stylesheet keyed on real guids misses every
		 * recurring line inside a search. The virtual states live in each
		 * listview's containers[].items_by_guid; map them through itemref. */
		try {
			for (const lv of (window.g_universe && window.g_universe.listviews) || []) {
				const containers = lv.containers || (lv.container ? [lv.container] : []);
				for (const c of containers) {
					const map = c.items_by_guid || {};
					for (const vg in map) {
						const st = map[vg] && map[vg].state;
						const ref = st && st.is_virtual && st.props && st.props.itemref;
						if (ref && has.has(ref)) guids.push(vg);
					}
				}
			}
		} catch (e) {}
		/* ::before belongs on EVERY selector, not just the last one. Appending it
		 * to the joined string put the icon-font and 82% size on the CHIPS of all
		 * but the final line, so their dates rendered tiny and unstyled.
		 *
		 * Three surfaces, one stylesheet:
		 *   1. editor lines — glyph before the date chip
		 *   2. Tasks view rows WITH a due pill — the pill's calendar icon
		 *      becomes the repeat icon (his ask: "i Due date-chippet")
		 *   3. Tasks view rows WITHOUT a pill (the view hides future dues in
		 *      Today scope, and the row stays because the line lives on today's
		 *      journal page) — glyph after the title, or nothing shows at all */
		/* position:relative + top nudges the glyph down onto the text baseline —
		 * the icon font centres its glyphs in the em box, so at .82em next to
		 * the chip text it rides visibly high (his screenshot) */
		const css = guids.length
			? guids.map((g) => '.listitem[data-guid="' + g + '"] span.lineitem-datetime::before').join(',\n')
				+ "{font-family:'tabler-icons';content:'\\f16d';margin-right:4px;font-size:.82em;opacity:.85;position:relative;top:.07em}\n"
			+ guids.map((g) => '.tasks-view-date-pill[data-guid="' + g + '"] .ti-calendar-due::before').join(',\n')
				+ "{content:'\\f16d'}\n"
			+ guids.map((g) => '.tasks-view-row.has-no-due[data-guid="' + g + '"] .tasks-view-title::after').join(',\n')
				+ "{font-family:'tabler-icons';content:'\\f16d';margin-left:6px;font-size:.82em;opacity:.7;position:relative;top:.07em}"
			: '';
		if (this.repStyle && this.repStyle.textContent !== css) this.repStyle.textContent = css;
	}

	/* Remove the date entirely, the way native's Clear does. */
	async clearDate(t) {
		if (t.kind === 'record') {
			const rec = this.data.getRecord(t.guid);
			const prop = rec && rec.prop(DUE_DATE_FIELD);
			if (!prop) { this.toast('No ' + DUE_DATE_FIELD + ' field to clear.'); return; }
			/* Verified live: set([]) clears. set(null) is a NO-OP that silently
			 * leaves the old date, and setFromDate(null) sets it to NOW. */
			prop.set([]);
			this.toast(DUE_DATE_FIELD + ' cleared');
			return;
		}
		const li = await this.lineItem(t.line);
		if (!li) { this.toast('Could not read that line.'); return; }
		const segs = li.segments.map((s) => ({ type: s.type, text: s.text }));
		const i = segs.findIndex((s) => s.type === 'datetime');
		if (i < 0) { this.toast('No date on that line.'); return; }
		segs.splice(i, 1);
		this.healGap(segs, i);
		/* no date left, nothing to repeat — and the rule goes FIRST: the segment
		 * write must be the LAST write to the line (doctrine), or the second
		 * render lands after the caret work */
		await this.writeRule(li, null);
		await li.setSegments(segs);
		try {
			const plc = await this.pageLines(t.line.pageGuid);
			if (plc) this.reconcileLineSeries(plc.rec, li, null, 0).catch(() => {});
		} catch (e2) {}
		this.refreshRepeatStyle();
		if (!t.line.noCaret) await this.restoreCaret(t.line.domGuid || t.line.lineGuid, t.line.caret);
		this.toast('Date cleared');
	}

	// ---- the commands -------------------------------------------------------

	async shift(days) {
		const t = this.dateTarget();
		if (!t) { this.toast('Put the caret on a line, or focus a row in a collection view.'); return; }
		if (t.err) { this.toast(t.err); return; }

		const cur = this.currentDate(t);
		let next;
		if (cur) {
			next = this.shiftValue(cur.value(), days);
			if (!next) { this.toast('That date is a time with no day, so there is nothing to move.'); return; }
		} else {
			next = this.fromToday(days);
		}
		await this.writeDate(t, next);
	}

	/* Timeblocks always belong to the LINE — a page has no timeblock. An existing
	 * timeblock tag is swapped IN PLACE: wherever you put it, mid-sentence or
	 * before the date, it stays there. (Filtering it out and appending the new
	 * one instead walked the tag to the end of the line and left its old
	 * separating space behind, so the gap grew by one space per press.) Other
	 * hashtags (#recurring and the rest) are never touched. Pressing the same
	 * one again clears it. */
	async setTimeblock(tb) {
		const line = this.lineSelection();
		if (line && line.recordGuid) { this.toast('That row is a page, and timeblocks live on lines.'); return; }
		if (!line || !line.lineGuid || !line.pageGuid) { this.toast('Put the caret on a line first.'); return; }
		const li = await this.lineItem(line);
		if (!li) { this.toast('Could not read that line.'); return; }

		const segs = li.segments.map((s) => ({ type: s.type, text: s.text }));
		const i = segs.findIndex((s) => s.type === 'hashtag' && this.timeblockTags.has(s.text));

		let cleared = false;
		const created = i < 0;
		if (i < 0) {
			if (this.needsGap(segs, segs.length)) segs.push({ type: 'text', text: ' ' });
			segs.push({ type: 'hashtag', text: tb.tag }, { type: 'text', text: ' ' });
		} else if (segs[i].text === tb.tag) {
			segs.splice(i, 1);
			this.healGap(segs, i);
			cleared = true;
		} else {
			segs[i] = { type: 'hashtag', text: tb.tag };
			if (i === segs.length - 1) segs.push({ type: 'text', text: ' ' });
		}

		await li.setSegments(segs);
		/* Same rule as dates: reposition only when the tag is NEW. Swapping one
		 * timeblock for another leaves the caret exactly where it was. */
		const dom = line.domGuid || line.lineGuid;
		if (!line.noCaret) {
			if (created) await this.placeCaret(dom, 'hashtag', tb.tag);
			else await this.restoreCaret(dom, line.caret);
		}
		this.toast(cleared ? 'Timeblock cleared' : tb.label);
	}

	/* Close the hole left by removing a segment: join the text on either side
	 * without doubling the space, and drop a separator left dangling at the end
	 * of the line. Without this, clearing a timeblock leaves trailing blanks that
	 * the next one is appended after. */
	healGap(segs, i) {
		if (i > 0 && i < segs.length && segs[i - 1].type === 'text' && segs[i].type === 'text') {
			const a = segs[i - 1].text;
			const b = /\s$/.test(a) ? segs[i].text.replace(/^\s/, '') : segs[i].text;
			segs[i - 1].text = a + b;
			segs.splice(i, 1);
		}
		const last = segs[segs.length - 1];
		if (last && last.type === 'text' && /^\s*$/.test(last.text)) segs.pop();
	}

	// ---- the date box -------------------------------------------------------

	/* The calendar is built from Thymer's OWN datepicker markup and class names
	 * (.datepicker-wrapper > .datepicker-calendar > .datepicker-header /
	 * -weekdays / -days, day cells as <div class="day current-month selected
	 * today"><span class="day-inner">), because those rules live in the app's
	 * global stylesheet and are not scoped to a shadow root. Reusing them means
	 * Thymer styles this picker itself — verified live: with the wrapper present
	 * the cells pick up --day-height, the selected day gets
	 * --button-primary-bg-color and today gets --text-hilite. Style nothing here
	 * that Thymer already styles, or the two will drift apart on a theme change.
	 * `.datepicker-compact` is the in-menu density, which is what the native
	 * "Assign due date" popup uses. */
	openPicker() {
		this.closePicker();
		const t = this.dateTarget();
		if (!t) { this.toast('Put the caret on a line, or focus a row in a collection view.'); return; }
		if (t.err) { this.toast(t.err); return; }

		const pop = document.createElement('div');
		pop.className = 'rs-pop';
		/* the wrapper lives INSIDE the popup, never on it: .datepicker-compact
		 * carries width:100% and would otherwise stretch the box to the window */
		pop.innerHTML = `
			<div class="rs-head"></div>
			<input class="rs-input" type="text" spellcheck="false" placeholder="today, Aug 1, monday 3pm">
			<div class="datepicker-wrapper datepicker-compact"><div class="datepicker-calendar">
				<div class="datepicker-header">
					<span class="current-month" style="flex:1"></span>
					<span style="display:flex; gap:10px">
						<button class="button-none button-small button-minimal-hover prev-month"><span class="ti ti-chevron-left"></span></button>
						<button class="button-none button-small button-minimal-hover go-to-today"><span class="ti ti-point"></span></button>
						<button class="button-none button-small button-minimal-hover next-month"><span class="ti ti-chevron-right"></span></button>
					</span>
				</div>
				<div class="datepicker-weekdays"></div>
				<div class="datepicker-days"></div>
				<div class="datepicker-time">
					<div class="rs-timerow">
						<div class="rs-timetoggle">
							<input-switch class="rs-switch switch-compact"></input-switch>
							<span class="rs-timelbl">Set time</span>
							<input class="rs-time" type="time" style="display:none">
						</div>
						<div class="button-minimal-hover button-none button-small rs-addend">+ End date</div>
					</div>
				</div>
			</div></div>
			<div class="rs-reprow rs-repbtn">
				<span style="opacity:.6">Repeat</span>
				<span class="rs-repval"><span class="rs-repnow"></span><span class="ti ti-chevron-right" style="opacity:.45"></span></span>
			</div>
			<div class="rs-custom" style="display:none">
				<label><span>Frequency</span><span class="rs-sel rs-freq" data-v="d"><span class="rs-sel-lbl">Daily</span><span class="ti ti-chevron-down"></span></span></label>
				<label><span>Every</span><input class="rs-int" type="number" min="1" max="99" value="1"><span class="rs-unit">days</span></label>
				<div class="rs-gram rs-gram-w" style="display:none"><div class="rs-days"></div></div>
				<div class="rs-gram rs-gram-m" style="display:none">
					<label><input type="radio" name="rs-mmode" value="each" checked>Each</label>
					<div class="rs-mdays"></div>
					<label><input type="radio" name="rs-mmode" value="ord">On the</label>
					<div class="rs-ordrow rs-mordrow">
						<span class="rs-sel rs-mord" data-v="1"><span class="rs-sel-lbl">first</span><span class="ti ti-chevron-down"></span></span>
						<span class="rs-sel rs-mod" data-v="day"><span class="rs-sel-lbl">day</span><span class="ti ti-chevron-down"></span></span>
					</div>
				</div>
				<div class="rs-gram rs-gram-y" style="display:none">
					<div class="rs-months"></div>
					<label><input type="checkbox" class="rs-ycheck">On the</label>
					<div class="rs-ordrow rs-yordrow">
						<span class="rs-sel rs-yordsel" data-v="1"><span class="rs-sel-lbl">first</span><span class="ti ti-chevron-down"></span></span>
						<span class="rs-sel rs-yod" data-v="day"><span class="rs-sel-lbl">day</span><span class="ti ti-chevron-down"></span></span>
					</div>
				</div>
				<label class="rs-fromrow" title="Day selections always repeat on schedule — Count from applies to plain intervals only"><span>Count From</span><span class="rs-sel rs-from" data-v="a"><span class="rs-sel-lbl">The Due Date</span><span class="ti ti-chevron-down"></span></span></label>
				<label title="When the SERIES stops. + End date up top is different: it makes each occurrence a date RANGE."><span>End Repeat</span><span class="rs-sel rs-endsel" data-v=""><span class="rs-sel-lbl">Never</span><span class="ti ti-chevron-down"></span></span><input class="rs-cnt" type="number" min="1" max="100" value="3" style="display:none"><input class="rs-until" type="text" spellcheck="false" style="display:none"></label>
				<label class="rs-trailrow" title="Backwards keeps a completed copy each time you tick. Forward lays out every future occurrence up front (needs Until, schedule-based rules only)."><span>Leave a Trail</span><span class="rs-sel rs-trail" data-v=""><span class="rs-sel-lbl">Off</span><span class="ti ti-chevron-down"></span></span></label>
			</div>
			<div class="rs-foot">
				<span class="rs-result"></span>
				<span class="button-none button-small button-minimal-hover rs-clear">Clear</span>
			</div>`;
		pop.querySelector('.rs-head').textContent = this.targetLabel(t);
		document.body.appendChild(pop);
		this.pop = pop;

		const input = pop.querySelector('.rs-input');
		const timeInput = pop.querySelector('.rs-time');
		const sw = pop.querySelector('.rs-switch');
		const cur = this.currentDate(t);

		/* Preselect: the date already set, else TODAY — so opening the box and
		 * pressing Enter schedules today without touching the mouse. */
		const start = cur || new DateTime(new Date());
		const sp = start.getParts();
		this.view = { y: sp.year, m: sp.month };
		this.sel = cur || DateTime.dateOnly(sp.year, sp.month, sp.day);
		this.endMode = false;
		this.rangeEnd = cur ? cur.getRangeEnd() : null;
		if (cur && sp.hours !== undefined) {
			sw.checked = true;
			timeInput.style.display = '';
			timeInput.value = String(sp.hours).padStart(2, '0') + ':' + String(sp.minutes || 0).padStart(2, '0');
		}

		let committed = false;
		const commit = (dt) => {
			if (committed) return; /* one box, one write */
			committed = true;
			/* capture the repeat rule BEFORE closePicker clears the picker state */
			t.pendingRule = this.rule ? { ...this.rule } : null;
			t.ruleTouched = true;
			this.closePicker();
			this.writeDate(t, dt).catch((e) => this.toast('Failed: ' + ((e && e.message) || e)));
		};

		/* Closing WITHOUT committing must put the caret back. The box stole
		 * focus when it opened, and an Escape that merely removes it leaves the
		 * editor dead (his report: cannot type until the line is clicked) — and
		 * the NEXT open then has no on-screen caret to anchor to, so place()
		 * falls back to the panel's top-left corner. The caret was captured in
		 * dateTarget() while it was still live; put it back. Commits do not come
		 * through here — writeDate does its own caret work. */
		this.cancelPicker = () => {
			const line = t.kind === 'line' ? t.line : null;
			this.closePicker();
			if (line && !line.noCaret) this.restoreCaret(line.domGuid || line.lineGuid, line.caret);
		};

		/* Whatever is picked or typed, the time toggle and the end date are
		 * re-applied on top, so switching one never silently drops the others. */
		const compose = () => {
			if (!this.sel) return null;
			const p = this.sel.getParts();
			if (p.year === undefined) return this.sel;
			let dt = DateTime.dateOnly(p.year, p.month, p.day);
			if (sw.checked && timeInput.value) {
				const [hh, mm] = timeInput.value.split(':').map(Number);
				dt = DateTime.dateAndTime(p.year, p.month, p.day, hh || 0, mm || 0, 0);
			}
			if (this.rangeEnd) dt.setRangeEnd(this.rangeEnd);
			return dt;
		};

		const show = () => {
			this.renderCal(pop);
			const dt = compose();
			const res = pop.querySelector('.rs-result');
			/* The field itself mirrors the selection (as its PLACEHOLDER, so the
			 * value stays empty — a real value would stop ←/→ driving the
			 * calendar and would have to be cleared before typing). He read the
			 * static syntax hint as a wrong date; the selection is more useful. */
			if (!input.value) input.placeholder = dt ? this.label(dt) : 'today, Aug 1, monday 3pm';
			if (this.endMode) {
				/* the OLD placement of this hint was inside the no-date branch, which
				 * never runs (today is always preselected) — so arming end-date mode
				 * gave no feedback at all and read as a dead button (his report) */
				res.textContent = 'Pick the end date in the calendar';
				res.classList.add('rs-bad');
			} else if (dt) {
				res.textContent = this.label(dt) + (this.rangeEnd ? ' → ' + this.label(this.rangeEnd) : '');
				res.classList.remove('rs-bad');
			} else {
				res.textContent = input.value.trim() ? 'Not a date' : 'Pick a day or type a date';
				res.classList.add('rs-bad');
			}
			const addend = pop.querySelector('.rs-addend');
			addend.textContent = this.rangeEnd ? '− End date' : '+ End date';
			addend.classList.toggle('rs-armed', this.endMode);
			pop.querySelector('.rs-clear').style.display = cur ? '' : 'none';
		};
		this.showPicker = show;

		input.addEventListener('input', () => {
			const raw = input.value.trim();
			const parsed = raw ? DateTime.parseDateTimeString(raw)
				: (cur || DateTime.dateOnly(sp.year, sp.month, sp.day));
			if (parsed) {
				const p = parsed.getParts();
				if (p.year !== undefined) this.view = { y: p.year, m: p.month };
				/* typing "monday 3pm" should flip the time switch on by itself */
				if (p.hours !== undefined) {
					sw.checked = true;
					timeInput.style.display = '';
					timeInput.value = String(p.hours).padStart(2, '0') + ':' + String(p.minutes || 0).padStart(2, '0');
				}
			}
			/* Always mirror what is typed. Latching the range end here is what made
			 * "Aug 5" produce Aug 1–31: the keystrokes pass through "Aug", which
			 * parses as a whole-month RANGE, and the end date then survived into
			 * the finished single date. "5 aug" never passes through a range,
			 * which is why that spelling looked fine. */
			this.rangeEnd = parsed ? parsed.getRangeEnd() : null;
			this.sel = parsed;
			show();
		});
		const ARROWS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
		/* Enter and Escape are handled on WINDOW (capture), not on the box: the
		 * native macOS <select> menu can close WITHOUT firing change (Esc, or
		 * re-picking the same value), and focus then ends up on <body> — a
		 * handler on the box never sees those keys, which is exactly "Enter goes
		 * dead after using Custom". On window it commits no matter where focus
		 * fell. Removed in closePicker. */
		this.popKeys = (e) => {
			if (!this.pop) return;
			if (e.key !== 'Enter' && e.key !== 'Escape') return;
			e.stopPropagation();
			if (e.key === 'Escape') {
				e.preventDefault();
				/* an armed end-date mode is a sub-state: Escape backs out of IT
				 * first, and only a second Escape closes the box */
				if (this.endMode) { this.endMode = false; show(); return; }
				this.cancelPicker();
				return;
			}
			e.preventDefault();
			const dt = compose();
			if (dt) commit(dt);
		};
		window.addEventListener('keydown', this.popKeys, true);

		/* Enter and Escape live on the window handler above — do NOT also handle
		 * them here, or one keypress commits twice and the second pass overwrites
		 * the first with the state the first one already cleared. */
		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter' || e.key === 'Escape') return;
			/* Arrows walk the calendar: ←/→ a day, ↑/↓ a week. Left and right are
			 * left alone once something is typed, so the text field stays
			 * editable; up and down never do anything useful in a one-line field
			 * so they always drive the calendar. */
			const step = ARROWS[e.key];
			if (step === undefined) return;
			const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
			if (horizontal && input.value.length) return;
			e.preventDefault();
			const base = this.sel && this.sel.getParts().year !== undefined ? this.sel : new DateTime(new Date());
			const moved = this.shiftParts(base, step);
			if (!moved) return;
			this.sel = moved;
			const p = moved.getParts();
			this.view = { y: p.year, m: p.month };
			show();
		}, true);

		pop.querySelector('.datepicker-header').addEventListener('click', (e) => {
			const b = e.target.closest('button');
			if (!b) return;
			if (b.classList.contains('go-to-today')) { const d = new Date(); this.view = { y: d.getFullYear(), m: d.getMonth() }; }
			else {
				const d = new Date(this.view.y, this.view.m + (b.classList.contains('prev-month') ? -1 : 1), 1);
				this.view = { y: d.getFullYear(), m: d.getMonth() };
			}
			show();
		});

		pop.querySelector('.datepicker-days').addEventListener('click', (e) => {
			const cell = e.target.closest('.day[data-date]');
			if (!cell) return;
			const [y, m, d] = cell.getAttribute('data-date').split('-').map(Number);
			if (this.endMode) {
				this.rangeEnd = DateTime.dateOnly(y, m - 1, d);
				this.endMode = false;
				this.endPickedAt = Date.now();
				show();
				return;
			}
			/* the SECOND click of a double that just picked the end date must not
			 * fall through here — it would move the START to the end day and
			 * commit a collapsed range */
			if (e.detail >= 2 && this.endPickedAt && Date.now() - this.endPickedAt < 500) return;
			/* Clicking a day only SELECTS it. Committing on the click made Repeat
			 * unreachable with a mouse — the box was already gone. Enter commits,
			 * and so does a double click for anyone who never leaves the trackpad. */
			this.sel = DateTime.dateOnly(y, m - 1, d);
			show();
			if (e.detail >= 2) { const dt = compose(); if (dt) commit(dt); }
		});

		sw.addEventListener('change', () => {
			timeInput.style.display = sw.checked ? '' : 'none';
			if (sw.checked && !timeInput.value) timeInput.value = '09:00';
			show();
		});
		pop.querySelector('.rs-timelbl').addEventListener('click', () => {
			sw.checked = !sw.checked;
			sw.dispatchEvent(new Event('change'));
		});
		timeInput.addEventListener('input', show);
		/* + End date arms the mode (and shows it); clicking again disarms; once an
		 * end is set the same control reads "− End date" and removes it — there
		 * was previously no way to undo an end date short of retyping. */
		pop.querySelector('.rs-addend').addEventListener('click', () => {
			if (this.rangeEnd) { this.rangeEnd = null; this.endMode = false; }
			else this.endMode = !this.endMode;
			show();
		});
		pop.querySelector('.rs-clear').addEventListener('click', () => {
			this.closePicker();
			this.clearDate(t).catch((e) => this.toast('Failed: ' + ((e && e.message) || e)));
		});

		/* ---- Repeat ---------------------------------------------------- */
		const repBtn = pop.querySelector('.rs-repbtn');
		const custom = pop.querySelector('.rs-custom');
		const freq = pop.querySelector('.rs-freq');
		const trailSel = pop.querySelector('.rs-trail');
		const intv = pop.querySelector('.rs-int');
		const from = pop.querySelector('.rs-from');
		const UNITS = { d: 'day', w: 'week', m: 'month', y: 'year' };
		const FREQOPTS = [['d', 'Daily'], ['w', 'Weekly'], ['m', 'Monthly'], ['y', 'Yearly']];
		const FROMOPTS = [['a', 'The Due Date'], ['c', 'When I Tick It']];
		const TRAILOPTS = [['', 'Off'], ['b', 'Completed Copies Stay'], ['f', 'Lay Out All Occurrences']];
		const ORDOPTS = [['1', 'first'], ['2', 'second'], ['3', 'third'], ['4', 'fourth'], ['5', 'fifth'], ['-2', 'next to last'], ['-1', 'last']];
		const ODOPTS = [['day', 'day'], ['weekday', 'weekday'], ['weekendday', 'weekend day'],
			['0', 'Monday'], ['1', 'Tuesday'], ['2', 'Wednesday'], ['3', 'Thursday'], ['4', 'Friday'], ['5', 'Saturday'], ['6', 'Sunday']];
		const odParse = (v) => (v === 'day' || v === 'weekday' || v === 'weekendday') ? v : +v;
		const selVal = (el) => el.getAttribute('data-v');
		const setSel = (el, v, opts) => {
			const o = opts.find((x) => x[0] === v) || opts[0];
			el.setAttribute('data-v', o[0]);
			el.querySelector('.rs-sel-lbl').textContent = o[1];
		};
		/* the three multi-select grids; single letters for days, like Apple's */
		pop.querySelector('.rs-days').innerHTML = RECUR_DAYNAMES.map((d, i) => '<div class="rs-cell" data-i="' + i + '">' + d[0] + '</div>').join('');
		let mdHtml = '';
		for (let d2 = 1; d2 <= 31; d2++) mdHtml += '<div class="rs-cell" data-i="' + d2 + '">' + d2 + '</div>';
		pop.querySelector('.rs-mdays').innerHTML = mdHtml;
		pop.querySelector('.rs-months').innerHTML = RECUR_MONTHNAMES.map((m2, i) => '<div class="rs-cell" data-i="' + i + '">' + m2 + '</div>').join('');
		this.rule = t.kind === 'line' ? this.readRule(t.line)
			: (this.pageRules && this.pageRules[t.guid] ? { ...this.pageRules[t.guid] } : null);
		/* Recurrence is scoped to LINES; a page's Due Date cannot repeat. With the
		 * row visible on a record target, a rule could be set and was then thrown
		 * away silently on commit — writeDate's record branch has nowhere to put
		 * it. Hide the row instead of lying. */
		/* records repeat too — the panel carries per-page field pickers (his
		 * call 2026-08-09: per-collection wiring was the wrong shape; a
		 * chooser stays, per page for now) */
		if (t.kind === 'record') this.wirePageRows(pop, t).catch(() => {});

		const paintRepeat = () => {
			/* the value is ALWAYS shown, "Never" included, and styled as a button so
			 * it reads as the current setting you can change rather than a label —
			 * and a real rule lights up in the accent (his request) */
			const now = pop.querySelector('.rs-repnow');
			now.textContent = recurLabel(this.rule)
				+ (this.rule && this.rule.aftN && !this.rule.u ? ', ' + this.rule.aftN + ' times' : '');
			now.classList.toggle('rs-set', !!(this.rule && this.rule.f));
			const n = Math.max(1, (this.rule && this.rule.n) || 1);
			pop.querySelector('.rs-unit').textContent = UNITS[(this.rule && this.rule.f) || 'd'] + (n === 1 ? '' : 's');
		};
		const openRepeatMenu = () => {
			document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
			const menu = document.createElement('div');
			menu.className = 'rs-repmenu';
			const presets = [['', 'Never'], ['d', 'Every Day'], ['w', 'Every Week'], ['m', 'Every Month'], ['y', 'Every Year']];
			const cur = this.rule || {};
			/* a preset row is "on" only for the PLAIN version of its frequency; any
			 * grammar (weekdays, month days, ordinals, until, interval, mode)
			 * belongs to Custom */
			const plain = (cur.n || 1) === 1 && !cur.from && !cur.wd && !cur.md && !cur.mo && !cur.ord && !cur.u;
			menu.innerHTML = presets.map(([f, lbl]) =>
				'<div data-f="' + f + '"' + ((cur.f || '') === f && plain ? ' class="rs-on"' : '') + '>' + lbl + '</div>').join('')
				+ '<div data-f="custom"' + (cur.f && !plain ? ' class="rs-on"' : '')
				+ ' style="border-top:1px solid rgba(127,127,127,.25); margin-top:3px; padding-top:6px">Custom…</div>';
			document.body.appendChild(menu);
			const br = repBtn.getBoundingClientRect();
			const mh = menu.offsetHeight;
			const top = br.bottom + 4 + mh > window.innerHeight - 8 ? br.top - mh - 4 : br.bottom + 4;
			menu.style.top = Math.max(8, top) + 'px';
			menu.style.left = Math.max(8, Math.min(br.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + 'px';
			this.repMenu = menu;
			menu.addEventListener('click', (e) => {
				const row = e.target.closest('div[data-f]');
				if (!row) return;
				const f = row.getAttribute('data-f');
				if (f === 'custom') {
					if (!this.rule) this.rule = { f: 'd', n: 1 };
					custom.style.display = '';
					primeCustom(this.rule);
				} else {
					this.rule = f ? { f, n: 1 } : null;
					custom.style.display = 'none';
				}
				menu.remove();
				paintRepeat();
				/* deliberately NOT re-placing the box: place() re-anchors to the
				 * caret, and by now the caret element has moved or gone, so the box
				 * jumped across the screen. Position once, on open, and let it grow
				 * downward. */
				this.fit(pop);
				input.focus({ preventScroll: true });
			});
		};
		repBtn.addEventListener('click', openRepeatMenu);

		const until = pop.querySelector('.rs-until');
		const mOrdRadio = pop.querySelector('input[name="rs-mmode"][value="ord"]');
		const mEachRadio = pop.querySelector('input[name="rs-mmode"][value="each"]');
		const yCheck = pop.querySelector('.rs-ycheck');

		/* Show the grammar section for the chosen frequency, grey the half of the
		 * monthly/yearly choice that is not active, and hide the lot in
		 * count-from-completion mode, where the engine ignores day selections. */
		const updateGrammar = () => {
			const f = selVal(freq);
			const fromC = selVal(from) === 'c';
			pop.querySelector('.rs-gram-w').style.display = !fromC && f === 'w' ? '' : 'none';
			pop.querySelector('.rs-gram-m').style.display = !fromC && f === 'm' ? '' : 'none';
			pop.querySelector('.rs-gram-y').style.display = !fromC && f === 'y' ? '' : 'none';
			pop.querySelector('.rs-mdays').classList.toggle('rs-dim', mOrdRadio.checked);
			pop.querySelector('.rs-mordrow').classList.toggle('rs-dim', !mOrdRadio.checked);
			pop.querySelector('.rs-yordrow').classList.toggle('rs-dim', !yCheck.checked);
			/* Grammar and count-from-completion are mutually exclusive: 'c' counts
			 * a plain interval from the tick day, so the engine ignores every day
			 * selection. The grammar already hides in 'c' mode; the mirror image
			 * is dimming Count from once ANY day selection exists — it is
			 * effectively locked to "the due date" then. */
			const hasGrammar = !fromC && (
				(f === 'w' && !!pop.querySelector('.rs-days .rs-cell.is-on'))
				|| (f === 'm' && (mOrdRadio.checked || !!pop.querySelector('.rs-mdays .rs-cell.is-on')))
				|| (f === 'y' && (yCheck.checked || !!pop.querySelector('.rs-months .rs-cell.is-on'))));
			pop.querySelector('.rs-fromrow').classList.toggle('rs-dim', hasGrammar);
			this.fit(pop);
		};

		/* Rebuild the rule from every control. Empty selections are LEFT OUT, so
		 * the engine falls back to the anchor day, same as before. */
		const syncCustom = () => {
			const f = selVal(freq);
			const rule = { f, n: Math.max(1, parseInt(intv.value, 10) || 1) };
			if (selVal(from) === 'c') rule.from = 'c';
			else if (f === 'w') {
				const wd = [...pop.querySelectorAll('.rs-days .rs-cell.is-on')].map((c) => +c.getAttribute('data-i'));
				if (wd.length) rule.wd = wd;
			} else if (f === 'm') {
				if (mOrdRadio.checked) {
					rule.ord = +selVal(pop.querySelector('.rs-mord'));
					rule.od = odParse(selVal(pop.querySelector('.rs-mod')));
				} else {
					const md = [...pop.querySelectorAll('.rs-mdays .rs-cell.is-on')].map((c) => +c.getAttribute('data-i'));
					if (md.length) rule.md = md;
				}
			} else if (f === 'y') {
				const mo = [...pop.querySelectorAll('.rs-months .rs-cell.is-on')].map((c) => +c.getAttribute('data-i'));
				if (mo.length) rule.mo = mo;
				if (yCheck.checked) {
					rule.ord = +selVal(pop.querySelector('.rs-yordsel'));
					rule.od = odParse(selVal(pop.querySelector('.rs-yod')));
				}
			}
			/* End Repeat: After stores the count (compiled to a date at commit);
			 * On Date parses the field (typed text goes through Thymer's own
			 * parser, the picker writes the same format) */
			until.classList.remove('rs-bad-date');
			let endMode = selVal(pop.querySelector('.rs-endsel'));
			if (endMode === 'n' && selVal(from) === 'c') {
				/* completion-counted rules cannot know future days */
				setSel(pop.querySelector('.rs-endsel'), '', [['', 'Never'], ['n', 'After'], ['d', 'On Date']]);
				endMode = '';
			}
			if (endMode === 'n') {
				rule.aftN = Math.max(1, Math.min(100, parseInt(cnt.value, 10) || 1));
			} else if (endMode === 'd') {
				const uraw = until.value.trim();
				if (uraw) {
					const up = DateTime.parseDateTimeString(uraw);
					const upp = up && up.getParts();
					if (upp && upp.year !== undefined) rule.u = upp.year * 10000 + (upp.month + 1) * 100 + upp.day;
					else until.classList.add('rs-bad-date');
				}
			}
			const tv = selVal(trailSel);
			if (tv) rule.tr = tv;
			/* forward needs an end date and a schedule-based rule; the engine
			 * quietly refuses otherwise, so make the gap visible right here */
			if (tv === 'f' && !rule.u && !rule.aftN) until.classList.add('rs-bad-date');
			this.rule = rule;
			paintRepeat();
			paintEnd();
			updateGrammar();
		};

		/* Push an existing rule into every control (the reverse of syncCustom) */
		const primeCustom = (r) => {
			setSel(freq, r.f, FREQOPTS); intv.value = r.n || 1; setSel(from, r.from || 'a', FROMOPTS);
			pop.querySelectorAll('.rs-days .rs-cell').forEach((c) => c.classList.toggle('is-on', !!(r.wd && r.wd.indexOf(+c.getAttribute('data-i')) >= 0)));
			pop.querySelectorAll('.rs-mdays .rs-cell').forEach((c) => c.classList.toggle('is-on', !!(r.md && r.md.indexOf(+c.getAttribute('data-i')) >= 0)));
			pop.querySelectorAll('.rs-months .rs-cell').forEach((c) => c.classList.toggle('is-on', !!(r.mo && r.mo.indexOf(+c.getAttribute('data-i')) >= 0)));
			mOrdRadio.checked = !!r.ord && r.f === 'm';
			mEachRadio.checked = !mOrdRadio.checked;
			yCheck.checked = !!r.ord && r.f === 'y';
			if (r.ord) { setSel(pop.querySelector('.rs-mord'), String(r.ord), ORDOPTS); setSel(pop.querySelector('.rs-yordsel'), String(r.ord), ORDOPTS); }
			if (r.od !== undefined) { setSel(pop.querySelector('.rs-mod'), String(r.od), ODOPTS); setSel(pop.querySelector('.rs-yod'), String(r.od), ODOPTS); }
			const endMode2 = r.aftN ? 'n' : (r.u ? 'd' : '');
			until.value = endMode2 === 'd' && r.u ? (r.u % 100) + ' ' + RECUR_MONTHNAMES[Math.floor(r.u / 100) % 100 - 1] + ' ' + Math.floor(r.u / 10000) : '';
			until.classList.remove('rs-bad-date');
			cnt.value = r.aftN || 3;
			setSel(pop.querySelector('.rs-endsel'), endMode2, [['', 'Never'], ['n', 'After'], ['d', 'On Date']]);
			paintEnd();
			setSel(trailSel, r.tr || '', TRAILOPTS);
			updateGrammar();
		};

		/* Frequency, Count-from and the ordinal pickers are OUR dropdowns, not
		 * <select>: the native macOS menu renders at the system font size
		 * (unstylable — he reported the options too small) and can close without
		 * firing change, stranding focus outside the box, which was the original
		 * Enter-dead bug. A plugin menu keeps focus, keys and typography
		 * in-house. Enter always commits regardless of focus (window handler). */
		const wireSel = (el, opts) => el.addEventListener('click', () =>
			this.openSelMenu(el, opts, selVal(el), (v) => { setSel(el, v, opts); syncCustom(); }));
		wireSel(freq, FREQOPTS);
		wireSel(from, FROMOPTS);
		wireSel(trailSel, TRAILOPTS);
		/* End Repeat is Apple's shape (his screenshots): Never / After n times /
		 * On Date with a real date picker. After compiles to a date at COMMIT
		 * (occurrence #n from the committed anchor, engine-computed) so no
		 * counters ever need mutating on ticks; completion-counted rules
		 * cannot know future days, so After is absent from the menu there. */
		const endSel = pop.querySelector('.rs-endsel');
		const cnt = pop.querySelector('.rs-cnt');
		const ENDOPTS_ALL = [['', 'Never'], ['n', 'After'], ['d', 'On Date']];
		/* the ROW never grows (the Is-set-to lesson): the chip carries the
		 * whole value ("After 3 times" / "9 Sep 2026") and picking After or
		 * On Date opens a POPOVER over the field — a count box or the month
		 * picker — instead of squeezing inputs into the row */
		const paintEnd = () => {
			const v = selVal(endSel);
			const l = endSel.querySelector('.rs-sel-lbl');
			if (v === 'n') l.textContent = 'After ' + (parseInt(cnt.value, 10) || 3) + ' times';
			else if (v === 'd') l.textContent = until.value.trim() || 'On Date';
			else l.textContent = 'Never';
		};
		const endApply = (v) => {
			setSel(endSel, v, ENDOPTS_ALL);
			if (v === 'n') {
				this.openCountPop(endSel, parseInt(cnt.value, 10) || 3, (n2) => {
					cnt.value = n2;
					syncCustom();
				});
			} else if (v === 'd') {
				if (!until.value.trim()) {
					const b = (this.sel || new DateTime(new Date())).getParts();
					const d2 = new Date(b.year, b.month + 1, b.day);
					until.value = d2.getDate() + ' ' + RECUR_MONTHNAMES[d2.getMonth()] + ' ' + d2.getFullYear();
				}
				const up = DateTime.parseDateTimeString(until.value.trim());
				const upp = up && up.getParts();
				this.openMiniCal(endSel, upp && upp.year !== undefined ? upp : null, (y2, m2, d3) => {
					until.value = d3 + ' ' + RECUR_MONTHNAMES[m2] + ' ' + y2;
					syncCustom();
				});
			} else {
				until.value = '';
				until.classList.remove('rs-bad-date');
			}
			syncCustom();
		};
		endSel.addEventListener('click', () => {
			const opts = selVal(from) === 'c' ? ENDOPTS_ALL.filter((o) => o[0] !== 'n') : ENDOPTS_ALL;
			this.openSelMenu(endSel, opts, selVal(endSel), endApply);
		});
		wireSel(pop.querySelector('.rs-mord'), ORDOPTS);
		wireSel(pop.querySelector('.rs-mod'), ODOPTS);
		wireSel(pop.querySelector('.rs-yordsel'), ORDOPTS);
		wireSel(pop.querySelector('.rs-yod'), ODOPTS);
		for (const sel of ['.rs-days', '.rs-mdays', '.rs-months']) {
			pop.querySelector(sel).addEventListener('click', (e) => {
				const c = e.target.closest('.rs-cell');
				if (!c) return;
				c.classList.toggle('is-on');
				syncCustom();
			});
		}
		mOrdRadio.addEventListener('change', syncCustom);
		mEachRadio.addEventListener('change', syncCustom);
		yCheck.addEventListener('change', syncCustom);
		intv.addEventListener('input', syncCustom);
		until.addEventListener('input', syncCustom);
		/* Prime the Custom fields but keep the panel CLOSED. Opening it on load
		 * changed the box height after place() had run, which is why reopening a
		 * line that already had a rule made the box jump, and the extra fields
		 * took the focus off the text input so nothing could be typed. The rule is
		 * already summarised on the Repeat row; the panel is for editing it. */
		if (this.rule) primeCustom(this.rule);
		paintRepeat();

		show();
		this.place(pop, t);
		this.outside = (e) => {
			if (e.target.closest && e.target.closest('.rs-repmenu')) return; /* the menu is a body child now */
			/* a click anywhere else closes the repeat menu — without this, clicking
			 * back into the calendar left the menu floating over the box */
			if (this.repMenu) { try { this.repMenu.remove(); } catch (e2) {} this.repMenu = null; }
			if (this.pop && !this.pop.contains(e.target)) this.closePicker();
		};
		setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0);
		/* focus last, and once more on the next frame: laying out the repeat row
		 * can move focus, and a box you cannot type into is worse than useless */
		input.focus({ preventScroll: true });
		requestAnimationFrame(() => { if (this.pop === pop && document.activeElement !== input) input.focus({ preventScroll: true }); });
	}

	/* A small dropdown of options under an anchor, on the repeat menu's surface
	 * (body-parented and fixed for the same overflow:hidden reason). Used by the
	 * Frequency and Count-from controls in place of a native <select>. */
	openSelMenu(anchor, items, cur, onPick) {
		document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
		const menu = document.createElement('div');
		menu.className = 'rs-repmenu';
		menu.innerHTML = items.map(([v, lbl]) =>
			'<div data-v="' + v + '"' + (v === cur ? ' class="rs-on"' : '') + '>' + lbl + '</div>').join('');
		document.body.appendChild(menu);
		const br = anchor.getBoundingClientRect();
		const mh = menu.offsetHeight;
		const top = br.bottom + 4 + mh > window.innerHeight - 8 ? br.top - mh - 4 : br.bottom + 4;
		menu.style.top = Math.max(8, top) + 'px';
		menu.style.left = Math.max(8, Math.min(br.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
		this.repMenu = menu;
		menu.addEventListener('click', (e) => {
			const row = e.target.closest('div[data-v]');
			if (!row) return;
			menu.remove();
			if (this.repMenu === menu) this.repMenu = null;
			onPick(row.getAttribute('data-v'));
		});
	}

	/* Native's own day-cell shape, so native's CSS lights it up:
	 * <div class="day current-month|prev-month|next-month [today] [selected]
	 * [inrange]" data-date="YYYY-MM-DD"><span class="day-inner">N</span></div> */
	/* A compact month picker for End Repeat: On Date — Thymer's OWN datepicker
	 * markup (wrapper INSIDE the popover, the doctrine) so the app styles and
	 * themes it. Carries .rs-repmenu so the box's outside-click handler
	 * treats it as one of ours. */
	openMiniCal(anchorEl, startParts, onPick) {
		document.querySelectorAll('.rs-minical').forEach((m) => m.remove());
		const box = document.createElement('div');
		box.className = 'rs-repmenu rs-minical';
		const now = new Date();
		let vy = startParts ? startParts.year : now.getFullYear();
		let vm = startParts ? startParts.month : now.getMonth();
		const selYmd = startParts ? startParts.year * 10000 + (startParts.month + 1) * 100 + startParts.day : 0;
		const paint = () => {
			const first = new Date(vy, vm, 1);
			const lead = (first.getDay() + 6) % 7;
			let days = '';
			for (let i = 0; i < 42; i++) {
				const d = new Date(vy, vm, 1 - lead + i);
				const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
				const cls = ['day', d.getMonth() === vm ? 'current-month' : (d < first ? 'prev-month' : 'next-month')];
				if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) cls.push('today');
				if (ymd === selYmd) cls.push('selected');
				days += '<div class="' + cls.join(' ') + '" data-ymd="' + ymd + '"><span class="day-inner">' + d.getDate() + '</span></div>';
			}
			box.innerHTML = '<div class="datepicker-wrapper datepicker-compact"><div class="datepicker-calendar">'
				+ '<div class="datepicker-header"><span class="current-month" style="flex:1">'
				+ new Date(vy, vm, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
				+ '</span><span class="rs-mc-nav rs-mc-prev">‹</span><span class="rs-mc-nav rs-mc-next">›</span></div>'
				+ '<div class="datepicker-weekdays">' + DOW.map((d) => '<div class="weekday">' + d + '</div>').join('') + '</div>'
				+ '<div class="datepicker-days">' + days + '</div>'
				+ '</div></div>';
		};
		paint();
		document.body.appendChild(box);
		/* ABOVE the anchor row and horizontally inside the box frame (his
		 * call — dropping below the field pushed it to the screen's bottom) */
		const r = anchorEl.getBoundingClientRect();
		const frame = this.pop ? this.pop.getBoundingClientRect() : null;
		let top = r.top - box.offsetHeight - 6;
		if (top < 8) top = Math.min(r.bottom + 4, window.innerHeight - box.offsetHeight - 8);
		let left = r.left;
		if (frame) left = Math.max(frame.left + 4, Math.min(left, frame.right - box.offsetWidth - 4));
		box.style.top = Math.max(8, top) + 'px';
		box.style.left = Math.max(8, Math.min(left, window.innerWidth - box.offsetWidth - 8)) + 'px';
		const outside = (e) => { if (!box.contains(e.target) && e.target !== anchorEl) close(); };
		const close = () => { document.removeEventListener('pointerdown', outside, true); box.remove(); };
		setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
		box.addEventListener('click', (e) => {
			const nav = e.target.closest('.rs-mc-nav');
			if (nav) {
				vm += nav.classList.contains('rs-mc-next') ? 1 : -1;
				if (vm < 0) { vm = 11; vy--; }
				if (vm > 11) { vm = 0; vy++; }
				paint();
				return;
			}
			const day = e.target.closest('.day');
			if (day) {
				const ymd = +day.getAttribute('data-ymd');
				close();
				onPick(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100);
			}
		});
	}

	/* the After-count popover: writes through live, Enter or an outside
	 * click closes — the chip label always mirrors the value */
	openCountPop(anchorEl, current, onSet) {
		document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
		const box = document.createElement('div');
		box.className = 'rs-repmenu rs-countpop';
		box.innerHTML = '<label style="display:flex;align-items:center;gap:6px;padding:4px 8px;">After <input class="rs-cnt" type="number" min="1" max="100" value="' + (current || 3) + '"> times</label>';
		document.body.appendChild(box);
		const r = anchorEl.getBoundingClientRect();
		const top = r.bottom + 4 + box.offsetHeight > window.innerHeight - 8 ? r.top - box.offsetHeight - 4 : r.bottom + 4;
		box.style.top = Math.max(8, top) + 'px';
		box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)) + 'px';
		this.repMenu = box;
		const input = box.querySelector('input');
		input.focus();
		input.select();
		input.addEventListener('input', () => onSet(Math.max(1, Math.min(100, parseInt(input.value, 10) || 1))));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				box.remove();
				if (this.repMenu === box) this.repMenu = null;
			}
		});
	}

	/* anchor the pending rule on the committed day and compile "After n
	 * times" into its concrete end date (occurrence #1 = the anchor) */
	finalizeRule(pending, anchorYmd) {
		if (!pending) return null;
		const rule = { ...pending, a: anchorYmd };
		if (rule.aftN) {
			const nth = recurNthOccurrence(rule, anchorYmd, rule.aftN);
			if (nth) rule.u = nth;
		}
		return rule;
	}

	renderCal(pop) {
		const { y, m } = this.view;
		pop.querySelector('.current-month').textContent =
			new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
		pop.querySelector('.datepicker-weekdays').innerHTML =
			DOW.map((d) => '<div class="weekday">' + d + '</div>').join('');

		const first = new Date(y, m, 1);
		const lead = (first.getDay() + 6) % 7; // JS weeks start Sunday, ours Monday
		const today = new Date();
		const same = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
		const selD = this.sel && this.sel.getParts().year !== undefined ? this.sel.toDate() : null;
		const endD = this.rangeEnd ? this.rangeEnd.toDate() : null;

		let html = '';
		for (let i = 0; i < 42; i++) {
			const d = new Date(y, m, 1 - lead + i);
			const cls = ['day', d.getMonth() === m ? 'current-month' : (d < first ? 'prev-month' : 'next-month')];
			if (same(d, today)) cls.push('today');
			if (same(d, selD) || same(d, endD)) cls.push('selected');
			if (selD && endD && d > selD && d < endD) cls.push('inrange');
			const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
			html += '<div class="' + cls.join(' ') + '" data-date="' + iso + '"><span class="day-inner">' + d.getDate() + '</span></div>';
		}
		pop.querySelector('.datepicker-days').innerHTML = html;
	}

	/* Anchor under whatever the command is acting on. Parham's spec (2026-08-08):
	 * the box sits JUST BELOW the line, at the date chip's x (or where the chip
	 * will land — after the last text), so the line's text stays visible right
	 * above it. Anchoring at the CARET was wrong three ways: the caret stands
	 * wherever the cursor happens to be (box over the text), in embeds and live
	 * searches the caret lookup misses and the box fell to the panel corner,
	 * and the flip was caret-relative so it could cover the line. The LINE
	 * element is the anchor now — we always know its domGuid — searched in the
	 * ACTIVE panel first, because an embedded copy renders the same data-guid
	 * in another panel and document-order querySelector may find the wrong one.
	 * Flip goes ABOVE THE LINE, so the line is never covered in either
	 * direction. Caret and panel fallbacks remain for lineless cases, and
	 * everything clamps to the panel column + viewport at the end. */
	place(pop, t) {
		const panel = this.activePanelEl();
		const w = pop.offsetWidth || 320;
		const h = pop.offsetHeight || 400;

		const cell = panel && (panel.querySelector('.table-view-cell.is-focused')
			|| CARD_SELECTORS.reduce((f, sel) => f || panel.querySelector(sel), null));
		const domGuid = !cell && t
			? (t.kind === 'line' ? (t.line && (t.line.domGuid || t.line.lineGuid)) : t.domGuid)
			: null;
		const sel = domGuid && '.listitem[data-guid="' + domGuid + '"]';
		const lineEl = sel ? ((panel && panel.querySelector(sel)) || document.querySelector(sel)
			|| document.querySelector('.tasks-view-row[data-guid="' + domGuid + '"]')) : null;
		if (lineEl) {
			const lr = lineEl.getBoundingClientRect();
			const col = lineEl.closest('.panel');
			const colr = col ? col.getBoundingClientRect() : { left: 0, right: window.innerWidth };
			const chip = lineEl.querySelector('span.lineitem-datetime');
			let ax;
			if (chip) {
				ax = chip.getBoundingClientRect().left;
			} else {
				const spans = this.segmentSpans(domGuid);
				const last = spans[spans.length - 1];
				ax = last ? last.getBoundingClientRect().right + 8 : lr.left;
			}
			const left = Math.max(8, colr.left + 8, Math.min(ax, colr.right - w - 8, window.innerWidth - w - 8));
			let top = lr.bottom + 6;
			if (top + h > window.innerHeight - 8) top = lr.top - h - 6; /* above the line, never over it */
			pop.style.left = left + 'px';
			pop.style.top = Math.max(8, Math.min(top, window.innerHeight - h - 8)) + 'px';
			return;
		}

		let r = null;
		if (cell) {
			const cr = cell.getBoundingClientRect();
			r = { left: cr.left, bottom: cr.bottom };
		}
		if (!r) {
			try {
				const lv = this.activeListview();
				const inPanel = lv && lv.$container && (!panel || panel.contains(lv.$container));
				const c = inPanel && lv.$carets && lv.$carets.querySelector('.listview-caret');
				const cr = c && c.getBoundingClientRect();
				if (cr && cr.top > 0 && cr.top < window.innerHeight) r = { left: cr.left, bottom: cr.top + 26 };
			} catch (e) {}
		}
		if (!r) {
			const pr = panel && panel.getBoundingClientRect();
			r = pr ? { left: pr.left + 24, bottom: pr.top + 90 } : { left: (window.innerWidth - w) / 2, bottom: 114 };
		}

		let top = r.bottom + 6;
		if (top + h > window.innerHeight - 8) top = r.bottom - h - 40; // flip above the anchor
		pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
		pop.style.top = Math.max(8, Math.min(top, window.innerHeight - h - 8)) + 'px';
	}

	/* Keep the box on screen after it changes height, WITHOUT re-anchoring it —
	 * only the top edge moves, and only if it would otherwise hang off. */
	fit(pop) {
		const r = pop.getBoundingClientRect();
		if (r.bottom <= window.innerHeight - 8) return;
		pop.style.top = Math.max(8, window.innerHeight - 8 - r.height) + 'px';
	}

	closePicker() {
		if (this.popKeys) { window.removeEventListener('keydown', this.popKeys, true); this.popKeys = null; }
		if (this.outside) { document.removeEventListener('pointerdown', this.outside, true); this.outside = null; }
		if (this.pop) { try { this.pop.remove(); } catch (e) {} this.pop = null; }
		document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
		this.repMenu = null;
		this.sel = this.view = this.rangeEnd = this.showPicker = this.cancelPicker = null;
		this.endMode = false;
	}

	// ---- misc ---------------------------------------------------------------

	showShortcuts() {
		const rows = (this.timeblocks || []).map((t) => KEY_TAG(t.code.slice(5)) + '&nbsp; ' + t.label + ' &nbsp;<span style="opacity:.5">' + t.tag + '</span>').join('<br>');
		this.ui.addToaster({
			title: 'Supertask',
			messageHTML: rows
				+ '<br><br>' + STATUS_SHORTCUTS.map((key, i) => {
				const b = ORDER_BINS.find((x) => x.key === key);
				return KEY_STATUS(i + 1) + '&nbsp; ' + (key === 'tasks' ? 'Clear status (Todo)' : (b ? b.label : key));
			}).join('<br>')
				+ '<br><br>' + KEY_NUDGE + '&nbsp; move the date one day forward / back'
				+ '<br>' + KEY_BOX + '&nbsp; date box — arrows walk the calendar, Enter sets, Clear removes',
			dismissible: true,
			autoDestroyTime: 15000,
		});
	}

	toast(message) {
		try {
			this.ui.addToaster({ title: 'Supertask', message, dismissible: true, autoDestroyTime: 3200 });
		} catch (e) {}
	}
}
