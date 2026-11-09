# Bezels field report: Suit Roll device sweep

**Date:** 2026-11-09
**Bezels version:** 0.1.2
**Task:** test one game (Suit Roll, a Next.js app) on phones, foldables, tablets, laptops and desktops, from lobby to result and history, and fix what broke.
**Covered:** 13 devices (2 run twice). 9 real defects found and fixed.
**Tools used:** `list_devices`, `open`, `eval`, `screenshot` (framed and plain), `audit_layout`, `navigate`, `close`, `list_sessions`.

## What worked well

- **Realistic viewports.** Browser bars, notches and fold sizes changed the usable height in ways a plain resize doesn't.
  - The iPhone SE's 667 px screen gave 548 px of page under Safari's bars.
  - The desktop "1080p at 150%" preset gave 1280×585 once the browser's top bar was taken off.
  - That 585 px case is the one that showed a pinned button being cut off.
- **WebKit for iOS devices.** It ran the real engine for the iPhones and iPads, not Chromium pretending to be Safari.
- **The device catalogue.** It's clear and well chosen: foldables with both folded and unfolded sizes, tablets, laptops at common display scaling, ultrawide and 4K.
- **Framed screenshots.** Reviewing a layout inside the actual device frame made problems obvious at a glance: the board too small next to the panel, hard edges on the backdrop.
- **`eval` was the workhorse.** Every device was driven through the full game flow, with in-page geometry checks at each screen.
- **`list_sessions`.** It explained the crashes: other sessions had been silently evicted.

## Pain points

1. **Only one live session at a time, and it fails confusingly.** Opening 5 devices left 4 "evicted". Running `eval` in parallel crashed with `Target page, context or browser has been closed` or `Cannot read properties of undefined (reading 'evaluate')`. Neither message mentions eviction. I ended up running close → open → run per device, which was most of the time spent.
2. **`navigate("all")` broke the sessions it touched.** Later `eval` calls failed with the same unclear error.
3. **No way to reach app state.** `screenshot_matrix` and `audit_all` take only a URL. This app moves between screens without changing the URL, so every check past the home page needed a hand-written click-through script, run on each device separately.
4. **Script helpers don't persist between calls.** The same ~3 KB of helper code (click by label, wait, geometry checks) had to be pasted into every `eval`.
5. **Waiting means sleep loops.** There's no "wait for text or selector" step, so flows relied on fixed sleeps. Those broke when the dev server was slow to compile or hot-reloaded the page back to its start.
6. **Screenshots are slow.** Often a minute or more each. That pushed me to capture fewer states than I wanted.
7. **The layout audit missed every real bug.** The 9 defects were all:
   - text overlapping text;
   - a title shortened with "...";
   - a button cut off inside a box that hides its overflow;
   - an empty band beside content;
   - a view collapsing to almost nothing.

   `audit_layout` caught none of them. I wrote custom checks for overlaps, things cut off at the panel edge, and the view's size.
8. **The audit's false positives drowned the signal.**
   - **Wide decoration:** backgrounds clipped on purpose by their container were flagged as "wider than the viewport" (as warnings) and "image not scaled" (as an error).
   - **Tap targets:** 38 px buttons with an invisible enlarged hit area were flagged as too small, because the audit measures the visible box rather than what a tap actually hits.
   - **Text size:** it uses a fixed 12 px minimum; this project's rule is 11 px.
   - **Viewport height:** an element already using `100dvh` was flagged with advice to use `100dvh`.
   - **Shell elements:** the site navbar and bottom bar made noise on every page.
9. **Screenshots land in the project root** (`shots/`), as untracked files the user then has to clean up.
10. **Unexplained permission prompt.** The user saw a remote-control permission prompt around the time the Bezels tool server started. I couldn't confirm the source, but it's worth checking which operating-system permissions Bezels asks for, and saying why.

## Suggested features, by impact

1. **Record a flow once, replay it on every device.** Steps like `tap "PLAY DEMO"`, `wait "PLACE BET"`, plus named checkpoints. At each checkpoint, take a screenshot and run the audit, then output one contact sheet per checkpoint across devices. This would have replaced nearly everything I did by hand.
2. **Parallel sessions, or at least clear queuing.** If the live limit is 1, `open` with many devices should run them as a queue, and stale sessions should return "session evicted, reopen".
3. **Checkpoints from inside `eval`.** For example `await bezels.checkpoint("result")`, which screenshots and audits mid-script.
4. **Helper scripts per session.** Code that runs on every page load, or named snippets stored once and called by name.
5. **Collision and clipping checks** in `audit_layout`:
   - text boxes overlapping other text;
   - text cut off with an ellipsis;
   - elements clipped by an ancestor that hides overflow (like the hidden START button);
   - large containers collapsed below a minimum size.
6. **Tap-target checks that test what a tap hits** (`elementFromPoint` around the button) instead of the visible box.
7. **Configurable audit rules per project:**
   - minimum text size and tap size;
   - selectors to ignore (site shell, decoration);
   - treat content clipped by an `overflow:hidden` parent as intended.
8. **Faster screenshots.** Offer a quick unframed mode for bulk runs, and keep framed shots for review.
9. **Configurable output folder**, defaulting to a temp or cache directory rather than the project root.
10. **Comparison against a baseline.** Diff against the last run, or against a Figma frame export at the same size. The user's requirement was "1:1 with Figma", and that comparison was done by eye.
11. **Exportable HTML report:** a pass/fail grid of devices by checkpoint, linked to the screenshots, ready to drop into a pull request.
12. **Recovering from hot reload:** detect a hot-module reload or full reload during a flow, and optionally replay from the last checkpoint.

## Bottom line

The device emulation is the strong part: the bars, engines and fold sizes found layout states a desktop browser resize can't produce. The gap is everything around it. Flows were driven by hand, sessions were fragile, and the audit missed overlaps and clipping while flagging decoration. Flow replay with checkpoints (1), reliable sessions (2) and collision checks (5) would make Bezels the whole testing loop, instead of one part of a hand-built one.
