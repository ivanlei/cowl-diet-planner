// cowl_diet_data.ash -- what relay_Diet_Planner.ash plans from.
//
// One answer, JSON: the organs and the things owned that change a diet, and every consumable
// KoLmafia knows with a price. The page does the planning (cowl_diet_plan.js); this only reads.
//
// Prices are historical_price(), KoLmafia's recorded mall price, so there is no request to the
// mall here -- cowl_diet_price.ash is the one that asks, and only about what a plan picked. A
// consumable that can't be traded is priced from its recipe's tradeable ingredients, through a
// recipe this character knows and a kind of crafting that costs no adventure with a chef or
// bartender: cooking, mixing, meatpasting.
//
// Nothing here buys or eats anything.

import <cowl_diet_assets.ash>

record dietLimit {
	string pref;
	int max;
};

string dietQuoted(string value) {
	string out = value.replace_string("\\", "\\\\").replace_string("\"", "\\\"");
	return "\"" + out.replace_string("\n", " ").replace_string("\r", "")
		.replace_string("\t", " ") + "\"";
}

// A price as JSON: null when there isn't one.
string dietPrice(int p) {
	return p > 0 ? p.to_string() : "null";
}

string dietName(item it) {
	return dietQuoted(dietPlain(it.to_string()));
}

// What one costs: the mall's recorded price, an NPC store, or a recipe's parts priced the same way.
// 0 when none of those works.
int dietCost(item it, int depth) {
	int p = it.is_tradeable() ? historical_price(it) : 0;
	if (p <= 0 && npc_price(it) > 0) p = npc_price(it);
	if (p > 0 || it.is_tradeable()) return p;
	if (depth > 4 || get_property("unknownRecipe" + it.to_int()) == "true") return 0;
	string how = craft_type(it);
	if (!how.contains_text("Cook") && !how.contains_text("Mix") && !how.contains_text("Meatpast")) return 0;
	int [item] parts = get_ingredients(it);
	if (count(parts) == 0) return 0;
	int total = 0;
	foreach part, n in parts {
		int c = dietCost(part, depth + 1);
		if (c <= 0) return 0;
		total += c * n;
	}
	return total;
}

// A cleaner, expander or pill-from-the-map, as the planner's SPECIALS list has them: the room it
// gives each organ (negative is room it uses), what kind of consumption it is, uses a day.
string dietSpecial(item it, int s, int l, int p, string kind, int uses) {
	return "{\"name\":" + dietName(it) + ",\"d\":[" + s + "," + l + "," + p + "],\"kind\":\"" + kind
		+ "\",\"adv\":" + dietQuoted(it.adventures) + ",\"uses\":" + uses
		+ ",\"price\":" + dietPrice(historical_price(it)) + "}";
}

string dietExtra(item it, string schedule, string counter) {
	return "{\"name\":" + dietName(it) + ",\"schedule\":[" + schedule + "],\"counter\":"
		+ (counter == "" ? "null" : dietQuoted(counter)) + ",\"price\":" + dietPrice(historical_price(it)) + "}";
}

string dietPart(string name, int amount, string kind) {
	return "{\"name\":" + dietQuoted(name) + ",\"amount\":" + amount + ",\"kind\":\"" + kind + "\"}";
}

