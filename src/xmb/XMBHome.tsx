import { Focusable, GamepadButton } from "@decky/ui";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Friend, friendGameArt, loadFriends, openProfile, Presence, useMyStatus } from "../friends";
import { PROFILE_COLOURS, refreshFriendProfile, refreshProfile, useFriendProfile, useProfile } from "../profile";
import {
  describeGame,
  Game,
  openAchievements,
  takeTrophyListRequest,
  useAchievementSync,
  cancelSync,
  launchGame,
  openGamePage,
  trophiesEarned,
  useAchievementProgress,
  achievementsScrolled,
  AchievementProgress,
  useAchievementProgressChanges,
  useTrophyLists,
} from "../library";
import { Cup } from "./TrophyPage";
import { formatDate, formatTime } from "../datetime";
import { musicFocus, musicLeave } from "../music";
import { openNativeGameMenu } from "../nativeMenu";
import { getSettings, Settings, ThemeKey, updateSettings, useSettings } from "../settings";
import { playSound } from "../sound";
import { isRunning, LAUNCH_ART_MS, LAUNCH_MENU_DELAY_MS, LAUNCH_MENU_MS, LAUNCH_START_MS, launchBehindXMB, setLaunchAnimator, startGame } from "../launch";
import {
  BASE_CSS,
  consume,
  FallbackImg,
  preloadImage,
  FONT,
  Glyph,
  hideFooter,
  Hint,
  Marquee,
  onScreen,
  Stage,
  STAGE_H,
  STAGE_W,
  TEXT_SHADOW,
  useGamepadHandlers,
  useNow,
  useStageScale,
} from "./common";
import { Icon, IconName } from "./icons";
import { buildCategories, Category, friendsCategory, Item, screenshotsCategory, settingsCategory, SubOption, systemUpdateItem } from "./model";
import { glowColor, rgb, sheetColor, themeColor } from "./theme";
import { ThemedWave } from "./Wave";
import { InstallProgress, installProgress, themeSwitching, useThemes } from "../themes";
import { useSoundtracks } from "../soundtracks";
import { cloudScreenshotsAsked, refreshScreenshots, useScreenshots } from "../screenshots";
import { refreshSystemSettings, useSystemSettings, watchAudioVolumes } from "../systemSettings";
import { refreshBluetooth, watchBluetooth } from "../bluetooth";
import { watchNetwork } from "../network";
import { useUpdates } from "../updates";
import type { GlyphButton } from "../glyphs";

// Measured from the PS3's own 1920×1080 screens (its Game column, a folder closed and open), scaled by 2/3: its 16:9
// is then 1280×720, centred in our 800 high (+40). Unselected items are well under half the selected one's size, and
// close together, so the selection stands out.
const BAR_Y = 233; // centre line of the category icons
const COL_X = 377; // centre x of the selected category / item column
const CAT_GAP = 137;
const CAT_ICON = 76;
const ROW = 53; // vertical step between unselected items
const SEL_TOP = 335; // top of the selected item: a selected glyph's centre at 377, 144 below the bar's
const BELOW = 139; // from the selected row's top to the next one's (centre to centre ~117)
const ABOVE = 113; // from the bar's centre up to the centre of the item before the selection (the rest climb above it)
// Inside a folder (as the PS3's Game column): the category icon and the column slide left, every
// item staying at its height. The opened item stays as it was, the rest become a strip of smaller,
// dimmed icons beside it, and the folder's contents list out to the right, level with it.
const F_CAT_X = 138; // category icon centre (0.108: the column slides this far left as a folder opens)
const F_SEL_TOP = SEL_TOP; // top of the selected row (level with the open folder, which stays where it was)
const F_SEL_CY = F_SEL_TOP + 42; // its centre line
const F_OPEN_X = 138; // the opened item's icon (below the category's)
const F_PARENT_X = 278; // the rest of the parent column (0.217)
const F_PARENT_ICON = 32; // (smaller than in the column; each stays at its height there)
const F_COL_X = 417; // the folder's contents: glyphs and game art alike centre here
const F_STRIP_OPACITY = 0.18; // the strip: faint, behind the folder's contents (as on the PS3)
const VALUE_X = 860; // a setting's current value
const VALUE_GAP = 24; // the least space between a name and its value
const GAME_W = 100; // unselected game icon (landscape, Steam header ratio)
const GAME_W_SEL = 214;
const GLYPH = 40;
const GLYPH_SEL = 84;
const COVER = 44; // album covers (square, centred like glyphs)
const COVER_SEL = 96;
// A trophy's Sort By selected: every row the same size, between a selected one's and the rest's (the selected one
// shrinking a little, the others growing to meet it), as the PS3 does.
const ZOOM_COVER = 70;
const ZOOM_GLYPH = 62;
const ZOOM_GAME = 150;
const ZOOM_ROW = ZOOM_COVER + 22;
const SETTING = 22; // the settings disc (unselected / selected)
const SETTING_SEL = 38;
const BG_DELAY_MS = 900; // the PS3 waited a moment before fading in a game's background
const FRIENDS_REFRESH_MS = 10000;
const BACK_TRIPLE_MS = 600; // ○ three times, each within this of the last, on the XMB itself: to the Game column
const OPTIONS_HOLD_MS = 500; // △ held this long on a game: Steam's own menu (More Options), not the PS3's
const AHEAD = 10; // Trophy Collection: how many games either side of the selection have their progress asked for
const FRIENDS_ONLINE_REFRESH_MS = 15000;

const ratio = 215 / 460;

// Where you were is kept across visits to the home screen: the category and its selection, the folders
// open in it, and each folder's selection (so backing out of one and going in again, or leaving the home
// screen for a game's page and coming back, finds the same game).
const memory = { cat: "game", sel: {} as Record<string, string>, open: [] as string[], folderSel: {} as Record<string, string> };
const folderKey = (catId: string, path: string[]) => [catId, ...path].join("/");

interface Level {
  folder: Item;
  items: Item[];
  sel: number;
}

/** A folder opened from the levels above it, on the item last selected in it (or, opened with ✕, the one it starts at). */
function openLevel(catId: string, above: Level[], folder: Item, fresh = false): Level {
  const items = folder.children!();
  const start = fresh ? folder.startAt?.() : undefined;
  const last = items.some((it) => it.id === start) ? start : memory.folderSel[folderKey(catId, [...above.map((l) => l.folder.id), folder.id])];
  return {
    folder,
    items,
    sel: Math.max(
      0,
      items.findIndex((it) => it.id === last),
    ),
  };
}

