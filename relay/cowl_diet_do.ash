// cowl_diet_do.ash -- carrying a locked plan out, a row at a time.
//
// The rest of the Diet Planner works out the best day a budget buys and shows it as a table. This
// is the half that does it, and it is the only script here that will ever eat, drink or cast
// anything. So far it only looks:
//
//   action=open    take the locked plan's rows from the page, keep them, and say what was kept
//   action=check   where every kept row stands: done, ready, held, yours, or impossible
//   action=reset   forget today's progress
//
// WHY THE ROWS ARE HANDED OVER RATHER THAN READ. The locked plan is already a complete, computed
// row list, sitting in the cowlDietLocked preference where cowl_diet.js put it -- which is exactly
// what a script carrying it out wants, and much better than planning again and hoping for the same
// answer. It is JSON, though, and ASH cannot read JSON: to_json() goes the one way, and
// hand-rolling a parser for a structure full of item names (apostrophes, trademark signs, the
// occasional quotation mark) is a bug with a liver riding on it.
//
// So the page, which has the locked plan parsed already, hands the rows over once in a shape this
// script can read, and they are kept in cowlDietSteps. Everything afterwards works off that kept
// copy rather than off anything a browser says, which is the property that matters: the table
// ticking off in front of you is drawn from the same list the eating will be done from.
//
// What stops the page handing over a list belonging to some other plan is the lock's own
// timestamp. cowl_diet.js stamps every locked snapshot with `at`, and open refuses an `at` that
// does not appear in the currently locked plan -- a substring test, which needs no parser and
// cannot be satisfied by a number the page invented. Re-locking produces a new `at`, which
// invalidates both the kept rows and the day's progress, loudly.
//
// WHY THE PROGRESS LEDGER STARTS WITH AN UNDERSCORE. KoLmafia clears `_`-prefixed preferences at
// rollover, so _cowlDietDone resets itself and yesterday's half-eaten day cannot tick off today's.
// It holds a count per row rather than a tick, because `drink 3 x wine` can put two down and fail
// on the third, and a retry should drink the one that is left rather than three more.
//
// AND WHY IT IS NEVER THE AUTHORITY. The ledger is a record of what this script did. What actually
// happened is a question for KoLmafia, and every judgement below asks it: a once-a-day thing by its
// own preference, a cast by how long the effect has left, an equip by what is worn, an eat or drink
// by the organ's fill. Where the two disagree the game wins and the row says so, because that
// disagreement is precisely the symptom a bug in this script produces, and smoothing it over would
// hide the one thing worth seeing.

import <cowl_diet_assets.ash>

// Where the kept rows and the day's progress live.
string DIET_STEPS = "cowlDietSteps";      // the rows, as records
string DIET_STEPS_AT = "cowlDietStepsAt"; // the locked plan they came from
string DIET_DONE = "_cowlDietDone";       // today's progress, cleared at rollover

// Records are separated by "|", fields by "^", and a Cup of 13s' three ingredients by "~". None of
// the three occurs in the name of any item, skill, effect or familiar KoLmafia knows, which is the
// whole reason for choosing them; "|" is also what cowl_diet_shelf.ash already uses for a list of
// item names coming the other way.
string STEP_SEP = "|";
string FIELD_SEP = "^";
string MIX_SEP = "~";

record dietStep {
	string phase;    // "start" or "end": the two halves the buttons walk
	string action;   // eat, drink, chew, use, cast, equip
	string kind;     // item, skill, familiar, campground
	string name;
	int count;
	boolean nightcap; // the one drink meant to take you past your limit
	string mix;       // a Cup of 13s' three ingredients, "~"-separated
	// What the row costs each organ, for all count of it, as the plan worked it out. Carried rather
	// than read back off the item, because the item does not know: a drink through the mime army
	// shotglass costs no liver at all, a Cup of 13s is 1 drunk although the Cup itself is an
	// off-hand with no drunkenness, a food under a dieting pill fills twice its fullness, a
	// legendary noodle dish that digests with its spleen nets no fullness, and the Pork Elf toilet
	// gives a point back. Every one of those is in the plan's own numbers and in none of KoLmafia's.
	int full;
	int drunk;
	int spleen;
};

record dietVerdict {
	string state;  // done, part, ready, held, you, no
	string said;
};

