# Deployment

The app is a Cloudflare Worker serving the React SPA via Workers Static Assets
plus a D1 database. CI/CD is two GitHub Actions workflows:

- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) — builds and
  deploys the Worker on push to `main`. Also applies any pending D1 migrations
  before deploying.
- [.github/workflows/refresh-data.yml](.github/workflows/refresh-data.yml) —
  weekly cron (Mon 11:00 UTC) that re-scrapes legis.la.gov / Wikipedia and
  pushes fresh SQL to remote D1. Also runnable manually with a `session` input.

## One-time setup

```bash
# 1. Authenticate Wrangler locally (you may already be logged in)
npx wrangler login

# 2. Create the remote D1 database
cd worker
npx wrangler d1 create la-vote-tracker
# Copy the returned `database_id` and replace `local-placeholder` in
# worker/wrangler.jsonc with it. Commit + push that change.

# 3. Apply schema to remote D1
npx wrangler d1 migrations apply DB --remote

# 4. Seed remote D1 from your local SQL files (one-off — afterwards the cron handles it)
npx wrangler d1 execute DB --remote --file /tmp/rosters.sql
npx wrangler d1 execute DB --remote --file /tmp/term_dates.sql
npx wrangler d1 execute DB --remote --file /tmp/bills_24RS.sql
npx wrangler d1 execute DB --remote --file /tmp/bills_26RS.sql
npx wrangler d1 execute DB --remote --file /tmp/rollcall_votes.sql
npx wrangler d1 execute DB --remote --file /tmp/wiki_terms.sql

# 5. First deploy
npm run deploy
```

That last step prints your `*.workers.dev` URL.

## GitHub secrets

The two workflows expect:

- `CLOUDFLARE_ACCOUNT_ID` — find in the Cloudflare dashboard under
  Workers & Pages → Overview.
- `CLOUDFLARE_API_TOKEN` — create one at
  https://dash.cloudflare.com/profile/api-tokens with permissions:
  - Account → Workers Scripts → Edit
  - Account → D1 → Edit
  - User → User Details → Read

Set both via `gh secret set` or the repo's Settings → Secrets and variables → Actions.

## Useful local commands

```bash
# Re-run the whole local pipeline (cache hot = fast)
cd worker
npm run scrape:rosters
npm run scrape:terms
node --experimental-strip-types scripts/scrape-bills.mjs 26RS
node --experimental-strip-types scripts/parse-rollcalls.mjs
node scripts/scrape-wiki-terms.mjs
npx wrangler d1 execute DB --local --file /tmp/rollcall_votes.sql
npx wrangler d1 execute DB --local --file /tmp/wiki_terms.sql

# Reset local D1 and re-seed
npm run db:reset:local
```

## Costs

Everything fits on Cloudflare's free tier for civic-scale traffic:

- Workers: 100k requests/day free
- D1: 5 GB storage, 5M rows read/day, 100k writes/day free. We have ~355k votes
  and write ~thousands per refresh.
- Workers Static Assets: bundled with Workers free tier.
- Custom domain: free if the DNS is already on a Cloudflare zone.

The scheduled refresh runs in GitHub Actions, not on Cloudflare — so heavy
PDF parsing and ~5,000 outbound HTTP requests live in CI, not in the Worker.