export function XMBHome() {
  const [s] = useSettings();
  // △ on the trophy page: back here, that game's trophies are listed in Trophy Collection (before where you
  // were is read, below).
  useState(() => {
    const a = takeTrophyListRequest();
    if (!a) return;
    memory.cat = "network";
    memory.sel = { ...memory.sel, network: "achievements" };
    memory.open = ["achievements", `ach:${a}`];
    memory.folderSel[folderKey("network", ["achievements"])] = `ach:${a}`;
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const box = useStageScale(rootRef);
  const now = useNow(15000, rootRef);

  // Steam's button-hint bar along the bottom (Menu, Select, Back): hidden while the XMB is on show, as the
  // PS3 had none. Just the one in the frame the XMB is in, not those of Steam's menus or Quick Access.
  useEffect(() => hideFooter(rootRef.current), []);

  // data
  const [cats, setCats] = useState<Category[]>(() => buildCategories(s));
  const shotsVer = useScreenshots();
  useEffect(() => {
    // (each column's items by id and name: unchanged, there's nothing new to show)
    let last = "";
    const refresh = (always: boolean) => {
      const next = buildCategories(getSettings());
      const key = next.map((c) => c.items.map((it) => `${it.id}=${it.label}`).join()).join("|");
      const same = key === last;
      last = key;
      if (always || !same) setCats(next);
      void refreshScreenshots(); // (if they've changed, the columns are rebuilt with them: below)
      void refreshSystemSettings(); // (so are the language, hostname and developer mode)
      void refreshBluetooth(); // (and the Bluetooth devices)
      return same;
    };
    refresh(true);
    // Steam's stores can still be filling in when the home first mounts: looked at again until they've settled.
    let tries = 0;
    const early = setInterval(() => {
      if ((refresh(false) && cloudScreenshotsAsked()) || ++tries >= 5) clearInterval(early);
    }, 2000);
    const doc = rootRef.current?.ownerDocument ?? document;
    const onVis = () => !doc.hidden && refresh(true);
    doc.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(early);
      doc.removeEventListener("visibilitychange", onVis);
    };
  }, [s.installedOnly, s.gameFavorites, s.gameInstalled, s.gameCollections, s.videoGames]);
  useEffect(() => watchAudioVolumes(), []); // (Sound Settings' volumes follow the volume buttons)
  useEffect(() => watchBluetooth(), []); // (Bluetooth's devices, as they connect and disconnect)
  useEffect(() => watchNetwork(), []); // (and the networks, as they come and go)
  // Only the column that shows what changed is rebuilt (Steam's settings change often: networks come and go during a scan,
  // volumes follow the buttons), not the whole library with it.
  const rebuild = (id: string, make: () => Category) => setCats((cs) => cs.map((c) => (c.id === id ? make() : c)));
  useEffect(() => void (shotsVer && rebuild("photo", screenshotsCategory)), [shotsVer]);
  const systemVer = useSystemSettings();
  useEffect(() => void (systemVer && rebuild("settings", settingsCategory)), [systemVer]);
  // (and as a system update is checked for, downloads and installs: only System Update's own item, as often as each
  // second while one installs)
  const updatesVer = useUpdates(rootRef);
  useEffect(() => {
    if (updatesVer)
      setCats((cs) => cs.map((c) => (c.id !== "settings" ? c : { ...c, items: c.items.map((it) => (it.id === "s-update" ? systemUpdateItem() : it)) })));
  }, [updatesVer]);

  // (counted again while the XMB is on screen: not behind a game)
  const [friendsOnline, setFriendsOnline] = useState(0);
  useEffect(() => {
    const count = () => setFriendsOnline(loadFriends().filter((f) => f.presence !== "offline").length);
    count();
    const id = setInterval(() => onScreen(rootRef.current) && count(), FRIENDS_ONLINE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // navigation state
  const [catIdx, setCatIdx] = useState(() =>
    Math.max(
      0,
      cats.findIndex((c) => c.id === memory.cat),
    ),
  );
  const [selIds, setSelIds] = useState<Record<string, string>>(() => ({ ...memory.sel }));
  // A folder opening or closing, for the moment it takes (the PS3's slide between the column and the strip).
  const [motion, setMotion] = useState<"open" | "close" | null>(null);
  useEffect(() => {
    if (!motion) return;
    const t = setTimeout(() => setMotion(null), FOLDER_MS + FOLDER_IN_DELAY_MS);
    return () => clearTimeout(t);
  }, [motion]);
  const [stack, setStack] = useState<Level[]>(() => {
    const c = cats.find((x) => x.id === memory.cat);
    const out: Level[] = [];
    let items = c?.items ?? [];
    for (const id of c ? memory.open : []) {
      const folder = items.find((it) => it.id === id);
      if (!folder?.children) break;
      out.push(openLevel(c!.id, out, folder));
      items = out[out.length - 1].items;
    }
    return out;
  });
  const [confirm, setConfirm] = useState<{ item: Item; yes: boolean } | null>(null);
  // The side panel: a game's options (△ on a game) or a setting's choices.
  // sub: the selection in an option's ▸ submenu, while it's open (Theme > a theme > Apply, Delete, Information).
  // column: which folders the Game column lists (△ on one of its folders).
  const [panel, setPanel] = useState<{ game?: Game; setting?: Item; actions?: PanelEntry[]; plain?: true; column?: true; sel: number; sub?: number } | null>(
    null,
  );
  // A PS3 information screen (System Information): the XMB gives way to it; ✕ or ○ goes back.
  const [screen, setScreen] = useState<{ title: string; icon: IconName; lines: [string, string][] } | null>(null);
  const [info, setInfo] = useState<{ title: string; lines: [string, string][] } | null>(null); // Information
  const [viewing, setViewing] = useState(false); // the selected screenshot, full screen
  // A profile open (✕ on you, atop the friends, or on a friend); pick: your colour selected while choosing one (◀ opens the colours).
  const [card, setCard] = useState<{ pick?: number } | null>(null);

  // Open folders are rebuilt when what they show changes, keeping the selection on the same item: in Settings, themes
  // (installed, switched, files found) and system settings; in Soundtracks, track lists loaded and playback; in Screenshots,
  // the screenshots; in Network, a game's trophies (read as its folder in Trophy Collection opens). Only the column
  // the folders are open in is looked at (Trophy Collection's games aren't read again as a network scan goes on).
  const themesVer = useThemes();
  const soundtracksVer = useSoundtracks();
  const trophiesVer = useTrophyLists();
  const openIn = cats[Math.min(catIdx, cats.length - 1)].id;
  const folderVer: Record<string, unknown> = {
    settings: `${themesVer}|${systemVer}|${s.customTheme}`,
    music: soundtracksVer,
    photo: shotsVer,
    network: `${trophiesVer}|${s.trophySort}|${s.trophyGroups}|${s.trophyShowHidden}|${s.trophyHidden.join()}`, // (and a game's trophies sorted or grouped again, or games hidden)
  };
  useEffect(() => {
    setStack((st) =>
      st.map((l) => {
        const items = l.folder.children!();
        const at = items.findIndex((it) => it.id === l.items[l.sel]?.id);
        return { ...l, items, sel: at >= 0 ? at : Math.min(l.sel, Math.max(0, items.length - 1)) };
      }),
    );
  }, [openIn, folderVer[openIn]]);
  // An open setting's choices too (Theme, after one's installed or deleted).
  useEffect(() => {
    setPanel((p) => {
      if (!p?.setting) return p;
      const fresh = (stack.length ? stack[stack.length - 1].folder.children!() : cat.items).find((it) => it.id === p.setting!.id);
      return fresh ? { ...p, setting: fresh } : p;
    });
  }, [themesVer]);

  const cat = cats[Math.min(catIdx, cats.length - 1)];
  // Friends come and go and start or stop games: refresh while the Friends column is open (and on screen).
  const refreshFriends = () => rebuild("friends", friendsCategory);
  useEffect(() => {
    if (cat.id !== "friends") return;
    const id = setInterval(() => onScreen(rootRef.current) && refreshFriends(), FRIENDS_REFRESH_MS);
    return () => clearInterval(id);
  }, [cat.id]);
  // (and at once as you set your status)
  const statusVer = useMyStatus();
  useEffect(() => void (statusVer && refreshFriends()), [statusVer]);
  const rootSel = Math.max(
    0,
    cat.items.findIndex((it) => it.id === selIds[cat.id]),
  );
  const level = stack[stack.length - 1];
  const items = level ? level.items : cat.items;
  // A folder of screenshots shows them as the PS3's grid of pictures, three to a row.
  const grid = !!level && items.length > 0 && items.every((it) => it.picture);
  const sel = level ? level.sel : rootSel;
  const current: Item | undefined = items[sel];
  // △ on a folder in the Game column (All Games and those listed after it) chooses which folders it lists.
  const columnMenu = cat.id === "game" && !level && !!current?.children;
  // A folder that does something while it's open (Register New Device: searches for devices) starts as it opens, and
  // stops as it's left (backed out of, or another opened inside it).
  const openFolder = level?.folder;
  useEffect(() => openFolder?.whileOpen?.(), [openFolder?.id]);
  // Trophy Collection: as the selection moves, its games' progress waits till it settles, then the nearest are asked first.
  useEffect(() => {
    if (openFolder?.id !== "achievements") return;
    const near: number[] = [];
    for (let k = 0; k <= AHEAD; k++)
      for (const i of k ? [level.sel + k, level.sel - k] : [level.sel]) {
        const appid = level.items[i]?.trophies;
        if (appid !== undefined) near.push(appid);
      }
    achievementsScrolled(near);
  }, [level?.sel, openFolder?.id]);
  // Your level and latest trophies, read again as you're selected.
  const meId = current?.me ? current.friend?.steamid : undefined;
  useEffect(() => void (meId && refreshProfile(meId)), [meId]);
  // A friend's, once they've stayed selected a moment (not each passed on the way down the list), so it's ready to
  // open; at once if their card is opened first.
  const friendId = current?.friend && !current.me ? current.friend.steamid : undefined;
  useEffect(() => {
    if (!friendId) return;
    const t = setTimeout(() => refreshFriendProfile(friendId), card ? 0 : 500);
    return () => clearTimeout(t);
  }, [friendId, !!card]);
  // (a profile closed if its friend is gone from the list under it: Steam's friends not read, say)
  const cardId = current?.friend?.steamid;
  useEffect(() => void (card && !cardId && setCard(null)), [card, cardId]);

  useEffect(() => {
    memory.cat = cat.id;
    memory.sel = selIds;
  }, [cat.id, selIds]);
  useEffect(() => {
    memory.open = stack.map((l) => l.folder.id);
    stack.forEach((l, i) => {
      const id = l.items[l.sel]?.id;
      if (id) memory.folderSel[folderKey(cat.id, memory.open.slice(0, i + 1))] = id;
    });
  }, [stack]);

  const setSel = (i: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, i));
    if (clamped === sel) return false;
    if (level) setStack([...stack.slice(0, -1), { ...level, sel: clamped }]);
    else setSelIds({ ...selIds, [cat.id]: items[clamped].id });
    return true;
  };

  // game background (PIC1)
  const [bgGame, setBgGame] = useState<Item | undefined>();
  const [bgLoaded, setBgLoaded] = useState<string | null>(null);
  useEffect(() => {
    setBgGame(undefined);
    if (!current?.game || !s.backgrounds) return;
    const t = setTimeout(() => setBgGame(current), BG_DELAY_MS);
    return () => clearTimeout(t);
  }, [current?.id, s.backgrounds]);

  // game music (ThemeDeck tracks)
  const hoverAppid = current?.game?.appid ?? null;
  useEffect(() => musicFocus(hoverAppid), [hoverAppid, s.music]);
  useEffect(() => () => musicLeave(), []);

  // actions
  const activate = (it: Item | undefined) => {
    if (!it) return;
    if (it.friend) {
      // (your profile, or a friend's)
      playSound("open");
      setCard({});
    } else if (it.picture) {
      playSound("open");
      setViewing(true);
    } else if (it.screen) {
      playSound("open");
      const { title, icon, lines, pending } = it.screen;
      setScreen({ title, icon, lines: pending?.() ?? [] });
      void lines().then((l) => setScreen((sc) => (sc?.title === title ? { ...sc, lines: l } : sc)));
    } else if (it.children) {
      playSound("open");
      setMotion("open");
      setStack([...stack, openLevel(cat.id, stack, it, true)]);
    } else if (it.game) {
      const g = it.game;
      if (s.gameConfirm === "launch" && g.installed) {
        playSound("launch");
        startGame(g);
      } else if (s.gameConfirm === "page") {
        playSound("open");
        openGamePage(g);
      } else {
        playSound("open");
        setPanel({ game: g, sel: 0 });
      }
    } else if (it.actions) {
      playSound("open");
      setPanel({ actions: it.actions(), sel: 0 });
    } else if (it.choices) {
      playSound("open");
      const at = it.choices.options.findIndex((o) => o.value === it.choices!.current());
      setPanel({ setting: it, sel: Math.max(0, at) + (it.choices.head ? 1 : 0) });
    } else if (it.confirm) {
      playSound("dialog");
      // (The PS3's full-screen question starts on Yes; the small dialog on No.)
      setConfirm({ item: it, yes: !!it.confirmScreen });
    } else if (it.run) {
      playSound("open");
      it.run();
    } else {
      playSound("error");
    }
  };

  const nativeMenu = (g: Game, e?: any) =>
    openNativeGameMenu(g.appid, g.overview, e?.currentTarget ?? rootRef.current ?? undefined, rootRef.current?.ownerDocument?.defaultView);

  const panelItems: PanelEntry[] = panel?.actions
    ? panel.actions
    : panel?.column
      ? gameColumnOptions(s)
      : panel?.game
        ? gameOptions(panel.game, nativeMenu)
        : panel?.setting
          ? settingOptions(panel.setting, activate)
          : [];
  // Picking a colour previews it live; ○ (closing without choosing) puts the saved one back.
  const swatch = panel?.setting?.choices?.swatch;
  const previewTheme = swatch ? (panelItems[panel!.sel]?.id as ThemeKey) : undefined;
  // Picking a brightness likewise: the background fades to the selected one.
  const previewBrightness = panel?.setting?.choices?.brightness ? panelItems[panel.sel]?.id : undefined;
  const plainList = !!(panel?.plain || panel?.setting?.choices?.head || panel?.setting?.choices?.plain);
  // The side panels' light (--xmb-sheet) and the friend card's colour (--xmb-glow), in the (previewed) theme colour.
  const panelGlow = glowColor(themeColor(previewTheme ?? s.theme, now));
  const sheetGlow = sheetColor(previewTheme ?? s.theme, now);

  const closePanel = () => {
    setPanel(null);
    playSound("back");
  };

  // The selected option's ▸ submenu, if it has one: it opens on the current choice.
  const subOptions = panel ? panelItems[panel.sel]?.more : undefined;
  const subStart = Math.max(0, subOptions?.findIndex((o) => o.checked) ?? 0);
  // (Sort By selected: the list behind shows every row at full size, as the PS3 does)
  const zoom = !!panel && !!panelItems[panel.sel]?.zoom;
  const closeSub = () => {
    setPanel((p) => p && { ...p, sub: undefined });
    playSound("back");
  };
  const runSub = (o: SubOption) => {
    playSound(o.confirm ? "dialog" : "open");
    if (o.info) return setInfo(o.info());
    if (o.confirm) {
      // Afterwards back to the list, on the option above the one that went (Delete).
      const after = () => setPanel((p) => p && { ...p, sub: undefined, sel: Math.max(0, p.sel - 1) });
      return setConfirm({ item: { id: o.id, label: o.label, confirm: o.confirm, run: () => (o.run?.(), after()) }, yes: false });
    }
    setPanel(null);
    o.run?.();
  };

  // Switching theme ("Please wait...") or installing one: the XMB steps aside and ignores input.
  const installing = installProgress();
  const sync = useAchievementSync(); // (Sync with Server: the same, ○ cancelling it)
  const switching = themeSwitching() || !!installing || !!sync;
  const asking = !!confirm?.item.confirmScreen; // (the XMB gives way to the question, as for a screen)
  /** ✕ or ○ closes what's shown over the XMB (a photo, a page, an information box); false if there's none. */
  const closeOverlay = () => {
    if (!viewing && !info && !screen) return false;
    setViewing(false);
    setInfo(null);
    setScreen(null);
    playSound("back");
    return true;
  };
  // △ on a game, waiting to see if it's held (Steam's menu) or let go (the options panel).
  const optionsHeld = useRef<{ game: Game; timer: ReturnType<typeof setTimeout> } | null>(null);
  const backPresses = useRef({ n: 0, at: 0 });
  useEffect(() => () => clearTimeout(optionsHeld.current?.timer), []);
  const h = useGamepadHandlers({
    dir: (e: any) => {
      const b = e.detail?.button;
      consume(e);
      if (switching || info || screen) return;
      if (card) {
        // ◀ opens the colours; then the arrows move through them (five to a row), each shown on the card as it's selected.
        if (card.pick === undefined) {
          if (b === GamepadButton.DIR_LEFT && current?.me) {
            setCard({ pick: Math.max(0, PROFILE_COLOURS.indexOf(s.profileColour)) });
            playSound("open");
          }
          return;
        }
        const col = card.pick % PROFILE_COLS;
        const step =
          b === GamepadButton.DIR_LEFT
            ? col > 0 && -1
            : b === GamepadButton.DIR_RIGHT
              ? col < PROFILE_COLS - 1 && 1
              : b === GamepadButton.DIR_UP
                ? -PROFILE_COLS
                : PROFILE_COLS;
        const next = card.pick + (step || 0);
        if (next !== card.pick && next >= 0 && next < PROFILE_COLOURS.length) {
          setCard({ pick: next });
          playSound("move");
        }
        return;
      }
      if (viewing) {
        // ◀ ▶ the screenshot before or after it (the list's selection follows, so ○ comes back to the last one seen).
        const step = b === GamepadButton.DIR_RIGHT || b === GamepadButton.DIR_DOWN ? 1 : -1;
        if (items[sel + step]?.picture && setSel(sel + step)) playSound("move");
        return;
      }
      if (confirm) {
        // ◀ to Yes, ▶ to No: each stops at its end rather than going round.
        const yes = b === GamepadButton.DIR_LEFT ? true : b === GamepadButton.DIR_RIGHT ? false : confirm.yes;
        if (yes !== confirm.yes) {
          setConfirm({ ...confirm, yes });
          playSound("move");
        }
        return;
      }
      if (panel && subOptions && panel.sub !== undefined) {
        if (b === GamepadButton.DIR_UP || b === GamepadButton.DIR_DOWN) {
          const next = Math.max(0, Math.min(subOptions.length - 1, panel.sub + (b === GamepadButton.DIR_DOWN ? 1 : -1)));
          if (next !== panel.sub) {
            setPanel({ ...panel, sub: next });
            playSound("move");
          }
        } else if (b === GamepadButton.DIR_LEFT) closeSub();
        return;
      }
      if (panel) {
        if (b === GamepadButton.DIR_UP || b === GamepadButton.DIR_DOWN) {
          const next = Math.max(0, Math.min(panelItems.length - 1, panel.sel + (b === GamepadButton.DIR_DOWN ? 1 : -1)));
          if (next !== panel.sel) {
            setPanel({ ...panel, sel: next });
            playSound("move");
          }
        } else if (b === GamepadButton.DIR_RIGHT && subOptions) {
          setPanel({ ...panel, sub: subStart });
          playSound("open");
        } else if (b === GamepadButton.DIR_LEFT) closePanel();
        return;
      }
      if (grid) {
        // ▲ ▼ a row (onto the last picture, going down to a shorter row); ◀ ▶ along it, ◀ from its first backing out.
        const col = sel % GRID_COLS;
        let next = sel;
        if (b === GamepadButton.DIR_UP) next = sel - GRID_COLS;
        else if (b === GamepadButton.DIR_DOWN)
          next = Math.floor(sel / GRID_COLS) < Math.floor((items.length - 1) / GRID_COLS) ? Math.min(items.length - 1, sel + GRID_COLS) : sel;
        else if (b === GamepadButton.DIR_RIGHT) next = col < GRID_COLS - 1 ? sel + 1 : sel;
        else if (b === GamepadButton.DIR_LEFT) {
          if (col === 0) return h.back(e);
          next = sel - 1;
        }
        if (next >= 0 && next < items.length && next !== sel && setSel(next)) playSound("move");
        return;
      }
      if (b === GamepadButton.DIR_UP || b === GamepadButton.DIR_DOWN) {
        if (setSel(sel + (b === GamepadButton.DIR_DOWN ? 1 : -1))) playSound("move");
      } else if (b === GamepadButton.DIR_LEFT || b === GamepadButton.DIR_RIGHT) {
        if (level) {
          // In a folder, ◀ backs out (as on the PS3); ▶ does nothing.
          if (b === GamepadButton.DIR_LEFT) h.back(e);
          return;
        }
        const next = catIdx + (b === GamepadButton.DIR_RIGHT ? 1 : -1);
        if (next >= 0 && next < cats.length) {
          setCatIdx(next);
          setMotion(null); // (a folder just closed: the new category's list comes on as usual, not sliding back from the strip)
          playSound("category");
        }
      }
    },
    down: (e: any) => {
      const b = e.detail?.button;
      if (confirm || panel || switching || info || viewing || screen || card) return;
      if (b === GamepadButton.BUMPER_LEFT || b === GamepadButton.BUMPER_RIGHT) {
        consume(e);
        if (setSel(sel + (b === GamepadButton.BUMPER_RIGHT ? 6 : -6))) playSound("move");
      }
    },
    ok: (e: any) => {
      consume(e);
      if (switching || closeOverlay()) return;
      if (card) {
        if (card.pick === undefined) return;
        updateSettings({ profileColour: PROFILE_COLOURS[card.pick] });
        setCard({});
        playSound("open");
        return;
      }
      if (confirm) {
        const { item, yes } = confirm;
        setConfirm(null);
        if (yes) item.run?.();
        else playSound("back");
        return;
      }
      if (panel && subOptions && panel.sub !== undefined) {
        runSub(subOptions[panel.sub]);
        return;
      }
      if (panel) {
        const entry = panelItems[panel.sel];
        // An option with a submenu (an installed theme) opens it, as on the PS3.
        if (entry?.more?.length) {
          setPanel({ ...panel, sub: subStart });
          playSound("open");
          return;
        }
        if (entry?.keepOpen) {
          playSound("move");
          entry.run(e);
          return;
        }
        setPanel(null);
        if (entry?.confirm) {
          playSound("dialog");
          setConfirm({ item: { id: entry.id, label: entry.label, confirm: entry.confirm, run: () => entry.run(e) }, yes: false });
        } else if (entry) {
          playSound(entry.sound ?? "open");
          entry.run(e);
        }
        return;
      }
      activate(current);
    },
    back: (e: any) => {
      if (sync) {
        playSound("back");
        cancelSync();
        return consume(e);
      }
      if (switching || closeOverlay()) return consume(e);
      if (card) {
        consume(e);
        setCard(card.pick === undefined ? null : {}); // (the colours closed without choosing: the saved one back)
        playSound("back");
      } else if (confirm) {
        consume(e);
        setConfirm(null);
        playSound("back");
      } else if (panel?.sub !== undefined) {
        consume(e);
        closeSub();
      } else if (panel) {
        consume(e);
        closePanel();
      } else if (stack.length) {
        consume(e);
        setMotion("close");
        setStack(stack.slice(0, -1));
        playSound("back");
      } else {
        // (on the XMB itself, nothing open: ○ ○ ○ goes to the Game column)
        const now = Date.now();
        const p = backPresses.current;
        p.n = now - p.at < BACK_TRIPLE_MS ? p.n + 1 : 1;
        p.at = now;
        if (p.n < 3) return;
        p.n = 0;
        const game = cats.findIndex((c) => c.id === "game");
        if (game < 0 || game === catIdx) return;
        consume(e);
        setCatIdx(game);
        setMotion(null);
        playSound("category");
      }
    },
    options: (e: any) => {
      consume(e);
      if (card) {
        // (your Steam Community profile, in Steam's browser)
        if (card.pick === undefined && current?.friend) {
          playSound("open");
          openProfile(current.friend);
        }
        return;
      }
      if (switching || info || confirm || viewing || screen) return;
      if (panel) return closePanel();
      if (current?.options) {
        playSound("options");
        const { run, actions } = current.options;
        if (!actions) return run?.();
        // (△'s options: the PS3's plain list, on the one that's ticked: your status)
        const list = actions();
        return setPanel({
          actions: list,
          plain: true,
          sel: Math.max(
            0,
            list.findIndex((a) => a.checked),
          ),
        });
      }
      if (columnMenu) {
        playSound("options");
        return setPanel({ column: true, sel: 0 });
      }
      if (!current?.game) return playSound("error");
      // (a game's options: Play, Trophies, details…, Steam's own menu under More Options; △ held: that menu at once)
      if (e?.detail?.button !== GamepadButton.OPTIONS) {
        playSound("options");
        return setPanel({ game: current.game, sel: 0 });
      }
      if (optionsHeld.current) return; // (repeats while held)
      const game = current.game;
      const target = e?.currentTarget;
      optionsHeld.current = {
        game,
        timer: setTimeout(() => {
          optionsHeld.current = null;
          nativeMenu(game, { currentTarget: target }); // (its own sound, as Steam's menu shows)
        }, OPTIONS_HOLD_MS),
      };
    },
    up: (e: any) => {
      const held = optionsHeld.current;
      if (!held || e?.detail?.button !== GamepadButton.OPTIONS) return;
      clearTimeout(held.timer);
      optionsHeld.current = null;
      playSound("options");
      setPanel({ game: held.game, sel: 0 });
    },
  });

  // Starting a game, as the PS3 does: the art goes, the menu zooms towards you and fades, and the game starts behind the
  // background (launch.ts); once it's ready the background goes black but for the wave's sparkles (dark), and the game
  // is shown. Nothing is taken meanwhile.
  const [launching, setLaunching] = useState<Game | null>(null);
  const [dark, setDark] = useState<number>();
  useEffect(() => setLaunchAnimator(setLaunching), []);
  useEffect(() => {
    if (!launching) return;
    let started = false;
    const t = setTimeout(() => {
      started = true;
      launchBehindXMB(launching, {
        dark: () => setDark(Date.now()),
        done: () => {
          // (the XMB back as it was: behind the game, or for Steam's question)
          setLaunching(null);
          setDark(undefined);
        },
      });
    }, LAUNCH_START_MS);
    return () => {
      clearTimeout(t);
      if (!started) launchGame(launching); // (gone first: started anyway)
    };
  }, [launching]);
  const idle = launching ? consume : undefined;

  const inFolder = stack.length > 0;
  // The background blurs inside Trophy Collection, behind a profile card (yours or a friend's), and while choosing,
  // installing or switching to a theme.
  const themeBusy = panel?.setting?.id === "th-theme" || !!installing || themeSwitching();
  const blurred = stack[0]?.folder.id === "achievements" || !!(card && current?.friend) || themeBusy;
  // The clock's hands wind round again each time it comes back (from a page over it, a photo, a menu), as on the PS3.
  const clockHidden = !!(panel || screen || card || asking || viewing || switching);
  const [clockShown, setClockShown] = useState(0);
  const clockWasHidden = useRef(clockHidden);
  useEffect(() => {
    if (clockWasHidden.current && !clockHidden) setClockShown((n) => n + 1);
    clockWasHidden.current = clockHidden;
  }, [clockHidden]);

  return (
    <Focusable
      // @ts-ignore autoFocus exists at runtime
      autoFocus
      noFocusRing
      onGamepadDirection={idle ?? h.dir}
      onButtonDown={idle ?? h.down}
      onButtonUp={idle ?? h.up}
      onOKButton={idle ?? h.ok}
      onOKActionDescription={
        panel || !current?.game ? "Select" : s.gameConfirm === "launch" && current.game.installed ? (isRunning(current.game) ? "Resume" : "Play") : "Open"
      }
      onCancelButton={idle ?? h.back}
      onCancelActionDescription={inFolder || confirm || panel || screen || card ? "Back" : undefined}
      onOptionsButton={idle ?? h.options}
      onOptionsActionDescription={card ? undefined : (current?.options?.label ?? (current?.game || columnMenu ? "Options" : undefined))}
      onMenuButton={idle ?? h.options}
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}
    >
      <div
        ref={rootRef}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          fontFamily: FONT,
          color: "#fff",
          ["--xmb-glow" as any]: panelGlow.join(","),
          ["--xmb-sheet" as any]: rgb(sheetGlow),
        }}
      >
        <style>{CSS}</style>
        {/* The wave fades away once a game's art has loaded over it; blurred (above), as behind the PS3's Trophy Collection. */}
        <ThemedWave
          now={now}
          hidden={!launching && !!bgGame?.game && bgLoaded === bgGame.id}
          blur={blurred && !launching}
          theme={previewTheme}
          brightness={previewBrightness}
          dark={dark}
        />
        {bgGame?.game && (
          <div key={bgGame.id} className="xmb-bg" style={launching ? { opacity: 0, transition: `opacity ${LAUNCH_ART_MS}ms ease-out` } : undefined}>
            <FallbackImg srcs={bgGame.game.background} style={{ width: "100%", height: "100%", objectFit: "cover" }} onLoad={() => setBgLoaded(bgGame.id)} />
            <div
              style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.5) 50%, rgba(0,0,0,.3) 100%)" }}
            />
          </div>
        )}
        <div className={launching ? "xmb-launch" : undefined} style={{ position: "absolute", inset: 0 }}>
          <Stage box={box}>
            {s.clock && (
              <div style={{ opacity: clockHidden ? 0 : 1, transition: "opacity 200ms" }}>
                <Clock now={now} friendsOnline={friendsOnline} shown={clockShown} />
              </div>
            )}
            {/* Switching theme, the XMB gives way to "Please wait..." and comes back with the new theme. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                opacity: switching || screen || card || asking ? 0 : 1,
                transition: switching || screen || card || asking ? "opacity 200ms ease-out" : "opacity 500ms ease-in",
              }}
            >
              <CategoryBar cats={cats} catIdx={catIdx} inFolder={inFolder} />
              {inFolder && (
                <ParentColumn
                  items={stack.length > 1 ? stack[stack.length - 2].items : cat.items}
                  sel={stack.length > 1 ? stack[stack.length - 2].sel : rootSel}
                  inFolder={stack.length > 1}
                  // (opening: each comes from where it was in the column, itself in a folder if this one's inside another)
                  from={motion === "open" ? (it, d) => columnBox(it, d, stack.length > 1) : undefined}
                />
              )}
              {/* While choosing a setting the list dims and its values hide, as on the PS3. */}
              <div className="xmb-anim" style={{ position: "absolute", inset: 0, opacity: panel?.setting ? 0.45 : 1 }}>
                {grid ? (
                  <PictureGrid key={`f:${level!.folder.id}`} items={items} sel={sel} motion={motion} />
                ) : (
                  <Column
                    key={level ? `f:${level.folder.id}` : `c:${cat.id}`}
                    items={items}
                    sel={sel}
                    inFolder={inFolder}
                    hideValues={!!panel?.setting || !!panel?.plain} // (and your trophies and level, under your status list)
                    zoom={zoom}
                    motion={motion}
                  />
                )}
              </div>
              {panel && swatch && <ColourPanel entries={panelItems} sel={panel.sel} swatch={swatch} />}
              {/* Plain lists of names: Theme (with Install above), Brightness, Deep Blacks. */}
              {panel && !swatch && plainList && (
                <ListPanel
                  entries={panelItems}
                  sel={panel.sel}
                  sub={
                    subOptions && panel.sub !== undefined
                      ? { options: subOptions, sel: panel.sub, picture: panel.setting?.choices?.picture?.(panelItems[panel.sel].id) }
                      : undefined
                  }
                />
              )}
              {panel && !swatch && !plainList && <OptionsPanel entries={panelItems} sel={panel.sel} />}
            </div>
            {installing ? <InstallScreen p={installing} /> : sync ? <SyncScreen p={sync} /> : switching && <PleaseWait title="Theme" icon="theme" />}
            {screen && <InfoScreen {...screen} />}
            {card &&
              current?.friend &&
              (current.me ? (
                <ProfileScreen me={current.friend} colour={card.pick !== undefined ? PROFILE_COLOURS[card.pick] : s.profileColour} pick={card.pick} />
              ) : (
                <FriendProfileScreen friend={current.friend} />
              ))}
            {asking && <ConfirmScreen text={confirm!.item.confirm!} yes={confirm!.yes} />}
          </Stage>
        </div>
        {confirm && !asking && <Confirm text={confirm.item.confirm!} yes={confirm.yes} />}
        {info && <InfoDialog title={info.title} lines={info.lines} />}
        {viewing && current?.picture && (
          <PictureViewer
            src={current.picture}
            label={current.label}
            at={sel} // (only screenshots are in a screenshots folder)
            of={items.length}
            near={[items[sel - 1]?.picture, items[sel + 1]?.picture]}
          />
        )}
      </div>
    </Focusable>
  );
}

