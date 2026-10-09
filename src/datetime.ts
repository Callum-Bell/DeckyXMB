// Date / time formatting from the user's Date and Time Settings.
import { getSettings } from "./settings";

export type DateFormat = "DMY" | "MDY" | "YMD";
export type TimeFormat = "24h" | "12h";

export const DATE_FORMATS: Record<DateFormat, string> = { DMY: "DD/MM/YYYY", MDY: "MM/DD/YYYY", YMD: "YYYY/MM/DD" };
export const TIME_FORMATS: Record<TimeFormat, string> = { "24h": "24-Hour Clock", "12h": "12-Hour Clock" };

const pad = (n: number) => String(n).padStart(2, "0");

/** The date in the chosen order. Without the year it's day and month only, as on the PS3 clock. */
export function formatDate(d: Date, withYear = true): string {
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yyyy = String(d.getFullYear());
  switch (getSettings().dateFormat) {
    case "MDY":
      return withYear ? `${mm}/${dd}/${yyyy}` : `${mm}/${dd}`;
    case "YMD":
      return withYear ? `${yyyy}/${mm}/${dd}` : `${mm}/${dd}`;
    default:
      return withYear ? `${dd}/${mm}/${yyyy}` : `${dd}/${mm}`;
  }
}

export function formatTime(d: Date): string {
  const m = pad(d.getMinutes());
  if (getSettings().timeFormat === "12h") {
    const h = d.getHours() % 12 || 12;
    return `${h}:${m} ${d.getHours() < 12 ? "AM" : "PM"}`;
  }
  return `${pad(d.getHours())}:${m}`;
}

/** A unix timestamp (seconds) as date and time. */
export const formatDateTime = (unix: number) => {
  const d = new Date(unix * 1000);
  return `${formatDate(d)}  ${formatTime(d)}`;
};
