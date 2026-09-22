# Persistent administrator uploads

The browser uploads archives directly to Cloudflare R2 with a 15 minute signed URL. The API never receives the archive bytes. After upload, the API queues the existing ingestion worker and the browser polls `ingestion_jobs` for progress.

## Required configuration

Add these values to `.env` for local development and to the deployed service's secret configuration:

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=debate-archives
ADMIN_EMAILS=admin@example.com
FIREBASE_PROJECT_ID=your-firebase-project-id
```

`ADMIN_EMAILS` accepts a comma-separated list. A Firebase user is also accepted when its ID token has the custom claim `admin: true`.

Apply [worker/r2-cors.json](../worker/r2-cors.json) to the R2 bucket after replacing `YOUR-WEB-APP-DOMAIN`. The bucket must allow `PUT` from the web application origin.

R2 object read/write credentials can generate signed URLs but may not have permission to change bucket CORS. Apply the policy in the Cloudflare dashboard under **R2 → bucket → Settings → CORS Policy**, or use a Cloudflare token with bucket administration permission.

## Production queue

For production, set:

```env
PUBSUB_TOPIC=debate-ingestion
SERVICE_ROLE=api
```

Create a push subscription from that topic to the worker's `/ingest` endpoint and use a service account with Cloud Run invoker permission. Cloud Run verifies the subscription's OIDC token. Leave `WORKER_SHARED_SECRET` empty in this configuration.

Deploy the worker from the same image with `SERVICE_ROLE=worker`, no public access, and no `PUBSUB_TOPIC`. The role switch prevents the public API service from exposing `/ingest`.

For a separate worker without Pub/Sub, configure:

```env
WORKER_INGEST_URL=https://worker.example.com/ingest
WORKER_SHARED_SECRET=a-long-random-secret
```

When neither option is present, local development processes the archive synchronously in the API service.

## API routes

- `POST /api/admin/uploads/presign` creates the ingestion job and signed R2 upload URL.
- `POST /api/admin/uploads/{jobId}/complete` dispatches ingestion after the upload succeeds.
- `GET /api/admin/jobs/{jobId}` returns live progress and final totals.
- `GET /api/admin/jobs` returns recent ingestion jobs.

All `/api/admin/*` routes require a Firebase ID token and administrator access.
