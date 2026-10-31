// cowl_diet_plan.js -- the Diet Planner's arithmetic: most adventures for a daily meat budget.
//
// No page in here, so node can run it (tests/cowl_diet.test.js); cowl_diet.js draws the page.
// It was ported from a Python prototype, and the tests hold it to that prototype's answers.
//
// For a meat value of an adventure L, the best day maximises L x adventures - meat. With L
// fixed that splits into a knapsack per organ, with the once-a-day upgrades (the salad fork on
// food; the Cooler Yeti and the frosty mug on drinks) carried as flags, plus the cleaners and
// expanders merged by the room they free. Sweeping L traces the corners of adventures against
// meat; a budget gets the best day that fits, upgraded swap by swap while the meat lasts.

(function () {
	var FORK = 1, YETI = 1, MUG = 2;
	var ONCE = ['[yeti]', "Frosty's frosty mug", "Ol' Scratch's salad fork"];
	var SECTIONS = [['stomach', 'Eat'], ['stomach+', 'With the food'], ['liver', 'Drink'],
		['shotglass', 'Mime army shotglass'], ['nightcap', 'Nightcap'], ['spleen', 'Chew'],
		['special', 'Cleaners, expanders and dieting pills'], ['effect', 'Effects'], ['extra', 'No organ']];

	function mean(lo, hi, f) {
		var t = 0;
		for (var r = lo; r <= hi; r++) t += f(r);
		return t / (hi - lo + 1);
	}

	function munchies(lo, hi) {
		if (hi <= 3) return 3;
		if (lo >= 7) return 1;
		return mean(lo, hi, function (i) { return Math.max(Math.floor((12 - i) / 3), 1); });
	}

	// The pinky ring rounds like mafia's Math.rint: halves go to the even neighbour.
	function rint(x) {
		var f = Math.floor(x), d = x - f;
		if (d > 0.5) return f + 1;
		if (d < 0.5) return f;
		return f % 2 === 0 ? f : f + 1;
	}

	// One thing consumed: what plans are made of and compared by. parts is how its adventures add up,
	// [[what, adventures], ...]; room is the organ space it takes, [stomach, liver, spleen], negative
	// where it frees some. Neither is part of what makes two units the same.
	function unit(label, organ, size, adv, meat, parts, room) {
		return [label, organ, size, +adv.toFixed(4), +meat.toFixed(2), parts || [], room || [0, 0, 0]];
	}
	function ukey(u) { return u.slice(0, 5).join('\u0001'); }
	function rangeText(lo, hi) { return 'base (' + (lo === hi ? lo : lo + '\u2013' + hi) + ')'; }

	// A plan's units while it is being built: a linked list of arrays, so adding to it doesn't copy
	// it. Only the days that are kept get flattened.
	function cat(list, arr) { return arr && arr.length ? {a: arr, n: list} : list; }
	function flat() {
		var out = [];
		for (var i = 0; i < arguments.length; i++) {
			for (var l = arguments[i]; l; l = l.n) for (var j = 0; j < l.a.length; j++) out.push(l.a[j]);
		}
		return out;
	}

	// A multiset of units, like a Python Counter.
	function Bag(units) {
		this.n = new Map();
		this.u = new Map();
		if (units) for (var i = 0; i < units.length; i++) this.add(units[i], 1);
	}
	Bag.prototype.add = function (u, k) {
		var key = ukey(u);
		this.u.set(key, u);
		this.n.set(key, (this.n.get(key) || 0) + k);
		if (this.n.get(key) <= 0) { this.n.delete(key); this.u.delete(key); }
	};
	Bag.prototype.minus = function (other) {
		var out = new Bag();
		var self = this;
		this.n.forEach(function (k, key) {
			var left = k - (other.n.get(key) || 0);
			if (left > 0) out.add(self.u.get(key), left);
		});
		return out;
	};
	Bag.prototype.entries = function () {
		var self = this, out = [];
		this.n.forEach(function (k, key) { out.push([self.u.get(key), k]); });
		return out;
	};
	Bag.prototype.elements = function () {
		var out = [];
		this.entries().forEach(function (e) { for (var i = 0; i < e[1]; i++) out.push(e[0]); });
		return out;
	};

	// "15-17" -> [15, 17]; "5" -> [5, 5]
	function range(adv) {
		var m = /^(-?\d+)(?:-(-?\d+))?$/.exec(String(adv || '').trim());
		if (!m) return [0, 0];
		return [+m[1], m[2] === undefined ? +m[1] : +m[2]];
	}

	// The endpoint sends KoLmafia's adventure strings and notes; the planner wants ranges and the
	// capitalised attributes bonuses key on (WINE, BEER, MARTINI, SALAD...). Done once per load.
	function normalize(data) {
		if (data.normalized) return data;
		data.menu = data.menu.map(function (it) {
			if (it.lo !== undefined) return it;
			var r = range(it.adv);
			var tags = (String(it.notes || '').match(/\b[A-Z]{3,}\b/g) || []).filter(function (t) { return t !== 'HP' && t !== 'MP'; });
			return {name: it.name, organ: it.organ, size: it.size, lo: r[0], hi: r[1], tags: tags,
				price: it.price, group: it.group, cap: it.cap, age: it.age};
		}).filter(function (it) { return it.hi > 0 && it.size > 0; });
		// each organ's planning base: today's limit without the Feast, the Stooper and expanders used today
		var cap = data.account.capacity;
		if (cap) ['stomach', 'liver', 'spleen'].forEach(function (o) { data.account[o] = cap[o].base; });
		data.specials.concat(data.noodles).forEach(function (x) {
			if (x.lo === undefined) { var r = range(x.adv); x.lo = r[0]; x.hi = r[1]; }
		});
		data.normalized = true;
		return data;
	}

	// The planning setup for one kind of day, from the data endpoint and the page's switches.
	function buildConfig(data, choices) {
		data = normalize(data);
		var a = data.account;
		choices = choices || {};
		var on = function (k, dflt) { return choices[k] === undefined ? dflt : choices[k]; };
		var rollover = choices.rollover !== undefined ? choices.rollover : a.rollover;
		var gibberer = on('gibberer', a.gibberer) ? 30 : 0;
		var unplayed = choices.unplayed || 0;  // adventures left unspent at bedtime: banked like the nightcap's
		return {
			room: [a.stomach + (on('toilet', a.toilet) ? 1 : 0) + (on('feast', false) ? 15 : 0),
				a.liver + (on('stooper', a.stooper) ? 1 : 0), a.spleen],
			toilet: on('toilet', a.toilet), stooper: on('stooper', a.stooper), feast: on('feast', false),
			ode: on('ode', a.ode), tuxedo: on('tuxedo', a.tuxedo), ring: on('ring', a.ring),
			yeti: on('yeti', a.yeti), shotglass: on('shotglass', a.shotglass),
			nightcap: on('nightcap', true), grimaceMap: on('grimaceMap', a.grimaceMap),
			nightcapRoom: Math.max(0, 200 - rollover - gibberer - unplayed),
			menu: data.menu.filter(function (it) { return !(choices.skip && choices.skip[it.name]); }),
			helpers: data.helpers, specials: data.specials, noodles: data.noodles, extras: data.extras,
			pill: data.pill, transponder: data.transponder,
			cup: on('cup', a.cup) ? data.cup : null
		};
	}

	function Context(cfg, lam, palate) {
		this.cfg = cfg;
		this.lam = lam;
		this.palate = palate;
		this.p = cfg.helpers;
	}
	Context.prototype.worth = function (helper, gain) {
		var p = this.p[helper];
		return p !== null && p !== undefined && this.lam * gain > p;
	};
	// A food's units change with L only where a helper starts paying, so they're kept per item by
	// which helpers are on.
	Context.prototype.foodUnits = function (it) {
		var lo = it.lo, hi = it.hi, size = it.size;
		var self = this;
		var helpers = [['whet stone', 1], ['mini kiwi aioli', size], ['Special Seasoning', hi - lo <= 1 ? 1 : 0.5],
			['munchies pill', munchies(lo, hi)]];
		var mask = 0;
		helpers.forEach(function (h, i) { if (self.worth(h[0], h[1])) mask |= 1 << i; });
		var store = this.cfg.foodCache || (this.cfg.foodCache = new Map());
		var key = it.name + '\u0001' + mask;
		if (!store.has(key)) store.set(key, this.foodUnitsWith(it, helpers, mask));
		return store.get(key);
	};
	Context.prototype.foodUnitsWith = function (it, helpers, mask) {
		var lo = it.lo, hi = it.hi, size = it.size;
		var flat = 0, extra = 0, labels = [it.name], hparts = [];
		var self = this;
		helpers.forEach(function (h, i) {
			if (mask & (1 << i)) {
				flat += h[1];
				extra += self.p[h[0]];
				labels.push(h[0]);
				hparts.push([h[0], h[1]]);
			}
		});
		var base = mean(lo, hi, function (r) { return r; });
		var a = base + flat, m = it.price + extra;
		var out = [[0, a, m, [unit(labels.join(' + '), 'stomach', size, a, m, [[rangeText(lo, hi), base]].concat(hparts), [size, 0, 0])]]];
		var fork = this.p["Ol' Scratch's salad fork"];
		if (fork !== null && fork !== undefined) {
			var k = it.tags.indexOf('SALAD') >= 0 ? 15 : 13;
			var forked = mean(lo, hi, function (r) { return Math.floor((k * r + 9) / 10); });
			a = forked + flat;
			m = it.price + extra + fork;
			out.push([FORK, a, m, [unit(labels.concat(["Ol' Scratch's salad fork"]).join(' + '), 'stomach', size, a, m,
				[[rangeText(lo, hi), base], ["Ol' Scratch's salad fork", forked - base]].concat(hparts), [size, 0, 0])]]);
		}
		return out;
	};
	Context.prototype.boozeRoll = function (r, wine) {
		var a = r;
		if (wine && this.palate) a = Math.floor(5 * a / 4);   // Refined Palate: +25%, floored
		if (wine && this.cfg.ring) a = a + rint(a / 8);       // pinky ring: +12.5%
		return a;
	};
	Context.prototype.boozeUnits = function (it, ode, organ) {
		if (ode === undefined) ode = true;
		organ = organ || 'liver';
		var self = this, lo = it.lo, hi = it.hi, size = it.size;
		var wine = it.tags.indexOf('WINE') >= 0;
		var martini = this.cfg.tuxedo && it.tags.indexOf('MARTINI') >= 0;
		var flat = (ode && this.cfg.ode ? size : 0) + (martini ? 2 : 0);
		var base = mean(lo, hi, function (r) { return r; });
		var pal = wine && this.palate ? mean(lo, hi, function (r) { return Math.floor(5 * r / 4); }) : base;
		var full = mean(lo, hi, function (r) { return self.boozeRoll(r, wine); });
		var core = [[rangeText(lo, hi), base]];
		if (pal !== base) core.push(['Refined Palate', pal - base]);
		if (full !== pal) core.push(['mafia pinky ring', full - pal]);
		var tail = [];
		if (ode && this.cfg.ode) tail.push(['Ode to Booze', size]);
		if (martini) tail.push(['tuxedo shirt', 2]);
		if (organ === 'shotglass') tail.push(['mime army shotglass: no liver, no Ode', 0]);
		var room = organ === 'shotglass' ? [0, 0, 0] : [0, size, 0];
		var a = full + flat;
		var out = [[0, a, it.price, [unit(it.name, organ, size, a, it.price, core.concat(tail), room)]]];
		if (this.cfg.yeti) {
			a = 2 * full + flat;
			out.push([YETI, a, it.price, [unit(it.name + ' [yeti]', organ, size, a, it.price,
				core.concat([['from the Cooler Yeti', full]], tail), room)]]);
		}
		var mug = this.p["Frosty's frosty mug"];
		if (mug !== null && mug !== undefined) {
			var k = it.tags.indexOf('BEER') >= 0 ? 15 : 13;
			var mugged = mean(lo, hi, function (r) { return Math.floor(k * self.boozeRoll(r, wine) / 10); });
			a = mugged + flat;
			out.push([MUG, a, it.price + mug, [unit(it.name + " + Frosty's frosty mug", organ, size, a, it.price + mug,
				core.concat([["Frosty's frosty mug", mugged - full]], tail), room)]]);
		}
		return out;
	};
	Context.prototype.spleenUnits = function (it) {
		var a = mean(it.lo, it.hi, function (r) { return r; });
		return [[0, a, it.price, [unit(it.name, 'spleen', it.size, a, it.price, [[rangeText(it.lo, it.hi), a]], [0, 0, it.size])]]];
	};

	// V[c][f]: the best [value, adventures, meat, units] using at most c organ space with flags f.
	function bestFill(cap, unbounded, groups, nflags, lam) {
		var nf = 1 << nflags, c, f, i, cur, o, c2, v, old;
		var dp = [];
		for (c = 0; c <= cap; c++) { dp.push([]); for (f = 0; f < nf; f++) dp[c].push(null); }
		dp[0][0] = [0, 0, 0, null];
		groups.forEach(function (options) {
			var next = dp.map(function (row) { return row.slice(); });
			for (c = 0; c <= cap; c++) {
				for (f = 0; f < nf; f++) {
					cur = dp[c][f];
					if (!cur) continue;
					for (i = 0; i < options.length; i++) {
						o = options[i];
						c2 = c + o[0];
						if (o[1] & f || c2 > cap) continue;
						v = cur[0] + lam * o[2] - o[3];
						old = next[c2][f | o[1]];
						if (!old || v > old[0]) next[c2][f | o[1]] = [v, cur[1] + o[2], cur[2] + o[3], cat(cur[3], o[4])];
					}
				}
			}
			dp = next;
		});
		for (c = 0; c <= cap; c++) {
			for (f = 0; f < nf; f++) {
				cur = dp[c][f];
				if (!cur) continue;
				for (i = 0; i < unbounded.length; i++) {
					o = unbounded[i];
					c2 = c + o[0];
					if (o[1] & f || c2 > cap) continue;
					v = cur[0] + lam * o[2] - o[3];
					old = dp[c2][f | o[1]];
					if (!old || v > old[0]) dp[c2][f | o[1]] = [v, cur[1] + o[2], cur[2] + o[3], cat(cur[3], o[4])];
				}
			}
		}
		for (c = 1; c <= cap; c++) {  // at most c, not exactly c
			for (f = 0; f < nf; f++) {
				if (dp[c - 1][f] && (!dp[c][f] || dp[c - 1][f][0] > dp[c][f][0])) dp[c][f] = dp[c - 1][f];
			}
		}
		return dp;
	}

	function combinations(pool, k, fn) {
		var pick = [];
		(function go(start, left) {
			if (left === 0) { fn(pick.slice()); return; }
			for (var i = start; i < pool.length; i++) { pick.push(pool[i]); go(i, left - 1); pick.pop(); }
		})(0, k);
	}

	// A limited group's options: up to cap uses among its items, at most one flagged unit; only the
	// best option for each (size, flag) can matter, so only those are kept.
	function groupOptions(items, unitsOf, cap, lam, store) {
		var key = items.map(function (it) { return it.name; }).join('\u0001') + '\u0002' +
			items.map(function (it) { return unitsOf(it).map(function (u) { return u[1] + ',' + u[2]; }).join(';'); }).join('|');
		var all = store && store.get(key);
		if (!all) {
			all = groupCombos(items, unitsOf, cap);
			if (store) store.set(key, all);
		}
		var best = new Map();
		for (var i = 0; i < all.length; i++) {
			var o = all[i], v = lam * o[2] - o[3], bk = o[0] * 4 + o[1];
			var have = best.get(bk);
			if (!have || v > have[0]) best.set(bk, [v, o]);
		}
		return Array.from(best.values()).map(function (b) { return b[1]; });
	}

	// Every way of taking up to cap of a group's items, with at most one flagged unit.
	function groupCombos(items, unitsOf, cap) {
		var units = [];
		items.forEach(function (it) {
			unitsOf(it).forEach(function (u) { units.push([it.size].concat(u)); });
		});
		var plain = units.filter(function (u) { return u[1] === 0; });
		var flagged = units.filter(function (u) { return u[1] !== 0; });
		var out = [];
		function offer(combo) {
			var s = 0, fl = 0, a = 0, m = 0, us = [];
			combo.forEach(function (u) { s += u[0]; fl = Math.max(fl, u[1]); a += u[2]; m += u[3]; us = us.concat(u[4]); });
			out.push([s, fl, a, m, us]);
		}
		for (var k = 1; k <= cap; k++) {
			combinations(plain, k, offer);
			flagged.forEach(function (fu) { combinations(plain, k - 1, function (c) { offer(c.concat([fu])); }); });
		}
		return out;
	}

	function organMenus(cfg, ctx, organ) {
		var unitsOf = organ === 'stomach' ? ctx.foodUnits.bind(ctx)
			: organ === 'liver' ? cached(cfg, 'liver' + ctx.palate, ctx.boozeUnits.bind(ctx))
			: cached(cfg, 'spleen', ctx.spleenUnits.bind(ctx));
		var best = new Map(), groups = new Map();
		cfg.menu.forEach(function (it) {
			if (it.organ !== organ) return;
			if (it.group) {
				if (!groups.has(it.group)) groups.set(it.group, [[], it.cap]);
				groups.get(it.group)[0].push(it);
				return;
			}
			unitsOf(it).forEach(function (u) {
				var key = it.size + ':' + u[0], v = ctx.lam * u[1] - u[2];
				if (!best.has(key) || v > best.get(key)[0]) best.set(key, [v, [it.size, u[0], u[1], u[2], u[3]]]);
			});
		});
		return [Array.from(best.values()).map(function (b) { return b[1]; }),
			Array.from(groups.values()).map(function (g) {
				return groupOptions(g[0], unitsOf, g[1], ctx.lam, cfg.groupCache || (cfg.groupCache = new Map()));
			})];
	}

	// Drink and spleen units don't depend on L (only on Refined Palate), so the sweep's hundred-odd
	// days share one copy per item.
	function cached(cfg, key, fn) {
		cfg.units = cfg.units || {};
		var store = cfg.units[key] || (cfg.units[key] = new Map());
		return function (it) {
			if (!store.has(it)) store.set(it, fn(it));
			return store.get(it);
		};
	}

	// [food flags, booze flags, adventures, meat, label, room, parts] for one cleaner or expander:
	// plain first, then with the fork, yeti or mug. room is null where it's the special's own d.
	// Cleaner foods take aioli and whet stones like any food.
	function specialVariants(ctx, cfg, sp) {
		if (sp.kind === 'map') {
			return cfg.transponder ? [[0, 0, -1, cfg.transponder / 2, sp.name, null,
				[['an adventure on the map, under half a transponder', -1]]]] : [];
		}
		if (sp.price === null || sp.price === undefined) return [];
		var lo = sp.lo, hi = sp.hi, d = sp.d, price = sp.price;
		var base = hi ? mean(lo, hi, function (r) { return r; }) : 0;
		if (sp.kind === 'food') {
			var size = -d[0], flat = 0, extra = 0, labels = [sp.name], hparts = [];
			[['whet stone', 1], ['mini kiwi aioli', size], ['Special Seasoning', hi - lo <= 1 ? 1 : 0.5],
				['munchies pill', munchies(lo, hi)]].forEach(function (h) {
				if (ctx.worth(h[0], h[1])) { flat += h[1]; extra += ctx.p[h[0]]; labels.push(h[0]); hparts.push([h[0], h[1]]); }
			});
			var out = [[0, 0, base + flat, price + extra, labels.join(' + '), null, [[rangeText(lo, hi), base]].concat(hparts)]];
			var fork = ctx.p["Ol' Scratch's salad fork"];
			if (fork !== null && fork !== undefined) {
				var forked = mean(lo, hi, function (r) { return Math.floor((13 * r + 9) / 10); });
				out.push([FORK, 0, forked + flat, price + extra + fork, labels.concat(["Ol' Scratch's salad fork"]).join(' + '), null,
					[[rangeText(lo, hi), base], ["Ol' Scratch's salad fork", forked - base]].concat(hparts)]);
			}
			return out;
		}
		if (sp.kind === 'booze') {
			var bflat = cfg.ode ? -d[1] : 0;
			var odeP = cfg.ode ? [['Ode to Booze', -d[1]]] : [];
			var bout = [[0, 0, base + bflat, price, sp.name, null, [[rangeText(lo, hi), base]].concat(odeP)]];
			if (cfg.yeti) {
				bout.push([0, YETI, 2 * base + bflat, price, sp.name + ' [yeti]', null,
					[[rangeText(lo, hi), base], ['from the Cooler Yeti', base]].concat(odeP)]);
			}
			var mug = ctx.p["Frosty's frosty mug"];
			if (mug !== null && mug !== undefined) {
				var mugged = mean(lo, hi, function (r) { return Math.floor(13 * r / 10); });
				bout.push([0, MUG, mugged + bflat, price + mug, sp.name + " + Frosty's frosty mug", null,
					[[rangeText(lo, hi), base], ["Frosty's frosty mug", mugged - base]].concat(odeP)]);
			}
			return bout;
		}
		return [[0, 0, 0, price, sp.name, null, []]];
	}

	// A dieting pill on each of the foods it pays most on at this L. The food's fullness doubles,
	// so each variant carries its own room: twice the food's size, and the pill's 3 spleen.
	function pillVariants(ctx, cfg, keep) {
		if (cfg.pill === null || cfg.pill === undefined) return [];
		var out = [];
		cfg.menu.forEach(function (it) {
			if (it.organ !== 'stomach' || it.group) return;
			var base = mean(it.lo, it.hi, function (r) { return r; });
			var a = 2 * base, m = it.price + cfg.pill;
			var labels = ['dieting pill', it.name], parts = [[rangeText(it.lo, it.hi) + ' \u00d7 2, from the dieting pill', 2 * base]];
			[['whet stone', 1], ['mini kiwi aioli', it.size]].forEach(function (h) {
				if (ctx.worth(h[0], h[1])) { a += h[1]; m += ctx.p[h[0]]; labels.push(h[0]); parts.push([h[0], h[1]]); }
			});
			out.push([(ctx.lam * a - m) / (2 * it.size), [0, 0, a, m, labels.join(' + '), [-2 * it.size, 0, -3], parts]]);
		});
		out.sort(function (x, y) { return y[0] - x[0]; });
		return out.slice(0, keep || 4).map(function (x) { return x[1]; });
	}

	// Organ-free adventures worth their price at L. Chocolates share one counter of three.
	function extras(cfg, lam) {
		var adv = 0, meat = 0, units = [], slots = [null, null, null];
		cfg.extras.forEach(function (x) {
			if (x.price === null || x.price === undefined) return;
			if (x.counter === 'choc') {
				x.schedule.forEach(function (a, n) {
					var v = lam * a - x.price;
					if (v > 0 && (!slots[n] || v > slots[n][0])) slots[n] = [v, a, x.price, x.name];
				});
				return;
			}
			x.schedule.forEach(function (a) {
				if (lam * a > x.price) { adv += a; meat += x.price; units.push(unit(x.name, 'extra', 0, a, x.price, [['adventures', a]])); }
			});
		});
		slots.forEach(function (s) {
			if (s) { adv += s[1]; meat += s[2]; units.push(unit(s[3], 'extra', 0, s[1], s[2], [['adventures (each chocolate in a day gives fewer)', s[1]]])); }
		});
		return [adv, meat, units];
	}

	// The drinks that could be the nightcap (any size, counted only up to the 200 cap) and the
	// shotglass drink (1 drunk, no Ode): [flag, adventures, meat, units] each.
	function nightcapAndShot(cfg, ctx) {
		var caps = [], shots = [];
		cfg.menu.forEach(function (it) {
			if (it.organ !== 'liver' || it.group) return;
			if (cfg.nightcap) {
				ctx.boozeUnits(it, true, 'nightcap').forEach(function (u) {
					var a = Math.min(u[1], cfg.nightcapRoom);  // past the 200 cap it's lost
					caps.push([u[0], a, u[2], u[3].map(function (x) {
						return unit(x[0] + ' (nightcap)', x[1], x[2], a, x[4],
							a < u[1] ? x[5].concat([['over the 200 cap on banked adventures', a - u[1]]]) : x[5], x[6]);
					})]);
				});
			}
			if (cfg.shotglass && it.size === 1) {
				var u = ctx.boozeUnits(it, false, 'shotglass')[0];
				shots.push([0, u[1], u[2], u[3]]);
			}
		});
		return {caps: caps, shots: shots};
	}

	// The Cup of 13s mixes three ingredients into a drink worth the sum of their tiers (1-5), for 1
	// drunkenness, up to 13 adventures a day. Not booze, so no Ode, yeti or mug. The cheapest mixes
	// that reach 13, and 12, from the cheapest priced ingredient of each tier.
	var CUP = {name: 'Cup of 13s', d: [0, -1, 0], kind: 'cup', lo: 0, hi: 0, uses: 1};
	function cupVariants(cfg) {
		if (!cfg.cup || !cfg.cup.tiers) return [];
		// each tier's cheapest ingredient that still has a price (the price check can empty one)
		var t = {};
		Object.keys(cfg.cup.tiers).forEach(function (k) {
			var c = cfg.cup.tiers[k].filter(function (e) { return e.price > 0; })
				.sort(function (x, y) { return x.price - y.price; })[0];
			if (c) t[k] = c;
		});
		var best = {};
		[[5, 5, 5], [5, 5, 4], [5, 5, 3], [5, 4, 4], [5, 5, 2], [5, 4, 3], [4, 4, 4]].forEach(function (c) {
			if (!c.every(function (x) { return t[x] && t[x].price; })) return;
			var sum = c[0] + c[1] + c[2], adv = Math.min(cfg.cup.gems || 13, sum);
			var cost = t[c[0]].price + t[c[1]].price + t[c[2]].price;
			if (!best[adv] || cost < best[adv].cost) best[adv] = {c: c, sum: sum, adv: adv, cost: cost};
		});
		return Object.keys(best).map(function (k) {
			var b = best[k];
			return [0, 0, b.adv, b.cost, 'Cup of 13s (' + b.c.map(function (x) { return t[x].name; }).join(' + ') + ')', null,
				[['from tiers ' + b.c.join(' + ') + (b.sum > b.adv ? ', capped at ' + b.adv + ' a day' : ''), b.adv],
					['not booze: no Ode', 0]]];
		});
	}

	var PILL = {name: 'dieting pill', d: [0, 0, -3], kind: 'pill', lo: 0, hi: 0, uses: 5};
	var MAP = [{name: 'distention pill', d: [1, 0, 0], kind: 'map', lo: 0, hi: 0, uses: 1},
		{name: 'synthetic dog hair pill', d: [0, 1, 0], kind: 'map', lo: 0, hi: 0, uses: 1}];

	// The best day at L over the effect choices: [adventures, meat, units]. Every other choice of
	// cleaners and effects is offered to bucket (the best day per 250 meat): it loses at this L but
	// may be the best fit for some budget.
	function planDay(cfg, lam, bucket) {
		var room = cfg.room;
		var hiCap = room.map(function (r) { return r + 15; });
		var best = null;
		var ex = extras(cfg, lam);
		[null, 'toasted brie', 'pocket wish'].forEach(function (palate) {
			var ctx = new Context(cfg, lam, palate);
			var fixed = [0, 0, []], sUsed = 0;
			if (palate) {
				var pp = ctx.p[palate];
				if (pp === null || pp === undefined) return;
				var fa = palate === 'toasted brie' ? 4.5 : 0;
				fixed = [fa, pp, [unit(palate, 'effect', 0, fa, pp,
					palate === 'toasted brie' ? [['from the brie itself (4\u20135)', 4.5]] : [], palate === 'toasted brie' ? [2, 0, 0] : [0, 0, 0])]];
				if (palate === 'toasted brie') sUsed = 2;
			}
			var sm = organMenus(cfg, ctx, 'stomach'), S = bestFill(hiCap[0], sm[0], sm[1], 1, lam);
			var lm = organMenus(cfg, ctx, 'liver'), L = bestFill(hiCap[1], lm[0], lm[1], 2, lam);
			var pm = organMenus(cfg, ctx, 'spleen'), pg = pm[1];
			var dishes = [];
			cfg.noodles.forEach(function (n) {
				if (n.price === null || n.price === undefined) return;
				var a = mean(n.lo, n.hi, function (r) { return r; });
				dishes.push([1, 0, a, n.price, [unit(n.name + ' (Digestion)', 'spleen', 1, a, n.price, [[rangeText(n.lo, n.hi), a]], [0, 0, 1])]]);
			});
			if (dishes.length) pg = pg.concat([dishes]);
			var P = bestFill(hiCap[2], pm[0], pg, 0, lam);

			// stomach: the best fill whose flags avoid mask, with milk and the spork on any food
			function withHelpers(r) {
				if (r && r[3]) {
					[['milk of magnesium', 5], ['fudge spork', 3]].forEach(function (h) {
						if (ctx.worth(h[0], h[1])) {
							var p = ctx.p[h[0]];
							r = [r[0] + lam * h[1] - p, r[1] + h[1], r[2] + p, cat(r[3], [unit(h[0], 'stomach+', 0, h[1], p, [['on one food', h[1]]])])];
						}
					});
				}
				return r;
			}
			var SSa = S.map(function (row) {
				return [0, 1].map(function (mask) {
					var b = null;
					for (var f = 0; f < 2; f++) if (row[f] && !(f & mask) && (!b || row[f][0] > b[0])) b = row[f];
					return b ? withHelpers(b) : null;
				});
			});

			// liver: the day's fill, one nightcap of any size and the shotglass drink, sharing flags
			var drinksFor = (cfg.drinkCache || (cfg.drinkCache = {}))[palate] ||
				(cfg.drinkCache[palate] = nightcapAndShot(cfg, ctx));
			var nightcap = new Map([[0, [0, 0, 0, []]]]);
			drinksFor.caps.forEach(function (c) {
				var v = lam * c[1] - c[2];
				if (!nightcap.has(c[0]) || v > nightcap.get(c[0])[0]) nightcap.set(c[0], [v, c[1], c[2], c[3]]);
			});
			var shot = [0, 0, 0, []];
			drinksFor.shots.forEach(function (c) {
				if (lam * c[1] - c[2] > shot[0]) shot = [lam * c[1] - c[2], c[1], c[2], c[3]];
			});
			var LLa = L.map(function (row) {
				return [0, 1, 2, 3].map(function (mask) {
					var out = null;
					row.forEach(function (r, f1) {
						if (!r || f1 & mask) return;
						nightcap.forEach(function (n, f2) {
							if (f1 & f2 || f2 & mask) return;
							var v = r[0] + n[0] + shot[0];
							if (!out || v > out[0]) out = [v, r[1] + n[1] + shot[1], r[2] + n[2] + shot[2], cat(cat(r[3], n[3]), shot[3])];
						});
					});
					return out;
				});
			});
			var PP = P.map(function (row) { return row[0]; });

			// the specials, merged by the room they free and the daily flags they take
			function rateOf(t) {
				var r = 0;
				for (var c = 1; c < t.length; c++) r = Math.max(r, t[c][0] - t[c - 1][0]);
				return r;
			}
			var rate = [rateOf(SSa.map(function (r) { return r[0]; })), rateOf(LLa.map(function (r) { return r[0]; })), rateOf(PP)];
			// keys are numbers: room offsets shifted to be positive, then the two flag sets
			function skey(ds, dl, dp, sf, lf) { return ((((ds + 64) * 128 + dl + 64) * 128 + dp + 64) * 2 + sf) * 4 + lf; }
			var states = new Map([[skey(0, 0, 0, 0, 0), [[0, 0, 0, 0, 0], [0, 0, 0, null]]]]);
			cfg.specials.concat([PILL], cfg.grimaceMap ? MAP : [], cfg.cup ? [CUP] : []).forEach(function (sp) {
				var bound = 0;
				sp.d.forEach(function (x, i) { bound += Math.max(0, x) * rate[i]; });
				var found = sp.kind === 'pill' ? pillVariants(ctx, cfg) : sp.kind === 'cup' ? cupVariants(cfg) : specialVariants(ctx, cfg, sp);
				var variants = found.filter(function (v) { return lam * v[2] - v[3] + bound > 0; });
				if (!variants.length) return;
				// each way of taking it, built once: k copies of a variant, its room, flags and worth
				var takes = [];
				for (var k = 1; k <= sp.uses; k++) {
					(k === 1 ? variants : variants.slice(0, 1)).forEach(function (v) {
						var vd = v[5] || sp.d, copies = [];
						var u = unit(v[4], 'special', 0, v[2], v[3], v[6], vd.map(function (x) { return -x; }));
						for (var j = 0; j < k; j++) copies.push(u);
						takes.push([k * vd[0], k * vd[1], k * vd[2], v[0], v[1], k * (lam * v[2] - v[3]), k * v[2], k * v[3], copies]);
					});
				}
				var next = new Map(states);
				states.forEach(function (entry) {
					var key = entry[0], st = entry[1];
					for (var t = 0; t < takes.length; t++) {
						var tk = takes[t];
						if (tk[3] & key[3] || tk[4] & key[4]) continue;
						var v = st[0] + tk[5];
						var ks = skey(key[0] + tk[0], key[1] + tk[1], key[2] + tk[2], key[3] | tk[3], key[4] | tk[4]);
						var have = next.get(ks);
						if (have && have[1][0] >= v) continue;
						next.set(ks, [[key[0] + tk[0], key[1] + tk[1], key[2] + tk[2], key[3] | tk[3], key[4] | tk[4]],
							[v, st[1] + tk[6], st[2] + tk[7], cat(st[3], tk[8])]]);
					}
				});
				states = next;
			});

			states.forEach(function (entry) {
				var key = entry[0], st = entry[1];
				var cs = room[0] - sUsed + key[0], cl = room[1] + key[1], cp = room[2] + key[2];
				if (Math.min(cs, cl, cp) < 0) return;
				var s = SSa[Math.min(cs, hiCap[0])][key[3]], l = LLa[Math.min(cl, hiCap[1])][key[4]], p = PP[Math.min(cp, hiCap[2])];
				if (!s || !l) return;
				var total = st[0] + s[0] + l[0] + p[0] + lam * fixed[0] - fixed[1];
				var adv = st[1] + s[1] + l[1] + p[1] + fixed[0];
				var meat = st[2] + s[2] + l[2] + p[2] + fixed[1];
				var isBest = !best || total > best[0];
				var b = Math.floor((meat + ex[1]) / 250);
				var wins = bucket && (!bucket.has(b) || adv + ex[0] > bucket.get(b)[1]);
				if (isBest || wins) {
					var units = flat(st[3], s[3], l[3], p[3]).concat(fixed[2]);
					if (isBest) best = [total, adv, meat, units];
					if (wins) bucket.set(b, [meat + ex[1], adv + ex[0], lam, units.concat(ex[2])]);
				}
			});
		});
		return [best[1] + ex[0], best[2] + ex[1], best[3].concat(ex[2])];
	}

	// Plans for L from 10 to 400k; with refine, bisect between neighbours whose plans differ.
	// Returns the frontier over every candidate seen: [meat, adventures, L, units], more meat always
	// buying more adventures. A generator, yielding after each day planned, so the page can draw a
	// progress bar between steps; sweep() runs it straight through.
	function* sweepSteps(cfg, opts) {
		opts = opts || {};
		var points = opts.points || 40, seen = new Map(), bucket = new Map();
		var grid = [], i;
		for (i = 0; i < points; i++) grid.push(10 * Math.pow(40000, i / (points - 1)));
		for (i = 0; i < grid.length; i++) {
			seen.set(grid[i], planDay(cfg, grid[i], bucket));
			yield seen.size;
		}
		if (opts.refine !== false) {
			var todo = [];
			for (i = 0; i + 1 < grid.length; i++) todo.push([grid[i], grid[i + 1]]);
			while (todo.length) {
				var pair = todo.pop(), a = pair[0], b = pair[1];
				if (b / a < (opts.ratio || 1.03) || seen.get(a)[0].toFixed(6) === seen.get(b)[0].toFixed(6)) continue;
				var mid = Math.sqrt(a * b);
				seen.set(mid, planDay(cfg, mid, bucket));
				yield seen.size;
				todo.push([a, mid], [mid, b]);
			}
		}
		var all = Array.from(bucket.values()).sort(function (x, y) { return x[0] - y[0]; });
		var frontier = [];
		all.forEach(function (p) {
			if (!frontier.length || p[1] > frontier[frontier.length - 1][1] + 1e-9) frontier.push(p);
		});
		return frontier;
	}

	function sweep(cfg, opts) {
		var steps = sweepSteps(cfg, opts), r;
		do { r = steps.next(); } while (!r.done);
		return r.value;
	}

	// The same, a slice at a time, so the page stays responsive: resolves to the frontier. Slices
	// are handed on through a MessageChannel rather than setTimeout, which a browser slows to once
	// a second in a tab that isn't showing.
	function sweepAsync(cfg, opts, onProgress) {
		var steps = sweepSteps(cfg, opts);
		var channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
		function later(fn) {
			if (!channel) return setTimeout(fn, 0);
			channel.port1.onmessage = fn;
			channel.port2.postMessage(0);
		}
		return new Promise(function (resolve) {
			(function slice() {
				var until = Date.now() + 60, r;
				do { r = steps.next(); } while (!r.done && Date.now() < until);
				if (r.done) {
					if (channel) channel.port1.close();
					return resolve(r.value);
				}
				if (onProgress) onProgress(r.value);
				later(slice);
			})();
		});
	}

	function gcd(a, b) { return b ? gcd(b, a % b) : a; }

	// The move from one corner to the next, as swaps that can be made a few at a time.
	function stepsBetween(lo, hi) {
		var a = new Bag(lo[3]), b = new Bag(hi[3]);
		var gone = a.minus(b), added = b.minus(a);
		var organs = new Set(), flagged = new Set();
		gone.entries().concat(added.entries()).forEach(function (e) {
			organs.add(e[0][1]);
			if (ONCE.some(function (t) { return e[0][0].indexOf(t) >= 0; })) flagged.add(e[0][1]);
		});
		if (organs.has('special') || organs.has('effect') || flagged.size > 1) return [[gone, added, 1]];
		var out = [];
		organs.forEach(function (o) {
			var g = new Bag(), n = new Bag();
			gone.entries().forEach(function (e) { if (e[0][1] === o) g.add(e[0], e[1]); });
			added.entries().forEach(function (e) { if (e[0][1] === o) n.add(e[0], e[1]); });
			var ge = g.entries(), ne = n.entries();
			if (ge.length === 1 && ne.length === 1) {
				var d = gcd(ge[0][1], ne[0][1]);
				var g1 = new Bag(), n1 = new Bag();
				g1.add(ge[0][0], ge[0][1] / d);
				n1.add(ne[0][0], ne[0][1] / d);
				out.push([g1, n1, d]);
			} else if (!ge.length) {
				ne.forEach(function (e) { var one = new Bag(); one.add(e[0], 1); out.push([new Bag(), one, e[1]]); });
			} else {
				out.push([g, n, 1]);
			}
		});
		return out;
	}

	function upgrade(lo, hi, budget) {
		var plan = new Bag(lo[3]), adv = lo[1], meat = lo[0], steps = [];
		stepsBetween(lo, hi).forEach(function (s) {
			var da = 0, dm = 0;
			s[1].entries().forEach(function (e) { da += e[0][3] * e[1]; dm += e[0][4] * e[1]; });
			s[0].entries().forEach(function (e) { da -= e[0][3] * e[1]; dm -= e[0][4] * e[1]; });
			if (da > 0) steps.push([dm > 0 ? da / dm : Infinity, da, dm, s[0], s[1], s[2]]);
		});
		steps.sort(function (x, y) { return y[0] - x[0]; });
		steps.forEach(function (s) {
			for (var i = 0; i < s[5]; i++) {
				if (meat + s[2] > budget) break;
				s[3].entries().forEach(function (e) { plan.add(e[0], -e[1]); });
				s[4].entries().forEach(function (e) { plan.add(e[0], e[1]); });
				adv += s[1];
				meat += s[2];
			}
		});
		return [adv, meat, plan.elements()];
	}

	// The plan for a budget: from each of the last few days that fit, upgraded towards each of the
	// next few that don't, the one with the most adventures. [adventures, meat, units] or null.
	function planFor(frontier, budget, below, above) {
		below = below || 12;
		above = above || 40;
		var i = -1;
		for (var k = 0; k < frontier.length; k++) if (frontier[k][0] <= budget) i = k;
		if (i < 0) return null;
		var best = [frontier[i][1], frontier[i][0], frontier[i][3]];
		for (var a = Math.max(0, i - below + 1); a <= i; a++) {
			for (var b = i + 1; b < Math.min(frontier.length, i + 1 + above); b++) {
				var cand = upgrade(frontier[a], frontier[b], budget);
				if (cand[0] > best[0] + 1e-9) best = cand;
			}
		}
		return best;
	}

	// A plan, organ by organ: [[title, [[label, count], ...]], ...]
	function describe(units) {
		return SECTIONS.map(function (s) {
			var counts = new Map();
			units.forEach(function (u) { if (u[1] === s[0]) counts.set(u[0], (counts.get(u[0]) || 0) + 1); });
			var items = Array.from(counts.entries()).sort(function (x, y) { return y[1] - x[1] || (x[0] < y[0] ? -1 : 1); });
			return [s[1], items];
		}).filter(function (s) { return s[1].length; });
	}

	// The plan as the rows of a table, in the order to do things:
	// {action, name, kind, count, adv, parts, room, cost, note, phase}. name is the thing to decorate: an
	// item, or a skill, effect or familiar (kind says which). adv, room and cost are for all count of
	// them; parts is one's breakdown. A dieting pill and the food it doubles are two rows, as are
	// the day's last 1-drunk drink, kept back for the Stooper, and the rest of its kind.
	// "mix and drink grease gun (tier 5) + 2 × second-hand synthetic sloth skin scabbard (tier 4)":
	// the Cup takes almost anything with a tier, equipment included, which can look like a mistake.
	//
	// phase says which half of the day a row belongs to: 'end' for the four rows that happen after
	// the day's turns are played -- the 1-drunk drink kept back for the Stooper, the nightcap, and
	// the two Cooler Yeti conversations around them -- and 'start' for everything else. Said here
	// rather than worked out later from the note text, because this function is where the reason
	// each row sits where it does is actually known, and a second reading of "before your last
	// turns" somewhere else is a second place to get it wrong.
	//
	// Two more fields appear only on the rows that need them, for the same reason: mix, the Cup of
	// 13s' three ingredients (see cupMix below), and nightcap, true on the one drink that is meant
	// to take you past your limit. Anything carrying out a plan has to tell that drink from every
	// other drink in it, and "the note begins with the word nightcap" is not a thing to bet a
	// liver on.
	function cupNote(label, cfg) {
		var tier = {}, n = {}, order = [];
		if (cfg.cup && cfg.cup.tiers) {
			Object.keys(cfg.cup.tiers).forEach(function (t) { cfg.cup.tiers[t].forEach(function (x) { tier[x.name] = t; }); });
		}
		label.replace(/^Cup of 13s \(|\)$/g, '').split(' + ').forEach(function (x) {
			if (!n[x]) order.push(x);
			n[x] = (n[x] || 0) + 1;
		});
		return 'mix and drink ' + order.map(function (x) {
			return (n[x] > 1 ? n[x] + ' \u00d7 ' : '') + x + (tier[x] ? ' (tier ' + tier[x] + ')' : '');
		}).join(' + ') + ': the Cup takes almost anything with a tier, equipment too, and adds the tiers';
	}

	// The three things that go in the Cup, off the unit's own label.
	//
	// The label is built by joining the chosen tiers' names with " + " (see the Cup's units above),
	// so splitting on " + " gives them back exactly -- no KoL item name contains that sequence. The
	// row carries them as a list because mixing the drink needs three item names and nothing else
	// in the row has them: cupNote() above turns them into a sentence with counts and tiers in it,
	// and a script that had to read that sentence back into three names would be one bad name away
	// from mixing the wrong thing.
	function cupMix(label) {
		var m = /^Cup of 13s \((.*)\)$/.exec(label);
		return m ? m[1].split(' + ') : [];
	}

	function dayRows(units, cfg) {
		var groups = new Bag(units).entries();
		function take(pred) {
			var out = groups.filter(function (e) { return pred(e[0]); });
			groups = groups.filter(function (e) { return !pred(e[0]); });
			return out;
		}
		function base(label) {
			return label.replace(/ \((nightcap|Digestion)\)$/, '').replace(' [yeti]', '').split(' + ')[0];
		}
		function helpersOf(label) {
			return label.replace(/ \((nightcap|Digestion)\)$/, '').replace(' [yeti]', '').split(' + ').slice(1);
		}
		function times(v, n) { return v.map(function (x) { return x * n || 0; }); }  // || 0: no -0
		var rows = [];
		// Every row goes through here, so that a row added later cannot arrive without a phase:
		// the day's start is the default, and the four rows after the day's turns say so for
		// themselves. A row with no phase at all would be walked by neither of the Consume tab's
		// buttons and would simply never happen, which is the one failure that looks like nothing.
		function push(r) {
			if (!r.phase) r.phase = 'start';
			rows.push(r);
		}
		function add(action, u, n, note, over) {
			var r = {action: action, name: base(u[0]), kind: 'item', count: n, adv: u[3] * n, parts: u[5],
				room: times(u[6], n), cost: u[4] * n, note: note || ''};
			var helpers = u[0].indexOf('Cup of 13s') === 0 ? [] : helpersOf(u[0]);  // its parts are ingredients
			if (helpers.length) r.note = (r.note ? r.note + '; ' : '') + 'with ' + helpers.join(' and ');
			Object.keys(over || {}).forEach(function (k) { r[k] = over[k]; });
			push(r);
		}
		function info(action, name, kind, note, over) {
			var r = {action: action, name: name, kind: kind, count: 1, adv: null, parts: [], room: [0, 0, 0],
				cost: 0, note: note};
			Object.keys(over || {}).forEach(function (k) { r[k] = over[k]; });
			push(r);
		}
		function starts(names) { return function (u) { return names.some(function (x) { return u[0].indexOf(x) === 0; }); }; }

		var drunk = 0;
		units.forEach(function (u) { if (u[1] === 'liver' || u[1] === 'nightcap') drunk += u[2]; });
		var wines = units.some(function (u) { return u[5].some(function (p) { return p[0] === 'mafia pinky ring' || p[0] === 'Refined Palate'; }); });
		var martinis = units.some(function (u) { return u[5].some(function (p) { return p[0] === 'tuxedo shirt'; }); });

		// set up
		if (cfg.ode && drunk) info('cast', 'The Ode to Booze', 'skill', 'enough for ' + drunk + ' drunk: +1 an adventure per drunk, counted in the drinks');
		if (cfg.ring && wines) info('equip', 'mafia pinky ring', 'item', 'wine +12.5%, counted in the wines');
		if (cfg.tuxedo && martinis) info('equip', 'tuxedo shirt', 'item', 'martinis +2, counted in the martinis');
		take(function (u) { return u[1] === 'effect'; }).forEach(function (e) {
			var brie = e[0][0] === 'toasted brie';
			add(brie ? 'eat' : 'use', e[0], e[1], brie ? 'for Refined Palate: wine +25%, counted in the wines'
				: 'wish for Refined Palate: wine +25%, counted in the wines');
		});
		// first drinks: a morning drink doubled by last night's yeti charge, then the shotglass
		var morning = take(function (u) { return u[1] === 'liver' && u[0].indexOf('[yeti]') >= 0; });
		morning.forEach(function (e) { add('drink', e[0], e[1], 'first drink of the day, doubled by the Cooler Yeti charge set last night'); });
		take(function (u) { return u[1] === 'shotglass'; }).forEach(function (e) { add('drink', e[0], e[1], 'through the mime army shotglass'); });
		// eat
		take(function (u) { return u[1] === 'stomach+'; }).forEach(function (e) { add('use', e[0], e[1], 'before eating'); });
		take(function (u) { return u[1] === 'stomach'; }).forEach(function (e) {
			add('eat', e[0], e[1], e[0][0].indexOf("Ol' Scratch's salad fork") >= 0 ? 'with the salad fork' : '');
		});
		take(starts(['dieting pill + '])).forEach(function (e) {
			var u = e[0], n = e[1], food = u[0].replace('dieting pill + ', '');
			push({action: 'use', name: 'dieting pill', kind: 'item', count: n, adv: null, parts: [],
				room: [0, 0, 3 * n], cost: cfg.pill * n, note: 'just before the food it doubles'});
			add('eat', [food].concat(u.slice(1)), n, 'doubled by the dieting pill: twice the fullness and adventures',
				{room: [u[6][0] * n, 0, 0], cost: (u[4] - cfg.pill) * n});
		});
		take(function (u) { return /\(Digestion\)$/.test(u[0]); }).forEach(function (e) {
			add('eat', e[0], e[1], 'then pick With my Spleen: −1 fullness, +1 spleen', {room: [0, 0, e[1]]});
		});
		if (cfg.toilet) push({action: 'use', name: 'Pork Elf toilet', kind: 'campground', count: 1, adv: null, parts: [],
			room: [-1, 0, 0], cost: 0, note: 'rest once after 2 fullness, and eat into the room'});
		// chew
		take(function (u) { return u[1] === 'spleen'; }).forEach(function (e) { add('chew', e[0], e[1]); });
		// drink, keeping a 1-drunk drink back for the Stooper: drunk before the last turns and played,
		// so only the nightcap is banked against the 200 cap
		var kept = null;
		take(function (u) { return u[1] === 'liver'; }).forEach(function (e) {
			var n = e[1];
			if (cfg.stooper && !kept && e[0][2] === 1) { kept = e[0]; n -= 1; }
			if (n > 0) add('drink', e[0], n);
		});
		// cleaners and expanders, once the organ they free is full
		[[["Doc Clock's", 'The Mad Liquor'], 'drink', 'once the stomach is full; then eat into the room it frees'],
			[['Mr. Burnsger', "The Plumber's"], 'eat', 'once the liver is full; then drink into the room it frees'],
			[['extra-greasy slider'], 'eat', 'once spleen is full: frees 5; then chew into the room'],
			[['jar of fermented pickle juice'], 'drink', 'once spleen is full: frees 5; then chew into the room'],
			[['mojo filter'], 'use', 'once spleen is full; then chew into the room'],
			[['spice melange', 'cuppa Voraci', 'sweet tooth', 'lupine', 'cuppa Sobrie', 'distention pill', 'synthetic dog hair pill'],
				'use', 'once the organs it affects are full; then fill the room'],
			[['Cup of 13s'], 'drink', '']].forEach(function (c) {
			take(starts(c[0])).forEach(function (e) {
				if (e[0][0].indexOf('Cup of 13s') === 0) {
					add('drink', e[0], e[1], cupNote(e[0][0], cfg), {name: 'Cup of 13s', mix: cupMix(e[0][0])});
				} else {
					add(c[1], e[0], e[1], c[2]);
				}
			});
		});
		take(function (u) { return u[1] === 'extra'; }).forEach(function (e) { add('use', e[0], e[1], 'any time'); });
		// end of day
		if (kept) add('drink', kept, 1, 'before your last turns: put the Stooper out, drink it, and play them with it still out',
			{phase: 'end'});
		var nc = take(function (u) { return u[1] === 'nightcap'; });
		var ncYeti = nc.some(function (e) { return e[0][0].indexOf('[yeti]') >= 0; });
		if (ncYeti) info('use', 'Cooler Yeti', 'familiar', 'chat: Make my next drink impossibly cold! (400 XP), just before the nightcap',
			{phase: 'end'});
		nc.forEach(function (e) { add('drink', e[0], e[1], 'nightcap: after the day’s turns; leaves you falling-down drunk',
			{phase: 'end', nightcap: true}); });
		if (morning.length) info('use', 'Cooler Yeti', 'familiar', 'chat: Make my next drink impossibly cold! (400 XP), for tomorrow’s first drink',
			{phase: 'end'});
		groups.forEach(function (e) { add('use', e[0], e[1]); });  // anything not placed above
		return rows;
	}

	// --- What the mall has ------------------------------------------------------------
	//
	// cowl_diet_price.ash answers with what the mall has of an item today, [quantity, price] pairs,
	// the quantities what one buyer may take (a store's daily limit counts). A plan pays for the units
	// it takes, cheapest first, and can't take more than there are: an item with fewer for sale than
	// a day could use becomes a group capped at that many. Something made rather than bought comes
	// back with a price instead, and something nobody sells drops out.

	var STOCK_CAP = 30;  // more for sale than this and no day runs out
	var NTH = 5;         // priced for five at least, as KoLmafia's mall_price() is: one cheap listing goes fast
	var MATERIAL = 0.02; // a price that moves less than this isn't worth planning again for

	function stockCount(stock) {
		return stock.reduce(function (n, s) { return n + s[0]; }, 0);
	}

	// What n of them cost, the cheapest first.
	function stockCost(stock, n) {
		var sorted = stock.slice().sort(function (a, b) { return a[1] - b[1]; }), total = 0;
		for (var i = 0; i < sorted.length && n > 0; i++) {
			var k = Math.min(n, sorted[i][0]);
			total += k * sorted[i][1];
			n -= k;
		}
		return total;
	}

	// The price of one when buying need of them (five at least): null if nobody sells it (and it
	// can't be made), undefined if the mall had nothing to say (an untradeable drink it can't price).
	function marketPrice(m, need) {
		if (!m) return undefined;
		var have = m.stock ? stockCount(m.stock) : 0;
		if (!have) return m.price !== undefined ? m.price : m.stock ? null : undefined;
		var n = Math.min(have, Math.max(NTH, need || 1));
		return Math.ceil(stockCost(m.stock, n) / n);
	}

	// Puts the mall's answers into the data: prices for the quantities priced at, caps where the
	// stock is short, and nothing that can't be bought. How many changed enough to plan again for:
	// anything dropped or capped, and prices that moved more than MATERIAL.
	function moved(was, now) {
		return was === null || was === undefined || now === null || Math.abs(now - was) > MATERIAL * was;
	}
	function applyMarket(data, market, pricedAt) {
		var changed = 0;
		function one(x, organ) {
			var m = market[x.name];
			var p = marketPrice(m, pricedAt[x.name]);
			if (p === undefined) return;
			if (p !== x.price) {
				if (moved(x.price, p)) changed++;
				x.price = p;
			}
			var have = m.stock ? stockCount(m.stock) : 0;
			if (!organ || !have || have >= STOCK_CAP) return;
			if (!x.group || x.group === 'stock: ' + x.name) {
				if (x.group !== 'stock: ' + x.name || x.cap !== have) { x.group = 'stock: ' + x.name; x.cap = have; changed++; }
			} else if (have < x.cap) {
				x.cap = have;  // a daily limit, and fewer for sale than that
				changed++;
			}
		}
		data.menu.forEach(function (x) { one(x, true); });
		data.specials.concat(data.noodles, data.extras).forEach(function (x) { one(x, false); });
		if (data.cup && data.cup.tiers) {
			Object.keys(data.cup.tiers).forEach(function (t) { data.cup.tiers[t].forEach(function (x) { one(x, false); }); });
		}
		Object.keys(data.helpers).forEach(function (h) {
			var p = marketPrice(market[h], pricedAt[h]);
			if (p === undefined || p === data.helpers[h]) return;
			if (moved(data.helpers[h], p)) changed++;
			data.helpers[h] = p;
		});
		var pill = marketPrice(market['dieting pill'], pricedAt['dieting pill']);
		if (pill !== undefined && pill !== data.pill) {
			if (moved(data.pill, pill)) changed++;
			data.pill = pill;
		}
		var before = data.menu.length;
		data.menu = data.menu.filter(function (x) { return x.price !== null; });
		return changed + before - data.menu.length;
	}

	// The prices button has KoLmafia record a fresh price for everything on sale; anything it didn't
	// touch wasn't for sale, so it drops out before planning rather than one check at a time. Only
	// within a day of the button. How many dropped.
	function dropUnsold(data) {
		var ago = data.account.refreshedAgo;
		if (!(ago >= 0 && ago < 1)) return 0;
		var before = data.menu.length;
		data.menu = data.menu.filter(function (x) { return x.age === undefined || x.age <= ago + 0.01; });
		return before - data.menu.length;
	}

	// The units of the frontier's days either side of a budget: what a plan there would turn to if
	// something in it couldn't be had, so the mall can be asked about those in the same breath.
	function around(frontier, budget, k) {
		var i = 0;
		for (var j = 0; j < frontier.length; j++) if (frontier[j][0] <= budget) i = j;
		return frontier.slice(Math.max(0, i - k), i + k + 1).map(function (p) { return p[3]; });
	}

	var API = {buildConfig: buildConfig, normalize: normalize, planDay: planDay, sweep: sweep, planFor: planFor,
		sweepAsync: sweepAsync, dayRows: dayRows, describe: describe, SECTIONS: SECTIONS, rint: rint,
		applyMarket: applyMarket, marketPrice: marketPrice, dropUnsold: dropUnsold, stockCount: stockCount, around: around};
	if (typeof module !== 'undefined' && module.exports) module.exports = API;
	else window.cowlDietPlan = API;
})();
