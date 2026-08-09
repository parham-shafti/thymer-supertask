// Tests the recurrence engine by EXTRACTING it from plugin.js, so the two can
// never drift apart. Pure date maths, no Thymer needed:  node test-recurrence.mjs
import { readFileSync } from 'fs';

const src = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8');
const start = src.indexOf('/* ==== RECURRENCE ENGINE — start');
const end = src.indexOf('/* ==== RECURRENCE ENGINE — end ==== */');
if (start < 0 || end < 0) { console.error('engine markers not found in plugin.js'); process.exit(2); }
const engine = src.slice(start, end);

const scope = {};
new Function('S', engine + '\nObject.assign(S,{recurNext,recurMatches,recurLabel,recurOrdinalDay,recurAdvance,recurAddInterval,recurOccurrences});')(scope);
const { recurNext, recurLabel, recurAdvance, recurOccurrences } = scope;

let fails = 0;
const check = (name, got, want) => {
	const ok = String(got) === String(want);
	if (!ok) fails++;
	console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  ' + got + (ok ? '' : '   want ' + want));
};
/* walk n occurrences forward, so a rule is tested as a SEQUENCE not one hop */
const series = (rule, from, n) => {
	const out = [];
	let cur = from;
	for (let i = 0; i < n; i++) { cur = recurNext(rule, cur); if (!cur) break; out.push(cur); }
	return out.join(' ');
};

console.log('\ndaily');
check('every day', series({ f: 'd', n: 1, a: 20260806 }, 20260806, 3), '20260807 20260808 20260809');
check('every 3 days', series({ f: 'd', n: 3, a: 20260806 }, 20260806, 3), '20260809 20260812 20260815');
check('every 3 days, ticked 5 days late, stays on the rhythm',
	series({ f: 'd', n: 3, a: 20260806 }, 20260811, 2), '20260812 20260815');
check('crosses a month end', series({ f: 'd', n: 10, a: 20260825 }, 20260825, 2), '20260904 20260914');

console.log('\nweekly');
check('every week on Fri', series({ f: 'w', n: 1, a: 20260807, wd: [4] }, 20260807, 3), '20260814 20260821 20260828');
check('every 2 weeks on Fri', series({ f: 'w', n: 2, a: 20260807, wd: [4] }, 20260807, 3), '20260821 20260904 20260918');
check('Mon+Wed+Fri', series({ f: 'w', n: 1, a: 20260803, wd: [0, 2, 4] }, 20260803, 4), '20260805 20260807 20260810 20260812');
check('weekday defaults to the anchor day', series({ f: 'w', n: 1, a: 20260806 }, 20260806, 2), '20260813 20260820');

console.log('\nmonthly');
check('every month on the 14th', series({ f: 'm', n: 1, a: 20260814, md: [14] }, 20260814, 3), '20260914 20261014 20261114');
check('every 2 months', series({ f: 'm', n: 2, a: 20260814, md: [14] }, 20260814, 3), '20261014 20261214 20270214');
check('the 31st clamps to short months', series({ f: 'm', n: 1, a: 20260131, md: [31] }, 20260131, 4),
	'20260228 20260331 20260430 20260531');
check('several days a month', series({ f: 'm', n: 1, a: 20260801, md: [1, 15] }, 20260801, 4),
	'20260815 20260901 20260915 20261001');
check('first Tuesday', series({ f: 'm', n: 1, a: 20260804, ord: 1, od: 1 }, 20260804, 3), '20260901 20261006 20261103');
check('last day of the month', series({ f: 'm', n: 1, a: 20260831, ord: -1, od: 'day' }, 20260831, 3),
	'20260930 20261031 20261130');
check('last Friday', series({ f: 'm', n: 1, a: 20260828, ord: -1, od: 4 }, 20260828, 3), '20260925 20261030 20261127');
check('next to last weekday', series({ f: 'm', n: 1, a: 20260828, ord: -2, od: 'weekday' }, 20260828, 2),
	'20260929 20261029');

console.log('\nyearly');
check('every 14 August', series({ f: 'y', n: 1, a: 20260814, mo: [7], md: [14] }, 20260814, 3),
	'20270814 20280814 20290814');
