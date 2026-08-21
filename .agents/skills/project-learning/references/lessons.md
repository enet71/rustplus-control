# Lessons Log

Use this file for confirmed, project-specific lessons. Add entries in reverse chronological order.

## Entry format

```markdown
## YYYY-MM-DD - Short lesson title

**Context:** Where and when the issue applies.

**What went wrong:** Observable incorrect action or result.

**Required behavior:** Specific action an agent must take in the same situation.

**Evidence:** User feedback, test, review finding, or verification result.
```

## 2026-08-20 - Rust+ pairing tokens are not self-service manual input

**Context:** Planning Rust+ onboarding for ordinary players rather than Rust server administrators.

**What went wrong:** Manual entry of a Rust+ player token was presented as a practical alternative to FCM pairing without verifying how a player obtains that token.

**Required behavior:** Treat FCM pairing as required for ordinary-player self-service onboarding. Mention manual token entry only for server administrators who can read `player.tokens.db` or another explicitly trusted source.

**Evidence:** The installed `@liamcottle/rustplus.js` pairing documentation states that pairing notifications carry `playerId` and `playerToken`; its manual lookup procedure is specifically for Rust server administrators with access to `player.tokens.db`.
