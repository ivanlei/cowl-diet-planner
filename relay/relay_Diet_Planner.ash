// relay_Diet_Planner.ash -- the most adventures a day's meat budget buys.
//
// Give it a budget for a day and it works out what to eat, drink and chew for the most
// adventures: the knapsack per organ, the cleaners and expanders, the once-a-day boosters (the
// Cooler Yeti, the salad fork, the frosty mug), Refined Palate and the pinky ring on wine, a
// nightcap and the mime army shotglass -- whichever of those this character has. Then the order to
// do it in. On a second tab, rollover: the gear, campground and clan furniture that add adventures
// each night, the best there is beside what you have, and tonight's bank against the 200 cap. On a
// third, shopping: the plan times a number of days, less what you have. Lock keeps a plan
// (in KoLmafia's preferences) so the page shows it as it was until it's unlocked.
//
// The relay_ prefix is what puts it in the Scripts menu, where it arrives as "Diet Planner".
//
// It plans. It doesn't buy or eat anything: cowl_diet_data.ash reads KoLmafia's tables and
// cowl_diet_price.ash asks the mall for prices, and the planning itself is in the browser
// (cowl_diet_plan.js), where changing the budget re-plans at once.

import <cowl_diet_assets.ash>

void main() {
	buffer out;
	out.append("<!DOCTYPE html>\n<html><head>\n");
	out.append("<title>Diet Planner</title>\n");
	out.append("<meta name='viewport' content='width=device-width, initial-scale=1'>\n");
	out.append(dietStyleLink("cowl_diet.css") + "\n");
	out.append("<script type='text/javascript'>var cowlDietPwd = \"" + my_hash() + "\";</script>\n");
	out.append("</head>\n<body>\n");

	out.append("<div id='cowl-diet'>\n");
	out.append("<h1>Diet Planner</h1>\n");
	out.append("<div class='cd-tabs' id='cd-tabs' role='tablist'>"
		+ "<button type='button' role='tab' class='cd-tab cd-on' data-tab='rollover' aria-selected='true'>Rollover</button>"
		+ "<button type='button' role='tab' class='cd-tab' data-tab='diet' aria-selected='false'>Diet</button>"
		+ "<button type='button' role='tab' class='cd-tab' data-tab='shopping' aria-selected='false'>Shopping</button></div>\n");
	out.append("<div id='cd-tab-diet' class='cd-pane' role='tabpanel' hidden>\n");

	out.append("<div class='cd-controls'>\n");
	out.append("<label class='cd-budget'>Meat to spend a day <input type='number' id='cd-budget'"
		+ " min='0' step='5000' inputmode='numeric'></label>\n");
	out.append("<span class='cd-presets' id='cd-presets'></span>\n");
	out.append("<button type='button' class='cd-refresh cd-go' id='cd-plan'>Plan</button>\n");
	out.append("<button type='button' class='cd-refresh' id='cd-refresh'>Update prices from the mall</button>\n");
	out.append("<button type='button' class='cd-refresh' id='cd-lock'>Lock</button>\n");
	out.append("</div>\n");
	out.append("<div id='cd-lock-said' class='cd-lock-said'></div>\n");
	out.append("<div id='cd-price-said' class='cd-said cd-price-said'></div>\n");
	out.append("<div class='cd-switches' id='cd-switches'></div>\n");

	out.append("<div id='cd-status' class='cd-status'>Reading KoLmafia's tables...</div>\n");
	out.append("<div id='cd-result'></div>\n");

	out.append("<p class='cd-note'>Plan works out the day and checks it against the mall: how many of each thing"
		+ " are for sale today and at what prices. Nothing on this page buys or eats anything. The big number is"
		+ " adventures from consumption and organ-free extras; rollover is on its own tab. A nightcap leaves you"
		+ " falling-down drunk, so it comes after the day's turns, and it's counted only up to what fits under the"
		+ " 200 cap on banked adventures.</p>\n");
	out.append("</div>\n");
	out.append("<div id='cd-tab-rollover' class='cd-pane' role='tabpanel'>\n");
	out.append("<div id='cd-rollover' class='cd-rollover'><p class='cd-said'>Reading KoLmafia's tables...</p></div>\n");
	out.append("</div>\n");
	out.append("<div id='cd-tab-shopping' class='cd-pane' role='tabpanel' hidden>\n");
	out.append("<div id='cd-shop' class='cd-shopping'><p class='cd-said'>Waiting for a plan on the Diet tab.</p></div>\n");
	out.append("</div>\n");
	out.append("</div>\n");

	out.append("<script type='text/javascript' src='" + dietAsset("cowl_diet_plan.js") + "'></script>\n");
	out.append("<script type='text/javascript' src='" + dietAsset("cowl_diet_rollover.js") + "'></script>\n");
	out.append("<script type='text/javascript' src='" + dietAsset("cowl_diet.js") + "'></script>\n");
	out.append("</body></html>\n");
	out.write();
}
