// cowl_diet_shelf.ash -- the Shopping tab's storage shelf: a shelf in your display case to keep the
// diet's things on, out of the way of anything that tidies an inventory.
//
// KoLmafia knows what's in the display case but not its shelves. KoL's shelf page has them, as a
// script variable -- var shelves = {"0":"-none-","1":"..."} -- and that's what this reads. A shelf
// is chosen and kept by its name, and turned into KoL's number only at the moment things are moved,
// so adding or removing other shelves never sends the diet's things to the wrong one.
//
//   action=list   the shelves, by name, and the one chosen last time
//   action=move   every one you have of the named items -- in your inventory, your closet, and
//                 Hagnk's when you can take from it freely -- into the case and onto the shelf, with
//                 any already in the case on another shelf. dry=1 says what it would move, and moves
//                 nothing.
//
// It never buys, uses or gives anything away; worn items stay worn.

import <cowl_diet_assets.ash>

string SHELVES_PAGE = "managecollectionshelves.php";

string dietQuoted(string value) {
	string out = value.replace_string("\\", "\\\\").replace_string("\"", "\\\"");
	return "\"" + out + "\"";
}

// A shelf's name as text: KoL writes it as a JSON string, and puts HTML entities in it ("Skills
// &amp; Crap"). \uXXXX becomes a numeric entity, so one decode handles both.
string dietShelfName(string raw) {
	string s = raw.replace_string("\\/", "/").replace_string("\\\"", "\"");
	matcher u = create_matcher("\\\\u([0-9a-fA-F]{4})", s);
	buffer b;
	while (u.find()) u.append_replacement(b, "&#x" + u.group(1) + ";");
	u.append_tail(b);
	return dietPlain(b.to_string().replace_string("\\\\", "\\"));
}

// The shelves, by KoL's number; 0 is "-none-", the case's unshelved part.
string [int] dietShelves() {
	string [int] shelves;
	matcher list = create_matcher("var shelves = \\{(.*?)\\};", visit_url(SHELVES_PAGE));
	if (!list.find()) return shelves;
	matcher one = create_matcher("\"(\\d+)\":\"((?:[^\"\\\\]|\\\\.)*)\"", list.group(1));
	while (one.find()) shelves[one.group(1).to_int()] = dietShelfName(one.group(2));
	return shelves;
}

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}
	if (!have_display()) {
		write("{\"ok\":true,\"hasCase\":false,\"shelves\":[]}");
		return;
	}
	string [int] shelves = dietShelves();
	buffer out;

	if (form_field("action") != "move") {
		out.append("{\"ok\":true,\"hasCase\":true,\"chosen\":" + dietQuoted(get_property("cowlDietShelf")) + ",\"shelves\":[");
		int n = 0;
		foreach i, name in shelves {
			if (i == 0) continue;
			if (n++ > 0) out.append(",");
			out.append(dietQuoted(name));
		}
		out.append("]}");
		out.write();
		return;
	}

	string name = form_field("shelf");
	int shelf = 0;
	foreach i, n in shelves if (i > 0 && n == name) shelf = i;
	if (shelf == 0) {
		write("{\"ok\":false,\"error\":" + dietQuoted("There's no shelf called \"" + name + "\" in your display case.") + "}");
		return;
	}
	boolean dry = form_field("dry") == "1";
	boolean pulls = can_interact();  // out of Ronin, taking from Hagnk's costs nothing

	boolean [item] shelve;
	out.append("{\"ok\":true,\"shelf\":" + dietQuoted(name) + ",\"dry\":" + dry + ",\"moved\":[");
	int n = 0;
	string skipped = "";
	foreach i, wanted in form_field("items").split_string("\\|") {
		item it = wanted.to_item();
		if (it == $item[none]) continue;
		int closet = closet_amount(it), storage = pulls ? storage_amount(it) : 0, held = item_amount(it);
		int cased = display_amount(it);
		if (closet + storage + held + cased == 0) continue;
		if (!is_displayable(it)) {
			skipped += (skipped == "" ? "" : ",") + dietQuoted(dietPlain(it.to_string()));
			continue;
		}
		if (!dry) {
			if (closet > 0) take_closet(closet, it);
			if (storage > 0) take_storage(storage, it);
			int now = item_amount(it);
			if (now > 0) put_display(now, it);
		}
		if (dry || display_amount(it) > 0) shelve[it] = true;
		if (n++ > 0) out.append(",");
		out.append("{\"name\":" + dietQuoted(dietPlain(it.to_string())) + ",\"inventory\":" + held + ",\"closet\":" + closet
			+ ",\"storage\":" + storage + ",\"display\":" + cased + "}");
	}
	// one request puts every one of them on the shelf, the newly cased and the already cased alike
	if (!dry && count(shelve) > 0) {
		buffer url;
		url.append(SHELVES_PAGE + "?action=arrange&pwd=" + my_hash());
		foreach it in shelve url.append("&whichshelf" + it.to_int() + "=" + shelf);
		visit_url(url.to_string(), true);
	}
	if (!dry) set_property("cowlDietShelf", name);
	out.append("],\"skipped\":[" + skipped + "],\"shelved\":" + count(shelve) + "}");
	out.write();
}
