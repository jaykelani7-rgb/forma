# Product showcase boundaries

The website is a separate static build. It explains the existing Mac product and lets visitors use its interface with example data, without starting a desktop bridge or configuring an AI provider.

| Website interaction | Implementation and boundary |
| --- | --- |
| Problem Desk | Imports `apps/desktop/renderer/ProblemDesk.tsx` unchanged. Sample entries support threads, hypotheses, failing inputs, screenshots, removal, history, and pinned code. Storage callbacks only update React state. |
| Explain an idea | Imports `DeskIdeaCard.tsx` unchanged. The explanation and outline are editable, but outlining and challenging use the labeled Watermelon fixture. A challenge always illustrates the original sample assumption, including after text edits. The displayed case is not executed. |
| One small hint | Imports `DeskHintCard.tsx` unchanged, including statement/context review and Markdown rendering. The request reveals a prepared hint and can become an editable desk thread. No provider call occurs. |
| Ribbon | Imports the native `DesktopRibbonMark.tsx`. Timer, collapse, open, Light/Ink, and saved compact shape respond to interaction. The browser timer counts only while the showcase is visible and the document is active. |
| Appearance | Imports the shared `packages/ribbon/RibbonStudio.tsx`. Shape, resting edge, and motion are preview-only choices. Its optional `savedMessage` keeps the website's confirmation accurate while preserving the desktop default. |
| Reflection and recall | Website adapters demonstrate the existing desktop workflows. The visitor chooses an outcome, writes a takeaway, and attempts recall before explicitly revealing earlier notes. They do not calculate a review schedule or create a real session. |
| Guided journey | The homepage expands the same mounted companion. A visitor’s thread becomes the editable explanation; a saved challenge draft becomes the reflection draft. The guide tracks completed actions, supports returning to earlier steps, and keeps earlier thoughts concealed during recall until memory opens. |
| Full workspace image | A capture of the actual desktop `workspace.html` renderer with `createDemo()` records and an in-memory fixture bridge. No personal notebook data appears. The capture is descriptive, not interactive. |
| Interactive workspace | Lazy-loaded website adapter with Today, searchable Practice, Tracks, Contests, and Journal. Example records are labeled; Watermelon uses a read-only snapshot of the same mounted companion. Opening Journal, closing the preview, or reopening a problem does not reset the session. Reset/reload clears visitor records. It does not run the desktop bridge. |
| Tracks | Three staged sample problems with suggested time labeled as guidance. Activation is explicit. The Watermelon independent count uses the companion reflection; the other two problems are labeled example records. There is no full curriculum import or planner service in the website. |
| Contests | A fictional finished practice round preserves its example result. Visitor-written contest takeaways remain separate from later practice. Queue/priority feed Today; explicit upsolve start captures the current reflection revision and starts the sample timer. Only a subsequent saved solved outcome completes the queue entry. Unsolved corrections reopen it; removal does not recreate it. No platform evidence is fetched and no real contest runs. |
| Completion | Shows the visitor’s first thought, selected-code reference, takeaway, and recall, followed by the configured Mac download or release-details route. |
| Notebook panel | A sample learning record reflects the visitor's saved outcome and takeaway. The platform verdict stays separate and is never inferred from the demo. |
| VS Code and Codeforces panels | Example context, with a working action to pin the sample selection to the desk. No editor pairing, folder access, statement capture, verdict lookup, or code execution occurs on the website. |

`components/practice-guide.tsx` owns the five-step navigation and thread summary. `components/companion-sample.ts` owns the fixture and feature descriptions. `components/companion-playground.tsx` owns state and adapters. Both the homepage and `/preview/` render this component. Reset and reload clear all sample state; there is no IndexedDB or localStorage persistence.

The marketing copy follows `docs/companion/README.md` and the existing renderer workflows. Tutor requires the user's supported provider key in the Mac app; tracking and notes work without AI. A public Mac download is offered only when `FORMA_MAC_DOWNLOAD_URL` is configured.

`npm run test:site` validates the exported `/forma/` base path in desktop/mobile Chromium, Firefox, and WebKit, including the full desk, idea, hint, reflection, recall, appearance, and timer flows, the continuous guided journey, keyboard navigation, reduced motion, narrow layouts, 200%-equivalent viewport reflow, and absence of notebook persistence or AI requests.
