// cowl_diet_rollover.js -- the Diet Planner's rollover section: what you'll wear and have at rollover,
// and so how many adventures each night starts the next day with.
//
// From cowl_diet_rollover.ash: every piece of equipment that adds adventures at rollover (at its
// December figure), the outfits whose bonus does, your familiars, your campground and Chateau, your
// clan's Rumpus Room, and what you chose last time.
//
// For every slot it suggests the best there is, ★ where you own it, and a box for what you'll
// actually wear, with the slot's gear to pick from as you type. The boxes start from the best you
// own. What you type is counted the way the game counts it: one watch, single-equip items once, no
// off-hand beside a two-handed weapon, a Disembodied Hand holding a one-handed weapon and a Left-Hand
// Man an off-hand, an outfit's bonus once every piece is on. The campground is the same: the best
// suggested, and boxes for what you have, ticked from what KoLmafia sees.
//
// The total feeds the planner: a nightcap is worth only what fits under the 200 cap after rollover
// and whatever you leave unplayed at bedtime. The diet plan tells it back which nightcap it chose
// and how much it banks, so tonight's bank -- rollover, unplayed, the nightcap -- adds up to 200 or
// less, never more. The choices are kept in KoLmafia (cowl_diet_save.ash), so every browser sees the
// same ones.
//
// The counting is plain functions, exported for node; the drawing needs a page.

