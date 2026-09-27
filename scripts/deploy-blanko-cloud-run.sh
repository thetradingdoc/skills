#!/usr/bin/env bash
# Deploy Blanko to Cloud Run (project: current gcloud config).
# Loads Vite + server secrets from webapp/client/.env and webapp/server/.env — does not print them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-blanko}"
REPO="${REPO:-blanko}"
PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
  echo "Set a project: gcloud config set project YOUR_ID" >&2
  exit 1
fi

# Load KEY=VALUE lines safely (no shell eval; supports optional export prefix and quotes).
load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*export[[:space:]]+ ]]; then
      line="${line#*export}"
      line="${line#"${line%%[![:space:]]*}"}"
    fi
    [[ "$line" == *=* ]] || continue
    local key="${line%%=*}"
    local val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    # Strip surrounding single/double quotes
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
    if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    printf -v "$key" '%s' "$val"
    export "$key"
  done <"$file"
}

load_env_file webapp/client/.env
load_env_file webapp/server/.env

: "${VITE_SUPABASE_URL:?Set VITE_SUPABASE_URL in webapp/client/.env}"
: "${VITE_SUPABASE_ANON_KEY:?Set VITE_SUPABASE_ANON_KEY in webapp/client/.env}"
: "${SUPABASE_URL:?Set SUPABASE_URL in webapp/server/.env}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY in webapp/server/.env}"

# Never ship local billing unlock to Cloud Run
unset BILLING_DEV_UNLIMITED CHAT_DEV_BYPASS || true

IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}"
TAG="$(git rev-parse --short HEAD 2>/dev/null || echo latest)"

echo "==> Project=$PROJECT Region=$REGION Service=$SERVICE"
echo "==> Enabling APIs…"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project="$PROJECT"

echo "==> Artifact Registry repo (idempotent)…"
if ! gcloud artifacts repositories describe "$REPO" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Blanko container images" \
    --project="$PROJECT"
fi

# Generate a one-off cloudbuild config so secrets aren't mangled by --substitutions CSV rules.
GEN="$(mktemp -t blanko-cloudbuild.XXXXXX.yaml)"
cleanup() { rm -f "$GEN"; }
trap cleanup EXIT

# YAML double-quoted strings: escape \ and "
escape_yaml() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

VITE_URL_E="$(escape_yaml "$VITE_SUPABASE_URL")"
VITE_ANON_E="$(escape_yaml "$VITE_SUPABASE_ANON_KEY")"
VITE_STRIPE_E="$(escape_yaml "${VITE_STRIPE_PUBLISHABLE_KEY:-}")"

cat >"$GEN" <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --build-arg
      - VITE_SUPABASE_URL=${VITE_URL_E}
      - --build-arg
      - VITE_SUPABASE_ANON_KEY=${VITE_ANON_E}
      - --build-arg
      - VITE_STRIPE_PUBLISHABLE_KEY=${VITE_STRIPE_E}
      - -t
      - ${IMAGE}:${TAG}
      - -t
      - ${IMAGE}:latest
      - .
  - name: gcr.io/cloud-builders/docker
    args: ["push", "--all-tags", "${IMAGE}"]
images:
  - ${IMAGE}:${TAG}
  - ${IMAGE}:latest
options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8
timeout: 1800s
EOF

echo "==> Cloud Build (Dockerfile)…"
gcloud builds submit --config="$GEN" --project="$PROJECT"

# Env file for gcloud (avoids comma/equals issues in --set-env-vars)
ENV_FILE="$(mktemp -t blanko-run-env.XXXXXX.yaml)"
trap 'rm -f "$GEN" "$ENV_FILE"' EXIT

{
  echo "NODE_ENV: \"production\""
  echo "SUPABASE_URL: \"$(escape_yaml "$SUPABASE_URL")\""
  echo "SUPABASE_SERVICE_ROLE_KEY: \"$(escape_yaml "$SUPABASE_SERVICE_ROLE_KEY")\""
  echo "APP_URL: \"https://placeholder.invalid\""
  echo "CLIENT_DIST_PATH: \"/app/webapp/client/dist\""
  echo "PROJECT_ROOT: \"/app\""
  [[ -n "${STRIPE_SECRET_KEY:-}" ]] && echo "STRIPE_SECRET_KEY: \"$(escape_yaml "$STRIPE_SECRET_KEY")\""
  [[ -n "${STRIPE_WEBHOOK_SECRET:-}" ]] && echo "STRIPE_WEBHOOK_SECRET: \"$(escape_yaml "$STRIPE_WEBHOOK_SECRET")\""
  [[ -n "${STRIPE_PRICE_PRO:-}" ]] && echo "STRIPE_PRICE_PRO: \"$(escape_yaml "$STRIPE_PRICE_PRO")\""
  [[ -n "${STRIPE_PRICE_TEAM:-}" ]] && echo "STRIPE_PRICE_TEAM: \"$(escape_yaml "$STRIPE_PRICE_TEAM")\""
  [[ -n "${OPENAI_API_KEY:-}" ]] && echo "OPENAI_API_KEY: \"$(escape_yaml "$OPENAI_API_KEY")\""
  [[ -n "${ANTHROPIC_API_KEY:-}" ]] && echo "ANTHROPIC_API_KEY: \"$(escape_yaml "$ANTHROPIC_API_KEY")\""
} >"$ENV_FILE"

echo "==> Cloud Run deploy…"
gcloud run deploy "$SERVICE" \
  --image="${IMAGE}:latest" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=300 \
  --env-vars-file="$ENV_FILE" \
  --project="$PROJECT"

RUN_URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" --format='value(status.url)')"
echo "==> Service URL: $RUN_URL"

echo "==> Setting APP_URL to service URL…"
gcloud run services update "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT" \
  --update-env-vars="APP_URL=${RUN_URL}"

echo "==> Health:"
curl -fsS "${RUN_URL}/health" || true
echo
echo "Done. Next: Supabase Auth → Site URL + Redirect URLs = ${RUN_URL}"
echo "Share with tester: ${RUN_URL}"
