# Deployment Notes

## Production layout

- The application runs on an Ubuntu DigitalOcean Droplet with Docker Compose.
- Caddy is the public reverse proxy and issues HTTPS certificates.
- The public hostname is a DuckDNS subdomain stored in the server's `.env` as `DOMAIN`.
- The repository's deployment branch is `master`.
- The server checkout is owned by user `deploy` at `/home/deploy/apps/rust-control`.

## Server configuration

The server checkout needs a local `.env` file that is never committed:

```env
DOMAIN=<duckdns-subdomain>.duckdns.org
APP_AUTH_TOKEN=<long-random-token>
```

`data/` is bind-mounted into the app container. It holds Rust+ and FCM credentials and must stay only on the server. It is excluded by `.gitignore`.

The Droplet has limited memory. A persistent 1 GB swap file was configured at `/swapfile` to make Docker image builds reliable.

The DigitalOcean firewall must allow TCP ports 80 and 443 publicly. Restrict TCP port 22 to trusted administrator IP addresses.

## First deployment

On the server, as `deploy`:

```bash
cd /home/deploy/apps/rust-control
docker compose up -d --build
docker compose ps
```

View logs when diagnosing a deployment:

```bash
docker compose logs -f
```

Use `Ctrl+C` to leave the log view; it does not stop containers.

Rust+ FCM registration opens Chrome, so perform the initial registration locally when needed and securely copy the resulting `data/rustplus.json` and `data/rustplus-fcm.json` to the server's `data/` directory. Do not put them in GitHub.

## GitHub Actions

`.github/workflows/ci.yml` runs on pull requests and pushes to `master`:

1. Runs `npm ci` and `npm test`.
2. On a successful push to `master`, connects to the VPS and runs `git pull --ff-only origin master` followed by `docker compose up -d --build`.

Required GitHub repository secrets:

| Name | Purpose |
| --- | --- |
| `DEPLOY_HOST` | Public IP address or hostname of the VPS. |
| `DEPLOY_USER` | `deploy`. |
| `DEPLOY_PATH` | `/home/deploy/apps/rust-control`. |
| `DEPLOY_SSH_KEY` | Private SSH key used only by GitHub Actions to connect as `deploy`. |
| `DEPLOY_KNOWN_HOSTS` | SSH host-key entries for the VPS. |

Each item is a separate GitHub repository secret. Store only the raw private-key text in `DEPLOY_SSH_KEY`, without a `DEPLOY_SSH_KEY=` prefix. Never add `APP_AUTH_TOKEN`, Rust+ credentials, FCM configuration, or any private key to the repository or an issue/chat message.

The VPS itself has a separate read-only GitHub Deploy Key, allowing user `deploy` to pull the private repository. This is distinct from the GitHub Actions SSH key.

## Updating

Push changes to `master`:

```bash
git add <files>
git commit -m "Describe the change"
git push
```

Monitor the `CI and deploy` run in the repository's GitHub Actions tab. For an urgent manual update, run the commands from the First deployment section on the VPS.

## Docker build detail

`npm ci` runs the `postinstall` script `scripts/patch-rustplus-proto.js`. `Dockerfile` must copy `scripts/` before running `npm ci`; otherwise an image build fails because the script is missing.
