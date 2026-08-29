# Lessons Log

Use this file for confirmed, project-specific lessons. Add entries in reverse chronological order.

## 2026-08-29 - A Dialog rendered by a component nested under `.rust-map` has its clicks hijacked, even through a Portal

**Context:** `frontend/src/features/map/map-view.tsx`'s `.rust-map` div owns pan/zoom via `onPointerDown`/`onPointerUp={stopPanning}`, which call `setPointerCapture`/`hasPointerCapture` on itself. `CustomMarkersPanel` (rendered as a JSX child of `.rust-map`) used to own its own `deleting` state and render `ConfirmDialog` (a Radix `Dialog`, portaled to `document.body`) directly inside itself.

**What went wrong:** Cancel/Delete in the marker-delete confirmation stayed unresponsive to clicks even after two plausible-looking fixes (deferring `DropdownMenuItem`'s `onSelect` with `setTimeout`, and preventing `DropdownMenuContent`'s default `onCloseAutoFocus`) — both real, kept, but not the actual cause here, confirmed when the *edit* dialog (wired through the identical `DropdownMenuItem` pattern) started working while *delete* did not. The real cause: **React bubbles events through the React component tree, not the DOM tree, even across a Portal** (documented React behavior — a portaled child is still a React descendant of its logical parent). `ConfirmDialog`'s content lives under `document.body` in the DOM, but in the component tree it was nested inside `CustomMarkersPanel`, which is nested inside `.rust-map`. A pointerdown on the dialog's Cancel button therefore still bubbled to `.rust-map`'s `handlePointerDown`, which called `event.currentTarget.setPointerCapture(pointerId)` on `.rust-map` itself — redirecting that pointer's subsequent events (including the click) away from the actual button. The sibling dialogs in `map-view.tsx` (`CustomMarkerDialog`, `CustomMarkerInfoDialog`) were unaffected because they're rendered as JSX siblings of `.rust-map`, not descendants of it.

**Required behavior:** Any Dialog/ConfirmDialog whose trigger lives inside `.rust-map`'s React subtree must have its own state owned and rendered *outside* `.rust-map` (a sibling in `map-view.tsx`, passing an `onDelete`/`onEdit` callback prop down to the triggering component) rather than rendered by the nested component itself — matching how `pendingMarkerPosition`/`viewingMarker`/`editingMarker` were already structured. Do not assume a `position: relative`/pointer-capture ancestor is safe to nest a portaled Dialog's *owning component* under, even though the Dialog's rendered DOM output escapes that ancestor.

**Evidence:** User reported Cancel/Delete unresponsive in the marker-delete dialog after the `setTimeout`/`onCloseAutoFocus` fixes were already applied and had (apparently) resolved the same symptom for the edit dialog; moving `deleting` state up to `MapView` (mirroring `editingMarker`) resolved it. This class of bug is invisible to jsdom-based tests regardless of cause, since `userEvent.click()` dispatches directly to the target element by reference rather than doing real hit-testing through `setPointerCapture` redirection.

## 2026-08-29 - Player-placed in-game map markers come from `AppTeamInfo.mapNotes`/`leaderMapNotes`, not `AppMapMarkers`

**Context:** Rendering the Rust+ map in `frontend/src/features/map/map-view.tsx`, backed by `backend/services/rustplus/world-state-service.ts`.

**What went wrong:** User reported a marker they placed on the in-game F1 map wasn't visible in this app. First guess was that it was a `VendingMachine` (`AppMarkerType=3`) marker rendering issue — wrong, and reverted after the user corrected it ("это не вендинг маркер"). The actual cause: markers a player draws on the in-game map (the F1 map's "add marker" tool) are never delivered through `getMapMarkers`/`AppMapMarkers` at all — they arrive as `AppTeamInfo.mapNotes` (the marker owner's own notes) and `AppTeamInfo.leaderMapNotes` (the team leader's notes, visible to the whole team) inside the existing `getTeamInfo` poll response. `WorldStateService.startTeamPolling` only ever read `teamInfo.members`, so these notes were silently dropped server-side — there was nothing for the frontend to render regardless of its marker-type logic.

