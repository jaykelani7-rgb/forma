# Kivi website research for Forma

Inspected 11 November 2026. Research only. No Forma application or website implementation changed.

## Scope and evidence

Reviewed every distinct public HTML page linked from the homepage: Home, About, FAQ, Privacy, Terms, and Windows waitlist. Followed the homepage sections, inspected the rendered page and accessibility structure, and read its publicly served stylesheet and interaction script. Checked desktop at 1440 × 1000, tablet width at 900 × 1000, and narrow layouts at 390 × 844 and the initial 319-pixel viewport. Supporting pages were also viewed at 1280 × 720.

Manually exercised representative dictation dialogs (Slack, Cursor, Mail), the memory replay, all three persona states, the multi-command Slack editing dialog, modal dismissal, keyboard focus wrapping, and arrow-key persona switching. Inventoried all ten dictation examples and six editing examples. This is a design and interaction audit, not a claim to have tested every animation frame, every example's playback, or every browser/device combination.

The Windows form loaded successfully. No email was submitted. The linked installer returned HTTP 200 and the expected disk-image content type in a headers-only check. It was not downloaded or installed. External social profiles and the parent company's full website are outside this audit.

Reduced-motion, touch-pointer behavior, no-JavaScript fallbacks, hover timings, and several decorative effects were verified in the public CSS/JavaScript. They were not all independently exercised through device emulation. Width-only testing retains desktop pointer behavior.

Primary references:

