# Fenn motion verification — 19 October 2026

Recorded the explicit browser character gallery in Chromium at 1600 × 1100, 1× display scale, with reduced motion disabled. Each recording shows all twelve semantic states simultaneously at 80, 96, and 112 logical pixels: 36 rigs per theme, 72 across Light and Ink. Every gallery card remained fully inside the viewport. These are renderer fixture recordings, not evidence of operating-system window behavior or a live CPH/Codeforces integration.

Local generated artifacts are intentionally excluded from Git under `dist/`:

- `dist/companion-verification/fenn-light-all-states.webm` — 6.40 seconds, silent.
- `dist/companion-verification/fenn-ink-all-states.webm` — 6.24 seconds, silent.
- `dist/companion-verification/fenn-light-initial.png`
- `dist/companion-verification/fenn-light-mid.png`
- `dist/companion-verification/fenn-light-settled.png`
- `dist/companion-verification/fenn-ink-initial.png`
- `dist/companion-verification/fenn-ink-mid.png`
- `dist/companion-verification/fenn-ink-settled.png`

Inspected all six full frames: initial rendering, approximately 800 ms later, and approximately 4.5 seconds later after the finite reactions settle. Head and tail anchors remain stable, paws keep their baseline, and no art or accessory clips at any displayed size. Context-ready ear/head motion, the nod, pending blink, acceptance curl/bounce, and saved sparkle remain restrained and settle into still poses. Paused and attention poses remain readable. Static states remain intentionally still; no looping seam is required because pet reactions do not repeat continuously.

Separate renderer checks confirmed the operating-system reduced-motion preference yields computed `animation-name: none`, keyboard-only Tab/Enter opens manual attachment with its URL field focused, and an absent desktop bridge produces a connection error instead of activating a preview. The existing static screenshots in `docs/companion/screenshots/` provide larger Light/Ink gallery views. Native window placement, transparency, fullscreen behavior, and energy use require the separately documented native checks.