(function (exports) {
	var SLOTS = [
		['hat', 'Head', 'hat'], ['back', 'Back', 'back'], ['shirt', 'Shirt', 'shirt'],
		['weapon', 'Weapon', 'weapon'], ['offhand', 'Off-hand', 'offhand'], ['pants', 'Pants', 'pants'],
		['acc1', 'Accessory', 'acc'], ['acc2', 'Accessory', 'acc'], ['acc3', 'Accessory', 'acc'],
		['familiar', 'Familiar', null], ['famequip', 'Familiar equipment', 'familiar']
	];
	var WORN = ['hat', 'back', 'shirt', 'weapon', 'offhand', 'pants', 'acc1', 'acc2', 'acc3'];
	var HAND = 'Disembodied Hand', LEFT = 'Left-Hand Man';
	var BASE = 40;
	var GIBBERER = 30;    // +1 a night per 15 fights with it out: a 450-fight day
	var CIRCADIAN = 11;   // the most Recall Facts: Circadian Rhythms banks in a day
	var POTATO = 5;       // at the first login, past the cap

	function key(s) { return String(s || '').trim().toLowerCase(); }
	function index(cat) {
		if (!cat._by) {
			cat._by = {};
			cat.gear.forEach(function (g) { cat._by[key(g.name)] = g; });
		}
		return cat._by;
	}
	// How many of one item a loadout can wear: one if it's single-equip, else what you own (or three).
	function cap(g, own) { return g.single ? 1 : own ? g.owned : 3; }
	// Best first; on a tie, what you own, then what can be bought.
	function rank(a, b) {
		return b.adv - a.adv || (b.owned > 0) - (a.owned > 0) || b.tradeable - a.tradeable || (a.name < b.name ? -1 : 1);
	}

	// One loadout, with some slots already decided (an outfit's pieces).
	function fill(cat, pool, own, famOk, forced) {
		var by = index(cat), used = {}, wear = {}, total = 0;
		function adv(name) { var g = by[key(name)]; return g ? g.adv : 0; }
		function take(name) { used[key(name)] = (used[key(name)] || 0) + 1; total += adv(name); }
		function room(g, more) { return (used[key(g.name)] || 0) + (more || 1) <= cap(g, own); }

		['hat', 'back', 'shirt', 'pants'].forEach(function (s) {
			var g = forced[s] ? null : pool.filter(function (x) { return x.slot === s; })[0];
			wear[s] = forced[s] ? forced[s][0] : g ? g.name : '';
			if (wear[s]) take(wear[s]);
		});

		// accessories: an outfit's first, then the best, one watch at most
		var accs = (forced.acc || []).slice();
		var watch = accs.some(function (n) { return (by[key(n)] || {}).watch; });
		accs.forEach(take);
		pool.forEach(function (g) {
			while (g.slot === 'acc' && accs.length < 3 && room(g) && !(g.watch && watch)) {
				accs.push(g.name);
				take(g.name);
				if (g.watch) watch = true;
			}
		});
		while (accs.length < 3) accs.push('');
		wear.acc1 = accs[0]; wear.acc2 = accs[1]; wear.acc3 = accs[2];

		// weapon, off-hand and familiar together: they can hold the same items
		var oneH = pool.filter(function (g) { return g.slot === 'weapon' && g.hands === 1; }).slice(0, 6);
		var twoH = pool.filter(function (g) { return g.slot === 'weapon' && g.hands > 1; }).slice(0, 3);
		var offs = pool.filter(function (g) { return g.slot === 'offhand'; }).slice(0, 6);
		var names = function (list) { return list.map(function (g) { return g.name; }); };
		// on a tie the first found wins: your own hands before the familiar's, one hand before two
		var W = forced.weapon ? [forced.weapon[0]] : names(oneH).concat(names(twoH), ['']);
		var O = forced.offhand ? [forced.offhand[0]] : names(offs).concat(cat.dualWield ? names(oneH) : [], ['']);
		var F = [['', '']];
		pool.forEach(function (g) {
			if (g.slot !== 'familiar') return;
			if (!g['for']) F.push(['', g.name]);
			else if (famOk(g['for'])) F.push([g['for'], g.name]);
		});
		if (famOk(HAND)) oneH.forEach(function (g) { F.push([HAND, g.name]); });
		if (famOk(LEFT)) offs.forEach(function (g) { F.push([LEFT, g.name]); });

		var pick = null;
		W.forEach(function (w) {
			var wg = by[key(w)];
			O.forEach(function (o) {
				if (o && wg && wg.hands > 1) return;
				F.forEach(function (f) {
					var count = {}, sum = 0, ok = true;
					[w, o, f[1]].forEach(function (n) {
						if (!n) return;
						count[key(n)] = (count[key(n)] || 0) + 1;
						sum += adv(n);
					});
					Object.keys(count).forEach(function (k) { if (by[k] && !room(by[k], count[k])) ok = false; });
					if (ok && (!pick || sum > pick.sum)) pick = {sum: sum, w: w, o: o, f: f};
				});
			});
		});
		if (!pick) return null;
		wear.weapon = pick.w; wear.offhand = pick.o; wear.familiar = pick.f[0]; wear.famequip = pick.f[1];
		total += pick.sum;
		return {wear: wear, total: total, outfit: null};
	}

	// The best loadout: of everything there is, or (own) of what you own.
	function best(cat, own) {
		var pool = cat.gear.filter(function (g) { return !own || g.owned > 0; }).sort(rank);
		var famOk = function (f) { return !own || cat.familiars.indexOf(f) >= 0; };
		var result = fill(cat, pool, own, famOk, {});
		cat.outfits.forEach(function (o) {
			if (own && o.pieces.some(function (p) { return p.owned <= 0; })) return;
			var forced = {};
			o.pieces.forEach(function (p) { (forced[p.slot] = forced[p.slot] || []).push(p.name); });
			var r = fill(cat, pool, own, famOk, forced);
			if (!r) return;
			r.outfit = o;
			r.total += o.adv;
			if (r.total > result.total) result = r;
		});
		return result;
	}

	function article(slot) {
		return {hat: 'a hat', back: 'a back item', shirt: 'a shirt', weapon: 'a weapon', pants: 'pants',
			acc: 'an accessory', familiar: 'familiar equipment'}[slot] || slot;
	}

	// What the boxes add up to, the way the game counts them: per slot {adv, item, why}.
	function tally(cat, sel) {
		var by = index(cat), rows = {}, seen = {}, watches = [], total = 0;
		var weapon = by[key(sel.weapon)], fam = key(sel.familiar);
		SLOTS.forEach(function (s) {
			var id = s[0], name = sel[id], g = by[key(name)], r = {adv: 0, item: g || null, why: ''};
			rows[id] = r;
			if (id === 'familiar' || !key(name)) return;
			if (!g) { r.why = 'adds nothing at rollover'; return; }
			if (id === 'famequip') {
				if (fam === key(HAND)) {
					if (g.slot !== 'weapon' || g.hands > 1) { r.why = 'the Disembodied Hand holds a one-handed weapon'; return; }
				} else if (fam === key(LEFT)) {
					if (g.slot !== 'offhand') { r.why = 'the Left-Hand Man holds an off-hand item'; return; }
				} else if (g.slot !== 'familiar') {
					r.why = 'not ' + article('familiar'); return;
				} else if (g['for'] && key(g['for']) !== fam) {
					r.why = 'only on a ' + g['for']; return;
				}
			} else if (id === 'offhand') {
				if (g.slot === 'weapon' ? !(cat.dualWield && g.hands === 1) : g.slot !== 'offhand') {
					r.why = g.slot === 'weapon' ? 'a second weapon needs Double-Fisted Skull Smashing' : 'not an off-hand item';
					return;
				}
				if (weapon && weapon.hands > 1) { r.why = 'the weapon takes both hands'; return; }
			} else if (g.slot !== s[2]) {
				r.why = 'not ' + article(s[2]); return;
			}
			if (g.note === 'with no weapon' && key(sel.weapon)) { r.why = 'only with no weapon'; return; }
			if (g.single && seen[key(g.name)]) { r.why = 'single-equip: only one counts'; return; }
			seen[key(g.name)] = 1;
			r.adv = g.adv;
			if (g.watch) watches.push(r);
		});
		watches.sort(function (a, b) { return b.adv - a.adv; }).slice(1).forEach(function (r) {
			r.adv = 0;
			r.why = 'only one watch counts';
		});
		SLOTS.forEach(function (s) { total += rows[s[0]].adv; });
		var worn = {};
		WORN.forEach(function (s) { worn[key(sel[s])] = 1; });
		var outfits = cat.outfits.filter(function (o) {
			return o.pieces.every(function (p) { return worn[key(p.name)]; });
		});
		outfits.forEach(function (o) { total += o.adv; });
		return {rows: rows, outfits: outfits, total: total};
	}

	// Where you start: the best you own, and what KoLmafia sees in the campground and the clan;
	// then whatever was chosen last time.
	function initial(cat) {
		var s = {gear: best(cat, true).wear, maid: '', camp: {}, rumpus: {}, unplayed: 0,
			gibberer: !!cat.today.gibberer, circadian: !!cat.today.circadian, potato: !!cat.today.potatoClock};
		cat.campground.forEach(function (c) {
			if (c.kind === 'maid') { if (c.have) s.maid = c.name; } else s.camp[c.name] = c.have;
		});
		cat.rumpus.forEach(function (r) { s.rumpus[r.name] = r.have; });
		var saved = null;
		try { saved = cat.saved ? JSON.parse(cat.saved) : null; } catch (e) { saved = null; }
		if (saved && saved.v === 1) {
			['maid', 'gibberer', 'circadian', 'potato', 'unplayed'].forEach(function (k) { if (k in saved) s[k] = saved[k]; });
			['gear', 'camp', 'rumpus'].forEach(function (k) {
				Object.keys(saved[k] || {}).forEach(function (n) { s[k][n] = saved[k][n]; });
			});
		}
		return s;
	}

	// Everything that adds up: the night's rollover, and the day's clicks outside it.
	function summary(cat, s) {
		var t = tally(cat, s.gear);
		var maid = cat.campground.filter(function (c) { return c.kind === 'maid' && c.name === s.maid; })[0];
		var camp = (maid ? maid.adv : 0) + cat.campground.reduce(function (n, c) {
			return n + (c.kind !== 'maid' && s.camp[c.name] ? c.adv : 0);
		}, 0);
		var skills = cat.skills.reduce(function (n, k) { return n + k.adv; }, 0);
		var gibberer = s.gibberer && cat.today.gibberer ? GIBBERER : 0;
		var circadian = s.circadian && cat.today.circadian ? CIRCADIAN : 0;
		// the two calendars hang on the same nail: one counts
		var clicks = 0, calendar = 0;
		cat.rumpus.forEach(function (r) {
			if (!s.rumpus[r.name]) return;
			if (/Calendar$/.test(r.name) && /Loathing/.test(r.name)) calendar = Math.max(calendar, r.adv);
			else clicks += r.adv;
		});
		clicks += calendar;
		var total = Math.min(200, BASE + t.total + camp + skills + gibberer + circadian);
		return {tally: t, gear: t.total, camp: camp, skills: skills, gibberer: gibberer, circadian: circadian,
			total: total, clicks: clicks, potato: s.potato && cat.today.potatoClock ? POTATO : 0,
			unplayed: Math.max(0, Math.min(200, Math.round(s.unplayed) || 0))};
	}

	exports.SLOTS = SLOTS;
	exports.best = best;
	exports.tally = tally;
	exports.initial = initial;
	exports.summary = summary;
	exports.BASE = BASE;

	if (typeof document === 'undefined') return;

	// --- The page ------------------------------------------------------------------

	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	function plus(n) { return n ? '+' + n : ''; }
	function had(g) {
		return g.owned > 0 ? '★ you have ' + (g.owned > 1 ? g.owned : 'one') : g.tradeable ? 'in the mall' : 'not tradeable';
	}

	// The picture (an item's opens KoL's description: cowl_diet.js handles the click), and the name in
	// bold, a link to the wiki.
	function itemCells(g, sub) {
		if (!g) return '<td class="cd-icon"></td><td class="cd-item cd-said">nothing that adds</td>';
		return '<td class="cd-icon">' + (g.image ? '<img src="/images/itemimages/' + esc(g.image) + '" alt="' +
			esc(g.name) + '"' + (g.descid ? ' data-desc="' + esc(g.descid) + '" title="KoL’s description"' : '') + '>' : '') +
			'</td><td class="cd-item"><a class="cd-wiki" href="https://wiki.kingdomofloathing.com/index.php?go=Go&amp;search=' +
			encodeURIComponent(g.name) + '" target="kolwiki" rel="noreferrer"><b>' + esc(g.name) + '</b></a>' +
			'<div class="cd-sub">' + esc(sub) + '</div></td>';
	}

	// The gear to pick from as you type in a slot's box, best first.
	function options(cat, slot, familiar) {
		var list;
		if (slot === 'familiar') {
			return cat.familiars.slice().sort().map(function (f) { return '<option value="' + esc(f) + '">'; }).join('');
		}
		if (slot === 'famequip' && key(familiar) === key(HAND)) {
			list = cat.gear.filter(function (g) { return g.slot === 'weapon' && g.hands === 1; });
		} else if (slot === 'famequip' && key(familiar) === key(LEFT)) {
			list = cat.gear.filter(function (g) { return g.slot === 'offhand'; });
		} else if (slot === 'famequip') {
			list = cat.gear.filter(function (g) { return g.slot === 'familiar' && (!g['for'] || key(g['for']) === key(familiar)); });
		} else {
			var kind = SLOTS.filter(function (s) { return s[0] === slot; })[0][2];
			list = cat.gear.filter(function (g) {
				return g.slot === kind || (slot === 'offhand' && cat.dualWield && g.slot === 'weapon' && g.hands === 1);
			});
		}
		return list.sort(rank).map(function (g) {
			return '<option value="' + esc(g.name) + '" label="+' + g.adv + (g.owned > 0 ? ' · you have ' + g.owned : '') +
				(g.note ? ' · ' + esc(g.note) : '') + '">';
		}).join('');
	}

	function meat(n) { return Math.round(n).toLocaleString(); }

	// Draws the section into el and keeps it counted; onChange(summary) after each change settles.
	// Returns the first summary, night(n) for the diet plan to say which nightcap it chose, and
	// lock(on) to freeze every box while a plan is saved.
	function mount(el, cat, onChange) {
		var state = initial(cat), top = best(cat, false), mine = best(cat, true), timer = null, night = null, locked = false;

		function bestRow(id) {
			var name = top.wear[id], g = index(cat)[key(name)];
			if (id === 'familiar') {
				return '<td class="cd-icon"></td><td class="cd-item">' + (name ? '<b>' + esc(name) + '</b>' : '<span class="cd-said">any</span>') +
					'</td><td></td>';
			}
			var sub = g ? had(g) + (g.note ? ' · ' + g.note : '') +
				(id === 'famequip' && top.wear.familiar ? ' · on the ' + top.wear.familiar : '') : '';
			return itemCells(g, sub) + '<td class="cd-num">' + (g ? plus(g.adv) : '') + '</td>';
		}

		function draw() {
			// tonight's bank: what's carried into tomorrow, cut to 200 at rollover
			var h = ['<h2>Tonight’s bank</h2><p class="cd-said">What you carry into tomorrow is cut to 200 at rollover.' +
				' The diet plan sizes its nightcap to the room left after rollover and what you leave unplayed, so it' +
				' doesn’t pay for adventures the cap would take.</p>'];
			h.push('<table class="cd-order cd-roll cd-bank"><tbody>' +
				'<tr><td class="cd-act">Rollover</td><td>gear, campground and the rest, below</td><td class="cd-num" data-bank="r"></td></tr>' +
				'<tr><td class="cd-act">Unplayed</td><td class="cd-wear"><label><input type="number" min="0" max="200" step="1"' +
				' data-unplayed value="' + (state.unplayed || 0) + '"> adventures you usually go to bed with, before the' +
				' nightcap</label></td><td class="cd-num" data-bank="u"></td></tr>' +
				'<tr><td class="cd-act">Nightcap</td><td data-bank="cap"></td><td class="cd-num" data-bank="n"></td></tr>' +
				'<tr data-bank="stooper-row"><td class="cd-act">Stooper</td><td data-bank="stooper"></td><td class="cd-num cd-said" data-bank="s"></td></tr>' +
				'</tbody><tfoot><tr><td>Total</td><td data-bank="said"></td><td class="cd-num" data-bank="t"></td></tr></tfoot></table>');
			h.push('<h2>At rollover</h2><div class="cd-head" id="cd-roll-head"></div>');
			h.push('<p class="cd-said">The best there is for each slot is beside your box, ★ where you own it. The boxes' +
				' start from the best you own: type what you’ll actually wear at rollover. <button type="button"' +
				' class="cd-refresh" id="cd-roll-mine">Wear the best you own</button></p>');
			h.push('<table class="cd-order cd-roll"><thead><tr><th>Slot</th><th>What you’ll wear</th><th>Adv</th>' +
				'<th colspan="2">Best there is</th><th>Adv</th></tr></thead><tbody>');
			SLOTS.forEach(function (s) {
				h.push('<tr><td class="cd-act">' + s[1] + '</td><td class="cd-wear"><input type="text" list="cd-dl-' + s[0] +
					'" data-slot="' + s[0] + '" value="' + esc(state.gear[s[0]] || '') + '" autocomplete="off" spellcheck="false">' +
					'<datalist id="cd-dl-' + s[0] + '">' + options(cat, s[0], state.gear.familiar) + '</datalist>' +
					'<div class="cd-sub" data-why="' + s[0] + '"></div></td><td class="cd-num" data-adv="' + s[0] + '"></td>' +
					bestRow(s[0]) + '</tr>');
			});
			h.push('</tbody><tfoot><tr><td>Gear</td><td data-outfit></td><td class="cd-num" data-gear></td><td colspan="2">' +
				(top.outfit ? 'with the ' + esc(top.outfit.name) + ' bonus, +' + top.outfit.adv : '') + '</td><td class="cd-num">' +
				top.total + '</td></tr></tfoot></table>');

			// the campground and Chateau: one maid, then the rest
			var maids = cat.campground.filter(function (c) { return c.kind === 'maid'; });
			var bestMaid = maids.slice().sort(function (a, b) { return b.adv - a.adv; })[0];
			h.push('<h3>Campground and Chateau</h3><table class="cd-order cd-roll cd-camp"><thead><tr><th>Have</th>' +
				'<th colspan="2">Item</th><th>Adv</th></tr></thead><tbody>');
			maids.forEach(function (c) {
				h.push('<tr><td><input type="radio" name="cd-maid" data-maid="' + esc(c.name) + '"' +
					(state.maid === c.name ? ' checked' : '') + '></td>' + campCells(c, c === bestMaid ? 'the best maid' : '') + '</tr>');
			});
			h.push('<tr><td><input type="radio" name="cd-maid" data-maid=""' + (state.maid ? '' : ' checked') +
				'></td><td class="cd-icon"></td><td class="cd-item cd-said">no maid</td><td></td></tr>');
			cat.campground.forEach(function (c) {
				if (c.kind === 'maid') return;
				h.push('<tr><td><input type="checkbox" data-camp="' + esc(c.name) + '"' + (state.camp[c.name] ? ' checked' : '') +
					'></td>' + campCells(c, '') + '</tr>');
			});
			h.push('</tbody></table>');

			h.push('<h3>Clan Rumpus Room</h3><p class="cd-said">Clicked once a day, not at rollover, so the 200 cap doesn’t' +
				' touch them; the two calendars hang on the same nail, so one counts. Ticked from what KoLmafia last saw.</p>' +
				'<table class="cd-order cd-roll cd-rumpus"><tbody>');
			cat.rumpus.forEach(function (r) {
				h.push('<tr><td><input type="checkbox" data-rumpus="' + esc(r.name) + '"' + (state.rumpus[r.name] ? ' checked' : '') +
					'></td><td class="cd-item"><b>' + esc(r.name) + '</b></td><td class="cd-num">+' + r.adv + '</td></tr>');
			});
			h.push('</tbody></table>');

			var also = [];
			cat.skills.forEach(function (k) { also.push('<li>' + esc(k.name) + ' (skill): +' + k.adv + '</li>'); });
			if (cat.today.gibberer) {
				also.push('<li><label><input type="checkbox" data-other="gibberer"' + (state.gibberer ? ' checked' : '') +
					'> Squamous Gibberer out for the day’s fights</label>: +1 at rollover per 15 fights, counted as +' +
					GIBBERER + ' (a 450-fight day)</li>');
			}
			if (cat.today.circadian) {
				also.push('<li><label><input type="checkbox" data-other="circadian"' + (state.circadian ? ' checked' : '') +
					'> Recall Facts: Circadian Rhythms</label>: +1 at rollover per fight with the phylum you chose, up to +' +
					CIRCADIAN + '</li>');
			}
			if (cat.today.potatoClock) {
				also.push('<li><label><input type="checkbox" data-other="potato"' + (state.potato ? ' checked' : '') +
					'> potato alarm clock</label>: +' + POTATO + ' at the first login of the day, past the cap</li>');
			}
			if (also.length) h.push('<h3>Also</h3><ul class="cd-organs">' + also.join('') + '</ul>');
			el.innerHTML = '<p class="cd-said cd-roll-locked" hidden>These are locked with the saved plan: unlock it on the' +
				' Diet tab to change them.</p>' + h.join('');
			lock(locked);
			count(true);
		}

		function lock(on) {
			locked = !!on;
			el.querySelector('.cd-roll-locked').hidden = !locked;
			Array.prototype.forEach.call(el.querySelectorAll('input, button'), function (x) { x.disabled = locked; });
		}

		function campCells(c, best) {
			var g = {name: c.name, owned: 0, tradeable: c.tradeable, image: c.image, descid: c.descid};
			var sub = [c.have ? 'KoLmafia sees it' : had(g), c.note, best].filter(Boolean).join(' · ');
			return itemCells(g, sub) + '<td class="cd-num">+' + c.adv + '</td>';
		}

		// The numbers, in place, so typing in a box never loses its focus.
		function count(quiet) {
			var sum = summary(cat, state), t = sum.tally;
			SLOTS.forEach(function (s) {
				var r = t.rows[s[0]];
				var g = r.item;
				el.querySelector('[data-adv="' + s[0] + '"]').textContent = plus(r.adv);
				el.querySelector('[data-why="' + s[0] + '"]').textContent = r.why || (g && g.note) || '';
			});
			el.querySelector('[data-outfit]').textContent = t.outfits.map(function (o) {
				return 'with the ' + o.name + ' bonus, +' + o.adv;
			}).join(', ');
			el.querySelector('[data-gear]').textContent = sum.gear;
			var from = [BASE + ' base', sum.gear + ' gear', sum.camp + ' campground'];
			if (sum.skills) from.push(sum.skills + ' skills');
			if (sum.gibberer) from.push(sum.gibberer + ' Squamous Gibberer');
			if (sum.circadian) from.push(sum.circadian + ' Circadian Rhythms');
			el.querySelector('#cd-roll-head').innerHTML = '<span class="cd-adv">' + sum.total + '</span> adventures at rollover ' +
				'<span class="cd-said">(' + esc(from.join(' + ')) + '. The best gear you own adds ' + mine.total +
				', the best there is ' + top.total + '; KoLmafia counts ' + cat.today.total + ' for tonight as you are now)</span>';
			bank(sum);
			if (quiet) return sum;
			clearTimeout(timer);
			timer = setTimeout(function () { keep(); onChange(sum); }, 700);
			return sum;
		}

		// The bank's numbers: rollover and unplayed from here, the nightcap and the Stooper's drink
		// from the diet plan, once it has said.
		function bank(sum) {
			function set(k, v) { el.querySelector('[data-bank="' + k + '"]').innerHTML = v; }
			var room = Math.max(0, 200 - sum.total - sum.unplayed), cap = night && night.nightcap, n = cap ? cap.adv : 0;
			set('r', sum.total);
			set('u', sum.unplayed);
			if (!night) {
				set('cap', '<span class="cd-said">waiting for the diet plan</span>');
			} else if (night.room !== undefined && night.room !== room) {
				set('cap', '<span class="cd-said">the diet plan is choosing a nightcap for the ' + room + ' left...</span>');
				cap = null;
				n = 0;
			} else if (!night.on) {
				set('cap', '<span class="cd-said">none: the nightcap is switched off on the Diet tab</span>');
			} else if (!cap) {
				set('cap', '<span class="cd-said">' + (room ? 'none: no drink is worth its price at ' + meat(night.budget) +
					' meat a day' : 'none: rollover and what you leave unplayed already reach 200') + '</span>');
			} else {
				set('cap', '<b>' + esc(cap.name) + '</b><div class="cd-sub">the diet plan’s for ' + meat(night.budget) +
					' meat a day: ' + n + ' of the ' + room + ' left under the cap, for ' + meat(cap.cost) + ' meat' +
					(cap.over ? '; it rolls ' + (n + cap.over) + ', and the plan doesn’t pay for the ' + cap.over + ' the cap takes'
						: '') + '</div>');
			}
			set('n', cap ? n : '');
			var st = night && night.stooper;
			el.querySelector('[data-bank="stooper-row"]').hidden = !st;
			if (st) {
				set('stooper', '<b>' + esc(st.name) + '</b><div class="cd-sub">the drink the Stooper makes room for: drunk' +
					' before your last turns with it out, so you play its ' + st.adv + ' and they don’t count here. Drunk' +
					' after them instead, the bank would be ' + (sum.total + sum.unplayed + n + st.adv) + '</div>');
				set('s', '(' + st.adv + ')');
			}
			var total = sum.total + sum.unplayed + n;
			set('t', total);
			set('said', total > 200 ? (total - 200) + ' over the cap: lost at rollover'
				: total === 200 ? 'exactly the cap' : (200 - total) + ' short of the cap');
		}

		function keep() {
			var q = 'rollover=' + encodeURIComponent(JSON.stringify({v: 1, gear: state.gear, maid: state.maid, camp: state.camp,
				rumpus: state.rumpus, gibberer: state.gibberer, circadian: state.circadian, potato: state.potato,
				unplayed: state.unplayed}));
			fetch('cowl_diet_save.ash?pwd=' + encodeURIComponent(window.cowlDietPwd) + '&' + q, {credentials: 'same-origin'})
				.catch(function () { /* kept next time */ });
		}

		el.addEventListener('input', function (e) {
			if (e.target.hasAttribute('data-unplayed')) {
				state.unplayed = Math.max(0, Math.min(200, parseInt(e.target.value, 10) || 0));
				count();
				return;
			}
			var slot = e.target.getAttribute('data-slot');
			if (!slot) return;
			state.gear[slot] = e.target.value.trim();
			if (slot === 'familiar') document.getElementById('cd-dl-famequip').innerHTML = options(cat, 'famequip', state.gear.familiar);
			count();
		});
		el.addEventListener('change', function (e) {
			var t = e.target, m = t.getAttribute('data-maid'), c = t.getAttribute('data-camp');
			var r = t.getAttribute('data-rumpus'), o = t.getAttribute('data-other');
			if (m !== null) state.maid = m;
			else if (c !== null) state.camp[c] = t.checked;
			else if (r !== null) state.rumpus[r] = t.checked;
			else if (o !== null) state[o] = t.checked;
			else return;
			count();
		});
		el.addEventListener('click', function (e) {
			if (e.target.id !== 'cd-roll-mine') return;
			state.gear = best(cat, true).wear;
			draw();
			count();
		});

		draw();
		return {
			summary: summary(cat, state),
			night: function (n) { night = n; bank(summary(cat, state)); },
			lock: lock
		};
	}

	exports.mount = mount;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.cowlDietRollover = {}));
