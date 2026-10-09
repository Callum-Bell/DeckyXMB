// White XMB-style glyphs on a 64×64 grid. Filled shapes use currentColor.
import { themeIcon } from "../themes";

export type IconName =
  | "users"
  | "settings"
  | "photo"
  | "music"
  | "video"
  | "game"
  | "network"
  | "friends"
  | "folder"
  | "gamesFolder"
  | "star"
  | "display"
  | "audio"
  | "controller"
  | "bluetooth"
  | "wifi"
  | "power"
  | "moon"
  | "restart"
  | "update"
  | "desktop"
  | "store"
  | "download"
  | "browser"
  | "chat"
  | "quick"
  | "info"
  | "system"
  | "play"
  | "trophy"
  | "cup"
  | "clock"
  | "check"
  | "theme"
  | "setting";

/** One edge of the Video icon's film, its left side at x: 13.5 wide, notched top and bottom, with three rounded holes. */
function filmEdge(x: number) {
  const hole = (y: number) => `M${x + 5.3} ${y}h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z`;
  const outline = `M${x + 1.5} 16h2.8v2h5v-2h2.7a1.5 1.5 0 0 1 1.5 1.5v29a1.5 1.5 0 0 1-1.5 1.5h-2.7v-2h-5v2h-2.8a1.5 1.5 0 0 1-1.5-1.5v-29a1.5 1.5 0 0 1 1.5-1.5z`;
  return outline + hole(21.5) + hole(29.5) + hole(37.5);
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 3.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

// Shapes with parts cut out of them, built as plain outlines (no masks: a mask's id is shared by every icon on the page)

type Span = (y: number) => [number, number] | null;

/** The outline of the region whose row at each y (from y0 to y1) is span(y); rows where it's empty are left out. */
function scan(y0: number, y1: number, span: Span): string {
  const left: string[] = [];
  const right: string[] = [];
  const f = (n: number) => +n.toFixed(2);
  for (let y = y0; y <= y1 + 1e-9; y += 0.1) {
    const r = span(y);
    if (!r || r[1] - r[0] < 0.05) continue;
    left.push(`${f(r[0])} ${f(y)}`);
    right.unshift(`${f(r[1])} ${f(y)}`);
  }
  return left.length ? `M${[...left, ...right].join("L")}Z` : "";
}

/** Half the width of an ellipse (or circle) at y; NaN outside it. */
const half = (cy: number, rx: number, ry: number, y: number) => rx * Math.sqrt(1 - ((y - cy) / ry) ** 2);
const clip = (a: [number, number], b: [number, number]): [number, number] | null => {
  const l = Math.max(a[0], b[0]);
  const r = Math.min(a[1], b[1]);
  return r > l ? [l, r] : null;
};

// The friend behind: its head and shoulders, less what's within a gap of the friend in front (head r 9.5 at 24,23;
// shoulders: the top half of an ellipse 17 by 16 at 24,52).
const FRIEND_BEHIND = (() => {
  const G = 2.6;
  const frontRight = (y: number) => {
    let r = -99;
    for (let dy = -G; dy <= G; dy += 0.2) {
      const yy = y + dy;
      const out = Math.sqrt(Math.max(0, G * G - dy * dy)); // (a gap of G all round)
      const h = half(23, 9.5, 9.5, yy);
      if (h > 0) r = Math.max(r, 24 + h + out);
      const b = yy <= 52 ? half(52, 17, 16, yy) : NaN;
      if (b > 0) r = Math.max(r, 24 + b + out);
    }
    return r;
  };
  const head = scan(10, 26, (y) => {
    const h = half(18, 7.5, 7.5, y);
    return h > 0 ? clip([43 - h, 43 + h], [frontRight(y), 99]) : null;
  });
  const body = scan(31, 47, (y) => {
    const h = half(47, 15, 16, y);
    return h > 0 ? clip([44 - h, 44 + h], [frontRight(y), 99]) : null;
  });
  return head + body;
})();

const GLYPHS: Record<Exclude<IconName, "setting">, JSX.Element> = {
  // The category icons: filled, as the PS3's are (the detail cut out of them), each with its middle on y 32
  users: (
    <g fill="currentColor" transform="translate(0 -0.5)">
      <circle cx="32" cy="21" r="10" />
      <path d="M12 54C12 42 21 35 32 35S52 42 52 54Z" />
    </g>
  ),
  // The PS3 Settings column icon is a toolbox: its lid line and latch cut out of it, the handle on top.
  settings: (
    <g transform="translate(0 -1)">
      <path d="M24 25v-7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M11 24h42a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V27a3 3 0 0 1 3-3zM8 35.2v2.6h20v4.4h8v-4.4h20v-2.6H33.5v4.4h-3v-4.4z"
      />
    </g>
  ),
  // A framed picture: the frame, and inside it a sun and hills.
  photo: (
    <g fill="currentColor">
      <path fillRule="evenodd" d="M11 14h42a3 3 0 0 1 3 3v30a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3zM13.5 19.5v25h37v-25z" />
      <path d="M13.5 44.5L25 32l8 8 8-10 9.5 11.5v3z" />
      <circle cx="22" cy="26" r="3.6" />
    </g>
  ),
  // Two beamed quavers. Each stem runs down the right of its note head and stops where the head is widest,
  // so no corner of it shows outside the head.
  music: (
    <g fill="currentColor" transform="translate(0 1.1)">
      <path d="M23.2 15.6L52.8 9.2v8.4L23.2 24z" />
      <rect x="23.2" y="18" width="3.6" height="25.9" />
      <rect x="49.2" y="12" width="3.6" height="26.9" />
      <ellipse cx="19.5" cy="45" rx="7.5" ry="5.6" transform="rotate(-20 19.5 45)" />
      <ellipse cx="45.5" cy="40" rx="7.5" ry="5.6" transform="rotate(-20 45.5 40)" />
    </g>
  ),
  // The PS3's Video icon: two strips of film edge, standing, three sprocket holes down each and a notch in either end,
  // joined by a thin bar at the top and bottom of an open frame.
  video: (
    <g fill="currentColor">
      <path fillRule="evenodd" d={filmEdge(6)} />
      <path fillRule="evenodd" d={filmEdge(44.5)} />
      <path d="M19.5 20.5h25v3.5h-25zM19.5 40h25v3.5h-25z" />
    </g>
  ),
  // The PS3's Game icon: a DualShock 3 from above, solid. A flat top with its shoulders a little raised at the ends,
  // and the two grips flaring out and down from either side of a high arch.
  game: (
    <g fill="currentColor" transform="translate(0 -0.5)">
      <path d="M14 15C22 13 26 16.5 32 16.5S42 13 50 15C56 16 58.5 22 59.5 30S61 46 58 49C55 52 50 51.5 48 47.5S44 39 40 37.2C37 35.8 27 35.8 24 37.2S18 43.5 16 47.5S9 52 6 49C3 46 3.5 38 4.5 30S8 16 14 15Z" />
    </g>
  ),
  // The PS3 Network icon: a wire globe in thick lines (its rim, the equator, two latitudes bowed in towards it,
  // and the middle meridian with an oval one round it).
  network: (
    <g fill="none" stroke="currentColor" strokeWidth="2.8">
      <circle cx="32" cy="32" r="19.5" strokeWidth="4.4" />
      <ellipse cx="32" cy="32" rx="8.6" ry="19.5" />
      <path d="M32 12.5v39M12.5 32h39M15.8 21.1Q32 28.4 48.2 21.1M15.8 42.9Q32 35.6 48.2 42.9" />
    </g>
  ),
  // Two people, the one behind (smaller, up and to the right) with a gap cut where the one in front overlaps it.
  friends: (
    <g fill="currentColor" transform="translate(0 0.7)">
      <path d={FRIEND_BEHIND} />
      <circle cx="24" cy="23" r="9.5" />
      <path d="M7 52C7 42 15 36 24 36S41 42 41 52Z" />
    </g>
  ),
  folder: (
    <g {...S}>
      <path d="M8 18a3 3 0 0 1 3-3h13l5 5h24a3 3 0 0 1 3 3v24a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" />
    </g>
  ),
  // All Games: the folder with a controller in it (as the PS3's game folders).
  gamesFolder: (
    <g>
      <path {...S} d="M8 18a3 3 0 0 1 3-3h13l5 5h24a3 3 0 0 1 3 3v24a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" />
      <path
        fill="currentColor"
        transform="translate(19 25) scale(0.42)"
        d="M14 15C22 13 26 16.5 32 16.5S42 13 50 15C56 16 58.5 22 59.5 30S61 46 58 49C55 52 50 51.5 48 47.5S44 39 40 37.2C37 35.8 27 35.8 24 37.2S18 43.5 16 47.5S9 52 6 49C3 46 3.5 38 4.5 30S8 16 14 15Z"
      />
    </g>
  ),
  star: (
    <g {...S}>
      <path d="M32 9l6.8 14.2 15.2 2-11 10.8 2.7 15.2L32 44l-13.7 7.2L21 36 10 25.2l15.2-2z" />
    </g>
  ),
  display: (
    <g {...S}>
      <rect x="8" y="12" width="48" height="32" rx="3" />
      <path d="M24 54h16M32 44v10" />
    </g>
  ),
  audio: (
    <g {...S}>
      <path d="M10 26h10l12-10v32L20 38H10z" />
      <path d="M40 24c3 2 4 5 4 8s-1 6-4 8M46 18c5 4 7 9 7 14s-2 10-7 14" />
    </g>
  ),
  controller: (
    <g {...S}>
      <rect x="6" y="20" width="52" height="24" rx="12" />
      <path d="M18 28v8M14 32h8" />
      <circle cx="44" cy="29" r="1.6" fill="currentColor" />
      <circle cx="48" cy="35" r="1.6" fill="currentColor" />
    </g>
  ),
  bluetooth: (
    <g {...S}>
      <path d="M22 20l20 22-10 10V12l10 10-20 22" />
    </g>
  ),
  wifi: (
    <g {...S}>
      <path d="M8 26c14-12 34-12 48 0M16 34c9-8 23-8 32 0M24 42c5-4 11-4 16 0" />
      <circle cx="32" cy="50" r="2.4" fill="currentColor" />
    </g>
  ),
  power: (
    <g {...S}>
      <path d="M32 10v20M20 18a18 18 0 1 0 24 0" />
    </g>
  ),
  moon: (
    <g {...S}>
      <path d="M44 42A18 18 0 0 1 26 14a18 18 0 1 0 24 24 18 18 0 0 1-6 4z" />
    </g>
  ),
  restart: (
    <g {...S}>
      <path d="M50 32a18 18 0 1 1-6-13.4M50 10v12H38" />
    </g>
  ),
  // System Update: two arrows chasing each other round, as on the PS3.
  update: (
    <g {...S}>
      <path d="M13 30a19 19 0 0 1 32-12.5M45 8v10H35M51 34a19 19 0 0 1-32 12.5M19 56V46h10" />
    </g>
  ),
  desktop: (
    <g {...S}>
      <rect x="8" y="12" width="48" height="32" rx="3" />
      <path d="M8 36h48M24 54h16M32 44v10" />
    </g>
  ),
  // Steam's logo, as Steam's own UI draws it (its SteamLogo icon, on a 36 grid: made 48 wide here).
  store: (
    <g fill="currentColor" transform="translate(3.2 3.2) scale(1.6)">
      <path d="M17.974 3C10.0808 3 3.61438 9.07573 3 16.7967L11.0534 20.121C11.7357 19.6551 12.56 19.383 13.447 19.383C13.5265 19.383 13.6056 19.3849 13.684 19.3892L17.2658 14.2073C17.2658 14.1826 17.2652 14.1585 17.2652 14.1342C17.2652 11.0149 19.807 8.47686 22.9319 8.47686C26.0568 8.47686 28.5987 11.0149 28.5987 14.1342C28.5987 17.2532 26.0568 19.7915 22.9319 19.7915C22.8887 19.7915 22.8463 19.7903 22.8035 19.7889L17.6954 23.4276C17.6981 23.4944 17.7004 23.5615 17.7004 23.6287C17.7004 25.9704 15.7923 27.8749 13.447 27.8749C11.3885 27.8749 9.66695 26.4079 9.27686 24.4652L3.51756 22.0881C5.30075 28.3844 11.0953 33 17.974 33C26.2726 33 33 26.2842 33 18.0001C32.9999 9.71534 26.2725 3 17.974 3Z" />
      <path d="M12.4163 25.7599L10.5704 24.9989C10.8977 25.6791 11.4633 26.2478 12.2149 26.5608C13.8388 27.2363 15.7116 26.4665 16.3884 24.8446C16.7162 24.0596 16.7186 23.193 16.3933 22.4064C16.0691 21.6196 15.457 21.0054 14.6698 20.6778C13.889 20.3538 13.0526 20.3656 12.317 20.6422L14.2241 21.4296C15.4222 21.928 15.9884 23.3013 15.4894 24.497C14.9906 25.6931 13.6143 26.2586 12.4163 25.7599Z" />
      <path d="M26.7079 14.1338C26.7079 12.0555 25.0142 10.3645 22.9321 10.3645C20.8502 10.3645 19.1559 12.0554 19.1559 14.1338C19.1559 16.2122 20.8501 17.9027 22.9321 17.9027C25.0141 17.9027 26.7079 16.2122 26.7079 14.1338ZM20.1018 14.1273C20.1018 12.5634 21.372 11.296 22.9384 11.296C24.505 11.296 25.7749 12.5634 25.7749 14.1273C25.7749 15.6912 24.5051 16.9586 22.9384 16.9586C21.372 16.9585 20.1018 15.6912 20.1018 14.1273Z" />
    </g>
  ),
  download: (
    <g {...S}>
      <path d="M32 10v30M20 28l12 12 12-12M12 50h40" />
    </g>
  ),
  browser: (
    <g {...S}>
      <rect x="8" y="12" width="48" height="40" rx="3" />
      <path d="M8 22h48" />
      <circle cx="14" cy="17" r="1" fill="currentColor" />
      <circle cx="19" cy="17" r="1" fill="currentColor" />
    </g>
  ),
  chat: (
    <g {...S}>
      <path d="M10 14h44v28H28l-10 9v-9h-8z" />
    </g>
  ),
  quick: (
    <g fill="currentColor">
      <circle cx="16" cy="32" r="5" />
      <circle cx="32" cy="32" r="5" />
      <circle cx="48" cy="32" r="5" />
    </g>
  ),
  info: (
    <g {...S}>
      <circle cx="32" cy="32" r="22" />
      <path d="M32 29v14" />
      <circle cx="32" cy="21" r="1.6" fill="currentColor" />
    </g>
  ),
  // The PS3 Theme Settings icon: a picture with the wave across it.
  theme: (
    <g {...S}>
      <rect x="8" y="14" width="48" height="36" rx="3" />
      <path d="M8 38c10-8 18-8 26-3s14 5 22-3" />
    </g>
  ),
  clock: (
    <g {...S}>
      <circle cx="32" cy="32" r="22" />
      <path d="M32 18v14l9 6" />
    </g>
  ),
  check: (
    <g {...S}>
      <path d="M14 33l12 12 24-26" />
    </g>
  ),
  play: (
    <g {...S}>
      <path d="M20 12l32 20-32 20z" />
    </g>
  ),
  trophy: (
    <g {...S}>
      <path d="M20 10h24v14a12 12 0 0 1-24 0zM20 16H10c0 8 4 12 10 13M44 16h10c0 8-4 12-10 13M32 36v8M22 54h20M26 44h12v10H26z" />
    </g>
  ),
  // Trophy Collection's: a solid cup, its handles open loops, on a stem and a stepped base (as the PS3's).
  cup: (
    <g fill="currentColor">
      <path d="M16 11h32v9c0 10.5-6.5 17.5-13 19h-6c-6.5-1.5-13-8.5-13-19z" />
      <path d="M17 15h-6c-1.6 0-2.4 1.4-2.1 3.4.9 6.4 5.6 10.6 11.1 11.6" fill="none" stroke="currentColor" strokeWidth="4.4" />
      <path d="M47 15h6c1.6 0 2.4 1.4 2.1 3.4-.9 6.4-5.6 10.6-11.1 11.6" fill="none" stroke="currentColor" strokeWidth="4.4" />
      <path d="M29 38h6v6h-6z" />
      <path d="M25.5 44h13l2.5 7h-18z" />
      <rect x="20" y="50.5" width="24" height="4.5" rx="1" />
    </g>
  ),
  system: (
    <g {...S}>
      <circle cx="32" cy="32" r="8" />
      <path d="M32 8v8M32 48v8M8 32h8M48 32h8M15 15l6 6M43 43l6 6M15 49l6-6M43 21l6-6" />
    </g>
  ),
};

/**
 * The PS3 settings mark: a white disc with a wrench cut out of it (the background
 * shows through). Every instance shares one mask definition, so the id can repeat.
 */
const WRENCH_DISC = (
  <>
    <defs>
      <mask id="xmb-wrench-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        <rect width="64" height="64" fill="#fff" />
        {/* Drawn upright (head at the top), then turned 45° so the head points top-right. */}
        <g transform="rotate(45 32 32)">
          <rect x="28.5" y="27" width="7" height="25" rx="3.5" fill="#000" />
          <circle cx="32" cy="20.5" r="10" fill="#000" />
          {/* the jaw: a slot whose sides widen slightly going in, with a gently curved bottom */}
          <path d="M28.6 8 L35.4 8 L36 17 Q32 21.5 28 17 Z" fill="#fff" />
        </g>
      </mask>
    </defs>
    <circle cx="32" cy="32" r="26" fill="currentColor" mask="url(#xmb-wrench-cut)" />
  </>
);

/**
 * `plain` keeps the XMB's own icon even when a PS3 theme is installed (the clock bar).
 * Themed icons follow theme changes through XMBHome, which re-renders on them.
 */
export function Icon({ name, size, badge, plain }: { name: IconName; size: number; badge?: boolean; plain?: boolean }) {
  // An installed PS3 theme's own icon (its settings icons already include the wrench disc).
  const themed = plain ? null : themeIcon(name);
  if (themed) return <img src={themed} width={size} height={size} style={{ display: "block", objectFit: "contain" }} />;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} style={{ display: "block", overflow: "visible" }}>
      {name === "setting" ? WRENCH_DISC : GLYPHS[name as Exclude<IconName, "setting">]}
      {/* Items in the PS3's Settings column carry a small wrench disc on their top-left corner. */}
      {/* Tucked onto the corner (barely past the icon's box) so it never runs into the category label above. */}
      {badge && <g transform="translate(-5 -5) scale(0.4)">{WRENCH_DISC}</g>}
    </svg>
  );
}