string dietQuoted(string value) {
	string out = value.replace_string("\\", "\\\\").replace_string("\"", "\\\"");
	return "\"" + out.replace_string("\n", " ").replace_string("\r", "").replace_string("\t", " ") + "\"";
}

// An item by name, and only the item that name actually names.
//
// to_item() matches loosely, which everywhere else in this repository is a convenience and here is
// a hazard: a name this script half-recognises becomes a thing it eats. "clock" is a real item and
// so is "chewing gum on a string", and the distance between a near miss and the right answer is a
// turn, a point of fullness, or 40,000 meat. So the answer is checked back against the question --
// through dietPlain on both sides, since a plan's names have had their HTML entities decoded and
// KoLmafia's own tables have not (it keeps "Newbiesport&trade; tent" exactly as KoL gave it).
item dietExactItem(string name) {
	item it = name.to_item();
	if (it == $item[none]) return it;
	if (dietPlain(it.to_string()) != dietPlain(name)) return $item[none];
	return it;
}

// --- the kept rows ---------------------------------------------------------

dietStep [int] dietReadSteps() {
	dietStep [int] steps;
	string kept = get_property(DIET_STEPS);
	if (kept == "") return steps;
	foreach i, rec in kept.split_string("\\|") {
		if (rec == "") continue;
		string [int] f = rec.split_string("\\^");
		if (count(f) < 10) continue;
		steps[count(steps)] = new dietStep(f[0], f[1], f[2], f[3], f[4].to_int(), f[5] == "nightcap", f[6],
			f[7].to_int(), f[8].to_int(), f[9].to_int());
	}
	return steps;
}

// Today's progress: how many of each row are done. Empty when the ledger belongs to another plan,
// which is the case every time a plan is unlocked and locked again.
int [int] dietReadDone() {
	int [int] done;
	string said = get_property(DIET_DONE);
	if (said == "") return done;
	int colon = said.index_of(":");
	if (colon < 0) return done;
	if (said.substring(0, colon) != get_property(DIET_STEPS_AT)) return done;
	foreach i, one in said.substring(colon + 1).split_string(",") {
		if (one == "") continue;
		string [int] parts = one.split_string("\\*");
		if (count(parts) != 2) continue;
		done[parts[0].to_int()] = parts[1].to_int();
	}
	return done;
}

// "" when there is no ledger, "ok" when it is this plan's, "stale" when it is some other plan's --
// which the page says out loud rather than quietly starting the day again.
string dietDoneState() {
	string said = get_property(DIET_DONE);
	if (said == "") return "";
	int colon = said.index_of(":");
	if (colon < 0) return "stale";
	return said.substring(0, colon) == get_property(DIET_STEPS_AT) ? "ok" : "stale";
}

// --- what is left to do, which two judgements need --------------------------

// What one of a row costs the organ. A row's numbers are for all count of it.
int dietPer(int room, int count) {
	return count > 0 ? room / count : room;
}

// The drunkenness still to come, for sizing the Ode.
//
// Ode to Booze pays an adventure per point of drunkenness and pays it out of its own duration, so
// it is not enough for the Ode to be alive when the next drink goes down -- it has to still be
// alive at the last one. Counted over every drink not yet done, the nightcap included, since that
// one is six points on its own.
//
// A drink through the mime army shotglass contributes nothing here, which is right for the Ode as
// well as for the liver: no drunkenness, no extra adventure, nothing off the Ode's duration.
int dietDrunkToCome(dietStep [int] steps, int [int] done) {
	int total = 0;
	foreach i, s in steps {
		if (s.action != "drink") continue;
		int left = s.count - (done contains i ? done[i] : 0);
		if (left <= 0) continue;
		total += left * dietPer(s.drunk, s.count);
	}
	return total;
}

// --- judging one row -------------------------------------------------------

// How many of something Grab supplies could fetch: the closet, the display case's shelf, and
// Hagnk's when taking from it is free. Not what is worn, which is no use to a meal, and not the
// mall, which this tab will never buy from.
int dietFetchable(item it) {
	return it.closet_amount() + it.display_amount() + (can_interact() ? it.storage_amount() : 0);
}

