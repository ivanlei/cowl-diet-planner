// cowl_diet_price.ash -- the Diet Planner's mall check.
//
// cowl_diet_data.ash prices everything from KoLmafia's records, which can be stale and can't say
// how many are for sale: on 2026-10-28 they had Jeppson's Malort at 100 meat, and nobody was
// selling any. This asks the mall itself, but only about the handful a plan chose, and answers
// with what's actually there: how many at each price, cheapest first, counting each store's daily
// limit, so what one buyer could take today. The page prices the quantity the plan needs from
// that and won't plan on more than there is.
//
// Something nobody sells but you can cook or mix is priced from its ingredients' mall prices, and
// so is something that can't be traded at all. Something untradeable it can't price (a Speakeasy
// drink) comes back empty and keeps the price it had.
//
// It reads prices and nothing else. It buys nothing.

int dietRecipeCost(item it, int depth);

// What one costs at today's mall prices: bought, from an NPC store, or cooked or mixed from parts
// priced the same way, through a recipe this character knows. 0 when none of those works.
int dietMallCost(item it, int depth) {
	int p = it.is_tradeable() ? mall_price(it) : 0;
	if (p <= 0 && npc_price(it) > 0) p = npc_price(it);
	if (p > 0) return p;
	return it.is_tradeable() && depth > 0 ? 0 : dietRecipeCost(it, depth);
}

// What it costs to make one from its ingredients, or 0.
int dietRecipeCost(item it, int depth) {
	if (depth > 4 || get_property("unknownRecipe" + it.to_int()) == "true") return 0;
	string how = craft_type(it);
	if (!how.contains_text("Cook") && !how.contains_text("Mix") && !how.contains_text("Meatpast")) return 0;
	int [item] parts = get_ingredients(it);
	if (count(parts) == 0) return 0;
	int total = 0;
	foreach part, n in parts {
		int c = dietMallCost(part, depth + 1);
		if (c <= 0) return 0;
		total += c * n;
	}
	return total;
}

// What the mall has of an item today, as [quantity, price] pairs, from the searchmall command's
// summary: quantities already cut to each store's daily limit. A store parked at the 999,999,999
// ceiling isn't selling. An NPC store is unlimited.
string dietStock(item it) {
	buffer out;
	out.append("[");
	int n = 0;
	if (npc_price(it) > 0) {
		out.append("[1000000," + npc_price(it) + "]");
		n++;
	}
	matcher m = create_matcher("([\\d,]+) @ ([\\d,]+) meat", cli_execute_output("searchmall " + it.to_string()));
	while (m.find()) {
		int price = to_int(m.group(2).replace_string(",", "").to_string());
		if (price >= 999999999) continue;
		if (n++ > 0) out.append(",");
		out.append("[" + to_int(m.group(1).replace_string(",", "").to_string()) + "," + price + "]");
	}
	return out.append("]").to_string();
}

string dietQuoted(string value) {
	string out = value.replace_string("\\", "\\\\").replace_string("\"", "\\\"");
	return "\"" + out + "\"";
}

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}
	buffer out;
	out.append("{\"ok\":true,\"market\":{");
	int n = 0;
	foreach i, name in form_field("items").split_string("\\|") {
		item it = name.to_item();
		if (it == $item[none]) continue;
		if (n++ > 0) out.append(",");
		out.append(dietQuoted(name) + ":{");
		if (it.is_tradeable()) {
			string stock = dietStock(it);
			out.append("\"stock\":" + stock);
			int made = stock == "[]" ? dietRecipeCost(it, 0) : 0;
			if (made > 0) out.append(",\"price\":" + made + ",\"made\":true");
		} else {
			int p = dietMallCost(it, 0);
			if (p > 0) out.append("\"price\":" + p + ",\"made\":" + (npc_price(it) <= 0));
		}
		out.append("}");
	}
	out.append("}}");
	out.write();
}
