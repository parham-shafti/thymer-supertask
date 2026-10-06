// The rule that decides which lines Supertask may move or indent (sweep + indent pass).
// Extracted VERBATIM from plugin.js, so the test cannot drift from the shipped code.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./plugin.js', import.meta.url), 'utf8');
const start = src.indexOf('\tfileable(st) {');
if (start < 0) throw new Error('fileable(st) not found in plugin.js');
const end = src.indexOf('\n\t}\n', start);
const body = src.slice(src.indexOf('{', start) + 1, end);
const fileable = new Function('st', body);

let fails = 0;
const check = (name, got, want) => {
	const ok = got === want;
	if (!ok) fails++;
	console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '   got ' + got + ', want ' + want));
};

// text_segments is the flat [type, value, type, value, ...] the state carries
const line = (type, ...segs) => ({ type, text_segments: segs });

console.log('\nonly a task with something on it is Supertask\'s to move');
check('a task with text', fileable(line('task', 'text', 'Call the bank')), true);
check('an EMPTY task (Enter just pressed) is left alone', fileable(line('task')), false);
check('a task holding only spaces is still empty', fileable(line('task', 'text', '   ')), false);
check('a task with only a hashtag has content', fileable(line('task', 'hashtag', '#morning')), true);
check('a task with only a page reference has content', fileable(line('task', 'ref', { guid: 'X' })), true);
check('a task with only a date has content', fileable(line('task', 'datetime', { d: '20261006' })), true);
check('a plain text line is the user\'s, never moved', fileable(line('text', 'a note under Done')), false);
check('an empty text line (Enter under a heading) is never moved', fileable(line('text')), false);
check('a heading is never moved', fileable(line('heading', 'text', 'Done')), false);
check('nothing at all', fileable(null), false);

console.log(fails ? '\n' + fails + ' FAILED\n' : '\nall passed\n');
process.exit(fails ? 1 : 0);
