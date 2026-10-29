// cowl_diet.js -- the Diet Planner page: the budget, the switches, and the plan.
//
// One call to cowl_diet_data.ash for the player's organs and the priced menu, then everything
// happens here. A sweep (cowl_diet_plan.js) works out the best day at every price of an adventure
// once; after that, changing the budget only picks the plan that fits, which is instant. Changing
// a switch -- the Feast of Boris, the Cooler Yeti, the nightcap -- changes what a day can hold, so
// it sweeps again.
//
// The plan is drawn as a table in the order to do things. Each name is a link to the wiki, and an
// item's picture opens KoL's description of it, from cowl_diet_items.ash, asked once per name.
//
// Nothing is planned until Plan is pressed. Then the plan is checked against the mall (cowl_diet_price.ash): how many
// of each thing it takes are for sale today and at what prices. It pays for the units it takes,
// cheapest first, can't take more than there are, and drops what nobody sells; then it plans again
// and checks what the new plan picked, until every item in it is one the mall has. A price in
// KoLmafia's records can be days old and for something nobody is selling any more. It asks about
// the days either side of the budget too, so a substitute is already priced, plans again only for a
// change that matters, and keeps the answers in this browser for a few hours, so opening the page
// again starts from them. While it plans again the old plan stays on screen, dimmed.
//
// "Update prices from the mall" has KoLmafia refresh its prices for every food, booze and other
// consumable at once (cowl_diet_refresh.ash); what that didn't find for sale drops out.
//
// "Lock" keeps the plan on screen, and the choices behind it, in a KoLmafia preference
// (cowlDietLocked, through cowl_diet_save.ash). Until it's unlocked the page shows that plan exactly
// as it was, every time it's opened, and plans and prices nothing.
//
// Three tabs: rollover (cowl_diet_rollover.js), which counts what you'll wear and have at rollover
// -- its total and what you leave unplayed are what a nightcap has to fit under the 200 cap with,
// and the plan tells it back which nightcap it chose; the diet; and shopping, which multiplies the
// plan by a number of days and takes off what you already have (cowl_diet_shop.ash), and can move
// all of the diet's things onto a shelf in your display case (cowl_diet_shelf.ash). Changing a
// switch or the rollover tab dims the plan until Plan is pressed again.
//
// The switches start from what KoLmafia says the character has, and are remembered in this
// browser. Nothing here buys or eats; the storage shelf's button is the one thing that moves items.

