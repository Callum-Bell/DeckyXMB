// The XMB's columns and items. Built fresh from Steam's stores each time the
// home is shown, so new installs / collections appear without a restart.
import { DATE_FORMATS, formatDateTime, TIME_FORMATS } from "../datetime";
import { Friend, loadFriends, loadMe, MY_STATUSES, myStatus, openFriendGame, openProfile, setMyStatus } from "../friends";
import {
  allGameIds,
  allGamesByName,
  CDN,
  collections,
  Game,
  gameByAppid,
  openAchievements,
  showTrophyPage,
  hideTrophyGame,
  trophyGameHidden,
  knownAchievementProgress,
  syncAchievements,
  openGamePage,
  recentGames,
  refreshAchievementProgress,
  Trophy,
  trophyList,
  trophySections,
  countOf,
  AchievementProgress,
  watchTrophyList,
  soundtracks,
  sortTrophies,
  TROPHY_SORTS,
} from "../library";
import {
  BluetoothDevice,
  bluetoothAvailable,
  bluetoothDevices,
  bluetoothEnabled,
  connectDevice,
  disconnectDevice,
  forgetDevice,
  setBluetoothEnabled,
  setDeviceTrusted,
  setDeviceWake,
  foundDevices,
  pairDevice,
  searchForDevices,
} from "../bluetooth";
import {
  connectionStatus,
  connectNetwork,
  connectWithDialog,
  disconnectNetwork,
  forgetNetwork,
  Network,
  networkAvailable,
  networkManaged,
  networks,
  scanForNetworks,
  setAutoconnect,
  setWifiEnabled,
  testConnection,
  testingLines,
  wifiAvailable,
  wifiEnabled,
} from "../network";
import { allScreenshots, Shot } from "../screenshots";
import { getSettings, Settings, ThemeKey, updateSettings } from "../settings";
import { albumTracks, nowPlaying, playTrack } from "../soundtracks";
import * as sys from "../system";
import {
  AUDIO_STEPS,
  AudioDirection,
  audioDevice,
  audioDeviceOptions,
  audioHas,
  audioVolume,
  changeHostname,
  developerMode,
  setAudioDevice,
  setAudioVolume,
  setUiSounds,
  uiSounds,
  adaptiveBrightness,
  adaptiveBrightnessAvailable,
  BRIGHTNESS_STEPS,
  brightnessAvailable,
  displayBrightness,
  displaySupported,
  gameResolution,
  gameResolutionAvailable,
  gameResolutions,
  hdrAvailable,
  hdrEnabled,
  MAGNIFIER_SCALES,
  magnifierAvailable,
  magnifierScale,
  NIGHT_TINTS,
  nightMode,
  nightModeEnd,
  nightModeHours,
  nightModeSchedule,
  nightModeStart,
  nightModeTint,
  setAdaptiveBrightness,
  setDisplayBrightness,
  setGameResolution,
  setHdrEnabled,
  setMagnifierScale,
  setNightMode,
  setNightModeEnd,
  setNightModeSchedule,
  setNightModeStart,
  setNightModeTint,
  languageNeedsRestart,
  setDeveloperMode,
  setSystemLanguage,
  systemHostname,
  systemInformation,
  systemLanguage,
  systemLanguages,
} from "../systemSettings";
import { checkForUpdates, finishUpdate, installUpdates, updateStatus, UpdateState, updatesSupported } from "../updates";
import { applyTheme, browseTheme, deleteTheme, installedThemes, themePreview } from "../themes";
import { IconName } from "./icons";
import { LOCKED_TROPHY } from "./locked";
import { Tier, tierOf } from "./TrophyPage";
import { GLYPH_SETS } from "../glyphs";
import { BRIGHTNESS_OPTIONS, COLOUR_OPTIONS, rgb, swatchColor } from "./theme";

export interface Item {
  id: string;
  label: string;
  sub?: string;
  description?: string; // shown under the selected item (PS3 help text)
  icon?: IconName;
  badge?: boolean; // the PS3's small wrench disc on Settings-column icons
  game?: Game;
  art?: string[]; // landscape art, drawn like a game's
  logo?: string[]; // (in place of art, with Game Icons: Logo) a game's logo, then its art
  cover?: string[]; // square art in place of the icon (a soundtrack's album cover)
  run?: () => void;
  confirm?: string; // ask before running (power actions)
  confirmScreen?: boolean; // ask it as the PS3 does turning off: the whole screen, not a dialog over the XMB
  children?: () => Item[]; // a folder: ✕ opens it as a nested column
  whileOpen?: () => () => void; // a folder: started as it's opened, the stop it returns called as it's left
  startAt?: () => string | undefined; // a folder: the id of the item it opens on (✕ on it), not the one last selected
  choices?: Choices; // a setting: ✕ opens its options in the side panel
  friend?: Friend; // a Steam friend: drawn as a PS3 friend entry
  me?: true; // you, atop the friends: ✕ shows your profile
  actions?: () => Action[]; // ✕ opens these in the side panel
  value?: string; // shown in the value column, as a setting's is (Hostname)
  screen?: { title: string; icon: IconName; lines: () => Promise<[string, string][]>; pending?: () => [string, string][] }; // ✕ shows a PS3 information screen (System Information); pending: its lines till then
  trophy?: { tier: Tier; earned: boolean }; // one of a game's trophies, listed in the XMB: its cup beside its name
  options?: { label: string; run?: () => void; actions?: () => Action[] }; // △ does this, or opens these in the side panel
  trophies?: number; // a Trophy Collection entry (this app's): its name always shown, its progress beside it
  groupProgress?: AchievementProgress; // one of a game's trophy groups (a DLC's): shown as an entry, with its own progress
  picture?: string; // a screenshot: ✕ shows it full screen (◀ ▶ through the others beside it)
}