// Where an organ's capacity comes from today: {"total", "base", "parts": [{name, amount, kind}]}.
// The path's own base first (today's limit less the whole capacity modifier), then each skill,
// piece of equipment and effect that adds to it, the Stooper if it's out, and what's good for today
// only -- the Feast of Boris and expanders already used (a cuppa Voraci tea, a sweet tooth...).
// "base" is what a plan starts from: the total without those last ones, which the page has
// switches or plan items of its own for.
string dietCapacity(string mod, int total, boolean feast) {
	string [int] parts;
	int listed = 0;
	int notPlanned = 0;
	int base = total - numeric_modifier(mod).to_int();
	parts[0] = dietPart("base", base, "base");
	foreach sk in $skills[] {
		if (!have_skill(sk)) continue;
		int a = numeric_modifier(sk, mod).to_int();
		if (a == 0) continue;
		parts[count(parts)] = dietPart(sk.to_string(), a, "skill");
		listed += a;
	}
	foreach sl in $slots[] {
		item e = equipped_item(sl);
		if (e == $item[none]) continue;
		int a = numeric_modifier(e, mod).to_int();
		if (a == 0) continue;
		parts[count(parts)] = dietPart(dietPlain(e.to_string()), a, "equipment");
		listed += a;
	}
	foreach ef in my_effects() {
		int a = numeric_modifier(ef, mod).to_int();
		if (a == 0) continue;
		parts[count(parts)] = dietPart(ef.to_string(), a, "effect");
		listed += a;
	}
	if (mod == "Liver Capacity" && my_familiar() == $familiar[Stooper]) {
		parts[count(parts)] = dietPart("Stooper", 1, "familiar");
		listed += 1;
		notPlanned += 1;
	}
	if (mod == "Stomach Capacity") {
		int [string] today = {"distention pill": get_property("_distentionPillUsed").to_boolean() ? 1 : 0,
			"lupine appetite hormones": get_property("_lupineHormonesUsed").to_boolean() ? 3 : 0,
			"sweet tooth": get_property("_sweetToothUsed").to_boolean() ? 1 : 0,
			"cuppa Voraci tea": get_property("_voraciTeaUsed").to_boolean() ? 1 : 0,
			"Pantsgiving": get_property("_pantsgivingFullness").to_int()};
		foreach name, a in today {
			if (a == 0) continue;
			parts[count(parts)] = dietPart(name, a, "today");
			listed += a;
			notPlanned += a;
		}
		if (feast) {
			parts[count(parts)] = dietPart("Feast of Boris", 15, "feast");
			listed += 15;
			notPlanned += 15;
		}
	}
	int other = total - base - listed;
	if (other != 0) parts[count(parts)] = dietPart("other", other, "other");
	buffer out;
	out.append("{\"total\":" + total + ",\"base\":" + (total - notPlanned) + ",\"parts\":[");
	foreach i, part in parts {
		if (i > 0) out.append(",");
		out.append(part);
	}
	out.append("]}");
	return out.to_string();
}

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}

	dietLimit [int] limits;
	file_to_map("cowl_diet_limits.txt", limits);

	// Today's limits carry today's extras -- the Feast, the Stooper, expanders already used -- which
	// the page adds back as switches or plan items of its own; a plan starts from what's left.
	boolean feastToday = holiday().contains_text("Feast of Boris") && numeric_modifier("Stomach Capacity") >= 15;
	string stomachCap = dietCapacity("Stomach Capacity", fullness_limit(), feastToday);
	string liverCap = dietCapacity("Liver Capacity", inebriety_limit(), false);
	string spleenCap = dietCapacity("Spleen Capacity", spleen_limit(), false);

	buffer out;
	out.append("{\"ok\":true,\"account\":{");
	out.append("\"capacity\":{\"stomach\":" + stomachCap + ",\"liver\":" + liverCap + ",\"spleen\":" + spleenCap + "}");
	out.append(",\"stooper\":" + have_familiar($familiar[Stooper]));
	// KoLmafia can't see the Pork Elf toilet; having rested with it today is the only sign.
	out.append(",\"toilet\":" + get_property("_porkElfToiletUsed").to_boolean());
	out.append(",\"ode\":" + have_skill($skill[The Ode to Booze]));
	out.append(",\"tuxedo\":" + (available_amount($item[tuxedo shirt]) > 0 && have_skill($skill[Torso Awareness])));
	out.append(",\"ring\":" + (available_amount($item[mafia pinky ring]) > 0));
	out.append(",\"yeti\":" + have_familiar($familiar[Cooler Yeti]));
	out.append(",\"shotglass\":" + (available_amount($item[mime army shotglass]) > 0));
	out.append(",\"gibberer\":" + have_familiar($familiar[Squamous Gibberer]));
	out.append(",\"grimaceMap\":" + (available_amount($item[Map to Safety Shelter Grimace Prime]) > 0));
	out.append(",\"cup\":" + (available_amount($item[Cup of 13s]) > 0));
	out.append(",\"feastToday\":" + feastToday);
	out.append(",\"rollover\":" + numeric_modifier("Adventures").to_int());
	out.append(",\"level\":" + my_level());
	// a saved plan (Save this plan): while there is one, the page shows it and plans nothing
	out.append(",\"locked\":" + dietQuoted(get_property("cowlDietLocked")));
	// how long ago the prices button refreshed the mall's prices, in days; -1 for never
	string refreshed = get_property("cowlDietPricesRefreshed");
	out.append(",\"refreshedAgo\":" + (refreshed == "" ? "-1"
		: to_string((now_to_int() - refreshed.to_int()) / 86400000.0, "%.4f")));
	out.append("}");

	// Bought at the clan Speakeasy, at its prices, if the clan has one.
	int [item] speakeasy;
	boolean lounge = get_clan_lounge() contains $item[Clan speakeasy];
	int [int] speakeasyPrices = {7589: 250, 7590: 250, 7591: 250, 7592: 500, 7593: 500, 7594: 500,
		7595: 500, 7596: 5000, 7597: 10000, 7598: 20000, 7599: 100000};
	foreach id, p in speakeasyPrices speakeasy[id.to_item()] = p;

	// Planned separately: cleaners and expanders, Legendary Digestion's dishes, and helpers.
	boolean [item] separate = $items[Mr. Burnsger, The Plumber's mushroom stew, Doc Clock's thyme cocktail,
		The Mad Liquor, extra-greasy slider, jar of fermented pickle juice, spice melange, cuppa Voraci tea,
		cuppa Sobrie tea, sweet tooth, lupine appetite hormones, mojo filter, dieting pill, toasted brie,
		Frutti di Scatoletta, Pesto alla Marziano, Arrattabbattabiata, Orzo di Riso, Pasta Grimavera,
		Linguini Ubriacapa, Formica e Pepe, Tubetto Gelatto, Gnocci Domani, munchies pill];
	boolean [string] pathOnly = $strings[Vampyre, Zombie Slayer, KOLHS, Undrinkable, Inedible];

	out.append(",\"menu\":[");
	int n = 0;
	foreach it in $items[] {
		int full = it.fullness;
		int drunk = it.inebriety;
		int chew = it.spleen;
		int organs = (full > 0 ? 1 : 0) + (drunk > 0 ? 1 : 0) + (chew > 0 ? 1 : 0);
		if (organs != 1 || separate contains it || it.levelreq > my_level()) continue;  // none, or two at once
		string adv = it.adventures;
		if (adv == "" || adv == "0" || adv.starts_with("-")) continue;
		if (pathOnly contains it.notes) continue;
		int price;
		if (speakeasy contains it) {
			if (!lounge) continue;
			price = speakeasy[it];
		} else {
			price = dietCost(it, 0);
		}
		if (price <= 0) continue;
		string group = "null";
		string cap = "null";
		if (limits contains it.to_int()) {
			dietLimit l = limits[it.to_int()];
			if (!l.pref.starts_with("_")) continue;  // once an ascension: not something to plan a day on
			group = dietQuoted(l.pref);
			cap = l.max.to_string();
		}
		if (n++ > 0) out.append(",");
		out.append("{\"name\":" + dietName(it));
		out.append(",\"organ\":\"" + (full > 0 ? "stomach" : drunk > 0 ? "liver" : "spleen") + "\"");
		out.append(",\"size\":" + (full > 0 ? full : drunk > 0 ? drunk : chew));
		out.append(",\"adv\":" + dietQuoted(adv) + ",\"notes\":" + dietQuoted(it.notes));
		out.append(",\"price\":" + price + ",\"group\":" + group + ",\"cap\":" + cap);
		// how old KoLmafia's price is, in days, for what the mall sells
		if (it.is_tradeable() && !(speakeasy contains it)) {
			out.append(",\"age\":" + to_string(min(historical_age(it), 9999.0), "%.4f"));
		}
		out.append("}");
	}
	out.append("]");

	out.append(",\"helpers\":{");
	string [item] helpers = {$item[milk of magnesium]: "milk of magnesium", $item[fudge spork]: "fudge spork",
		$item[Ol' Scratch's salad fork]: "Ol' Scratch's salad fork", $item[Frosty's frosty mug]: "Frosty's frosty mug",
		$item[whet stone]: "whet stone", $item[mini kiwi aioli]: "mini kiwi aioli",
		$item[Special Seasoning]: "Special Seasoning", $item[munchies pill]: "munchies pill",
		$item[toasted brie]: "toasted brie", $item[pocket wish]: "pocket wish",
		$item[potion of the field gar]: "potion of the field gar"};
	n = 0;
	foreach it, key in helpers {
		if (n++ > 0) out.append(",");
		out.append(dietQuoted(key) + ":" + dietPrice(historical_price(it)));
	}
	out.append("}");

	out.append(",\"specials\":[");
	out.append(dietSpecial($item[Mr. Burnsger], -4, 2, 0, "food", 1) + ",");
	out.append(dietSpecial($item[The Plumber's mushroom stew], -3, 1, 0, "food", 1) + ",");
	out.append(dietSpecial($item[Doc Clock's thyme cocktail], 2, -4, 0, "booze", 1) + ",");
	out.append(dietSpecial($item[The Mad Liquor], 1, -3, 0, "booze", 1) + ",");
	out.append(dietSpecial($item[extra-greasy slider], -5, 0, 5, "food", 1) + ",");
	out.append(dietSpecial($item[jar of fermented pickle juice], 0, -5, 5, "booze", 1) + ",");
	out.append(dietSpecial($item[spice melange], 3, 3, 0, "use", 1) + ",");
	out.append(dietSpecial($item[cuppa Voraci tea], 1, 0, 0, "use", 1) + ",");
	out.append(dietSpecial($item[cuppa Sobrie tea], 0, 1, 0, "use", 1) + ",");
	out.append(dietSpecial($item[sweet tooth], 1, 0, 0, "use", 1) + ",");
	if (my_level() >= 15) out.append(dietSpecial($item[lupine appetite hormones], 3, 0, 0, "use", 1) + ",");
	out.append(dietSpecial($item[mojo filter], 0, 0, 1, "use", 3));
	out.append("]");

	out.append(",\"noodles\":[");
	n = 0;
	foreach it in $items[Frutti di Scatoletta, Pesto alla Marziano, Arrattabbattabiata, Orzo di Riso, Pasta Grimavera,
		Linguini Ubriacapa, Formica e Pepe, Tubetto Gelatto, Gnocci Domani] {
		if (n++ > 0) out.append(",");
		out.append("{\"name\":" + dietName(it) + ",\"adv\":" + dietQuoted(it.adventures)
			+ ",\"price\":" + dietPrice(historical_price(it)) + "}");
	}
	out.append("]");

	// Organ-free adventures. Chocolates share one counter; your own class's is worth more.
	item [class] classChocolate = {$class[Seal Clubber]: $item[chocolate seal-clubbing club],
		$class[Turtle Tamer]: $item[chocolate turtle totem], $class[Pastamancer]: $item[chocolate pasta spoon],
		$class[Sauceror]: $item[chocolate saucepan], $class[Disco Bandit]: $item[chocolate disco ball],
		$class[Accordion Thief]: $item[chocolate stolen accordion]};
	out.append(",\"extras\":[");
	out.append(dietExtra($item[fancy chocolate], "5,3,1", "choc") + ",");
	out.append(dietExtra($item[fancy chocolate car], "5,3,1", "choc") + ",");
	foreach c, it in classChocolate {
		out.append(dietExtra(it, c == my_class() ? "3,2,1" : "2,1", "choc") + ",");
	}
	out.append(dietExtra($item[fancy chocolate sculpture], "5,3,1", "") + ",");
	out.append(dietExtra($item[vitachoconutriment capsule], "5,3,1", "") + ",");
	out.append(dietExtra($item[clock], "3,2", "") + ",");
	out.append(dietExtra($item[essential tofu], "5", "") + ",");
	out.append(dietExtra($item[extra time], "5,3,1", "") + ",");
	out.append(dietExtra($item[Twelve Night Energy], "12", "") + ",");
	out.append(dietExtra($item[brain preservation fluid], "5", "") + ",");
	out.append(dietExtra($item[resolution: be more adventurous], "2,2,2,2,2", ""));
	out.append("]");

	// The Cup of 13s: a drink worth the sum of three ingredients' tiers, up to 13 adventures a day.
	// The three cheapest priced ingredients of each tier, so a market the price check finds empty
	// can fall back to the next.
	item [int, int] cheapest;
	foreach it in $items[] {
		int tier = cup_of_13s_tier(it);
		if (tier < 2 || !it.is_tradeable() || historical_price(it) <= 0) continue;
		int at = count(cheapest[tier]);
		cheapest[tier][at] = it;
		// keep the three cheapest: insert, then drop the dearest
		for (int i = at; i > 0 && historical_price(cheapest[tier][i]) < historical_price(cheapest[tier][i - 1]); i--) {
			item swap = cheapest[tier][i - 1];
			cheapest[tier][i - 1] = cheapest[tier][i];
			cheapest[tier][i] = swap;
		}
		if (count(cheapest[tier]) > 3) remove cheapest[tier][3];
	}
	out.append(",\"cup\":{\"gems\":13,\"tiers\":{");
	n = 0;
	foreach tier in cheapest {
		if (n++ > 0) out.append(",");
		out.append("\"" + tier + "\":[");
		foreach i, it in cheapest[tier] {
			if (i > 0) out.append(",");
			out.append("{\"name\":" + dietName(it) + ",\"price\":" + historical_price(it) + "}");
		}
		out.append("]");
	}
	out.append("}}");

	out.append(",\"pill\":" + dietPrice(historical_price($item[dieting pill])));
	out.append(",\"transponder\":" + dietPrice(historical_price($item[transporter transponder])));
	out.append("}");
	out.write();
}
