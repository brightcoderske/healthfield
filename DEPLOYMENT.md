# Deploying Healthfield

One cPanel account runs everything. The repository is cloned once, into its own folder, and a
single script, `scripts/deploy.sh`, builds and releases both apps.

```text
~/apps/arctik/               git clone of main; the Next.js storefront   (startup file: server.cjs)
~/apps/arctik/api-service/   the Express API                             (startup file: server.cjs)
~/healthfield-storage/       uploads and prescriptions, outside both apps (never deployed over)
```

`scripts/deploy.sh` works out these locations from where it sits, so the folder can be named
anything. Nothing in it is specific to this account except `.cpanel.yml`, which names the path.

## One-time setup

1. **Clone** `main` into `~/apps/arctik` (cPanel **Git Version Control**, or `git clone`).
2. **Create two apps** in cPanel **Setup Node.js App** (Node 24, Production):

   | App | Application root | Startup file |
   | --- | --- | --- |
   | Storefront | `apps/arctik` | `server.cjs` |
   | API | `apps/arctik/api-service` | `server.cjs` |

   `deploy.sh` finds each app's tools in `~/nodevenv/<application root>/<version>`. If cPanel puts
   them somewhere else, run it with `STOREFRONT_VENV=/path/to/bin/activate` (or `API_VENV=`).
3. **Create the two environment files**, which Git ignores and deploys never touch:
   - `~/apps/arctik/api-service/.env`, from `api-service/.env.example`.
   - `~/apps/arctik/.env` for the storefront: `APP_URL`, `API_BASE_URL`, `NEXT_PUBLIC_API_URL`
     and `API_SHARED_SECRET` (the same value as in the API's file; never prefix it with
     `NEXT_PUBLIC_`).

   Put values containing symbols in double quotes, e.g. `SMTP_PASSWORD="example@12.."`. Do not
   commit either file.
4. **Redis (optional).** Set `REDIS_SOCKET` in the API `.env` to the socket path cPanel shows on its
   Redis page. Leave it unset and the site behaves as it did before Redis. The other Redis settings
   are in `api-service/.env.example`.
5. If you are bringing existing files across, **copy** them into the storage folder before the
   first deploy: product images to `~/healthfield-storage/uploads/products/` and prescription files
   to `~/healthfield-storage/prescriptions/`. Keep `STORAGE_ROOT` in the API `.env` pointing there.
   Never put prescriptions in a web-served folder.

## Deploying

From a terminal in the account:

```bash
bash ~/apps/arctik/scripts/deploy.sh --pull   # fetch main, then deploy
bash ~/apps/arctik/scripts/deploy.sh          # deploy what is already checked out
```

From cPanel: **Git Version Control > Update from Remote**, then **Deploy HEAD Commit**. That runs
`.cpanel.yml`, which runs the same script. A push alone does not deploy unless the host is set up to
pull on push.

In order, the script:

1. checks both `.env` files exist and finds the Node environment;
2. stops lingering Node workers belonging to each app (matched by their exact working directory, so
   an open terminal or another app is never touched);
3. installs dependencies, only if `pnpm-lock.yaml` changed;
4. type-checks and builds the API into a staging folder, then builds the storefront;
5. runs database migrations;
6. swaps the new API and storefront in, and asks Passenger to restart both (`tmp/restart.txt`).

Everything is built before anything live is replaced. If the storefront build or the migration
fails, the previous storefront build is put back and the API is not swapped. A failed deploy leaves
the site running the release it had.

Options, as environment variables: `SKIP_STOREFRONT=1` or `SKIP_API=1` to deploy one app,
`INSTALL_DEPS=1` to force an install, `BUILD_MEMORY_MB` for the storefront build's memory limit
(default 2048), `NODE_VERSION` (default 24), `STORAGE_ROOT`.

## Rolling back

The previous releases are kept beside the new ones:

- API: `api-service/.release.previous/` holds the old `dist` and `drizzle`.
- Storefront: `.next.previous/` holds the old build.

Stop both apps, swap those folders back, and restart. Migrations only add to the database, so an
older release keeps working against a migrated one.

## Checking a deploy

1. `GET <api>/health` returns `status: ok`, and shows the cache and outbox state. A private `/v1`
   route without the shared key is refused.
2. The home page, a product page, search, the cart and the footer render.
3. Log in, add to the cart and place an order. The customer and team emails arrive.
4. Admin: the product table loads, and a product image loads after upload.
5. A prescription file can be downloaded by a pharmacist but is not publicly addressable.

If Imunify360 or other bot protection challenges requests to the API host, whitelist the storefront;
the challenge page returns HTML with HTTP 200 and breaks every API call.
