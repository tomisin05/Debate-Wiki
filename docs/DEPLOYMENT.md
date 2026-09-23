# Deploy the API and worker to Google Cloud Run

This project deploys one container image as two services:

- `debate-wiki-api` is public and serves search plus authenticated administrator upload routes.
- `debate-wiki-worker` is private and accepts ingestion requests only from Pub/Sub.

Use the Google Cloud project behind the existing Firebase project. This lets the API verify the same Firebase users that sign in to the web application.

## 1. Open Cloud Shell

Open the Firebase project in Google Cloud Console, activate Cloud Shell, and clone or upload this repository. Run all following commands from the repository root.

Set the deployment variables. Replace the first two values:

```bash
export PROJECT_ID="YOUR_FIREBASE_PROJECT_ID"
export REGION="us-east1"
export WEB_ORIGIN="https://debate-wiki.vercel.app"
export REPOSITORY="debate-wiki"
export API_SERVICE="debate-wiki-api"
export WORKER_SERVICE="debate-wiki-worker"
export TOPIC="debate-ingestion"

gcloud config set project "$PROJECT_ID"
```

Enable the required services:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  pubsub.googleapis.com
```

Billing must be enabled on the project before Google Cloud can activate these services.

## 2. Create the image repository and build

```bash
gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Debate Wiki containers"

export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/server:$(date +%Y%m%d-%H%M%S)"

gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}" \
  .
```

If the repository already exists, skip its creation command.

## 3. Add production secrets

In Google Cloud Console, open **Security → Secret Manager** and create these secrets. Copy the values from the local `.env`; never commit them.

| Secret name                   | Local variable         |
| ----------------------------- | ---------------------- |
| `debate-database-url`         | `DATABASE_URL`         |
| `debate-r2-account-id`        | `R2_ACCOUNT_ID`        |
| `debate-r2-access-key-id`     | `R2_ACCESS_KEY_ID`     |
| `debate-r2-secret-access-key` | `R2_SECRET_ACCESS_KEY` |
| `debate-r2-bucket`            | `R2_BUCKET`            |
| `debate-admin-emails`         | `ADMIN_EMAILS`         |

Create service identities:

```bash
gcloud iam service-accounts create debate-api \
  --display-name="Debate Wiki API"

gcloud iam service-accounts create debate-worker \
  --display-name="Debate Wiki Worker"

gcloud iam service-accounts create debate-pubsub-invoker \
  --display-name="Debate Wiki PubSub Invoker"

export API_SA="debate-api@${PROJECT_ID}.iam.gserviceaccount.com"
export WORKER_SA="debate-worker@${PROJECT_ID}.iam.gserviceaccount.com"
export PUSH_SA="debate-pubsub-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
```

Give the API and worker access to their secrets:

```bash
for SECRET in debate-database-url debate-r2-account-id debate-r2-access-key-id debate-r2-secret-access-key debate-r2-bucket; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${API_SA}" \
    --role="roles/secretmanager.secretAccessor"
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${WORKER_SA}" \
    --role="roles/secretmanager.secretAccessor"
done

gcloud secrets add-iam-policy-binding debate-admin-emails \
  --member="serviceAccount:${API_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

## 4. Create Pub/Sub

```bash
gcloud pubsub topics create "$TOPIC"

gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:${API_SA}" \
  --role="roles/pubsub.publisher"
```

## 5. Deploy the public API

```bash
gcloud run deploy "$API_SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$API_SA" \
  --allow-unauthenticated \
  --memory=512Mi \
  --concurrency=40 \
  --set-env-vars="SERVICE_ROLE=api,CORS_ORIGIN=${WEB_ORIGIN},FIREBASE_PROJECT_ID=${PROJECT_ID},PUBSUB_TOPIC=${TOPIC}" \
  --set-secrets="DATABASE_URL=debate-database-url:latest,R2_ACCOUNT_ID=debate-r2-account-id:latest,R2_ACCESS_KEY_ID=debate-r2-access-key-id:latest,R2_SECRET_ACCESS_KEY=debate-r2-secret-access-key:latest,R2_BUCKET=debate-r2-bucket:latest,ADMIN_EMAILS=debate-admin-emails:latest"

export API_URL="$(gcloud run services describe "$API_SERVICE" --region="$REGION" --format='value(status.url)')"
echo "$API_URL"
```

## 6. Deploy the private worker

```bash
gcloud run deploy "$WORKER_SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$WORKER_SA" \
  --no-allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=1 \
  --timeout=600 \
  --max-instances=3 \
  --set-env-vars="SERVICE_ROLE=worker" \
  --set-secrets="DATABASE_URL=debate-database-url:latest,R2_ACCOUNT_ID=debate-r2-account-id:latest,R2_ACCESS_KEY_ID=debate-r2-access-key-id:latest,R2_SECRET_ACCESS_KEY=debate-r2-secret-access-key:latest,R2_BUCKET=debate-r2-bucket:latest"

export WORKER_URL="$(gcloud run services describe "$WORKER_SERVICE" --region="$REGION" --format='value(status.url)')"
echo "$WORKER_URL"
```

## 7. Connect Pub/Sub to the private worker

Permit the push identity to invoke only the worker:

```bash
gcloud run services add-iam-policy-binding "$WORKER_SERVICE" \
  --region="$REGION" \
  --member="serviceAccount:${PUSH_SA}" \
  --role="roles/run.invoker"
```

Allow the Pub/Sub service agent to mint the push identity token:

```bash
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Create the authenticated push subscription:

```bash
gcloud pubsub subscriptions create debate-ingestion-push \
  --topic="$TOPIC" \
  --push-endpoint="${WORKER_URL}/ingest" \
  --push-auth-service-account="$PUSH_SA" \
  --push-auth-token-audience="$WORKER_URL" \
  --ack-deadline=600
```

## 8. Verify the API

```bash
curl "${API_URL}/health"
curl "${API_URL}/api/cards?q=climate&limit=1"
curl -i -X POST "${API_URL}/ingest"
```

The health and search requests should return `200`. The public API's `/ingest` request should return `404`.

## 9. Connect Vercel

In Vercel, open **Project → Settings → Environment Variables** and add:

```text
API_URL = the API_URL printed above
```

Add it to Production and Preview as appropriate, then redeploy. Vite reads this value at build time, so changing it does not affect an existing deployment.

In Firebase Console, confirm `debate-wiki.vercel.app` is listed under **Authentication → Settings → Authorized domains**.

## 10. Production test

1. Open `https://debate-wiki.vercel.app` and sign in with an email in `ADMIN_EMAILS`.
2. Confirm database cards appear and search works.
3. Upload a ZIP with the **Add documents or ZIP** button.
4. Wait for the progress notification to finish.
5. Search for a card unique to the new archive.
6. Check Cloud Run logs for either service if the interface reports an error.

Useful log commands:

```bash
gcloud run services logs read "$API_SERVICE" --region="$REGION" --limit=100
gcloud run services logs read "$WORKER_SERVICE" --region="$REGION" --limit=100
```
