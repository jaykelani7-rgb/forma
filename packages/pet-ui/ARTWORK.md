# Fenn source and motion

Fenn is original vector artwork created for Forma Companion on 19 October 2026. No third-party character, raster image, or animation asset is embedded. The editable source is `src/Fenn.tsx`; body, tail, ears, eyes, paws, scarf, shadow, and accessory groups retain semantic layer names. All layers use a shared 180 × 180 coordinate system, with a fixed baseline at y=155. The implementation follows the repository's licence.

`PetRendererProps` is the renderer boundary. It accepts semantic state, logical size, reduced motion, and hidden status; it does not read learning history or mutate records. State reactions run once and settle. Hidden and reduced-motion rendering disables all motion. Fenn does not roam or react negatively to inactivity.

`?preview=1&gallery=1` in the desktop renderer shows every semantic state at 80, 96, and 112 logical pixels. `&theme=ink` changes the gallery theme. This is an explicitly labelled in-memory preview, not a desktop integration or persistence test.
