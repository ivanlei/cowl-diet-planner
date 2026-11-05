// cowl_diet_booze.ash -- the Mafia Wines and Martinis tabs.
//
// Two lists, JSON: every booze KoLmafia flags WINE in inebriety.txt's notes column, and every one
// it flags MARTINI. 112 and 36 of them, and nothing is in both.
//
// WHY THOSE TWO FLAGS AND NOT A LIST OF NAMES. The mafia pinky ring adds adventures to a wine and
// the tuxedo shirt adds them to a martini, and which drinks count is KoLmafia's own answer, kept in
// the table it reads the rest of a booze from. A list here would be 148 names to keep by hand and
// would be wrong the week KoL adds the 149th.
//
// THE FIGURES ARE THE BOOSTED ONES, by the same rule the drinking itself follows: the ring
// equipped or autoPinkyRing set with the ring to hand, Refined Palate up, the shirt equipped or
// autoTuxedo set with the shirt to hand. A page that quoted the unboosted number would be quoting
// adventures nobody is going to get. `boosted` says which of those are in force, so the tab can
// say so rather than leave a reader wondering why the ranges moved.
//
// It reads and nothing else: no request to the mall (historical_price is KoLmafia's record), and
// nothing is bought, drunk or equipped.

import <cowl_diet_assets.ash>

string dietQuoted(string value) {
	string out = value.replace_string("\\", "\\\\").replace_string("\"", "\\\"");
	return "\"" + out.replace_string("\n", " ").replace_string("\r", "")
		.replace_string("\t", " ") + "\"";
}

// --- which drinks these are -------------------------------------------------------------------

boolean dietIsWine(item it) {
	return it.inebriety > 0 && it.notes.contains_text("WINE");
}

boolean dietIsMartini(item it) {
	return it.inebriety > 0 && it.notes.contains_text("MARTINI");
}

// --- what the ring, the Palate and the shirt add ----------------------------------------------
//
// KoLmafia's arithmetic, from ConsumablesDatabase.conditionalAdventures. Written out here rather
// than asked of KoLmafia because KoLmafia answers only for a drink you are about to drink, and
// this is a table of 148 you are not.

boolean dietPinkyRing() {
	item ring = $item[mafia pinky ring];
	if (equipped_amount(ring) > 0) return true;
	return get_property("autoPinkyRing").to_boolean()
		&& can_equip(ring) && available_amount(ring) > 0;
}

boolean dietTuxedo() {
	item shirt = $item[tuxedo shirt];
	if (equipped_amount(shirt) > 0) return true;
	return get_property("autoTuxedo").to_boolean()
		&& can_equip(shirt) && available_amount(shirt) > 0;
}

boolean dietPalate() {
	return have_effect($effect[Refined Palate]) > 0;
}

boolean dietWineBoosted()    { return dietPinkyRing() || dietPalate(); }
boolean dietMartiniBoosted() { return dietTuxedo(); }

// ROUND HALF TO EVEN, which is what Math.rint does and so what KoLmafia does. Not round(): ASH's
// rounds halves up, and the bonus is base/8, so every base of 4, 12, 20 is a tie and lands on one.
// In whole numbers rather than through a float: eighths is the numerator of base/8, so the
// remainder says which side of the half it falls on.
int dietRintEighths(int eighths) {
	int whole = eighths / 8;
	int rest = eighths % 8;
	if (rest < 4) return whole;
	if (rest > 4) return whole + 1;
	return (whole % 2 == 0) ? whole : whole + 1;   // the tie; even wins
}

// The bonus adventures one roll of a wine gains, stacked as KoLmafia stacks them: the Palate's own
// 25% floor first, then the ring's 12.5% rint of whatever the Palate left.
int dietWineBonus(int base) {
	if (!dietWineBoosted()) return 0;
	boolean palate = dietPalate();
	int bonus = 0;
	if (palate) bonus = bonus + (base * 25) / 100;
	if (dietPinkyRing()) {
		int adjusted = palate ? (base * 125) / 100 : base;
		bonus = bonus + dietRintEighths(adjusted);
	}
	return bonus;
}

// THE SHIRT'S BONUS IS 1 TO 3, FLAT, averaging the 2.0 KoLmafia stores. The wiki says 1-3 and means
// it; KoLmafia keeps only the average because one number is all its field can hold. A range field
// can hold both ends, so the range below shows them and the mean below that still agrees with
// KoLmafia -- 1 to 3 averages exactly 2.
int dietMartiniLeast() { return 1; }
int dietMartiniMost()  { return 3; }

// --- the two numbers the table is really about -------------------------------------------------