string dietWhereElse(item it) {
	string said;
	if (it.closet_amount() > 0) said += (said == "" ? "" : ", ") + it.closet_amount() + " in your closet";
	if (can_interact() && it.storage_amount() > 0) said += (said == "" ? "" : ", ") + it.storage_amount() + " in Hagnk's";
	if (it.display_amount() > 0) said += (said == "" ? "" : ", ") + it.display_amount() + " in your display case";
	return said;
}

int dietRoomPer(dietStep s, int organ) {
	int room = organ == 0 ? s.full : (organ == 1 ? s.drunk : s.spleen);
	return dietPer(room, s.count);
}

// What to say when today's progress claims a row is done and the game says otherwise.
//
// Reported rather than smoothed over, and reported as something still to do, because that is what
// it is. This is the shape a bug in this script takes -- a step recorded as done that did not
// happen, or one that happened twice -- so hiding it would hide the only evidence.
dietVerdict dietDisagrees(string said) {
	return new dietVerdict("ready", "today's progress says this was done, but " + said);
}

dietVerdict dietJudgeSkill(dietStep s, int toCome, int done) {
	skill sk = s.name.to_skill();
	if (sk == $skill[none] || sk.to_string() != s.name) {
		return new dietVerdict("no", "KoLmafia has no skill by that name");
	}
	if (!have_skill(sk)) return new dietVerdict("no", "you don't know it");

	// The Ode is sized rather than simply cast.
	//
	// It pays an adventure per point of drunkenness out of its own duration, so it has to be long
	// enough to still be alive at the last drink of the day, not merely alive at the first. A cast
	// is ten turns with a good accordion and a day's drinking is often a good deal more than
	// that -- a 500,000-meat day here spends 27 -- so what the row wants is as many casts as cover
	// what is left to drink. Which is also why this is counted off the drinks still to come rather
	// than off the plan's total: come back to a half-drunk day and the answer is smaller.
	if (sk == $skill[The Ode to Booze]) {
		int up = have_effect($effect[Ode to Booze]);
		if (toCome <= 0) return new dietVerdict("done", "nothing left to drink for it to pay on");
		if (up >= toCome) {
			return new dietVerdict("done", "already up for " + up + " turns, which covers the "
				+ toCome + " drunkenness still to come");
		}
		int per = turns_per_cast(sk);
		if (per < 1) return new dietVerdict("no", "KoLmafia says a cast would be no turns at all");
		int casts = (toCome - up + per - 1) / per;
		int mp = casts * mp_cost(sk);
		if (done >= s.count) {
			return dietDisagrees("the Ode is up for " + up + " turns and the drinks still to come spend "
				+ toCome + ", so it wants " + casts + " more " + (casts == 1 ? "cast" : "casts"));
		}
		if (my_mp() < mp) {
			return new dietVerdict("held", casts + (casts == 1 ? " cast" : " casts") + " at " + per
				+ " turns covers the " + toCome + " drunkenness to come, which is " + mp + " MP, and you have "
				+ my_mp());
		}
		return new dietVerdict("ready", casts + (casts == 1 ? " cast" : " casts") + " at " + per
			+ " turns, " + mp + " MP, to cover the " + toCome + " drunkenness still to come");
	}

	if (my_mp() < mp_cost(sk)) {
		return new dietVerdict("held", "costs " + mp_cost(sk) + " MP and you have " + my_mp());
	}
	return new dietVerdict("ready", mp_cost(sk) + " MP");
}

dietVerdict dietJudgeFamiliar(dietStep s, int done) {
	familiar fam = s.name.to_familiar();
	if (fam == $familiar[none] || fam.to_string() != s.name) {
		return new dietVerdict("no", "KoLmafia has no familiar by that name");
	}
	if (!have_familiar(fam)) return new dietVerdict("no", "you don't have one");
	if (fam == $familiar[Cooler Yeti]) {
		if (get_property("_coolerYetiAdventures").to_boolean()) {
			return new dietVerdict("done", "it has already made a drink impossibly cold today");
		}
		// 400 familiar experience is what the conversation costs, and a familiar's weight is the
		// square root of its experience, so asking for 20 pounds is asking whether it can be
		// afforded at all.
		if (done >= s.count) {
			return dietDisagrees("KoLmafia has not seen it make a drink impossibly cold today");
		}
		int pounds = familiar_weight(fam);
		if (pounds < 20) {
			return new dietVerdict("held", "it weighs " + pounds + " lb, and impossibly cold costs "
				+ "400 experience, which is 20 lb");
		}
		return new dietVerdict("ready", "take it out and ask for impossibly cold");
	}
	if (done >= s.count) return new dietVerdict("done", "done");
	return new dietVerdict("ready", "take it out");
}

