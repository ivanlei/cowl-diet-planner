// cowl_diet_rollover.ash -- what the Diet Planner's rollover section draws from.
//
// One answer, JSON:
//
// - every piece of equipment with +Adventures at rollover, by slot, with what it adds in December
//   (a few say so in their modifiers: the perfect Christmas scarf is [+9*event(December)], so
//   asking KoLmafia in October would answer 0), how many you own, whether it can be bought, and the
//   rules that limit it: single-equip, a watch (only one watch counts), two hands;
// - outfits whose bonus adds adventures, and their pieces;
// - your familiars (the Disembodied Hand holds a weapon, the Left-Hand Man an off-hand);
// - what you're wearing now, and the choices saved last time (the cowlDietRollover preference);
// - the campground and Chateau items that add adventures, installed or worth installing; the
//   clan Rumpus Room's adventure furniture, which since 2025 is a daily click, not rollover;
// - passive skills that add adventures, and today's banks (Circadian Rhythms, the Squamous
//   Gibberer, the Wild Hare, resolutions).
//
// It reads and nothing else; cowl_diet_save.ash keeps the choices.

import <cowl_diet_assets.ash>

string dietQuoted(string value) {
	string out = value.replace_string("\\", "\\\\").replace_string("\"", "\\\"");
	return "\"" + out.replace_string("\n", " ").replace_string("\r", "")
		.replace_string("\t", " ") + "\"";
}

string dietName(item it) {
	return dietQuoted(dietPlain(it.to_string()));
}

// The expression behind an item's +Adventures, when it is one: "+9*event(December)".
string dietAdvExpression(item it) {
	matcher m = create_matcher("Adventures: \\[([^\\]]*)\\]", string_modifier(it, "Modifiers"));
	return m.find() ? m.group(1) : "";
}

// What an item adds to rollover in December. Where its modifier is a formula, the figure it reaches
// on a December night: the December number, 10 for stinky cheese worn through 100 fights that day,
// 5 for the time halo with no weapon. Otherwise what KoLmafia evaluates now.
int dietRolloverAdv(item it) {
	string expr = dietAdvExpression(it);
	if (expr.contains_text("event(December)")) {
		matcher m = create_matcher("if\\(event\\(December\\),(\\d+)", expr);
		if (m.find()) return m.group(1).to_int();
		m = create_matcher("\\+?(\\d+)\\*event\\(December\\)", expr);
		if (m.find()) return m.group(1).to_int();
	}
	if (expr.contains_text("_stinkyCheeseCount")) return 10;
	if (expr.contains_text("unarmed")) {
		matcher m = create_matcher("(\\d+)\\*unarmed", expr);
		if (m.find()) return m.group(1).to_int();
	}
	return numeric_modifier(it, "Adventures").to_int();
}

// What the page says about a formula, in words.
string dietAdvNote(item it) {
	string expr = dietAdvExpression(it);
	if (expr == "") return "";
	if (expr.contains_text("event(December)")) return "in December";
	if (expr.contains_text("_stinkyCheeseCount")) return "after 100 fights in stinky cheese that day";
	if (expr.contains_text("unarmed")) return "with no weapon";
	if (expr == "G") return "with Grimace's light, 0 to 5";
	matcher m = create_matcher("skill\\(([^)]*)\\)", expr);
	if (m.find()) return "more with " + m.group(1);
	return "";
}

// Which familiar a piece of familiar equipment is for, or "" for any.
string dietFamiliarFor(item it) {
	string on = string_modifier(it, "Equips On");
	if (on != "") return on;
	foreach f in $familiars[] if (familiar_equipment(f) == it) return f.to_string();
	return "";
}

// One campground, Chateau or maid entry.
string dietHome(item it, boolean have, string kind, string note) {
	return "{\"name\":" + dietName(it) + ",\"adv\":" + dietRolloverAdv(it) + ",\"have\":" + have
		+ ",\"kind\":\"" + kind + "\",\"note\":" + dietQuoted(note)
		+ ",\"image\":" + dietQuoted(it.image) + ",\"descid\":" + dietQuoted(it.descid)
		+ ",\"tradeable\":" + it.is_tradeable() + "}";
}

