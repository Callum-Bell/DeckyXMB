import { ThemeKey } from "../settings";

type RGB = [number, number, number];

// The PS3's colours, measured from its own colour squares (RPCS3 recording, 2026-10).
// Declared January → December: the order "Original" cycles through by month.
export const THEME_COLORS: Record<Exclude<ThemeKey, "monthly">, RGB> = {
  silver: [182, 191, 200], // grey
  gold: [204, 184, 27],
  lime: [114, 169, 40],
  pink: [222, 110, 129],
  green: [29, 124, 29],
  magenta: [146, 112, 190], // lavender
  teal: [37, 184, 170],
  blue: [9, 56, 165],
  violet: [140, 53, 155], // purple
  amber: [194, 144, 17],
  brown: [100, 67, 22],
  red: [183, 53, 35],
};

const MONTHS = Object.keys(THEME_COLORS) as Exclude<ThemeKey, "monthly">[];

/**
 * The PS3's Colour setting, in its order: Original (the default, changes by
 * month) as a named option, then the fixed colours, shown only as squares.
 */
export const COLOUR_OPTIONS: Record<ThemeKey, string> = {
  monthly: "Original",
  silver: "", // grey
  gold: "",
  lime: "",
  pink: "",
  green: "",
  magenta: "", // lavender
  teal: "",
  blue: "",
  violet: "", // purple
  amber: "",
  brown: "",
  red: "",
};

/** The colour a setting stands for: Original's is the month's. */
const colourOf = (key: ThemeKey, now: Date) => (key === "monthly" ? MONTHS[now.getMonth()] : key);

export const themeColor = (key: ThemeKey, now = new Date()): RGB => THEME_COLORS[colourOf(key, now)];

/** Brightness: Normal, then the PS3's five steps darker. */
export const BRIGHTNESS_OPTIONS: Record<string, string> = { "0": "Normal", "1": "-1", "2": "-2", "3": "-3", "4": "-4", "5": "-5" };
// How much of the background each step leaves (measured from the PS3: about 17.5% less a step).
const BRIGHTNESS = [1, 0.82, 0.645, 0.47, 0.3, 0.13];
export const brightnessOf = (level: string | undefined) => BRIGHTNESS[Math.max(0, Math.min(5, Number(level) || 0))];

/** The colour square for a colour option (Original has no square: it's shown by name). */
export const swatchColor = (key: ThemeKey): RGB => THEME_COLORS[key === "monthly" ? "silver" : key];

/** The friend card's colour: a brighter, slightly whitened version of the theme colour. */
export const glowColor = ([r, g, b]: RGB): RGB => [r, g, b].map((v) => Math.min(255, v * 1.5) * 0.7 + 255 * 0.3) as RGB;

export const rgb = ([r, g, b]: RGB, k = 1, a = 1) =>
  `rgba(${Math.round(Math.min(255, r * k))},${Math.round(Math.min(255, g * k))},${Math.round(Math.min(255, b * k))},${a})`;

// The colour of the side panels' light for each colour, measured from the PS3 (RPCS3, 2026-10: the panel's peak over the
// background beside it, at the panel's opacity). Not derived from the squares: gold and amber share one, for one.
const SHEET_COLORS: Record<Exclude<ThemeKey, "monthly">, RGB> = {
  silver: [204, 204, 204],
  gold: [238, 218, 119],
  lime: [197, 225, 112],
  pink: [235, 154, 180],
  green: [78, 194, 117],
  magenta: [171, 138, 202],
  teal: [106, 217, 231],
  blue: [106, 159, 248],
  violet: [205, 127, 250],
  amber: [238, 218, 119],
  brown: [160, 142, 102],
  red: [223, 95, 92],
};

/** The colour of the side panels' light (the month's, for Original). */
export const sheetColor = (key: ThemeKey, now = new Date()): RGB => SHEET_COLORS[colourOf(key, now)];
