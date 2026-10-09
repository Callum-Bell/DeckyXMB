// PS3-style trophy list for a game's Steam achievements.
// Steam has no trophy grades, so rarity decides the tier, and a platinum
// trophy is awarded for earning everything.
import { Focusable, GamepadButton, Navigation } from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadTrophies, openSteamAchievements, showTrophiesInXMB, sortTrophies, Trophy, TROPHY_SORTS, trophyPageFromCollection, trophyGame } from "../library";
import { musicFocus, musicLeave } from "../music";
import { formatDateTime } from "../datetime";
import { updateSettings, useSettings } from "../settings";
import { playSound } from "../sound";
import { BASE_CSS, consume, FallbackImg, FONT, hideFooter, Hint, Marquee, Stage, useGamepadHandlers, useNow, useStageScale } from "./common";
import { ThemedWave } from "./Wave";

export type Tier = "platinum" | "gold" | "silver" | "bronze";
const TIER_COLORS: Record<Tier, [string, string]> = {
  platinum: ["#eef6fb", "#8fb3c9"],
  gold: ["#ffe58a", "#b8860b"],
  silver: ["#f2f3f5", "#8d939b"],
  bronze: ["#f0b27a", "#8a4b1e"],
};

export const tierOf = (t: Trophy): Tier => (t.rarity < 10 ? "gold" : t.rarity < 35 ? "silver" : "bronze");

const LIST_TOP = 250;
const ROW_H = 70;
const VISIBLE = 7;
const LIST_X = 70;
const LIST_W = 1140;

interface Row {
  key: string;
  tier: Tier;
  name: string;
  description: string;
  image?: string;
  achieved: boolean;
  unlocked: number;
  hidden: boolean;
  rarity?: number;
  progress?: { current: number; max: number };
}

export function Cup({ tier, size, dim }: { tier: Tier; size: number; dim?: boolean }) {
  const [hi, lo] = TIER_COLORS[tier];
  const id = `cup-${tier}`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      style={{ display: "block", opacity: dim ? 0.35 : 1, filter: dim ? "grayscale(1)" : "drop-shadow(0 0 4px rgba(255,255,255,.45))" }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="1" stopColor={lo} />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        stroke="rgba(0,0,0,.35)"
        strokeWidth="1.5"
        d="M18 8h28v14c0 9-5 15-11 16v8h8v6H21v-6h8v-8c-6-1-11-7-11-16zM18 12H8c0 9 4 14 11 15l-1-4c-4-1-6-4-6-7h6zM46 12h10c0 9-4 14-11 15l1-4c4-1 6-4 6-7h-6z"
      />
      <rect x="17" y="52" width="30" height="5" rx="1" fill={`url(#${id})`} stroke="rgba(0,0,0,.35)" strokeWidth="1.5" />
    </svg>
  );
}

const TIERS: Tier[] = ["platinum", "gold", "silver", "bronze"];
const TIER_NAME: Record<Tier, string> = { platinum: "Platinum", gold: "Gold", silver: "Silver", bronze: "Bronze" };
const HIDDEN_NAME = "Hidden Trophy";
const HIDDEN_DESCRIPTION = "Details of this trophy are hidden until you earn it.";

const isSecret = (row: Row) => row.hidden && !row.achieved;

/** Earned date, progress counter, or "Not earned". `long` adds "Earned" / "Progress" labels. */
function status(row: Row, long = false): string {
  if (row.achieved) return (long ? "Earned " : "") + formatDateTime(row.unlocked);
  if (row.progress) return `${long ? "Progress " : ""}${Math.floor(row.progress.current)} / ${row.progress.max}`;
  return "Not earned";
}

/** The trophy's picture: a platinum cup, "?" while hidden, or its badge (greyed until earned). */
function TrophyIcon({ row, size, cup }: { row: Row; size: number; cup: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 5,
        overflow: "hidden",
        background: "rgba(0,0,0,.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {row.tier === "platinum" ? (
        <Cup tier="platinum" size={cup} dim={!row.achieved} />
      ) : isSecret(row) || !row.image ? (
        <span className="xmb-text" style={{ fontSize: size / 2, opacity: 0.7 }}>
          ?
        </span>
      ) : (
        <img
          src={row.image}
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "cover", filter: row.achieved ? "none" : "grayscale(1) brightness(.55)" }}
        />
      )}
    </div>
  );
}