string dietSlotName(item it) {
	slot s = to_slot(it);
	if (s == $slot[acc1] || s == $slot[acc2] || s == $slot[acc3]) return "acc";
	if (s == $slot[off-hand]) return "offhand";
	return s.to_string();
}

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}
	buffer out;
	out.append("{\"ok\":true,\"gear\":[");
	int n = 0;
	foreach it in $items[] {
		if (to_slot(it) == $slot[none]) continue;
		if (numeric_modifier(it, "Adventures") == 0 && dietAdvExpression(it) == "") continue;
		int adv = dietRolloverAdv(it);
		if (adv <= 0) continue;
		if (n++ > 0) out.append(",");
		out.append("{\"name\":" + dietName(it) + ",\"slot\":\"" + dietSlotName(it) + "\",\"adv\":" + adv);
		out.append(",\"note\":" + dietQuoted(dietAdvNote(it)));
		out.append(",\"owned\":" + dietOwned(it) + ",\"image\":" + dietQuoted(it.image)
			+ ",\"descid\":" + dietQuoted(it.descid));
		out.append(",\"tradeable\":" + it.is_tradeable());
		if (to_slot(it) == $slot[familiar]) out.append(",\"for\":" + dietQuoted(dietFamiliarFor(it)));
		out.append(",\"single\":" + boolean_modifier(it, "Single Equip"));
		out.append(",\"watch\":" + boolean_modifier(it, "Nonstackable Watch"));
		out.append(",\"daily\":" + boolean_modifier(it, "Lasts Until Rollover"));
		out.append(",\"hands\":" + (to_slot(it) == $slot[weapon] ? weapon_hands(it) : 0) + "}");
	}
	out.append("]");

	out.append(",\"outfits\":[");
	n = 0;
	foreach i, name in all_normal_outfits() {
		int adv = numeric_modifier("Outfit:" + name, "Adventures").to_int();
		if (adv <= 0) continue;
		if (n++ > 0) out.append(",");
		out.append("{\"name\":" + dietQuoted(name) + ",\"adv\":" + adv + ",\"pieces\":[");
		// every piece, the ones that add nothing themselves too: the bonus needs them all
		foreach j, piece in outfit_pieces(name) {
			if (j > 0) out.append(",");
			out.append("{\"name\":" + dietName(piece) + ",\"slot\":\"" + dietSlotName(piece) + "\",\"owned\":"
				+ dietOwned(piece) + ",\"tradeable\":" + piece.is_tradeable() + "}");
		}
		out.append("]}");
	}
	out.append("]");

	out.append(",\"familiars\":[");
	n = 0;
	foreach f in $familiars[] {
		if (!have_familiar(f)) continue;
		if (n++ > 0) out.append(",");
		out.append(dietQuoted(f.to_string()));
	}
	out.append("]");

	out.append(",\"wearing\":{");
	string [slot] slotNames = {$slot[hat]: "hat", $slot[back]: "back", $slot[shirt]: "shirt", $slot[weapon]: "weapon",
		$slot[off-hand]: "offhand", $slot[pants]: "pants", $slot[acc1]: "acc1", $slot[acc2]: "acc2", $slot[acc3]: "acc3",
		$slot[familiar]: "famequip"};
	n = 0;
	foreach sl, key in slotNames {
		item e = equipped_item(sl);
		if (e == $item[none]) continue;
		if (n++ > 0) out.append(",");
		out.append("\"" + key + "\":" + dietName(e));
	}
	if (my_familiar() != $familiar[none]) out.append((n > 0 ? "," : "") + "\"familiar\":" + dietQuoted(my_familiar().to_string()));
	out.append("}");
	out.append(",\"saved\":" + dietQuoted(get_property("cowlDietRollover")));
	out.append(",\"dualWield\":" + have_skill($skill[Double-Fisted Skull Smashing]));

	// Campground and Chateau: what's installed that adds adventures, and the options worth having.
	int [item] campground = get_campground();
	int [item] chateau = get_chateau();
	boolean [item] maids = $items[portable housekeeping robot, clockwork maid, Meat maid, Meat Butler];
	boolean [item] dwelling = $items[cuckoo clock, pagoda plans, Crimbo candle, artificial skylight];
	out.append(",\"campground\":[");
	n = 0;
	foreach it in maids {
		if (n++ > 0) out.append(",");
		out.append(dietHome(it, campground contains it, "maid", "one maid at a time"));
	}
	foreach it in dwelling {
		boolean skylight = it == $item[artificial skylight];
		out.append("," + dietHome(it, campground contains it || chateau contains it, skylight ? "chateau" : "campground",
			it == $item[Crimbo candle] ? "in December" : skylight ? "a Chateau Mantegna ceiling" : ""));
	}
	// anything else installed that adds adventures
	foreach it in campground {
		if (maids contains it || dwelling contains it || dietRolloverAdv(it) <= 0) continue;
		out.append("," + dietHome(it, true, "campground", ""));
	}
	foreach it in chateau {
		if (dwelling contains it || dietRolloverAdv(it) <= 0) continue;
		out.append("," + dietHome(it, true, "chateau", ""));
	}
	out.append("]");

	// The clan Rumpus Room: adventure furniture is a daily click now, not rollover.
	int [string] rumpus = get_clan_rumpus();
	out.append(",\"rumpus\":[");
	n = 0;
	int [string] furniture = {"Girls of Loathing Calendar": 3, "Boys of Loathing Calendar": 3,
		"Collection of Self-Help Books": 5, "Inspirational Desk Calendar": 1};
	foreach name, adv in furniture {
		boolean have = false;
		foreach key in rumpus if (key.contains_text(name)) have = true;
		if (n++ > 0) out.append(",");
		out.append("{\"name\":" + dietQuoted(name) + ",\"adv\":" + adv + ",\"have\":" + have + "}");
	}
	out.append("]");

	out.append(",\"skills\":[");
	n = 0;
	foreach sk in $skills[] {
		if (!have_skill(sk)) continue;
		int adv = numeric_modifier(sk, "Adventures").to_int();
		if (adv == 0) continue;
		if (n++ > 0) out.append(",");
		out.append("{\"name\":" + dietQuoted(sk.to_string()) + ",\"adv\":" + adv + "}");
	}
	out.append("]");

	out.append(",\"today\":{\"total\":" + numeric_modifier("Adventures").to_int());
	out.append(",\"circadianAdv\":" + get_property("_circadianRhythmsAdventures").to_int());
	out.append(",\"gibbererAdv\":" + get_property("_gibbererAdv").to_int());
	out.append(",\"hareAdv\":" + get_property("_hareAdv").to_int());
	out.append(",\"resolutionAdv\":" + get_property("_resolutionAdv").to_int());
	out.append(",\"potatoClock\":" + (available_amount($item[potato alarm clock]) > 0));
	out.append(",\"circadian\":" + have_skill($skill[Just the Facts]));
	out.append(",\"gibberer\":" + have_familiar($familiar[Squamous Gibberer]));
	out.append("}}");
	out.write();
}
