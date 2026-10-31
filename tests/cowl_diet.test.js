// tests/cowl_diet.test.js -- the Diet Planner's arithmetic against the prototype it was ported from.
//
// Run: node tests/cowl_diet.test.js
//
// A Python prototype of the planner worked these numbers out for one account on 2026-10-28, and
// wrote its exact inputs to testdata/diet/. Given the same inputs the port should land on the same
// adventures at every budget, to within an adventure for ties broken differently.

const assert = require('assert');
const path = require('path');
const plan = require('../relay/cowl_diet_plan.js');
const data = require(path.join(__dirname, '..', 'testdata', 'diet', 'account-2026-10-28.json'));

// budget a day -> [ordinary day, Feast of Boris day at twice the budget], from plans.md
const EXPECTED = {
	10000: [286, 380], 25000: [323, 444], 55000: [369, 508], 100000: [405, 552], 200000: [444, 604],
	300000: [470, 648], 500000: [510, 709], 750000: [553, 771], 1000000: [586, 821],
};

// The pinky ring's rounding: halves to the even neighbour, the way mafia's Math.rint does.
assert.strictEqual(plan.rint(0.5), 0);
assert.strictEqual(plan.rint(1.5), 2);
assert.strictEqual(plan.rint(2.5), 2);
assert.strictEqual(plan.rint(0.625), 1);

const t0 = Date.now();
const day = plan.sweep(plan.buildConfig(data, {}));
const feast = plan.sweep(plan.buildConfig(data, {feast: true}));
const seconds = (Date.now() - t0) / 1000;