dietVerdict dietJudgeCampground(dietStep s, int done) {
	if (s.name != "Pork Elf toilet") return new dietVerdict("you", "no way to do this one from here");
	if (get_property("_porkElfToiletUsed").to_boolean()) {
		return new dietVerdict("done", "the toilet's digesting is done for today");
	}
	if (done >= s.count) {
		return dietDisagrees("_porkElfToiletUsed is still false, so KoLmafia has not seen a rest "
			+ "take a point of fullness off today");
	}
	// The wiki's rule, and worth refusing on rather than resting anyway: under 2 fullness there is
	// no message, no fullness comes off, and the daily charge is not even spent.
	if (my_fullness() < 2) {
		return new dietVerdict("held", "it wants 2 fullness to work and you have " + my_fullness()
			+ "; eat first");
	}
	int free = total_free_rests() - get_property("timesRested").to_int();
	string rests = free > 0 ? free + " free rests left" : "no free rests left, so this costs an adventure";
	// KoL will not rest you when you need nothing, and KoLmafia will not even ask: full HP and full
	// MP and not Beaten Up is a refusal on both sides. Burning a little MP first is the way round
	// it, and on any day with drinks in it the plan's own Ode cast is already that burn.
	if (my_hp() == my_maxhp() && my_mp() == my_maxmp()) {
		return new dietVerdict("ready", "HP and MP are both full, so a rest would be refused: "
			+ "something has to spend MP first. " + rests);
	}
	return new dietVerdict("ready", rests);
}

