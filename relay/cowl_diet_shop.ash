// cowl_diet_shop.ash -- the Diet Planner's shopping list.
//
// The page sends what the plan takes over the days being shopped for, as name:quantity pairs. This
// answers with how many of each you already have -- inventory, closet, Hagnk's, display case -- and
// how many more to get. Something you can't buy but can cook or mix (the Before Yore casserole) is
// broken into its ingredients for as many as you're short, as far down as it takes to reach things
// that can be bought. Prices are KoLmafia's records, for an idea of the bill.
//
// It reads and nothing else. It buys nothing and moves nothing.

import <cowl_diet_assets.ash>

string dietQuoted(string value) {
	string out = value.replace_string("\\", "\\\\").replace_string("\"", "\\\"");
	return "\"" + out + "\"";
}

boolean dietCanMake(item it) {
	if (get_property("unknownRecipe" + it.to_int()) == "true") return false;
	string how = craft_type(it);
	return how.contains_text("Cook") || how.contains_text("Mix") || how.contains_text("Meatpast");
}

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}
	int [item] need;
	string [item] parent;
	item [int] order;
	int n = 0;
	foreach i, pair in form_field("need").split_string("\\|") {
		matcher m = create_matcher("^(.*):(\\d+)$", pair);
		if (!m.find()) continue;
		item it = m.group(1).to_item();
		if (it == $item[none]) continue;
		if (!(need contains it)) order[n++] = it;
		need[it] += m.group(2).to_int();
	}
	// what you're short of something made, you make: its ingredients join the list
	int at = 0;
	while (at < n) {
		item it = order[at];
		at++;
		int have = item_amount(it) + closet_amount(it) + storage_amount(it) + display_amount(it);
		int short = max(0, need[it] - have);
		if (short == 0 || it.is_tradeable() || npc_price(it) > 0 || !dietCanMake(it)) continue;
		foreach part, q in get_ingredients(it) {
			if (!(need contains part)) {
				order[n++] = part;
				parent[part] = dietPlain(it.to_string());
			}
			need[part] += short * q;
		}
	}
	buffer out;
	out.append("{\"ok\":true,\"rows\":[");
	for i from 0 to n - 1 {
		item it = order[i];
		string kind = it.is_tradeable() ? "buy" : npc_price(it) > 0 ? "npc" : dietCanMake(it) ? "make" : "none";
		int price = it.is_tradeable() ? historical_price(it) : npc_price(it);
		if (i > 0) out.append(",");
		out.append("{\"name\":" + dietQuoted(dietPlain(it.to_string())) + ",\"need\":" + need[it]);
		out.append(",\"inventory\":" + item_amount(it) + ",\"closet\":" + closet_amount(it));
		out.append(",\"storage\":" + storage_amount(it) + ",\"display\":" + display_amount(it));
		out.append(",\"kind\":\"" + kind + "\",\"price\":" + max(price, 0));
		out.append(",\"parent\":" + dietQuoted(parent contains it ? parent[it] : "") + "}");
	}
	out.append("]}");
	out.write();
}