export interface Action {
  id: string;
  label: string;
  sub?: string;
  icon: IconName;
  checked?: boolean; // an on/off option: ticked when on
  confirm?: string; // ask before running (Forget)
  more?: SubOption[]; // its ▸ submenu, opened with ✕ or ▶ (a trophy's Sort By)
  zoom?: boolean; // while it's selected the list behind shows every row at full size, as the PS3 does under Sort By
  run: () => void;
}

function friendItem(f: Friend): Item {
  return {
    id: `friend:${f.steamid}`,
    label: f.name,
    friend: f,
    // (✕ shows their profile, as yours)
    options: {
      label: "Options",
      actions: () => [
        { id: "profile", label: "View Profile", icon: "users", run: () => openProfile(f) },
        ...(f.appid ? [{ id: "game", label: "Game Details", sub: f.game, icon: "game" as IconName, run: () => openFriendGame(f) }] : []),
      ],
    },
  };
}

/** You, atop the friends: ✕ shows your profile, △ sets your status. */
function meItem(f: Friend): Item {
  return {
    id: "me",
    label: f.name,
    friend: f,
    me: true,
    options: {
      label: "Online Status",
      actions: () => MY_STATUSES.map(([id, label]) => ({ id, label, icon: "users", checked: myStatus() === id, run: () => setMyStatus(id) })),
    },
  };
}

export interface Choices {
  options: { value: string; label: string; image?: string }[];
  current: () => string;
  set: (value: string) => void;
  swatch?: (value: string) => string; // colour choices: shown as the PS3's colour squares
  brightness?: boolean; // the background fades to each option's brightness as it's selected (Brightness)
  plain?: boolean; // shown as a plain list of names (as Theme's and Colour's are), not the options panel
  head?: Item; // shown as the PS3's plain list of names (Theme), with this apart above them (Install); ✕ opens it
  more?: (value: string) => SubOption[] | undefined; // an option's ▸ submenu, opened with ✕ or ▶ (Theme: Apply, Delete, Information)
  picture?: (value: string) => string | null | undefined; // shown while an option's submenu is open (a theme's preview)
}

/** An entry in an option's ▸ submenu. */
export interface SubOption {
  id: string;
  label: string;
  run?: () => void;
  checked?: boolean; // the current choice: the submenu opens on it (Sort By)
  confirm?: string; // ask first (Delete)
  info?: () => { title: string; lines: [string, string][] }; // shows this instead (Information)
}

/** A setting with a fixed list of options; its current value shows in the value column. */
function settingItem<K extends keyof Settings>(
  id: string,
  label: string,
  description: string,
  key: K,
  labels: Record<string, string>,
  swatch?: Choices["swatch"],
): Item {
  const choices: Choices = {
    options: Object.entries(labels).map(([value, l]) => ({ value, label: l })),
    current: () => String(getSettings()[key]),
    set: (value) => updateSettings({ [key]: value } as Partial<Settings>),
    swatch,
  };
  return { id, label, description, icon: "setting", choices };
}

/** Theme Settings > Theme (as on the PS3): Install on its own above Original (the wave), then the installed PS3 themes. */
function themePicker(): Item {
  return {
    id: "th-theme",
    label: "Theme",
    icon: "setting",
    description: "Sets for use of a preset combination of elements such as colour, background or icons.",
    choices: {
      head: {
        id: "th-install",
        label: "Install",
        icon: "download",
        description: "Installs a PS3 theme (.p3t or .pkg). Choose a licence (.rap) for a theme that needs one.",
        run: () => void browseTheme(),
      },
      options: [{ value: "", label: "Original" }, ...installedThemes().map((t) => ({ value: t.id, label: t.name, image: t.thumbData ?? undefined }))],
      current: () => getSettings().customTheme,
      set: (value) => void applyTheme(value),
      more: (value) => {
        const t = installedThemes().find((t) => t.id === value);
        if (!t) return undefined; // Original
        return [
          { id: "apply", label: "Apply", run: () => void applyTheme(t.id) },
          { id: "delete", label: "Delete", confirm: `Delete "${t.name}"?`, run: () => void deleteTheme(t.id) },
          { id: "info", label: "Information", info: () => ({ title: t.name, lines: [["Location", t.path ?? "Unknown"]] }) },
        ];
      },
      picture: (value) => (value ? themePreview(value) : undefined),
    },
  };
}

const themeFolder: Item = {
  id: "s-theme",
  label: "Theme Settings",
  icon: "theme",
  children: () => [
    themePicker(),
    settingItem("th-colour", "Colour", "Sets the colour of the background and options menu.", "theme", COLOUR_OPTIONS as Record<string, string>, (v) =>
      rgb(swatchColor(v as ThemeKey)),
    ),
    brightnessItem(),
    plainItem(
      settingItem("th-game-art", "Game Icons", "Shows each game as its capsule art, or as its logo.", "gameArt", {
        capsule: "Capsule",
        logo: "Logo",
      }),
    ),
    plainItem(
      settingItem(
        "th-resolution",
        "Resolution",
        "Draws an animated theme at the screen's resolution, or at 1080p (as PS3 themes were made) for less work.",
        "themeResolution",
        { native: "Native", "1080p": "1080p" },
      ),
    ),
    plainItem(
      settingItem("th-deep", "Deep Blacks", "Deepens the darkest tones of a theme's background, as PS3 footage often shows them.", "deepBlacks", {
        off: "Off",
        on: "On",
      }),
    ),
  ],
};

