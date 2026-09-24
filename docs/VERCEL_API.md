# Vercel frontend and public API

The Vercel project hosts both the Vite frontend and the public API functions:

- `GET /api/cards`
- `GET /api/filters`
- `GET /api/cards/:id`
- `GET /api/cards/:id/download`

The production frontend calls these same-origin paths directly. `VITE_API_URL` is no longer required in Vercel.

## Environment variables

Add the following under **Vercel Project → Settings → Environment Variables** for Production and Preview:

```text
DATABASE_URL
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
```

Use the Supabase **Transaction pooler** connection string for `DATABASE_URL`. Find it in **Supabase Dashboard → Connect → Transaction pooler**. It normally uses port `6543` and is intended for serverless functions.

The R2 variables are needed only by the card DOCX download function. Search and previews use PostgreSQL.

Keep the existing `VITE_FIREBASE_*` variables required by the frontend login. Remove `VITE_API_URL` from Vercel after the new deployment succeeds.

## Deploy

Commit and push the repository. Vercel automatically detects the root `api` directory and deploys each TypeScript file as a Node.js Function alongside the Vite build.

After deployment, verify:

```text
https://debate-wiki.vercel.app/api/filters
https://debate-wiki.vercel.app/api/cards?limit=1
```

Then open the website, search, preview a card, and download its DOCX.

## Local operation

Local development continues to use `http://localhost:8081` for both search and ingestion:

```powershell
npm run ingest:server
npm run dev
```

The local `.env` retains the direct database connection because the local service is a persistent process. The Vercel `DATABASE_URL` should use the transaction pooler connection instead.
