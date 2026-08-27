# Lessons Log

Use this file for confirmed, project-specific lessons. Add entries in reverse chronological order.

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