function plainItem(it: Item): Item {
  it.choices!.plain = true;
  return it;
}

/** Theme Settings > Brightness: dims the background; each option previews as it's selected, as on the PS3. */
function brightnessItem(): Item {
  const it = plainItem(settingItem("th-brightness", "Brightness", "Adjusts the brightness of the background.", "brightness", BRIGHTNESS_OPTIONS));
  it.choices!.brightness = true;
  return it;
}

/** Settings > Controller Settings: the button symbols shown (here and throughout Steam), then Steam's own Controller page. */
const controllerFolder: Item = {
  id: "s-ctrl",
  label: "Controller Settings",
  icon: "controller",
  children: () => [
    {
      id: "ctrl-glyphs",
      label: "Controller Symbols",
      description: "Sets the button symbols shown on screen.",
      icon: "setting",
      choices: {
        options: [{ value: "steam", label: "Steam Default" }, ...GLYPH_SETS.map((g) => ({ value: g.id, label: g.label }))],
        current: () => getSettings().controllerGlyphs,
        set: (v) => updateSettings({ controllerGlyphs: v }),
        plain: true,
      },
    },
    {
      id: "ctrl-all",
      label: "All Controller Settings",
      description: "Opens Steam's Controller settings.",
      icon: "setting",
      run: sys.go("/settings/controller"),
    },
  ],
};

const ON_OFF = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];
const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => ({ value: String(i), label: String(i) }));
const VOLUME_STEPS = steps(AUDIO_STEPS);

/** One of Steam's settings, chosen from a plain list (as System Settings' are); its value shows in the value column. */
function steamSetting(id: string, label: string, description: string, options: Choices["options"], current: () => string, set: (v: string) => void): Item {
  return { id, label, description, icon: "setting", choices: { options, current, set, plain: true } };
}
const onOffSetting = (id: string, label: string, description: string, get: () => boolean, set: (on: boolean) => void) =>
  steamSetting(
    id,
    label,
    description,
    ON_OFF,
    () => (get() ? "on" : "off"),
    (v) => set(v === "on"),
  );

/** Settings > System Settings: as Steam's own System page has them (set from here), then that page itself. */
const systemFolder: Item = {
  id: "s-system",
  label: "System Settings",
  icon: "system",
  children: () => [
    {
      id: "sys-hostname",
      label: "Hostname",
      description: "Sets the name for this system. You can use the name to distinguish multiple systems on a network.",
      value: systemHostname(),
      icon: "setting",
      run: changeHostname,
    },
    steamSetting(
      "sys-language",
      "System Language",
      languageNeedsRestart() ? "Sets the language used by the system. The new language is used once Steam restarts." : "Sets the language used by the system.",
      systemLanguages(),
      systemLanguage,
      setSystemLanguage,
    ),
    onOffSetting("sys-devmode", "Enable Developer Mode", "Shows the Developer section in Steam's settings.", developerMode, setDeveloperMode),
    {
      id: "sys-info",
      label: "System Information",
      description: "Displays information about this system.",
      icon: "setting",
      screen: { title: "System Information", icon: "system", lines: systemInformation },
    },
    { id: "sys-all", label: "All System Settings", description: "Opens Steam's System settings.", icon: "setting", run: sys.go("/settings/system") },
  ],
};

/** Settings > Display Settings: as Steam's own Display page has them (those it shows on this screen), then that page itself. */
const displayFolder: Item = {
  id: "s-display",
  label: "Display Settings",
  icon: "display",
  children: () => [
    ...(brightnessAvailable()
      ? [
          steamSetting(
            "dsp-brightness",
            "Brightness",
            "Adjusts the brightness of the screen.",
            steps(BRIGHTNESS_STEPS),
            displayBrightness,
            setDisplayBrightness,
          ),
        ]
      : []),
    ...(adaptiveBrightnessAvailable()
      ? [
          onOffSetting(
            "dsp-adaptive",
            "Adaptive Brightness",
            "Adjusts the brightness of the screen to the light around it.",
            adaptiveBrightness,
            setAdaptiveBrightness,
          ),
        ]
      : []),
    ...(displaySupported()
      ? [
          onOffSetting("dsp-night", "Night Mode", "Tints the screen warmer, until the morning.", nightMode, setNightMode),
          onOffSetting(
            "dsp-night-schedule",
            "Schedule Night Mode",
            "Turns Night Mode on and off at set times each day.",
            nightModeSchedule,
            setNightModeSchedule,
          ),
          steamSetting("dsp-night-start", "Night Mode Start", "Sets the time Night Mode turns on.", nightModeHours(), nightModeStart, setNightModeStart),
          steamSetting("dsp-night-end", "Night Mode End", "Sets the time Night Mode turns off.", nightModeHours(), nightModeEnd, setNightModeEnd),
          steamSetting("dsp-night-tint", "Night Mode Tint", "Sets how warm Night Mode tints the screen.", NIGHT_TINTS, nightModeTint, setNightModeTint),
        ]
      : []),
    ...(hdrAvailable() ? [onOffSetting("dsp-hdr", "Enable HDR", "Shows games in HDR on this display.", hdrEnabled, setHdrEnabled)] : []),
    ...(gameResolutionAvailable()
      ? [
          steamSetting(
            "dsp-game-res",
            "Maximum Game Resolution",
            "Sets the highest resolution games run at. It's used from the next game you start.",
            gameResolutions(),
            gameResolution,
            setGameResolution,
          ),
        ]
      : []),
    ...(magnifierAvailable()
      ? [steamSetting("dsp-magnifier", "Magnifier Scale", "Sets how far the magnifier zooms in.", MAGNIFIER_SCALES, magnifierScale, setMagnifierScale)]
      : []),
    { id: "dsp-all", label: "All Display Settings", description: "Opens Steam's Display settings.", icon: "setting", run: sys.go("/settings/display") },
  ],
};

