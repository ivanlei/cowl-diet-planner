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
	string name;     // for showing and for saying what went wrong; never for looking anything up
	// What the row is, as KoLmafia numbers it. The plan can only name things -- it is built in a
	// browser out of KoLmafia's own tables -- so a name is what arrives, and a name is resolved
	// exactly once, when the plan is handed over, and never again. Every judgement and every
	// action afterwards works from this number.
	//
	// The difference matters because to_item() matches loosely. A name this script half-recognises
	// is a thing it eats: "clock" is a real item and so is "chewing gum on a string", and the
	// distance between a near miss and the right answer is a turn, a point of fullness or 40,000
	// meat. Resolving once also means a name that resolves to nothing is said so at the moment the
	// plan is taken on, rather than discovered with a fork in hand.
	int id;
	int count;
	boolean nightcap; // the one drink meant to take you past your limit
	boolean stooper;  // the drink that spends the Stooper's point, which needs it out
	string mix;       // a Cup of 13s' three ingredients, as ids, "~"-separated
	// What the row costs each organ, for all count of it, as the plan worked it out. Carried rather
	// than read back off the item, because the item does not know: a drink through the mime army
	// shotglass costs no liver at all, a Cup of 13s is 1 drunk although the Cup itself is an
	// off-hand with no drunkenness, a food under a dieting pill fills twice its fullness, a
	// legendary noodle dish that digests with its spleen nets no fullness, and the Pork Elf toilet
	// gives a point back. Every one of those is in the plan's own numbers and in none of KoLmafia's.
	int full;
	int drunk;
	int spleen;
	// The effect a wish buys, as KoLmafia numbers it, or 0 for a row that wishes for nothing. A
	// wish needs a target and prose is not one; this is that target, resolved the same way and at
	// the same moment as everything else.
	int wish;
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

// --- resolving a handed-over plan, once ------------------------------------

// What one record names, as a number: an item, a skill or a familiar by its kind. 0 when the name
// resolves to nothing, which the caller reports rather than storing.
int dietIdOf(string kind, string name) {
	if (kind == "skill") {
		skill sk = name.to_skill();
		return sk != $skill[none] && sk.to_string() == name ? sk.to_int() : 0;
	}
	if (kind == "familiar") {
		familiar fam = name.to_familiar();
		return fam != $familiar[none] && fam.to_string() == name ? fam.to_int() : 0;
	}
	// Everything else is an item, the campground row included: the Pork Elf toilet is item 12208,
	// so it is one fewer thing matched by its name.
	//
	// Compared against $item[none] rather than against 0, because KoLmafia numbers that item -1
	// and "no id" has to be a number the caller can test for. Checking for 0 here let a name that
	// resolves to nothing through, which is the whole thing this function exists to stop.
	item it = dietExactItem(name);
	return it == $item[none] ? 0 : it.to_int();
}

// The records as handed over, with the id added and the mix turned into ids. Returns "" when
// something would not resolve, having written the reason into the buffer.
string dietResolve(string handed, buffer trouble) {
	buffer out;
	foreach i, rec in handed.split_string("\\|") {
		if (rec == "") continue;
		string [int] f = rec.split_string("\\^");
		if (count(f) < 11) {
			trouble.append((trouble.length() > 0 ? "; " : "") + "a step arrived with " + count(f) + " fields");
			return "";
		}
		// The wished-for effect goes the same way as everything else: a name once, a number after.
		int wish = 0;
		if (f[10] != "" && f[10] != "0") {
			effect want = f[10].to_effect();
			if (want == $effect[none]) {
				trouble.append((trouble.length() > 0 ? "; " : "") + "KoLmafia has no effect called \"" + f[10] + "\"");
				return "";
			}
			wish = want.to_int();
		}
		int id = dietIdOf(f[2], f[3]);
		if (id < 1) {
			trouble.append((trouble.length() > 0 ? "; " : "") + "KoLmafia has no " + f[2] + " called \"" + f[3] + "\"");
			return "";
		}
		// The mix goes the same way, and for the same reason: three names that have to come back
		// as the three numbers the Cup's own form wants.
		buffer mix;
		foreach j, one in f[6].split_string(MIX_SEP) {
			if (one == "") continue;
			item partItem = dietExactItem(one);
			int part = partItem == $item[none] ? 0 : partItem.to_int();
			if (part < 1) {
				trouble.append((trouble.length() > 0 ? "; " : "") + "the mix names \"" + one + "\", which isn't an item");
				return "";
			}
			mix.append((mix.length() > 0 ? MIX_SEP : "") + part);
		}
		if (out.length() > 0) out.append(STEP_SEP);
		out.append(f[0] + FIELD_SEP + f[1] + FIELD_SEP + f[2] + FIELD_SEP + f[3] + FIELD_SEP + f[4]
			+ FIELD_SEP + f[5] + FIELD_SEP + mix.to_string() + FIELD_SEP + f[7] + FIELD_SEP + f[8]
			+ FIELD_SEP + f[9] + FIELD_SEP + id + FIELD_SEP + wish);
	}
	return out.to_string();
}

