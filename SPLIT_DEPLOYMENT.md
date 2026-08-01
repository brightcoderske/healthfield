# Healthfield split deployment

## Final architecture

- `healthfieldpharmacy.co.ke` and `www.healthfieldpharmacy.co.ke`: the Next.js storefront on Vercel.
- `api.healthfieldpharmacy.co.ke`: the standalone Node.js API on NovaHost/cPanel.
- MySQL, NovaHost mailboxes, admin-uploaded product images, and prescription files remain on NovaHost.
- Logos, hero images, fonts, icons, CSS, and other normal storefront files remain in the frontend `public` directory and deploy with Vercel.
- Vercel calls Nova privately with `API_SHARED_SECRET`. Large browser uploads use a separate five-minute signed upload token and are restricted by CORS.

Do not remove the existing NovaHost Next.js application until every check in the final section passes on the two production domains.

## 1. DNS and TLS

1. Point `api.healthfieldpharmacy.co.ke` to the NovaHost account/server and add it as a cPanel subdomain.
2. Point the apex and `www` storefront domains to the Vercel project using the DNS records Vercel shows for the project.
3. Confirm a valid HTTPS certificate on all three hostnames before enabling production traffic.

## 2. Secrets

Generate two different random values of at least 32 characters:

- `AUTH_SECRET`: identical on Vercel and NovaHost so the API can verify storefront sessions.
- `API_SHARED_SECRET`: identical on Vercel and NovaHost; never prefix it with `NEXT_PUBLIC_`.

SMTP passwords may contain symbols such as `@` and `..`. Put such passwords inside double quotes:

```dotenv
SMTP_PASSWORD="example@12.."
```

Do not commit the real `.env` file or paste secrets into Vercel build logs.

## 3. NovaHost API application

The repository deployment installs the compiled archive at `/home/healthfi/healthfield-api`. Create the cPanel **Setup Node.js App** entry with:

- Node version: 24 (22.13 or newer is supported)
- Application mode: Production
- Application root: `healthfield-api`
- Application URL: `https://api.healthfieldpharmacy.co.ke`
- Startup file: `server.cjs`

The release is already bundled; cPanel does not need to run `npm install` or discover an npm script. Git deployment uses `.cpanel.yml` and the tracked `deploy/healthfield-api-production.tar.gz` archive.

Create `/home/healthfi/healthfield-api/.env` from `api-service/.env.example` and supply the real values:

```dotenv
NODE_ENV=production
DATABASE_URL=mysql://DATABASE_USER:DATABASE_PASSWORD@127.0.0.1:3306/DATABASE_NAME
AUTH_SECRET=THE_SHARED_AUTH_SECRET
API_SHARED_SECRET=THE_PRIVATE_API_SECRET
API_PUBLIC_URL=https://api.healthfieldpharmacy.co.ke
APP_URL=https://healthfieldpharmacy.co.ke
CORS_ALLOWED_ORIGINS=https://healthfieldpharmacy.co.ke,https://www.healthfieldpharmacy.co.ke
STORAGE_ROOT=/home/healthfi/healthfield-storage
RUN_MIGRATIONS=true
DB_POOL_SIZE=5
SMTP_HOST=mail.healthfieldpharmacy.co.ke
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=YOUR_NOVAHOST_MAILBOX
SMTP_PASSWORD="YOUR_MAILBOX_PASSWORD"
SMTP_FROM=YOUR_NOVAHOST_MAILBOX
SMTP_FROM_NAME=Healthfield Pharmacy
NOTIFICATION_EMAIL=THE_TEAM_NOTIFICATION_MAILBOX
```
Restrict this file to the account owner where cPanel permits it. API startup applies pending database migrations automatically. Set `RUN_MIGRATIONS=false` only after migrations have been deliberately moved to another release process.

Disable Imunify360 / “Bot Protection” (or whitelist Vercel egress IPs) on `api.healthfieldpharmacy.co.ke`. The challenge page returns HTML with HTTP 200 and breaks every storefront and admin API call.

## 4. Preserve operational files

Uploads live outside both application releases:

```text
/home/healthfi/healthfield-storage/uploads/products
/home/healthfi/healthfield-storage/prescriptions
```

Before switching traffic, **copy** existing files into those directories:

- old `public/uploads/products/*` to `healthfield-storage/uploads/products/`
- old private prescription storage to `healthfield-storage/prescriptions/`

Compare file counts and open representative files before considering removal of an old copy. Never put prescription files in a public web directory.

## 5. Vercel frontend

Import the Git repository into Vercel as a Next.js project. Keep the repository root as the project root and set these Production environment variables:

```dotenv
APP_URL=https://healthfieldpharmacy.co.ke
AUTH_SECRET=THE_SAME_SHARED_AUTH_SECRET_AS_NOVA
API_BASE_URL=https://api.healthfieldpharmacy.co.ke
API_SHARED_SECRET=THE_SAME_PRIVATE_API_SECRET_AS_NOVA
NEXT_PUBLIC_API_URL=https://api.healthfieldpharmacy.co.ke
```

`NEXT_PUBLIC_API_URL` is intentionally public and contains only the API hostname. `API_SHARED_SECRET` and `AUTH_SECRET` must remain server-only.

Deploy the API first, verify `https://api.healthfieldpharmacy.co.ke/health`, and then deploy Vercel. This prevents the storefront from being published before its data service is ready.

## 6. Production verification and retirement

Verify all of the following through the production domains:

1. API `/health` returns `status: ok`, while a private `/v1` route without the shared key is denied.
2. Homepage logos, hero art, categories, catalogue rows, search, product pages, recommendations, footer, and mobile menu render correctly.
3. Customer registration and login return to the storefront, show logged-in navigation, preserve shopping, and allow logout.
4. Account order history, chat history/replies, favourites, addresses, and prescription upload work.
5. Checkout creates an order and sends customer/team emails through the NovaHost mailbox.
6. Admin tables search correctly; admin can add a product image and it loads from the API hostname.
7. Pharmacist prescription download is authenticated and files are not publicly addressable.
8. Sitemap and Google Merchant XML use the production storefront URLs and product images resolve.
9. Desktop persistent navigation and mobile hamburger navigation behave correctly.

Keep the old application available as rollback until these checks pass. After verification, stop and remove only the old cPanel Next.js application and its obsolete release directories. Preserve the Git repository, database, mailboxes, `healthfield-storage`, and the new `healthfield-api` application.
