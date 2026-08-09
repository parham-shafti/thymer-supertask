// Replicates the plugin's segment logic verbatim and asserts the reported bug is gone.
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
const TIMEBLOCK_TAGS = new Set(TIMEBLOCKS.map((t) => t.tag));

function healGap(segs, i) {
	if (i > 0 && i < segs.length && segs[i - 1].type === 'text' && segs[i].type === 'text') {
		const a = segs[i - 1].text;
		const b = /\s$/.test(a) ? segs[i].text.replace(/^\s/, '') : segs[i].text;
		segs[i - 1].text = a + b;
		segs.splice(i, 1);
	}
	const last = segs[segs.length - 1];
	if (last && last.type === 'text' && /^\s*$/.test(last.text)) segs.pop();
}

function needsGap(segs, i) {
	const prev = segs[i - 1];
	if (!prev) return false;
	return !(prev.type === 'text' && /\s$/.test(prev.text || ''));
}

function setTimeblock(segs, tag) {
	segs = segs.map((s) => ({ ...s }));
	const i = segs.findIndex((s) => s.type === 'hashtag' && TIMEBLOCK_TAGS.has(s.text));
	if (i < 0) {
		if (needsGap(segs, segs.length)) segs.push({ type: 'text', text: ' ' });
		segs.push({ type: 'hashtag', text: tag }, { type: 'text', text: ' ' });
	} else if (segs[i].text === tag) { segs.splice(i, 1); healGap(segs, i); }
	else {
		segs[i] = { type: 'hashtag', text: tag };
		if (i === segs.length - 1) segs.push({ type: 'text', text: ' ' });
	}
	return segs;
}

function insertDate(segs, label) {
	segs = segs.map((s) => ({ ...s }));
	const at = segs.findIndex((s) => s.type === 'hashtag');
	const where = at < 0 ? segs.length : at;
	const parts = [{ type: 'datetime', text: { formatted: label } }, { type: 'text', text: ' ' }];
	if (needsGap(segs, where)) parts.unshift({ type: 'text', text: ' ' });
	segs.splice(where, 0, ...parts);
	return segs;
}

const render = (segs) => segs.map((s) => (s.type === 'datetime' ? s.text.formatted : s.text)).join('');
const trim = (t) => t.replace(/\s+$/, '');

let fails = 0;
const check = (name, got, want) => {
	const ok = got === want;
	if (!ok) fails++;
	console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '\n         got  ' + JSON.stringify(got)
		+ (ok ? '' : '\n         want ' + JSON.stringify(want)));
};

// the exact line from the screen recording
const recording = [
	{ type: 'text', text: 'Testing ' },
	{ type: 'datetime', text: { d: '20260808', formatted: 'Sat Aug 8' } },
	{ type: 'text', text: ' ' },
	{ type: 'hashtag', text: '#earlymorning' },
];

console.log('\nthe reported bug: four changes in a row must not drift');
let s = recording;
for (const tag of ['#morning', '#latemorning', '#afternoon', '#lateafternoon']) s = setTimeblock(s, tag);
check('after 4 changes', trim(render(s)), 'Testing Sat Aug 8 #lateafternoon');

console.log('\nposition is preserved wherever the tag sits');
check('mid-sentence', render(setTimeblock([
	{ type: 'text', text: 'Call ' }, { type: 'hashtag', text: '#morning' }, { type: 'text', text: ' about the invoice' },
], '#evening')), 'Call #evening about the invoice');

check('before the date', render(setTimeblock([
	{ type: 'text', text: 'Ship ' }, { type: 'hashtag', text: '#morning' }, { type: 'text', text: ' ' },
	{ type: 'datetime', text: { d: '20260808', formatted: 'Sat Aug 8' } },
], '#lateevening')), 'Ship #lateevening Sat Aug 8');

console.log('\nother hashtags are untouched, and only the timeblock is swapped');
check('#recurring survives', render(setTimeblock([
	{ type: 'text', text: 'Water plants ' }, { type: 'hashtag', text: '#recurring' },
	{ type: 'text', text: ' ' }, { type: 'hashtag', text: '#morning' },
], '#evening')), 'Water plants #recurring #evening ');

console.log('\nadding and clearing');
check('added to a bare line', render(setTimeblock([{ type: 'text', text: 'New todo' }], '#morning')), 'New todo #morning ');
check('toggle off leaves no trailing space', JSON.stringify(setTimeblock(recording, '#earlymorning')),
	JSON.stringify([{ type: 'text', text: 'Testing ' }, { type: 'datetime', text: { d: '20260808', formatted: 'Sat Aug 8' } }]));
check('toggle off mid-sentence keeps one space', render(setTimeblock([
	{ type: 'text', text: 'Call ' }, { type: 'hashtag', text: '#morning' }, { type: 'text', text: ' about it' },
], '#morning')), 'Call about it');

console.log('\nround trip: set then clear returns the original line');
check('set + clear', render(setTimeblock(setTimeblock([{ type: 'text', text: 'New todo' }], '#morning'), '#morning')), 'New todo');

console.log('\nseparators are never doubled');
check('tag onto a line already ending in a space',
	render(setTimeblock([{ type: 'text', text: 'Trailing space ' }], '#morning')), 'Trailing space #morning ');
check('date onto a line already ending in a space',
	render(insertDate([{ type: 'text', text: 'Clear test ' }], 'Wed Aug 12')), 'Clear test Wed Aug 12 ');
check('date before an existing hashtag',
	render(insertDate([{ type: 'text', text: 'Ship it ' }, { type: 'hashtag', text: '#morning' }], 'Wed Aug 12')),
	'Ship it Wed Aug 12 #morning');

console.log('\nthe new meal blocks behave like the rest');
check('lunch replaces morning in place',
	render(setTimeblock([{ type: 'text', text: 'Eat ' }, { type: 'hashtag', text: '#morning' }, { type: 'text', text: ' at the desk' }], '#lunch')),
	'Eat #lunch at the desk');
check('dinner swaps for lateafternoon',
	trim(render(setTimeblock([{ type: 'text', text: 'Cook ' }, { type: 'hashtag', text: '#lateafternoon' }], '#dinner'))),
	'Cook #dinner');
check('pressing lunch twice clears it',
	render(setTimeblock(setTimeblock([{ type: 'text', text: 'Eat' }], '#lunch'), '#lunch')), 'Eat');

console.log(fails ? '\n' + fails + ' FAILED\n' : '\nall passed\n');
process.exit(fails ? 1 : 0);