(function () {
	var root = document.getElementById('cd-result');
	if (!root || !window.cowlDietPlan) return;
	var P = window.cowlDietPlan;
	var status = document.getElementById('cd-status');
	var budgetBox = document.getElementById('cd-budget');
	var presets = document.getElementById('cd-presets');
	var switchBar = document.getElementById('cd-switches');
	var refresh = document.getElementById('cd-refresh');
	var priceSaid = document.getElementById('cd-price-said');
	var lockBtn = document.getElementById('cd-lock');
	var planBtn = document.getElementById('cd-plan');
	var lockSaid = document.getElementById('cd-lock-said');
	var rollEl = document.getElementById('cd-rollover');
	var shopEl = document.getElementById('cd-shop');
	var tabBar = document.getElementById('cd-tabs');

	var STORE = 'cowlDiet';
	var MARKET_STORE = 'cowlDietMarket', MARKET_HOURS = 3;
	var PRESETS = [25000, 55000, 100000, 250000, 500000, 1000000];
	var CURVE = [10000, 25000, 55000, 100000, 250000, 500000, 1000000, 2000000];
	var TABS = ['rollover', 'diet', 'shopping'];
	var WIKI = 'https://wiki.kingdomofloathing.com/index.php?go=Go&search=';
	var ORGANS = ['fullness', 'drunk', 'spleen'];

	var data = null, frontier = null, cfg = null, choices = {}, budget = 55000, run = 0;
	var market = {}, pricedAt = {}, facts = {}, asked = {};  // the mall's answers; how many each was priced for
	var busy = false;    // planning or checking, after Plan
	var dirty = true;    // the switches or rollover have changed since the plan on screen
	var DONE = 'Every item in this plan is for sale today, priced for the quantity it takes.';
	var rollSum = null, rollApi = null;  // the rollover section's count, once it's drawn
	var tab = 'diet';
	var locked = null;   // the locked plan, while there is one: what's drawn instead of planning
	var shown = null;    // the plan on screen, live or saved, for the shopping tab
	var days = 31, shopFor = '', shopRows = null, shopTimer = null;
	var shelfName = '', shelvesAsked = false;  // the storage shelf, by name

	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	function meat(n) { return Math.round(n).toLocaleString(); }
	function num(n) { return (Math.round(n * 10) / 10).toString(); }
	function short(n) { return n >= 1e6 ? (n / 1e6) + 'M' : n >= 1e3 ? (n / 1e3) + 'k' : String(n); }
	function query(params) {
		return 'pwd=' + encodeURIComponent(window.cowlDietPwd) + Object.keys(params).map(function (k) {
			return '&' + k + '=' + encodeURIComponent(params[k]);
		}).join('');
	}
	function api(file, params) {
		return fetch(file + '?' + query(params), {credentials: 'same-origin'}).then(function (r) { return r.json(); });
	}
	// For what's too long for a URL: a locked plan, a long shopping list.
	function post(file, params) {
		return fetch(file, {method: 'POST', credentials: 'same-origin', body: query(params),
			headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(function (r) { return r.json(); });
	}

	function load() {
		try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; }
	}
	// The mall's answers, kept for a few hours: the stock changes, but not by the minute.
	function loadMarket() {
		try {
			var m = JSON.parse(localStorage.getItem(MARKET_STORE) || 'null');
			if (m && Date.now() - m.t < MARKET_HOURS * 3600000) { market = m.market; pricedAt = m.pricedAt; }
		} catch (e) { /* none kept */ }
	}
	function saveMarket() {
		try {
			localStorage.setItem(MARKET_STORE, JSON.stringify({t: Date.now(), market: market, pricedAt: pricedAt}));
		} catch (e) { /* private window */ }
	}
	function save() {
		try {
			localStorage.setItem(STORE, JSON.stringify({choices: choices, budget: budget, tab: tab, days: days}));
		} catch (e) { /* private window */ }
	}

	// What can be switched, and when it's offered: only things the character has, or could.
	function switches() {
		var a = data.account;
		return [
			['feast', 'Feast of Boris day', '+15 stomach and twice the budget (2026-12-23)', true],
			['toilet', 'Pork Elf toilet', '−1 fullness after a rest; KoLmafia can’t see it, so say so', true],
			['stooper', 'Stooper for the last drink', '+1 liver at the end of the day', a.stooper],
			['nightcap', 'Nightcap', 'one more drink of any size after the day’s turns', true],
			['yeti', 'Cooler Yeti', 'doubles one drink a day for 400 familiar XP', a.yeti],
			['shotglass', 'Mime army shotglass', 'one 1-drunk drink a day costs no liver', a.shotglass],
			['cup', 'Cup of 13s', 'a drink of three ingredients: up to 13 adventures for 1 drunk', a.cup],
			['ring', 'mafia pinky ring', 'wine +12.5%', true],
			['grimaceMap', 'Grimace map pills', 'a distention and a synthetic dog hair pill a day, for 2 adventures', a.grimaceMap]
		].filter(function (s) { return s[3]; });
	}

	function drawControls() {
		budgetBox.value = budget;
		presets.innerHTML = PRESETS.map(function (b) {
			return '<button type="button" data-b="' + b + '">' + short(b) + '</button>';
		}).join('');
		switchBar.innerHTML = switches().map(function (s) {
			return '<label title="' + esc(s[2]) + '"><input type="checkbox" data-k="' + s[0] + '"' +
				(choices[s[0]] ? ' checked' : '') + '> ' + esc(s[1]) + '</label>';
		}).join('');
		lockControls();
	}

	// While a plan is locked nothing that would change it can be touched. The budget and the switches
	// stay as readable as ever -- read-only, and a click on a switch ignored -- rather than greyed out
	// the way a browser draws anything disabled.
	function lockControls() {
		var on = !!locked;
		budgetBox.readOnly = on;
		refresh.disabled = on;
		Array.prototype.forEach.call(presets.querySelectorAll('button'), function (b) { b.disabled = on; });
		Array.prototype.forEach.call(switchBar.querySelectorAll('input'), function (b) {
			b.setAttribute('aria-disabled', on ? 'true' : 'false');
		});
		switchBar.className = 'cd-switches' + (on ? ' cd-frozen' : '');
		planBtn.disabled = on || busy;
		planBtn.textContent = busy ? 'Planning...' : 'Plan';
		lockBtn.disabled = busy || (!on && !frontier);
		lockBtn.textContent = on ? 'Unlock' : 'Lock';
		lockBtn.className = 'cd-refresh' + (on ? ' cd-locked' : '');
		lockSaid.textContent = on ? 'Locked ' + new Date(locked.at).toLocaleString() + ': this page shows this plan, as it was,' +
			' every time it’s opened, and plans and prices nothing until you unlock it.' : '';
		if (rollApi) rollApi.lock(on);
	}

	// The switches, and the night's rollover from the rollover section, the Squamous Gibberer in it.
	function planChoices() {
		var c = {};
		Object.keys(choices).forEach(function (k) { c[k] = choices[k]; });
		if (rollSum) { c.rollover = rollSum.total; c.gibberer = false; c.unplayed = rollSum.unplayed; }
		return c;
	}

	// Sweeps again; resolves true once the new plans are drawn, false if a newer sweep took over.
	// What's on screen stays there, dimmed, until the new plan replaces it.
	function planNow(why) {
		var mine = ++run;
		frontier = null;
		dirty = false;
		root.className = 'cd-stale';
		cfg = P.buildConfig(data, planChoices());
		why = why || 'Planning';
		status.textContent = why + '...';
		var t0 = Date.now();
		return P.sweepAsync(cfg, {}, function (n) {
			if (mine === run) status.textContent = why + '... ' + n + ' days tried';
		}).then(function (fr) {
			if (mine !== run) return false;
			frontier = fr;
			root.className = dirty ? 'cd-stale' : '';
			status.textContent = '';
			status.title = 'planned in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's';
			draw();
			return true;
		});
	}

	function dayBudget(b) { return choices.feast ? 2 * b : b; }

	function roomText(room) {
		return room.map(function (x, i) {
			return x ? (x < 0 ? '−' + -x : x) + ' ' + ORGANS[i] : '';
		}).filter(Boolean).join(', ');
	}

	// "16 base (15–17) + 1 Ode to Booze − 10 over the 200 cap; not booze: no Ode": the parts that add
	// adventures summed, then the ones that are only a note.
	function partsText(parts) {
		var sums = parts.filter(function (p) { return p[1]; }).map(function (p, i) {
			return (i ? (p[1] < 0 ? ' − ' : ' + ') : (p[1] < 0 ? '−' : '')) + num(Math.abs(p[1])) + ' ' + p[0];
		}).join('');
		var notes = parts.filter(function (p) { return !p[1]; }).map(function (p) { return p[0]; });
		return [sums].concat(notes).filter(Boolean).join('; ');
	}

	// What the mall said about something, for beside its name: null if it hasn't been asked.
	function saleNote(name) {
		var m = market[name], have = m && m.stock ? P.stockCount(m.stock) : 0;
		if (!m || !(have || m.price)) return null;
		return have >= 1000000 ? 'from an NPC store' : have ? meat(have) + ' for sale today' : m.made ? 'made from its ingredients' : '';
	}

	// The picture, in a cell of its own; an item's opens KoL's description (see the click handler).
	function iconCell(name) {
		var f = facts[name] || {};
		var out = '<td class="cd-icon">';
		if (f.image) {
			var src = '/images/itemimages/' + f.image;  // items, skills, effects and familiars alike
			out += '<img src="' + esc(src) + '" alt="' + esc(name) + '"' +
				(f.descid ? ' data-desc="' + esc(f.descid) + '" title="KoL’s description"' : '') + '>';
		}
		return out + '</td>';
	}
	// The name in bold, a link to the wiki.
	function nameHtml(name) {
		return '<a class="cd-wiki" href="' + WIKI + encodeURIComponent(name) + '" target="kolwiki" rel="noreferrer"><b>' +
			esc(name) + '</b></a>';
	}

	// The item cell: count, the name in bold (its wiki link), what the mall said, what the row is for.
	function itemCell(r) {
		var out = iconCell(r.name) + '<td class="cd-item">' + (r.count > 1 ? '<span class="cd-n">' + r.count + ' ×</span> ' : '');
		out += nameHtml(r.name);
		if (r.sale !== null && r.sale !== undefined) {
			out += ' <span class="cd-ok" title="checked in the mall">✓</span> <span class="cd-said">' + esc(r.sale) + '</span>';
		}
		if (r.note) out += '<div class="cd-sub">' + esc(r.note) + '</div>';
		return out + '</td>';
	}

	// One line per organ: how big it is for this plan and where each point comes from -- the base,
	// skills, worn equipment and effects (from KoLmafia), the page's switches, and the room this
	// plan's cleaners and expanders free. Anything KoLmafia counts only for today is noted, not planned on.
	var ORGAN_KEYS = ['stomach', 'liver', 'spleen'], ORGAN_NAMES = ['Stomach', 'Liver', 'Spleen'];
	var KINDS = {skill: 'skill', equipment: 'worn', effect: 'effect', other: 'other'};
	function organLines(units) {
		var cap = data.account.capacity || {};
		return '<ul class="cd-organs">' + ORGAN_KEYS.map(function (k, i) {
			var from = [], today = [];
			var parts = (cap[k] && cap[k].parts) || [{name: 'base', amount: data.account[k], kind: 'base'}];
			parts.forEach(function (p) {
				if (p.kind === 'base') from.push(p.amount + ' base');
				else if (p.kind === 'today') today.push('+' + p.amount + ' ' + p.name);
				else if (KINDS[p.kind]) from.push('+' + p.amount + ' ' + p.name + ' (' + KINDS[p.kind] + ')');
			});
			if (i === 0 && cfg.toilet) from.push('+1 Pork Elf toilet (a rest)');
			if (i === 0 && cfg.feast) from.push('+15 Feast of Boris');
			if (i === 1 && cfg.stooper) from.push('+1 Stooper (out for the last drink)');
			var frees = {}, freed = 0;
			units.forEach(function (u) {
				if (u[1] !== 'special' || u[6][i] >= 0) return;
				var name = u[0].split(' + ')[0].replace(' [yeti]', '');
				frees[name] = frees[name] || [0, 0];
				frees[name][0] -= u[6][i];
				frees[name][1] += 1;
				freed -= u[6][i];
			});
			var line = '<b>' + ORGAN_NAMES[i] + ' ' + cfg.room[i] + '</b>: ' + esc(from.join(', '));
			if (freed) {
				line += '; this plan frees ' + esc(Object.keys(frees).map(function (n) {
					return '+' + frees[n][0] + ' with ' + (frees[n][1] > 1 ? frees[n][1] + ' × ' : '') + n;
				}).join(', ')) + ', for <b>' + (cfg.room[i] + freed) + '</b> in all';
			}
			if (i === 1 && cfg.nightcap) line += '; then a nightcap, one more drink of any size after the day’s turns';
			if (today.length) {
				line += ' <span class="cd-said">(today KoLmafia also counts ' + esc(today.join(', ')) +
					', used already; a plan doesn’t count on it)</span>';
			}
			return '<li>' + line + '.</li>';
		}).join('') + '</ul>';
	}

	function rowsTable(rows) {
		var h = ['<table class="cd-order"><thead><tr><th>Action</th><th colspan="2">Item</th><th>Expected adv</th>' +
			'<th>Details</th><th>Fullness</th><th>Adv per fullness</th><th>Meat per fullness</th><th>Cost</th></tr></thead><tbody>'];
		var tAdv = 0, tCost = 0, tRoom = [0, 0, 0];
		rows.forEach(function (r) {
			var size = r.room.reduce(function (s, x) { return s + Math.max(0, x); }, 0);
			tAdv += r.adv || 0;
			tCost += r.cost;
			r.room.forEach(function (x, i) { tRoom[i] += x; });
			h.push('<tr><td class="cd-act">' + esc(r.action) + '</td>' + itemCell(r) +
				'<td class="cd-num">' + (r.adv === null ? '' : num(r.adv)) + '</td>' +
				'<td class="cd-why">' + (r.parts.length ? (r.count > 1 ? 'each: ' : '') + esc(partsText(r.parts)) : '') + '</td>' +
				'<td class="cd-num">' + esc(roomText(r.room)) + '</td>' +
				'<td class="cd-num">' + (r.adv && size ? num(r.adv / size) : '') + '</td>' +
				'<td class="cd-num">' + (r.cost && size ? meat(r.cost / size) : '') + '</td>' +
				'<td class="cd-num">' + (r.cost ? meat(r.cost) : '') + '</td></tr>');
		});
		var tSize = tRoom.reduce(function (s, x) { return s + Math.max(0, x); }, 0);
		h.push('</tbody><tfoot><tr><td></td><td colspan="2">Total</td><td class="cd-num">' + num(tAdv) +
			'</td><td></td><td class="cd-num">' + esc(roomText(tRoom)) + '</td><td class="cd-num">' + (tSize ? num(tAdv / tSize) : '') +
			'</td><td class="cd-num">' + (tSize ? meat(tCost / tSize) : '') + '</td><td class="cd-num">' + meat(tCost) +
			'</td></tr></tfoot></table>');
		return h.join('');
	}

	// What the plan banks for tomorrow, for the rollover tab: the nightcap, and the Stooper's drink.
	function nightOf(rows) {
		var cap = rows.filter(function (r) { return /^nightcap/.test(r.note || ''); })[0];
		var kept = rows.filter(function (r) { return /Stooper out/.test(r.note || ''); })[0];
		var over = cap ? cap.parts.filter(function (x) { return /200 cap/.test(x[0]); })[0] : null;
		return {on: cfg.nightcap, budget: dayBudget(budget), room: cfg.nightcapRoom,
			nightcap: cap ? {name: cap.name, adv: cap.adv, cost: cap.cost, over: over ? -over[1] : 0} : null,
			stooper: kept ? {name: kept.name, adv: kept.adv} : null};
	}

	// Everything the page draws about the plan for this budget, in one object: what's drawn now, and
	// what Lock keeps. null if no plan fits.
	function liveView() {
		var p = P.planFor(frontier, dayBudget(budget));
		if (!p) return null;
		var rows = P.dayRows(p[2], cfg);
		rows.forEach(function (r) { r.sale = saleNote(r.name); });
		var curve = [];
		CURVE.forEach(function (b) {
			var c = P.planFor(frontier, dayBudget(b));
			if (c) curve.push([b, Math.round(c[0]), Math.round(c[1])]);
		});
		// what goes into something rather than being eaten or drunk itself: the Cup's ingredients
		var into = {};
		p[2].forEach(function (u) {
			var cup = /^Cup of 13s \((.*)\)$/.exec(u[0]);
			if (cup) cup[1].split(' + ').forEach(function (x) { into[x] = 'the Cup of 13s'; });
		});
		return {v: 1, adv: p[0], meat: p[1], budget: budget, feast: !!choices.feast, rows: rows,
			organs: organLines(p[2]), curve: curve, items: countsOf(p[2]), into: into, night: nightOf(rows),
			roll: rollSum ? {total: rollSum.total, clicks: rollSum.clicks, potato: rollSum.potato, hourglass: rollSum.hourglass,
				unplayed: rollSum.unplayed} : null};
	}

	function draw() {
		var v = locked || (frontier ? liveView() : null);
		if (!v) {
			if (!frontier) return;
			root.innerHTML = '<p class="cd-said">Nothing fits in ' + meat(dayBudget(budget)) + ' meat.</p>';
			if (rollApi) rollApi.night({on: cfg.nightcap, budget: dayBudget(budget), room: cfg.nightcapRoom, nightcap: null, stooper: null});
			shown = null;
			return;
		}
		shown = v;
		if (rollApi) rollApi.night(v.night);
		var html = [];
		html.push('<div class="cd-head"><span class="cd-adv">' + Math.round(v.adv) + '</span> adventures for <b>' +
			meat(v.meat) + '</b> meat' + (v.feast ? ' (a feast day, on twice the budget)' : '') + '</div>');
		if (v.roll) {
			var day = [v.roll.total + ' at rollover', Math.round(v.adv) + ' from this plan'];
			if (v.roll.clicks) day.push(v.roll.clicks + ' from the Rumpus Room');
			if (v.roll.potato) day.push(v.roll.potato + ' from the potato alarm clock');
			if (v.roll.hourglass) day.push(v.roll.hourglass + ' from the etched hourglass');
			html.push('<div class="cd-day">A day’s turns: ' + esc(day.join(' + ')) + ' = <b>' +
				(v.roll.total + Math.round(v.adv) + v.roll.clicks + v.roll.potato + (v.roll.hourglass || 0)) + '</b></div>');
		}
		html.push(v.organs);
		html.push('<h2>In order</h2>' + rowsTable(v.rows));

		html.push('<h2>What other budgets buy</h2><table class="cd-curve"><tr><th>Meat a day</th><th>Adventures</th><th>Spent</th></tr>');
		v.curve.forEach(function (c) {
			html.push('<tr' + (c[0] === v.budget ? ' class="cd-here"' : '') + (locked ? '' : ' data-b="' + c[0] + '"') + '><td>' +
				meat(c[0]) + '</td><td>' + c[1] + '</td><td>' + meat(c[2]) + '</td></tr>');
		});
		html.push('</table>');
		root.innerHTML = html.join('');
		fetchFacts(v.rows.map(function (r) { return r.name; }));
		if (tab === 'shopping') shopSoon();
		// a budget picked after the last Plan may name things the mall hasn't been asked about
		if (!locked && !busy) {
			var unchecked = Object.keys(v.items).filter(function (n) { return !market[n]; }).length;
			priceSaid.textContent = !unchecked ? DONE : unchecked + (unchecked === 1 ? ' thing in this plan hasn’t'
				: ' things in this plan haven’t') + ' been checked against the mall: press Plan to check.';
		}
	}

	function showTab(name) {
		tab = TABS.indexOf(name) >= 0 ? name : 'diet';
		TABS.forEach(function (t) {
			document.getElementById('cd-tab-' + t).hidden = t !== tab;
			var b = tabBar.querySelector('[data-tab="' + t + '"]');
			b.className = 'cd-tab' + (t === tab ? ' cd-on' : '');
			b.setAttribute('aria-selected', t === tab ? 'true' : 'false');
		});
		if (tab === 'shopping') shopSoon(0);
	}

	// Pictures and description ids for names, asked once each; the plan and the shopping list are
	// drawn again when they arrive.
	function fetchFacts(list) {
		var names = list.filter(function (n, i, all) { return !asked[n] && all.indexOf(n) === i; });
		if (!names.length) return;
		names.forEach(function (n) { asked[n] = 1; });
		post('cowl_diet_items.ash', {names: names.join('|')}).then(function (res) {
			if (!res.ok) return;
			Object.keys(res.facts).forEach(function (n) { facts[n] = res.facts[n]; });
			draw();
			if (shopRows) drawShop();
		}).catch(function () { names.forEach(function (n) { delete asked[n]; }); });
	}

	// How many of each thing a plan buys, by name: helpers, cleaners and the Cup's ingredients included.
	function countsOf(units) {
		var n = {};
		units.forEach(function (u) {
			var label = u[0].replace(/ \((nightcap|Digestion)\)$/, '').replace(' [yeti]', '');
			var cup = /^Cup of 13s \((.*)\)$/.exec(label);
			(cup ? cup[1] : label).split(' + ').forEach(function (x) { n[x] = (n[x] || 0) + 1; });
		});
		return n;
	}

	// Asks the mall about what the plan on screen picked that it hasn't asked about, prices each for
	// the quantity the plan takes, and plans again; then checks the new plan the same way, a few
	// rounds at most. Asking again isn't needed for more of something already asked about.
	function checkPrices(round) {
		var p = !locked && frontier && P.planFor(frontier, dayBudget(budget));
		if (!p) return Promise.resolve();
		var counts = countsOf(p[2]), names = Object.keys(counts);
		// and the days either side, so what the plan turns to is priced in the same request
		var near = {};
		P.around(frontier, dayBudget(budget), 4).forEach(function (units) {
			Object.keys(countsOf(units)).forEach(function (n) { near[n] = 1; });
		});
		names.forEach(function (n) { delete near[n]; });
		var ask = names.concat(Object.keys(near)).filter(function (n) { return !market[n]; });
		var more = names.filter(function (n) { return market[n] && counts[n] > (pricedAt[n] || 0); });
		names.forEach(function (n) { pricedAt[n] = Math.max(pricedAt[n] || 0, counts[n]); });
		if (!ask.length && !more.length) {
			priceSaid.textContent = DONE;
			return Promise.resolve();
		}
		priceSaid.textContent = ask.length ? 'Asking the mall how many of ' + ask.length + ' things in and near the plan are' +
			' for sale' + (round > 1 ? ' (round ' + round + ')' : '') + '...' : 'Pricing more of what the plan takes...';
		var asking = !ask.length ? Promise.resolve() : api('cowl_diet_price.ash', {items: ask.join('|')}).then(function (res) {
			if (!res.ok) throw new Error(res.error || 'The mall didn’t answer.');
			ask.forEach(function (n) { market[n] = res.market[n] || {}; });  // asked, whatever the answer
		});
		return asking.then(function () {
			saveMarket();
			if (locked) return;
			if (!P.applyMarket(data, market, pricedAt)) {
				draw();  // for the ticks on what was just asked about
				priceSaid.textContent = DONE;
				return;
			}
			priceSaid.textContent = 'The mall has answered; planning again on what it has...';
			return planNow('Planning again on what the mall has').then(function (done) {
				if (done && round < 8) return checkPrices(round + 1);
				if (done) priceSaid.textContent = 'Still checking after 8 rounds; the plan may change once more.';
			});
		});
	}

	// Plan: plans again if anything has changed since the plan on screen, and checks it against the
	// mall either way. Nothing else plans.
	function planPressed() {
		if (locked || busy) return;
		busy = true;
		lockControls();
		priceSaid.textContent = '';
		(frontier && !dirty ? Promise.resolve(true) : planNow()).then(function (done) {
			if (done) return checkPrices(1);
		}).catch(function (e) {
			priceSaid.textContent = (e && e.message) || 'The mall didn’t answer.';
		}).then(function () {
			busy = false;
			lockControls();
		});
	}

	// Something the plan depends on changed: the plan on screen dims until Plan is pressed.
	function stale(what) {
		dirty = true;
		if (root.innerHTML) root.className = 'cd-stale';
		if (!busy) status.textContent = what + ': press Plan to plan again.';
	}

	// The button: KoLmafia's prices for whole categories, the data again, and a plan on them, which
	// is then checked like any other. Anything the refresh didn't find for sale is gone.
	function updatePrices() {
		refresh.disabled = true;
		priceSaid.textContent = 'Asking the mall for every food, booze and other consumable...';
		api('cowl_diet_refresh.ash', {}).then(function (res) {
			if (!res.ok) throw new Error(res.error);
			priceSaid.textContent = 'KoLmafia has ' + res.updated.toLocaleString() + ' fresh prices. Reading them...';
			return api('cowl_diet_data.ash', {});
		}).then(function (d) {
			if (!d.ok) throw new Error(d.error);
			data = P.normalize(d);
			var gone = P.dropUnsold(data);
			market = {};
			pricedAt = {};
			saveMarket();
			priceSaid.textContent = 'KoLmafia has fresh prices' + (gone ? '; ' + gone + ' things it had prices for aren’t for sale' : '') + '.';
			stale('Prices refreshed');
		}).catch(function (e) {
			priceSaid.textContent = (e && e.message) || 'The mall didn’t answer.';
		}).then(function () {
			refresh.disabled = !!locked;
		});
	}

	// Lock: the plan on screen and the choices behind it go into a KoLmafia preference, and
	// the page shows that until it's unlocked. Unlocking, once confirmed, clears it; Plan then plans
	// again from those choices.
	function toggleLock() {
		// a locked plan is what you shopped for: unlocking throws it away, so it asks first
		if (locked && !window.confirm('Unlock and discard this plan?')) return;
		lockBtn.disabled = true;
		var snap = null;
		if (!locked) {
			snap = frontier ? liveView() : null;
			if (!snap) { lockBtn.disabled = false; return; }
			snap.at = Date.now();
			snap.choices = choices;
		}
		post('cowl_diet_save.ash', {key: 'locked', value: snap ? JSON.stringify(snap) : ''}).then(function (res) {
			if (!res.ok) throw new Error(res.error);
			locked = snap;
			lockControls();
			if (locked) {
				root.className = '';
				status.textContent = '';
				priceSaid.textContent = '';
				draw();
			} else if (frontier) {
				dirty = true;
				draw();
				stale('Unlocked');
			} else {
				stale('Unlocked');
			}
		}).catch(function (e) {
			lockSaid.textContent = (e && e.message) || 'KoLmafia didn’t keep it.';
		}).then(lockControls);
	}

	// --- Shopping ----------------------------------------------------------------------
	//
	// The plan on screen (or the locked one) times a number of days, against what you have anywhere
	// KoLmafia can see -- inventory, closet, Hagnk's, display case -- and how many more to get. What
	// you'd cook or mix comes apart into ingredients. Asked again when the plan or the days change and
	// the tab is showing.

	function shopSoon(wait) {
		clearTimeout(shopTimer);
		shopTimer = setTimeout(askShop, wait === undefined ? 600 : wait);
	}

	// The box for the days is drawn once, so typing in it never loses its place; the rest follows.
	function shopFrame() {
		if (document.getElementById('cd-days')) return;
		shopEl.innerHTML = '<h2>Storage shelf</h2><p class="cd-said">A shelf in your display case to keep the diet’s' +
			' things on, out of the way of anything that tidies your inventory. Moving puts every one you have of them, from' +
			' your inventory, your closet and Hagnk’s, in the case on that shelf, with any already in the case on another' +
			' shelf.</p><div class="cd-controls"><label class="cd-budget">Shelf <select id="cd-shelf" disabled><option>' +
			'reading your display case...</option></select></label><button type="button" class="cd-refresh"' +
			' id="cd-shelf-move" disabled>Move the diet’s things to this shelf</button></div>' +
			'<div class="cd-said cd-shelf-said" id="cd-shelf-said"></div>' +
			'<h2>Shopping</h2><div class="cd-controls"><label class="cd-budget">Days to shop for' +
			' <input type="number" id="cd-days" min="1" max="366" step="1" value="' + days + '"></label>' +
			'<span class="cd-said" id="cd-shop-from"></span></div><p class="cd-said" id="cd-shop-note"></p>' +
			'<div id="cd-shop-list"></div>';
		readShelves();
	}

	// --- The storage shelf ---------------------------------------------------------------
	//
	// Chosen and kept by name (cowl_diet_shelf.ash turns it into KoL's number only when moving), so
	// adding or removing other shelves never sends the diet's things to the wrong one.

	function readShelves() {
		if (shelvesAsked) return;
		shelvesAsked = true;
		api('cowl_diet_shelf.ash', {action: 'list'}).then(function (res) {
			var pick = document.getElementById('cd-shelf');
			if (!res.ok) throw new Error(res.error);
			if (!res.hasCase) {
				pick.innerHTML = '<option>you have no display case</option>';
				return;
			}
			shelfName = res.shelves.indexOf(res.chosen) >= 0 ? res.chosen : '';
			pick.innerHTML = '<option value="">choose a shelf</option>' + res.shelves.map(function (name) {
				return '<option value="' + esc(name) + '"' + (name === shelfName ? ' selected' : '') + '>' + esc(name) + '</option>';
			}).join('');
			pick.disabled = false;
			shelfButton();
		}).catch(function (e) {
			shelvesAsked = false;
			document.getElementById('cd-shelf-said').textContent = (e && e.message) || 'KoLmafia didn’t answer.';
		});
	}

	// What there is to move: the list's things you have anywhere a move takes from or files.
	function shelfItems() {
		return (shopRows || []).filter(function (r) {
			return r.kind !== 'none' && r.inventory + r.closet + r.storage + r.display > 0;
		});
	}
	function shelfButton() {
		var b = document.getElementById('cd-shelf-move');
		if (b) b.disabled = !shelfName || !shelfItems().length;
	}

	function moveToShelf() {
		var rows = shelfItems(), said = document.getElementById('cd-shelf-said');
		if (!shelfName || !rows.length) return;
		var total = rows.reduce(function (n, r) { return n + r.inventory + r.closet + r.storage + r.display; }, 0);
		if (!window.confirm('Move every one you have of the diet’s ' + rows.length + ' things (' + meat(total) +
			' in all) to the “' + shelfName + '” shelf in your display case?')) return;
		var b = document.getElementById('cd-shelf-move');
		b.disabled = true;
		said.textContent = 'Moving them to “' + shelfName + '”...';
		post('cowl_diet_shelf.ash', {action: 'move', shelf: shelfName,
			items: rows.map(function (r) { return r.name; }).join('|')}).then(function (res) {
			if (!res.ok) throw new Error(res.error);
			said.textContent = 'Put ' + res.shelved + (res.shelved === 1 ? ' thing' : ' things') + ' on “' + res.shelf + '”.' +
				(res.skipped.length ? ' A display case won’t take ' + res.skipped.join(', ') + ', so they’re where they were.' : '');
			shopFor = '';  // where everything is now
			askShop();
		}).catch(function (e) {
			said.textContent = (e && e.message) || 'KoLmafia didn’t answer.';
			shelfButton();
		});
	}

	function shopSay(list) {
		shopFrame();
		document.getElementById('cd-shop-from').textContent = !shown ? '' : (locked ? 'the locked plan' : 'the plan on the' +
			' Diet tab') + ': ' + meat(shown.meat) + ' meat and ' + Math.round(shown.adv) + ' adventures a day' +
			(shown.feast ? ', a feast day' : '');
		document.getElementById('cd-shop-note').textContent = 'What you have counts your inventory, closet, Hagnk’s and' +
			' display case. Anything you’d cook or mix is broken into what goes in it, for as many as you’re short.' +
			(shown && shown.feast ? '' : ' The Feast of Boris day eats more: shop for it on its own.');
		if (list !== undefined) document.getElementById('cd-shop-list').innerHTML = list;
	}

	function askShop() {
		if (!shown) {
			shopSay('<p class="cd-said">Waiting for a plan on the Diet tab.</p>');
			return;
		}
		var need = Object.keys(shown.items).map(function (n) { return n + ':' + shown.items[n] * days; }).join('|');
		var key = need + '#' + (locked ? locked.at : 'live');
		if (key === shopFor && shopRows) return;
		shopFor = key;
		post('cowl_diet_shop.ash', {need: need}).then(function (res) {
			if (!res.ok) throw new Error(res.error);
			if (key !== shopFor) return;  // a newer list was asked for
			shopRows = res.rows;
			drawShop();
			shelfButton();
			fetchFacts(shopRows.map(function (r) { return r.name; }));
		}).catch(function (e) {
			shopSay('<p class="cd-said">' + esc((e && e.message) || 'KoLmafia didn’t answer.') + '</p>');
		});
	}

	// What goes into the Cup of 13s; for a plan saved before that was kept, read off the Cup's row.
	function intoOf(v) {
		if (v.into) return v.into;
		var into = {};
		v.rows.forEach(function (r) {
			if (r.name !== 'Cup of 13s' || !r.note) return;
			r.note.replace(/^mix and drink:? /, '').split(': the Cup')[0].split(/, | \+ /).forEach(function (x) {
				into[x.replace(/^\d+ \u00d7 /, '').replace(/ \(tier \d\)$/, '')] = 'the Cup of 13s';
			});
		});
		return into;
	}

	function drawShop() {
		var perDay = shown ? shown.items : {};
		var h = ['<table class="cd-order cd-shop"><thead><tr><th colspan="2">Item</th><th>A day</th><th>For ' +
			days + ' days</th><th>You have</th><th>To get</th><th>Mall today</th><th>About</th></tr></thead><tbody>'];
		var total = 0;
		var into = shown ? intoOf(shown) : {};
		shopRows.forEach(function (r) {
			var have = r.inventory + r.closet + r.storage + r.display, buy = Math.max(0, r.need - have);
			var goes = r.parent || into[r.name];
			var where = [['inventory', r.inventory], ['closet', r.closet], ['Hagnk’s', r.storage], ['display case', r.display]]
				.filter(function (w) { return w[1]; }).map(function (w) { return w[0] + ' ' + meat(w[1]); }).join(' · ');
			var get, cost = 0;
			if (!buy) get = '<span class="cd-ok">✓ enough</span>';
			else if (r.kind === 'make') get = '<b>make ' + meat(buy) + '</b>';
			else if (r.kind === 'none') get = '<b>' + meat(buy) + '</b><div class="cd-sub">can’t be bought ahead: at the Speakeasy, or as it comes</div>';
			else { get = '<b>' + meat(buy) + '</b>'; cost = buy * r.price; }
			total += cost;
			var m = market[r.name], stock = m && m.stock ? P.stockCount(m.stock) : null;
			var mall = stock === null ? '' : stock >= 1000000 ? 'an NPC store' : meat(stock) + ' for sale' +
				(buy > stock ? ' <span class="cd-short">— not enough today</span>' : '');
			h.push('<tr class="' + (r.parent ? 'cd-part' : '') + '">' + iconCell(r.name) + '<td class="cd-item">' + nameHtml(r.name) +
				(goes ? '<div class="cd-sub">goes into ' + esc(goes) + '</div>' : '') + '</td>' +
				'<td class="cd-num">' + (perDay[r.name] ? perDay[r.name] : '') + '</td>' +
				'<td class="cd-num">' + meat(r.need) + '</td>' +
				'<td class="cd-num">' + (have ? meat(have) + '<div class="cd-sub">' + esc(where) + '</div>' : '') + '</td>' +
				'<td class="cd-num">' + get + '</td><td class="cd-num">' + mall + '</td>' +
				'<td class="cd-num">' + (cost ? meat(cost) : '') + '</td></tr>');
		});
		h.push('</tbody><tfoot><tr><td></td><td>To spend</td><td></td><td></td><td></td><td></td><td></td><td class="cd-num">' +
			meat(total) + '</td></tr></tfoot></table><p class="cd-said">“About” is at KoLmafia’s recorded prices; “Mall today”' +
			' is what the plan’s check found for sale, where it asked.</p>');
		shopSay(h.join(''));
	}

	shopEl.addEventListener('change', function (e) {
		if (e.target.id !== 'cd-shelf') return;
		shelfName = e.target.value;
		post('cowl_diet_save.ash', {key: 'shelf', value: shelfName}).catch(function () { /* kept next time */ });
		shelfButton();
	});
	shopEl.addEventListener('click', function (e) {
		if (e.target.id === 'cd-shelf-move') moveToShelf();
	});
	shopEl.addEventListener('input', function (e) {
		if (e.target.id !== 'cd-days') return;
		var d = parseInt(e.target.value, 10);
		if (!(d >= 1 && d <= 366)) return;
		days = d;
		save();
		shopSoon();
	});

	budgetBox.addEventListener('input', function () {
		var b = parseInt(budgetBox.value, 10);
		if (!(b >= 0) || locked) return;
		budget = b;
		save();
		draw();
	});
	presets.addEventListener('click', function (e) {
		var b = e.target.getAttribute('data-b');
		if (!b || locked) return;
		budget = +b;
		budgetBox.value = budget;
		save();
		draw();
	});
	// a locked plan's switches can't be changed: the click is ignored, so the box never flips
	switchBar.addEventListener('click', function (e) {
		if (locked && e.target.getAttribute && e.target.getAttribute('data-k')) e.preventDefault();
	});
	switchBar.addEventListener('change', function (e) {
		var k = e.target.getAttribute('data-k');
		if (!k || locked) return;
		choices[k] = e.target.checked;
		save();
		stale('A switch changed');
	});
	refresh.addEventListener('click', updatePrices);
	// An item's picture, anywhere on the page: KoL's description of it, in a small window of its own.
	document.addEventListener('click', function (e) {
		var pic = e.target.closest && e.target.closest('img[data-desc]');
		if (!pic) return;
		window.open('/desc_item.php?whichitem=' + encodeURIComponent(pic.getAttribute('data-desc')), 'kol_desc',
			'width=380,height=440,resizable=yes,scrollbars=yes');
	});
	lockBtn.addEventListener('click', toggleLock);
	planBtn.addEventListener('click', planPressed);
	tabBar.addEventListener('click', function (e) {
		var b = e.target.closest && e.target.closest('[data-tab]');
		if (!b) return;
		showTab(b.getAttribute('data-tab'));
		save();
		try { history.replaceState(null, '', '#' + tab); } catch (err) { /* a page without history */ }
	});
	root.addEventListener('click', function (e) {
		var row = e.target.closest && e.target.closest('tr[data-b]');
		if (row && !locked) {
			budget = +row.getAttribute('data-b');
			budgetBox.value = budget;
			save();
			draw();
		}
	});

	// The data and the rollover catalogue together, so the first plan is on the night's real rollover.
	// A locked plan is drawn as it was, and nothing is planned.
	Promise.all([
		api('cowl_diet_data.ash', {}),
		api('cowl_diet_rollover.ash', {}).catch(function () { return null; })
	]).then(function (res) {
		var d = res[0], roll = res[1];
		if (!d.ok) { status.textContent = d.error || 'KoLmafia didn’t answer.'; return; }
		data = P.normalize(d);
		P.dropUnsold(data);
		loadMarket();  // what the mall said in the last few hours, so the first plan starts from it
		P.applyMarket(data, market, pricedAt);
		var saved = load(), a = data.account;
		try { locked = d.account.locked ? JSON.parse(d.account.locked) : null; } catch (e) { locked = null; }
		if (locked && locked.v !== 1) locked = null;
		budget = locked ? locked.budget : saved.budget >= 0 ? saved.budget : 55000;
		days = saved.days >= 1 ? saved.days : 31;
		choices = {feast: a.feastToday, toilet: a.toilet, stooper: a.stooper, nightcap: true, yeti: a.yeti,
			shotglass: a.shotglass, cup: a.cup, ring: a.ring, grimaceMap: a.grimaceMap};
		Object.keys(saved.choices || {}).forEach(function (k) {
			if (k !== 'feast') choices[k] = saved.choices[k];  // the feast follows the calendar
		});
		if (locked) choices = locked.choices;
		if (roll && roll.ok && rollEl && window.cowlDietRollover) {
			rollApi = window.cowlDietRollover.mount(rollEl, roll, function (sum) {
				var before = rollSum.total + rollSum.unplayed;
				rollSum = sum;
				if (sum.total + sum.unplayed !== before) stale('The Rollover tab changed'); else draw();
			});
			rollSum = rollApi.summary;
		} else if (rollEl) {
			rollEl.innerHTML = '<p class="cd-said">KoLmafia didn’t answer about rollover. Reload the page.</p>';
		}
		drawControls();
		showTab(location.hash && TABS.indexOf(location.hash.slice(1)) >= 0 ? location.hash.slice(1) : saved.tab);
		if (locked) {
			status.textContent = '';
			draw();
			return;
		}
		root.innerHTML = '<p class="cd-said cd-wait">Set the budget, the switches and the Rollover tab, then press' +
			' <b>Plan</b>.</p>';
		status.textContent = '';
	}).catch(function () { status.textContent = 'KoLmafia didn’t answer. Reload the page.'; });
})();
