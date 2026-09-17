# Deploying Circuit Factory

Target: `circuit.davidwolinsky.com` behind the existing nginx on this host. One Node process on `127.0.0.1:8797`, run by systemd, proxied by nginx. Authentication is the app's signed session cookie; nginx adds no auth of its own.

## First deploy

1. **DNS.** Point `circuit.davidwolinsky.com` (A/AAAA) at this host. Wait until `dig +short circuit.davidwolinsky.com` answers.
2. **Environment file.** `sudo mkdir -p /etc/circuit && sudo cp deploy/env.example /etc/circuit/env && sudo chmod 600 /etc/circuit/env`, then edit it: set `SESSION_SECRET` to `openssl rand -hex 32`, and, if AI review should be live, `AI_PROVIDER`, `AI_MODEL` (from the benchmark result) and the matching API key.
3. **Certificate.** The port-80 server block serves the ACME challenge from `/var/lib/letsencrypt`. Install the nginx site first without a cert by running `deploy/deploy.sh` (it warns and skips the 443 reload if the cert is missing), or copy `deploy/nginx-circuit.conf` to `/etc/nginx/conf.d/circuit.conf` with the 443 block commented out, then:
   `sudo certbot certonly --webroot -w /var/lib/letsencrypt -d circuit.davidwolinsky.com`
4. **Deploy.** From a clean checkout: `deploy/deploy.sh`. It runs the validation gate, installs a release into `/srv/circuit/releases/<stamp>-<commit>`, switches `/srv/circuit/current`, installs `/etc/systemd/system/circuit.service` and `/etc/nginx/conf.d/circuit.conf` when they differ, restarts the service, reloads nginx, runs the live browser smoke test, and rolls back to the previous release if any step fails.
5. **Health.** `curl -s http://127.0.0.1:8797/healthz` locally and `curl -s https://circuit.davidwolinsky.com/healthz` from outside. Both return `{"ok":true,"commit":"...","ai":{...}}`; `ai.configured` should be `true` if you set a provider.
6. **Login on a phone.** Open `https://circuit.davidwolinsky.com/`, expect the login page, enter the GATE_USER / GATE_PASS from `/etc/circuit/env`, expect the template library. Wrong password shows one error line.

## Later deploys

`deploy/deploy.sh` again. Logs: `journalctl -u circuit -f`. Nothing to back up: there is no server-side state. The last three releases are kept; to roll back by hand, point `/srv/circuit/current` at an older release and `sudo systemctl restart circuit`.

## Notes

- The service runs `npm run start` (`tsx server/main.ts`) from `/srv/circuit/current`; `tsx` is a runtime dependency, so releases are installed with `npm ci --omit=dev`.
- `AI_HOURLY_LIMIT` and `AI_DAILY_CAP` bound what a leaked shared credential can cost.
