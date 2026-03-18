# Resume Share Portal

This project gives you a public HTML resume and a gated download flow for PDF/DOCX files.

## Workspace layout

- `apps/site`: static resume page for GitHub Pages.
- `apps/worker`: Cloudflare Worker API for request, approval, and one-time download links.

## What it does

- Recruiters can request your resume file from the public page.
- You receive an approval email.
- After approval, the recruiter receives a one-time download link.
- You can also create a one-time link directly from an admin API endpoint.
- You can generate manual links from a protected admin page using Google sign-in.

## Prerequisites

- Node.js 20+
- npm 10+
- Cloudflare account with D1 and R2 enabled
- Wrangler CLI (installed via workspace dependencies)
- Google account that will send emails (for this setup: `hasankayman@gmail.com`)
- Google Cloud project with Gmail API enabled

## Setup

1. Install dependencies:
   - `npm install`
2. Create Cloudflare resources:
   - D1 database
   - R2 bucket for private files
3. Update `apps/worker/wrangler.toml` with real values.
4. Apply migration:
   - `npm --workspace @resume/worker run migrate`
5. Set Worker secrets:
   - `npx wrangler secret put ADMIN_EMAIL --cwd apps/worker`
   - `npx wrangler secret put FROM_EMAIL --cwd apps/worker`
   - `npx wrangler secret put ADMIN_GOOGLE_EMAIL --cwd apps/worker`
   - `npx wrangler secret put GMAIL_CLIENT_ID --cwd apps/worker`
   - `npx wrangler secret put GMAIL_CLIENT_SECRET --cwd apps/worker`
   - `npx wrangler secret put GMAIL_REFRESH_TOKEN --cwd apps/worker`
   - `npx wrangler secret put GMAIL_SENDER_EMAIL --cwd apps/worker` (optional; defaults to `FROM_EMAIL`)
   - `npx wrangler secret put ADMIN_API_KEY --cwd apps/worker`
   - Security note: Do not store `ADMIN_EMAIL`, `FROM_EMAIL`, or `ADMIN_GOOGLE_EMAIL` under `[vars]` in `apps/worker/wrangler.toml`; set them only with `wrangler secret put`.
   - Backward compatibility: `RESEND_API_KEY` is optional and only used if Gmail secrets are not configured.
6. Upload private files to R2:
   - `resume/resume.pdf`
   - `resume/resume.docx`
7. Configure Google OAuth for admin page:
   - Create a Google OAuth Client ID for a Web application.
   - Add Authorized JavaScript origins:
     - `https://hasankayman.github.io`
     - `http://localhost:4173`
   - Set `GOOGLE_CLIENT_ID` in `apps/worker/wrangler.toml`.
   - Set the same value in `apps/site/admin.html` (`window.ADMIN_CONFIG.googleClientId`).

## Local development

- Start Worker API:
  - `npm run dev:worker`
- Serve `apps/site` with any static server.
- In `apps/site/script.js`, set `window.RESUME_API_BASE` to your Worker URL when needed.
- Open admin page at `/admin.html` for manual link generation.

## Deploy

- Static site deploys from `.github/workflows/deploy-site.yml` to GitHub Pages.
- Worker deploys using:
  - `npm --workspace @resume/worker run deploy`

## Option B: Gmail API (no custom domain) — step by step

Use this path to send approval/download emails directly from `hasankayman@gmail.com` without buying a domain.

1. Create/choose a Google Cloud project.
2. Enable Gmail API in that project.
3. Configure OAuth consent screen:
   - User type: External.
   - Add `hasankayman@gmail.com` as a test user while app is in testing mode.
4. Create OAuth client credentials (Desktop app recommended for token bootstrap).
   - Save the client ID and client secret.
5. Generate a refresh token for `https://www.googleapis.com/auth/gmail.send`:
   - Open OAuth 2.0 Playground.
   - In settings, enable “Use your own OAuth credentials” and paste your client ID/secret.
   - Authorize scope `https://www.googleapis.com/auth/gmail.send` with `hasankayman@gmail.com`.
   - Exchange code for tokens and copy the `refresh_token`.
6. Set Worker secrets with real values:
   - `npx wrangler secret put ADMIN_EMAIL --cwd apps/worker` → `hasankayman@gmail.com`
   - `npx wrangler secret put FROM_EMAIL --cwd apps/worker` → `hasankayman@gmail.com`
   - `npx wrangler secret put ADMIN_GOOGLE_EMAIL --cwd apps/worker` → `hasankayman@gmail.com`
   - `npx wrangler secret put GMAIL_CLIENT_ID --cwd apps/worker`
   - `npx wrangler secret put GMAIL_CLIENT_SECRET --cwd apps/worker`
   - `npx wrangler secret put GMAIL_REFRESH_TOKEN --cwd apps/worker`
   - `npx wrangler secret put GMAIL_SENDER_EMAIL --cwd apps/worker` → `hasankayman@gmail.com` (optional)
7. Deploy the Worker:
   - `npm --workspace @resume/worker run deploy`
8. Verify:
   - Submit a test request from the public page.
   - Confirm admin approval email arrives at `hasankayman@gmail.com`.
   - Approve request and confirm requester receives one-time download email.

If Gmail secrets are present, the Worker uses Gmail API first. If not, it falls back to `RESEND_API_KEY` when available.

## Admin flow

- Request endpoint: `POST /api/request-download`
- Approve link: `GET /api/admin/approve?requestId=...&token=...`
- Reject link: `GET /api/admin/reject?requestId=...&token=...`
- Manual one-time link API: `POST /api/admin/generate-link`
   - Authorization supports either:
      - `Bearer <ADMIN_API_KEY>`
      - `Bearer <Google ID Token>` for the configured `ADMIN_GOOGLE_EMAIL`
- Protected admin UI: `apps/site/admin.html` (Google sign-in required before generating links)