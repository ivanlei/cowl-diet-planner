// cowl_diet_refresh.ash -- the Diet Planner's "update prices from the mall" button, first half.
//
// mall_prices() on a category searches the mall for the whole of it in a few requests and writes
// what it finds into KoLmafia's price records -- the ones historical_price() reads, and so the
// ones cowl_diet_data.ash prices the menu from. Food, booze and other consumables (spleen items,
// and helpers such as mojo filters) are the categories a diet is made of. The page then reloads
// its data and plans again, and asks the mall item by item about what the plan picked. It notes
// the time (cowlDietPricesRefreshed): for a day after, anything it didn't price wasn't on sale.
//
// It reads prices and nothing else. It buys nothing.

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}
	int n = 0;
	foreach category in $strings[food, booze, othercon] {
		n += mall_prices(category);
	}
	// when: the page treats anything this didn't price as not for sale
	set_property("cowlDietPricesRefreshed", now_to_int().to_string());
	write("{\"ok\":true,\"updated\":" + n + "}");
}