/**
 * A screenshot full screen, over everything (as the PS3 shows a photo), with where it is in its folder.
 * The ones either side load meanwhile, unseen, so ◀ ▶ show them at once.
 */
function PictureViewer({ src, label, at, of, near }: { src: string; label: string; at: number; of: number; near: (string | undefined)[] }) {
  return (
    <div className="xmb-wait" style={{ position: "absolute", inset: 0, background: "#000" }}>
      <img key={src} src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
      {near.map((n) => n && <img key={n} src={n} style={{ display: "none" }} />)}
      <div
        className="xmb-text"
        style={{ position: "absolute", left: 24, right: 24, bottom: 16, display: "flex", justifyContent: "space-between", fontSize: 15, opacity: 0.85 }}
      >
        <span>{label}</span>
        <span>{of > 1 ? `${at > 0 ? "◀ " : ""}${at + 1} / ${of}${at < of - 1 ? " ▶" : ""}` : ""}</span>
      </div>
    </div>
  );
}

/** The category icons. Inside a folder only the current one stays, moved top-left. */
function CategoryBar({ cats, catIdx, inFolder }: { cats: Category[]; catIdx: number; inFolder: boolean }) {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {cats.map((c, i) => {
        const on = i === catIdx;
        // (In a folder the others slide left with it as they fade, as on the PS3.)
        const x = inFolder && on ? F_CAT_X : COL_X + (i - catIdx) * CAT_GAP + (inFolder ? F_CAT_X - COL_X : 0);
        const y = BAR_Y; // (in a folder too: on the PS3 it only slides left)
        return (
          <div
            key={c.id}
            className="xmb-anim"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${x - CAT_ICON / 2}px, ${y - CAT_ICON / 2}px) scale(${on ? 1 : 0.8})`,
              opacity: on ? 1 : inFolder ? 0 : 0.7,
              width: CAT_ICON,
            }}
          >
            <div className={on ? "xmb-glow" : undefined}>
              <Icon name={c.icon} size={CAT_ICON} />
            </div>
            <div
              className="xmb-text"
              style={{
                position: "absolute",
                top: CAT_ICON + 4,
                left: -60,
                width: CAT_ICON + 120,
                textAlign: "center",
                fontSize: 17,
                opacity: on && !inFolder ? 1 : 0,
                transition: "opacity 160ms",
              }}
            >
              {c.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Landscape art to draw an item with (a game's, or a soundtrack's), if any. */
const PRELOAD = 15; // rows either side of the selection whose pictures are got ready (preloadImage)
/** A game's logo (Theme Settings > Game Icons: Logo), drawn whole and see-through rather than as capsule art. */
const logoOf = (item: Item) => (getSettings().gameArt === "logo" ? (item.game?.logo ?? item.logo) : undefined);
const artOf = (item: Item) => logoOf(item) ?? item.game?.icon ?? item.art;

/** A small picture of an item: its glyph, or a game's landscape art. */
function ItemIcon({ item, size }: { item: Item; size: number }) {
  if (item.cover) {
    return (
      <div style={{ width: size, height: size }}>
        <FallbackImg srcs={item.cover} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 2 }} fallback={<GameTile name="" />} />
      </div>
    );
  }
  const logos = logoOf(item);
  const art = logos ?? item.game?.icon ?? item.art; // (artOf, the logo setting read once)
  if (art) {
    const logo = !!logos;
    return (
      <div style={{ width: size * 2, height: size }}>
        <FallbackImg
          srcs={art}
          style={{ width: "100%", height: "100%", objectFit: logo ? "contain" : "cover", borderRadius: logo ? 0 : 2 }}
          fallback={<GameTile name="" />}
        />
      </div>
    );
  }
  return <Icon name={item.icon ?? "info"} size={size} badge={item.badge} />;
}

/** Inside a folder: the column it was opened from, as small dimmed icons, with the opened item beside it. */
function ParentColumn({ items, sel, inFolder, from: origin }: { items: Item[]; sel: number; inFolder: boolean; from?: (it: Item, d: number) => Box }) {
  const from = Math.max(0, sel - 5);
  const cls = origin ? "xmb-anim xmb-travel" : "xmb-anim";
  return (
    <>
      {items.slice(from, sel + 8).map((it, k) => {
        const d = from + k - sel;
        const box = stripBox(it, d, inFolder);
        const at: [number, number] = [box.cx - box.w / 2, box.cy - box.h / 2];
        // Opening a folder, each icon slides (and shrinks a little) here from where it was in the column.
        const enter = origin ? travel(box, origin(it, d), at) : {};
        if (d === 0) {
          return (
            <div key={it.id} className={cls} style={{ position: "absolute", left: 0, top: 0, transform: `translate(${at[0]}px, ${at[1]}px)`, ...enter }}>
              <div className="xmb-glow">
                <ItemIcon item={it} size={box.h} />
              </div>
              {/* The arrow: the list on the right is inside this item */}
              <div
                style={{
                  position: "absolute",
                  left: F_OPEN_X + 89 - at[0],
                  top: box.h / 2 - 8,
                  width: 0,
                  height: 0,
                  borderTop: "8px solid transparent",
                  borderBottom: "8px solid transparent",
                  borderRight: "13px solid rgba(255,255,255,.9)",
                  filter: "drop-shadow(0 0 4px rgba(255,255,255,.6))",
                }}
              />
            </div>
          );
        }
        return (
          <div
            key={it.id}
            className={cls}
            style={{ position: "absolute", left: 0, top: 0, opacity: F_STRIP_OPACITY, transform: `translate(${at[0]}px, ${at[1]}px)`, ...enter }}
          >
            <ItemIcon item={it} size={box.h} />
          </div>
        );
      })}
    </>
  );
}

// Folders opening and closing: the same items travel between the column and the strip beside the open folder
const FOLDER_MS = 260; // the slide (on the PS3 most of it is over in ~130ms; it has settled by ~270ms)
const FOLDER_IN_DELAY_MS = 230; // a folder's contents fade in once the slide has (nearly) settled

/** Where an item's icon is drawn: its centre and width. */
type Box = { cx: number; cy: number; w: number; h: number };

/** An item's icon in a column, d rows from the selection (as Row draws it). */
function columnBox(item: Item, d: number, inFolder: boolean): Box {
  const art = !!artOf(item);
  const on = d === 0;
  const w = art ? (on ? GAME_W_SEL : GAME_W) : item.cover ? (on ? COVER_SEL : COVER) : on ? GLYPH_SEL : GLYPH;
  const h = art ? Math.round(w * ratio) : w;
  const left = (inFolder ? F_COL_X : COL_X) - w / 2;
  return { cx: left + w / 2, cy: rowTop(d, inFolder) + h / 2, w, h };
}

/**
 * An item's icon in the strip beside an open folder (d = 0 is the open folder), the column it was in having been
 * laid out in a folder or not. As on the PS3 each stays at the height it had there: the column only slides left.
 */
function stripBox(item: Item, d: number, inFolder: boolean): Box {
  const wide = !item.cover && !!artOf(item); // (landscape art: drawn twice as wide as high)
  // The open folder keeps its size (landscape art: as an unselected game's, clear of the arrow); the rest shrink a little.
  const h = d === 0 ? (wide ? GAME_W / 2 : GLYPH_SEL) : F_PARENT_ICON;
  return { cx: d === 0 ? F_OPEN_X : F_PARENT_X, cy: columnBox(item, d, inFolder).cy, w: wide ? h * 2 : h, h };
}

/**
 * Styles that start an element whose icon is drawn at `here` (the element translated to `at`) with that icon at `there`
 * instead, moved and scaled, from where xmb-travel eases it to where it's drawn (from `opacity`, if given).
 */
function travel(here: Box, there: Box, at: [number, number], opacity?: number): Record<string, string | number> {
  const k = there.w / here.w;
  const x = there.cx - k * (here.cx - at[0]);
  const y = there.cy - k * (here.cy - at[1]);
  return { "--from": `translate(${x}px, ${y}px) scale(${k})`, ...(opacity !== undefined ? { "--from-o": opacity } : {}) };
}

function rowTop(d: number, inFolder: boolean, zoom = false): number {
  // Every row the same size, evenly apart: the selected one's centre where it was (its description beside its name).
  if (inFolder && zoom) return F_SEL_TOP + (COVER_SEL - ZOOM_COVER) / 2 + d * ZOOM_ROW;
  if (inFolder) {
    // A plain list centred on the selection (no category bar to climb over).
    if (d === 0) return F_SEL_TOP;
    return d > 0 ? F_SEL_TOP + BELOW + (d - 1) * ROW : F_SEL_TOP - 39 - -d * ROW;
  }
  if (d === 0) return SEL_TOP;
  // Items after the selection sit below it; items before it climb above the category bar.
  if (d > 0) return SEL_TOP + BELOW + (d - 1) * ROW;
  return BAR_Y - ABOVE - GLYPH / 2 - (-d - 1) * ROW;
}

function Column({
  items,
  sel,
  inFolder,
  hideValues,
  zoom = false,
  motion,
}: {
  items: Item[];
  sel: number;
  inFolder: boolean;
  hideValues?: boolean;
  zoom?: boolean; // every row at full size (a trophy's Sort By selected)
  motion?: "open" | "close" | null;
}) {
  const x = inFolder ? F_COL_X : COL_X;
  // The pictures of the rows a few moves away fetched and decoded meanwhile, so they're ready as they slide on.
  useEffect(() => {
    for (const it of items.slice(Math.max(0, sel - PRELOAD), sel + PRELOAD + 1)) preloadImage(artOf(it) ?? it.cover);
  }, [items, sel]);
  if (!items.length) {
    // (in the column, where the first item would be: centred under the category, just below the bar)
    return (
      <div
        className="xmb-text"
        style={{ position: "absolute", left: x, top: SEL_TOP, transform: "translateX(-50%)", fontSize: 22, opacity: 0.8, whiteSpace: "nowrap" }}
      >
        There are no items
      </div>
    );
  }
  // Only the rows on screen, and one or two just off it either side: those slide on as the list moves, rather than
  // fading in where they land (rows are closer together in a folder, so more fit above the selection there).
  const near = (d: number) => {
    const top = rowTop(d, inFolder, zoom);
    return top > -2 * ROW - GAME_W && top < STAGE_H + ROW;
  };
  let from = sel;
  while (from > 0 && near(from - 1 - sel)) from--;
  let to = sel + 1;
  while (to < items.length && near(to - sel)) to++;
  return (
    <>
      {items.slice(from, to).map((it, k) => (
        <Row key={it.id} item={it} d={from + k - sel} x={x} inFolder={inFolder} hideValue={hideValues} zoom={zoom} motion={motion} />
      ))}
    </>
  );
}

// The PS3's grid of pictures (a folder of screenshots): three to a row, the selected one larger and framed with its
// name in a box under it; the selected row stays level with the open folder, the rest scrolling past it.
const GRID_COLS = 3;
const GRID_X = 420; // the first column's centre
const GRID_STEP_X = 265; // (room for the selected one beside the others, not over them)
const GRID_W = 210; // a picture (taller than 16:9, as the PS3's: the sides are cropped)
const GRID_H = 150;
const GRID_SEL = 1.3; // the selected one, this much larger
const GRID_CY = 373; // the selected row's centre (level with the open folder)
const GRID_STEP_Y = 192;
const GRID_LABEL = 62; // the space the selected one's name takes under its row
const GRID_REACH = GRID_H + GRID_STEP_Y + GRID_LABEL; // how far off screen a row's centre is still drawn

/**
 * A picture in the grid: Steam's thumbnail at once (200 wide: blurred at this size), the screenshot itself over it once
 * loaded. That's only asked for once its row is near the selection (the rows just off screen keep the thumbnail), as
 * each is a full-size image to download and decode; once loaded it stays.
 */
function GridPicture({ item, near }: { item: Item; near: boolean }) {
  const [full, setFull] = useState(false);
  const wanted = useRef(false);
  wanted.current ||= near;
  const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
  return (
    <>
      <FallbackImg srcs={item.art ?? [item.picture!]} style={fill} />
      {item.picture && wanted.current && (
        <img
          src={item.picture}
          decoding="async"
          draggable={false}
          onLoad={() => setFull(true)}
          style={{ ...fill, opacity: full ? 1 : 0, transition: "opacity 200ms" }}
        />
      )}
    </>
  );
}

function PictureGrid({ items, sel, motion }: { items: Item[]; sel: number; motion?: "open" | "close" | null }) {
  const entered = useRef(motion === "open" ? "xmb-enter-late" : "xmb-enter").current;
  const selRow = Math.floor(sel / GRID_COLS);
  const cy = (row: number) => GRID_CY + (row - selRow) * GRID_STEP_Y + (row > selRow ? GRID_LABEL : 0);
  const cur = items[sel];
  const selCx = GRID_X + (sel % GRID_COLS) * GRID_STEP_X;
  return (
    <div className={entered} style={{ position: "absolute", inset: 0 }}>
      {items.map((it, i) => {
        const row = Math.floor(i / GRID_COLS);
        const y = cy(row);
        // Only the rows on screen, and one move's worth either side: those slide on as the grid moves, rather than
        // appearing where they land.
        if (y < -GRID_REACH || y > STAGE_H + GRID_REACH) return null;
        const on = i === sel;
        const x = GRID_X + (i % GRID_COLS) * GRID_STEP_X;
        return (
          <div
            key={it.id}
            className="xmb-anim"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: GRID_W,
              height: GRID_H,
              transform: `translate(${x - GRID_W / 2}px, ${y - GRID_H / 2}px) scale(${on ? GRID_SEL : 1})`,
              transformOrigin: "50% 50%",
              zIndex: on ? 1 : 0,
              borderRadius: 4,
              overflow: "hidden",
              background: "rgba(0,0,0,.35)",
              border: on ? "2px solid rgba(255,255,255,.85)" : "1px solid rgba(255,255,255,.35)",
              boxShadow: on ? "0 0 22px rgba(255,255,255,.35), 0 4px 14px rgba(0,0,0,.5)" : "0 3px 10px rgba(0,0,0,.4)",
              opacity: on ? 1 : 0.85,
            }}
          >
            <GridPicture item={it} near={Math.abs(row - selRow) <= 1} />
          </div>
        );
      })}
      {cur && (
        <div
          key={cur.id}
          className="xmb-enter"
          style={{
            position: "absolute",
            left: selCx - (GRID_W * GRID_SEL) / 2,
            width: GRID_W * GRID_SEL,
            top: GRID_CY + (GRID_H * GRID_SEL) / 2 + 8,
            padding: "6px 12px",
            boxSizing: "border-box",
            borderRadius: 6,
            background: "rgba(0,0,0,.45)",
            border: "1px solid rgba(255,255,255,.15)",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <div className="xmb-text" style={{ fontSize: 17, overflow: "hidden", textOverflow: "ellipsis" }}>
            {cur.label}
          </div>
          {cur.sub && (
            <div className="xmb-text" style={{ fontSize: 13, opacity: 0.8, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>
              {cur.sub}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  item,
  d,
  x,
  inFolder,
  hideValue,
  zoom = false,
  motion,
}: {
  item: Item;
  d: number;
  x: number;
  inFolder: boolean;
  hideValue?: boolean;
  zoom?: boolean;
  motion?: "open" | "close" | null;
}) {
  // How a row came on is kept, not worked out again as the folder finishes opening or closing (which would start a new
  // animation over: the fade-in, the whole column blinking); once played it's dropped, so it can't be played again.
  const [entered, setEntered] = useState(motion === "open" ? "xmb-enter-late" : motion === "close" ? "xmb-travel" : "xmb-enter");
  const from = useRef<Record<string, string | number>>();
  if (item.friend) return <FriendRow friend={item.friend} me={!!item.me} d={d} x={x} inFolder={inFolder} hideExtras={!!hideValue} />;
  const on = d === 0;
  const logos = logoOf(item);
  const art = logos ?? item.game?.icon ?? item.art; // (artOf, the logo setting read once)
  const isGame = !!art;
  const logo = !!logos;
  const listed = item.trophies !== undefined || !!item.groupProgress; // (a Trophy Collection entry: its progress beside it)
  const cover = item.cover;
  const w = zoom
    ? isGame
      ? ZOOM_GAME
      : cover
        ? ZOOM_COVER
        : ZOOM_GLYPH
    : isGame
      ? on
        ? GAME_W_SEL
        : GAME_W
      : cover
        ? on
          ? COVER_SEL
          : COVER
        : on
          ? GLYPH_SEL
          : GLYPH;
  // The settings disc is a small bullet on the PS3: drawn smaller, centred in the usual icon box
  // (so the row keeps its height and stays level with the ◀ and the side panels).
  const glyphSel = item.icon === "setting" ? SETTING_SEL : GLYPH_SEL;
  const glyph = item.icon === "setting" ? (on || zoom ? SETTING_SEL : SETTING) : w;
  const hgt = isGame ? Math.round(w * ratio) : w;
  const iconLeft = x - w / 2; // (columns centre their icons, game art too)
  // Game art and covers are drawn at their selected size and scaled down, rather than resized: a scale animates
  // with the move (on the GPU), where a new width and height must be laid out each frame, which falls behind the
  // move on the Deck (a game just left would slide over the next while still large).
  const picture = isGame || !!cover;
  const wSel = isGame ? GAME_W_SEL : COVER_SEL;
  const hSel = isGame ? Math.round(GAME_W_SEL * ratio) : COVER_SEL;
  const scale = w / wSel;
  const textLeft = isGame ? x + wSel / 2 + 22 : x + (cover ? COVER_SEL : GLYPH_SEL) / 2 + 36;
  const textShift = isGame ? `translateX(${(w - wSel) / 2}px)` : undefined;
  const top = rowTop(d, inFolder, zoom);
  const sub = item.game ? describeGame(item.game) : (item.description ?? item.sub);
  const choice = hideValue
    ? undefined
    : (item.choices?.options.find((o) => o.value === item.choices!.current()) ?? (item.value ? { value: "", label: item.value } : undefined));
  // (Game art stays bright either side of the selection, as on the PS3: only its title goes; other items dim.)
  const opacity = on ? 1 : isGame || zoom ? 0.9 : d < 0 ? 0.55 : 0.8;
  // A folder opening, its contents fade in once the column has slid aside; closing, the column it was in
  // grows back out of the strip, each item from its small icon there.
  const cls = `xmb-anim ${entered}`;
  // (Where it grows from is kept from when it came, as `entered` is: moved on meanwhile, the selection changing, it
  // would otherwise jump to growing from another place in the strip, the selected one's, drawn large over the list.)
  const back =
    entered === "xmb-travel"
      ? (from.current ??= travel({ cx: iconLeft + w / 2, cy: top + hgt / 2, w, h: hgt }, stripBox(item, d, inFolder), [0, top], F_STRIP_OPACITY))
      : {};

  return (
    <div
      className={cls}
      style={{ position: "absolute", left: 0, top: 0, transform: `translateY(${top}px)`, opacity, ...back }}
      onAnimationEnd={(e) => e.target === e.currentTarget && setEntered("")}
    >
      <div
        className="xmb-anim"
        style={
          picture
            ? { position: "absolute", left: x - wSel / 2, top: 0, width: wSel, height: hSel, transform: `scale(${scale})`, transformOrigin: "50% 0" }
            : {
                // A glyph too: drawn at its selected size in the selected box and scaled about its centre, so it grows
                // and shrinks with the move (a new size would only be drawn at once, the icon snapping to it).
                position: "absolute",
                left: x - GLYPH_SEL / 2,
                top: 0,
                width: GLYPH_SEL,
                height: GLYPH_SEL,
                transform: `translateY(${(w - GLYPH_SEL) / 2}px) scale(${glyph / glyphSel})`,
              }
        }
      >
        {picture ? (
          <FallbackImg
            srcs={isGame ? art! : cover!}
            style={{
              width: "100%",
              height: "100%",
              objectFit: logo ? "contain" : "cover",
              borderRadius: logo ? 0 : (isGame ? 3 : 2) / scale,
              // (a cover's or logo's shadow follows its shape, for a picture that's see-through: the padlock's glass tile)
              ...(isGame && !logo
                ? { boxShadow: on ? "0 0 24px rgba(255,255,255,.35)" : `0 ${2 / scale}px ${8 / scale}px rgba(0,0,0,.4)` }
                : { filter: on ? "drop-shadow(0 0 12px rgba(255,255,255,.35))" : `drop-shadow(0 ${2 / scale}px ${4 / scale}px rgba(0,0,0,.4))` }),
            }}
            fallback={<GameTile name={item.label} />}
          />
        ) : (
          <div
            className={on ? "xmb-glow" : undefined}
            style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Icon name={item.icon ?? "info"} size={glyphSel} badge={item.badge} />
          </div>
        )}
      </div>
      {/* Same timing as the icon (xmb-anim), so the text moves and resizes in step with the art. A game's title shows
          only while it's selected, as on the PS3 (its art says which it is). */}
      <div
        className="xmb-anim"
        style={{
          position: "absolute",
          left: textLeft,
          top: 0,
          height: hgt,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          whiteSpace: "nowrap",
          opacity: isGame && !on && !listed ? 0 : 1, // (the Trophy Collection names every game, and a game's groups)
          transform: textShift,
        }}
      >
        {/* (with a value beside it, only as far as the value's column: a longer name scrolls while it's selected) */}
        {/* (a trophy's cup before its name, as on the PS3: dimmed until it's earned) */}
        <div style={{ display: "flex", alignItems: "center", gap: on ? 8 : 6 }}>
          {item.trophy && <Cup tier={item.trophy.tier} size={zoom ? 20 : on ? 22 : 17} dim={!item.trophy.earned} />}
          <Marquee
            text={item.label}
            on={on}
            className={on ? "xmb-text xmb-pulse" : "xmb-text"}
            style={{
              fontSize: zoom ? 22 : on ? 25 : 20,
              maxWidth: listed ? TROPHY_RIGHT - TROPHY_W - textLeft - VALUE_GAP : choice ? VALUE_X - textLeft - VALUE_GAP : 760,
              transition: "font-size 190ms cubic-bezier(.2,.7,.3,1)",
            }}
          />
        </div>
        {on && sub && (
          <div className="xmb-text" style={{ fontSize: 15, opacity: 0.8, marginTop: 4, whiteSpace: "pre" }}>
            {sub}
          </div>
        )}
      </div>
      {item.trophies !== undefined && <GameProgress appid={item.trophies} on={on} height={hgt} />}
      {item.groupProgress && <TrophyProgress p={item.groupProgress} on={on} height={hgt} />}
      {/* A setting's current value, in its own column as on the PS3. */}
      {choice && (
        <div
          className="xmb-text"
          style={{
            position: "absolute",
            left: VALUE_X,
            top: 0,
            height: hgt,
            display: "flex",
            alignItems: "center",
            fontSize: on ? 19 : 17,
            opacity: on ? 1 : 0.85,
            whiteSpace: "nowrap",
          }}
        >
          {choice.label ||
            (item.choices!.swatch && (
              <div
                style={{
                  width: SWATCH,
                  height: SWATCH,
                  borderRadius: 2,
                  background: item.choices!.swatch(choice.value),
                  boxShadow: "0 1px 3px rgba(0,0,0,.45)",
                }}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// The PS3's Trophy Collection: how much of each game is earned, at the right; the selected one's bar under it, and a
// platinum trophy beside it once it's all earned.
const TROPHY_RIGHT = 1120;
const TROPHY_W = 110;

function GameProgress({ appid, on, height }: { appid: number; on: boolean; height: number }) {
  const p = useAchievementProgress(appid);
  const late = useRef(p === undefined); // (not known as its row came on: it fades in, rather than appearing)
  return p ? <TrophyProgress p={p} on={on} height={height} late={late.current} /> : null;
}

function TrophyProgress({ p, on, height, late }: { p: AchievementProgress; on: boolean; height: number; late?: boolean }) {
  const pct = Math.floor((p.achieved / p.total) * 100);
  return (
    <div
      className="xmb-text"
      style={{
        position: "absolute",
        left: TROPHY_RIGHT - TROPHY_W,
        width: TROPHY_W,
        top: 0,
        height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center", // (centred over where the bar is, selected or not, so it never moves)
        opacity: on ? 1 : 0.85,
        whiteSpace: "nowrap",
        animation: late ? "xmbFade .35s ease-out" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: on ? 19 : 17 }}>
        {pct === 100 && <Cup tier="platinum" size={on ? 22 : 18} />}
        {pct} %
      </div>
      {on && (
        // The PS3's bar: clear glass, a pale rim and a sheen along its top, filling with green from the left.
        <div
          style={{
            marginTop: 6,
            width: "100%",
            height: 9,
            boxSizing: "border-box",
            padding: 1,
            borderRadius: 5,
            border: "1px solid rgba(255,255,255,.55)",
            background: "linear-gradient(rgba(255,255,255,.28), rgba(255,255,255,.06) 55%, rgba(255,255,255,.14))",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,.35), 0 0 4px rgba(255,255,255,.18)",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              minWidth: pct ? 4 : 0,
              height: "100%",
              borderRadius: 3,
              background: "linear-gradient(#d4f07a, #9cc934 55%, #84b022)",
              boxShadow: "0 0 3px rgba(156,201,52,.55)",
            }}
          />
        </div>
      )}
    </div>
  );
}

// A friend's row: unselected avatars all but touching (as the PS3's), their name and status just past them; the selected
// one bigger on its card, its name and status bigger too. The status lines up with the name, a game's controller under the dot.
const AVATAR = 50; // friend avatars (unselected / selected)
const AVATAR_SEL = 92;
const CARD_W = 660;
const CARD_PAD = 8;
const FRIEND_DROP = 6; // (the selected friend a little lower, so its card clears the category label above)
const FRIEND_LIFT = 4; // the selected name and status, raised a little off the card's middle line
const FRIEND_DOT = 17;
const FRIEND_DOT_GAP = 6; // dot to name
const FRIEND_PAD = 22; // a game's controller, under the dot
const PRESENCE_COLOUR: Record<Presence, string> = { ingame: "#7b73f0", online: "#7b73f0", away: "#e8a33a", offline: "#9a9a9a" };

/** The status line under a friend: their game (and what they're doing in it), or Steam's status text. */
const friendStatus = (f: Friend) => (f.presence === "ingame" ? [f.game, f.detail].filter(Boolean).join("  ") : f.detail);

function PresenceDot({ presence, size }: { presence: Presence; size: number }) {
  return <span className="xmb-dot" style={{ width: size, height: size, background: PRESENCE_COLOUR[presence] }} />;
}

/** An image that fades in once loaded (rather than popping in when it arrives). */
function FadeImg({ style, ...rest }: Parameters<typeof FallbackImg>[0]) {
  const [loaded, setLoaded] = useState(false);
  return <FallbackImg {...rest} style={{ ...style, opacity: loaded ? 1 : 0, transition: "opacity 250ms ease-out" }} onLoad={() => setLoaded(true)} />;
}

function Avatar({ srcs }: { srcs: string[] }) {
  return (
    <div className="xmb-avatar" style={{ width: "100%", height: "100%", boxSizing: "border-box" }}>
      <FadeImg
        srcs={srcs.filter(Boolean)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        fallback={<div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,.18)" }} />}
      />
    </div>
  );
}

/** A friend's colour: their avatar's most vivid shade, brightened; null for a grey avatar (or one that can't be read). */
const avatarColours = new Map<string, Promise<number[] | null>>();
function avatarColour(src: string): Promise<number[] | null> {
  let p = avatarColours.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // (Steam's avatar server allows it; otherwise the pixels can't be read)
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = c.height = 16;
          const g = c.getContext("2d")!;
          g.drawImage(img, 0, 0, 16, 16);
          const px = g.getImageData(0, 0, 16, 16).data;
          // Average weighted towards the vivid pixels, so a coloured subject outweighs a grey background.
          let r = 0,
            gr = 0,
            b = 0,
            w = 0,
            sat = 0;
          for (let i = 0; i < px.length; i += 4) {
            const hi = Math.max(px[i], px[i + 1], px[i + 2]);
            const s = hi ? (hi - Math.min(px[i], px[i + 1], px[i + 2])) / hi : 0;
            const k = s * s * (hi / 255) + 0.002;
            r += px[i] * k;
            gr += px[i + 1] * k;
            b += px[i + 2] * k;
            w += k;
            sat += s;
          }
          if (sat / 256 < 0.12) return resolve(null);
          const top = Math.max(r, gr, b) / w || 1;
          resolve([r, gr, b].map((v) => Math.round(((v / w) * 220) / top)));
        } catch {
          resolve(null);
        }
      };
      img.src = src;
    });
    avatarColours.set(src, p);
  }
  return p;
}

function useAvatarColour(src: string) {
  const [rgb, setRgb] = useState<number[] | null>(null);
  useEffect(() => {
    let live = true;
    if (src) avatarColour(src).then((c) => live && setRgb(c));
    return () => {
      live = false;
    };
  }, [src]);
  return rgb;
}

/**
 * A Steam friend, drawn like the PS3's friends list: avatar, presence dot and name,
 * with their game or status underneath. The selected friend sits on a card in their
 * colour (their avatar's, or the theme's for a grey one) with a bigger avatar and their
 * game's art on the right. Selected and unselected are the same elements (just resized
 * and faded), and images fade in as they load, so nothing pops in or reloads.
 */
function FriendRow({
  friend: f,
  me,
  d,
  x,
  inFolder,
  hideExtras,
}: {
  friend: Friend;
  me: boolean;
  d: number;
  x: number;
  inFolder: boolean;
  hideExtras: boolean;
}) {
  const on = d === 0;
  const top = rowTop(d, inFolder);
  const av = on ? AVATAR_SEL : AVATAR;
  const textLeft = x + av / 2 + (on ? 13 : 11);
  const status = friendStatus(f);
  const opacity = on ? 1 : d < 0 ? 0.55 : 0.85;
  const cardLeft = x - AVATAR_SEL / 2 - CARD_PAD - 2;
  const drop = on ? FRIEND_DROP : 0;
  const ease = "190ms ease-out";
  const avatarRgb = useAvatarColour(f.avatar || f.avatarFull);
  const [s] = useSettings();
  const chosen = me && s.profileColour; // (yours: the colour you've chosen, if you have, near solid as the PS3's)

  return (
    <div className="xmb-anim xmb-enter" style={{ position: "absolute", left: 0, top: 0, transform: `translateY(${top}px)`, opacity }}>
      <div
        className="xmb-friend-card"
        style={{
          left: cardLeft,
          top: drop - CARD_PAD,
          width: CARD_W,
          height: AVATAR_SEL + CARD_PAD * 2,
          opacity: on ? 1 : 0,
          backgroundColor: chosen ? `rgba(${hexRgb(s.profileColour).join(",")}, .85)` : avatarRgb ? `rgba(${avatarRgb.join(",")}, .7)` : undefined,
        }}
      />
      <div className="xmb-anim" style={{ position: "absolute", left: x - av / 2, top: drop, width: av, height: av }}>
        <Avatar srcs={[f.avatarFull, f.avatar]} />
      </div>
      <div
        className="xmb-anim"
        style={{
          position: "absolute",
          left: textLeft,
          top: drop - (on ? FRIEND_LIFT : 0),
          height: av,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          whiteSpace: "nowrap",
          maxWidth: CARD_W - (textLeft - cardLeft) - 150,
        }}
      >
        {/* (neither line shrinks to fit the small avatar's height: the status, clipped for its ellipsis, lost its bottom) */}
        <div style={{ display: "flex", flex: "none", alignItems: "center", gap: FRIEND_DOT_GAP }}>
          <PresenceDot presence={f.presence} size={FRIEND_DOT} />
          <Marquee
            text={f.name}
            on={on}
            className={on ? "xmb-text xmb-pulse" : "xmb-text"}
            style={{ fontSize: on ? 29 : 23, transition: `font-size ${ease}` }}
          />
        </div>
        {/* (as the PS3's: lined up with the name, a game's controller under the dot) */}
        {status && (
          <div
            className="xmb-text"
            style={{
              position: "relative",
              display: "flex",
              flex: "none",
              alignItems: "center",
              fontSize: on ? 17 : 13,
              opacity: 0.85,
              marginTop: on ? 6 : 0,
              transition: `font-size ${ease}, margin-top ${ease}`,
              marginLeft: FRIEND_DOT + FRIEND_DOT_GAP,
            }}
          >
            {f.presence === "ingame" && (
              <span style={{ position: "absolute", left: (FRIEND_DOT - FRIEND_PAD) / 2 - FRIEND_DOT - FRIEND_DOT_GAP, display: "flex" }}>
                <Icon name="game" size={FRIEND_PAD} />
              </span>
            )}
            <div style={{ display: "flex", minWidth: 0, overflow: "hidden" }}>
              <Marquee text={status} on={on} style={{ flex: "0 1 auto" }} />
            </div>
          </div>
        )}
      </div>
      {/* Their game's art, faded in and out with the selection (always there, so it never pops). */}
      {f.presence === "ingame" && f.appid > 0 && (
        <div
          style={{
            position: "absolute",
            left: cardLeft + CARD_W - 14 - 120,
            top: FRIEND_DROP + (AVATAR_SEL - 56) / 2,
            opacity: on && !hideExtras ? 1 : 0,
            transition: `opacity ${ease}`,
            pointerEvents: "none",
          }}
        >
          <FadeImg
            srcs={friendGameArt(f)}
            style={{ width: 120, height: 56, objectFit: "cover", borderRadius: 3, boxShadow: "0 2px 8px rgba(0,0,0,.4)", display: "block" }}
          />
        </div>
      )}
    </div>
  );
}

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A profile card's colour (yours, or a friend's avatar's): over grey, or just grey with none. */
function profileBackground(rgb: number[] | null) {
  const grey = "linear-gradient(180deg, #4a4a4a, #222)";
  if (!rgb) return grey;
  const c = rgb.join(",");
  return `linear-gradient(180deg, rgba(${c},.8), rgba(${c},.5)), ${grey}`;
}

/**
 * A mini-profile's animated background (as Steam's friends UI shows behind a name), from the card's top right: whole
 * there, fading out as it comes into the card. Faded in once it can play.
 */
function MiniProfileBackground({ srcs }: { srcs: string[] }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="xmb-profile-video" style={{ opacity: playing ? 1 : 0 }}>
      <video autoPlay loop muted playsInline onPlaying={() => setPlaying(true)}>
        {srcs.map((src) => (
          <source key={src} src={src} />
        ))}
      </video>
    </div>
  );
}

/** The PS3's busy indicator: a ring of dots, turning, each fainter than the one ahead of it. */
function Busy({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="-16 -16 32 32" className="xmb-busy">
      {Array.from({ length: 8 }, (_, i) => (
        <circle key={i} cx={0} cy={-11} r={2.6} fill="#fff" opacity={0.15 + (0.85 * i) / 7} transform={`rotate(${i * 45})`} />
      ))}
    </svg>
  );
}

/** The PS3's level star: gold, a trophy's cup on it. */
function LevelStar({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ flex: "none", filter: "drop-shadow(0 1px 1px rgba(0,0,0,.5))" }}>
      <defs>
        <linearGradient id="xmb-level-star" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2a8" />
          <stop offset=".55" stopColor="#f2c230" />
          <stop offset="1" stopColor="#c08a12" />
        </linearGradient>
      </defs>
      <path d="M16 1.5l4.3 9.2 10 1.2-7.4 6.9 1.9 9.9L16 23.8l-8.8 4.9 1.9-9.9-7.4-6.9 10-1.2z" fill="url(#xmb-level-star)" stroke="#8a5d08" strokeWidth="1" />
      <path d="M12 11h8v2.5a4 4 0 0 1-8 0zM15 17.3h2v2.4h2.2v1.6h-6.4v-1.6H15z" fill="#4a3305" />
    </svg>
  );
}

function GameTile({ name }: { name: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 3,
        background: "linear-gradient(135deg, rgba(255,255,255,.28), rgba(255,255,255,.06))",
        border: "1px solid rgba(255,255,255,.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        padding: 6,
        boxSizing: "border-box",
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      {name}
    </div>
  );
}

/** The PS3 clock bar: status icons on the left (friends online), then the date and time. */
function Clock({ now, friendsOnline, shown }: { now: Date; friendsOnline: number; shown: number }) {
  const date = formatDate(now, false);
  const time = formatTime(now);
  return (
    <div
      style={{
        position: "absolute",
        right: "calc(-1 * var(--xmb-edge, 0px))", // the screen's right edge, not the stage's
        top: 58,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 44px 7px 26px",
        border: "1px solid rgba(255,255,255,.85)", // a fine, crisp line, as on the PS3
        borderRight: "none",
        borderRadius: "4px 0 0 4px",
        background: "rgba(0,0,0,.03)", // near clear: the background shows through
      }}
    >
      {friendsOnline > 0 && (
        <div className="xmb-text" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 18, marginRight: 30 }}>
          <Icon name="friends" size={22} plain />
          {friendsOnline}
        </div>
      )}
      <div className="xmb-text" style={{ fontSize: 22, letterSpacing: 0.5 }}>
        {date}&nbsp;&nbsp;{time}
      </div>
      <ClockFace key={shown} now={now} size={24} />
    </div>
  );
}

/**
 * The clock bar's icon: a face whose hands show the time, as the PS3's does. Each time it's shown (made again, by its key)
 * the hands wind round from twelve to the time, the minute hand once round the face first.
 */
function ClockFace({ now, size }: { now: Date; size: number }) {
  const m = now.getMinutes();
  const h = (now.getHours() % 12) + m / 60;
  const hand = (deg: number, from: number, len: number) => (
    <path
      d={`M32 32V${32 - len}`}
      style={{
        transformOrigin: "32px 32px",
        transform: `rotate(${deg}deg)`,
        ["--from" as any]: `rotate(${from}deg)`,
        animation: "xmbTravel 1.4s cubic-bezier(.3,.1,.2,1) both",
      }}
    />
  );
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} style={{ display: "block", overflow: "visible" }}>
      <g fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="32" cy="32" r="22" />
        {hand(h * 30, 0, 10)}
        {hand(m * 6, -360, 15)}
      </g>
    </svg>
  );
}

interface PanelEntry {
  id: string;
  label: string;
  sub?: string;
  icon: IconName;
  sound?: "open" | "launch";
  disabled?: boolean; // shown greyed out
  keepOpen?: boolean; // runs without closing the panel
  confirm?: string; // asked first (Forget)
  checked?: boolean; // the current choice of a setting
  image?: string; // a picture beside it (an installed theme's icon)
  head?: boolean; // listed apart, above the rest (Theme > Install)
  more?: SubOption[]; // its ▸ submenu, opened with ✕ or ▶
  zoom?: boolean; // while selected, the list behind at full size (a trophy's Sort By)
  run: (e?: any) => void;
}

/** The PS3-style options for a game (△): Play, Trophies, details, Steam's own menu. */
function gameOptions(g: Game, nativeMenu: (g: Game, e?: any) => void): PanelEntry[] {
  const out: PanelEntry[] = [];
  if (g.installed) out.push({ id: "play", label: isRunning(g) ? "Resume" : "Play", icon: "game", sound: "launch", run: () => startGame(g) });
  else out.push({ id: "install", label: "Install", sub: "Opens the game page", icon: "download", run: () => openGamePage(g) });
  // (the trophy list says if there are none)
  out.push({ id: "ach", label: "Trophies", icon: "trophy", run: () => openAchievements(g) });
  out.push({ id: "page", label: "Game Details", icon: "info", run: () => openGamePage(g) });
  // (between the Game and Video columns: listed in one or the other)
  const videos = getSettings().videoGames;
  out.push(
    videos.includes(g.appid)
      ? { id: "move", label: "Move to Game", icon: "game", run: () => updateSettings({ videoGames: videos.filter((id) => id !== g.appid) }) }
      : { id: "move", label: "Move to Video", icon: "video", run: () => updateSettings({ videoGames: [...videos, g.appid] }) },
  );
  out.push({ id: "menu", label: "More Options", sub: "Properties, Favorites, Manage…", icon: "quick", run: (e) => nativeMenu(g, e) });
  return out;
}

/** Which folders the Game column lists besides All Games: each switched on or off with ✕, the panel staying open. */
function gameColumnOptions(s: Settings): PanelEntry[] {
  const toggle = (id: string, label: string, icon: IconName, key: "gameFavorites" | "gameInstalled" | "gameCollections", what: string): PanelEntry => ({
    id,
    label,
    sub: `${s[key] ? "On" : "Off"}  ·  ${what}`,
    icon,
    checked: s[key],
    keepOpen: true,
    run: () => updateSettings({ [key]: !s[key] }),
  });
  return [
    toggle("favorites", "Favorites", "star", "gameFavorites", "Your Steam favorites"),
    toggle("installed", "Locally Installed Games", "download", "gameInstalled", "Games on this device"),
    toggle("collections", "Collections", "folder", "gameCollections", "Your Steam collections"),
  ];
}

/** A setting's options, the current one ticked. Choosing one applies it and closes the panel (a head item opens instead). */
function settingOptions(item: Item, open: (it: Item) => void): PanelEntry[] {
  const c = item.choices!;
  const current = c.current();
  const options: PanelEntry[] = c.options.map((o) => ({
    id: o.value,
    label: o.label,
    icon: "check",
    checked: o.value === current,
    image: o.image,
    more: c.more?.(o.value),
    run: () => c.set(o.value),
  }));
  const head = c.head;
  return head ? [{ id: head.id, label: head.label, icon: head.icon ?? "setting", head: true, run: () => open(head) }, ...options] : options;
}

const SHEET_LEFT = 884; // where the side panels start (measured from the PS3)

/** The PS3 side panel: a band of light in the panel colour (--xmb-sheet) with a lit edge, strongest across the middle. */
function PanelSheet({ children, left = SHEET_LEFT }: { children: any; left?: number }) {
  return (
    <div
      className="xmb-sheet"
      style={{ position: "absolute", left, top: -40, bottom: -40, right: "calc(-40px - var(--xmb-edge, 0px))", transition: "left 200ms ease-out" }}
    >
      <div className="xmb-sheet-glow" />
      <div className="xmb-sheet-edge" />
      {children}
    </div>
  );
}

const SWATCH = 18;
const SWATCH_STEP = 26.5;
const NAMED_STEP = 26; // height of a named option (Original) above the squares

/**
 * The PS3 colour picker. The list stays still and only the highlight moves:
 * named options (Original) on top, then a column of colour squares starting
 * level with the setting.
 */
function ColourPanel({ entries, sel, swatch }: { entries: PanelEntry[]; sel: number; swatch: (value: string) => string }) {
  const firstSquareTop = F_SEL_CY - SWATCH / 2;
  const named = entries.filter((e) => e.label).length;
  return (
    <PanelSheet>
      {entries.map((e, i) => {
        const on = i === sel;
        if (e.label) {
          return (
            <div
              key={e.id}
              className={on ? "xmb-swatch-name xmb-pulse" : "xmb-swatch-name"}
              style={{ position: "absolute", left: 11, top: 40 + firstSquareTop - (named - i) * NAMED_STEP - 4 }}
            >
              {e.label}
            </div>
          );
        }
        return (
          <div
            key={e.id}
            className={on ? "xmb-swatch xmb-swatch-on" : "xmb-swatch"}
            style={{ left: 12, top: 40 + firstSquareTop + (i - named) * SWATCH_STEP, backgroundColor: swatch(e.id) }}
          />
        );
      })}
    </PanelSheet>
  );
}

const LIST_STEP = 27; // between names in a plain list (measured from the PS3's Theme list)
const LIST_IMG = 24;
const LIST_HEAD_Y = 180; // the head item's centre line, well above the list
const LIST_BOTTOM = 680; // the list scrolls up once the selection would pass this

// An option's ▸ submenu (measured from the PS3's Theme list): the list moves left to make
// room and the submenu opens where it was, starting level with the option; the option's
// picture (a theme's preview) shows bottom-left.
const SUB_SHIFT = 400;
const LIST_ARROW_X = 306; // the ▸ beside an option with a submenu, from the sheet's edge
const LIST_ARROW_OPEN_X = SUB_SHIFT - 32; // the ◂ pointing at the open submenu, just short of it
const PICTURE = { left: 106, top: 470, width: 370, height: 208 };

/** A small white pointer, as beside options with a submenu. */
function Pointer({ left }: { left: boolean }) {
  const side = left ? { borderRight: "8px solid rgba(255,255,255,.9)" } : { borderLeft: "8px solid rgba(255,255,255,.9)" };
  return (
    <div
      style={{
        width: 0,
        height: 0,
        borderTop: "5px solid transparent",
        borderBottom: "5px solid transparent",
        ...side,
        filter: "drop-shadow(0 0 3px rgba(255,255,255,.5))",
      }}
    />
  );
}

/**
 * The PS3's plain list of names (Theme): a head item (Install) on its own near the top,
 * then the options starting level with the setting, pictures beside those that have one.
 * The list stays still and only the highlight moves, until it runs off the bottom.
 * Options with a submenu have a ▸; with it open the list moves left and the selected one
 * points (◂) at the submenu beside it.
 */
function ListPanel({
  entries,
  sel,
  sub,
}: {
  entries: PanelEntry[];
  sel: number;
  sub?: { options: SubOption[]; sel: number; picture: string | null | undefined };
}) {
  const heads = entries[0]?.head ? 1 : 0;
  const scroll = Math.max(0, F_SEL_CY + (sel - heads) * LIST_STEP - LIST_BOTTOM);
  const rowY = (i: number) => (entries[i]?.head ? LIST_HEAD_Y + i * LIST_STEP : F_SEL_CY + (i - heads) * LIST_STEP - scroll);
  return (
    <>
      <PanelSheet left={sub ? SHEET_LEFT - SUB_SHIFT : SHEET_LEFT}>
        {entries.map((e, i) => {
          const on = i === sel;
          const cy = rowY(i);
          const hidden = !e.head && cy < LIST_HEAD_Y + LIST_STEP * 1.5; // scrolled up under the head
          const pointer = sub ? on : !!e.more?.length;
          return (
            <div
              key={e.id}
              className="xmb-anim"
              style={{
                position: "absolute",
                left: 11,
                right: 0,
                top: 0,
                // (moved by a transform, on the GPU: a new top must be laid out each frame, which falls behind on the Deck)
                transform: `translateY(${40 + cy - LIST_STEP / 2}px)`,
                height: LIST_STEP,
                opacity: hidden ? 0 : 1,
                whiteSpace: "nowrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, height: "100%" }}>
                {e.image && (
                  <img src={e.image} style={{ width: LIST_IMG, height: LIST_IMG, flex: "none", borderRadius: 2, boxShadow: "1px 1px 3px rgba(0,0,0,.45)" }} />
                )}
                <Marquee
                  text={e.label}
                  on={on}
                  className={on && !sub ? "xmb-list-name xmb-pulse" : "xmb-list-name"}
                  style={{ maxWidth: (sub ? LIST_ARROW_OPEN_X : LIST_ARROW_X) - 12 - (e.image ? LIST_IMG + 10 : 0) }}
                />
              </div>
              {pointer && (
                <div style={{ position: "absolute", left: sub ? LIST_ARROW_OPEN_X : LIST_ARROW_X, top: LIST_STEP / 2 - 5 }}>
                  <Pointer left={!!sub} />
                </div>
              )}
            </div>
          );
        })}
      </PanelSheet>
      {sub && (
        <PanelSheet>
          {sub.options.map((o, i) => (
            <div
              key={o.id}
              className={i === sub.sel ? "xmb-list-name xmb-pulse" : "xmb-list-name"}
              style={{
                position: "absolute",
                left: 11,
                top: 40 + rowY(sel) + i * LIST_STEP - LIST_STEP / 2,
                height: LIST_STEP,
                display: "flex",
                alignItems: "center",
              }}
            >
              {o.label}
            </div>
          ))}
        </PanelSheet>
      )}
      {sub?.picture && (
        <img
          key={sub.picture.length}
          className="xmb-wait"
          src={sub.picture}
          style={{ position: "absolute", ...PICTURE, objectFit: "cover", boxShadow: "0 4px 18px rgba(0,0,0,.55)" }}
        />
      )}
    </>
  );
}

/** A game's options (or a setting's choices) on the PS3 side panel, centred on the screen. */
function OptionsPanel({ entries, sel }: { entries: PanelEntry[]; sel: number }) {
  return (
    <PanelSheet>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 8 }}>
        {entries.map((it, i) => {
          const on = i === sel;
          return (
            <div
              key={it.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "12px 28px",
                background: on ? "linear-gradient(90deg, rgba(255,255,255,.22), rgba(255,255,255,.06))" : "transparent",
                borderTop: on ? "1px solid rgba(255,255,255,.3)" : "1px solid transparent",
                borderBottom: on ? "1px solid rgba(255,255,255,.3)" : "1px solid transparent",
                opacity: it.disabled ? (on ? 0.55 : 0.35) : on ? 1 : 0.75,
                transition: "background 150ms, opacity 150ms",
              }}
            >
              <div
                className={on ? "xmb-glow" : undefined}
                style={{ width: 34, height: 34, flex: "none", visibility: it.checked === false ? "hidden" : undefined }}
              >
                <Icon name={it.icon} size={34} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className={on ? "xmb-text xmb-pulse" : "xmb-text"} style={{ fontSize: 23 }}>
                  {it.label}
                </div>
                {it.sub && (
                  <div className="xmb-text" style={{ fontSize: 14, opacity: 0.8, marginTop: 2 }}>
                    {it.sub}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PanelSheet>
  );
}

// The PS3's "Please wait..." screen (measured from it, scaled to the stage): the setting's
// name top-left over a full-width rule, the message in the middle, a second rule below.
const WAIT_RULE_TOP = 148;
const WAIT_RULE_BOTTOM = 655;

/** A full-width rule across the screen (not just the stage). */
const Rule = ({ top }: { top: number }) => (
  <div
    style={{
      position: "absolute",
      top,
      left: "calc(-1 * var(--xmb-edge, 0px))",
      right: "calc(-1 * var(--xmb-edge, 0px))",
      height: 1,
      background: "rgba(255,255,255,.5)",
    }}
  />
);

/**
 * The frame of the PS3's full-screen pages: their name top-left (if they have one) over a rule, a rule near the bottom,
 * and the buttons' hints under it (each at its own left).
 */
function Page({ title, hints = [], children }: { title?: { text: string; icon: IconName }; hints?: [GlyphButton, string, number][]; children: any }) {
  return (
    <div className="xmb-wait" style={{ position: "absolute", inset: 0 }}>
      {title && (
        <div
          className="xmb-text"
          style={{ position: "absolute", left: 72, top: WAIT_RULE_TOP - 38, display: "flex", alignItems: "center", gap: 8, fontSize: 18 }}
        >
          <Icon name={title.icon} size={30} badge plain />
          {title.text}
        </div>
      )}
      <Rule top={WAIT_RULE_TOP} />
      {children}
      <Rule top={WAIT_RULE_BOTTOM} />
      {hints.map(([b, label, left]) => (
        <div key={b} className="xmb-text" style={{ position: "absolute", left, top: WAIT_RULE_BOTTOM + 8, fontSize: 18 }}>
          <Hint b={b}>{label}</Hint>
        </div>
      ))}
    </div>
  );
}

function PleaseWait({ title, icon }: { title: string; icon: IconName }) {
  return (
    <Page title={{ text: title, icon }}>
      <div
        className="xmb-text"
        style={{ position: "absolute", left: 0, right: 0, top: (WAIT_RULE_TOP + WAIT_RULE_BOTTOM) / 2 - 12, textAlign: "center", fontSize: 18 }}
      >
        Please wait...
      </div>
    </Page>
  );
}

// Your profile, as the PS3's (measured from it, scaled to fit between the rules): your card in the middle with a tab of
// your colour on its left (◀ opens the colours beside it, as on the PS3), your latest trophies, your level
// and how many trophies you've earned (each under its heading, in the middle of the space below). (The PS3's comment bubble isn't kept: Steam has none.)
const PROFILE_COLS = 5; // (the colours, five to a row)
const PROF_W = 588;
const PROF_H = 345;
const PROF = { left: (STAGE_W - PROF_W) / 2, top: (WAIT_RULE_TOP + WAIT_RULE_BOTTOM - PROF_H) / 2, width: PROF_W, height: PROF_H }; // (centred between the rules)
const PROF_PANEL_TOP = 131; // the lower panel (trophies, level), within the card
const PROF_ICON = 58;
const PROF_STEP = 31; // between the colours
const TAB = ["#e6452a", "#f2a21b", "#2165c4", "#1db5c4"]; // (the colours' tab: a few of them, whatever colour's chosen)

function ProfileScreen({ me, colour, pick }: { me: Friend; colour: string; pick?: number }) {
  const p = useProfile();
  // (counted as progress changes, not on every redraw: each colour moved through)
  const progressVer = useAchievementProgressChanges();
  const earned = useMemo(trophiesEarned, [progressVer]);
  return (
    <ProfileCard
      person={me}
      tint={colour ? hexRgb(colour) : null}
      tab
      pick={pick}
      level={p.level}
      recent={p.recent}
      trophies={earned}
      background={p.background}
    />
  );
}

/** A friend's card, as yours (without your colours): in their avatar's colour, as Steam knows them (profile.ts). */
function FriendProfileScreen({ friend }: { friend: Friend }) {
  const { profile: p, loading } = useFriendProfile(friend.steamid);
  const tint = useAvatarColour(friend.avatar || friend.avatarFull);
  return (
    <ProfileCard
      person={friend}
      tint={tint}
      level={p?.level ?? null}
      recent={p?.recent ?? []}
      trophies={p?.trophies ?? null}
      background={p?.background ?? []}
      loading={loading}
    />
  );
}

function ProfileCard({
  person,
  tint,
  tab = false,
  pick,
  level,
  recent,
  trophies,
  background,
  loading = false,
}: {
  person: Friend;
  tint: number[] | null;
  tab?: boolean; // (yours: the colours' tab on its left)
  pick?: number;
  level: number | null;
  recent: { name: string; image: string }[];
  trophies: number | null;
  background: string[]; // (their mini-profile's animated background: its video, in each format)
  loading?: boolean; // (being read, with nothing to show yet: the PS3's busy indicator where the trophies go)
}) {
  const big = { fontSize: 32, lineHeight: "32px" };
  return (
    <Page
      hints={
        pick !== undefined
          ? [
              ["face-dn", "Select", 480],
              ["face-rt", "Back", 770],
            ]
          : [["face-rt", "Back", 770]]
      }
    >
      {tab && (
        <div
          className="xmb-anim"
          style={{
            position: "absolute",
            left: PROF.left - 13,
            top: PROF.top + 48,
            width: 14,
            height: 63,
            borderRadius: "3px 0 0 3px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            // (lit while the colours are open, as the PS3 shows what ◀ opened)
            boxShadow: pick !== undefined ? "0 0 0 1px rgba(255,255,255,.9), 0 0 10px 2px rgba(255,255,255,.75)" : "-1px 1px 4px rgba(0,0,0,.4)",
            transition: "box-shadow 150ms ease-out",
          }}
        >
          {TAB.map((c) => (
            <div key={c} style={{ flex: 1, background: c }} />
          ))}
        </div>
      )}
      {pick !== undefined && (
        <div className="xmb-profile-colours" style={{ left: PROF.left - 236, top: PROF.top + 32, width: 190, height: 158 }}>
          {PROFILE_COLOURS.map((c, i) => (
            <div
              key={c}
              className={i === pick ? "xmb-swatch-on" : undefined}
              style={{
                position: "absolute",
                left: 21 + (i % PROFILE_COLS) * PROF_STEP,
                top: 20 + Math.floor(i / PROFILE_COLS) * PROF_STEP,
                width: 25,
                height: 25,
                borderRadius: 3,
                background: c,
                boxShadow: i === pick ? "0 0 0 2px #fff, 0 0 10px rgba(255,255,255,.8)" : "1px 2px 3px rgba(0,0,0,.35)",
              }}
            />
          ))}
        </div>
      )}
      <div
        className="xmb-profile"
        style={{
          ...PROF,
          background: profileBackground(tint),
        }}
      >
        {background.length > 0 && <MiniProfileBackground key={background[0]} srcs={background} />}
        <div className="xmb-profile-avatar">
          <FadeImg srcs={[person.avatarFull, person.avatar].filter(Boolean)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
        <div style={{ position: "absolute", left: 130, right: 180, top: 2, height: 119, display: "flex", alignItems: "center", gap: 10 }}>
          <PresenceDot presence={person.presence} size={14} />
          <span className="xmb-text" style={{ fontSize: 22, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {person.name}
          </span>
        </div>
        {/* (where the PS3's comment bubble is: your Steam profile, with △) */}
        <div className="xmb-profile-button">
          <span className="xmb-profile-glyph">
            <Glyph b="face-up" size={21} />
          </span>
          View Profile
        </div>
        <div className="xmb-profile-panel" style={{ top: PROF_PANEL_TOP }}>
          <div className="xmb-profile-dots">
            <span />
          </div>
          <div
            style={{ position: "absolute", left: 0, right: 0, top: 21, height: 83, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            {recent.length ? (
              recent.map((t, i) => (
                <FadeImg
                  key={`${i}:${t.image}`} // (a new trophy in a place: a new image, faded in)
                  srcs={[t.image]}
                  style={{ width: PROF_ICON, height: PROF_ICON, borderRadius: 6, border: "1px solid rgba(255,255,255,.25)", display: "block" }}
                />
              ))
            ) : loading ? (
              <Busy size={44} />
            ) : (
              <Icon name="cup" size={50} plain />
            )}
          </div>
          <div className="xmb-profile-heads">
            <span style={{ left: 19 }}>Level</span>
            <span style={{ left: 301 }}>Trophies</span>
          </div>
          <div className="xmb-text xmb-profile-value" style={{ left: 15, gap: 14, ...big }}>
            <LevelStar size={30} />
            {level ?? "–"}
          </div>
          <div className="xmb-text xmb-profile-value" style={{ left: 304, ...big }}>
            {trophies ?? "–"}
          </div>
        </div>
      </div>
    </Page>
  );
}

// The PS3's System Information screen (measured from it): its name top-left over a rule, the lines in the middle
// (names right-aligned against their values), a rule near the bottom with "Back" under it.
const INFO_SPLIT_X = 640; // between the names and their values
const INFO_TOP = 342; // the first line
const INFO_STEP = 30;

function InfoScreen({ title, icon, lines }: { title: string; icon: IconName; lines: [string, string][] }) {
  // (A list too long to start where the PS3's do is centred between the rules: the Connection Status List.)
  const height = lines.length * INFO_STEP;
  const top = INFO_TOP + height <= WAIT_RULE_BOTTOM - 20 ? INFO_TOP : Math.round((WAIT_RULE_TOP + WAIT_RULE_BOTTOM - height) / 2);
  return (
    <Page title={{ text: title, icon }} hints={[["face-rt", "Back", 770]]}>
      {lines.map(([k, v], i) => (
        <div key={k} className="xmb-text" style={{ position: "absolute", left: 0, right: 0, top: top + i * INFO_STEP, fontSize: 19, whiteSpace: "nowrap" }}>
          <span style={{ position: "absolute", right: STAGE_W - INFO_SPLIT_X + 12 }}>{k}</span>
          <span style={{ position: "absolute", left: INFO_SPLIT_X + 12 }}>{v}</span>
        </div>
      ))}
    </Page>
  );
}

/** The PS3's progress bar (installing, syncing): filling with green, how far it's got under it (gap below its top). */
function ProgressBar({ at, pct, gap }: { at: { left: number; width: number; top: number }; pct: number; gap: number }) {
  return (
    <>
      <div
        style={{
          position: "absolute",
          ...at,
          height: 6,
          borderRadius: 3,
          background: "rgba(255,255,255,.18)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,.4)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(180deg, #eef8d6, #a6cf5c)", transition: "width 240ms linear" }} />
      </div>
      <div className="xmb-text" style={{ position: "absolute", left: at.left, width: at.width, top: at.top + gap, textAlign: "center", fontSize: 16 }}>
        {pct}%
      </div>
    </>
  );
}

// The PS3's install screen (Install Package Files, measured from it): the package's icon with its
// file name and size under it on the left; "Installing..." and a progress bar on the right.
const INSTALL_ICON = { left: 286, top: 330, width: 240, height: 132 };
const INSTALL_TEXT_X = 586;
const INSTALL_BAR = { left: 586, width: 534, top: 418 };

function InstallScreen({ p }: { p: InstallProgress }) {
  const pct = Math.floor(Math.max(0, Math.min(1, p.done)) * 100);
  const size = p.size >= 1 << 20 ? `${Math.round(p.size / (1 << 20))} MB` : p.size ? `${Math.max(1, Math.round(p.size / 1024))} KB` : "";
  return (
    <Page>
      <div
        style={{
          position: "absolute",
          ...INSTALL_ICON,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: p.icon ? undefined : "rgba(255,255,255,.08)",
          boxShadow: "0 2px 10px rgba(0,0,0,.4)",
        }}
      >
        {p.icon ? <img src={p.icon} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <Icon name="theme" size={72} />}
      </div>
      <div
        className="xmb-text"
        style={{
          position: "absolute",
          left: INSTALL_ICON.left - 60,
          width: INSTALL_ICON.width + 120,
          top: INSTALL_ICON.top + INSTALL_ICON.height + 22,
          textAlign: "center",
          fontSize: 16,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {p.file}
        <div style={{ marginTop: 14 }}>{size}</div>
      </div>
      <div className="xmb-text" style={{ position: "absolute", left: INSTALL_TEXT_X + 150, top: INSTALL_BAR.top - 88, fontSize: 18, lineHeight: "29px" }}>
        Installing...
        <br />
        Do not turn off the system.
      </div>
      <ProgressBar at={INSTALL_BAR} pct={pct} gap={26} />
    </Page>
  );
}

// The PS3's trophy sync screen (measured from it): the message in the middle, a bar under it with how far it's got
// beneath, and "Cancel" under the lower rule.
const SYNC_BAR = { left: 373, width: 534, top: 406 };

function SyncScreen({ p }: { p: { done: number; total: number } }) {
  const pct = p.total ? Math.floor((p.done / p.total) * 100) : 100;
  return (
    <Page hints={[["face-rt", "Cancel", 776]]}>
      <div
        className="xmb-text"
        style={{ position: "absolute", left: 0, right: 0, top: SYNC_BAR.top - 116, textAlign: "center", fontSize: 18, lineHeight: "26px" }}
      >
        Performing the sync operation for achievement information...
        <br />
        Please wait.
      </div>
      <ProgressBar at={SYNC_BAR} pct={pct} gap={16} />
    </Page>
  );
}

/** Information on something (a theme): its name, then a few labelled lines. ✕ or ○ closes it. */
function InfoDialog({ title, lines }: { title: string; lines: [string, string][] }) {
  return (
    <div className="xmb-enter" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center" }}>
      <div
        style={{
          width: "100%",
          padding: "40px 0",
          background: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,.7) 15%, rgba(0,0,0,.7) 85%, rgba(0,0,0,0))",
        }}
      >
        <div className="xmb-text" style={{ fontSize: 26, textAlign: "center", marginBottom: 22 }}>
          {title}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 560px)", columnGap: 28, rowGap: 10, justifyContent: "center" }}>
          {lines.map(([k, v]) => [
            <div key={k} className="xmb-text" style={{ fontSize: 18, opacity: 0.7, textAlign: "right" }}>
              {k}
            </div>,
            <div key={k + ":v"} className="xmb-text" style={{ fontSize: 18, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {v}
            </div>,
          ])}
        </div>
      </div>
    </div>
  );
}

// The PS3's own full-screen question (Turn Off System): between the two rules, Yes and No side by side, the chosen one
// glowing; Enter and Back under them (measured from the PS3, its rules placed as the other screens' are).
const ASK_TEXT_TOP = 360;
const ASK_CHOICE_TOP = 415;
const ASK_CHOICE_GAP = 105; // between Yes's and No's centres

function ConfirmScreen({ text, yes }: { text: string; yes: boolean }) {
  const choice = (label: string, on: boolean, cx: number) => (
    <div
      className={on ? "xmb-text xmb-pulse" : "xmb-text"}
      style={{ position: "absolute", left: cx - 100, width: 200, top: ASK_CHOICE_TOP, textAlign: "center", fontSize: 19, opacity: on ? 1 : 0.85 }}
    >
      {label}
    </div>
  );
  return (
    <Page
      hints={[
        ["face-dn", "Enter", 480],
        ["face-rt", "Back", 770],
      ]}
    >
      <div className="xmb-text" style={{ position: "absolute", left: 0, right: 0, top: ASK_TEXT_TOP, textAlign: "center", fontSize: 19 }}>
        {text}
      </div>
      {choice("Yes", yes, STAGE_W / 2 - ASK_CHOICE_GAP / 2)}
      {choice("No", !yes, STAGE_W / 2 + ASK_CHOICE_GAP / 2)}
    </Page>
  );
}

function Confirm({ text, yes }: { text: string; yes: boolean }) {
  const btn = (label: string, on: boolean) => (
    <div
      className={on ? "xmb-text xmb-pulse" : "xmb-text"}
      style={{
        padding: "6px 28px",
        fontSize: 22,
        borderRadius: 4,
        background: on ? "rgba(255,255,255,.22)" : "transparent",
        border: "1px solid rgba(255,255,255,.4)",
      }}
    >
      {label}
    </div>
  );
  return (
    <div className="xmb-enter" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center" }}>
      <div
        style={{
          width: "100%",
          padding: "48px 0",
          background: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,.65) 15%, rgba(0,0,0,.65) 85%, rgba(0,0,0,0))",
          textAlign: "center",
        }}
      >
        <div className="xmb-text" style={{ fontSize: 26, marginBottom: 28 }}>
          {text}
        </div>
        <div style={{ display: "flex", gap: 24, justifyContent: "center" }}>
          {btn("Yes", yes)}
          {btn("No", !yes)}
        </div>
      </div>
    </div>
  );
}

// The side panel's fade across, a smooth curve fitted to the PS3's (measured from two RPCS3 shots): rises from ~40% at the edge to its
// peak ~40px in, eases down, then falls away through a long soft tail by ~300px. Drawn as a stop every 4px so its
// slope changes evenly (stops straight from the measurements kinked every few px, and each kink showed as a faint line).
// It eases down to a faint tint (SHEET_TINT) rather than to nothing, so the rest of the panel keeps a little of the colour.
const SHEET_TINT = 0.15;
const SHEET_FADE = (() => {
  const f = (x: number) => SHEET_TINT + (1 - SHEET_TINT) * (1 - 0.65 * Math.exp(-x / 13)) * (1.1 - 0.0024 * x) * (1 / (1 + Math.exp((x - 205) / 24)));
  const xs = Array.from({ length: 86 }, (_, i) => i * 4);
  const peak = Math.max(...xs.map(f));
  return `linear-gradient(90deg, ${xs.map((x) => `rgba(0,0,0,${(f(x) / peak).toFixed(4)}) ${x}px`).join(", ")})`;
})();
// Down the panel: the light nearly even (a little less at the top and bottom), the edge's line gone at both.
const SHEET_DOWN = "linear-gradient(180deg, rgba(0,0,0,.86) 0%, #000 45%, #000 55%, rgba(0,0,0,.86) 100%)";
const EDGE_DOWN = "linear-gradient(180deg, rgba(0,0,0,0) 0%, #000 45%, #000 55%, rgba(0,0,0,0) 100%)";
const mask = (m: string) => `-webkit-mask-image: ${m}; mask-image: ${m};`;

const CSS = `${BASE_CSS}
/* (no will-change: each moving piece gets a layer of its own while its transform animates; kept for good, every row,
   icon and name was a layer, dozens of them, held in the GPU's memory) */
.xmb-anim { --xmb-ease: cubic-bezier(.2,.7,.3,1); transition: transform 190ms var(--xmb-ease), opacity 190ms ease-out, width 190ms var(--xmb-ease), height 190ms var(--xmb-ease), left 190ms var(--xmb-ease), top 190ms var(--xmb-ease); }
.xmb-busy { animation: xmbBusy 1s steps(8) infinite; filter: drop-shadow(0 1px 2px rgba(0,0,0,.5)); }
@keyframes xmbBusy { to { transform: rotate(360deg); } }
@keyframes xmbBg { from { opacity: 0; } to { opacity: .9; } }
/* Starting a game: the menu zooms towards you and fades, once the art has gone (launch.ts). */
.xmb-launch { transform-origin: 50% 45%; animation: xmbLaunch ${LAUNCH_MENU_MS}ms ease-in ${LAUNCH_MENU_DELAY_MS}ms forwards; }
@keyframes xmbLaunch { to { opacity: 0; transform: scale(1.3); } }
@keyframes xmbSlide { from { opacity: 0; transform: translateX(40px); } }
/* Folders: an item travels from where it was (--from, set on it) to where it's drawn, as the PS3's column slides into
   the strip beside an open folder and back out; the folder's contents fade in once it has. (Held only until they've
   played, "backwards": one still held over a row's transform or opacity would stop them easing as the list moves.) */
@keyframes xmbTravel { from { transform: var(--from); opacity: var(--from-o, 1); } }
.xmb-travel { transform-origin: 0 0; animation: xmbTravel ${FOLDER_MS}ms cubic-bezier(.2,.7,.3,1) backwards; }
.xmb-enter-late { animation: xmbFade 160ms ease-out ${FOLDER_IN_DELAY_MS}ms backwards; }
.xmb-wait { animation: xmbFade 250ms ease-out 150ms both; }
/* Selected text too long to fit, scrolled to its end and back (Marquee). */
.xmb-marquee { display: inline-block; will-change: transform; }
/* The PS3 side panel (colour picker, game options), measured from the PS3: a band of light in the panel colour, about 60%
   opaque, that starts right at the edge (so the edge takes the colour too), peaks ~40px in and eases down through a long
   soft tail by ~300px to a faint tint over the rest (SHEET_FADE). It's nearly even top to bottom. A faint white line
   lies along the edge, brightest across the middle and gone at the top and bottom. The colour sits in background-color so it
   can fade; the shape is two masks multiplied together. */
.xmb-sheet { animation: xmbSlide 220ms ease-out; }
.xmb-sheet-glow, .xmb-sheet-edge {
  position: absolute; top: 0; bottom: 0;
  -webkit-mask-composite: source-in; mask-composite: intersect;
}
.xmb-sheet-glow {
  left: 0; right: 0; opacity: .62;
  background-color: var(--xmb-sheet);
  transition: background-color 600ms ease-out;
  ${mask(`${SHEET_FADE}, ${SHEET_DOWN}`)}
}
.xmb-sheet-edge { left: 0; width: 1.5px; background: rgba(255,255,255,.28); ${mask(EDGE_DOWN)} }
/* Friends (PS3 friends list): bordered avatars, presence dots and the selected friend's card. */
.xmb-avatar { border: 2px solid rgba(255,255,255,.85); border-radius: 4px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.35); background: rgba(0,0,0,.25); }
.xmb-dot { display: inline-block; flex: none; border-radius: 50%; transition: width 190ms ease-out, height 190ms ease-out; box-shadow: inset 0 1px 2px rgba(255,255,255,.55), 0 0 3px rgba(0,0,0,.4); }
/* The card, as the PS3's: near solid in the friend's colour (the theme's by default) with a drop shadow, a faint light edge, the top half lighter to a line across the middle. */
.xmb-friend-card { position: absolute; border-radius: 10px; transition: opacity 190ms ease-out, top 190ms ease-out, background-color 600ms ease-out; background-color: rgba(var(--xmb-glow), .6); background-image: linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,.08) 50%, rgba(255,255,255,0) 50%); border: 1px solid rgba(0,0,0,.25); box-shadow: 0 5px 14px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.18), inset 0 0 10px rgba(255,255,255,.1); }
.xmb-list-name, .xmb-swatch-name { color: #fff; text-shadow: ${TEXT_SHADOW}; }
.xmb-list-name { font-size: 21px; }
.xmb-swatch-name { font-size: 19px; }
/* Colour squares: flat colour, slightly rounded, soft shadow to the lower right. */
.xmb-swatch { position: absolute; width: 18px; height: 18px; border-radius: 3px; box-shadow: 1.5px 2px 3px rgba(0,0,0,.35); }
/* The highlight: a soft white glow hugging the square, breathing about every 1.2s (as on the PS3). */
@keyframes xmbHalo {
  0%,100% { box-shadow: 0 0 0 1.5px rgba(255,255,255,.95), 0 0 6px 2px rgba(255,255,255,.75), inset 0 0 4px rgba(255,255,255,.7), 1.5px 2px 3px rgba(0,0,0,.3); }
  50% { box-shadow: 0 0 0 1px rgba(255,255,255,.65), 0 0 4px 1px rgba(255,255,255,.4), inset 0 0 2px rgba(255,255,255,.35), 1.5px 2px 3px rgba(0,0,0,.3); }
}
.xmb-swatch-on { animation: xmbHalo 1.2s ease-in-out infinite; }
/* Your profile (the PS3's card): a glossy frame in your colour, a dark panel in it with a silver bar of headings. */
.xmb-profile { position: absolute; border-radius: 9px; overflow: hidden; box-shadow: 0 6px 22px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.35); transition: background 200ms ease-out; }
.xmb-profile-panel { position: absolute; left: 5px; right: 5px; bottom: 6px; border-radius: 4px; background: #141414; border: 1px solid rgba(255,255,255,.14); overflow: hidden; }
.xmb-profile-dots { position: absolute; left: 0; right: 0; top: 0; height: 21px; background: linear-gradient(180deg, #5a5a5a, #2e2e2e); display: flex; align-items: center; justify-content: center; }
.xmb-profile-dots span { width: 8px; height: 8px; border-radius: 50%; background: #3b8cff; box-shadow: 0 0 4px rgba(59,140,255,.8); }
.xmb-profile-heads { position: absolute; left: 0; right: 0; top: 104px; height: 23px; background: linear-gradient(180deg, #5a5a5a, #2e2e2e); }
.xmb-profile-value { position: absolute; top: 127px; bottom: 0; display: flex; align-items: center; }
.xmb-profile-heads span { position: absolute; top: 3px; font-size: 14px; line-height: 16px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.7); }
/* (the card's top, whole in its corner, clipped by the card's own, and gone by its left and lower edges: nothing to cut off against the card) */
.xmb-profile-video { position: absolute; top: 0; right: 0; width: 63%; height: 156px; overflow: hidden; pointer-events: none; transition: opacity 600ms ease-out; --fade: radial-gradient(ellipse 100% 100% at 100% 0%, #000 35%, rgba(0,0,0,.6) 65%, transparent 100%); -webkit-mask-image: var(--fade); mask-image: var(--fade); }
.xmb-profile-video video { width: 100%; height: 100%; object-fit: cover; object-position: right top; display: block; }
.xmb-profile-avatar { position: absolute; left: 8px; top: 8px; width: 106px; height: 106px; border-radius: 5px; overflow: hidden; background: rgba(0,0,0,.25); box-shadow: 0 2px 8px rgba(0,0,0,.4); }
/* View Profile: a small pill, the grey of the bars on the card. */
/* (its right edge just inside the end of a full row of trophies under it) */
.xmb-profile-button { position: absolute; right: 28px; top: 47px; height: 30px; padding: 0 14px 0 5px; border-radius: 15px; background: linear-gradient(180deg, #5a5a5a, #2e2e2e); box-shadow: 0 2px 7px rgba(0,0,0,.45); display: flex; align-items: center; gap: 8px; color: #fff; font-size: 15px; text-shadow: 0 1px 2px rgba(0,0,0,.7); white-space: nowrap; }
.xmb-profile-glyph { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.xmb-profile-colours { position: absolute; border-radius: 2px; background: rgba(120,120,120,.88); border: 1px solid rgba(255,255,255,.35); box-shadow: 0 4px 14px rgba(0,0,0,.45); }
.xmb-bg { position: absolute; inset: 0; opacity: .9; animation: xmbBg 900ms ease-out; }
`;