// The shown range, widened by whatever is boosting it. "" when KoLmafia has no range to widen.
string dietAdvRange(item it) {
	string range = it.adventures;
	if (range == "" || range == "0") return "";

	int dash = range.index_of("-");
	string a = dash < 0 ? range : range.substring(0, dash);
	string b = dash < 0 ? range : range.substring(dash + 1, range.length());
	if (!a.is_integer() || !b.is_integer()) return range;

	int least = a.to_int();
	int most = b.to_int();
	if (dietIsWine(it) && dietWineBoosted()) {
		least = least + dietWineBonus(least);
		most = most + dietWineBonus(most);
	}
	if (dietIsMartini(it) && dietMartiniBoosted()) {
		least = least + dietMartiniLeast();
		most = most + dietMartiniMost();
	}
	return least == most ? least.to_string() : least + "-" + most;
}

// The MEAN adventures one drink gives, boosted. -1 when there is no range to average.
//
// A WINE'S AVERAGE IS NOT THE MIDPOINT OF ITS SHOWN RANGE, and that is not a rounding slip. The
// bonus is a rint of an eighth, so it steps: a 9-12 wine with the ring on rolls 10, 11, 12 or 14 --
// 13 is not reachable -- and the mean of those four is 11.75 where the midpoint of 10 to 14 is 12.
// Averaging the bonus over every roll in the range is what KoLmafia does and is the true figure;
// halving the ends would quote a wine as worth more than it is.
//
// A MARTINI'S AVERAGE *IS* THE MIDPOINT, which is the whole difference between a flat bonus and the
// wine's stepped one: 1 to 3 averages 2 whatever the drink.
//
// ONE DIVISION, AT THE END. Everything is accumulated as hundredths-of-an-adventure times the
// number of rolls -- exact, and well inside an int at these sizes -- and divided once.
float dietAdvMean(item it) {
	string range = it.adventures;
	if (range == "" || range == "0") return -1.0;

	int dash = range.index_of("-");
	string a = dash < 0 ? range : range.substring(0, dash);
	string b = dash < 0 ? range : range.substring(dash + 1, range.length());
	if (!a.is_integer() || !b.is_integer()) return -1.0;

	int least = a.to_int();
	int most = b.to_int();
	int rolls = most - least + 1;
	int numerator = (least + most) * 50 * rolls;

	if (dietIsWine(it) && dietWineBoosted()) {
		int bonusSum = 0;
		for i from least to most {
			bonusSum = bonusSum + dietWineBonus(i);
		}
		numerator = numerator + bonusSum * 100;   // the sum over the rolls is the mean times rolls
	}
	if (dietIsMartini(it) && dietMartiniBoosted()) {
		numerator = numerator + 2 * 100 * rolls;
	}
	return numerator / (rolls * 100.0);
}

// --- what the drink does -----------------------------------------------------------------------

// Names KoLmafia keeps for its own bookkeeping, which say nothing about the effect.
boolean dietModIsNoise(string name) {
	switch (name) {
	case "Last Available":
	case "Wiki Name":
	case "Display Name":
	case "Familiar Effect":
	case "Enchantment Count":
	case "Softcore Only":
	case "Hardcore Only":
	case "Modifiers":
		return true;
	}
	return false;
}

// KoLmafia separates modifiers with ", " and also puts ", " inside quoted values --
// `Familiar Effect: "atk, MP regen, cap 25"` is one modifier, not three -- so this only splits
// outside the quotes.
string [int] dietSplitMods(string evm) {
	string [int] out;
	if (evm == "") return out;
	buffer cur;
	boolean quoted = false;
	int at = 0;
	for i from 0 to evm.length() - 1 {
		string c = evm.substring(i, i + 1);
		if (c == "\"") { quoted = !quoted; cur.append(c); }
		else if (c == "," && !quoted) { out[at] = cur.to_string(); at = at + 1; cur.set_length(0); }
		else cur.append(c);
	}
	if (cur.to_string() != "") out[at] = cur.to_string();
	return out;
}

// An effect's modifiers as plain text: "Item Drop +50%, Meat Drop +25%".
//
// THE PERCENT SIGN IS PUT BACK. KoLmafia writes "Item Drop: +50" and means fifty percent, and
// "Muscle Percent: +15" rather than "Muscle +15%"; printing either verbatim beside a "+5" that
// really is five points of Muscle reads as the same kind of number when it is not.
string dietModText(string evm) {
	buffer out;
	boolean first = true;
	foreach i, raw in dietSplitMods(evm) {
		string t = raw;
		while (t.starts_with(" ")) t = t.substring(1, t.length());
		while (t.ends_with(" ")) t = t.substring(0, t.length() - 1);
		if (t == "") continue;

		int colon = t.index_of(":");
		string name = colon < 0 ? t : t.substring(0, colon);
		string value = colon < 0 ? "" : t.substring(colon + 1, t.length());
		while (value.starts_with(" ")) value = value.substring(1, value.length());
		if (dietModIsNoise(name)) continue;
		if (value != "" && value.to_float() == 0.0 && !value.starts_with("\"")
			&& !value.contains_text("/")) continue;   // "Free Pull: 0" is the absence of the thing

		boolean percent = name.ends_with(" Percent");
		if (percent) name = name.substring(0, name.length() - 8);
		else if (name.ends_with(" Drop") && colon >= 0) percent = true;

		if (value.starts_with("\"") && value.ends_with("\"") && value.length() > 1) {
			value = value.substring(1, value.length() - 1);
		}

		if (!first) out.append(", ");
		out.append(name);
		if (value != "") out.append(" " + value + (percent ? "%" : ""));
		first = false;
	}
	return out.to_string();
}

