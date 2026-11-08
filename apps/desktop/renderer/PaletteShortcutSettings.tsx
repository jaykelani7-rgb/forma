import { DEFAULT_PALETTE_SHORTCUT } from "../main/preferences";
import { GlobalShortcutSettings, type ShortcutSettingsValue } from "./GlobalShortcutSettings";

export function PaletteShortcutSettings(props: ShortcutSettingsValue) {
  return <GlobalShortcutSettings {...props}
    inputId="palette-shortcut" sectionLabel="Command palette shortcut settings"
    label="Command palette shortcut" example={DEFAULT_PALETTE_SHORTCUT} feature="Global palette shortcut"
    description="Open commands and local search from your editor. Inside Forma, press ⌘K on Mac or Ctrl+K on other platforms."
  />;
}
