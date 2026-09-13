# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

POSly — a Windows desktop POS (point of sale) app: Electron wrapping a Next.js/React frontend and a local Express API, with a local SQLite (SQLCipher-encrypted) database per install and Supabase used only for cross-device sync and license issuance. Offline-first: the store's data and API live entirely on the local machine; the cloud is not required for day-to-day operation.

The licensing console (`license-console/`) is a **separate** Next.js project deployed independently to Vercel — it is not bundled into the desktop app and is excluded from the Electron build. Treat it as a different codebase unless a task explicitly touches licensing.

## Commands

```bash
npm install
copy .env.example .env        # then fill in dev secrets — never commit .env

npm run dev:full              # API (:3001) + Next web (:3000) together — most common dev command
npm run dev                   # web only
npm run api:dev                # API only (auto-restarts on file changes under api/ — see gotcha below)
npm run electron-dev           # web + Electron shell

npm run test:unit              # node --test over tests/unit/*.test.mjs (fast, no browser)
node --test tests/unit/tax-math.test.mjs   # run a single unit test file
npm run test:e2e               # Playwright smoke specs in tests/ (needs dev:full running; baseURL :3000)
npx playwright test tests/posly.smoke.spec.ts   # a single e2e spec

npx tsc --noEmit                # typecheck (frontend .ts/.tsx only — api/**/*.js is NOT covered)
node --check api/some-file.js   # syntax-check a backend .js file (tsc won't catch these)
npx eslint .                    # lint

npm run build                   # next build
npm run electron-dist           # build the Windows installer (dist-electron/); desktop-only, no license console bundled
```

CI (`.github/workflows/ci.yml`) runs `npm ci` → `tsc --noEmit` → `test:unit` on push/PR to main/master.

Dev vs. installed ports differ (matters when reproducing a bug): dev API is `:3001` / web `:3000`; the packaged Electron app uses `:3731` / `:3730`. `app/pos/lib/apiBase.ts`-style code branches on `window.location.port` to pick the right base URL — don't hardcode `3001` in frontend code.

## Architecture

### Backend (`api/`)

Express app (`api/server.js`) with route → controller → service → repository layering per domain (e.g. `routes/products.routes.js` → `controllers/products.controller.js` → `services/product.service.js` → `repositories/...`). `api/database.js` opens the (possibly SQLCipher-encrypted) SQLite connection and is the single source of the `db` export everything else imports.

**Schema is split under `api/schema/`** (11 modules: `sales-core`, `tenants`, `users-permissions`, `setup-state`, `catalog`, `operations`, `sync-runtime`, `kitchen-cash`, `legacy-migrations`, `inventory-locations`, `bootstrap`), orchestrated by `database.js` inside one `db.serialize()` call. **Do not reorder these calls** — `inventory-locations.js` and `bootstrap.js` each contain a transactional table-rebuild migration (expanding a CHECK constraint) that only fires on databases predating that constraint; a known pre-existing bug there means the migration can fail if `ensureTenantGuards()`-created triggers run before the rebuild completes on an old-shaped DB (not yet fixed — low priority since there's no production data yet). To verify a change to `database.js`/`schema/*`: dump `sqlite_master` from a fresh DB before/after and diff (schema must be byte-identical), and separately test against a hand-built "legacy" fixture DB missing the newer columns, since a fresh DB never exercises the migration branches.

**Multi-tenant**: almost every table has `tenant_id`; SQLite triggers (`ensureTenantGuards` in `database.js`) reject inserts/updates with a missing `tenant_id` on the tenant-scoped tables. A single install is normally single-tenant (`POS_DEV_TENANT`/`DEFAULT_TENANT_ID`), but the schema supports multiple.

**Auth**: Bearer tokens are `userId.exp.signature` HMAC'd with a per-install secret (`api/utils/authSecret.js`, persisted next to the DB, never a hardcoded default). `api/middlewares/auth.js` resolves the user per-request; several `AUTH_ALLOW_*` env flags (mock headers, header-based user id, legacy local-admin fallback) default to `true` in dev and `false` when `NODE_ENV=production` — the packaged Electron build force-sets `NODE_ENV=production` (`electron/main.js`) regardless of how it was built, so these dev conveniences can't leak into a shipped install. Authorization beyond "is logged in" goes through `permission_rules` (DB-configurable per-key required access level) via `requirePermission`/`requireMinLevel`/`requireAdmin`.

**Sync** (`api/syncService.js`, ~3200 lines): a background loop (`processPullSyncCycle`/`processSyncQueueCycle`, default every 10s) that pulls changes from Supabase and pushes a local `sync_queue` table to Supabase. Logging convention in this file: genuine sparse events/errors go through `logSyncOperation`/`logSyncError` (`api/syncLogger.js`, writes to `sync_logs` + the general logger); anything that would fire every ~10s regardless of outcome (connectivity/queue-status probes prefixed `[DEBUG ...]`, "no items to sync", full-payload dumps that duplicate what's already stored in `orders`/`order_items`) is intentionally left as plain `console.*` — converting those would flood `app_logs`/`sync_logs` forever. Follow that same judgment call for any new logging here.

**Structured logging** (`api/utils/logger.js`): `logInfo`/`logWarn`/`logError`/`logEvent`/`logAudit`. It imports `db` from `database.js`, so it must never be imported from `api/schema/*.js` (those modules run *during* `database.js`'s own construction — importing the logger there would be a circular import). Boot-time code (`database.js`, `schema/*`, `utils/dbEncryption.js`, `utils/dbPaths.js`, `utils/authSecret.js`) and one-shot CLI scripts under `api/scripts/*.mjs` intentionally use plain `console.*` for the same reason (or because a CLI script's output belongs on stdout, not in a DB table).

### Frontend (`app/`)

Next.js App Router. `app/(pos)/PosScreen.tsx` is the live sales screen — it's large (~2400 lines) but already decomposes heavily into custom hooks under `hooks/` (`useCart`, `useCartStockOps`, `useReceiptPrint`, `useQuotations`, `useTableOrderSession`, `useDiscountForm`, `useBarcodeScanner`, etc.) and its JSX is pure composition of already-extracted components (`app/pos/components/*`); there's no leftover inline duplication to pull out. `app/management/*` holds the back-office screens (products, documents, reports, users, etc.) — some of these (`ProductsManager.tsx`, `DocumentsManager.tsx`) still carry co-located `*.helpers.ts` (pure functions/types) and `*.parts.tsx` (presentational subcomponents) split out from the original monolithic files; when a management screen grows unwieldy, extracting pure logic and presentational-only subcomponents this way (never reordering or changing behavior) is the established low-risk pattern here — don't attempt to deduplicate near-identical form modals (e.g. Products' New/Edit) without treating it as its own reviewed task, since they differ in real, easy-to-miss ways (permission gates, field typing, self-reference exclusions).

### Electron (`electron/`)

Wraps the Next.js server + API as a desktop app. Packaged builds bind the ports above; `POS_DB_ENCRYPTION_KEY` (SQLCipher) is injected via Electron's `safeStorage`, never entered by the operator.

### Testing

`tests/unit/*.test.mjs` are plain Node `--test` files (no framework), several of which boot the real schema against a temp SQLite file via `POS_DB_PATH` env override — this is the closest thing to an integration test for `database.js`/`schema/*`. `tests/*.spec.ts` are Playwright smokes that expect `dev:full` already running.
