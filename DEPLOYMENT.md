# Deploying Healthfield

Healthfield is **one Node app** in **one folder**, with one `.env` and one restart. The storefront
(Next.js) and the API run in the same process: the API is built into `api-service/dist` and the
root `server.cjs` starts it inside the storefront. Requests for `/v1`, `/health` and
`/uploads/products` go to the API; everything else goes to the storefront. The storefront's own
calls to the API go to a loopback-only listener inside the same process, so there is no second
app, port or hostname to manage. A single script, `scripts/deploy.sh`, builds and releases it.

```text
~/health_field/              git clone of main; the one app (startup file: server.cjs)
~/health_field/.env          the one environment file (kept out of Git)
~/healthfield-storage/       uploads and prescriptions, outside the app (never deployed over)
```

`scripts/deploy.sh` works out its location from where it sits, so the folder can be named
anything. Only `.cpanel.yml` names the path.

## One-time setup

1. **The clone** is `~/health_field` (cPanel **Git Version Control**). It already holds the code.
2. **Create one app** in cPanel **Setup Node.js App**: Node 24, Production, application root
   `health_field`, startup file `server.cjs`, application URL the site's own domain.
   `deploy.sh` finds the app's tools in `~/nodevenv/health_field/24`; if cPanel shows another path,
   run it with `NODE_VENV=/path/to/bin/activate`.
3. **Create `~/health_field/.env`** from `api-service/.env.example`. It holds the API's settings
   (database, SMTP, M-Pesa, Redis, `AUTH_SECRET`, ...) and the storefront's. Git ignores it and
   deploys never touch it. Besides the API settings, set:

   ```dotenv
   APP_URL=https://your-domain
   API_PUBLIC_URL=https://your-domain
   IMAGE_PUBLIC_URL=https://your-domain
   NEXT_PUBLIC_API_URL=https://your-domain
   CORS_ALLOWED_ORIGINS=https://your-domain,https://www.your-domain
   ```

   Leave `API_BASE_URL` unset: the app points it at its own loopback listener at startup.
   `API_SHARED_SECRET` is used by both halves and must never be prefixed `NEXT_PUBLIC_`. Put values
   containing symbols in double quotes, e.g. `SMTP_PASSWORD="example@12.."`. Do not commit the file.
4. **Redis (optional).** Set `REDIS_SOCKET` to the socket path cPanel shows on its Redis page. Left
   unset, the site behaves as it did before Redis. The other settings are in `api-service/.env.example`.
5. If you are bringing existing files across, **copy** them into the storage folder before the first
   deploy: product images to `~/healthfield-storage/uploads/products/` and prescription files to
   `~/healthfield-storage/prescriptions/`. Keep `STORAGE_ROOT` in `.env` pointing there. Never put
   prescriptions in a web-served folder.

To run the storefront alone against an API hosted elsewhere, set `EMBED_API=false` and
`API_BASE_URL` to that API.

### Testing a second copy against the live database

Two copies of the app on one database both run the scheduled work: payment reconciliation, M-Pesa
recovery and the daily report. Set `BACKGROUND_JOBS=false` in the test copy's `.env` so only the
live one does, and remove it when the test copy becomes the live one.

### M-Pesa

STK push callbacks use `MPESA_CALLBACK_BASE_URL` on every request, so changing it moves them at
once. The C2B and Pull URLs are registered at Safaricom and may not be re-registrable on production.
Keep the old `api.` hostname pointing at this same app until the new URLs are confirmed at
Safaricom, then retire it.

## Deploying

From a terminal in the account:

```bash
bash ~/health_field/scripts/deploy.sh             # fetch main, then deploy
bash ~/health_field/scripts/deploy.sh --no-pull   # deploy what is already checked out
```

From cPanel: **Git Version Control > Update from Remote**, then **Deploy HEAD Commit**. That runs
`.cpanel.yml`, which runs the same script. A push alone does not deploy unless the host is set up to
pull on push.

In order, the script:

1. checks the `.env` file exists and finds the Node environment;
2. stops lingering Node workers of the app (matched by their exact working directory, so an open
   terminal or another app is never touched);
3. installs dependencies, only if `pnpm-lock.yaml` changed;
4. type-checks and builds the API into a staging folder, then builds the storefront;
5. runs database migrations;
6. swaps the new builds in, and asks Passenger to restart the app (`tmp/restart.txt`).

The app is stopped before the build so its memory is free for it, which means the site is offline
for the minutes the build takes. If the storefront build or the migration fails, the previous
storefront build is put back and the API is not swapped.

Options, as environment variables: `INSTALL_DEPS=1` to force an install, `BUILD_MEMORY_MB` for the storefront build's memory limit
(default 1400; the account has 2 GB of RAM in all), `NODE_VERSION` (default 24), `NODE_VENV`, `STORAGE_ROOT`.

## Rolling back

The previous releases are kept beside the new ones:

- API: `api-service/.release.previous/` holds the old `dist` and `drizzle`.
- Storefront: `.next.previous/` holds the old build.

Stop the app, swap those folders back, and restart. Migrations only add to the database, so an
older release keeps working against a migrated one.

## Checking a deploy

1. `GET https://your-domain/health` returns `status: ok`, and shows the cache and outbox state. A
   private `/v1` route without the shared key is refused.
2. The home page, a product page, search, the cart and the footer render.
3. Log in, add to the cart and place an order. The customer and team emails arrive.
4. Admin: the product table loads, and a product image loads after upload.
5. A prescription file can be downloaded by a pharmacist but is not publicly addressable.
