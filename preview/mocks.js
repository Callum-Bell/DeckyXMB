// Stand-ins for the globals Steam and Decky provide on the Deck, so the XMB can
// run in a normal browser. Keyboard: arrows = D-pad, Enter = ✕, Esc = ○,
// Y = △, X = □, Q / E = L1 / R1.
(function () {
  const R = window.React;
  window.SP_REACT = R;

  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.style.cssText =
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:10px 18px;border-radius:6px;font:14px sans-serif;z-index:99;transition:opacity .3s";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = 1;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.opacity = 0), 1800);
  }

  const GamepadButton = {
    INVALID: 0,
    OK: 1,
    CANCEL: 2,
    SECONDARY: 3,
    OPTIONS: 4,
    BUMPER_LEFT: 5,
    BUMPER_RIGHT: 6,
    TRIGGER_LEFT: 7,
    TRIGGER_RIGHT: 8,
    DIR_UP: 9,
    DIR_DOWN: 10,
    DIR_LEFT: 11,
    DIR_RIGHT: 12,
    SELECT: 13,
    START: 14,
  };
  const KEYS = {
    ArrowUp: "DIR_UP",
    ArrowDown: "DIR_DOWN",
    ArrowLeft: "DIR_LEFT",
    ArrowRight: "DIR_RIGHT",
    Enter: "OK",
    Escape: "CANCEL",
    Backspace: "CANCEL",
    y: "OPTIONS",
    x: "SECONDARY",
    q: "BUMPER_LEFT",
    e: "BUMPER_RIGHT",
    m: "START",
  };

  function Focusable(props) {
    const ref = R.useRef(null);
    const p = R.useRef(props);
    p.current = props;
    R.useEffect(() => {
      const onKey = (k) => {
        const name = KEYS[k.key] ?? KEYS[k.key.toLowerCase?.()];
        if (!name) return;
        k.preventDefault();
        const ev = { detail: { button: GamepadButton[name], is_repeat: k.repeat }, preventDefault() {}, stopPropagation() {}, currentTarget: ref.current };
        const q = p.current;
        q.onButtonDown?.(ev);
        if (name.startsWith("DIR_")) q.onGamepadDirection?.(ev);
        else if (name === "OK") q.onOKButton?.(ev);
        else if (name === "CANCEL") q.onCancelButton?.(ev);
        else if (name === "OPTIONS") q.onOptionsButton?.(ev);
        else if (name === "SECONDARY") q.onSecondaryButton?.(ev);
        else if (name === "START") q.onMenuButton?.(ev);
      };
      // (a key let go: the button up, for △ held)
      const onUp = (k) => {
        const name = KEYS[k.key] ?? KEYS[k.key.toLowerCase?.()];
        if (name) p.current.onButtonUp?.({ detail: { button: GamepadButton[name] }, preventDefault() {}, stopPropagation() {}, currentTarget: ref.current });
      };
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onUp);
      return () => {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onUp);
      };
    }, []);
    return R.createElement("div", { ref, style: props.style, className: props.className }, props.children);
  }

  const Panel = (p) => R.createElement("div", null, p.children);
  window.DFL = {
    Focusable,
    GamepadButton,
    Navigation: {
      Navigate: (r) => toast("Navigate → " + r),
      NavigateBack: () => toast("Back"),
      OpenQuickAccessMenu: () => toast("Open Quick Access"),
      OpenMainMenu: () => toast("Open Steam menu"),
      OpenPowerMenu: () => toast("Open power menu"),
      NavigateToSteamWeb: (u) => toast("Steam web → " + u),
      NavigateToExternalWeb: (u) => toast("Browser → " + u),
      NavigateToChat: () => toast("Friends & chat"),
    },
    useParams: () => ({ appid: new URLSearchParams(location.search).get("trophies") }),
    showContextMenu: () => toast("Steam game menu (Play, Properties…)"),
    PanelSection: Panel,
    PanelSectionRow: Panel,
    ToggleField: Panel,
    ButtonItem: Panel,
    DropdownItem: Panel,
    SliderField: Panel,
    staticClasses: {},
    footerClasses: { BasicFooter: "mock-footer" },
    ConfirmModal: Panel,
    TextField: Panel,
    showModal: () => (toast("Change the name of this device (dialog)"), { Close() {} }),
  };

  const store = {};
  window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit = {
    connect: () => ({
      routerHook: { addPatch: () => 0, removePatch() {} },
      toaster: {
        toast(t) {
          console.log("[toast]", t.title, "-", t.body);
        },
      },
      // No file browser in the preview: window.__xmbPick (a path) stands in for choosing a file.
      openFilePicker: async () => (window.__xmbPick ? { path: window.__xmbPick, realpath: window.__xmbPick } : Promise.reject("User canceled")),
      // Settings are kept in memory; other backend methods can be faked with window.__xmbBackend.
      call: async (m, ...args) =>
        m === "get_settings"
          ? (store.s ?? null)
          : m === "set_settings"
            ? ((store.s = args[0]), true)
            : ((window.__xmbBackend?.[m] ?? mockBackend[m])?.(...args) ?? null),
    }),
  };

  // A small fake library (real app ids so Steam's CDN art loads).
  const now = Date.now() / 1000;
  const day = 86400;
  const games = [
    [1145360, "Hades", 0.2, 3100, true],
    [1245620, "ELDEN RING", 1, 9200, true],
    [367520, "Hollow Knight", 3, 2500, true],
    [413150, "Stardew Valley", 6, 14000, true],
    [504230, "Celeste", 12, 900, true],
    [620, "Portal 2", 40, 1300, true],
    [292030, "The Witcher 3: Wild Hunt", 90, 6000, true],
    [105600, "Terraria", 200, 4100, true],
    [1091500, "Cyberpunk 2077", 300, 3000, false],
    [570, "Dota 2", 0, 0, false],
    [1086940, "Baldur's Gate 3", 20, 5200, true],
    [588650, "Dead Cells", 60, 700, true],
    [2620629162, "Jak II: Renegade", 8, 400, true], // (a non-Steam game: its achievements from RetroAchievements)
  ].map(([appid, name, ago, mins, installed]) => ({
    appid,
    display_name: name,
    app_type: 1,
    rt_last_time_played: ago ? now - ago * day : 0,
    minutes_playtime_forever: mins,
    installed,
  }));
  const pick = (...ids) => games.filter((g) => ids.includes(g.appid));
  // Soundtracks: one downloaded (its tracks play a short tone), one not.
  const music = [
    [9000001, "Hades Original Soundtrack", ["No Escape", "Out of Tartarus", "The Painful Way", "Mouth of Styx"], true],
    [9000002, "Celeste Original Soundtrack", ["Prologue", "First Steps", "Resurrections", "Awake"], false],
  ];
  const musicApps = music.map(([appid, name]) => ({ appid, display_name: name, app_type: 8192 }));
  // Real PS3 themes, unpacked into preview/themes/<id>/ as the plugin installs them (theme.json, scene.json, script.vsmx,
  // tex<n>.z, icons/) and listed (their ids) in preview/themes/index.json. Kept out of git: they're the themes' own.
  let local;
  const localThemes = () =>
    (local ??= fetch("themes/index.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((ids) => Promise.all(ids.map((id) => fetch(`themes/${id}/theme.json`).then((r) => r.json()))))
      .then((ts) => ts.map((t) => ({ ...t, path: `/home/deck/homebrew/settings/DeckyXMB/themes/${t.id}` })))
      .catch(() => []));
  // A file as base64, as the backend sends it.
  const fileB64 = async (url) => {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // The backend's saved data (trophy lists, DLC groups...), kept in sessionStorage so a reload finds it.
  const cacheOf = (kind) => JSON.parse(sessionStorage.getItem("xmbCache." + kind) ?? "{}");
  const mockBackend = {
    cache_get: (kind, key) => cacheOf(kind)[key] ?? null,
    cache_put: (kind, key, value) => {
      const c = cacheOf(kind);
      c[key] = value;
      sessionStorage.setItem("xmbCache." + kind, JSON.stringify(c));
      return true;
    },
    // RetroAchievements (Emuchievements' account): one game played on it.
    retro_games: () => ({ games: [{ id: 2845, title: "Jak II", console: "PlayStation 2", total: 40, earned: 13 }], error: "" }),
    retro_achievements: () =>
      ["Ruffian", "Mar's Heir", "Fast Fingers", "Krew's Kingdom", "Precursor Path"].map((name, i) => ({
        id: String(i + 1),
        name,
        description: `Do the ${name.toLowerCase()} thing.`,
        image: "",
        achieved: i < 2,
        unlocked: i < 2 ? Math.floor(Date.now() / 1000) - i * 86400 : 0,
        hidden: false,
        rarity: [62, 30, 12, 5, 2][i],
      })),
    // Steam Hunters' groups: two DLC packs for every other game (the last six of its trophies), none for the rest.
    trophy_groups: (appid) =>
      appid % 2
        ? []
        : [
            { name: "Extra Content Pack", appid: null, ids: ["ACH_12", "ACH_13", "ACH_14"] },
            { name: "Season Pass Episode", appid: null, ids: ["ACH_15", "ACH_16", "ACH_17"] },
          ],
    get_soundtrack: (appid) => {
      const [, , titles, downloaded] = music.find((m) => m[0] === appid) ?? [0, "", [], false];
      return {
        downloaded,
        tracks: titles.map((title, i) => ({ title, disc: 1, number: i + 1, seconds: 120 + 37 * i, path: downloaded ? `/music/${appid}/${i}.wav` : null })),
      };
    },
    load_soundtrack_audio: (path) => ({ data: toneWav(330 + 55 * Number(path.split("/").pop()[0])), mime: "audio/wav" }),
    // One installed PS3 theme (no art), slow to load so the "Please wait..." screen shows.
    list_themes: async () => [
      ...(await localThemes()),
      {
        id: "mock-theme",
        name: "Mock Theme",
        author: "Someone",
        comment: "A theme for trying the theme screens.",
        path: "/home/deck/homebrew/settings/DeckyXMB/themes/mock-theme",
      },
      { id: "mock-dynamic", name: "Mock Dynamic Theme", author: "Someone Else", dynamic: true },
    ],
    get_theme_preview: async (id) =>
      (await localThemes()).some((t) => t.id === id)
        ? `themes/${id}/screenshot.png`
        : "https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/library_hero.jpg",
    get_theme_scene: async (id) => ({ scene: await (await fetch(`themes/${id}/scene.json`)).text(), script: await fileB64(`themes/${id}/script.vsmx`) }),
    get_theme_texture: (id, i) => fileB64(`themes/${id}/tex${i}.z`),
    get_theme: async (id) => {
      const local = (await localThemes()).find((t) => t.id === id);
      if (local) {
        const at = (f) => `themes/${id}/${f}`;
        return {
          iconData: Object.fromEntries(local.icons.map((n) => [n, at(`icons/${n}.png`)])),
          backgroundData: local.background ? at(local.background) : null,
          scene: local.scene,
        };
      }
      return new Promise((r) =>
        setTimeout(
          () =>
            r(
              id === "mock-theme"
                ? {
                    iconData: {},
                    backgroundData:
                      "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2210%22%3E%3Crect width=%2216%22 height=%2210%22 fill=%22%23234%22/%3E%3C/svg%3E",
                  }
                : null,
            ),
          1200,
        ),
      );
    },
  };
  window.collectionStore = {
    GetCollection: (id) =>
      id === "type-games"
        ? { allApps: games }
        : id === "type-music"
          ? { allApps: musicApps }
          : id === "favorite"
            ? { displayName: "Favorites", allApps: pick(1145360, 367520, 504230) }
            : null,
    userCollections: [
      { id: "favorite", displayName: "Favorites", allApps: [] },
      { id: "rpg", displayName: "RPGs", allApps: pick(1245620, 292030, 1086940, 1091500) },
      { id: "indie", displayName: "Indies", allApps: pick(1145360, 367520, 413150, 504230, 588650) },
    ],
  };
  // ThemeDeck's backend, reached through Decky (a short tone stands in for a track).
  function toneWav(freq) {
    const rate = 8000,
      n = rate * 2,
      buf = new DataView(new ArrayBuffer(44 + n));
    const str = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF");
    buf.setUint32(4, 36 + n, true);
    str(8, "WAVEfmt ");
    buf.setUint32(16, 16, true);
    buf.setUint16(20, 1, true);
    buf.setUint16(22, 1, true);
    buf.setUint32(24, rate, true);
    buf.setUint32(28, rate, true);
    buf.setUint16(32, 1, true);
    buf.setUint16(34, 8, true);
    str(36, "data");
    buf.setUint32(40, n, true);
    for (let i = 0; i < n; i++) buf.setUint8(44 + i, 128 + 40 * Math.sin((2 * Math.PI * freq * i) / rate));
    let bin = "";
    new Uint8Array(buf.buffer).forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }
  window.__music = [];
  window.DeckyBackend = {
    call: async (route, plugin, method, ...args) => {
      if (route !== "loader/call_plugin_method" || plugin !== "ThemeDeck") throw new Error("Python Exception");
      if (method === "get_tracks")
        return { 1145360: { path: "/music/hades.wav", volume: 1, loop: true }, 1245620: { path: "/music/elden.wav", volume: 0.5, loop: true } };
      if (method === "load_track_audio") {
        window.__music.push("load " + args[0]);
        return { data: toneWav(args[0].includes("hades") ? 330 : 220), mime: "audio/wav" };
      }
      throw new Error("Python Exception");
    },
  };
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__music.push("play");
    this.muted = true; // keep the preview quiet
    return origPlay.call(this);
  };
  const origPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function () {
    window.__music.push("pause");
    return origPause.call(this);
  };

  // Steam's friends store (same getter names as on the device), with made-up friends.
  const avatarSvg = (hue, face) =>
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='hsl(${hue},45%,38%)'/><circle cx='32' cy='26' r='13' fill='hsl(${hue},60%,75%)'/><rect x='14' y='42' width='36' height='22' rx='11' fill='hsl(${hue},60%,75%)'/><text x='32' y='31' font-size='12' text-anchor='middle' fill='hsl(${hue},45%,25%)' font-family='sans-serif'>${face}</text></svg>`,
    );
  const friend = (name, hue, state, game = "", appid = 0, rp = "", status = "") => ({
    is_friend: true,
    steamid64: "7656119" + Math.floor(Math.random() * 1e10),
    display_name: name,
    current_game_name: game,
    current_game_rich_presence: rp,
    localized_online_status: status || (state === "offline" ? "Last online 3 days ago" : state === "away" ? "Away" : "Online"),
    GetCommunityProfileURL: () => "https://steamcommunity.com/id/" + name.toLowerCase(),
    persona: {
      is_online: state !== "offline",
      is_ingame: state === "ingame",
      is_awayOrSnooze: state === "away",
      avatar_url_medium: avatarSvg(hue, name[0]),
      avatar_url_full: avatarSvg(hue, name[0]),
      m_unGamePlayedAppID: appid,
    },
    // (a mini-profile: a level, and for some an animated background, as a real one's)
    miniProfileData: {
      player_level: 10 + (hue % 90),
      m_communityData: {
        profile_background:
          hue % 3 === 1
            ? {
                "video/webm": "https://shared.akamai.steamstatic.com/community_assets/images/items/1768020/185fad255ac235c64fe76101e26ce15097781c78.webm",
                "video/mp4": "https://shared.akamai.steamstatic.com/community_assets/images/items/1768020/a3e542dc27470ba85a55c22071015a2f1d494ad6.mp4",
              }
            : {},
      },
      EnsureCommunityDataLoaded() {},
    },
  });
  window.friendStore = {
    allFriends: [
      friend("Nova", 280, "ingame", "ELDEN RING", 1245620, "Exploring Limgrave"),
      friend("Riley", 200, "ingame", "Hades", 1145360, "Escaping Tartarus"),
      friend("Sam", 20, "online"),
      friend("Jordan", 120, "away"),
      friend("Alex", 330, "online"),
      friend("Kai", 40, "offline", "", 0, "", "Last online 17 hours ago"),
      friend("Morgan", 160, "offline"),
      friend("Quinn", 0, "ingame", "Stardew Valley", 413150, ""),
    ],
    // You (the friends UI's store): your status as set (1 Online, 3 Away, 7 Invisible), and your level.
    m_FriendsUIFriendStore: {
      m_eUserPersonaState: 1,
      self: friend("Cal", 45, "online"),
      SetUserPersonaState(state) {
        this.m_eUserPersonaState = state;
      },
    },
  };

  window.appStore = {
    GetAppOverviewByAppID: (id) => games.find((g) => g.appid === id),
    // Album covers: a game's portrait art stands in for the first soundtrack's; the second has none.
    GetAlbumCoverURLForApp: (a) => (a.appid === 9000001 ? "https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/library_600x900.jpg" : ""),
  };
  window.App = { m_CurrentUser: { strPersonaName: "Cal" } };
  window.SteamClient = {
    Apps: {
      RunGame: (id) => toast("RunGame(" + id + ")"),
      GetMyAchievementsForApp: async (appid) => {
        await new Promise((r) => setTimeout(r, 250));
        if (appid >= 0x80000000) return { result: 1, data: { rgAchievements: [] } }; // (Steam has none for non-Steam games)
        const names = [
          "First Steps",
          "Getting Warmer",
          "Collector",
          "Untouchable",
          "Speed Demon",
          "Night Owl",
          "Completionist",
          "Explorer",
          "Big Spender",
          "Perfectionist",
          "Lucky Break",
          "Veteran",
          "Social Butterfly",
          "Marathon",
          "Master of All",
          "Secret Ending",
          "Hoarder",
          "No Hit Run",
        ];
        const rgAchievements = names.map((n, i) => {
          const hue = (i * 47) % 360;
          const img =
            "data:image/svg+xml," +
            encodeURIComponent(
              `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='hsl(${hue},55%,35%)'/><circle cx='32' cy='30' r='16' fill='hsl(${hue},70%,65%)'/><text x='32' y='37' font-size='20' text-anchor='middle' fill='white' font-family='sans-serif'>${i + 1}</text></svg>`,
            );
          // (how many are earned differs by game: all of some, none of others)
          const achieved = i < [18, 0, 9, 13, 4, 18][appid % 6] && (appid % 6 === 0 || i % 3 !== 2);
          return {
            strID: "ACH_" + i,
            strName: n,
            strDescription: `Do the thing number ${i + 1} in this game.`,
            bAchieved: achieved,
            rtUnlocked: achieved ? now - (20 - i) * day * 3 : 0,
            strImage: img,
            bHidden: i === 15,
            flMaxProgress: i === 9 ? 50 : 0,
            flCurrentProgress: i === 9 ? 31 : 0,
            flAchieved: [72, 55, 40, 4.2, 18, 33, 2.1, 61, 25, 7.5, 49, 12, 38, 8.8, 1.4, 6, 29, 0.9][i],
          };
        });
        return { result: 1, data: { rgAchievements } };
      },
      RegisterForAppDetails: (appid, cb) => {
        const t = setTimeout(() => cb({ achievements: appid === 570 ? { nTotal: 0 } : { nAchieved: appid % 37, nTotal: 40 + (appid % 23) } }), 300);
        return { unregister: () => clearTimeout(t) };
      },
    },
    // Screenshots: ten of Hades (a grid of rows), one of Steam itself (files served from steamloopback.host, so not shown here).
    Screenshots: {
      GetAllLocalScreenshots: async () =>
        [...Array.from({ length: 10 }, (_, i) => [1145360, i + 1, 3 + i * 3]), [7, 11, 1]].map(([app, h, daysAgo]) => ({
          nAppID: app,
          hHandle: h,
          nWidth: 1280,
          nHeight: 800,
          nCreated: now - daysAgo * day,
          strCaption: h === 2 ? "Final boss" : "",
          strUrl: `screenshots/${app}/screenshots/2026090${h}120000_1.jpg`,
        })),
    },
    Settings: {
      GetAvailableLanguages: async () => ["english", "french", "german", "japanese", "spanish", "schinese"].map((s, i) => ({ language: i, strShortName: s })),
      GetCurrentLanguage: async () => lang,
      SetCurrentLanguage: (l) => ((lang = l), toast("Language → " + l)),
      SetHostname: (h) => toast("Hostname → " + h),
      SetSetting: () => {},
    },
    InstallFolder: {
      GetInstallFolders: async () => [
        { strDriveName: "nvme0n1p8", strFolderPath: "/home/deck/.local/share/Steam", bIsMounted: true, bIsFixed: true, nCapacity: 476e9, nFreeSpace: 121e9 },
        { strDriveName: "mmcblk0p1", strFolderPath: "/run/media/mmcblk0p1", bIsMounted: true, bIsFixed: false, nCapacity: 512e9, nFreeSpace: 88e9 },
      ],
    },
    System: {
      Network: Object.fromEntries(
        ["RegisterForDeviceChanges", "RegisterForConnectivityTestChanges"].map((k) => [
          k,
          (cb) => (window.__netListeners.add(cb), { unregister: () => window.__netListeners.delete(cb) }),
        ]),
      ),
      GetSystemInfo: async () => ({ sHostname: "steamdeck", sOSName: "SteamOS", sOSVersionId: "3.7.13" }),
      SuspendPC: () => toast("Suspend"),
      RestartPC: () => toast("Restart"),
      ShutdownPC: () => toast("Shut down"),
      SwitchToDesktop: () => toast("Desktop mode"),
      Audio: (() => {
        const devs = [
          { id: 340, sName: "Corsair HS65 SURROUND", bHasOutput: true, bHasInput: true, flOutputVolume: 0.7, flInputVolume: 0.4 },
          { id: 341, sName: "HDMI / DisplayPort", bHasOutput: true, bHasInput: false, flOutputVolume: 1, flInputVolume: 0 },
        ];
        const pick = { 0: -1, 1: -1 };
        return {
          GetDevices: async () => ({
            activeOutputDeviceId: pick[1] < 0 ? 340 : pick[1],
            activeInputDeviceId: pick[0] < 0 ? 340 : pick[0],
            overrideOutputDeviceId: pick[1],
            overrideInputDeviceId: pick[0],
            vecDevices: devs,
          }),
          SetDeviceVolume: (id, dir, v) => {
            const d = devs.find((d) => d.id === id);
            d[dir ? "flOutputVolume" : "flInputVolume"] = v;
            toast(`Volume ${dir ? "out" : "in"} ${d.sName} ${v}`);
          },
          SetDefaultDeviceOverride: (id, dir) => {
            pick[dir] = id;
            toast(`Device ${dir} → ${id}`);
          },
          ClearDefaultDeviceOverride: (dir) => {
            pick[dir] = -1;
            toast(`Device ${dir} → default`);
          },
          // (the preview can call window.mockVolume(id, channel, volume) as the volume buttons would)
          RegisterForDeviceVolumeChanged: (cb) => {
            window.mockVolume = (id, ch, v) => {
              const d = devs.find((d) => d.id === id);
              d[ch ? "flOutputVolume" : "flInputVolume"] = v;
              cb(id, ch, v);
            };
            return { unregister: () => delete window.mockVolume };
          },
        };
      })(),
    },
    URL: { ExecuteSteamURL: (u) => toast(u) },
  };
  let lang = "english";
  window.LocalizationManager = {
    LocalizeString: (t) =>
      ({
        "#Language_english": "English",
        "#Language_french": "French",
        "#Language_german": "German",
        "#Language_japanese": "Japanese",
        "#Language_spanish": "Spanish - Spain",
        "#Language_schinese": "Chinese - Simplified",
      })[t] ?? t,
  };
  // Steam's network store: a wired connection and Wi-Fi networks (one saved), as its Internet page uses it.
  {
    const ip = (a, b, c, d) => ((a << 24) | (b << 16) | (c << 8) | d) >> 0;
    const listeners = new Set();
    const changed = () => setTimeout(() => listeners.forEach((cb) => cb()), 50);
    const wired = {
      id: 1,
      etype: 1,
      estate: 5,
      mac: "00:11:22:33:44:55",
      ip4: {
        addresses: [{ ip: ip(192, 168, 0, 20), netmask: -256 }],
        dns_ip: [ip(8, 8, 8, 8), ip(192, 168, 0, 1)],
        gateway_ip: ip(192, 168, 0, 1),
        is_dhcp_enabled: true,
        is_default_route: true,
      },
      ip6: { addresses: [{ ip: "fe80::e209:91e5:75c4:26cf" }] },
      wired: { is_cable_present: true, speed_mbit: 1000, friendly_name: "Wired connection 1" },
    };
    const aps = [
      { id: 11, ssid: "HomeNetwork 5G", strength_raw: 82, esecurity: 16, is_saved: true, is_autoconnect: true, password: "x", is_active: false },
      { id: 12, ssid: "Coffee Shop Free WiFi", strength_raw: 44, esecurity: 0, is_saved: false, is_active: false },
      { id: 13, ssid: "vodafone063143", strength_raw: 27, esecurity: 64, is_saved: false, is_active: false },
    ];
    const wifi = { id: 2, etype: 2, estate: 2, mac: "B8:D0:8F:01:AC:57", ip4: { addresses: [], dns_ip: [] }, ip6: { addresses: [] }, wireless: { aps } };
    const ap = (dev, w) => ({
      get key() {
        return dev.id + ":" + (w?.id ?? "");
      },
      get type() {
        return dev.etype;
      },
      get wirelessAPInfo() {
        return w ?? null;
      },
      get displayName() {
        return w ? w.ssid : dev.wired.friendly_name;
      },
      get state() {
        return w && !w.is_active ? 2 : dev.estate;
      },
      get isConnected() {
        return this.state === 5;
      },
      isLoopback: false,
      get isDefaultRoute() {
        return this.isConnected && !!dev.ip4.is_default_route;
      },
      get isSaved() {
        return !!w?.is_saved;
      },
      get isAutoconnectEnabled() {
        return !!w?.is_autoconnect;
      },
      get isConnectable() {
        return this.state === 2 || this.state === 1;
      },
      get isDisconnectable() {
        return this.state === 5;
      },
      get isForgettable() {
        return !!w?.is_saved;
      },
      get macAddress() {
        return dev.mac;
      },
      get m_DeviceInfo() {
        return dev;
      },
      deviceId: dev.id,
      deviceWapId: w?.id,
      bandFilter: undefined,
      Disconnect: async () => {
        toast("Disconnect " + (w?.ssid ?? "wired"));
        if (w) w.is_active = false;
        else dev.estate = 2;
        changed();
        return true;
      },
      Forget: async () => {
        toast("Forget " + w.ssid);
        w.is_saved = false;
        w.is_active = false;
        changed();
        return true;
      },
      SetAutoconnectEnabled: async (on) => {
        toast("Autoconnect " + w.ssid + " " + on);
        w.is_autoconnect = on;
        changed();
        return true;
      },
    });
    const points = [ap(wired), ...aps.map((w) => ap(wifi, w))];
    let wifiOn = true;
    const test = { eConnectivityTestResult: 1, eFakeState: 0, bChecking: false };
    window.SystemNetworkStore = {
      networkManagementAvailable: true,
      hasWirelessDevice: true,
      get isWifiEnabled() {
        return wifiOn;
      },
      get accessPoints() {
        return points;
      },
      get userVisibleAccessPoints() {
        return wifiOn ? points : points.slice(0, 1);
      },
      get connectivityTestState() {
        return test;
      },
      get hasInternetConnection() {
        return true;
      },
      get hasSteamConnection() {
        return true;
      },
      proxyInfo: { proxy_mode: 1, address: "", port: 0 },
      m_WirelessDevice: wifi,
      m_mapNetworkAccessPoints: new Map(points.map((p) => [p.key, p])),
      SetWifiEnabled: (on) => {
        toast("Wi-Fi " + on);
        wifiOn = on;
        changed();
      },
      StartScanningForNetworks: () => toast("Scanning for networks"),
      StopScanningForNetworks: () => toast("Stopped scanning"),
      RecheckConnectivity: () => {
        test.bChecking = true;
        setTimeout(() => ((test.bChecking = false), changed()), 2000);
      },
      Connect: async (p) => {
        toast("Connect " + JSON.stringify(p));
        const w = aps.find((a) => a.id === p.deviceWapId);
        aps.forEach((a) => (a.is_active = false));
        if (w) w.is_active = true;
        wifi.estate = 4;
        changed();
        setTimeout(() => ((wifi.estate = 5), changed()), 1500);
        return true;
      },
    };
    window.__netListeners = listeners;
    window.__netDialog = (props) => toast("Steam's network dialog: " + (props.accessPoint?.displayName ?? "Other Network"));
  }
  // Steam display settings: its display store (brightness, night mode) and display manager (the display and its resolutions).
  {
    const msg = {
      is_display_brightness_available: true,
      is_adaptive_brightness_available: true,
      display_adaptive_brightness_enabled: true,
      display_nightmode_enabled: false,
      display_nightmode_tintstrength: 0.5,
      display_nightmode_schedule_enabled: false,
      display_nightmode_schedule_starttime: 21,
      display_nightmode_schedule_endtime: 6,
    };
    const set = (k) => (v) => {
      msg[k] = v;
      toast(`${k} = ${v}`);
    };
    let bright = 0.86;
    window.SystemStoragStore = {
      msgSettings: msg,
      DisplayBrightness: {
        get Value() {
          return bright;
        },
      },
      SetDisplayBrightness: (v) => {
        bright = v;
        toast(`brightness = ${v}`);
      },
      SetDisplayAdaptiveBrightnessEnabled: set("display_adaptive_brightness_enabled"),
      SetNightModeEnabled: set("display_nightmode_enabled"),
      SetNightModeScheduleEnabled: set("display_nightmode_schedule_enabled"),
      SetNightModeScheduleStartTime: set("display_nightmode_schedule_starttime"),
      SetNightModeScheduleEndTime: set("display_nightmode_schedule_endtime"),
      SetNightModeTintStrength: set("display_nightmode_tintstrength"),
    };
    window.SystemDisplayManagerStore = {
      GetState: async () => ({
        displays: [{ is_primary: true, is_enabled: true, is_internal: false, is_hdr_capable: true }],
        game_resolution_override_native: { width: 3840, height: 2160 },
        game_resolution_override_default: { width: 1920, height: 1080 },
      }),
    };
  }

  // Steam's Bluetooth service, found in its webpack bundle by what it holds (as the plugin looks for it): two paired devices.
  {
    const devices = [
      {
        id: 1,
        name: "DualSense Edge Wireless Controller",
        is_paired: true,
        is_connected: true,
        battery_percent: 80,
        wake_allowed_supported: true,
        wake_allowed: true,
        is_trusted: true,
      },
      { id: 2, name: "WH-1000XM4", is_paired: true, is_connected: false, wake_allowed_supported: false, is_trusted: false },
      { id: 3, name: "", mac: "AA:BB:CC:DD:EE:FF", is_paired: false, is_connected: false, strength_raw: -80 },
    ];
    // (searching finds these, a moment after it starts: one with only an address, which isn't listed)
    const nearby = [
      { id: 4, name: "Xbox Wireless Controller", is_paired: false, is_connected: false, strength_raw: -45 },
      { id: 5, name: "", mac: "11:22:33:44:55:66", is_paired: false, is_connected: false, strength_raw: -30 },
      { id: 6, name: "JBL Flip 5", is_paired: false, is_connected: false, strength_raw: -70 },
    ];
    let searches = 0;
    const reply = (body) => Promise.resolve({ BSuccess: () => true, Body: () => ({ toObject: () => body }) });
    let changed = () => {};
    const update = (id, patch, what) => {
      Object.assign(
        devices.find((d) => d.id === id),
        patch,
      );
      toast(what);
      setTimeout(() => changed(), 200);
      return reply({});
    };
    const service = {
      GetState: () =>
        reply({
          is_service_available: true,
          is_enabled: true,
          devices: devices.map(({ id, is_paired, is_connected, strength_raw }) => ({ id, is_paired, is_connected, strength_raw })),
        }),
      GetDeviceDetails: ({ id }) => reply({ device: devices.find((d) => d.id === id) }),
      Connect: ({ device }) => update(device, { is_connected: true }, "Bluetooth connect " + device),
      Disconnect: ({ device }) => update(device, { is_connected: false }, "Bluetooth disconnect " + device),
      Forget: ({ device }) => update(device, { is_paired: false, is_connected: false }, "Bluetooth forget " + device),
      SetWakeAllowed: ({ device, allowed }) => update(device, { wake_allowed: allowed }, "Bluetooth wake " + allowed),
      SetTrusted: ({ device, trusted }) => update(device, { is_trusted: trusted }, "Bluetooth trusted " + trusted),
      Pair: ({ device }) => {
        toast("Bluetooth pair " + device);
        return new Promise((done) =>
          setTimeout(() => {
            Object.assign(
              devices.find((d) => d.id === device),
              { is_paired: true, is_connected: true, is_trusted: true },
            );
            changed();
            done({ BSuccess: () => true, Body: () => ({ toObject: () => ({}) }) });
          }, 1200),
        );
      },
      SetDiscovering: ({ enabled }) => (toast("Bluetooth searching " + enabled), reply({})),
      RegisterForNotifyStateChanged: (cb) => ((changed = cb), { unregister: () => (changed = () => {}) }),
    };
    // Steam's Bluetooth store: searching shared through it, each asker getting a stop.
    const store = {
      RequestDiscovery: () => {
        if (!searches++) {
          toast("Bluetooth searching");
          setTimeout(() => {
            for (const d of nearby) if (searches && !devices.some((x) => x.id === d.id)) devices.push({ ...d });
            changed();
          }, 800);
        }
        return () => !--searches && toast("Bluetooth search stopped");
      },
    };
    const modules = { bt: () => "BluetoothManager.GetState#1", btstore: () => "RequestDiscovery", netdlg: () => "band_filter" };
    // (Steam's network Connect dialog, as it's shown: a function of its props and window.)
    const netDialog = new Function("return function M(e={},t){window.__netDialog(e,window,t)}")();
    const req = (id) => (id === "bt" ? { RF: service } : id === "btstore" ? { Y4: store } : id === "netdlg" ? { V: netDialog } : undefined);
    req.m = modules;
    window.webpackChunksteamui = { push: ([, , run]) => run(req) };
  }

  window.settingsStore = {
    m_ClientSettings: {
      developer_mode_enabled: false,
      enable_ui_sounds: true,
      gamescope_hdr_enabled: true,
      steamos_magnifier_scale: 150,
      gamescope_game_resolution_global: "Native",
      system_bluetooth_enabled: true,
    },
  };
  // Steam's updater (UpdateStore): a check finds a SteamOS update; installing it counts up, then wants a restart.
  const unix = () => Math.floor(Date.now() / 1000);
  const updater = {
    m_updateState: { state: 2, update_check_results: [{ type: 1, eresult: 1, rtime_checked: unix() - 3600, available: false }] },
    GetProgressPercent() {
      const p = this.m_updateState.progress?.stage_progress;
      return p ? Math.floor(100 * p) : null;
    },
    GetLastCheckTime() {
      return this.m_updateState.update_check_results?.[0]?.rtime_checked ?? null;
    },
    GetRecheckAndInstallUpdateTypes: () => [1, 2],
    async CheckForUpdates() {
      this.m_updateState = { state: 3 };
      await new Promise((r) => setTimeout(r, 1500));
      this.m_updateState = {
        state: 4,
        update_check_results: [
          { type: 1, eresult: 1, rtime_checked: unix(), available: false },
          { type: 2, eresult: 1, rtime_checked: unix(), available: true, version: "3.7.13 " },
        ],
      };
    },
    async ApplyUpdate() {
      for (let p = 0; p <= 1; p += 0.1) {
        this.m_updateState = { state: 5, progress: { stage_progress: p } };
        await new Promise((r) => setTimeout(r, 400));
      }
      this.m_updateState = { state: 7 };
    },
  };
  window.UpdateStore = { m_updater: updater };
})();
