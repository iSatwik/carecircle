#!/usr/bin/env bash
# One-command deploy of CareCircle to Google Cloud Run.
# Run it in Google Cloud Shell (https://shell.cloud.google.com) from the repo folder:
#   bash deploy.sh
# It enables the Google APIs, creates Firestore, creates a Gemini API key,
# deploys to Cloud Run and prints the live URL. Safe to run again.
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-carecircle}"
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "No project selected. Run: gcloud config set project YOUR_PROJECT_ID  (see: gcloud projects list)"
  exit 1
fi
echo "==> Project: $PROJECT_ID   Region: $REGION   Service: $SERVICE"

echo "==> Enabling Google APIs (Cloud Run, Build, Firestore, Gemini, Text-to-Speech, Scheduler)..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com generativelanguage.googleapis.com texttospeech.googleapis.com \
  apikeys.googleapis.com cloudscheduler.googleapis.com --project "$PROJECT_ID" || exit 1

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "==> Granting the Cloud Run service account access to Firestore and builds..."
for ROLE in roles/datastore.user roles/cloudbuild.builds.builder roles/logging.logWriter roles/artifactregistry.writer roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${RUN_SA}" --role="$ROLE" --condition=None --quiet >/dev/null 2>&1 || true
done

STORE="firestore"
if ! gcloud firestore databases describe --database="(default)" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "==> Creating Firestore database..."
  if ! gcloud firestore databases create --location="$REGION" --project "$PROJECT_ID" --quiet; then
    echo "!! Could not create Firestore. Continuing with the in-memory store so the app still works."
    STORE="memory"
  fi
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "==> Creating a Gemini API key (restricted to the Gemini API)..."
  KEY_JSON="$(gcloud services api-keys create --display-name="carecircle-gemini" \
    --api-target=service=generativelanguage.googleapis.com --project "$PROJECT_ID" --format=json 2>/dev/null)"
  KEY_NAME="$(printf '%s' "$KEY_JSON" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d.get("response") or d).get("name",""))
except Exception: print("")')"
  if [ -n "$KEY_NAME" ]; then
    GEMINI_API_KEY="$(gcloud services api-keys get-key-string "$KEY_NAME" --format='value(keyString)' 2>/dev/null)"
  fi
  [ -z "${GEMINI_API_KEY:-}" ] && echo "!! Gemini key not created. AI features will use the built-in fallback text."
fi

echo
echo "==> Email reminders use Gmail. Create an App Password at https://myaccount.google.com/apppasswords"
read -r -p "Gmail address to send from (press Enter to skip email): " SMTP_USER
SMTP_PASS=""
if [ -n "$SMTP_USER" ]; then
  read -r -s -p "16-character App Password (input hidden): " SMTP_PASS; echo
  SMTP_PASS="${SMTP_PASS// /}"
fi

JWT_SECRET="$(openssl rand -hex 32)"
CRON_SECRET="$(openssl rand -hex 24)"
ENV_FILE="$(mktemp)"
cat > "$ENV_FILE" <<EOF
NODE_ENV: "production"
STORE: "${STORE}"
JWT_SECRET: "${JWT_SECRET}"
CRON_SECRET: "${CRON_SECRET}"
DEFAULT_TIMEZONE: "Asia/Kolkata"
GEMINI_API_KEY: "${GEMINI_API_KEY:-}"
TTS_ENABLED: "true"
SMTP_HOST: "smtp.gmail.com"
SMTP_PORT: "465"
SMTP_SECURE: "true"
SMTP_USER: "${SMTP_USER}"
SMTP_PASS: "${SMTP_PASS}"
MAIL_FROM: "CareCircle <${SMTP_USER}>"
EOF

echo "==> Building and deploying to Cloud Run (takes 3-5 minutes)..."
gcloud run deploy "$SERVICE" --source . --region "$REGION" --project "$PROJECT_ID" \
  --allow-unauthenticated --min-instances 1 --no-cpu-throttling --memory 512Mi \
  --env-vars-file "$ENV_FILE" --quiet || { rm -f "$ENV_FILE"; exit 1; }
rm -f "$ENV_FILE"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"
gcloud run services update "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --update-env-vars "PUBLIC_URL=${URL}" --quiet >/dev/null

echo "==> Scheduling reminder checks every 5 minutes (Cloud Scheduler)..."
gcloud scheduler jobs create http "${SERVICE}-tick" --location "$REGION" --project "$PROJECT_ID" \
  --schedule "*/5 * * * *" --uri "${URL}/api/cron/tick" --http-method POST \
  --headers "X-Cron-Secret=${CRON_SECRET}" --quiet >/dev/null 2>&1 \
  || gcloud scheduler jobs update http "${SERVICE}-tick" --location "$REGION" --project "$PROJECT_ID" \
     --schedule "*/5 * * * *" --uri "${URL}/api/cron/tick" --http-method POST \
     --update-headers "X-Cron-Secret=${CRON_SECRET}" --quiet >/dev/null 2>&1 || true

echo
echo "==> Health check: $(curl -s "${URL}/healthz")"
echo "==> Features: $(curl -s "${URL}/api/config")"
echo
echo "============================================================"
echo " CareCircle is live: ${URL}"
echo "============================================================"