export function TrophyPage({ appid }: { appid: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const box = useStageScale(rootRef);
  // Steam's button-hint bar hidden, as on the home: the page shows its own hints where it would be.
  useEffect(() => hideFooter(rootRef.current), []);
  const now = useNow(60000, rootRef);
  const game = useMemo(() => trophyGame(appid), [appid]);

  const [trophies, setTrophies] = useState<Trophy[] | null | "error">(null);
  // (the order chosen under Sort By in the XMB too: □ moves on to the next, for both)
  const [s] = useSettings();
  const sort = s.trophySort;
  const [sel, setSel] = useState(0);
  const [detail, setDetail] = useState(false);
  const [switches] = useState(trophyPageFromCollection); // (opened from Achievement Collection: △ lists them in the XMB)

  // Keep this game's music playing (picks up seamlessly from the XMB).
  useEffect(() => {
    musicFocus(appid, true);
    return () => musicLeave();
  }, [appid]);

  useEffect(() => {
    let live = true;
    loadTrophies(appid)
      .then((t) => live && setTrophies(t))
      .catch(() => live && setTrophies("error"));
    return () => {
      live = false;
    };
  }, [appid]);

  const list = Array.isArray(trophies) ? trophies : [];
  const earned = list.filter((t) => t.achieved);
  const allDone = list.length > 0 && earned.length === list.length;
  const pct = list.length ? Math.floor((earned.length / list.length) * 100) : 0;

  const rows: Row[] = useMemo(() => {
    const label = (t: Trophy) => (t.hidden && !t.achieved ? HIDDEN_NAME : t.name);
    const out: Row[] = sortTrophies(list, sort, label).map((t) => ({ ...t, key: t.id, tier: tierOf(t) }));
    if (list.length) {
      out.unshift({
        key: "__platinum",
        tier: "platinum",
        name: "Platinum Trophy",
        description: `Earn every other trophy${game ? ` in ${game.name}` : ""}.`,
        achieved: allDone,
        unlocked: allDone ? Math.max(...list.map((t) => t.unlocked)) : 0,
        hidden: false,
      });
    }
    return out;
  }, [trophies, sort]);

  // Earned / total per tier, worked out once per load (not on every button press).
  const counts = useMemo(() => {
    const c = Object.fromEntries(TIERS.map((t) => [t, { got: 0, total: 0 }])) as Record<Tier, { got: number; total: number }>;
    for (const t of list) {
      const k = c[tierOf(t)];
      k.total++;
      if (t.achieved) k.got++;
    }
    c.platinum = { got: allDone ? 1 : 0, total: list.length ? 1 : 0 };
    return c;
  }, [trophies]);
  const move = (to: number) => {
    const n = Math.max(0, Math.min(rows.length - 1, to));
    if (n !== sel) {
      setSel(n);
      playSound("move");
    }
  };

  const h = useGamepadHandlers({
    dir: (e) => {
      consume(e);
      if (detail) return;
      const b = e.detail?.button;
      if (b === GamepadButton.DIR_DOWN) move(sel + 1);
      else if (b === GamepadButton.DIR_UP) move(sel - 1);
    },
    down: (e) => {
      const b = e.detail?.button;
      if (b === GamepadButton.BUMPER_LEFT || b === GamepadButton.BUMPER_RIGHT) {
        consume(e);
        move(sel + (b === GamepadButton.BUMPER_RIGHT ? VISIBLE : -VISIBLE));
      }
    },
    back: (e) => {
      consume(e);
      playSound("back");
      if (detail) setDetail(false);
      else Navigation.NavigateBack();
    },
    sort: (e) => {
      consume(e);
      const at = TROPHY_SORTS.findIndex(([id]) => id === sort);
      updateSettings({ trophySort: TROPHY_SORTS[(at + 1) % TROPHY_SORTS.length][0] });
      setSel(0);
      playSound("category");
    },
    // △: its trophies listed in the XMB instead (as the PS3's Trophy Collection).
    xmb: (e) => {
      if (!switches) return;
      consume(e);
      playSound("back");
      showTrophiesInXMB(appid);
    },
    steam: (e) => {
      consume(e);
      openSteamAchievements(appid);
    },
    // ✕ opens the trophy's details, as on the PS3.
    ok: (e) => {
      consume(e);
      if (!rows[sel]) return;
      setDetail(!detail);
      playSound(detail ? "back" : "open");
    },
  });

  // A routed page doesn't get focus handed to it the way the home does: if
  // nothing inside us has focus after mounting, take it.
  useEffect(() => {
    const t = setTimeout(() => {
      const panel = rootRef.current?.parentElement;
      if (panel && !panel.contains(panel.ownerDocument.activeElement)) panel.focus?.();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  const top = Math.max(0, Math.min(rows.length - VISIBLE, sel - 3));
  const from = Math.max(0, top - 2);
  const to = Math.min(rows.length - 1, top + VISIBLE + 1);

  return (
    <Focusable
      // @ts-ignore autoFocus exists at runtime
      autoFocus
      // Steam only treats a panel as focusable if it says so / has an ✕ action.
      focusable
      noFocusRing
      onGamepadDirection={h.dir}
      onButtonDown={h.down}
      onOKButton={h.ok}
      onOKActionDescription={detail ? "Close" : "Details"}
      onCancelButton={h.back}
      onCancelActionDescription="Back"
      onSecondaryButton={h.sort}
      onSecondaryActionDescription="Sort"
      onOptionsButton={switches ? h.xmb : undefined}
      onOptionsActionDescription={switches ? "Show in XMB" : undefined}
      onMenuButton={h.steam} // (Start: not listed in Steam's footer, which has enough in it)
      style={{ position: "fixed", inset: 0, zIndex: 900, background: "#000", overflow: "hidden" }}
    >
      <div ref={rootRef} style={{ position: "absolute", inset: 0, overflow: "hidden", fontFamily: FONT, color: "#fff" }}>
        <style>{CSS}</style>
        <ThemedWave now={now} dim={0.8} blur />
        <Stage box={box}>
          {/* Header: game, progress, trophy counts */}
          <div className="xmb-enter" style={{ position: "absolute", left: LIST_X, top: 60, display: "flex", gap: 26, alignItems: "center" }}>
            {game && (
              <FallbackImg srcs={game.icon} style={{ width: 230, height: 107, objectFit: "cover", borderRadius: 3, boxShadow: "0 2px 12px rgba(0,0,0,.5)" }} />
            )}
            <div>
              <div
                className="xmb-text"
                style={{ fontSize: 28, marginBottom: 10, maxWidth: 820, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {game?.name ?? "Trophies"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
                <div className="xmb-text" style={{ fontSize: 16, opacity: 0.85 }}>
                  Progress
                </div>
                <div
                  style={{
                    width: 320,
                    height: 10,
                    borderRadius: 5,
                    background: "rgba(0,0,0,.35)",
                    border: "1px solid rgba(255,255,255,.35)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "linear-gradient(180deg, #fff, #9fd0ff)",
                      boxShadow: "0 0 8px rgba(160,210,255,.8)",
                    }}
                  />
                </div>
                <div className="xmb-text" style={{ fontSize: 18 }}>
                  {pct}%
                </div>
              </div>
              <div style={{ display: "flex", gap: 26 }}>
                {TIERS.map((tier) => {
                  const c = counts[tier];
                  return (
                    <div key={tier} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Cup tier={tier} size={26} />
                      <span className="xmb-text" style={{ fontSize: 17 }}>
                        {c.got}
                        <span style={{ opacity: 0.6 }}> / {c.total}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: LIST_X,
              width: LIST_W,
              top: LIST_TOP - 14,
              height: 1,
              background: "linear-gradient(90deg, rgba(255,255,255,.6), rgba(255,255,255,0))",
            }}
          />

          {/* The list */}
          <div style={{ position: "absolute", left: LIST_X, top: LIST_TOP, width: LIST_W, height: ROW_H * VISIBLE, overflow: "hidden" }}>
            {trophies === null && <Message text="Loading trophies…" />}
            {trophies === "error" && <Message text="Couldn't load achievements for this game." />}
            {Array.isArray(trophies) && !trophies.length && <Message text="This game has no achievements." />}
            <div className="trophy-scroll" style={{ transform: `translateY(${-top * ROW_H}px)` }}>
              {rows.slice(from, to + 1).map((r, k) => (
                <TrophyRow key={r.key} row={r} y={(from + k) * ROW_H} on={from + k === sel} />
              ))}
            </div>
          </div>

          {/* Scroll position */}
          {rows.length > VISIBLE && (
            <div
              style={{
                position: "absolute",
                left: LIST_X + LIST_W + 14,
                top: LIST_TOP,
                width: 3,
                height: ROW_H * VISIBLE,
                background: "rgba(255,255,255,.15)",
                borderRadius: 2,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  width: 3,
                  borderRadius: 2,
                  background: "rgba(255,255,255,.8)",
                  top: `${(top / rows.length) * 100}%`,
                  height: `${(VISIBLE / rows.length) * 100}%`,
                  transition: "top 160ms ease-out",
                }}
              />
            </div>
          )}

          {detail && rows[sel] && <TrophyDetail row={rows[sel]} />}

          {/* Button hints */}
          <div className="xmb-text" style={{ position: "absolute", right: 70, bottom: 22, display: "flex", gap: 28, fontSize: 16, opacity: 0.9 }}>
            <Hint b="face-lf">Sort: {TROPHY_SORTS.find(([id]) => id === sort)?.[1]}</Hint>
            {switches && <Hint b="face-up">Show in XMB</Hint>}
            <Hint b="face-dn">{detail ? "Close" : "Details"}</Hint>
            <Hint b="face-rt">Back</Hint>
          </div>
        </Stage>
      </div>
    </Focusable>
  );
}

function TrophyDetail({ row }: { row: Row }) {
  const secret = isSecret(row);
  return (
    <div
      className="xmb-enter"
      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          width: 760,
          padding: "36px 44px",
          display: "flex",
          gap: 32,
          background: "linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.04))",
          border: "1px solid rgba(255,255,255,.35)",
          borderRadius: 6,
          boxShadow: "0 10px 40px rgba(0,0,0,.6)",
        }}
      >
        <div style={{ boxShadow: "0 0 18px rgba(255,255,255,.3)", borderRadius: 5, alignSelf: "flex-start" }}>
          <TrophyIcon row={row} size={128} cup={104} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <Cup tier={row.tier} size={30} dim={!row.achieved} />
            <span className="xmb-text" style={{ fontSize: 16, opacity: 0.85 }}>
              {TIER_NAME[row.tier]}
            </span>
          </div>
          <div className="xmb-text" style={{ fontSize: 26, marginBottom: 10 }}>
            {secret ? HIDDEN_NAME : row.name}
          </div>
          <div className="xmb-text" style={{ fontSize: 17, opacity: 0.85, lineHeight: 1.4, marginBottom: 18 }}>
            {secret ? HIDDEN_DESCRIPTION : row.description}
          </div>
          <div className="xmb-text" style={{ fontSize: 15, opacity: 0.85, lineHeight: 1.7 }}>
            <div>{status(row, true)}</div>
            {row.rarity !== undefined && <div>{row.rarity.toFixed(1)}% of players have this trophy</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="xmb-text" style={{ padding: "24px 8px", fontSize: 20, opacity: 0.85 }}>
      {text}
    </div>
  );
}

function TrophyRow({ row, y, on }: { row: Row; y: number; on: boolean }) {
  const secret = isSecret(row);
  let detail = secret ? HIDDEN_DESCRIPTION : row.description;
  if (on && row.rarity !== undefined) detail += `${detail ? "  ·  " : ""}${row.rarity.toFixed(1)}% of players have this`;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: y,
        width: "100%",
        height: ROW_H,
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "0 18px",
        boxSizing: "border-box",
        background: on ? "linear-gradient(90deg, rgba(255,255,255,.26), rgba(255,255,255,.08) 70%, rgba(255,255,255,0))" : "transparent",
        borderTop: on ? "1px solid rgba(255,255,255,.4)" : "1px solid transparent",
        borderBottom: on ? "1px solid rgba(255,255,255,.4)" : "1px solid rgba(255,255,255,.07)",
      }}
    >
      <div style={{ boxShadow: on ? "0 0 14px rgba(255,255,255,.4)" : "0 1px 4px rgba(0,0,0,.4)", borderRadius: 5 }}>
        <TrophyIcon row={row} size={56} cup={46} />
      </div>
      <div style={{ flex: 1, minWidth: 0, opacity: row.achieved || on ? 1 : 0.7 }}>
        <Marquee text={secret ? HIDDEN_NAME : row.name} on={on} className={on ? "xmb-text xmb-pulse" : "xmb-text"} style={{ fontSize: on ? 21 : 19 }} />
        <div className="xmb-text" style={{ fontSize: 14, opacity: 0.75, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {detail}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "none" }}>
        {row.progress && !row.achieved && (
          <div style={{ width: 90, height: 6, borderRadius: 3, background: "rgba(0,0,0,.35)", overflow: "hidden", border: "1px solid rgba(255,255,255,.25)" }}>
            <div style={{ width: `${Math.min(100, (row.progress.current / row.progress.max) * 100)}%`, height: "100%", background: "rgba(255,255,255,.8)" }} />
          </div>
        )}
        <div className="xmb-text" style={{ fontSize: 14, opacity: row.achieved ? 0.9 : 0.6, minWidth: 150, textAlign: "right" }}>
          {status(row)}
        </div>
        <Cup tier={row.tier} size={30} dim={!row.achieved} />
      </div>
    </div>
  );
}

const CSS = `${BASE_CSS}
.trophy-scroll { position: absolute; inset: 0; transition: transform 160ms cubic-bezier(.2,.7,.3,1); }
`;