/** A paired Bluetooth device: whether it's connected (and its battery) beside it; ✕ for what can be done with it. */
function bluetoothItem(d: BluetoothDevice): Item {
  const status = [d.connected ? "Connected" : "Not Connected", d.battery !== undefined ? `${d.battery}%` : ""].filter(Boolean).join("  ");
  return {
    id: `bt:${d.id}`,
    label: d.name,
    value: status,
    icon: "bluetooth",
    actions: () => [
      d.connected
        ? { id: "disconnect", label: "Disconnect", icon: "bluetooth", run: () => disconnectDevice(d) }
        : { id: "connect", label: "Connect", icon: "bluetooth", run: () => connectDevice(d) },
      ...(d.wakeSupported
        ? [
            {
              id: "wake",
              label: "Allow Wake",
              sub: "This device can wake the system.",
              icon: "check" as IconName,
              checked: d.wake,
              run: () => setDeviceWake(d, !d.wake),
            },
          ]
        : []),
      { id: "trusted", label: "Trusted", sub: "Connects without asking.", icon: "check", checked: d.trusted, run: () => setDeviceTrusted(d, !d.trusted) },
      { id: "forget", label: "Forget", sub: "Unpairs this device.", icon: "setting", confirm: `Forget "${d.name}"?`, run: () => forgetDevice(d) },
    ],
  };
}

/**
 * Bluetooth Settings > Register New Device (as the PS3's): searches while it's open, listing the devices found nearby,
 * strongest first; ✕ pairs with one (it then joins the paired devices, a level up).
 */
const registerFolder: Item = {
  id: "bt-register",
  label: "Register New Device",
  description: "Searches for devices to pair with this system. Put the device in pairing mode first.",
  icon: "bluetooth",
  whileOpen: searchForDevices,
  children: () => {
    const near = foundDevices();
    if (!near.length) return [{ id: "bt-searching", label: "Searching...", icon: "bluetooth", description: "Put the device in pairing mode." }];
    return near.map((d) => ({
      id: `bt-found:${d.id}`,
      label: d.name,
      value: d.pairing ? "Pairing..." : undefined,
      icon: "bluetooth" as IconName,
      run: () => pairDevice(d),
    }));
  },
};

/** Settings > Bluetooth Settings: Bluetooth on or off and the devices paired with this system, then Steam's page itself. */
const bluetoothFolder: Item = {
  id: "s-bt",
  label: "Bluetooth Settings",
  icon: "bluetooth",
  children: () => [
    ...(bluetoothAvailable()
      ? [
          onOffSetting("bt-enable", "Enable Bluetooth", "Turns Bluetooth on or off.", bluetoothEnabled, setBluetoothEnabled),
          ...(bluetoothEnabled() ? [registerFolder, ...bluetoothDevices().map(bluetoothItem)] : []),
        ]
      : []),
    {
      id: "bt-all",
      label: "All Bluetooth Settings",
      description: "Opens Steam's Bluetooth settings.",
      icon: "setting",
      run: sys.go("/settings/bluetooth"),
    },
  ],
};

/** A network: whether it's connected (and a Wi-Fi network's signal) beside it; ✕ for what can be done with it. */
function networkItem(n: Network): Item {
  const icon: IconName = n.wireless ? "wifi" : "network";
  const actions: Action[] = [
    ...(n.disconnectable ? [{ id: "disconnect", label: "Disconnect", icon, run: () => disconnectNetwork(n) }] : []),
    ...(n.connectable
      ? [{ id: "connect", label: n.wireless && (n.saved || n.security === "None") ? "Connect" : "Connect...", icon, run: () => void connectNetwork(n) }]
      : []),
    ...(n.wireless && n.saved
      ? [
          {
            id: "auto",
            label: "Connect Automatically",
            sub: "Joins this network whenever it's in range.",
            icon: "check" as IconName,
            checked: n.autoconnect,
            run: () => setAutoconnect(n, !n.autoconnect),
          },
        ]
      : []),
    ...(n.forgettable
      ? [
          {
            id: "forget",
            label: "Forget",
            sub: "Removes this network and its password.",
            icon: "setting" as IconName,
            confirm: `Forget "${n.name}"?`,
            run: () => forgetNetwork(n),
          },
        ]
      : []),
  ];
  return {
    id: `net:${n.key}`,
    label: n.name,
    value: [n.status, n.strength !== undefined ? `${n.strength}%` : ""].filter(Boolean).join("  "),
    description: n.wireless ? [n.security === "None" ? "No Security" : n.security, n.saved ? "Saved" : ""].filter(Boolean).join(" · ") : "Wired Connection",
    icon,
    ...(actions.length ? { actions: () => actions } : {}),
  };
}

/**
 * Network Settings > Internet Connection Settings: the networks this system can see, looked for while it's open
 * (as Steam's page does); then a network by its name (a hidden one), in Steam's own dialog.
 */