let failed = 0;
for (const [budget, [ordinary, feasting]] of Object.entries(EXPECTED)) {
	const d = plan.planFor(day, +budget), f = plan.planFor(feast, 2 * budget);
	const ok = Math.abs(d[0] - ordinary) <= 1 && Math.abs(f[0] - feasting) <= 1 && d[1] <= +budget && f[1] <= 2 * budget;
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${(+budget).toLocaleString().padStart(9)}: ${d[0].toFixed(0)} (prototype ${ordinary}), `
		+ `feast ${f[0].toFixed(0)} (prototype ${feasting})`);
}

// A plan's units add up to its totals, and fit the organs.
const p = plan.planFor(day, 55000);
assert.ok(Math.abs(p[2].reduce((s, u) => s + u[3], 0) - p[0]) < 1e-6, 'adventures add up');
assert.ok(Math.abs(p[2].reduce((s, u) => s + u[4], 0) - p[1]) < 1e-6, 'meat adds up');
assert.ok(plan.describe(p[2]).length > 3, 'a plan has several sections');

// Each unit's breakdown adds up to its adventures, and the table's rows add up to the plan.
for (const u of p[2]) {
	assert.ok(Math.abs(u[5].reduce((s, x) => s + x[1], 0) - u[3]) < 1e-6, `parts add up for ${u[0]}`);
}
const cfg55 = plan.buildConfig(data, {toilet: true});
const p55 = plan.planFor(plan.sweep(cfg55), 55000);
const rows = plan.dayRows(p55[2], cfg55);
assert.ok(Math.abs(rows.reduce((s, r) => s + (r.adv || 0), 0) - p55[0]) < 1e-6, 'rows add up to the adventures');
assert.ok(Math.abs(rows.reduce((s, r) => s + r.cost, 0) - p55[1]) < 1e-6, 'rows add up to the meat');
assert.strictEqual(rows[0].action, 'cast', 'Ode comes first');
assert.ok(/nightcap/.test(rows[rows.length - 1].note), 'the nightcap comes last');

// Which half of the day each row belongs to, which is what the Consume tab's two buttons walk.
// Every row says, the two halves are contiguous (start then end, never interleaved), and the
// nightcap -- the one drink meant to take you past your limit -- is marked as itself.
assert.ok(rows.every(r => r.phase === 'start' || r.phase === 'end'), 'every row has a phase');
const firstEnd = rows.findIndex(r => r.phase === 'end');
assert.ok(firstEnd > 0, 'the day starts before it ends');
assert.ok(rows.slice(firstEnd).every(r => r.phase === 'end'), 'the end of the day is the tail of the table');
const caps = rows.filter(r => r.nightcap);
assert.strictEqual(caps.length, 1, 'one nightcap');
assert.strictEqual(caps[0].action, 'drink');
assert.strictEqual(caps[0].phase, 'end');
assert.ok(!rows.some(r => r.phase === 'start' && r.nightcap), 'nothing in the morning overdrinks');

// A plan locked before rows carried a phase is brought up to date in place, because unlocking to
// get the field back would plan again on today's prices -- which is the very thing Lock was
// keeping. Round-tripped against the generator: strip the three fields off a real plan and the
// upgrade has to put back exactly what dayRows produced, row for row.
{
	const bare = JSON.parse(JSON.stringify(rows));
	bare.forEach(r => { delete r.phase; delete r.nightcap; delete r.mix; });
	const cap = rows.filter(r => r.nightcap)[0];
	const kept = rows.filter(r => /Stooper out/.test(r.note || ''))[0];
	const night = {nightcap: cap ? {name: cap.name} : null, stooper: kept ? {name: kept.name} : null};
	const up = plan.upgradeRows(bare, night, {});
	assert.ok(up.ok, 'an older plan upgrades: ' + up.why);
	assert.deepStrictEqual(up.rows.map(r => r.phase), rows.map(r => r.phase), 'every phase back');
	assert.deepStrictEqual(up.rows.map(r => !!r.nightcap), rows.map(r => !!r.nightcap), 'the nightcap back');

	// It refuses rather than guesses when its answer disagrees with the plan's own record.
	assert.strictEqual(plan.upgradeRows(bare, {nightcap: {name: 'not in this plan'}, stooper: null}, {}).ok, false);
	assert.strictEqual(plan.upgradeRows(bare, {nightcap: null, stooper: null}, {}).ok, false,
		'a plan that records no nightcap but reads as having one');

	// The Cup's three ingredients, recovered by counting names the plan lists rather than by
	// splitting the note -- the oldest notes are comma-separated and sixty item names contain a
	// comma and a space.
	const into = {'Happy Birthday, Claude! cake': 'the Cup of 13s', 'grease gun': 'the Cup of 13s'};
	const oldNote = 'mix and drink: grease gun, Happy Birthday, Claude! cake, Happy Birthday, Claude! cake';
	const cupRows = [{name: 'Cup of 13s', action: 'drink', kind: 'item', count: 1, note: oldNote, room: [0, 1, 0]}];
	const upCup = plan.upgradeRows(cupRows, {nightcap: null, stooper: null}, into);
	assert.ok(upCup.ok);
	assert.deepStrictEqual(upCup.rows[0].mix.slice().sort(),
		['Happy Birthday, Claude! cake', 'Happy Birthday, Claude! cake', 'grease gun'].sort(),
		'a comma in an item name does not split it in two');
	// and the newer note shape, with counts and tiers
	const newNote = 'mix and drink 2 × grease gun + Happy Birthday, Claude! cake (tier 3): the Cup takes almost anything';
	const upNew = plan.upgradeRows([Object.assign({}, cupRows[0], {note: newNote})], {nightcap: null, stooper: null}, into);
	assert.deepStrictEqual(upNew.rows[0].mix.slice().sort(),
		['Happy Birthday, Claude! cake', 'grease gun', 'grease gun'].sort(), 'counts and tiers too');

	// The oldest plans carry no `into` at all, so the note's own separators are all there is. That
	// works until a name has a comma in it, and then the count is what catches it: the Cup takes
	// exactly three things, so a split that doesn't come out at three has read a name in half and
	// is refused rather than mixed wrongly.
	const plain = 'mix and drink: grease gun, second-hand synthetic sloth skin scabbard, second-hand synthetic sloth skin scabbard';
	const upPlain = plan.upgradeRows([Object.assign({}, cupRows[0], {note: plain})], {nightcap: null, stooper: null}, null);
	assert.deepStrictEqual(upPlain.rows[0].mix,
		['grease gun', 'second-hand synthetic sloth skin scabbard', 'second-hand synthetic sloth skin scabbard'],
		'no into, and the note splits cleanly');
	const upAmbiguous = plan.upgradeRows([cupRows[0]], {nightcap: null, stooper: null}, null);
	assert.strictEqual(upAmbiguous.rows[0].mix, undefined, 'a comma in a name is refused, not guessed');
	assert.ok(/doesn.t say what to mix/.test(upAmbiguous.why), 'and it says so');
}

// The Stooper's point of liver has to be spent by the last drink of the day. Spending it earlier
// leaves you over your limit for everything after, which is not a smaller day but no day at all:
// you cannot adventure falling-down drunk and KoL will not start another drink either. The
// keep-back only ever looked at the liver group, so a day whose one 1-drunk drink is the Cup of
// 13s -- which isn't booze and isn't in that group -- counted the point and never said to put the
// Stooper out.
{
	const noOnes = JSON.parse(JSON.stringify(data));
	noOnes.account.cup = true;
	noOnes.account.shotglass = false;  // the shotglass drink is the other way to be 1 drunk
	noOnes.cup = {gems: 13, tiers: {5: [{name: 'porquoise', price: 400}], 3: [{name: 'hamethyst', price: 150}]}};
	noOnes.menu = noOnes.menu.filter(x => !(x.organ === 'liver' && x.size === 1));
	const cfgS = plan.buildConfig(noOnes, {stooper: true, nightcap: true});
	const rowsS = plan.dayRows(plan.planFor(plan.sweep(cfgS), 500000)[2], cfgS);
	const cupS = rowsS.find(r => r.name === 'Cup of 13s');
	assert.ok(cupS, 'the Cup is in this plan');
	assert.strictEqual(cupS.phase, 'end', 'and it is kept back for the Stooper');
	assert.ok(/Stooper out/.test(cupS.note), 'and says to put the Stooper out');
	assert.ok(/with the Stooper out/.test(rowsS.find(r => r.nightcap).note),
		'the nightcap needs it out too, or it is refused for being too drunk');
	// the drink that spends the point must be the last one before the nightcap
	const drinks = rowsS.filter(r => r.room[1] > 0);
	assert.strictEqual(drinks[drinks.length - 2].name, 'Cup of 13s', 'last drink before the nightcap');

	// A saved plan with the same hole is repaired without re-planning: the same rows, the same
	// adventures and the same meat, with the Cup moved to where a drink spending that point has
	// to be.
	// Built the way a plan saved before this fix actually looked: no Stooper rows at all, and the
	// Cup among the cleaners in the start of the day, where it spends the point far too early.
	const holed = {night: {nightcap: {name: rowsS.find(r => r.nightcap).name}, stooper: null}};
	holed.rows = rowsS.filter(r => r.name !== 'Stooper' && r.name !== 'Cup of 13s').map(r => Object.assign({}, r));
	const oldCup = Object.assign({}, rowsS.find(r => r.name === 'Cup of 13s'));
	oldCup.phase = 'start';
	delete oldCup.stooper;
	oldCup.note = oldCup.note.replace(/; before your last turns.*$/, '');
	holed.rows.splice(holed.rows.filter(r => r.phase === 'start').length, 0, oldCup);
	holed.rows.forEach(r => { if (r.nightcap) r.note = r.note.replace('; with the Stooper out', ''); });
	const fixed = plan.upgradeRows(holed.rows, holed.night, {}, true);
	assert.ok(fixed.ok, fixed.why);
	// The only rows gained are the Stooper's own, which carry no adventures and no meat.
	const added = fixed.rows.length - holed.rows.length;
	assert.strictEqual(fixed.rows.filter(r => r.name === 'Stooper').length, added, 'only Stooper rows added');
	assert.ok(added >= 1, 'the Stooper is a row of its own, not a note on somebody else\u2019s');
	assert.ok(fixed.rows.filter(r => r.name === 'Stooper').every(r => r.kind === 'familiar' && r.phase === 'end'),
		'and they are familiar rows at the end of the day');
	assert.ok(Math.abs(fixed.rows.reduce((s, r) => s + (r.adv || 0), 0) - holed.rows.reduce((s, r) => s + (r.adv || 0), 0)) < 1e-9,
		'the same adventures');
	assert.ok(Math.abs(fixed.rows.reduce((s, r) => s + r.cost, 0) - holed.rows.reduce((s, r) => s + r.cost, 0)) < 1e-9,
		'for the same meat');
	assert.strictEqual(fixed.rows.find(r => r.name === 'Cup of 13s').phase, 'end');
	assert.ok(/Stooper out/.test(fixed.rows.find(r => r.name === 'Cup of 13s').note));
	// and a plan that already keeps a drink back is left alone
	const already = plan.upgradeRows(rowsS.map(r => Object.assign({}, r)), holed.night, {}, true);
	assert.deepStrictEqual(already.rows.map(r => r.name), rowsS.map(r => r.name), 'nothing moved twice');
}

// Handing a plan to cowl_diet_do.ash: one record per step, "^" between fields and "|" between
// steps, in the order that script reads them. Pinned because the two have to agree exactly, and a
// field slipping a place would have it eating the wrong row.
assert.strictEqual(plan.stepRecord(rows[0]), 'start^cast^skill^The Ode to Booze^1^^^0^0^0^0^0');
const toiletRow = rows.find(r => r.name === 'Pork Elf toilet');
assert.strictEqual(plan.stepRecord(toiletRow), 'start^use^campground^Pork Elf toilet^1^^^-1^0^0^0^0',
	'the toilet gives a point of fullness back, and the record says so');
const capRow = rows[rows.length - 1];
assert.ok(/^end\^drink\^item\^/.test(plan.stepRecord(capRow)) && /\^nightcap\^/.test(plan.stepRecord(capRow)),
	'the nightcap goes over as an end-of-day drink, flagged');
assert.strictEqual(plan.stepList(rows).split('|').length, rows.length, 'one record per row');
assert.ok(!plan.stepList(rows).split('|').some(r => r.split('^').length !== 12), 'twelve fields each');
// A row that wishes for nothing says "0" rather than nothing at all: a trailing empty field is
// dropped by the split at the other end, and the record then arrives one short -- which is how a
// whole plan came back as "a step arrived with 10 fields".
assert.ok(plan.stepList(rows).split('|').every(r => !/\^$/.test(r)), 'no record ends in an empty field');
// A dish that digests carries the button to press, for the same reason: KoLmafia has no table for
// that choice, so without it the morning stops inside one.
const digestRow = rows.find(r => /then pick /.test(r.note || ''));
if (digestRow) {
	assert.strictEqual(digestRow.pick, 'With my Spleen');
	assert.ok(plan.stepRecord(digestRow).endsWith('^With my Spleen'));
}
// The wish carries its target, because a script cannot wish for prose.
const wishRow = rows.find(r => r.name === 'pocket wish');
if (wishRow) {
	assert.strictEqual(wishRow.wish, 'Refined Palate');
	assert.ok(plan.stepRecord(wishRow).endsWith('^Refined Palate'));
}

// The Cup of 13s: a 5 + 5 + 3 mix is 13 adventures for 1 drunk, and worth having at 55k.
const withCup = JSON.parse(JSON.stringify(data));
withCup.account.cup = true;
withCup.cup = {gems: 13, tiers: {5: [{name: 'porquoise', price: 400}], 3: [{name: 'goat', price: 150}]}};
const cupCfg = plan.buildConfig(withCup, {});
const cupPlan = plan.planFor(plan.sweep(cupCfg), 55000);
const cupRow = plan.dayRows(cupPlan[2], cupCfg).find(r => r.name === 'Cup of 13s');
assert.ok(cupRow && cupRow.adv === 13 && cupRow.room[1] === 1, 'the Cup is a 13-adventure, 1-drunk drink');
assert.ok(cupPlan[0] > p[0], 'and it adds adventures');
// and it carries the three things to mix, which is all a script needs to actually make it
assert.deepStrictEqual(cupRow.mix, ['porquoise', 'porquoise', 'goat'], 'the mix, 5 + 5 + 3');
assert.ok(cupRow.mix.every(n => withCup.cup.tiers[5].concat(withCup.cup.tiers[3]).some(t => t.name === n)),
	'and every one of them is a thing the Cup takes');

// What the mall has: a plan can't take more than is for sale, pays for the units it takes, and
// can't use what nobody sells. Sacramento wine with 15 for sale, Psychotic Train wine with none.
const shop = plan.normalize(JSON.parse(JSON.stringify(data)));
const sac = shop.menu.find(x => x.name === 'Sacramento wine').price;
const market = {'Sacramento wine': {stock: [[5, sac], [10, 2 * sac]]}, 'Psychotic Train wine': {stock: []},
	'baked veggie ricotta casserole': {price: 4680, made: true}, 'Clan speakeasy drink': {}};
assert.ok(plan.applyMarket(shop, market, {'Sacramento wine': 21}) > 0);
const capped = shop.menu.find(x => x.name === 'Sacramento wine');
assert.strictEqual(capped.cap, 15, 'capped at what is for sale');
assert.strictEqual(capped.price, Math.ceil((5 * sac + 10 * 2 * sac) / 15), 'priced for all 15, cheapest first');
assert.ok(!shop.menu.some(x => x.name === 'Psychotic Train wine'), 'nobody sells it: gone');
assert.strictEqual(plan.marketPrice({stock: [[2, 3999], [7, 5500]]}, 5), Math.ceil((2 * 3999 + 3 * 5500) / 5));
assert.strictEqual(plan.marketPrice({stock: [[2, 3999], [7, 5500]]}, 1), plan.marketPrice({stock: [[2, 3999], [7, 5500]]}, 5),
	'priced for five at least, like mall_price()');
// a price that barely moves isn't a reason to plan again; one that does is
const calm = plan.normalize(JSON.parse(JSON.stringify(data)));
const patch = calm.menu.find(x => x.name === 'transdermal smoke patch');
assert.strictEqual(plan.applyMarket(calm, {'transdermal smoke patch': {stock: [[1000, Math.round(patch.price * 1.01)]]}}, {}), 0);
assert.strictEqual(plan.applyMarket(calm, {'transdermal smoke patch': {stock: [[1000, Math.round(patch.price * 1.5)]]}}, {}), 1);
// the days either side of a budget, for asking about substitutes in the same request
assert.ok(plan.around(day, 500000, 4).length >= 5);
const shopPlan = plan.planFor(plan.sweep(plan.buildConfig(shop, {})), 500000);
const sacTaken = shopPlan[2].filter(u => /^Sacramento wine\b/.test(u[0])).length;
assert.ok(sacTaken <= 15, 'no more Sacramento wine than there is: ' + sacTaken);
assert.ok(!shopPlan[2].some(u => /Psychotic Train wine/.test(u[0])));
// after the prices button, a price it didn't refresh is for something not on sale
const stale = plan.normalize(JSON.parse(JSON.stringify(data)));
stale.account.refreshedAgo = 0.03;
stale.menu.forEach(x => { x.age = 0.03; });
stale.menu[0].age = 2.7;
assert.strictEqual(plan.dropUnsold(stale), 1);

// Rollover, from what KoLmafia said on the same day (testdata/diet/rollover-*.json).
const R = require('../relay/cowl_diet_rollover.js');
const cat = require(path.join(__dirname, '..', 'testdata', 'diet', 'rollover-2026-10-28.json'));
const mine = R.best(cat, true), top = R.best(cat, false);
assert.strictEqual(mine.wear.acc1, 'Elf Guard insignia (general)', 'the best you own: the insignia first');
assert.strictEqual(mine.wear.weapon, 'deadfall branch', 'your one weapon in your hand, not the Disembodied Hand\'s');
assert.strictEqual(mine.total, 39);
assert.ok(top.total > mine.total && top.wear.pants === 'stinky cheese diaper', 'the best there is wears stinky cheese');
const counted = R.tally(cat, {hat: 'time cop top hat', weapon: 'staph of homophones', offhand: 'green LavaCo Lamp\u2122',
	acc1: 'Counterclockwise Watch', acc2: 'wristwatch of the white knight', acc3: 'Elf Guard insignia (general)',
	familiar: 'Frumious Bandersnatch', famequip: "li'l unicorn costume"});
assert.strictEqual(counted.rows.offhand.adv, 0, 'no off-hand beside a two-handed weapon');
assert.strictEqual(counted.rows.acc2.adv, 0, 'one watch counts');
assert.strictEqual(counted.rows.famequip.adv, 0, 'the unicorn costume is only for the Tot');
assert.strictEqual(counted.total, 5 + 5 + 10 + 9);
const time = R.tally(cat, {hat: 'time helmet', weapon: 'time sword', pants: 'time trousers',
	familiar: 'Disembodied Hand', famequip: 'time sword'});
assert.deepStrictEqual(time.outfits.map(o => o.name), ['Time Trappings'], 'the outfit bonus with every piece on');
assert.strictEqual(time.rows.famequip.adv, 3, 'a second time sword on the Hand');
// with nothing chosen, the campground KoLmafia sees: 40 + Meat Butler 4 + cuckoo clock 3, what it counts today
const bare = R.initial(cat);
bare.gear = {};
bare.gibberer = bare.circadian = false;
assert.strictEqual(R.summary(cat, bare).total, cat.today.total);
assert.strictEqual(R.summary(cat, bare).clicks, 3 + 5 + 1, 'a calendar, the self-help books and the desk calendar');
// What a gear box offers: what you own, best first; then only what you don't own that beats it.
const backs = R.choices(cat, 'back', '', mine.wear);
assert.strictEqual(backs.owned[0].name, 'Elf Guard fuel tank');
assert.ok(backs.rest.length && backs.rest.every(g => g.owned <= 0 && g.adv > backs.owned[0].adv), 'only better ones you lack');
const hats = R.choices(cat, 'hat', '', mine.wear);
assert.strictEqual(hats.mine.name, 'time cop top hat');
assert.strictEqual(hats.rest.length, 0, 'nothing beats a +5 hat');
const acc3 = R.choices(cat, 'acc3', '', mine.wear);
assert.strictEqual(acc3.mine.name, mine.wear.acc3, "an accessory box measures against the best you'd wear in it");
assert.ok(acc3.rest.every(g => g.adv > acc3.mine.adv) && acc3.rest.some(g => g.name === 'Counterclockwise Watch'));
assert.ok(acc3.owned.every((g, i) => !i || acc3.owned[i - 1].adv >= g.adv), 'best first');
assert.deepStrictEqual(R.choices(cat, 'familiar', '', mine.wear).owned.map(f => f.name), ['Disembodied Hand']);

// the etched hourglass: 5 more in the day, none at rollover, and only for someone who has one
assert.strictEqual(R.summary(cat, bare).hourglass, 0);
const glass = Object.assign({}, cat, {today: Object.assign({}, cat.today, {hourglass: true})});
const withGlass = R.initial(glass);
withGlass.gear = {};
withGlass.gibberer = withGlass.circadian = false;
assert.strictEqual(R.summary(glass, withGlass).hourglass, 5);
assert.strictEqual(R.summary(glass, withGlass).total, cat.today.total, 'not rollover');

// The night's rollover is what a nightcap fits under the cap with.
assert.strictEqual(plan.buildConfig(data, {rollover: 127, gibberer: false}).nightcapRoom, 73);
// and what's left unplayed at bedtime is banked too: 127 + 60 leaves a nightcap 13
const tight = plan.buildConfig(data, {rollover: 127, gibberer: false, unplayed: 60});
assert.strictEqual(tight.nightcapRoom, 13);
const tightRows = plan.dayRows(plan.planFor(plan.sweep(tight), 55000)[2], tight);
const tightCap = tightRows.find(r => /^nightcap/.test(r.note || ''));
assert.ok(!tightCap || tightCap.adv <= 13, 'the nightcap never counts past the cap: ' + (tightCap && tightCap.adv));

console.log(`both sweeps in ${seconds.toFixed(1)}s`);
assert.strictEqual(failed, 0, `${failed} budgets differ from the prototype's answers`);
console.log('all passed');
