// tests/cowl_diet_booze.test.js -- the Mafia Wines and Martinis tables' formatting and sort.
//
// Run: node tests/cowl_diet_booze.test.js
//
// Small things that are wrong silently. A column of adventures-per-meat spans seven orders of
// magnitude -- 0.08 for a cheap martini, 1.8e-10 for a wine priced at fifty billion -- so the
// formatter has to stay readable at both ends without rounding either to nothing. And a row with
// no mall price must not win a sort by having nothing to compare: it belongs at the bottom
// whichever way the column is turned.
//
// The arithmetic itself -- the ring's rounded eighth, the mean over the rolls -- is ASH, in
// cowl_diet_booze.ash, and is checked against KoLmafia's own figures on the page rather than here.

const assert = require('assert');
const booze = require('../relay/cowl_diet_booze.js');

let failed = 0;
function is(label, got, want) {
	if (got === want) return;
	failed++;
	console.log(`FAIL ${label}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

// --- adventures per meat, across the range the table actually holds ---------------------------
//
// It answers the TEXT of a cell, so every answer is a string: a number here would mean the cell
// was being built by concatenation somewhere and the formatting undone on the way.
is('a cheap martini', booze.perMeat(7.5 / 94), '0.0798');
is('an ordinary wine', booze.perMeat(27 / 28000), '0.000964');
is('three figures kept', booze.perMeat(0.123456), '0.123');
is('a trailing zero dropped', booze.perMeat(0.1), '0.1');
// Below a ten-thousandth a decimal would be a row of zeroes, so it goes to exponent form.
is('fifty billion meat', booze.perMeat(9 / 50000000000), '1.80e-10');
is('nothing to divide', booze.perMeat(null), '');
is('free', booze.perMeat(0), '0');

// --- adventures per point of liver -------------------------------------------------------------
is('one decimal', booze.one(27 / 4), '6.8');
is('a whole number keeps its decimal', booze.one(7), '7.0');
is('nothing', booze.one(null), '');

// --- the sort ----------------------------------------------------------------------------------
const rows = [
	{name: 'cheap',  liver: 1, mean: 5,  price: 100,  owned: 0},
	{name: 'dear',   liver: 1, mean: 9,  price: 9000, owned: 2},
	{name: 'unsold', liver: 1, mean: 7,  price: null, owned: 1},
	{name: 'big',    liver: 3, mean: 15, price: 500,  owned: 0}
];
const names = (key, down) => booze.sorted(rows, key, down).map(r => r.name).join(',');

is('by liver, biggest first', names('liver', true), 'big,cheap,dear,unsold');
is('by liver, smallest first', names('liver', false), 'cheap,dear,unsold,big');
is('by adv per liver, biggest first', names('perliver', true), 'dear,unsold,big,cheap');
// A null price sorts last BOTH ways: no price is not a small price.
is('no price last, dearest first', names('price', true), 'dear,big,cheap,unsold');
is('no price last, cheapest first', names('price', false), 'cheap,big,dear,unsold');
is('no price last on adv per meat', names('permeat', true), 'cheap,big,dear,unsold');
is('no price last on adv per meat, the other way', names('permeat', false), 'dear,big,cheap,unsold');
is('by name', names('name', false), 'big,cheap,dear,unsold');
is('by name, backwards', names('name', true), 'unsold,dear,cheap,big');

// A tie breaks on the name, so the table is the same every time it is drawn rather than whatever
// the browser's sort happened to do with equal keys.
const tied = [{name: 'b', liver: 1, mean: 5, price: 1, owned: 0}, {name: 'a', liver: 1, mean: 5, price: 1, owned: 0}];
is('ties break on the name', booze.sorted(tied, 'perliver', true).map(r => r.name).join(','), 'a,b');
is('ties break on the name either way', booze.sorted(tied, 'perliver', false).map(r => r.name).join(','), 'a,b');

// The sort never loses or invents a row.
is('every row survives', booze.sorted(rows, 'permeat', true).length, rows.length);

// --- the columns are the ones asked for, in order -----------------------------------------------
is('the columns', booze.COLUMNS.map(c => c.key).join(','), 'name,liver,range,perliver,price,permeat,owned');

if (failed) {
	console.log(`\n${failed} FAILED`);
	process.exit(1);
}
console.log('ok: every case');