// What drinking it gets you, as a line of plain text: the effect, how long it lasts, and what it
// does. From the modifier tables rather than from inebriety.txt's notes column, so it cannot drift
// from what the effect actually does -- the notes are a sentence somebody wrote once.
//
// Falling back to the notes when there is no effect, because a few drinks say something there that
// no modifier carries -- "Restores HP", "15 Fishy", "tiny plastic sword".
//
// MAFIA'S OWN FLAGS ARE TAKEN OUT, and recognised by their shape rather than by name: a piece of
// the notes that is nothing but capitals is one of KoLmafia's consumption categories -- WINE,
// MARTINI, BEER, SAUCY, PIZZA, BEANS, LASAGNA, SALAD, TACO, BEVERAGE, CANNED, KOLHS, twelve of
// them today (scanned over all 2,235 notes) -- and not something the drink does. By shape, so the
// thirteenth is covered without this being edited; a real note would have to be written to look
// exactly like a flag before it was lost, and none of them is.
string dietDrinkNote(item it) {
	effect e = effect_modifier(it, "Effect");
	if (e != $effect[none]) {
		int turns = numeric_modifier(it, "Effect Duration").to_int();
		string mods = dietModText(string_modifier("Effect:" + e, "Evaluated Modifiers"));
		string lead = dietPlain(e.to_string()) + (turns > 0 ? " (" + turns + ")" : "");
		return mods == "" ? lead : lead + " — " + mods;
	}

	buffer out;
	boolean first = true;
	foreach i, piece in split_string(it.notes, ", ") {
		if (piece == "") continue;
		matcher flag = create_matcher("^[A-Z][A-Z0-9 ]*$", piece);
		if (flag.find()) continue;
		if (!first) out.append(", ");
		out.append(piece);
		first = false;
	}
	return out.to_string();
}

// --- the rows ------------------------------------------------------------------------------------

// What one costs in the mall: KoLmafia's recorded price, or an NPC store's, or nothing.
//
// historical_price() rather than mall_price(), because this is a table of 148 drinks drawn on
// opening a tab and 148 requests to the mall is not a page load. The Diet tab's own
// "Update prices from the mall" button is the one that asks, and only about what a plan picked.
int dietMallPrice(item it) {
	int p = it.is_tradeable() ? historical_price(it) : 0;
	if (p <= 0 && npc_price(it) > 0) p = npc_price(it);
	return p;
}

string dietBoozeRow(item it) {
	buffer r;
	r.append("{\"name\":" + dietQuoted(dietPlain(it.to_string())));
	r.append(",\"image\":" + dietQuoted(it.image));
	r.append(",\"descid\":" + dietQuoted(it.descid));
	r.append(",\"liver\":" + it.inebriety);
	r.append(",\"base\":" + dietQuoted(it.adventures));
	r.append(",\"range\":" + dietQuoted(dietAdvRange(it)));

	float mean = dietAdvMean(it);
	r.append(",\"mean\":" + (mean < 0.0 ? "null" : to_string(mean, "%.4f")));

	int price = dietMallPrice(it);
	r.append(",\"price\":" + (price > 0 ? price.to_string() : "null"));
	r.append(",\"npc\":" + (it.is_tradeable() ? "false" : (npc_price(it) > 0).to_string()));
	r.append(",\"owned\":" + dietOwned(it));
	r.append(",\"note\":" + dietQuoted(dietDrinkNote(it)));
	r.append("}");
	return r.to_string();
}

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}

	buffer out;
	out.append("{\"ok\":true");
	out.append(",\"boosted\":{\"wine\":" + dietWineBoosted() + ",\"martini\":" + dietMartiniBoosted()
		+ ",\"ring\":" + dietPinkyRing() + ",\"palate\":" + dietPalate()
		+ ",\"tuxedo\":" + dietTuxedo() + "}");

	out.append(",\"wines\":[");
	int n = 0;
	foreach it in $items[] {
		if (!dietIsWine(it)) continue;
		if (n++ > 0) out.append(",");
		out.append(dietBoozeRow(it));
	}
	out.append("]");

	out.append(",\"martinis\":[");
	n = 0;
	foreach it in $items[] {
		if (!dietIsMartini(it)) continue;
		if (n++ > 0) out.append(",");
		out.append(dietBoozeRow(it));
	}
	out.append("]}");
	out.write();
}