// --- the kept rows ---------------------------------------------------------

dietStep [int] dietReadSteps() {
	dietStep [int] steps;
	string kept = get_property(DIET_STEPS);
	if (kept == "") return steps;
	foreach i, rec in kept.split_string("\\|") {
		if (rec == "") continue;
		string [int] f = rec.split_string("\\^");
		// Twelve fields, because the kept records carry the resolved numbers that the ones handed
		// over do not. A shorter record is one this script wrote before that was true: dropped
		// rather than read, since the page hands the plan over again on every visit to the tab.
		if (count(f) < 12) continue;
		// The flags field is a list, not a word: a drink can be both the nightcap and the one the
		// Stooper's point is spent by, and on a day with no Cup it often is.
		steps[count(steps)] = new dietStep(f[0], f[1], f[2], f[3], f[10].to_int(), f[4].to_int(),
			f[5].contains_text("nightcap"), f[5].contains_text("stooper"), f[6],
			f[7].to_int(), f[8].to_int(), f[9].to_int(), f[11].to_int());
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
		if (count(parts) < 2) continue;
		done[parts[0].to_int()] = parts[1].to_int();
	}
	return done;
}

// The adventures a row actually turned into, where that was measured.
//
// A third part on a ledger entry, optional because it is only knowable for a row that has
// actually been carried out and only meaningful for one that was meant to give adventures: an
// equip gains none, and a row still to do has nothing to report. KoLmafia counts adventures
// itself, so this is its number before the row and after it, not an estimate of its own.
int [int] dietReadGained() {
	int [int] got;
	string said = get_property(DIET_DONE);
	if (said == "") return got;
	int colon = said.index_of(":");
	if (colon < 0 || said.substring(0, colon) != get_property(DIET_STEPS_AT)) return got;
	foreach i, one in said.substring(colon + 1).split_string(",") {
		if (one == "") continue;
		string [int] parts = one.split_string("\\*");
		if (count(parts) < 3) continue;
		got[parts[0].to_int()] = parts[2].to_int();
	}
	return got;
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

// Which slot the Cup of 13s is being worn in, or $slot[none] if it isn't.
//
// The Cup is an off-hand and the thing that opens it is a link on the inventory page, so a Cup
// that is being worn is a Cup the link is not beside: item_amount() counts inventory alone. That
// makes taking it off part of using it, and putting it back afterwards needs the slot it came out
// of rather than an assumption -- an off-hand is also what a Left-Hand Man wears, so "the off-hand
// slot" is the usual answer and not the only one.
slot dietCupSlot() {
	foreach s in $slots[] {
		if (equipped_item(s) == $item[Cup of 13s]) return s;
	}
	return $slot[none];
}

// A mix, as names, for saying out loud. The ids are what the Cup's own form wants and what
// everything here looks things up by; a row that reads "mix 706 + 706 + 704" is no use to anybody.
string dietMixNames(string mix) {
	buffer out;
	foreach i, one in mix.split_string(MIX_SEP) {
		if (one == "") continue;
		if (out.length() > 0) out.append(" + ");
		out.append(dietPlain(one.to_int().to_item().to_string()));
	}
	return out.to_string();
}

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
	skill sk = s.id.to_skill();
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
	familiar fam = s.id.to_familiar();
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
	// Any other familiar row is "have this one out", and whether it is out is a thing the game can
	// be asked -- so it is, and the ledger is only what that answer is compared against. The
	// Stooper appears twice in a day for this reason: out for the drink that spends its point, and
	// out again after the yeti swap takes it away.
	if (my_familiar() == fam) return new dietVerdict("done", "it's out");
	if (done >= s.count) return dietDisagrees("the " + my_familiar() + " is out, not the " + fam);
	return new dietVerdict("ready", "the " + my_familiar() + " is out: take the " + fam + " out");
}

