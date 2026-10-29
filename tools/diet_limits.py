#!/usr/bin/env python3
"""Write data/cowl_diet_limits.txt from KoLmafia's dailylimits.txt, for the Diet Planner.

    python3 tools/diet_limits.py <KoLmafia source>/src/main/resources/data
    (or set KOLMAFIA_DATA to that folder)

KoLmafia knows how many of a consumable you may use a day, and which preference counts them, but
keeps that table inside its jar, where file_to_map can't read it, and ASH's dailyusesleft answers
"how many more today", not "how many a day". So the planner carries its own copy: item id, tracking
preference, uses a day. A preference without a leading underscore resets only on ascending.
Re-run when KoLmafia adds limited consumables.
"""

import html
import os
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("KOLMAFIA_DATA", "")
if not SRC:
    sys.exit("Give the path to a KoLmafia source checkout's src/main/resources/data, or set KOLMAFIA_DATA.")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "cowl_diet_limits.txt")


def rows(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        for line in f:
            if line.strip() and not line.startswith("#") and "\t" in line:
                yield line.rstrip("\n").split("\t")


def main():
    # names are matched decoded and case-blind: items.txt writes &quot; where dailylimits.txt writes ", and
    # "Mansquito Serum" where it writes "mansquito serum"
    ids = {html.unescape(r[1]).lower(): r[0] for r in rows("items.txt") if len(r) > 1 and r[0].isdigit()}
    out = ["# cowl_diet_limits.txt -- consumables with a use limit, for relay_Diet_Planner.ash.",
           "# Written by tools/diet_limits.py from KoLmafia's dailylimits.txt; don't edit by hand.",
           "# item id\ttracking preference\tuses a day (or an ascension, without a leading _)"]
    n = 0
    for r in rows("dailylimits.txt"):
        name = html.unescape(r[1]).lower() if len(r) > 1 else ""
        if len(r) >= 3 and r[0] in ("Eat", "Drink", "Chew") and name in ids:
            out.append(f"{ids[name]}\t{r[2]}\t{r[3] if len(r) > 3 and r[3].isdigit() else 1}")
            n += 1
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"wrote {os.path.normpath(OUT)}: {n} limits")


if __name__ == "__main__":
    main()
