import { DEFAULT_THOUGHT_SHORTCUT } from "../main/preferences";
import { GlobalShortcutSettings, type ShortcutSettingsValue } from "./GlobalShortcutSettings";

export function ThoughtShortcutSettings(props: ShortcutSettingsValue) {
  return <GlobalShortcutSettings {...props}
    inputId="thought-shortcut" sectionLabel="Recording shortcut settings"
    label="Speak a thought shortcut" example={DEFAULT_THOUGHT_SHORTCUT} feature="Recording shortcut"
    description="With a problem attached, tap the shortcut once to record and again to transcribe. Review the draft before saving."
  />;
}