**Required behavior:** Before assuming a rendering/styling bug for "a marker isn't showing," check whether the marker's data is one of `AppMapMarkers` (world markers: vending machines, cargo ship, CH47, patrol heli, crates, explosions — has `AppMarkerType`) or `AppTeamInfo.mapNotes`/`leaderMapNotes` (player-placed F1-map markers — has only `type`/`x`/`y`, no stable id, and is polled via `getTeamInfo` not `getMapMarkers`). Check `node_modules/@liamcottle/rustplus.js/rustplus.proto`'s message definitions rather than guessing from `AppMarkerType` alone.

**Evidence:** User screenshot of the Outpost area with no marker shown despite one being placed in-game; `AppTeamInfo` in the proto has `repeated AppTeamInfo.Note mapNotes = 3;` and `repeated AppTeamInfo.Note leaderMapNotes = 4;` with `message Note { optional int32 type = 2; required float x = 3; required float y = 4; }`, entirely separate from `message AppMarker` (used by `AppMapMarkers`). Fixed by reading both note arrays inside the existing `getTeamInfo` poll and exposing them as a new `mapNotes` field through `getState()`.

## 2026-08-29 - Negative margin does not cancel an `overflow-y-auto` ancestor's padding for a sticky child

**Context:** `frontend/src/features/devices/controls-panel.tsx`'s toolbar row, made `sticky top-0` inside `frontend/src/features/dashboard/dashboard-page.tsx`'s `<div className="... p-8 overflow-y-auto">` scroll container.

**What went wrong:** The scroll container's `p-8` leaves a permanent gap above a `sticky top-0` child (the container's top padding isn't "eaten" by sticky positioning), so scrolled content shows through above the stuck toolbar. First fix attempt added `-mt-8 pt-8` on the toolbar itself, expecting the negative margin to pull the toolbar's box up through the padding (a pattern that works for ordinary block layout). It did not: inside an `overflow-y-auto` ancestor the negative margin got absorbed/clipped rather than pulling the box up, so the padding gap remained *and* the new `pt-8` added on top of it, doubling the visible gap. User confirmed: "дырка все еще осталась... сабхедер теперь ниже в два раза" (the hole is still there, the subheader is now twice as low).

