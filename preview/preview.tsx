// Browser preview entry: renders the XMB with mocked Steam/Decky globals (see mocks.js).
// ?trophies=<appid> shows the trophy page instead; ?theme=<key> picks a colour.
import { initSettings, updateSettings } from "../src/settings";
import { initThemes } from "../src/themes";
import { requestTrophyList, setTrophyPageFromCollection, takeTrophyListRequest, trophyPageFromCollection } from "../src/library";
import { startControllerGlyphs } from "../src/glyphs";
import { TrophyPage } from "../src/xmb/TrophyPage";
import { XMBHome } from "../src/xmb/XMBHome";

const ReactDOM = (window as any).ReactDOM;
const DFL = (window as any).DFL;
initThemes();
startControllerGlyphs(); // (as the plugin does: here, on the preview page itself)
initSettings().then(() => {
  const q = new URLSearchParams(location.search);
  if (q.get("theme")) updateSettings({ theme: q.get("theme") as any });
  // In the preview, "navigating" to the trophy page reloads with ?trophies=.
  const nav = DFL.Navigation.Navigate;
  DFL.Navigation.Navigate = (r: string) => {
    const m = r.match(/^\/deckyxmb\/trophies\/(\d+)/);
    if (m) location.search = `?trophies=${m[1]}${trophyPageFromCollection() ? "&collection=1" : ""}`;
    else nav(r);
  };
  // (and back again, the trophies to list in the XMB carried across the reload).
  DFL.Navigation.NavigateBack = () => {
    const a = takeTrophyListRequest();
    location.search = a ? `?xmbTrophies=${a}` : "";
  };
  setTrophyPageFromCollection(!!q.get("collection"));
  if (q.get("xmbTrophies")) requestTrophyList(Number(q.get("xmbTrophies")));
  const trophies = Number(q.get("trophies"));
  ReactDOM.createRoot(document.getElementById("root")).render(trophies ? <TrophyPage appid={trophies} /> : <XMBHome />);
});
