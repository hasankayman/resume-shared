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

## Prerequisites

- Node.js 20+
- npm 10+
- Cloudflare account with D1 and R2 enabled
- Wrangler CLI (installed via workspace dependencies)
- Resend API key (or compatible email API implementation)

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
   - `npx wrangler secret put RESEND_API_KEY --cwd apps/worker`
   - `npx wrangler secret put ADMIN_API_KEY --cwd apps/worker`
6. Upload private files to R2:
   - `resume/resume.pdf`
   - `resume/resume.docx`

## Local development

- Start Worker API:
  - `npm run dev:worker`
- Serve `apps/site` with any static server.
- In `apps/site/script.js`, set `window.RESUME_API_BASE` to your Worker URL when needed.

## Deploy

- Static site deploys from `.github/workflows/deploy-site.yml` to GitHub Pages.
- Worker deploys using:
  - `npm --workspace @resume/worker run deploy`

## Admin flow

- Request endpoint: `POST /api/request-download`
- Approve link: `GET /api/admin/approve?requestId=...&token=...`
- Reject link: `GET /api/admin/reject?requestId=...&token=...`
- Manual one-time link: `POST /api/admin/generate-link` with `Authorization: Bearer <ADMIN_API_KEY>`