**Required behavior:** To flush a `position: sticky` child against the top of an `overflow-y-auto` container that has top padding, do not fight it with negative margin on the sticky element. Instead remove the top padding from the scroll container itself (keep horizontal/bottom padding there) and re-add the equivalent spacing as real `padding-top` on the sticky element (covered by its own `bg-*`, since it's now the first unpadded child of the scrollport).

**Evidence:** User screenshot after the `-mt-8 pt-8` attempt showed a larger gap than before with a device row still bleeding through above the sticky toolbar; fixed by moving the top padding off the shared scroll container (`dashboard-page.tsx`) and onto the sticky toolbar's own `pt-8` (`controls-panel.tsx`).

## 2026-08-28 - A negative `z-index` with no local stacking context escapes to the whole page

**Context:** `frontend/src/styles/map.css`, `.map-marker-anchor.monument { z-index: -1; }` — intended to paint monument markers/labels behind team/event/death markers on the map, inside `.map-marker-layer`.

**What went wrong:** `.map-marker-layer` (the shared parent) had `position: absolute` but no `z-index`, so it never established its own stacking context. A child's `z-index: -1` then compares against the nearest ancestor that *does* establish one — which turned out to be the document root, not `.map-marker-layer`. The monument markers ended up painted behind unrelated page chrome (sidebar/card backgrounds), i.e. invisible, even though they were correctly present in the DOM (frontend tests only assert DOM text presence, so they stayed green throughout).

**Required behavior:** Whenever a child needs a negative (or otherwise carefully ordered) `z-index` to stack below its siblings, give the shared parent an explicit `z-index` (e.g. `0`) alongside its `position` so it creates a local stacking context — otherwise the child's `z-index` is resolved against a far more distant ancestor than intended. This class of bug is invisible to jsdom-based tests, which don't do real paint/stacking, so it only shows up by actually looking at the rendered page.

**Evidence:** User reported "надписей на карте не появилось" (labels didn't appear on the map) after monument labels had been implemented and unit-tested; fixed by adding `z-index: 0` to `.map-marker-layer`.

## 2026-08-28 - A mount-only ref effect misses a node that isn't there on the first render

**Context:** `frontend/src/features/map/map-view.tsx`, wiring a `ResizeObserver` and a native `wheel` listener to the `.rust-map` container via `useRef` + `useEffect(() => { const el = ref.current; if (!el) return; ... }, [])`.

**What went wrong:** `useMap` (react-query) always returns `data: undefined` on the component's first render, even when the query resolves immediately — so the first render returned the loading placeholder, which has no `.rust-map` node. The mount-only effect ran with `ref.current === null`, bailed out, and never ran again once the real container appeared on a later render (its dependency array was `[]`). `containerSize` stayed `{0, 0}` forever, so the map rendered at zero size.

**Required behavior:** When an effect must attach to a DOM node that is conditionally rendered (including "not on the first render because the data isn't there yet"), use a callback ref stored in state (`useState<HTMLDivElement | null>(null)` passed directly as `ref`) instead of `useRef` + a mount-only effect. Depend on that state value in the effect so it re-runs exactly when the node actually appears or changes, not just once at mount.

**Evidence:** User reported "карта не отображается, размер 0 0" (map doesn't render, size 0 0). Fixing it also surfaced that jsdom has no `ResizeObserver` at all (the frontend test suite was passing only because the buggy effect never actually ran); a stub was added to `frontend/src/test-setup.ts`.

## 2026-08-28 - AppMarker type 1 is Player, not a world/server marker

**Context:** `mapMarkers` state built from `getMapMarkers` in `backend/services/rustplus-control-service.ts`, rendered on the map alongside `teamMapMembers` (from `getTeamInfo`).

**What went wrong:** The frontend's marker classification (`markerKind` in `frontend/src/features/map/map-geometry.ts`) only special-cased `{CH47:4, CargoShip:5, PatrolHelicopter:8}` as "event"; every other `AppMarkerType` value — including `Player:1` — fell into the "server" (world point-of-interest) bucket. Rust+ includes your own team's members in `getMapMarkers` as `type=1` markers (duplicating `getTeamInfo`), so those got rendered as generic yellow "server" dots instead of being recognized as players.

**Required behavior:** Check `node_modules/@liamcottle/rustplus.js/rustplus.proto`'s `enum AppMarkerType` before assuming what a numeric marker type means — don't infer it from which values an existing `Set`/switch happens to special-case. `Player:1` markers are redundant with `getTeamInfo` and should be filtered out of `mapMarkers` server-side (`backend/services/rustplus-control-service.ts`'s `startMarkerPolling`) rather than given a visual bucket on the frontend.

**Evidence:** User reported "markers labeled as server are actually team [players]"; the proto confirms `enum AppMarkerType { Undefined=0; Player=1; Explosion=2; VendingMachine=3; CH47=4; CargoShip=5; Crate=6; GenericRadius=7; PatrolHelicopter=8; }`.

## 2026-08-28 - Never call a `<dialog>`'s close() from a mount effect's own cleanup

**Context:** `frontend/src/shared/ui/modal.tsx`, wrapping `<dialog>` to call `showModal()` on mount and forward the native `close` event to a React `onClose` prop. Used by all 5 dialogs in the app (settings, discord, device, group, pairing).

**What went wrong (two attempts, both confirmed wrong by the user before the fix that stuck):**
1. First version called `dialog.close()` unconditionally in the effect cleanup while the `close` listener was still attached, with the listener wired through JSX's `onClose` prop. User: "Модалки вообще не работают" (nothing opened / closed itself immediately).
2. Second attempt kept the `close()` call in cleanup but switched to a manually managed `addEventListener`/`removeEventListener` pair, removed *before* calling `close()`, reasoning the queued native `close` event from React StrictMode's dev-mode mount/cleanup/mount double-invoke was reaching a still-attached listener. User: "не исправилось, модалка так и не появляется" (still doesn't appear at all) — so that ordering fix was not the (whole) story; `showModal()` throws `InvalidStateError` if the dialog already has an `open` attribute, and something in the close()-then-reopen sequence on the same node was leaving it unable to reopen.

**Required behavior:** Don't call `close()` on a `<dialog>` from the mount effect's cleanup at all — removing the `<dialog>` node from the document (a real unmount) implicitly drops it from the top layer on its own, so cleanup only needs to detach listeners. Guard the open call with `if (!dialog.open)` so the effect is safe to run twice on the *same* node without an intervening close, which is exactly what StrictMode's double-invoke does (the DOM node persists across the simulated remount; only the JS effect functions run twice).

**Evidence:** Two consecutive user reports that the dialog didn't work after each attempted fix. jsdom's `HTMLDialogElement` has no `showModal`/`close` implementation (confirmed via `node_modules/jsdom/lib/jsdom/living/nodes/HTMLDialogElement-impl.js`), so this class of bug is invisible to the frontend test suite regardless of which cleanup approach is used — real-browser (or user) verification is required, a unit test cannot substitute for it here.

## 2026-08-28 - Retry map loading on a Rust+ rate limit, like device state loading does

**Context:** `loadMap` in `backend/services/rustplus-control-service.ts`, called once from `startPollingListeners` on connect.

**What went wrong:** `getInfo`/`getMap` callbacks only checked `message.response?.error` generically and returned, leaving `this.map` `null` forever when Rust+ answered with a `rate_limit` error. Since `loadMap` was never retried, `GET /api/map` kept answering `409` indefinitely even though the frontend polls it (see the sibling 2026-08-28 lesson on `409` handling) expecting the server to eventually succeed.

**Required behavior:** Detect `rate_limit` in the Rust+ response error (same check `loadDeviceStates` already used) and reschedule `loadMap` after a delay instead of giving up, tracking the retry timer so `clearMapState`/reconnect can cancel it.

**Evidence:** User reported the map never loads when a rate limit error occurs; `loadMap` had no retry path at all while `loadDeviceStates` already implemented one for the same class of error.

## 2026-08-28 - Do not add typescript-eslint to this repository

**Context:** Adding a linter that reports React hook dependency problems in `frontend/src`.

**What went wrong:** `typescript-eslint` was installed and configured, but it refuses to load on this project's TypeScript version, so the linter could not run at all.

**Required behavior:** Lint this repository with `oxlint` (`npm run lint`, configured in `.oxlintrc.json`). Do not reintroduce `typescript-eslint` while the project stays on TypeScript 7; its released versions cap support at `<6.1.0`.

**Evidence:** `npm install` failed with a peer conflict against `typescript@7.0.2`, and after forcing the install, `npx eslint` aborted with `Error: typescript-eslint does not support TS 7.0.` (tracked in typescript-eslint issue #10940).

## 2026-08-28 - Treat GET /api/map 409 as not-ready, not an error

**Context:** Rendering the Rust+ map in `frontend/src/features/map`.

**What went wrong:** The map view showed a hard failure message for any non-OK response. Because the query client does not retry, a freshly connected server left the map permanently blank.

**Required behavior:** `GET /api/map` answers `409` with `Map is not available yet.` until the server has received the map. Keep polling on `409` and only report a failure for other statuses.

**Evidence:** Running the app against a live server returned `GET /api/map [409]`; the Map tab rendered "Map could not be loaded." and never recovered until polling on `409` was added.

## 2026-08-28 - Verify a piped npm command actually succeeded

**Context:** Installing dev dependencies through the Bash tool with output piped to `tail`.

**What went wrong:** `npm install ... | tail` reported exit code 0 because the exit status came from `tail`, and the failed install was reported to the user as successful.

**Required behavior:** Confirm an install by checking the result rather than the piped exit code, for example by listing the expected directory under `node_modules` or reading the package's entry in `package.json`.

**Evidence:** The background task reported "exit code 0" while the captured output contained `npm error ... Could not resolve dependency`, and none of the requested packages were present in `node_modules`.

## 2026-08-27 - Tolerate incomplete AppInfo responses

**Context:** Loading Rust+ map metadata through `getInfo`.

**What went wrong:** The installed protobuf schema required `AppInfo.queuedPlayers`, while the production Rust+ server omitted it and terminated the socket decode.

**Required behavior:** Patch `AppInfo` fields as optional in the post-install script and verify the patched `queuedPlayers` field within the `AppInfo` message.

**Evidence:** Production log reported `ProtocolError: missing required 'queuedPlayers'`.

## 2026-08-22 - Patch optional storage item fields

**Context:** Loading Storage Monitor contents from a current Rust+ server.

**What went wrong:** `AppEntityPayload.Item.itemIsBlueprint` remained required, while the server omitted it for some inventory items, causing protobuf decoding to terminate the connection.

**Required behavior:** Make this field optional through the post-install patch, anchored to `AppEntityPayload.Item`, and verify that exact field after patching.

**Evidence:** User supplied `ProtocolError: missing required 'itemIsBlueprint'` for an item with only `itemId` and `quantity`.

## 2026-08-22 - Restart the FCM listener sequentially

**Context:** Saving edited FCM settings in the dashboard.

**What went wrong:** The settings endpoint killed the current FCM listener and immediately started a replacement, allowing two receivers to use the same credentials briefly and preventing reliable pairing notifications.

**Required behavior:** Wait for the previous FCM listener process to close before starting its replacement after credential changes.

**Evidence:** User reported that pairing stopped working after saving new settings.

## Entry format

```markdown
## YYYY-MM-DD - Short lesson title

**Context:** Where and when the issue applies.

**What went wrong:** Observable incorrect action or result.

**Required behavior:** Specific action an agent must take in the same situation.

**Evidence:** User feedback, test, review finding, or verification result.
```

## 2026-08-21 - Verify compact collection transforms parse

**Context:** Adding persisted switch-group normalization in `server.js`.

**What went wrong:** A dense nested `map`/`filter`/`Set` expression omitted a closing parenthesis and made the server fail its syntax check.

**Required behavior:** Run `node --check server.js` after editing nested collection expressions and keep them formatted enough to make delimiter matching reviewable.

**Evidence:** `node --check server.js` reported `SyntaxError: missing ) after argument list` at the group normalization expression.

## 2026-08-20 - Rust+ pairing tokens are not self-service manual input

**Context:** Planning Rust+ onboarding for ordinary players rather than Rust server administrators.

**What went wrong:** Manual entry of a Rust+ player token was presented as a practical alternative to FCM pairing without verifying how a player obtains that token.

**Required behavior:** Treat FCM pairing as required for ordinary-player self-service onboarding. Mention manual token entry only for server administrators who can read `player.tokens.db` or another explicitly trusted source.

**Evidence:** The installed `@liamcottle/rustplus.js` pairing documentation states that pairing notifications carry `playerId` and `playerToken`; its manual lookup procedure is specifically for Rust server administrators with access to `player.tokens.db`.

## 2026-08-21 - Patch the specific Rust+ protobuf message

**Context:** Handling missing optional team-member fields sent by current Rust+ servers.

**What went wrong:** The protobuf patch matched the first `message Member` declaration instead of `AppTeamInfo.Member`, so `isOnline` remained required in the production image.

**Required behavior:** Anchor protobuf patches to the enclosing message and verify the expected field is optional in the resulting file or running container.

**Evidence:** Production logs raised `ProtocolError: missing required 'isOnline'`; inspection of the container showed `required bool isOnline = 5` after a successful image build.
