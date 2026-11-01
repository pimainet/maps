# AGENTS.md

## What this repo is

- Next.js 16 App Router SaaS ("Local Growth OS", Vietnamese UI) for local SEO / Google Business Profile: clients, audits, 30-day plans, content, tasks, workspaces.
- There is no separate backend. Pages under `app/(dashboard)` are mostly client components that call this repo's `/api/*` route handlers; the API routes own Supabase access.
- Auth and tenancy are Supabase. The active workspace comes from the `active_workspace_id` cookie (`lib/auth.ts`); RLS is the real isolation layer. Always query with the session client and still pass `workspace_id` as defense in depth.

## Commands

- `pnpm dev`, `pnpm build`, `pnpm start` (no lint or test scripts exist).
- `pnpm build` uses webpack and **skips TypeScript errors** (`next.config.mjs` has `typescript.ignoreBuildErrors: true`). Typecheck separately: `npx tsc --noEmit`.
- If typecheck reports `TS2307` in `.next/types/validator.ts`, delete `.next` and rerun; those are stale generated route types after pages move.
- Only test: `node scripts/test-gbp-scripts.mjs` after `pnpm add -D jsdom` (TypeScript is already a devDependency). It runs jsdom fixtures for the Maps scraping scripts, not live Google Maps.
- Both `package-lock.json` and `pnpm-lock.yaml` are tracked, but `node_modules` is a pnpm tree. Prefer pnpm and do not regenerate lockfiles with a different package manager.

## Architecture

- `lib/supabase/server.ts` = anon key + user cookies (use in pages/routes; RLS applies). `lib/supabase/admin.ts` = service role, bypasses RLS; use only for cron/webhooks and import it dynamically inside the handler because it throws at import when env vars are missing.
- `lib/db.ts` deliberately uses the session client, not service role. Do not switch it back to `supabaseAdmin`.
- API error contract: helpers throw messages prefixed `Unauthorized:`, `NoWorkspace:`, `RateLimited:`; routes map these to 401/409/429. Keep that pattern for new routes.
- All Claude calls go through `askClaude()` (`lib/claude.ts`, model `claude-sonnet-4-5`, retries transient failures). Rate limits live in `lib/rate-limit.ts`: `checkAiRateLimit` before, `recordAiUsage` only after success. Audits also have a 3-per-client / 30-day quota.
- Two audit pipelines, do not merge them: `/api/audit` uses `AUDIT_PROMPT` text and `audits.module_key='maps_seo'`; `/api/audit/v2-preview` uses the structured 34-check engine in `lib/audit-engine` and `module_key='maps_seo_v2'`.
- GBP observation: `lib/gbp-browser-snapshot.ts` drives Browserbase Chromium via `playwright-core`, runs DOM scripts from `lib/gbp-maps-scripts.ts`, and uses Claude only for unstructured text. It falls back to Google Places API; without `BROWSERBASE_API_KEY` it is Places-only. `coverage.sections` distinguishes "not read" from "missing on the profile".
- `lib/features.ts` has `AUTO_POST_ENABLED = false`, which hides auto-post / GBP-connect UI. Keep it false unless explicitly asked.

## Database and environment

- Migrations are manual SQL files in `supabase/migrations/`, run in the Supabase SQL Editor. There is no Supabase CLI config. Add new numbered files; do not edit applied migrations.
- `001+` assume the original tables (`clients`, `audits`, `plans`, `tasks`, `contents`, `content_history`) already exist; they are not created in this repo. A blank database cannot be bootstrapped from these migrations alone.
- Migrations 014 (`completed_at`, `notification_prefs`) and 015 (deep snapshot columns) are optional at runtime: code catches missing-column errors and falls back. Preserve that pattern when adding columns.
- `.env.local` currently contains only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Runtime features additionally need `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (cron), and optionally `GOOGLE_PLACES_API_KEY`, `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` / `BROWSERBASE_REGION` / `BROWSERBASE_PROXIES`, `CRON_SECRET`, `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `NOTIFY_SECRET`, `NEXT_PUBLIC_APP_URL`. Never print, commit, or overwrite `.env*`.
- `vercel.json` cron `0 1 * * *` = 08:00 Vietnam time. `/api/cron/reminders` requires `Authorization: Bearer $CRON_SECRET` and supports `?dry=1`.

## Conventions and gotchas

- UI copy, prompts, comments, and emails are Vietnamese. Keep new user-facing text Vietnamese.
- Adding a public endpoint also requires updating the `isPublic` list in `middleware.ts` (currently `/login`, `/signup`, `/auth`, `/demo`, `/api/public/`, `/api/cron/`, `/api/notifications/unsubscribe`).
- `app/(dashboard)` is a route group, not a URL segment: `/clients` maps to `app/(dashboard)/clients/page.tsx`.
- Pages are mostly `'use client'` and fetch relative `/api/...`; API routes are `runtime = 'nodejs'`, some with `maxDuration = 300`.
- `lib/supabase/layout.tsx` is a stale duplicate of the root layout (it imports a non-existent `./globals.css`). Do not import it; `app/layout.tsx` is the real root layout.
- `app/test/page.tsx` is a manual smoke-test page (create client → audit → content), not an automated test.
