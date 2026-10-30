// relay_Halloween_Treats.ash -- every trick-or-treating outfit and its treat.
//
// On Halloween you knock on doors in an outfit and the outfit decides the
// treat. This is that table: what each outfit brings back, what it is worth,
// and whether you can put it on.
//
// KoLmafia lists any relay/relay_<Name>.ash in the relay browser's top menu
// with underscores as spaces, so this arrives as "Halloween Treats".
//
// WHERE THE TABLE COMES FROM. Not the wiki -- KoLmafia keeps the mapping in
// the fifth column of data/outfits.txt:
//
//     # id  name              image        equipment               halloween drops
//     1     Bugbear Costume   bugbear.gif  bugbear beanie, ...     cog, sprocket, spring
//
// ASH cannot see that column: the outfit proxy has no field for it and no
// library function returns it. file_to_map does not find the file either,
// because that looks for an override in the data directory while these rows
// live in the jar -- file_to_buffer with the "data/" prefix reads the shipped
// copy, overrides and all.
//
// WHAT A TREAT IS WORTH is every drop's chance times its recorded price, a
// drop with no stated chance counting as certain. One sum covers both shapes
// the column takes: the Bugbear Costume's cog, sprocket and spring all
// arrive, so it is the three added up, and the Frat Boy Ensemble's four
// bottles at 0.25 each are the four averaged.
//
// historical_price, never mall_price: this page asks about two hundred items
// at once, and mall_price is a live search against KoL for each one.
//
// This page is self-contained on purpose. It reads KoLmafia and writes HTML,
// and borrows nothing from the rest of this project.

string hwTrim(string value) {
	matcher m = create_matcher("^\\s+|\\s+$", value);
	return m.replace_all("");
}

record hwTreat {
	item thing;
	float rate;   // 1.0 when KoLmafia states no rate, which means you get it
	int price;
};

record hwOutfit {
	string name;
	boolean owned;
	boolean inCase;
	float worth;
	hwTreat [int] treats;
};

// One drop, as KoLmafia writes it: a name, optionally followed by a bracketed
// chance. The name keeps KoLmafia's own entities, because that is the
// spelling to_item knows.
hwTreat hwParseDrop(string raw) {
	hwTreat t;
	t.rate = 1.0;
	string name = raw;

	matcher m = create_matcher("^(.*?)\\s*\\(([0-9.]+)\\)$", raw);
	if (m.find()) {
		name = m.group(1);
		t.rate = m.group(2).to_float();
	}

	t.thing = name.to_item();
	t.price = t.thing == $item[none] ? 0 : historical_price(t.thing);
	return t;
}

// Do you own this outfit, and would wearing it mean a trip to the display
// case first? 0 missing, 1 ready, 2 yours but in the case.
//
// have_outfit is KoLmafia's answer to "do you own this" and it is not quite
// the question: it means every piece in your hands, closet, storage or clan
// stash. The display case is in none of those lists -- getAccessibleCount
// does not look there -- so a collection kept in the museum reads as owning
// nothing, which for a page about costumes is the wrong answer.
int HW_MISSING = 0;
int HW_READY = 1;
int HW_IN_CASE = 2;

int hwOwned(string name) {
	if (have_outfit(name)) return HW_READY;

	item [int] pieces = outfit_pieces(name);
	if (count(pieces) == 0) return HW_MISSING;

	boolean fromCase = false;
	foreach i, p in pieces {
		if (available_amount(p) > 0) continue;
		if (display_amount(p) > 0) { fromCase = true; continue; }
		return HW_MISSING;
	}
	return fromCase ? HW_IN_CASE : HW_MISSING;
}

hwOutfit [int] hwOutfits() {
	hwOutfit [int] all;

	foreach i, line in split_string(file_to_buffer("data/outfits.txt").to_string(), "\n") {
		if (line == "" || line.starts_with("#")) continue;
		string [int] cell = split_string(line, "\t");
		if (count(cell) < 5) continue;
		if (cell[4] == "") continue;

		hwOutfit o;
		o.name = cell[1];
		int state = hwOwned(o.name);
		o.owned = state != HW_MISSING;
		o.inCase = state == HW_IN_CASE;

		// "none" is KoLmafia saying this outfit deliberately yields nothing,
		// which two of them do. They are still outfits you can wear to a
		// door, so they are still rows: a row that says "nothing" answers the
		// question and a missing row looks like a parser that lost them.
		if (cell[4] != "none") {
			foreach j, raw in split_string(cell[4], ",") {
				hwTreat t = hwParseDrop(raw.hwTrim());
				if (t.thing == $item[none]) continue;
				o.treats[count(o.treats)] = t;
				o.worth = o.worth + t.rate * t.price;
			}
		}

		all[count(all)] = o;
	}

	return all;
}

string hwWiki(string name) {
	return "<a href=\"https://wiki.kingdomofloathing.com/index.php?search="
		+ name.entity_decode().url_encode() + "&go=Go\" target=\"kolwiki\">"
		+ name + "</a>";
}

