# Diet Planner

A KoLmafia relay page for Kingdom of Loathing: give it how much meat you'll spend on a day's
consumption and it works out the most adventures that buys — what to eat, drink and chew, with the
cleaners, the once-a-day boosters and a nightcap, and the order to do it in. It plans and nothing
else: nothing on it buys, eats or moves anything.

It has three tabs:

- **Diet** — the plan for a budget, checked against the mall so that everything in it is for sale
  today, in the quantity it takes, priced for that quantity.
- **Rollover** — the gear, campground and clan furniture that add adventures each night, the best
  there is beside what you have, and tonight's bank against the 200 cap, which sizes the nightcap.
- **Shopping** — the plan times a number of days, less what you already have.

## Install

KoLmafia installs it itself. In the gCLI:

```
git checkout https://github.com/ivanlei/cowl-diet-planner.git
```

While the repository is private the URL has to carry a token: make a **fine-grained personal access
token** at [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
with access to this repository and **Repository permissions → Contents → Read-only**, and check out
`https://<github user>:<TOKEN>@github.com/ivanlei/cowl-diet-planner.git` (the token goes after the
colon, as the password; a token without that permission fails with `git-upload-pack not permitted`).

KoLmafia copies `relay/` and `data/` into place, and the page is **Diet Planner** in the relay
browser's Scripts menu. Afterwards:

```
git update ivanlei-cowl-diet-planner     # pull and re-copy
git delete ivanlei-cowl-diet-planner     # remove it
```

It needs a recent KoLmafia (it was built on r29440): it uses `cup_of_13s_tier`, `mall_prices` on a
category, `historical_age` and `git_info`, among others.

## The Diet tab

Type a budget, or pick one of the buttons, and the page shows:

- **the adventures** that much meat buys from consumption and organ-free extras;
- **a day's turns**: rollover, the plan, the Rumpus Room's clicks, the potato alarm clock and the etched
  hourglass added up;
- each organ's size and where every point of it comes from;
- **the plan, in order, as a table**: cast Ode, equip the ring, get Refined Palate, the first drinks,
  eating (milk first, each dieting pill just before the food it doubles), chewing, drinking, cleaners
  once their organ is full, extras, the Stooper's drink before your last turns, then the Cooler Yeti's
  chat and the nightcap;
- **what other budgets buy**, from 10k to 2M a day; click a row to switch to it.

The table's columns:

| Column | |
|---|---|
| Action | eat, drink, chew, use, cast or equip |
| Item | the name a link to the wiki, an item's picture KoL's description of it, and a ✓ with how many are for sale today once the mall has been asked |
| Expected adv | what that row adds, with every bonus |
| Details | how one of them adds up: the base roll, then Refined Palate, the pinky ring, the yeti, the fork or mug, Ode, the tuxedo shirt, aioli, whet stones, the 200 cap |
| Fullness | the organ space it takes (fullness, drunk, spleen), or frees |
| Adv per fullness | expected adventures over that space |
| Meat per fullness | what it costs over that space |
| Cost | what that row costs to buy |

Changing the budget re-plans at once; changing a switch plans again from scratch, which takes about
12 seconds. The switches start from what KoLmafia says you have, and the page remembers your changes:

| Switch | What it changes |
|---|---|
| Feast of Boris day | +15 stomach and twice the budget. Ticked by itself on the day |
| Pork Elf toilet | +1 stomach, for the −1 fullness after a rest. KoLmafia can't see whether one is installed, so tick it yourself |
| Stooper for the last drink | +1 liver, with the Stooper out for the day's last drink |
| Nightcap | One more drink of any size after the day's turns, which leaves you falling-down drunk until rollover |
| Cooler Yeti | One drink a day doubled, for 400 familiar XP |
| Mime army shotglass | One 1-drunk drink a day that costs no liver |
| mafia pinky ring | Wine +12.5%, which with Refined Palate makes cheap wine very good |
| Grimace map pills | With the Map to Safety Shelter Grimace Prime: a distention pill and a synthetic dog hair pill a day, for a transporter transponder and 2 adventures |

### Save this plan

**Save this plan** keeps the plan on screen and everything behind it in a KoLmafia preference. Until
you press **Unlock and plan again**, the page shows exactly that plan every time it's opened, in any
browser, and plans and prices nothing; the budget, the switches, the prices button and the Rollover
tab's boxes are frozen. Unlocking plans again from the saved choices.

### Prices, and what's for sale

The page plans first on KoLmafia's recorded mall prices, which can be days old and can't say how many
are for sale. So **the plan on screen is checked against the mall by itself** whenever it changes:
for each thing the plan picked, how many are for sale at each price, counting each store's daily
limit. Then:

- the plan pays for the units it takes, cheapest first, and for five at least, as KoLmafia's own
  `mall_price()` does: nine of something with 2 for sale at 3,999 and 7 at 5,500 cost what those cost;
- it can't take more than there are: anything with fewer than 30 for sale is capped at that many;
- anything nobody sells drops out, unless you can cook or mix it, when it's priced from its
  ingredients;
- it plans again, and checks what the new plan picked, until everything in it is something the mall
  has. The line under the buttons then says so.

To keep that to as few plans as it can, it asks about the days either side of the budget in the same
request, plans again only for something dropped or capped or a price that moved more than 2%, and
keeps the mall's answers in the browser for three hours. Opening the page fresh is two plans; opening
it again is usually one. The old plan stays on screen, dimmed, while it plans again. The check is
today's stock: sellers restock, but a thin market can run out over a month.

**Update prices from the mall** refreshes KoLmafia's prices for every food, booze and other
consumable at once (`mall_prices()`, about 1,750 prices); for a day after, anything it didn't price
wasn't for sale and drops out before planning.

### The Cup of 13s

If you have one, the Cup of 13s mixes three ingredients into a drink worth the sum of their tiers
(1–5), for 1 drunkenness, up to 13 adventures a day; it isn't booze, so Ode doesn't add to it. That's
13 adventures for one point of liver, so the planner takes it whenever the ingredients are cheap
enough, with the cheapest mix that reaches 13 (or 12). The Cup takes almost anything PvP-stealable
with an autosell price, equipment included, so a plan can call for a grease gun (tier 5) and two
second-hand synthetic sloth skin scabbards (tier 4). The Cup's row names each ingredient with its
tier, and the Shopping tab marks them as going into the Cup.

## The Rollover tab

Each night adds 40 adventures plus every **+Adventures** you're wearing and have installed, and the
whole bank is cut to 200.

**Tonight's bank**, at the top, adds up what you carry into tomorrow against the cap: rollover; the
adventures you usually go to bed with unplayed, which you type in; and the diet plan's nightcap,
which the plan sizes to the room left (200 − rollover − unplayed) so it doesn't pay for adventures the
cap would take. With 13 left it buys a carrot claret, 13 adventures for 120 meat; with none, no
nightcap. The Stooper's drink is drunk before your last turns, with the Stooper out for them, so its
adventures are played rather than banked.

Below that:

- **Gear**, one row per slot: head, back, shirt, weapon, off-hand, pants, three accessories, the
  familiar and its equipment. Beside each box is **the best there is** for that slot, ★ where you
  own one, otherwise "in the mall" or "not tradeable". The boxes start from **the best you own** and
  suggest the slot's gear as you type; put in what you'll actually wear.
- What you type is counted the way the game counts it: one watch, a single-equip item once, nothing
  in the off-hand beside a two-handed weapon (a second one-handed weapon only with Double-Fisted Skull
  Smashing), familiar equipment only on its familiar, a one-handed weapon on a Disembodied Hand and an
  off-hand on a Left-Hand Man, and an outfit's bonus once every piece is on.
- Gear counts at its **December** figure: the perfect Christmas scarf and the beards are +9 then.
  Stinky cheese counts its full +10, which takes 100 fights in it that day.
- **Campground and Chateau**: one maid (portable housekeeping robot +10, clockwork maid +8, Meat maid
  or Meat Butler +4), the cuckoo clock, a pagoda, the Crimbo candle (December) and the Chateau's
  artificial skylight, +3 each, ticked from what KoLmafia sees.
- **Clan Rumpus Room**: a Loathing calendar +3, the Self-Help Books +5, the Inspirational Desk
  Calendar +1. These are clicked once a day rather than added at rollover, so the cap doesn't touch
  them. The two calendars share a nail; one counts.
- **Also**: passive skills that add adventures, the Squamous Gibberer out for the day's fights
  (counted as 30), Recall Facts: Circadian Rhythms (up to 11), the etched hourglass (+5 a day when
  you use it, outside the cap) and the potato alarm clock (+5 at the
  first login, past the cap), each only if you have it.

Changing any of it plans again. The choices are kept in a KoLmafia preference, so every browser sees
the same ones.

## The Shopping tab

The plan on screen, or the saved one, times a number of days (31 to start), less what you already
have in your inventory, closet, Hagnk's and display case. For each thing: how many a day, for the
days, what you have and where, and how many more to get. Something you'd cook or mix rather than buy
(the Before Yore casserole) comes apart into what goes in it, for as many as you're short. It shows
how many the mall has today where the plan's check asked, flags anything there isn't enough of, and
gives a rough bill at KoLmafia's recorded prices. The Feast of Boris day eats more: shop for it on its
own.

## What it counts

- Every food, drink and spleen item KoLmafia knows that has a price, that you're high enough level
  for, and that fills one organ; cooked things through recipes you know, priced from their
  ingredients.
- Ode, the tuxedo shirt on martinis, the pinky ring and Refined Palate on wine, milk of magnesium,
  the fudge spork, whet stones, mini kiwi aioli, Special Seasoning and munchies pills when they pay,
  and the salad fork and frosty mug once a day.
- Cleaners and expanders (Mr. Burnsger, The Plumber's mushroom stew, Doc Clock's thyme cocktail, The
  Mad Liquor, the extra-greasy slider, fermented pickle juice, spice melange, the cuppa teas, sweet
  tooth, lupine appetite hormones, mojo filters) and dieting pills, which double a food.
- A legendary noodle dish's *With my Spleen* digestion, once a day; the Speakeasy's drinks at its
  prices, three a day, if your clan has one; daily limits, from `data/cowl_diet_limits.txt`.

Not counted: tomorrow's stock, once-an-ascension consumables such as the Legend pizzas, and
adventures while you play beyond the Gibberer's flat 30 (the Wild Hare, a thumb ring).

For a value of an adventure, the best day is a knapsack per organ, with the once-a-day limits and the
cleaners and expanders tried in and out; doing that at every value from 10 meat an adventure to
400,000 traces what each amount of meat buys, and a budget gets the best day that fits.

## What it keeps

In KoLmafia's preferences: `cowlDietRollover` (the Rollover tab's choices), `cowlDietLocked` (a saved
plan) and `cowlDietPricesRefreshed` (when the prices button last ran). In the browser: the budget,
switches, tab and days, and the mall's answers for three hours.

