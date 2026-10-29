// cowl_diet_items.ash -- how the Diet Planner draws a name: its picture, and for an item the
// description id that opens KoL's description of it. Asked only about the names a plan or a
// shopping list shows. A name that isn't an item is tried as a skill, an effect and a familiar,
// for the picture.
//
// It reads and nothing else.

import <cowl_diet_assets.ash>

string dietQuoted(string value) {
	string out = value.replace_string("\\", "\\\\").replace_string("\"", "\\\"");
	return "\"" + out.replace_string("\n", " ").replace_string("\r", "")
		.replace_string("\t", " ") + "\"";
}

void main() {
	if (form_field("pwd") != my_hash()) {
		write("{\"ok\":false,\"error\":\"This page is out of date. Reload it.\"}");
		return;
	}
	buffer out;
	out.append("{\"ok\":true,\"facts\":{");
	int n = 0;
	foreach i, name in form_field("names").split_string("\\|") {
		if (name == "") continue;
		string facts;
		item it = name.to_item();
		skill sk = name.to_skill();
		effect ef = name.to_effect();
		familiar fam = name.to_familiar();
		if (it != $item[none]) {
			facts = "{\"kind\":\"item\",\"name\":" + dietQuoted(dietPlain(it.to_string()))
				+ ",\"image\":" + dietQuoted(it.image) + ",\"descid\":" + dietQuoted(it.descid) + "}";
		} else if (sk != $skill[none]) {
			facts = "{\"kind\":\"skill\",\"name\":" + dietQuoted(sk.to_string()) + ",\"image\":" + dietQuoted(sk.image) + "}";
		} else if (ef != $effect[none]) {
			facts = "{\"kind\":\"effect\",\"name\":" + dietQuoted(ef.to_string()) + ",\"image\":" + dietQuoted(ef.image) + "}";
		} else if (fam != $familiar[none]) {
			facts = "{\"kind\":\"familiar\",\"name\":" + dietQuoted(fam.to_string()) + ",\"image\":" + dietQuoted(fam.image) + "}";
		} else {
			continue;
		}
		if (n++ > 0) out.append(",");
		out.append(dietQuoted(name) + ":" + facts);
	}
	out.append("}}");
	out.write();
}