- [Homepage](https://heykivi.ai/)
- [Public visual stylesheet](https://heykivi.ai/assets/css/kivi-v19.css?h=130f6cf484fa)
- [Public interaction script](https://heykivi.ai/assets/js/kivi-v19.js?h=ed3d9d80af65)
- [About](https://heykivi.ai/about.html), [FAQ](https://heykivi.ai/faq.html), [Windows waitlist](https://heykivi.ai/windows.html)
- [Privacy](https://heykivi.ai/privacy.html), [Terms](https://heykivi.ai/terms.html)

## What makes the experience distinctive

My assessment: the strongest quality is continuity. The miniature app windows, spoken input, edits, mascot, and final output belong to the same interaction. A clicked card becomes its expanded demonstration and returns to its original position. This gives a visitor a coherent explanation of what happened.

The art direction makes a technical utility feel personal. Large, soft serif lettering and muted botanical scenery establish warmth. Familiar application windows explain the utility. A restrained bright accent identifies the main action. Small behavioral details sustain the companion's personality between those larger moments.

For Forma, this suggests a single expressive Ribbon that carries the visitor through a practice story. Its movement should explain saving, pausing, resuming, and remembering.

## Site structure

| Surface | Structure observed | Implication for Forma |
| --- | --- | --- |
| Homepage opening | Brief two-line promise, one prominent Mac download action, secondary Windows route | Establish one clear benefit and an immediate way to try or download Forma |
| First demonstration section | Ten miniature host-app examples arranged around a central message on desktop | Show a few believable practice situations before presenting a feature catalogue |
| Memory section | A correction is made, acknowledged, and reused in a later message | Demonstrate that a saved thought changes the experience when returning |
| Persona section | Three selectable contexts, each with input, preference, and output | Let visitors switch between a few meaningful practice situations |
| Editing gallery | Six examples on a regular grid with expandable demonstrations | Provide optional deeper exploration without lengthening the primary story |
| Closing | Mascot entrance, concise invitation, download action, release and platform information | End with a resolved practice moment and clear installation expectations |
| Footer | Product anchors, external destinations, contact, attribution, legal routes | Keep essentials accessible after the visual narrative |

No separate pricing, blog, changelog, or documentation page was linked in the inspected primary navigation and footer. This does not establish that no other public URLs exist.

## Visual system, measured from the rendered page and stylesheet

| Element | Kivi specification |
| --- | --- |
| Main background | Green-black `#0b0e0a` |
| Dark supporting surfaces | `#121710`, `#1a2016` |
| Light text | Warm ivory `#f4f1e6` |
| Muted text | `#b9b6a8`, `#7d7b6f` |
| Paper surfaces | `#f6f4ec`, `#fbfaf5`, `#efece0` |
| Paper ink | `#1b1d18`, `#4c4f46` |
| Accent | Base lime `#a8e063`, with a wider-gamut P3 override where supported |
| Secondary color | Deep green `#256b2f`; blue for native text selection and messaging |
| Display type | Variable Fraunces; major headings use weight 460 |
| Body type | Variable Switzer |
| Technical detail | Geist Mono; host-app content also uses platform system fonts |
| Main grid | 12 columns, maximum 1160px, 32px column gaps |
| Hero heading at 1440px | About 109px, line-height 0.94, negative tracking |
| Feature headings | 56px on the inspected desktop layout, line-height 1.04 |
| Closing heading | Up to 78px, line-height 0.98 |
| Main body explanation | 18px, line-height 1.55, constrained reading width |
| Hero download control | Minimum 66px tall, 18px corner radius, 20px label |
| Header | Fixed, 72px desktop height; 64px at narrow widths |
| Surface borders | Low-opacity, one-pixel lines; layered shadows create separation |

Source: [visual stylesheet](https://heykivi.ai/assets/css/kivi-v19.css?h=130f6cf484fa). Measurements are reference observations, not a proposed Forma token set.

The opening and closing share a dark scene. The middle chapters occupy one continuous warm paper surface, with generous space and fine ornamental dividers. Dark gutters remain visible. This creates a change in reading pace without introducing a different visual identity for each feature.

The paper entry uses a dithered mask. The background combines raster-like dotted scenery, subtle grain, faint green and gold light, and a vignette. The artwork stays subdued around the text. It becomes more vivid near the pointer through an irregular, grid-aligned mask.

The navigation becomes dark translucent glass after scrolling. A thin progress line and small caret relate to page position. The logo has animated dots. These details repeat the vocabulary of writing and listening at a small scale.

## Homepage interaction inventory

### Opening and ambient behavior

The opening headline is staged through a short animation associated with a listening waveform and caret. The download control has an Apple symbol and small listening bars. Source-defined behaviors include a slight magnetic offset, a brief rotational wobble on hover, animated bars, and a small pressed scale/vertical shift.

Ambient green and gold light drift on long 24- and 36-second cycles. The source contains pointer footprints, a localized artwork reveal, and a hidden bird discovery effect that triggers a brief pulse and logo response. These are decorative, optional layers. The closing mascot has a walk/hop sequence and a gentle breathing loop.

For Forma, a fold, seam, crease, bookmark, and resting Ribbon can supply this vocabulary. A small number of consistently used gestures will be easier to recognize than many unrelated effects.

### Dictation cards

The ten examples cover a team update, grocery list, mathematical notation, informal messaging, code identifiers, a corrected email draft, a context-aware reply, time formatting, terminal syntax, and structured notes.

Each card includes host-app identity, a compact result, and an input strip. Examples preserve recognizable host conventions: chat bubbles, a message avatar, a code gutter, check circles, an email layout, or terminal typography. Cards vary in tone and rotation while retaining shared framing.

At wide sizes, a sticky scene spans 280 viewport-height units. The composition uses a scaled 1328 × 768 design field. Cards enter and recede at different points as the visitor scrolls. On hover, source-defined motion enlarges a card slightly and counteracts its rotation.

Clicking opens a larger demonstration from the card's position. The surroundings dim and blur. A host-app area sits above a dark companion panel. The sequence visibly transforms rough input into output, using selection, deletion, substitution, formatting, and short status acknowledgments. Replay is available, and closing returns to the source card.

The shared modal mechanism also handles the editing gallery. Source timings are approximately 620ms to expand and 420ms to return. The dialog height is measured against the content, constrained by the viewport, and designed to accommodate intermediate states.

### Memory

The scene establishes an error, shows its correction, acknowledges remembering, then demonstrates later reuse. The later result is the evidence for the feature. A small receipt and confirmation mark make an invisible state change legible. The demonstration can be replayed through its dedicated control and a highlighted part of the example.

Forma's equivalent should show a particular thought being saved, then retrieved alongside the same problem. A generic claim about intelligence would be less convincing than that visible continuity.

### Personas

Three tabs change the input, instruction, host surface, and result. The selection has a moving underline. The layout reserves space to reduce movement during switching. The source defines short fades and scale changes, followed by word-by-word output.

Verified that clicking selects a different persona and the Right Arrow key advances to the next tab. All three states appeared during inspection.

### Editing gallery

Six examples cover rewriting tone, successive edits to a statistical update, drafting a reply, answering a question, cleaning a column of names, and restructuring a note. The desktop grid is aligned, unlike the scattered composition above it. Changed portions receive restrained highlights.

The multi-command example preserves earlier instructions while emphasizing the latest one. The output changes in place. This is a useful reference for showing Forma's progression from a hypothesis to a failing case to a revised approach.

## Responsive and accessibility details

| Condition | Observed or source-verified behavior |
| --- | --- |
| At least 1100px | Scattered, sticky desktop composition |
| 768–1099px | Three-column card layout in normal document flow |
| Below 768px | Two-column staggered dictation cards; dialogs adapted to narrow viewports |
| 720px and below | Header links hidden; feature chapters stack; editing gallery becomes one column; persona subtitles disappear |
| Below 480px | Header progress decoration hidden |
| Coarse pointer and width at most 1024px | Download buttons replaced with guidance to use a Mac; verified in CSS, not a physical phone session |
| Reduced motion | Static completed scenes, suppressed ambient and pointer movement, different play/replay affordances; source-reviewed |
| JavaScript unavailable | CSS provides readable completed results and a normal-flow card arrangement; source-reviewed |

Keyboard tests confirmed Escape dismissal, focus returning to the source card, focus wrapping inside the modal, and persona arrow navigation. The source also makes background regions inert during a modal, compensates for scrollbar removal, and supplies scene status text. Skip links and descriptive button names are present. This is not a complete screen-reader or accessibility compliance audit.

The mobile dictation cards remain two columns even at 319px. At that width, text wraps heavily and app names truncate. Expanded examples are substantially easier to read. The 390px editing gallery, which uses one column, provides a calmer reading experience.

Several direct section-anchor visits positioned the upper part of the destination behind the fixed header. Forma should explicitly account for header height in anchor scrolling and keyboard focus placement.

## Supporting pages

[About](https://heykivi.ai/about.html), [FAQ](https://heykivi.ai/faq.html), [Privacy](https://heykivi.ai/privacy.html), and [Terms](https://heykivi.ai/terms.html) use a simpler light reading layout. Their display type switches to system sans-serif, with a centered text column, large headings, generous vertical spacing, and basic footer links. The FAQ is a static set of readable answers rather than an accordion. The legal pages provide dates, clear headings, and cross-links; the privacy page has a prominent link to the parent company's policy.

The [Windows waitlist](https://heykivi.ai/windows.html) retains the dark illustrated visual language. It presents a centered serif heading, short explanation, email field, submit action, and compact legal footer. The form is provided through a LaunchList iframe. It initially appeared empty, then loaded. A Forma equivalent should have a clear loading and failure state if it depends on an external embed.

## Technical implementation observations

The homepage serves HTML, self-hosted variable font files, a public CSS file, and an interaction script using GSAP with ScrollTrigger, SplitText, and Flip. These libraries were directly visible in the page's script references. The scenes are implemented as DOM demonstrations; they are not embedded product videos in the inspected page.

The interaction script uses visibility observers and handles tab hiding, page exit, resizing, and reduced-motion preference changes. Some ambient work stops when it is no longer needed. There is also a continuously scheduled frame guard, so this audit does not claim zero idle CPU usage. No performance score or frame-rate benchmark was run.

Page metadata includes social preview tags, a theme color, and a descriptive title. Analytics script references for PostHog and Google Analytics were present. This establishes their presence, not the contents or consent behavior of every event.

## Proposed translation into Forma

These are design recommendations, not approved implementation requirements.

The central promise should be continuity of thought. An original black-and-ivory world with the Ribbon as the recurring object can express Forma's identity. The existing product's practice data and actual capabilities should determine each demonstration.

| Story beat | Proposed Forma demonstration | What the visitor should understand |
| --- | --- | --- |
| Arrive | A quiet Ribbon unfolds beside one small problem | Forma accompanies practice without occupying the whole screen |
| Think | A short hypothesis is attached to that problem | Reasoning has a place to live |
| Pause | The visitor leaves a next step; the Ribbon folds around it | Pausing preserves useful context |
| Return | The same thought reappears with the problem | Resuming can be effortless |
| Test | A small failing input exposes a flaw in the approach | Assistance can help examine reasoning |
| Learn | A reflection becomes a Journal bookmark and connects to another problem | Today's work can inform later practice |
| Download | The Ribbon settles beside an honest Mac release state | The next action and platform requirements are clear |

Use one central interactive rehearsal, supported by a small number of optional examples. The website can expose the sequence through clicks, taps, and keyboard controls. The same story must remain understandable with animation disabled.

Choose original typography and artwork after a Forma visual exploration. Kivi's measured fonts, colors, and scenery are references for understanding the relationship between elements. Forma's own identity can come from folded material, edge light, precise typography, and a Ribbon that carries the same thought across the page.

## Opportunities to make Forma stronger

1. Give visitors a small decision that changes the demonstration, such as choosing the next hypothesis. A short playable experience can make the benefit personally memorable.
2. Keep the same problem and saved thought throughout the main narrative. This makes the value cumulative.
3. Present fewer examples with more breathing room, especially on phones. Use a single column when two columns compromise legibility.
4. Retain the same visual system on About, Download, FAQ, and Privacy pages.
5. Make every important action discoverable on touch and keyboard. Hover can add personality after the interaction is already understandable.
6. Keep platform support, release status, installation requirements, and relevant data-handling explanations near the download decision.
7. Give animation an explicit budget. Stop offscreen work and provide meaningful static scenes. Verify real performance before describing it as fast.
8. Keep demo claims tied to shipped Forma behavior, with sample data clearly identified and isolated from personal records.

Before building, the next concrete deliverable should be a Forma page storyboard and one complete hero-to-rehearsal prototype. That will let us judge the visual quality and the accompanying presence of the Ribbon before extending the design across the full website.
