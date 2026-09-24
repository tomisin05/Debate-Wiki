# Local administrator ingestion

Tournament archives are processed on the administrator's computer. The local ingestion service uploads the original ZIP or DOCX to Cloudflare R2, parses it locally, removes duplicate cards, and writes the results directly to Supabase PostgreSQL. The deployed Cloud Run API is used only for public search, previews, and downloads.

## Local configuration

Set these values in the root `.env` file:

```env
VITE_API_URL=https://YOUR-API.a.run.app
VITE_LOCAL_API_URL=http://localhost:8081
VITE_ADMIN_API_URL=http://localhost:8081
DATABASE_URL=postgresql://...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=debate-archives
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_JSON={...}
ADMIN_EMAILS=admin@example.com
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
ADMIN_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

`FIREBASE_SERVICE_ACCOUNT_JSON` must contain a Firebase service account JSON object on one line. It lets the local service verify the Firebase login token. `ADMIN_EMAILS` is a comma-separated list.

Do not set `PUBSUB_TOPIC` or `WORKER_INGEST_URL` locally. The `local` service role ignores both values, but leaving them blank makes the intended setup clear.

## Start the local upload system

Open two terminals in the repository.

Terminal 1:

```bash
npm run ingest:server
```

Terminal 2:

```bash
npm run dev
```

Open `http://localhost:5173`, sign in using an address in `ADMIN_EMAILS`, and use **Add documents or ZIP**. Keep Terminal 1 open until processing completes.

The local browser sends admin requests to port `8081`. Public searches still use `VITE_API_URL`. When ingestion finishes, the cards are already in Supabase and become visible on the deployed website after refresh.

## Command line ingestion

The browser and R2 step can be skipped when desired:

```bash
npm run ingest -- "C:\\path\\to\\tournament.zip"
```

This parses the local file and writes directly to Supabase. Use `npm run ingest:dry -- "C:\\path\\to\\tournament.zip"` to validate without saving cards.

## R2 CORS

The R2 bucket must allow `PUT` from `http://localhost:5173`. The provided [r2-cors.json](../worker/r2-cors.json) contains that origin.
