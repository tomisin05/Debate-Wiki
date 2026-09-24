# Legacy Google Cloud deployment

The active deployment approach is now Vercel Functions. See [VERCEL_API.md](./VERCEL_API.md). The instructions below are retained only while the old Cloud Run resources are being removed.

Only the search and download API runs in Cloud Run. Archive ingestion runs locally; no Cloud Run worker or Pub/Sub subscription is required.

## Build the image

From Google Cloud Shell:

```bash
export PROJECT_ID="debate-wiki-3d7c0"
export REGION="us-east1"
export REPOSITORY="debate-wiki"
export API_SERVICE="debate-wiki-api"
export WEB_ORIGIN="https://debate-wiki.vercel.app"

gcloud config set project "$PROJECT_ID"

export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/server:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}" \
  .
```

## Deploy the API

The API needs only the database connection. It reconstructs downloadable card DOCX files from data stored in PostgreSQL.

```bash
export API_SA="debate-api@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud run deploy "$API_SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$API_SA" \
  --allow-unauthenticated \
  --memory=512Mi \
  --concurrency=40 \
  --set-env-vars="SERVICE_ROLE=api,CORS_ORIGIN=${WEB_ORIGIN}" \
  --set-secrets="DATABASE_URL=debate-database-url:latest"
```

Verify it:

```bash
export API_URL="$(gcloud run services describe "$API_SERVICE" --region="$REGION" --format='value(status.url)')"
curl "${API_URL}/health"
curl "${API_URL}/api/cards?q=climate&limit=1"
```

Set Vercel's `VITE_API_URL` environment variable to the printed API URL and redeploy the frontend.

## Remove the old cloud worker

After the local ingestion flow has been tested, delete the unused resources:

```bash
gcloud run services delete debate-wiki-worker --region="$REGION"
gcloud pubsub subscriptions delete debate-ingestion-push
gcloud pubsub topics delete debate-ingestion
```

Google Cloud asks for confirmation before each deletion. The public API, Artifact Registry image, Supabase database, and Cloudflare R2 bucket are unaffected.

## Local ingestion

Local setup and operating instructions are in [ADMIN_UPLOADS.md](./ADMIN_UPLOADS.md).