dietVerdict dietJudgeItem(dietStep s, int need, int done) {
	item it = dietExactItem(s.name);
	if (it == $item[none]) return new dietVerdict("no", "KoLmafia has no item by that name");

	// A wish's target is not in the row -- only the effect's name, in prose, in the note -- and
	// guessing what to wish for with a charge that costs real meat is not a thing to automate.
	if (it == $item[pocket wish]) {
		return new dietVerdict("you", "make the wish yourself, then mark this done");
	}

	if (s.action == "equip") {
		if (it.equipped_amount() > 0) return new dietVerdict("done", "you're wearing it");
		if (done >= s.count) return dietDisagrees("you aren't wearing it");
		if (it.item_amount() < 1) {
			string where = dietWhereElse(it);
			if (dietFetchable(it) > 0) return new dietVerdict("held", "it's not to hand: " + where);
			return new dietVerdict("no", "you don't have one");
		}
		if (!it.can_equip()) return new dietVerdict("no", "you can't wear it");
		return new dietVerdict("ready", "");
	}

	// The Cup is mixed from three things rather than drunk out of inventory, so what has to be to
	// hand is the Cup and the three, not a drink.
	if (dietPlain(it.to_string()) == "Cup of 13s") {
		// The Cup is an off-hand, and the thing that opens it is a link on the inventory page -- so
		// one that is being worn is one the link is not next to. Worth saying plainly, because the
		// Cup spends most of its life equipped.
		if (it.item_amount() < 1) {
			if (it.equipped_amount() > 0) {
				return new dietVerdict("held", "you're wearing it, and the Cup is opened from a link on the "
					+ "inventory page: take it off first");
			}
			if (dietFetchable(it) > 0) {
				return new dietVerdict("held", "it's not to hand: " + dietWhereElse(it));
			}
			return new dietVerdict("no", "you don't have one");
		}
		int jewels = get_property("_cupOf13sJewels").to_int();
		if (jewels < 1) return new dietVerdict("done", "no jewels left in the Cup today");
		int [item] wanted;
		foreach i, one in s.mix.split_string(MIX_SEP) {
			item part = dietExactItem(one);
			if (part == $item[none]) return new dietVerdict("no", "the mix names " + one + ", which isn't an item");
			wanted[part] = wanted[part] + 1;
		}
		if (count(wanted) == 0) return new dietVerdict("no", "the plan didn't say what to mix");
		foreach part, n in wanted {
			if (part.item_amount() < n) {
				string where = dietWhereElse(part);
				string said = "the mix wants " + n + " " + dietPlain(part.to_string()) + " and you have "
					+ part.item_amount() + (where == "" ? "" : " (" + where + ")");
				return new dietVerdict(dietFetchable(part) >= n - part.item_amount() ? "held" : "no", said);
			}
		}
		return new dietVerdict("ready", "mix " + s.mix.replace_string(MIX_SEP, " + ") + "; " + jewels
			+ " jewels left today");
	}

	// Short in inventory is two different situations, and the table is only worth reading if it
	// tells them apart: a day's food sitting on the display case shelf is waiting for Grab
	// supplies, while food you do not own is a trip to the mall. So the first is "not yet" and
	// only the second is "can't" -- otherwise every row of a properly shelved day comes up red and
	// the colour stops meaning anything.
	if (it.item_amount() < need) {
		string where = dietWhereElse(it);
		int short_by = need - it.item_amount();
		if (dietFetchable(it) >= short_by) {
			return new dietVerdict("held", "you have " + it.item_amount() + " of " + need + " to hand, and "
				+ where + ": grab supplies");
		}
		return new dietVerdict("no", "you have " + it.item_amount() + " of " + need
			+ (where == "" ? " and none anywhere else" : ", and only " + where));
	}

	// Organ room. A row's own numbers rather than the plan's arithmetic, because by the time a row
	// runs the organ has whatever is actually in it -- cleaners, a rest, a day half done by hand.
	if (s.action == "eat" || s.action == "chew" || (s.action == "drink" && !s.nightcap)) {
		int organ = s.action == "eat" ? 0 : (s.action == "chew" ? 2 : 1);
		int per = dietRoomPer(s, organ);
		int left = organ == 0 ? fullness_limit() - my_fullness()
			: (organ == 1 ? inebriety_limit() - my_inebriety() : spleen_limit() - my_spleen_use());
		string what = organ == 0 ? "fullness" : (organ == 1 ? "drunkenness" : "spleen");
		if (per * need > left) {
			int fits = per > 0 ? left / per : need;
			return new dietVerdict(fits > 0 ? "part" : "held",
				"needs " + (per * need) + " " + what + " and " + left + " is free"
					+ (fits > 0 ? ", so " + fits + " of them fit" : ""));
		}
	}

	// The nightcap is the one drink that is meant not to fit. KoL lets a drink of any size start
	// while you are exactly at your limit and refuses it once you are past, so "at or under" is the
	// question, not whether there is room.
	if (s.nightcap) {
		if (my_inebriety() > inebriety_limit()) {
			return new dietVerdict("no", "you're already past your limit at " + my_inebriety()
				+ " of " + inebriety_limit() + ", and KoL won't start another drink");
		}
		return new dietVerdict("ready", "the overdrink: " + my_inebriety() + " of " + inebriety_limit()
			+ " now, and this is " + dietRoomPer(s, 1) + " more");
	}

	return new dietVerdict("ready", "");
}

dietVerdict dietJudge(dietStep s, int done, int toCome) {
	// Where the game can be asked, it is asked first and the ledger is only the thing it is
	// compared against: an effect's duration, what is worn, a once-a-day preference. Eating,
	// drinking and chewing are the rows it cannot be asked about -- an organ's fill is the whole
	// day at once and says nothing about which row put it there -- so for those the ledger is the
	// only record there is, and the count it holds is what is believed.
	if (s.kind == "skill") return dietJudgeSkill(s, toCome, done);
	if (s.kind == "familiar") return dietJudgeFamiliar(s, done);
	if (s.kind == "campground") return dietJudgeCampground(s, done);
	int need = s.count - done;
	if (need <= 0 && s.action != "equip") {
		return new dietVerdict("done", s.count > 1 ? "all " + s.count + " done" : "done");
	}
	return dietJudgeItem(s, need < 1 ? 1 : need, done);
}

// --- what gets said, on the page and in the gCLI ---------------------------

