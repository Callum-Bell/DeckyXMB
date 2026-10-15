import { definePlugin, routerHook } from "@decky/api";
import { ButtonItem, DropdownItem, PanelSection, PanelSectionRow, staticClasses, ToggleField, useParams } from "@decky/ui";
import { ReactNode } from "react";
import { lastTrophyAppid, TROPHY_ROUTE } from "./library";
import { musicStop } from "./music";
import { SafeBoundary } from "./safety";
import { initSettings, updateSettings, useSettings } from "./settings";
import { startControllerGlyphs } from "./glyphs";
import { patchSteamSounds } from "./sound";
import { openWeb } from "./system";
import { initThemes } from "./themes";
import { Icon } from "./xmb/icons";
import { Glyph } from "./xmb/common";
import { TrophyPage } from "./xmb/TrophyPage";
import { XMBHome } from "./xmb/XMBHome";

const HOME_ROUTE = "/library/home";
const PATREON = "https://www.patreon.com/c/InsaneCallum";

/** Renders the XMB in place of Steam's home, or Steam's home when turned off / on error. */
function HomeSwitch({ original }: { original: ReactNode }) {
  const [s, loaded] = useSettings();
  if (!loaded || !s.enabled) return <>{original}</>;
  return (
    <SafeBoundary fallback={original}>
      <div style={{ position: "relative", width: "100%", height: "100vh" }}>
        <XMBHome />
      </div>
    </SafeBoundary>
  );
}

function QuickAccessPanel() {
  const [s] = useSettings();
  return (
    <>
      <PanelSection title="Home">
        <PanelSectionRow>
          <ToggleField label="Use XMB as Home" checked={s.enabled} onChange={(v: boolean) => updateSettings({ enabled: v })} />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            label={
              <>
                <Glyph b="face-dn" size={20} /> on a game
              </>
            }
            rgOptions={[
              { data: "launch", label: "Play straight away" },
              { data: "menu", label: "Show options (Play, Trophies…)" },
              { data: "page", label: "Open game page" },
            ]}
            selectedOption={s.gameConfirm}
            onChange={(o: any) => updateSettings({ gameConfirm: o.data })}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Installed games only"
            description="In the Game column (folders always show everything)."
            checked={s.installedOnly}
            onChange={(v: boolean) => updateSettings({ installedOnly: v })}
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Look">
        <PanelSectionRow>
          <ToggleField label="Animated wave" checked={s.wave} onChange={(v: boolean) => updateSettings({ wave: v })} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField label="Game backgrounds" checked={s.backgrounds} onChange={(v: boolean) => updateSettings({ backgrounds: v })} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField label="Clock" checked={s.clock} onChange={(v: boolean) => updateSettings({ clock: v })} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Sounds"
            description="The PS3's sound effects (or a theme's), in place of Steam's. Off: Steam's own."
            checked={s.sounds}
            onChange={(v: boolean) => updateSettings({ sounds: v })}
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Music">
        <PanelSectionRow>
          <ToggleField
            label="Game music on hover"
            description="Plays the game's ThemeDeck track while it's selected (needs ThemeDeck)."
            checked={s.music}
            onChange={(v: boolean) => updateSettings({ music: v })}
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="About">
        <PanelSectionRow>
          <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>Made by InsaneCallum</div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" description="Opens in Steam's browser." onClick={() => openWeb(PATREON)}>
            Support on Patreon
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

function TrophyRoute() {
  let appid = 0;
  try {
    appid = Number((useParams as any)?.()?.appid) || 0;
  } catch {
    /* fall back below */
  }
  appid ||= lastTrophyAppid();
  return (
    <SafeBoundary fallback={<div style={{ padding: 48 }}>DeckyXMB: the trophy list failed to load.</div>}>
      <TrophyPage appid={appid} />
    </SafeBoundary>
  );
}

export default definePlugin(() => {
  initSettings();
  initThemes();
  const stopGlyphs = startControllerGlyphs();
  const unpatchSounds = patchSteamSounds();
  routerHook.addRoute(TROPHY_ROUTE, TrophyRoute, { exact: true });
  const homePatch = routerHook.addPatch(HOME_ROUTE, (props: any) => {
    const original = props.children;
    if (original?.type !== HomeSwitch) props.children = <HomeSwitch original={original} />;
    return props;
  });
  return {
    name: "DeckyXMB",
    titleView: <div className={staticClasses.Title}>DeckyXMB</div>,
    content: (
      <SafeBoundary fallback={<div style={{ padding: 16 }}>DeckyXMB: settings failed to load.</div>}>
        <QuickAccessPanel />
      </SafeBoundary>
    ),
    icon: <Icon name="game" size={20} plain />,
    onDismount() {
      musicStop();
      stopGlyphs();
      unpatchSounds();
      routerHook.removeRoute(TROPHY_ROUTE);
      routerHook.removePatch(HOME_ROUTE, homePatch);
    },
  };
});
