# Host Blanko on Google Cloud Run

Project used in dogfood: `somo-callsomo` (override with `gcloud config set project …`).

## One-shot deploy

From repo root (uses `webapp/client/.env` + `webapp/server/.env` for Vite build args and runtime secrets — values are not printed):

```bash
gcloud auth login
gcloud config set project somo-callsomo
chmod +x scripts/deploy-blanko-cloud-run.sh
./scripts/deploy-blanko-cloud-run.sh
```

Script will:

1. Enable Cloud Run, Artifact Registry, Cloud Build APIs  
2. Create `blanko` Docker repo in `us-central1` (if missing)  
3. `gcloud builds submit` via [`cloudbuild.yaml`](../../cloudbuild.yaml)  
4. Deploy service `blanko` (allow unauthenticated)  
5. Set `APP_URL` to the `*.run.app` URL  
6. Curl `/health`

## Browser 403 on `*.run.app`

Somo org policy **blocks** `allUsers` / `allAuthenticatedUsers` as Cloud Run invokers. Opening  
https://blanko-xrrr4znsoa-uc.a.run.app in a normal browser will always show **Error: Forbidden** unless that policy is changed.

### Fix A — Org admin (keeps this URL)

Ask GCP org admin to allow public Cloud Run invokers (or an exception for `blanko`), then:

```bash
gcloud run services add-iam-policy-binding blanko \
  --region=us-central1 \
  --member=allUsers \
  --role=roles/run.invoker \
  --project=somo-callsomo
```

### Fix B — Firebase Hosting front door (public URL, different host)

Repo already has `firebase.json` + `.firebaserc` rewriting `**` → Cloud Run `blanko`. On your machine:

```bash
firebase login --reauth
firebase use somo-callsomo
# After first Hosting deploy, grant the Firebase Hosting SA (email shown in deploy output):
# gcloud run services add-iam-policy-binding blanko --region=us-central1 \
#   --member='serviceAccount:service-710886835273@gcp-sa-firebasehosting.iam.gserviceaccount.com' \
#   --role=roles/run.invoker --project=somo-callsomo
firebase deploy --only hosting
```

Then set Supabase Auth Site URL to the `*.web.app` / `*.firebaseapp.com` URL and share **that** with testers.

Default compute SA already has invoker on `blanko`.

## Org policy note (`somo-callsomo`)

This org **blocks** `allUsers` / `allAuthenticatedUsers` as Cloud Run invokers. Public unauthenticated URLs will return **403**.

Grant each tester’s Google account:

```bash
gcloud run services add-iam-policy-binding blanko \
  --region=us-central1 \
  --member='user:TESTER@their-domain.com' \
  --role=roles/run.invoker \
  --project=somo-callsomo
```

They must open the app while signed into that Google account (or use a browser profile that can obtain a Cloud Run identity). For a truly public demo, deploy to a **personal GCP project** without that org constraint, or ask the org admin to allow `allUsers` on Cloud Run.

Health check (authenticated):

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://blanko-xrrr4znsoa-uc.a.run.app/health
```

## After deploy

1. Supabase → Authentication → URL configuration  
   - Site URL = Cloud Run URL  
   - Redirect URLs include `https://YOUR-SERVICE-….run.app/**`  
2. Send the tester the Cloud Run URL  
3. Optional: Stripe / GitHub webhook endpoints → `https://…/api/billing/webhook` and `https://…/api/webhooks/github`

## Files

| File | Role |
|------|------|
| [Dockerfile](../../Dockerfile) | Image |
| [cloudbuild.yaml](../../cloudbuild.yaml) | Build + push to Artifact Registry |
| [scripts/deploy-blanko-cloud-run.sh](../../scripts/deploy-blanko-cloud-run.sh) | End-to-end deploy |

## Notes

- Min instances `0` = cheaper; first request after idle may be slow (~cold start). Set `--min-instances=1` in the script for snappier tester UX.  
- Do not set `CHAT_DEV_BYPASS` or `BILLING_DEV_UNLIMITED` on Cloud Run.  
- Disk is ephemeral; clone/scan data does not survive revisions.
