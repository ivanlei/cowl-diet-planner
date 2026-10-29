// cowl_diet_assets.ash -- the few things every Diet Planner script needs: addresses for the page's
// own files, names as plain text, and how many of something you own.

// The KoLmafia project this installs as: what `git checkout` named the folder it cloned into.
string DIET_GIT_PROJECT = "ivanlei-cowl-diet-planner";

// A version for one of our files, so that a browser fetches it again after an update.
//
// A browser can hold a .js or .css from KoLmafia's relay server across an update and go on running
// the old one, so each address carries a version and a new version is a new address. The version is
// the commit KoLmafia last installed for this project, which changes with every `git update`, and the
// file's length, which changes with most edits to a copy put in place by hand.
string dietAssetVersion(string file) {
	string commit = git_info(DIET_GIT_PROJECT).commit;
	string at = commit.length() > 12 ? commit.substring(0, 12) : commit;
	return (at == "" ? "n" : at + "-") + file_to_buffer(file).length();
}

// "/<file>?v=<version>", for a src or href.
string dietAsset(string file) {
	return "/" + file + "?v=" + dietAssetVersion(file);
}

// A stylesheet for the page's <head>, where the browser has it before it draws anything.
string dietStyleLink(string file) {
	return "<link rel='stylesheet' type='text/css' href='" + dietAsset(file) + "'>\n";
}

// A name as plain text. KoL writes HTML entities into names themselves (KoLmafia keeps
// `Newbiesport&trade; tent` exactly as it was given), and some sources escape twice, so decode
// until it stops changing, bounded. &apos; is an XML entity KoLmafia doesn't decode, so it's
// replaced by hand, inside the loop, to catch an "&amp;apos;" on the way past.
string dietPlain(string name) {
	string out = name.replace_string("&apos;", "'");
	for i from 1 to 5 {
		string once = out.entity_decode().replace_string("&apos;", "'");
		if (once == out) return out;
		out = once;
	}
	return out;
}

// How many of something you own, wherever it is: inventory, closet, Hagnk's, display case, worn.
// Not available_amount(), which answers what a script could get hold of under the autoSatisfyWith
// settings.
int dietOwned(item it) {
	return it.item_amount()
		+ it.closet_amount()
		+ it.storage_amount()
		+ it.display_amount()
		+ it.equipped_amount();
}
