# Ingestion worker

The worker uses the same parser as the browser preview. It accepts the existing archive layout:

```text
collection/school/teamName/document.docx
```

It hashes each original DOCX and each normalized card with SHA-256. Existing documents are skipped, cards are inserted once, and every distinct document occurrence is recorded in `card_sources`. PostgreSQL advisory locks make concurrent retries safe.

## Validate an archive locally

No database or storage credentials are needed:

```powershell
npm run worker:build
node dist-worker/worker/src/cli.js --dry-run C:\path\to\archive.zip
```

For direct database ingestion, set `DATABASE_URL`, then run:

```powershell
npm run ingest -- C:\path\to\archive.zip
```

## Worker request

The HTTP service exposes `GET /health` and `POST /ingest`. The ingest request may be direct JSON or a Pub/Sub push envelope whose base64 payload contains:

```json
{
  "jobId": "ingestion_jobs UUID",
  "storageKey": "archives/upload.zip",
  "archiveName": "upload.zip"
}
```

The object is downloaded from Cloudflare R2. Configure the variables in `worker/.env.example`. Run `supabase/migrations/202609220001_initial_card_library.sql` before starting database ingestion.

## Container

Build from the repository root so the Dockerfile can copy the shared parser:

```powershell
docker build -f worker/Dockerfile -t debate-wiki-worker .
```
