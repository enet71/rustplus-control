# Agent Instructions

## Project overview

- This is a local Rust+ control application built with Node.js, Express, and `@liamcottle/rustplus.js`.
- `server.js` owns the HTTP API, Rust+ connection lifecycle, FCM registration/listening, and local configuration persistence.
- `public/` contains the static browser UI. Keep browser code framework-free and compatible with the existing plain JavaScript/CSS structure.
- `scripts/` contains supporting Node scripts, including the FCM listener and the post-install package patch.

## Skills

Before acting on a task, identify the applicable skills in `.agents/skills/` and load their `SKILL.md` files completely.

- Always invoke `project-learning` for implementation, investigation, review, or configuration changes in this repository. Read its lessons log before changing code and record only confirmed new lessons through that skill.
- Invoke `code-best-practices` for non-trivial code changes and code reviews. Follow it to define observable behavior, preserve clear state ownership, validate boundaries, handle failures explicitly, and verify changed behavior with focused tests.
- When a task explicitly names another available skill or clearly matches its description, invoke that skill as well. More specific project or domain skills take precedence over general guidance.

## Commands

- Install dependencies: `npm install`
- Start the local application: `npm start`
- Run automated tests: `npm test`

The server binds to `127.0.0.1` and uses port `3010` by default. Change the port through the `PORT` environment variable rather than hard-coding a new value. Set `HOST=0.0.0.0` only when the process is behind a reverse proxy or inside the deployment container network.

## Change guidelines

- Before working in this repository, apply the requirements in the Skills section.
- Preserve the CommonJS module style and the existing direct Express route definitions unless a change genuinely requires a larger refactor.
- Keep Rust+ and FCM process lifecycle state in `server.js`; do not expose child-process control directly to the browser.
- Keep API error responses JSON and validate all request data before persisting it or passing it to Rust+.
- When changing an API endpoint, update every affected client caller in `public/` in the same change.
- For browser polling or async actions, handle failed HTTP requests and keep UI controls consistent with in-flight state.
- Prefer small, focused changes. Do not reformat unrelated code or replace existing UI patterns without a product reason.

## Sensitive local data

- `data/rustplus.json`, `data/rustplus-fcm.json`, and legacy `rustplus.config.json` can contain Rust+ credentials, Steam identifiers, pairing tokens, and FCM registration data.
- Never commit, print, log, or add fixture values containing these secrets.
- Preserve restricted permissions (`0o600`) when adding a new persisted credential/config file.
- Treat all values returned by Rust+ notifications and browser requests as untrusted input.

## Verification

- Run `npm test` after behavior changes when the test suite is available.
- For UI changes, run the app and manually verify the relevant flow at `http://127.0.0.1:3010`.
- For changes involving persisted configuration or login, verify both the unregistered and already-registered paths without altering or deleting a user's real credentials.