const connectionFolder: Item = {
  id: "net-connect",
  label: "Internet Connection Settings",
  description: "Choose a network to connect to.",
  icon: "setting",
  whileOpen: scanForNetworks,
  children: () => {
    const list = networks().map(networkItem);
    return [
      ...(list.length
        ? list
        : [{ id: "net-searching", label: wifiEnabled() || !wifiAvailable() ? "Searching..." : "Wi-Fi is turned off", icon: "wifi" as IconName }]),
      ...(wifiAvailable() && wifiEnabled()
        ? [
            {
              id: "net-other",
              label: "Other Network...",
              description: "Connects to a network by its name (a hidden network), in Steam's network dialog.",
              icon: "wifi" as IconName,
              run: () => void (connectWithDialog() || sys.go("/settings/internet")()),
            },
          ]
        : []),
    ];
  },
};

/** Settings > Network Settings, as the PS3's: Wi-Fi, Test Connection, the status list and the networks; then Steam's page. */
const networkFolder: Item = {
  id: "s-net",
  label: "Network Settings",
  icon: "wifi",
  children: () => [
    ...(wifiAvailable() ? [onOffSetting("net-wifi", "Wi-Fi", "Turns Wi-Fi on or off.", wifiEnabled, setWifiEnabled)] : []),
    ...(networkAvailable()
      ? [
          {
            id: "net-test",
            label: "Test Connection",
            description: "Tests the connection to the network, the Internet and Steam.",
            icon: "setting" as IconName,
            screen: { title: "Test Connection", icon: "network" as IconName, lines: testConnection, pending: testingLines },
          },
          {
            id: "net-status",
            label: "Settings and Connection Status List",
            description: "Shows the settings of the connection in use, and its status.",
            icon: "setting" as IconName,
            screen: { title: "Settings and Connection Status List", icon: "network" as IconName, lines: connectionStatus },
          },
        ]
      : []),
    ...(networkManaged() ? [connectionFolder] : []),
    { id: "net-all", label: "All Network Settings", description: "Opens Steam's Internet settings.", icon: "setting", run: sys.go("/settings/internet") },
  ],
};

/** A device's volume (output) or level (input), and the device itself; only if there's one that way to choose. */
function audioSettings(dir: AudioDirection, level: [string, string, string], device: [string, string, string]): Item[] {
  if (!audioHas(dir)) return [];
  return [
    steamSetting(
      ...level,
      VOLUME_STEPS,
      () => audioVolume(dir),
      (v) => setAudioVolume(dir, v),
    ),
    steamSetting(
      ...device,
      audioDeviceOptions(dir),
      () => audioDevice(dir),
      (v) => setAudioDevice(dir, v),
    ),
  ];
}

/** Settings > Sound Settings: as Steam's own Audio page has them (set from here), then that page itself. */
const soundFolder: Item = {
  id: "s-audio",
  label: "Sound Settings",
  icon: "audio",
  children: () => [
    ...audioSettings(
      AudioDirection.Output,
      ["snd-volume", "Volume", "Adjusts the volume of the audio output device."],
      ["snd-output", "Output Device", "Sets the device used for audio output."],
    ),
    ...audioSettings(
      AudioDirection.Input,
      ["snd-mic", "Microphone Level", "Adjusts the input level of the microphone."],
      ["snd-input", "Input Device", "Sets the device used for audio input."],
    ),
    onOffSetting("snd-ui", "Enable UI Sounds", "Plays sounds as you move through Steam's menus.", uiSounds, setUiSounds),
    { id: "snd-all", label: "All Sound Settings", description: "Opens Steam's Audio settings.", icon: "setting", run: sys.go("/settings/audio") },
  ],
};

const dateTimeFolder: Item = {
  id: "s-datetime",
  label: "Date and Time Settings",
  icon: "clock",
  children: () => [
    settingItem("dt-date", "Date Format", "Sets the order of display for year, month and day.", "dateFormat", DATE_FORMATS),
    settingItem("dt-time", "Time Format", "Sets the display format for the time.", "timeFormat", TIME_FORMATS),
  ],
};

