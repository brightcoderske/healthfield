# Healthfield Pharmacy

Production-oriented mobile-first ecommerce and multi-branch pharmacy management system.

## Applications

- `/` — customer storefront and installable PWA
- `/admin` — responsive staff and administration portal
- `/api` — versioned server endpoints and integration boundaries

## Core domains

The database foundation covers users and roles, shared products, branches, per-branch inventory, orders, item-level multi-branch fulfilment, private prescriptions, and immutable activity records.

## Local development

Copy `.env.example` to `.env.local`, configure MySQL, then run the development server. Private prescription files must remain under `storage/private` and must never be exposed through the public directory.

## Production

Production is designed for Node.js 22, MySQL/MariaDB, HTTPS, and cPanel/LiteSpeed. Use a dedicated least-privilege database account and production-grade secrets.
