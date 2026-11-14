# Forma for Mac website

The public homepage, interactive preview and download page build separately from the web notebook. Run these commands from the repository root with Node.js 22 or later.

```sh
npm ci --workspace=@forma/site --ignore-scripts
npm run site:dev
```

The dev site serves [127.0.0.1:3004](http://127.0.0.1:3004). Run `npm run site:build` to create a production export. The existing notebook uses `npm run dev` on port 3001. Its browser records stay on the origin where they were saved. Use that origin's `/settings` to export them.

Copy `.env.example` from this directory to `apps/site/.env.local` to configure local values. The export embeds values at build time.

| Variable | Purpose |
| --- | --- |
| `FORMA_MAC_DOWNLOAD_URL` | HTTPS URL of the published, signed and notarized Apple silicon `.dmg`. With no URL, the site offers the demo and shows the pending release state. |
| `FORMA_NOTEBOOK_ORIGIN` | Origin of the existing web notebook. Adds links to its `/today` and `/settings` routes. Set it to the origin existing users know. Defaults to `http://localhost:3001` in dev. |
| `FORMA_SITE_BASE_PATH` | Optional URL prefix such as `/forma` when the host serves the site below its root. GitHub Pages supplies this value in the workflow. |

With the repository’s full dev dependencies installed, run `npx playwright install chromium firefox webkit`, then `npm run test:site` to exercise the static export in Chromium (desktop and mobile), Firefox, and WebKit.

## Product showcase

The homepage explains Forma as a Mac practice workspace with a floating companion, VS Code context, optional Tutor, reflections, and recall. The night landscape frames a quiet opening with one primary invitation. The former silk sculpture and decorative book are no longer rendered.

The homepage opens with one headline, a short product explanation, and “See Forma in action.” Code, timers, playback controls, and the companion are absent from the initial screen. A saved-thought illustration below introduces the benefit without requiring interaction. Choosing to explore mounts the companion in a separate section. Closing hides it and pauses its activity while retaining the session; reopening restores it. Keyboard focus returns to the opening control. Starting a problem expands the same mounted component into a five-step practice journey: pin code, keep your own thought, question an assumption, reflect, then recall. Appearance, timer, and sample notes survive that transition. The visitor’s thought fills the idea-review field; an edited next step fills the reflection draft. A saved reflection also appears in the sample notebook below. Earlier thinking is concealed inside the recall view until the visitor opens memory.

The optional story pairs an example editor with that companion in a four-part return story: select code, keep an editable thought, fold the Ribbon, and return to the same thought. Visitors can advance manually or play the sequence. Playback stops when editing, when the scene leaves view, when the tab or story is hidden, or when opening the full practice journey. Reduced motion uses manual steps. Replay preserves the thought, and continuing carries the selected code and thought into the existing guide. The website does not connect to VS Code or create a native bookmark file.

Visitors can switch to free exploration at any point. The homepage and `/preview/` share Focus, Problem Desk, Explain an idea, One small hint, Reflect, Recall, and Make it yours. The implementation imports the desktop `ProblemDesk`, `DeskIdeaCard`, `DeskHintCard`, and `DesktopRibbonMark`, plus the shared `RibbonStudio`.

The workspace section opens with a capture of the actual desktop renderer and an on-demand interactive website sample. Visitors can switch between Today, searchable Practice, Tracks, Contests, and Journal. Watermelon shares the companion’s code, first thought, reflection, and completed recall; reopening the problem retains that context. Other records are explicitly labeled examples. A reflection links directly to its Journal entry, and the completed journey summarizes the visitor’s work before offering the configured download or release details. Reset and reload clear visitor records.

Tracks offers three staged sample problems, explicit activation, and independent-outcome progress that updates from the companion. Contests keeps original example results beside later learning, with an editable contest takeaway, priority, and an upsolve queue connected to Today. Only a new solved reflection after explicitly starting the sample upsolve completes it. An unsolved correction reopens the queue, and administrative removal remains removed. These website adapters demonstrate one Watermelon session; they do not run the full scheduling or platform-import services. Track choices, draft takeaways, and queue state survive closing the workspace preview and clear with Reset preview or reload.

Two visible practice entry points open Tracks and Contests directly. Closing the workspace returns keyboard focus to the control that opened it. The download page presents the configured release state and explains the local notebook, optional editor pairing, and optional Tutor setup.

`USABILITY-CHECK.md` provides a first-visit protocol. It is prepared research guidance; real participant sessions have not been conducted.

State stays in React memory and clears on reload or reset. Tutor responses and the illustrated case are explicitly prepared examples: edits do not invoke AI, code is not executed, and the site never connects to an editor or writes a real notebook. The native desktop retains its existing provider, storage, and editor integrations. See `PRODUCT-SHOWCASE.md` for the reuse boundaries.

## Motion and navigation

Motion supports the visitor’s actions: a code chip travels into the desk, the Ribbon responds to saved thoughts and reflections, and the boundary-case illustration changes between weights 2, 8, and 12. The opening landscape stays still. Section reveals and Ribbon transitions respect reduced motion. The sample timer stops counting offscreen, in a hidden tab, or while the story is closed. There is one live practice experience instead of separate autoplay and scroll-based copies of the same story.

On narrow screens, the code comes first during selection; the companion takes priority in the later steps. The guide scrolls horizontally, and advancing through a step moves keyboard focus to its heading. Free exploration retains arrow-key, Home, and End tab navigation. Tests cover narrow layouts, 200%-equivalent viewport reflow, reduced motion, state continuity, and the complete journey.

`practice-guide.tsx` owns the guide, thread summary, and interactive boundary-case illustration. `motion-feedback.tsx` owns the code-transfer visual. Both use HTML, SVG, and CSS without a video download or additional animation dependency.

See `assets/ART-DIRECTION.md` for original artwork, screenshot provenance, production asset paths, and motion behavior.

## Deployment

Deploy the contents of `apps/site/out/` to a static host. Serve directory indexes so `/preview/` and `/download/` work when opened directly. The build uses the repository's npm lockfile and shared Ribbon artwork and fonts.

For GitHub Pages, select **GitHub Actions** under the repository's **Settings → Pages**. Add the two site URL variables under **Settings → Secrets and variables → Actions → Variables** as they become available. Run **Deploy Forma site** from `main` to publish or to refresh a changed release URL. [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