void main() {
	hwOutfit [int] all = hwOutfits();

	buffer out;
	out.append("<html><head><title>Halloween Treats</title>");
	out.append("<style type='text/css'>");
	out.append("body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; margin: 10px; }");
	out.append("table { border-collapse: collapse; width: 100%; }");
	out.append("th, td { border-bottom: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }");
	out.append("th { cursor: pointer; white-space: nowrap; }");
	out.append(".num { text-align: right; white-space: nowrap; }");
	out.append(".icon { height: 30px; width: 30px; vertical-align: middle; }");
	out.append(".mods, .rate, .none { color: #666; font-size: 10px; }");
	out.append(".drop { margin-bottom: 3px; }");
	out.append("</style></head><body>");

	out.append("<h3>Trick or treat</h3>");
	out.append("<p>What each outfit brings back from a door. <b>Worth</b> is every drop's chance "
		+ "times its recorded mall price, so an outfit that gives you three things is the three "
		+ "added up and one that gives you a quarter chance of four is the four averaged. Prices "
		+ "are KoLmafia's recorded ones, not a live search.</p>");
	out.append("<p><label><input type='checkbox' id='ownonly'> only outfits I own</label> "
		+ "<span id='shown'></span></p>");

	out.append("<table id='hw'><thead><tr>");
	out.append("<th data-key='name'>Outfit</th>");
	out.append("<th data-key='own'>Own</th>");
	out.append("<th data-key='treat'>Treat</th>");
	out.append("<th data-key='worth' class='num'>Worth</th>");
	out.append("</tr></thead><tbody>");

	foreach i, o in all {
		out.append("<tr data-name=\"" + o.name.to_lower_case() + "\"");
		out.append(" data-own=\"" + (o.owned ? (o.inCase ? "1" : "0") : "2") + "\"");
		out.append(" data-have=\"" + (o.owned ? "1" : "0") + "\"");
		out.append(" data-treat=\"" + (count(o.treats) == 0 ? "zzzz"
			: o.treats[0].thing.name.to_lower_case().entity_encode()) + "\"");
		out.append(" data-worth=\"" + to_string(o.worth, "%.0f") + "\">");

		out.append("<td>" + hwWiki(o.name) + "</td>");

		// A tick, and a bracketed one for an outfit that is yours but is in
		// the display case, which KoLmafia cannot reach.
		out.append("<td>");
		if (o.owned && o.inCase) out.append("(&#10003;)");
		else if (o.owned) out.append("&#10003;");
		out.append("</td>");

		out.append("<td>");
		if (count(o.treats) == 0) {
			out.append("<span class='none'>nothing &mdash; this outfit has no Halloween yield</span>");
		} else {
			foreach j, t in o.treats {
				item it = t.thing;
				out.append("<div class='drop'>");
				out.append("<img class='icon' src='/images/itemimages/" + it.image
					+ "' onClick='descitem(" + it.descid + ",0,event);'> ");
				out.append(hwWiki(it.name));
				if (t.rate < 1.0) {
					out.append(" <span class='rate'>" + to_string(t.rate * 100, "%.0f") + "%</span>");
				}
				if (t.price > 0) {
					out.append(" <span class='rate'>" + to_string(t.price, "%,d") + " meat</span>");
				}
				string mods = string_modifier("Item:" + it, "Evaluated Modifiers");
				if (mods != "") out.append("<div class='mods'>" + mods + "</div>");
				out.append("</div>");
			}
		}
		out.append("</td>");

		out.append("<td class='num'>"
			+ (o.worth >= 1 ? to_string(o.worth.to_int(), "%,d") : "&mdash;") + "</td>");
		out.append("</tr>");
	}

	out.append("</tbody></table>");

	// Sorting moves the rows rather than redrawing them, so nothing a row is
	// carrying is lost. Every key comes off the row's own data attributes,
	// because the cells hold markup and none of that is what you sort by.
	out.append("<script type='text/javascript'>");
	out.append("(function(){");
	out.append("var body=document.querySelector('#hw tbody');");
	out.append("var box=document.getElementById('ownonly');");
	out.append("var shown=document.getElementById('shown');");
	out.append("var by=null,desc=false;");
	out.append("function key(r,k){return k==='worth'||k==='own'?Number(r.getAttribute('data-'+k))||0:(r.getAttribute('data-'+k)||'');}");
	out.append("function sort(k){desc=(by===k)?!desc:false;by=k;");
	out.append("var rows=[].slice.call(body.rows).map(function(r,i){return {r:r,k:key(r,k),i:i};});");
	out.append("rows.sort(function(a,b){if(a.k<b.k)return desc?1:-1;if(a.k>b.k)return desc?-1:1;return a.i-b.i;});");
	out.append("rows.forEach(function(d){body.appendChild(d.r);});}");
	out.append("document.querySelector('#hw thead').addEventListener('click',function(e){");
	out.append("var th=e.target.closest('th[data-key]');if(th)sort(th.getAttribute('data-key'));});");
	out.append("function apply(){var only=box.checked,n=0;");
	out.append("for(var i=0;i<body.rows.length;i++){var keep=!only||body.rows[i].getAttribute('data-have')==='1';");
	out.append("body.rows[i].style.display=keep?'':'none';if(keep)n++;}");
	out.append("shown.textContent=n+' of '+body.rows.length+' outfits';}");
	out.append("box.addEventListener('change',apply);apply();");
	out.append("})();");
	out.append("</script>");

	out.append("</body></html>");
	out.write();
}
