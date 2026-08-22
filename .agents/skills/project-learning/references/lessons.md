# Lessons Log

Use this file for confirmed, project-specific lessons. Add entries in reverse chronological order.

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