## Files

- `relay/relay_Diet_Planner.ash` — the page; `cowl_diet.js` and `cowl_diet.css` draw it.
- `relay/cowl_diet_plan.js` — the planner, with no page in it so node can test it;
  `cowl_diet_rollover.js` — the Rollover tab.
- `relay/cowl_diet_data.ash` (organs, what you own, the priced menu), `cowl_diet_price.ash` (the mall
  check), `cowl_diet_refresh.ash` (the prices button), `cowl_diet_rollover.ash` (the rollover
  catalogue), `cowl_diet_shop.ash` (the shopping list), `cowl_diet_items.ash` (pictures and
  description ids), `cowl_diet_save.ash` (the preferences) — the JSON endpoints the page reads.
- `relay/cowl_diet_assets.ash` — what every script needs: addresses for the page's own files, names
  as plain text, and how many of something you own.
- `data/cowl_diet_limits.txt` — daily limits on consumables.

## Developing

- `node tests/cowl_diet.test.js` — the planner against the answers of the Python prototype it was
  ported from, for the same inputs (`testdata/diet/`); the mall stock handling; the rollover counting.
- `python3 tools/diet_limits.py <KoLmafia source>/src/main/resources/data` — rewrites
  `data/cowl_diet_limits.txt` from KoLmafia's daily limits, which `file_to_map` can't read from inside
  the jar. Re-run it when KoLmafia adds limited consumables.
- To try a change without committing, copy `relay/*` into KoLmafia's `relay/` folder and reload the
  page.