dietVerdict dietJudgeCampground(dietStep s, int done) {
	if (s.id.to_item() != $item[Pork Elf toilet]) return new dietVerdict("you", "no way to do this one from here");
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
	item it = s.id.to_item();
	// Belt and braces: nothing unresolvable is ever stored, so this is a check on this script
	// rather than on the plan.
	if (it == $item[none]) return new dietVerdict("no", "the kept plan has no item for this row");

	// A wish with a target on the row is a thing this can do: KoLmafia's own genie command takes
	// the effect by name and reaches for a pocket wish when there is no bottle to rub. Without a
	// target it is still yours -- wishing for prose is not a thing -- but the plan says what it
	// wants now, so that is the unusual case rather than the only one.
	if (it == $item[pocket wish]) {
		if (s.wish < 1) return new dietVerdict("you", "the plan doesn't say what to wish for");
		effect want = s.wish.to_effect();
		if (have_effect(want) > 0) {
			return new dietVerdict("done", "you already have " + want + " for " + have_effect(want) + " turns");
		}
		if (it.item_amount() < 1) {
			string where = dietWhereElse(it);
			return new dietVerdict(dietFetchable(it) > 0 ? "held" : "no",
				where == "" ? "you have no pocket wish" : "none to hand: " + where);
		}
		return new dietVerdict("ready", "wish to be " + want);
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
	if (it == $item[Cup of 13s]) {
		// A worn Cup is not a problem, it is a step: it comes off for the mix and goes straight
		// back on. Said here rather than left as an obstacle because the Cup spends most of its
		// life equipped -- Booze Drop +60 is not an enchantment anybody takes off for fun -- so
		// "take it off first" would be an instruction given every single day.
		string cupWorn = "";
		if (it.item_amount() < 1) {
			slot worn = dietCupSlot();
			if (worn == $slot[none]) {
				if (dietFetchable(it) > 0) {
					return new dietVerdict("held", "it's not to hand: " + dietWhereElse(it));
				}
				return new dietVerdict("no", "you don't have one");
			}
			cupWorn = "; it comes off your " + worn + " for the mix and goes straight back on";
		}
		int jewels = get_property("_cupOf13sJewels").to_int();
		if (jewels < 1) return new dietVerdict("done", "no jewels left in the Cup today");
		int [item] wanted;
		foreach i, one in s.mix.split_string(MIX_SEP) {
			// Splitting "" gives one empty piece, not none, and an empty piece is not a mix of one
			// unknown thing -- it is a plan that did not say, which the count below answers for.
			if (one == "") continue;
			wanted[one.to_int().to_item()] = wanted[one.to_int().to_item()] + 1;
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
		return new dietVerdict("ready", "mix " + dietMixNames(s.mix) + "; " + jewels
			+ " jewels left today" + cupWorn);
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

	// The drink that spends the Stooper's point needs the Stooper out, and needs it to stay out:
	// take it off while you are at 21 of 21 and you are at 21 of 20, which is falling-down drunk --
	// no more turns, and KoL will not start the nightcap either.
	if (s.stooper) {
		if (!have_familiar($familiar[Stooper])) {
			return new dietVerdict("no", "this drink spends the Stooper's point of liver and you don't have "
				+ "a Stooper; without it this drink puts you over your limit");
		}
		string out = my_familiar() == $familiar[Stooper] ? "it's out now"
			: "the " + my_familiar() + " is out: take the Stooper out first";
		return new dietVerdict("ready", "with the Stooper out, and keep it out through the nightcap -- " + out);
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

	// Worth saying, because the table would otherwise show "use" against a thing that cannot be
	// used and look like the bug it used to be.
	if (s.action == "use" && !it.usable) {
		return new dietVerdict("ready", "a helper: eaten rather than used, and it goes on the next food");
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
	// Names become numbers here and nowhere else. A plan with a name in it that KoLmafia does not
	// know is refused now, with the name, rather than kept and found out one row at a time.
	buffer trouble;
	string resolved = dietResolve(steps, trouble);
	if (resolved == "") {
		print("Diet Planner: would not take the plan on -- " + trouble, "red");
		write("{\"ok\":false,\"error\":" + dietQuoted("This plan has something KoLmafia can't place: "
			+ trouble + ".") + "}");
		return;
	}

	// Arriving on the tab hands the same rows over again, so only a list that actually changed is
	// worth a line in the gCLI -- and one that changed is very much worth it, since it means the
	// plan being carried out is not the plan it was.
	boolean fresh = resolved != get_property(DIET_STEPS) || at != get_property(DIET_STEPS_AT);
	set_property(DIET_STEPS, resolved);
	set_property(DIET_STEPS_AT, at);

	dietStep [int] kept = dietReadSteps();
	if (fresh) {
		print("Diet Planner: holding a locked plan of " + count(kept) + " steps to carry out.", "blue");
	}
	write("{\"ok\":true,\"steps\":" + count(kept) + ",\"fresh\":" + fresh + "}");
}

// --- a day's supplies, from where you keep them ----------------------------
//
// What the kept plan still needs, less what is already in inventory, taken out of the display
// case shelf, the closet, and Hagnk's when pulls are free -- in that order, because the shelf is
// where the Shopping tab put them and emptying it first leaves the other two alone.
//
// It never buys. It never touches the clan stash, which is not yours to spend. And it asks for
// what is LEFT to do rather than for a whole day, so a day half eaten does not fetch twice.

record dietWant {
	int id;
	int want;
};

// Everything the remaining steps need in inventory, by item: the rows themselves, and the three
// things a Cup of 13s row mixes.
int [item] dietNeeded(dietStep [int] steps, int [int] done) {
	int [item] want;
	foreach i, s in steps {
		if (s.kind != "item") continue;
		int left = s.count - (done contains i ? done[i] : 0);
		if (left < 1) continue;
		item it = s.id.to_item();
		if (it == $item[none]) continue;
		// The Cup is not drunk, it is opened -- what the row consumes is the mix.
		if (it == $item[Cup of 13s]) {
			foreach j, one in s.mix.split_string(MIX_SEP) {
				if (one == "") continue;
				item part = one.to_int().to_item();
				if (part != $item[none]) want[part] = want[part] + left;
			}
			continue;
		}
		want[it] = want[it] + left;
	}
	return want;
}

void dietSupplies() {
	dietStep [int] steps = dietReadSteps();
	if (count(steps) == 0) {
		write("{\"ok\":false,\"error\":\"No plan is being carried out. Open the Consume tab first.\"}");
		return;
	}
	boolean dry = form_field("dry") == "1";
	boolean pulls = can_interact();  // out of Ronin, taking from Hagnk's costs nothing
	int [item] want = dietNeeded(steps, dietReadDone());

	print("");
	print("Diet Planner: " + (dry ? "what Grab supplies would fetch" : "fetching a day's supplies")
		+ (pulls ? "" : " (in Ronin, so Hagnk's is left alone)") + ".", "blue");

	buffer out;
	out.append("{\"ok\":true,\"dry\":" + dry + ",\"items\":[");
	int n = 0, moved = 0, shortOf = 0;
	foreach it, need in want {
		int had = it.item_amount();
		if (had >= need) continue;
		int fromCase = 0, fromCloset = 0, fromStorage = 0;
		// Each take is followed by reading the count again rather than trusting what it returned:
		// the question is how many are in hand now, and that is a thing KoLmafia can simply be
		// asked.
		int gap = need - had;
		int take = it.display_amount() < gap ? it.display_amount() : gap;
		if (take > 0) {
			fromCase = take;
			if (!dry) {
				take_display(take, it);
				fromCase = it.item_amount() - had;
			}
		}
		gap = need - (dry ? had + fromCase : it.item_amount());
		take = it.closet_amount() < gap ? it.closet_amount() : gap;
		if (take > 0) {
			fromCloset = take;
			if (!dry) {
				int before = it.item_amount();
				take_closet(take, it);
				fromCloset = it.item_amount() - before;
			}
		}
		gap = need - (dry ? had + fromCase + fromCloset : it.item_amount());
		take = pulls && it.storage_amount() < gap ? it.storage_amount() : (pulls ? gap : 0);
		if (take > 0) {
			fromStorage = take;
			if (!dry) {
				int before = it.item_amount();
				take_storage(take, it);
				fromStorage = it.item_amount() - before;
			}
		}
		int got = fromCase + fromCloset + fromStorage;
		int still = need - (dry ? had + got : it.item_amount());
		if (got > 0) moved = moved + 1;
		if (still > 0) shortOf = shortOf + 1;

		string where;
		if (fromCase > 0) where += (where == "" ? "" : ", ") + fromCase + " from the case";
		if (fromCloset > 0) where += (where == "" ? "" : ", ") + fromCloset + " from the closet";
		if (fromStorage > 0) where += (where == "" ? "" : ", ") + fromStorage + " from Hagnk's";
		print("  " + (dry ? "would take " : "took ") + (where == "" ? "nothing" : where) + " for "
			+ need + " " + dietPlain(it.to_string()) + " (had " + had + ")"
			+ (still > 0 ? " -- still " + still + " short" : ""));

		if (n++ > 0) out.append(",");
		out.append("{\"name\":" + dietQuoted(dietPlain(it.to_string())) + ",\"want\":" + need
			+ ",\"had\":" + had + ",\"case\":" + fromCase + ",\"closet\":" + fromCloset
			+ ",\"storage\":" + fromStorage + ",\"short\":" + (still > 0 ? still : 0) + "}");
	}
	if (n == 0) print("  Everything the rest of the plan needs is already in your inventory.");
	print("Diet Planner: " + (dry ? "nothing was moved; that was a dry run." : moved + " of them fetched"
		+ (shortOf > 0 ? ", " + shortOf + " still short" : "") + "."), "blue");
	out.append("],\"moved\":" + moved + ",\"short\":" + shortOf + "}");
	out.write();
}

// --- carrying one row out ---------------------------------------------------
//
// One row per request, because that is what makes the table tick off in front of you and what
// makes a failure stop where it happened rather than three steps later. The page walks the rows;
// this does exactly one of them and says what became of it.

// How many of a row can go down right now. A row's own organ, read from the game rather than from
// the plan's arithmetic, because by the time it runs the organ holds whatever is actually in it.
int dietFits(dietStep s, int need) {
	if (s.nightcap) return 1;
	int organ = s.action == "eat" ? 0 : (s.action == "chew" ? 2 : (s.action == "drink" ? 1 : -1));
	if (organ < 0) return need;
	int per = dietRoomPer(s, organ);
	if (per < 1) return need;
	int left = organ == 0 ? fullness_limit() - my_fullness()
		: (organ == 1 ? inebriety_limit() - my_inebriety() : spleen_limit() - my_spleen_use());
	int fits = left / per;
	return fits < need ? fits : need;
}

// Write a row's progress into today's ledger, merging rather than replacing: every other row's
// count has to survive this one.
void dietRecord(int i, int did, int gained) {
	int [int] done = dietReadDone();
	int [int] got = dietReadGained();
	done[i] = (done contains i ? done[i] : 0) + did;
	if (gained != 0) got[i] = (got contains i ? got[i] : 0) + gained;
	buffer out;
	out.append(get_property(DIET_STEPS_AT) + ":");
	int n = 0;
	foreach j, k in done {
		if (n++ > 0) out.append(",");
		out.append(j + "*" + k + (got contains j ? "*" + got[j] : ""));
	}
	set_property(DIET_DONE, out.to_string());
}

string dietSayStep(dietStep s, int i) {
	return "step " + (i + 1) + ": " + s.action + " "
		+ (s.count > 1 ? s.count + " x " : "") + dietPlain(s.name);
}

// What went wrong, at length, with everything that bears on it. This is the one place in the
// script where being long-winded is the point: a step that failed halfway is a day that has to be
// picked up by hand, and the gCLI is where that is done from.
void dietTrouble(dietStep s, int i, string said) {
	print("");
	print("Diet Planner: " + dietSayStep(s, i) + " did not go through.", "red");
	print("  " + said, "red");
	print("  item " + s.id + ", " + s.count + " wanted, " + s.full + "/" + s.drunk + "/" + s.spleen
		+ " fullness/drunk/spleen for all of them");
	print("  organs now: " + my_fullness() + "/" + fullness_limit() + " full, " + my_inebriety() + "/"
		+ inebriety_limit() + " drunk, " + my_spleen_use() + "/" + spleen_limit() + " spleen");
	print("  HP " + my_hp() + "/" + my_maxhp() + ", MP " + my_mp() + "/" + my_maxmp()
		+ ", " + my_adventures() + " adventures, familiar " + my_familiar());
	print("  _porkElfToiletUsed=" + get_property("_porkElfToiletUsed")
		+ " coolerYetiMode=" + get_property("coolerYetiMode")
		+ " _cupOf13sJewels=" + get_property("_cupOf13sJewels")
		+ " timesRested=" + get_property("timesRested") + "/" + total_free_rests());
	print("  ledger: " + get_property(DIET_DONE));
}

// --- the awkward ones -------------------------------------------------------

// Rest at the campsite for the Pork Elf toilet's point of fullness.
//
// KoL will not rest somebody who needs nothing, and KoLmafia will not even ask: full HP, full MP
// and not Beaten Up is a refusal on both sides. So a little MP has to go first, and on any day
// with drinks in it the plan's own Ode cast is already that spend -- which is why it is tried
// before anything bought or improvised. cowlDietRestBurn names a fallback for a day with no Ode
// in it.
string dietRestForToilet(boolean dry) {
	if (get_property("_porkElfToiletUsed").to_boolean()) return "the toilet had already digested today";
	if (my_fullness() < 2) return "it wants 2 fullness and you have " + my_fullness();

	if (my_hp() == my_maxhp() && my_mp() == my_maxmp()) {
		skill burn = $skill[none];
		if (have_skill($skill[The Ode to Booze]) && mp_cost($skill[The Ode to Booze]) <= my_mp()) {
			burn = $skill[The Ode to Booze];
		} else {
			skill named = get_property("cowlDietRestBurn").to_skill();
			if (named != $skill[none] && have_skill(named) && mp_cost(named) <= my_mp()) burn = named;
		}
		if (burn == $skill[none]) {
			return "HP and MP are both full, so a rest would be refused, and there is nothing to spend "
				+ "MP on: set cowlDietRestBurn to a buff you know";
		}
		if (dry) {
			print("  would cast " + burn + " first: a rest is refused at full HP and MP");
		} else {
			print("  casting " + burn + " first: a rest is refused at full HP and MP");
			use_skill(1, burn);
			if (my_mp() == my_maxmp()) return "cast " + burn + " and MP is still full";
		}
	}

	int free = total_free_rests() - get_property("timesRested").to_int();
	if (dry) {
		print("  would rest at the campsite (" + (free > 0 ? free + " free rests left" : "no free rests, so an adventure")
			+ ")");
		return "";
	}
	cli_execute(free > 0 ? "rest free campground 1" : "rest campground 1");
	if (!get_property("_porkElfToiletUsed").to_boolean()) {
		return "rested, but KoLmafia did not see the toilet digest -- _porkElfToiletUsed is still false";
	}
	return "";
}

// Mix and drink a Cup of 13s, taking the Cup off first if it is being worn.
//
// The Cup is opened by a link on the inventory page, so a worn Cup is one the link is not beside.
// It goes back on the moment the drink is down -- and on every way out of here, since leaving
// somebody with an empty off-hand and no idea why is not a failure mode worth having.
string dietDrinkTheCup(dietStep s, boolean dry) {
	item cup = $item[Cup of 13s];
	slot worn = dietCupSlot();
	if (dry) {
		return "would " + (worn == $slot[none] ? "" : "take the Cup off your " + worn + ", ")
			+ "mix " + dietMixNames(s.mix) + " and drink it"
			+ (worn == $slot[none] ? "" : ", then put the Cup back");
	}
	if (worn != $slot[none]) {
		equip(worn, $item[none]);
		if (cup.item_amount() < 1) return "could not take the Cup off your " + worn;
		print("  took the Cup of 13s off your " + worn);
	}
	int before = my_inebriety();
	// Its own action on the inventory page rather than inv_use.php: the Cup is an off-hand, not a
	// usable item, so there is no whichitem to use. A plain request rather than use(), because an
	// automated request landing on a choice aborts instead of handing back a page.
	visit_url("inventory.php?pwd=" + my_hash() + "&action=cupof13s");
	if (!handling_choice()) {
		if (worn != $slot[none]) equip(worn, cup);
		return "the Cup of 13s did not open";
	}
	// By label rather than by number, and asked of KoLmafia rather than scraped off the page.
	int mixIt = 0;
	foreach option, says in available_choice_options(true) {
		if (mixIt == 0 && says.contains_text("Mix")) mixIt = option;
	}
	if (mixIt == 0) {
		string saw;
		foreach option, says in available_choice_options(true) saw += (saw == "" ? "" : "; ") + option + ") " + says;
		if (handling_choice()) run_choice(1);
		if (worn != $slot[none]) equip(worn, cup);
		return "no button on the Cup looked like mixing a drink; it offered: " + saw;
	}
	string [int] mix = s.mix.split_string(MIX_SEP);
	if (count(mix) != 3) {
		if (handling_choice()) run_choice(1);
		if (worn != $slot[none]) equip(worn, cup);
		return "the plan names " + count(mix) + " things to mix and the Cup takes three";
	}
	// whichitem1..3 are the fields KoLmafia reads back off this choice, so they are what it wants.
	run_choice(mixIt, "whichitem1=" + mix[0] + "&whichitem2=" + mix[1] + "&whichitem3=" + mix[2]);
	if (handling_choice()) run_choice(1);
	if (worn != $slot[none]) {
		equip(worn, cup);
		if (cup.equipped_amount() > 0) print("  put the Cup of 13s back on your " + worn);
		else print("  could NOT put the Cup of 13s back on your " + worn + "; it is in your inventory.", "red");
	}
	if (my_inebriety() <= before) return "the Cup did not make a drink -- drunkenness did not move from " + before;
	return "";
}

// Take a familiar out, and for the Cooler Yeti ask it for the thing worth asking for.
string dietFamiliarStep(dietStep s, boolean dry) {
	familiar fam = s.id.to_familiar();
	if (fam == $familiar[none]) return "the kept plan has no familiar for this row";
	if (!have_familiar(fam)) return "you don't have a " + fam;
	boolean yeti = fam == $familiar[Cooler Yeti];
	if (dry) {
		return "would take out the " + fam + (yeti ? " and ask for impossibly cold" : "");
	}
	if (my_familiar() != fam) {
		use_familiar(fam);
		if (my_familiar() != fam) return "could not take out the " + fam;
	}
	if (!yeti) return "";
	if (get_property("_coolerYetiAdventures").to_boolean()) return "";
	// The conversation is a link on the charpane, and a GET: one-argument visit_url posts, and
	// main.php's side doors do not read a body.
	visit_url("main.php?talktoyeti=1", false);
	if (!handling_choice()) return "the Cooler Yeti did not want to talk";
	int cold = 0;
	foreach option, says in available_choice_options(true) {
		if (cold == 0 && says.contains_text("impossibly cold")) cold = option;
	}
	if (cold == 0) {
		string saw;
		foreach option, says in available_choice_options(true) saw += (saw == "" ? "" : "; ") + option + ") " + says;
		if (handling_choice()) run_choice(1);
		return "the Cooler Yeti did not offer impossibly cold; it offered: " + saw;
	}
	run_choice(cold);
	if (handling_choice()) run_choice(1);
	if (get_property("coolerYetiMode") != "adventures") {
		return "asked for impossibly cold but coolerYetiMode is '" + get_property("coolerYetiMode") + "'";
	}
	return "";
}

void dietStepAction() {
	dietStep [int] steps = dietReadSteps();
	int i = form_field("i").to_int();
	if (count(steps) == 0 || i < 0 || i >= count(steps)) {
		write("{\"ok\":false,\"error\":\"No such step. Reload the page.\"}");
		return;
	}
	boolean dry = form_field("dry") == "1";
	dietStep s = steps[i];
	int [int] done = dietReadDone();
	int did = done contains i ? done[i] : 0;
	int need = s.count - did;
	dietVerdict v = dietJudge(s, did, dietDrunkToCome(steps, done));

	// The overdrink needs asking for by name. Breakfast walks the same endpoint, and a stray index
	// must not be able to end the day.
	if (s.nightcap && form_field("cap") != "1") {
		write("{\"ok\":false,\"error\":\"That step is the nightcap, which has to be asked for on its own.\"}");
		return;
	}
	if (v.state == "done") {
		write("{\"ok\":true,\"did\":0,\"state\":\"done\",\"said\":" + dietQuoted(v.said) + "}");
		return;
	}
	// Not ready is not a failure, it is a "not yet": a cleaner has not freed the organ, or the
	// fullness the toilet wants is not in you yet. The walk has to be able to step over those and
	// come back, so they are answered as nothing done rather than as something wrong.
	if (v.state != "ready" && v.state != "part") {
		write("{\"ok\":true,\"did\":0,\"skipped\":true,\"state\":" + dietQuoted(v.state)
			+ ",\"said\":" + dietQuoted(v.said) + "}");
		return;
	}

	int advBefore = my_adventures();
	string trouble;
	int didNow = 0;

	if (s.kind == "skill") {
		skill sk = s.id.to_skill();
		int toCome = dietDrunkToCome(steps, done);
		int per = turns_per_cast(sk);
		int casts = sk == $skill[The Ode to Booze] && per > 0
			? (toCome - have_effect($effect[Ode to Booze]) + per - 1) / per : 1;
		if (casts < 1) casts = 1;
		if (dry) {
			print("  would cast " + casts + " x " + sk);
		} else {
			use_skill(casts, sk);
			if (sk == $skill[The Ode to Booze] && have_effect($effect[Ode to Booze]) < toCome) {
				trouble = "the Ode is " + have_effect($effect[Ode to Booze]) + " turns and the day spends " + toCome;
			}
		}
		if (trouble == "") didNow = 1;
	} else if (s.kind == "familiar") {
		string said = dietFamiliarStep(s, dry);
		if (dry) print("  " + said);
		else if (said != "") trouble = said;
		if (trouble == "") didNow = 1;
	} else if (s.kind == "campground") {
		string said = dietRestForToilet(dry);
		if (said != "") trouble = said;
		if (trouble == "") didNow = 1;
	} else if (s.action == "equip") {
		item it = s.id.to_item();
		if (dry) print("  would wear the " + it);
		else {
			equip(it);
			if (it.equipped_amount() < 1) trouble = "could not wear the " + dietPlain(it.to_string());
		}
		if (trouble == "") didNow = 1;
	} else {
		item it = s.id.to_item();
		if (it == $item[pocket wish] && s.wish > 0) {
			effect want = s.wish.to_effect();
			if (dry) {
				print("  would wish to be " + want);
				didNow = 1;
			} else {
				// KoLmafia's own command, which knows the wording KoL wants ("to be <effect>") and
				// which reaches for a pocket wish when there is no genie bottle in inventory.
				cli_execute("genie effect " + want);
				if (have_effect(want) < 1) trouble = "wished to be " + want + " and the effect is not up";
				else didNow = 1;
			}
		} else if (it == $item[Cup of 13s]) {
			string said = dietDrinkTheCup(s, dry);
			if (dry) print("  " + said);
			else if (said != "") trouble = said;
			if (trouble == "") didNow = 1;
		} else {
			int n = dietFits(s, need);
			if (n < 1) {
				write("{\"ok\":true,\"did\":0,\"skipped\":true,\"state\":\"held\",\"said\":"
					+ dietQuoted("none of it fits yet: " + v.said) + "}");
				return;
			}
			if (dry) {
				print("  would " + s.action + " " + n + " x " + dietPlain(it.to_string()));
				didNow = n;
			} else {
				int had = it.item_amount();
				// Counted off the inventory afterwards rather than off what the call returned:
				// three of five going down is a thing to record as three, not as a failure.
				if (s.nightcap) overdrink(1, it);
				else if (s.action == "eat") eat(n, it);
				else if (s.action == "drink") drink(n, it);
				else if (s.action == "chew") chew(n, it);
				else if (it.usable) use(n, it);
				// KoLmafia will not "use" something that has to be eaten, drunk or chewed, and a
				// food helper is one of those: the fudge spork's usable is false, and a plan that
				// says "use" it stops the morning with "[item] cannot be used". Its own command
				// names the verb it wants in that case -- eaten for a food or a food helper, drunk
				// for booze or a drink helper, chewed for a spleen item -- so the organ the item
				// fills picks the verb here. A helper fills none, so it is tried as a food and then
				// as a drink, and the wrong one of those cannot do any harm: the command refuses a
				// drink helper under eat and a food helper under drink.
				else if (it.fullness > 0) eat(n, it);
				else if (it.inebriety > 0) drink(n, it);
				else if (it.spleen > 0) chew(n, it);
				else {
					eat(n, it);
					if (it.item_amount() == had) drink(n, it);
				}
				didNow = had - it.item_amount();
				if (didNow < 1) trouble = "nothing went down -- you still have " + it.item_amount();
			}
		}
	}

	int gained = dry ? 0 : my_adventures() - advBefore;
	if (!dry && didNow > 0) dietRecord(i, didNow, gained);

	if (trouble != "") {
		dietTrouble(s, i, trouble);
		write("{\"ok\":false,\"error\":" + dietQuoted(trouble) + ",\"did\":" + didNow + "}");
		return;
	}
	print("  " + (dry ? "[dry] " : "") + dietSayStep(s, i) + " -- " + (dry ? "would do " : "did ") + didNow
		+ (gained != 0 ? ", " + gained + " adventures" : "")
		+ " (" + my_fullness() + "/" + fullness_limit() + " full, " + my_inebriety() + "/" + inebriety_limit()
		+ " drunk, " + my_spleen_use() + "/" + spleen_limit() + " spleen)");
	write("{\"ok\":true,\"did\":" + didNow + ",\"gained\":" + gained + ",\"dry\":" + dry
		+ ",\"left\":" + (need - didNow) + ",\"organs\":" + dietOrgansJSON() + "}");
}

void dietCheck() {
	dietStep [int] steps = dietReadSteps();
	buffer out;
	out.append("{\"ok\":true,\"at\":" + dietQuoted(get_property(DIET_STEPS_AT))
		+ ",\"ledger\":" + dietQuoted(dietDoneState())
		+ ",\"organs\":" + dietOrgansJSON() + ",\"steps\":[");
	int [int] done = dietReadDone();
	int [int] got = dietReadGained();
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
			+ ",\"count\":" + s.count + ",\"nightcap\":" + s.nightcap + ",\"stooper\":" + s.stooper
			+ ",\"done\":" + did + (got contains i ? ",\"gained\":" + got[i] : "")
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
	} else if (action == "step") {
		dietStepAction();
	} else if (action == "supplies") {
		dietSupplies();
	} else if (action == "check" || action == "") {
		dietCheck();
	} else {
		write("{\"ok\":false,\"error\":" + dietQuoted("No such action: " + action) + "}");
	}
}
