// cowl_diet_booze.js -- the Mafia Wines and Martinis tabs.
//
// Two tables of the same shape, from one answer (cowl_diet_booze.ash): every booze KoLmafia flags
// WINE, and every one it flags MARTINI. 112 and 36, and nothing is in both.
//
// THE SAME ROW THE PLAN DRAWS. The picture in its own cell, opening KoL's description on a click
// (the handler lives in cowl_diet.js and catches any img[data-desc] on the page); the name in bold
// as a link to the wiki; what drinking it gets you underneath, in cd-sub. Not a new look -- the
// classes are the plan's own, so a wine reads here exactly as it reads in a plan.
//
// SORTABLE, because 112 rows in KoLmafia's own item order is a list nobody can use. It opens on
// adventures per point of liver, biggest first, which is the question a diet planner asks: the
// liver is what runs out, not the meat. Press a heading to sort by it; press it again to turn it
// round. The rules are the Halloween page's, which is the sorting this project already has.
//
// Nothing here asks KoLmafia for anything: the tab's one fetch is made by cowl_diet.js the first
// time the tab is opened.
(function () {
	'use strict';

	var WIKI = 'https://wiki.kingdomofloathing.com/index.php?go=Go&search=';

	function esc(s) {
		return String(s === null || s === undefined ? '' : s)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function meat(n) { return n.toLocaleString('en-US'); }

	// A count to one decimal: "7.3". Adventures per point of liver, which is between 1 and 10 for
	// everything in the table, so a fixed decimal reads straight down the column.
	function one(n) {
		return (n === null || n === undefined) ? '' : n.toFixed(1);
	}

	// ADVENTURES PER MEAT IS A VERY SMALL NUMBER and the column still has to be readable.
	//
	// A cheap wine is around 0.05 adventures a meat and the dearest thing in the table is
	// 0.0000000001 -- fifty billion meat for a wine nobody can buy. A fixed number of decimals
	// would print either a row of zeroes or a column of trailing ones, so this keeps three
	// significant figures and drops to exponent form only where a decimal would be all zeroes.
	// The number is the one asked for, adventures per meat; only how it is written changes.
	function perMeat(n) {
		if (n === null || n === undefined) return '';
		if (n === 0) return '0';
		if (n < 0.0001) return n.toExponential(2);
		return Number(n.toPrecision(3)).toString();
	}

	// The columns, in the order asked for. `get` is what the column sorts and prints on; `text`
	// turns that into what the cell says. A null sorts to the bottom whichever way the column is
	// turned -- "no price" is not a small price, and a row with nothing to say should not win a
	// sort by saying nothing.
	var COLUMNS = [
		{key: 'name',     label: 'Wine',      align: 'left'},   // the martinis tab heads it 'Martini'
		{key: 'liver',    label: 'Liver',     get: function (r) { return r.liver; }},
		{key: 'range',    label: 'Adv',       get: function (r) { return r.mean; },
			text: function (r) { return esc(r.range); }},
		{key: 'perliver', label: 'Adv/liver', get: function (r) { return r.liver ? r.mean / r.liver : null; },
			text: function (r) { return one(r.liver ? r.mean / r.liver : null); }},
		{key: 'price',    label: 'Mall',      get: function (r) { return r.price; },
			text: function (r) { return r.price ? meat(r.price) : '<span class="cd-said">&mdash;</span>'; }},
		{key: 'permeat',  label: 'Adv/meat',  get: function (r) { return r.price ? r.mean / r.price : null; },
			text: function (r) { return perMeat(r.price ? r.mean / r.price : null); }},
		{key: 'owned',    label: 'Have',      get: function (r) { return r.owned; },
			text: function (r) { return r.owned ? meat(r.owned) : '<span class="cd-said">0</span>'; }}
	];

	function iconCell(r) {
		if (!r.image) return '<td class="cd-icon"></td>';
		return '<td class="cd-icon"><img src="/images/itemimages/' + esc(r.image) + '" alt="' + esc(r.name) + '"' +
			(r.descid ? ' data-desc="' + esc(r.descid) + '" title="KoL’s description"' : '') +
			' loading="lazy"></td>';
	}

	function nameCell(r) {
		var out = '<td class="cd-item"><a class="cd-wiki" href="' + WIKI + encodeURIComponent(r.name) +
			'" target="kolwiki" rel="noreferrer"><b>' + esc(r.name) + '</b></a>';
		if (r.note) out += '<div class="cd-sub">' + esc(r.note) + '</div>';
		return out + '</td>';
	}

	function rowHtml(r) {
		var out = iconCell(r) + nameCell(r);
		for (var i = 1; i < COLUMNS.length; i++) {
			var c = COLUMNS[i];
			out += '<td class="cd-num">' + (c.text ? c.text(r) : esc(c.get(r))) + '</td>';
		}
		return '<tr>' + out + '</tr>';
	}

	// A null last, both ways. Otherwise by the column, and by name when two tie, so the order is
	// the same every time the page is drawn rather than whatever the browser's sort happened to do.
	function sorted(rows, key, down) {
		var col = COLUMNS.filter(function (c) { return c.key === key; })[0] || COLUMNS[0];
		var out = rows.slice();
		out.sort(function (a, b) {
			if (col.key === 'name') {
				return a.name.localeCompare(b.name) * (down ? -1 : 1);
			}
			var x = col.get(a), y = col.get(b);
			var xn = x === null || x === undefined, yn = y === null || y === undefined;
			if (xn && yn) return a.name.localeCompare(b.name);
			if (xn) return 1;
			if (yn) return -1;
			if (x !== y) return (x - y) * (down ? -1 : 1);
			return a.name.localeCompare(b.name);
		});
		return out;
	}

	// What is boosting the figures, said once above the table. A reader who has just put the ring
	// on and watched every range move deserves to be told why, and one who has not deserves to know
	// the column is the plain number.
	function boostLine(boosted, which) {
		var on = [];
		if (which === 'wines') {
			if (boosted.ring) on.push('the mafia pinky ring');
			if (boosted.palate) on.push('Refined Palate');
		} else if (boosted.tuxedo) {
			on.push('the tuxedo shirt');
		}
		var what = which === 'wines' ? 'wine' : 'martini';
		if (!on.length) {
			return '<p class="cd-said">Plain figures: nothing is adding adventures to a ' + what +
				' right now. Put the ' + (which === 'wines' ? 'pinky ring' : 'tuxedo shirt') +
				' on, or set auto' + (which === 'wines' ? 'PinkyRing' : 'Tuxedo') + ', and these move.</p>';
		}
		return '<p class="cd-said">Adventures include ' + esc(on.join(' and ')) +
			'. The average is taken over every roll in the range, which is what KoLmafia does' +
			(which === 'wines' ? ' — a wine’s average is not the midpoint of its range, because the ring’s' +
				' bonus is a rounded eighth and so steps.' : '.') + '</p>';
	}

	function table(rows, key, down, nameLabel) {
		var head = '';
		COLUMNS.forEach(function (c) {
			var on = c.key === key;
			head += '<th class="cd-sortable' + (on ? ' cd-sorted' : '') + '" data-sort="' + c.key +
				'" scope="col" aria-sort="' + (on ? (down ? 'descending' : 'ascending') : 'none') + '">' +
				esc(c.key === 'name' ? nameLabel : c.label) +
				'<span class="cd-arrow">' + (on ? (down ? '▼' : '▲') : '') + '</span></th>';
		});
		return '<table class="cd-order cd-booze"><thead><tr><th class="cd-icon"></th>' + head +
			'</tr></thead><tbody>' + sorted(rows, key, down).map(rowHtml).join('') + '</tbody></table>';
	}

	// One tab. It keeps its own sort, so turning the wines round doesn't turn the martinis round.
	function mountOne(el, rows, boosted, which, nameLabel) {
		var key = 'perliver', down = true;

		function draw() {
			el.innerHTML = boostLine(boosted, which) + table(rows, key, down, nameLabel);
		}

		el.addEventListener('click', function (e) {
			var th = e.target.closest && e.target.closest('th[data-sort]');
			if (!th) return;
			var k = th.getAttribute('data-sort');
			// A fresh column opens the way that column is most often wanted: biggest first for a
			// number, A to Z for the name.
			if (k === key) down = !down;
			else { key = k; down = k !== 'name'; }
			draw();
		});

		draw();
	}

	// mount is all the page needs; the rest is exported for tests/cowl_diet_booze.test.js, which is
	// the only way the formatting and the sort get checked at all -- they are too small to notice
	// being wrong by eye and too easy to break.
	var API = {
		mount: function (wineEl, martiniEl, data) {
			if (wineEl) mountOne(wineEl, data.wines || [], data.boosted || {}, 'wines', 'Wine');
			if (martiniEl) mountOne(martiniEl, data.martinis || [], data.boosted || {}, 'martinis', 'Martini');
		},
		perMeat: perMeat, one: one, sorted: sorted, COLUMNS: COLUMNS
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = API;
	else window.cowlDietBooze = API;
})();