const duration = (s: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

/** The Soundtracks column: each soundtrack you own as its own folder (with its album cover), downloaded or not. */
function soundtrackItems(): Item[] {
  const list = soundtracks();
  if (!list.length) return [{ id: "st-none", label: "No soundtracks", icon: "info", description: "Soundtracks you own on Steam are listed here." }];
  // Album covers, as on the PS3 (and Steam's Soundtracks shelf); the store banner if there's no cover.
  return list.map((g) => ({
    id: `st:${g.appid}`,
    label: g.name,
    ...(g.cover?.length ? { cover: [...g.cover, ...g.icon] } : { art: g.icon }),
    sub: "Soundtrack",
    children: () => albumItems(g),
  }));
}

/** A soundtrack's tracks. Downloaded ones play here; the rest open its Steam page (to download it). */
function albumItems(g: Game): Item[] {
  const album = albumTracks(g.appid);
  if (!album) return [{ id: "sta-loading", label: "Loading…", icon: "info" }];
  if (!album.tracks.length)
    return [{ id: "sta-none", label: "No track list", icon: "info", description: "Open it in Steam to download it.", run: () => openGamePage(g) }];
  const now = nowPlaying();
  return album.tracks.map((t, i) => {
    const here = now?.appid === g.appid && now.index === i;
    const state = here
      ? now!.paused
        ? "Paused"
        : "Playing"
      : t.path
        ? duration(t.seconds)
        : ["Not downloaded", duration(t.seconds)].filter(Boolean).join("  ·  ");
    return {
      id: `stt:${g.appid}:${i}`,
      label: t.title,
      icon: here && !now!.paused ? "play" : "music",
      description: state || undefined,
      run: t.path ? () => void playTrack(g.appid, i) : () => openGamePage(g),
    };
  });
}

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/** The Photo column's folders: a game's screenshots each, the game with the newest first; ✕ on one shows it. */
function screenshotFolders(): Item[] {
  const byGame = new Map<number, Shot[]>();
  for (const s of allScreenshots()) {
    const list = byGame.get(s.appid);
    if (list) list.push(s);
    else byGame.set(s.appid, [s]);
  }
  if (!byGame.size)
    return [
      {
        id: "shots-none",
        label: "No screenshots",
        icon: "info",
        description: "Screenshots you take in games, and those on your Steam profile, are listed here.",
      },
    ];
  return [...byGame].map(([appid, list]) => {
    const g = gameByAppid(appid);
    return {
      id: `shots:${appid}`,
      label: g?.name ?? (appid === STEAM_APPID ? "Steam" : `App ${appid}`),
      sub: count(list.length, "screenshot"),
      // (Steam's own: the Steam app's header (753), a screenshot only offline)
      art: appid === STEAM_APPID && !g ? [`${CDN}/753/header.jpg`, list[0].thumb] : [...(g?.icon ?? [`${CDN}/${appid}/header.jpg`]), list[0].thumb],
      // (read again each time, so a folder left open shows screenshots taken or uploaded since)
      children: () =>
        allScreenshots()
          .filter((s) => s.appid === appid)
          .map((s) => ({
            id: `shot:${s.id}`,
            label: s.caption || formatDateTime(s.created),
            sub:
              [s.caption ? formatDateTime(s.created) : s.width && s.height ? `${s.width} × ${s.height}` : "", s.cloud ? "Steam Cloud" : ""]
                .filter(Boolean)
                .join("  ·  ") || undefined,
            art: [s.thumb, s.url],
            picture: s.url,
          })),
    };
  });
}
const STEAM_APPID = 7; // screenshots of Steam itself (Big Picture)

/** The PS3 System Update item: checks, installs, and finishes Steam / SteamOS / firmware updates, as Steam's own System settings do. */
export function systemUpdateItem(): Item {
  const u = updateStatus();
  const base = { id: "s-update", label: "System Update", icon: "update" as IconName };
  const ago = (t: number | null) => {
    if (!t) return "";
    const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
    return m < 1
      ? " (checked just now)"
      : m < 60
        ? ` (checked ${m} min ago)`
        : m < 1440
          ? ` (checked ${Math.round(m / 60)} h ago)`
          : ` (checked ${Math.round(m / 1440)} d ago)`;
  };
  const err = u.error ? ` Last attempt failed: ${u.error}.` : "";
  switch (u.state) {
    case UpdateState.Checking:
      return { ...base, description: "Checking for updates…" };
    case UpdateState.Available:
      return {
        ...base,
        description: `Update available: ${u.available.join(", ") || "system software"}.${err}`,
        confirm: "Download and install the update now?",
        run: installUpdates,
      };
    case UpdateState.Applying:
      return { ...base, description: `Downloading and installing${u.percent != null ? ` (${u.percent}%)` : ""}…` };
    case UpdateState.ClientRestartPending:
      return {
        ...base,
        description: "The update is ready. Steam needs to restart to finish it.",
        confirm: "Restart Steam now to finish the update?",
        run: finishUpdate,
      };
    case UpdateState.SystemRestartPending:
    case UpdateState.RollBack:
      return {
        ...base,
        description: "The update is ready. The system needs to restart to finish it.",
        confirm: "Restart the system now to finish the update?",
        run: finishUpdate,
      };
    default:
      return { ...base, description: `Updates the system software on this system. Up to date${ago(u.checked)}.${err}`, run: checkForUpdates };
  }
}

const withBadge = (items: Item[]) => items.map((it) => ({ ...it, badge: true }));

export interface Category {
  id: string;
  label: string;
  icon: IconName;
  items: Item[];
}

const gameItem = (g: Game, prefix: string): Item => ({ id: `${prefix}:${g.appid}`, label: g.name, game: g });

/**
 * A game's trophies in the XMB, as the PS3 lists them opened from its Trophy Collection: each one's picture, its cup
 * and name; selected, what it's for and when it was earned. Hidden ones not yet earned keep their secret.
 */
function trophyItems(g: Game): Item[] {
  const list = trophyList(g.appid);
  const options = { label: "Options", actions: () => trophyOptions(g) };
  if (!list) return [{ id: "tro-loading", label: "Loading…", icon: "info", options }];
  if (!list.length) {
    // (it has some, by its progress, but they couldn't be read: not "none")
    const failed = !!knownAchievementProgress(g.appid)?.total;
    return [
      failed
        ? { id: "tro-none", label: "Couldn't read its achievements", icon: "info", description: "Try again later, or Sync with Server.", options }
        : { id: "tro-none", label: "No achievements", icon: "info", description: "This game has no achievements.", options },
    ];
  }
  // Group Content: a folder for the base game and one for each DLC (or update), as the PS3 lists a game's add-on packs.
  const sections = trophySections(g, list);
  if (sections)
    return sections.map((sec) => ({
      id: `grp:${sec.key}`,
      label: sec.name,
      art: sec.art,
      groupProgress: countOf(sec.trophies),
      options,
      children: () => {
        // (Group Content turned off in here: all of them)
        const now = trophyList(g.appid) ?? [];
        const secs = trophySections(g, now);
        return trophyRows(g, secs ? (secs.find((k) => k.key === sec.key)?.trophies ?? []) : now);
      },
    }));
  return trophyRows(g, list);
}

function trophyRows(g: Game, list: Trophy[]): Item[] {
  const options = { label: "Options", actions: () => trophyOptions(g) };
  return sortTrophies(list, getSettings().trophySort, trophyLabel).map((t) => {
    const secret = t.hidden && !t.achieved;
    return {
      id: `tro:${t.id}`,
      label: trophyLabel(t),
      icon: "trophy" as IconName,
      ...(!t.achieved ? { cover: [LOCKED_TROPHY] } : t.image ? { cover: [t.image] } : {}), // (the PS3's padlock till it's earned)
      description: [secret ? "" : t.description, t.achieved && t.unlocked ? formatDateTime(t.unlocked) : ""].filter(Boolean).join("\n") || undefined,
      trophy: { tier: tierOf(t), earned: t.achieved },
      options,
    };
  });
}

const trophyLabel = (t: Trophy) => (t.hidden && !t.achieved ? "Hidden Achievement" : t.name);

/** △ on a game's trophies: the PS3's options. Group Content only for a game whose trophies came in groups (DLC). */
function trophyOptions(g: Game): Action[] {
  const on = getSettings().trophyGroups;
  const grouped = !!trophySections(g, trophyList(g.appid) ?? [], undefined, true);
  return [
    ...(grouped
      ? [
          {
            id: "group",
            label: "Group Content",
            icon: "folder" as IconName,
            zoom: true,
            more: [
              { id: "on", label: "On", checked: on, run: () => updateSettings({ trophyGroups: true }) },
              { id: "off", label: "Off", checked: !on, run: () => updateSettings({ trophyGroups: false }) },
            ],
            run: () => {},
          },
        ]
      : []),
    {
      id: "sort",
      label: "Sort By",
      icon: "setting",
      zoom: true,
      more: TROPHY_SORTS.map(([id, label]) => ({ id, label, checked: getSettings().trophySort === id, run: () => updateSettings({ trophySort: id }) })),
      run: () => {},
    },
    { id: "page", label: "Trophy Page", icon: "trophy", run: () => showTrophyPage(g) },
  ];
}

/**
 * △ on a game in Trophy Collection: hide it (or unhide it, its achievements looked for again), the hidden games listed or
 * not, and Sync with Server. Games found to have no achievements are hidden by themselves.
 */
function collectionGameOptions(g: Game): Action[] {
  const hidden = trophyGameHidden(g.appid);
  const show = getSettings().trophyShowHidden;
  return [
    hidden
      ? {
          id: "unhide",
          label: "Unhide Game",
          ...(knownAchievementProgress(g.appid) === null ? { sub: "No achievements found" } : {}),
          icon: "trophy",
          run: () => hideTrophyGame(g.appid, false),
        }
      : { id: "hide", label: "Hide Game", icon: "trophy", run: () => hideTrophyGame(g.appid, true) },
    {
      id: "show",
      label: "Show Hidden Games",
      icon: "setting",
      more: [
        { id: "on", label: "On", checked: show, run: () => updateSettings({ trophyShowHidden: true }) },
        { id: "off", label: "Off", checked: !show, run: () => updateSettings({ trophyShowHidden: false }) },
      ],
      run: () => {},
    },
    { id: "sync", label: "Sync with Server", icon: "update", run: () => syncAchievements(allGameIds()) },
  ];
}

/** The games Trophy Collection lists: less those hidden, unless they're shown. */
const listedTrophyGames = (games: Game[]) => (getSettings().trophyShowHidden ? games : games.filter((g) => !trophyGameHidden(g.appid)));

/**
 * Network > Trophy Collection: every game, by name, with how much of it you've earned beside it (asked for as each
 * comes on screen); ✕ opens its trophies, as they were last shown (△ switches). It opens on the game played last
 * (the Game column's order: not one moved to Video) that's listed and not known to have no achievements.
 * `games`: the library by name, read once as the column's built (not again as it opens, nor as each trophy list loads).
 */
const achievementFolder = (games: () => Game[]): Item => ({
  id: "achievements",
  label: "Trophy Collection",
  icon: "cup",
  startAt: () => {
    const s = getSettings();
    const last = notVideo(recentGames(s.installedOnly)).find(
      (g) => (s.trophyShowHidden || !trophyGameHidden(g.appid)) && knownAchievementProgress(g.appid) !== null,
    );
    return last && `ach:${last.appid}`;
  },
  options: {
    label: "Options",
    actions: () => [{ id: "sync", label: "Sync with Server", icon: "update", run: () => syncAchievements(allGameIds()) }],
  },
  // (by name, as they're listed: those not known yet are asked for in the order they're scrolled to)
  whileOpen: () => refreshAchievementProgress(listedTrophyGames(games()).map((g) => g.appid)),
  children: () =>
    listedTrophyGames(games()).map((g) => ({
      id: `ach:${g.appid}`,
      label: g.name,
      art: g.icon,
      logo: g.logo,
      trophies: g.appid,
      options: { label: "Options", actions: () => collectionGameOptions(g) },
      ...(getSettings().trophyCollection === "xmb"
        ? { whileOpen: () => watchTrophyList(g.appid), children: () => trophyItems(g) }
        : { run: () => openAchievements(g, true) }),
    })),
});

/** fn's result, worked out the first time it's wanted and kept. */
function once<T>(fn: () => T): () => T {
  let v: { value: T } | undefined;
  return () => (v ??= { value: fn() }).value;
}

/** A Game column folder: its games, less those moved to the Video column. */
function gamesFolder(id: string, label: string, icon: IconName, load: () => Game[]): Item {
  return { id, label, icon, sub: "Folder", children: () => notVideo(load()).map((g) => gameItem(g, id)) };
}

// The games moved to the Video column (△ on a game: Move to Video), which the Game column leaves out.
const isVideo = (g: Game) => getSettings().videoGames.includes(g.appid);
const notVideo = (games: Game[]) => games.filter((g) => !isVideo(g));

// Steam's own collections that the Game column lists otherwise: installed games (a folder of its own) and soundtracks (not games: the Soundtracks column).
const NOT_COLLECTIONS = ["favorite", "local-install", "type-music"];

export function buildCategories(s: Pick<Settings, "installedOnly" | "gameFavorites" | "gameInstalled" | "gameCollections" | "videoGames">): Category[] {
  const cols = collections();
  const fav = s.gameFavorites ? cols.find((c) => c.id === "favorite") : undefined;
  const installed = cols.find((c) => c.id === "local-install");
  const recent = recentGames(false); // (most recently played first)
  return [
    {
      id: "users",
      label: "Users",
      icon: "users",
      items: [
        { id: "user", label: sys.userName(), sub: "Signed in", icon: "users", run: sys.openSteamMenu },
        { id: "suspend", label: "Suspend", icon: "moon", confirm: "Do you want to suspend the system?", confirmScreen: true, run: sys.suspend },
        { id: "restart", label: "Restart System", icon: "restart", confirm: "Do you want to restart the system?", confirmScreen: true, run: sys.restart },
        {
          id: "desktop",
          icon: "desktop",
          confirmScreen: true,
          ...(sys.canSwitchToDesktop()
            ? { label: "Switch to Desktop", confirm: "Do you want to switch to Desktop Mode?", run: sys.switchToDesktop }
            : { label: "Exit Big Picture Mode", confirm: "Do you want to exit Big Picture Mode?", run: sys.exitBigPicture }),
        },
        { id: "off", label: "Turn Off System", icon: "power", confirm: "Do you want to turn off the system?", confirmScreen: true, run: sys.shutdown },
      ],
    },
    settingsCategory(),
    screenshotsCategory(),
    { id: "music", label: "Soundtracks", icon: "music", items: soundtrackItems() },
    { id: "video", label: "Video", icon: "video", items: recent.filter((g) => s.videoGames.includes(g.appid)).map((g) => gameItem(g, "video")) },
    {
      id: "game",
      label: "Game",
      icon: "game",
      items: [
        gamesFolder("all", "All Games", "gamesFolder", allGamesByName),
        ...(fav ? [gamesFolder("favorite", fav.name, "star", fav.games)] : []),
        ...(s.gameInstalled
          ? [
              gamesFolder(
                "installed",
                installed?.name ?? "Locally Installed Games",
                "folder",
                installed?.games ?? (() => allGamesByName().filter((g) => g.installed)),
              ),
            ]
          : []),
        ...(s.gameCollections ? cols.filter((c) => !NOT_COLLECTIONS.includes(c.id)).map((c) => gamesFolder(`col-${c.id}`, c.name, "folder", c.games)) : []),
        ...notVideo(recent.filter((g) => !s.installedOnly || g.installed)).map((g) => gameItem(g, "game")),
      ],
    },
    {
      id: "network",
      label: "Network",
      icon: "network",
      items: [
        achievementFolder(once(allGamesByName)),
        { id: "downloads", label: "Downloads", icon: "download", run: sys.go("/downloads") },
        { id: "store", label: "Steam Store", icon: "store", run: sys.openStore },
      ],
    },
    friendsCategory(),
  ];
}

/** The Settings column alone (rebuilt as Steam's settings change: networks, Bluetooth devices, volumes...). */
export const settingsCategory = (): Category => ({
  id: "settings",
  label: "Settings",
  icon: "settings",
  items: [
    ...(updatesSupported() ? [systemUpdateItem()] : []),
    ...withBadge([
      systemFolder,
      themeFolder,
      dateTimeFolder,
      displayFolder,
      soundFolder,
      controllerFolder,
      bluetoothFolder,
      networkFolder,
      { id: "s-qam", label: "Quick Access", sub: "Decky plugins and quick settings", icon: "quick", run: sys.openQuickAccess },
      { id: "s-all", label: "All Settings", icon: "settings", run: sys.go("/settings") },
    ]),
  ],
});

/** The Screenshots column alone (rebuilt as screenshots are taken, uploaded or deleted). */
export const screenshotsCategory = (): Category => ({ id: "photo", label: "Screenshots", icon: "photo", items: screenshotFolders() });

/** The Friends column alone (refreshed often, without rebuilding the rest from the library). */
export const friendsCategory = (): Category => ({
  id: "friends",
  label: "Friends",
  icon: "friends",
  items: [
    { id: "friends", label: "Friends & Chat", icon: "chat", run: sys.openFriends },
    ...[loadMe()].filter((m) => !!m).map(meItem),
    ...loadFriends().map(friendItem),
  ],
});
