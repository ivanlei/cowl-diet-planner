// cowl_diet_save.ash -- keeps the Diet Planner's choices in KoLmafia.
//
// Two things, each in its own preference, so every browser the page is opened in sees the same
// ones rather than one browser's storage:
//
//   rollover  cowlDietRollover  the gear picked for each slot, the campground, what's left unplayed
//   locked    cowlDietLocked    a locked plan: while it's set the page shows it as it was and plans
//                               nothing (Lock); empty to unlock
//
// The page sends the whole value as JSON, POSTed (a locked plan is too long for a URL); this stores
// it and nothing else. An empty value clears it.

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}
	string key = form_field("key");
	string value = form_field("value");
	if (key == "" && form_field("rollover") != "") {  // the first version of the page
		key = "rollover";
		value = form_field("rollover");
	}
	string [string] prefs = {"rollover": "cowlDietRollover", "locked": "cowlDietLocked"};
	int [string] longest = {"rollover": 4000, "locked": 100000};
	if (!(prefs contains key)) {
		write("{\"ok\":false,\"error\":\"Nothing to keep by that name.\"}");
		return;
	}
	if (value.length() > longest[key]) {
		write("{\"ok\":false,\"error\":\"That's too long to keep.\"}");
		return;
	}
	set_property(prefs[key], value);
	write("{\"ok\":true}");
}