string dietStepLine(int i, dietStep s, int done, dietVerdict v) {
	return (i + 1) + ". [" + v.state + "] " + s.action + " "
		+ (s.count > 1 ? s.count + " x " : "") + dietPlain(s.name)
		+ (done > 0 && done < s.count ? " (" + done + " already done)" : "")
		+ (v.said == "" ? "" : " -- " + v.said);
}

string dietOrgansJSON() {
	return "{\"fullness\":[" + my_fullness() + "," + fullness_limit() + "]"
		+ ",\"drunk\":[" + my_inebriety() + "," + inebriety_limit() + "]"
		+ ",\"spleen\":[" + my_spleen_use() + "," + spleen_limit() + "]"
		+ ",\"hp\":[" + my_hp() + "," + my_maxhp() + "]"
		+ ",\"mp\":[" + my_mp() + "," + my_maxmp() + "]}";
}

// --- the actions -----------------------------------------------------------

void dietOpen() {
	string locked = get_property("cowlDietLocked");
	if (locked == "") {
		write("{\"ok\":false,\"error\":\"Nothing is locked. Lock a plan on the Diet tab first: this tab eats "
			+ "the plan you locked, so it has to be a plan that can't change under it.\"}");
		return;
	}
	string at = form_field("at");
	// The one check that needs no JSON parser and cannot be talked round: the timestamp has to be
	// in the plan that is locked right now.
	if (at == "" || !locked.contains_text("\"at\":" + at)) {
		write("{\"ok\":false,\"error\":\"Those rows aren't from the plan that's locked now. Reload the page.\"}");
		return;
	}
	string steps = form_field("steps");
	if (steps == "") {
		write("{\"ok\":false,\"error\":\"The locked plan has no rows in it.\"}");
		return;
	}
	// Arriving on the tab hands the same rows over again, so only a list that actually changed is
	// worth a line in the gCLI -- and one that changed is very much worth it, since it means the
	// plan being carried out is not the plan it was.
	boolean fresh = steps != get_property(DIET_STEPS) || at != get_property(DIET_STEPS_AT);
	set_property(DIET_STEPS, steps);
	set_property(DIET_STEPS_AT, at);

	dietStep [int] kept = dietReadSteps();
	if (fresh) {
		print("Diet Planner: holding a locked plan of " + count(kept) + " steps to carry out.", "blue");
	}
	write("{\"ok\":true,\"steps\":" + count(kept) + ",\"fresh\":" + fresh + "}");
}

void dietCheck() {
	dietStep [int] steps = dietReadSteps();
	buffer out;
	out.append("{\"ok\":true,\"at\":" + dietQuoted(get_property(DIET_STEPS_AT))
		+ ",\"ledger\":" + dietQuoted(dietDoneState())
		+ ",\"organs\":" + dietOrgansJSON() + ",\"steps\":[");
	int [int] done = dietReadDone();
	int toCome = dietDrunkToCome(steps, done);
	boolean quiet = form_field("quiet") == "1";
	if (!quiet) {
		print("");
		print("Diet Planner: where the day stands.", "blue");
	}
	int n = 0;
	foreach i, s in steps {
		int did = done contains i ? done[i] : 0;
		dietVerdict v = dietJudge(s, did, toCome);
		if (!quiet) print("  " + dietStepLine(i, s, did, v));
		if (n++ > 0) out.append(",");
		out.append("{\"i\":" + i + ",\"phase\":" + dietQuoted(s.phase) + ",\"action\":" + dietQuoted(s.action)
			+ ",\"kind\":" + dietQuoted(s.kind) + ",\"name\":" + dietQuoted(dietPlain(s.name))
			+ ",\"count\":" + s.count + ",\"nightcap\":" + s.nightcap + ",\"done\":" + did
			+ ",\"state\":" + dietQuoted(v.state) + ",\"said\":" + dietQuoted(v.said) + "}");
	}
	out.append("]}");
	out.write();
}

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}
	string action = form_field("action");
	if (action == "open") {
		dietOpen();
	} else if (action == "reset") {
		set_property(DIET_DONE, "");
		print("Diet Planner: today's progress forgotten; nothing was eaten or undone.", "blue");
		write("{\"ok\":true}");
	} else if (action == "check" || action == "") {
		dietCheck();
	} else {
		write("{\"ok\":false,\"error\":" + dietQuoted("No such action: " + action) + "}");
	}
}
