This is a lightweight viewer for GitHub Reporter artifacts, bootstrapped with `create-next-app`.

## Setup

1. Copy `.env.example` to `.env.local` and fill in values.
2. Install deps: `npm install`

Then run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to see the viewer.

## Notes

- The viewer always uses the private proxy API (`/api/reports/...`) so credentials stay server-side.
- Make sure your bucket contains `reports/_index/{ownerType}/{owner}/jobs.json` plus job indices under `reports/_index/{ownerType}/{owner}/{jobId}/`.
- Environment variables are validated on server startup; missing values will return a 500 error with a clear message.
- The viewer will also read the repo root `.env` and fall back to `BUCKET_*`/`GITHUB_*`/`OUTPUT_*` values if `R2_*`/`NEXT_PUBLIC_*` are not set.
- Set `NEXT_PUBLIC_OWNER_OPTIONS` (comma-separated `org:owner` or `user:owner`) to enable an owner dropdown in the UI.
