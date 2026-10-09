// Opens Steam's own library context menu (Play, Properties, Favorites, Manage…)
// for a game. Steam doesn't export it, so it is located in Steam's webpack bundle
// by content. Adapted from Spindeck (BSD-3-Clause).
import { Navigation, showContextMenu } from "@decky/ui";
import { createElement } from "react";
import { findModuleExports, lookup } from "./webpack";

const findAppMenu = lookup<{ Menu: any; options: any }>(() => {
  const mod = findModuleExports("ContextMenuAction", "launchSource", "LibraryContextMenu");
  let Menu: any, options: any;
  for (const v of Object.values(mod ?? {})) {
    if (typeof v !== "function") continue;
    const t = String(v);
    if (t.includes("navigator:") && t.includes("instance:")) Menu = v;
    if (t.includes("bFitToWindow") && t.includes("LibraryContextMenu")) options = v;
  }
  return Menu ? { Menu, options } : null;
});

export function openNativeGameMenu(appid: number, overview: any, anchor: EventTarget | undefined, ownerWindow: any) {
  const found = findAppMenu();
  if (!found || !overview) {
    Navigation.Navigate(`/library/app/${appid}`); // the game page has the START (options) menu
    return;
  }
  try {
    const el = createElement(found.Menu, { overview, client: "mostavailable", launchSource: 100, bInGamepadUI: true, ownerWindow });
    showContextMenu(el, anchor as any, found.options ? found.options() : undefined);
  } catch {
    Navigation.Navigate(`/library/app/${appid}`);
  }
}
