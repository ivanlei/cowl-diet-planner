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

// Handing a plan to cowl_diet_do.ash: one record per step, "^" between fields and "|" between
// steps, in the order that script reads them. Pinned because the two have to agree exactly, and a
// field slipping a place would have it eating the wrong row.
assert.strictEqual(plan.stepRecord(rows[0]), 'start^cast^skill^The Ode to Booze^1^^^0^0^0');
const toiletRow = rows.find(r => r.name === 'Pork Elf toilet');
assert.strictEqual(plan.stepRecord(toiletRow), 'start^use^campground^Pork Elf toilet^1^^^-1^0^0',
	'the toilet gives a point of fullness back, and the record says so');
const capRow = rows[rows.length - 1];
assert.ok(/^end\^drink\^item\^/.test(plan.stepRecord(capRow)) && /\^nightcap\^/.test(plan.stepRecord(capRow)),
	'the nightcap goes over as an end-of-day drink, flagged');
assert.strictEqual(plan.stepList(rows).split('|').length, rows.length, 'one record per row');
assert.ok(!plan.stepList(rows).split('|').some(r => r.split('^').length !== 10), 'ten fields each');

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