check('every 2 years', series({ f: 'y', n: 2, a: 20260814, mo: [7], md: [14] }, 20260814, 2), '20280814 20300814');
check('leap day survives to the next leap year',
	series({ f: 'y', n: 4, a: 20280229, mo: [1], md: [29] }, 20280229, 2), '20320229 20360229');

console.log('\ncounting from completion, not from the schedule');
// due 6 Aug, actually ticked 11 Aug, every 3 days
check('3 days after I ticked it', recurAdvance({ f: 'd', n: 3, from: 'c' }, 20260806, 20260811), '20260814');
check('schedule mode ignores when I ticked it', recurAdvance({ f: 'd', n: 3, a: 20260806 }, 20260806, 20260811), '20260812');
check('a week after completion', recurAdvance({ f: 'w', n: 1, from: 'c' }, 20260806, 20260811), '20260818');
check('a month after completion clamps', recurAdvance({ f: 'm', n: 1, from: 'c' }, 20260131, 20260131), '20260228');
check('a year after a leap day clamps', recurAdvance({ f: 'y', n: 1, from: 'c' }, 20280229, 20280229), '20290228');
check('schedule mode never returns a past date',
	recurAdvance({ f: 'w', n: 1, a: 20260605, wd: [4] }, 20260605, 20260811), '20260814');
check('label from completion', recurLabel({ f: 'd', n: 3, from: 'c' }), 'Every 3 days after completion');

console.log('\nlabels');
check('label daily', recurLabel({ f: 'd', n: 1 }), 'Every day');
check('label daily n', recurLabel({ f: 'd', n: 3 }), 'Every 3 days');
check('label weekly', recurLabel({ f: 'w', n: 1, wd: [0, 4] }), 'Every week on Mon, Fri');
check('label monthly ordinal', recurLabel({ f: 'm', n: 2, ord: -1, od: 4 }), 'Every 2 months on the last Fri');
check('label yearly', recurLabel({ f: 'y', n: 1, mo: [7] }), 'Every year in Aug');
check('label none', recurLabel(null), 'Never');

console.log('\nuntil (End Repeat)');
check('advance inside the until window', recurAdvance({ f: 'd', n: 1, a: 20260806, u: 20260810 }, 20260806, 20260806), '20260807');
check('advance past until stops', recurAdvance({ f: 'd', n: 1, a: 20260806, u: 20260810 }, 20260810, 20260810), '0');
check('until applies in completion mode too', recurAdvance({ f: 'd', n: 3, from: 'c', u: 20260812 }, 20260806, 20260811), '0');
check('label with until', recurLabel({ f: 'd', n: 1, u: 20260830 }), 'Every day until 30 Aug 2026');

console.log('\nguards');
check('no rule never fires', recurNext(null, 20260806), '0');
check('before the anchor still lands on the anchor', recurNext({ f: 'd', n: 1, a: 20260810 }, 20260801), '20260810');


console.log('\nforward-trail occurrences');
check('daily until lists every day', recurOccurrences({ f: 'd', n: 1, a: 20260810, u: 20260814 }, 20260810).join(','), '20260811,20260812,20260813,20260814');
check('every 2 weeks on Fri', recurOccurrences({ f: 'w', n: 2, a: 20260814, wd: [4], u: 20261001 }, 20260814).join(','), '20260828,20260911,20260925');
check('no until = no expansion', recurOccurrences({ f: 'd', n: 1, a: 20260810 }, 20260810).length, '0');
check('completion mode = no expansion', recurOccurrences({ f: 'd', n: 3, a: 20260810, u: 20260901, from: 'c' }, 20260810).length, '0');
check('cap bounds a runaway series', recurOccurrences({ f: 'd', n: 1, a: 20260101, u: 20301231 }, 20260101, 50).length, '50');
check('monthly 31st clamps inside the window', recurOccurrences({ f: 'm', n: 1, a: 20260131, u: 20260501 }, 20260131).join(','), '20260228,20260331,20260430');

console.log(fails ? '\n' + fails + ' FAILED\n' : '\nall passed\n');
process.exit(fails ? 1 : 0);
