// Plays Steam's own UI sounds through its audio store, so they follow Steam's
// UI-sound setting. Approach from Spindeck (BSD-3-Clause).
import { getSettings } from "./settings";

const BASE = "https://steamloopback.host/sounds/";
const SOUNDS = {
  move: "deck_ui_navigation.wav",
  category: "deck_ui_tab_transition_01.wav",
  open: "deck_ui_into_game_detail.wav",
  launch: "deck_ui_launch_game.wav",
  back: "deck_ui_hide_modal.wav",
} as const;

export function playSound(kind: keyof typeof SOUNDS) {
  if (!getSettings().sounds) return;
  const url = BASE + SOUNDS[kind];
  try {
    const store = (globalThis as any).SteamUIStore?.m_GamepadUIAudioStore;
    if (store?.PlayAudioURL) {
      Promise.resolve(store.PlayAudioURL(url)).catch(() => {});
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const a = new Audio(url);
    a.volume = 0.6;
    a.play().catch(() => {});
  } catch {
    /* no audio */
  }
}
