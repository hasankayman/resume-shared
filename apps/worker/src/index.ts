type ResumeFormat = "pdf" | "docx";

interface Env {
    DB: D1Database;
    RESUME_FILES?: R2Bucket;
    ADMIN_EMAIL: string;
    FROM_EMAIL: string;
    PUBLIC_SITE_URL: string;
    ADMIN_BASE_URL: string;
    RESEND_API_KEY: string;
    ADMIN_API_KEY: string;
    ADMIN_GOOGLE_EMAIL?: string;
    GOOGLE_CLIENT_ID?: string;
}

interface RequestRow {
    id: string;
    requester_name: string;
    requester_email: string;
    requested_format: ResumeFormat;
    status: "pending" | "approved" | "rejected";
}

interface DownloadTokenRow {
    id: string;
    file_format: ResumeFormat;
    expires_at: string;
    max_uses: number;
    use_count: number;
}

interface GoogleTokenInfo {
    aud?: string;
    email?: string;
    email_verified?: string | boolean;
    exp?: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getCorsHeaders(request?: Request): HeadersInit {
    const origin = request?.headers.get("Origin") ?? "*";
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
}

function jsonResponse(payload: unknown, status = 200, request?: Request): Response {
    const headers = new Headers(getCorsHeaders(request));
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(payload), { status, headers });
}

function htmlResponse(html: string, status = 200): Response {
    return new Response(html, {
        status,
        headers: {
            "Content-Type": "text/html; charset=utf-8"
        }
    });
}

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

function resolveBaseUrl(env: Env, requestUrl: URL): string {
    const configuredBaseUrl = String(env.ADMIN_BASE_URL || "").trim();
    if (!configuredBaseUrl || configuredBaseUrl.includes("YOUR_SUBDOMAIN")) {
        return normalizeBaseUrl(requestUrl.origin);
    }

    return normalizeBaseUrl(configuredBaseUrl);
}

function sanitize(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function toFormat(value: string): ResumeFormat | null {
    if (value === "pdf" || value === "docx") {
        return value;
    }
    return null;
}

function isValidEmail(value: string): boolean {
    return emailPattern.test(value);
}

function randomToken(byteLength = 24): string {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function sha256Hex(value: string): Promise<string> {
    const input = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function getObjectKey(format: ResumeFormat): string {
    return format === "pdf" ? "resume/resume.pdf" : "resume/resume.docx";
}

function nowIso(): string {
    return new Date().toISOString();
}

function hasRealValue(value: string | undefined, placeholder: string): boolean {
    const normalized = String(value || "").trim();
    return Boolean(normalized) && !normalized.includes(placeholder);
}

async function isValidGoogleAdminToken(env: Env, token: string): Promise<boolean> {
    const adminGoogleEmail = String(env.ADMIN_GOOGLE_EMAIL || "").trim().toLowerCase();
    if (!adminGoogleEmail) {
        return false;
    }

    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (!response.ok) {
        return false;
    }

    const tokenInfo = (await response.json()) as GoogleTokenInfo;
    const isEmailVerified = tokenInfo.email_verified === true || tokenInfo.email_verified === "true";
    const tokenEmail = String(tokenInfo.email || "").trim().toLowerCase();

    if (!isEmailVerified || !tokenEmail || tokenEmail !== adminGoogleEmail) {
        return false;
    }

    if (tokenInfo.exp && Number(tokenInfo.exp) * 1000 <= Date.now()) {
        return false;
    }

    if (hasRealValue(env.GOOGLE_CLIENT_ID, "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID")) {
        return tokenInfo.aud === String(env.GOOGLE_CLIENT_ID).trim();
    }

    return true;
}

async function isAuthorizedAdmin(request: Request, env: Env): Promise<boolean> {
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
        return false;
    }

    const token = authorization.slice("Bearer ".length).trim();
    if (!token) {
        return false;
    }

    if (env.ADMIN_API_KEY && token === env.ADMIN_API_KEY) {
        return true;
    }

    return await isValidGoogleAdminToken(env, token);
}

async function sendEmail(env: Env, params: { to: string; subject: string; html: string; text: string }): Promise<void> {
    if (!env.RESEND_API_KEY) {
        console.log("RESEND_API_KEY is not set. Skipping email send.", params.subject);
        return;
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
            from: env.FROM_EMAIL,
            to: [params.to],
            subject: params.subject,
            html: params.html,
            text: params.text
        })
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Email API request failed: ${body}`);
    }
}

async function issueDownloadToken(
    env: Env,
    args: { email: string; format: ResumeFormat; requestId: string | null; ttlHours: number; baseUrl: string }
): Promise<{ token: string; expiresAt: string; url: string }> {
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + args.ttlHours * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(
        `INSERT INTO download_tokens (
      id, request_id, recipient_email, file_format, token_hash,
      expires_at, max_uses, use_count, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, ?7)`
    )
        .bind(crypto.randomUUID(), args.requestId, args.email, args.format, tokenHash, expiresAt, createdAt)
        .run();

    const url = `${normalizeBaseUrl(args.baseUrl)}/api/download/${encodeURIComponent(token)}`;

    return { token, expiresAt, url };
}

async function handleRequestDownload(request: Request, env: Env): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: "Invalid JSON payload." }, 400, request);
    }

    const payload = (body ?? {}) as Record<string, unknown>;
    const name = String(payload.name ?? "").trim();
    const email = String(payload.email ?? "").trim().toLowerCase();
    const company = String(payload.company ?? "").trim();
    const format = toFormat(String(payload.format ?? "").toLowerCase());

    if (!name || !email || !format) {
        return jsonResponse({ error: "Name, email, and format are required." }, 400, request);
    }

    if (!isValidEmail(email)) {
        return jsonResponse({ error: "Invalid email format." }, 400, request);
    }

    const requestId = crypto.randomUUID();
    const adminActionToken = randomToken();
    const adminActionTokenHash = await sha256Hex(adminActionToken);
    const createdAt = nowIso();

    await env.DB.prepare(
        `INSERT INTO requests (
      id, requester_name, requester_email, requester_company, requested_format,
      status, admin_action_token_hash, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)`
    )
        .bind(requestId, name, email, company || null, format, adminActionTokenHash, createdAt)
        .run();

    const baseUrl = resolveBaseUrl(env, new URL(request.url));
    const approveLink = `${baseUrl}/api/admin/approve?requestId=${encodeURIComponent(requestId)}&token=${encodeURIComponent(adminActionToken)}`;
    const rejectLink = `${baseUrl}/api/admin/reject?requestId=${encodeURIComponent(requestId)}&token=${encodeURIComponent(adminActionToken)}`;

    const adminSubject = `Resume request: ${name} (${format.toUpperCase()})`;
    const adminText = [
        "New resume file request",
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${company || "N/A"}`,
        `Format: ${format}`,
        `Approve: ${approveLink}`,
        `Reject: ${rejectLink}`
    ].join("\n");
    const adminHtml = `
    <p>New resume file request</p>
    <ul>
      <li><strong>Name:</strong> ${sanitize(name)}</li>
      <li><strong>Email:</strong> ${sanitize(email)}</li>
      <li><strong>Company:</strong> ${sanitize(company || "N/A")}</li>
      <li><strong>Format:</strong> ${sanitize(format.toUpperCase())}</li>
    </ul>
    <p><a href="${approveLink}">Approve request</a></p>
    <p><a href="${rejectLink}">Reject request</a></p>
  `;

    await sendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: adminSubject,
        html: adminHtml,
        text: adminText
    });

    return jsonResponse(
        {
            ok: true,
            message: "Request submitted. You will receive a link by email after approval."
        },
        202,
        request
    );
}

async function handleAdminDecision(url: URL, env: Env, approve: boolean): Promise<Response> {
    const requestId = url.searchParams.get("requestId")?.trim() || "";
    const token = url.searchParams.get("token")?.trim() || "";

    if (!requestId || !token) {
        return htmlResponse("<h1>Invalid request</h1><p>Missing requestId or token.</p>", 400);
    }

    const tokenHash = await sha256Hex(token);

    const row = await env.DB.prepare(
        `SELECT id, requester_name, requester_email, requested_format, status
     FROM requests
     WHERE id = ?1 AND admin_action_token_hash = ?2`
    )
        .bind(requestId, tokenHash)
        .first<RequestRow>();

    if (!row) {
        return htmlResponse("<h1>Link invalid</h1><p>This approval link is invalid or expired.</p>", 404);
    }

    if (row.status !== "pending") {
        return htmlResponse(`<h1>Already processed</h1><p>This request is already ${sanitize(row.status)}.</p>`, 409);
    }

    const actedAt = nowIso();

    if (!approve) {
        await env.DB.prepare(`UPDATE requests SET status = 'rejected', acted_at = ?1 WHERE id = ?2`).bind(actedAt, row.id).run();

        await sendEmail(env, {
            to: row.requester_email,
            subject: "Resume request update",
            text: "Your request for a downloadable resume file was not approved at this time.",
            html: "<p>Your request for a downloadable resume file was not approved at this time.</p>"
        });

        return htmlResponse("<h1>Request rejected</h1><p>The requester has been notified.</p>");
    }

    const tokenResult = await issueDownloadToken(env, {
        email: row.requester_email,
        format: row.requested_format,
        requestId: row.id,
        ttlHours: 24,
        baseUrl: resolveBaseUrl(env, url)
    });

    await env.DB.prepare(`UPDATE requests SET status = 'approved', acted_at = ?1 WHERE id = ?2`).bind(actedAt, row.id).run();

    let deliveryNote = "The requester has been notified by email.";

    try {
        await sendEmail(env, {
            to: row.requester_email,
            subject: "Your resume download link",
            text: [
                `Your request was approved.`,
                `Download link: ${tokenResult.url}`,
                `This one-time link expires at ${tokenResult.expiresAt}.`
            ].join("\n"),
            html: `
        <p>Your request was approved.</p>
        <p><a href="${tokenResult.url}">Download resume</a></p>
        <p>This one-time link expires at ${sanitize(tokenResult.expiresAt)}.</p>
      `
        });
    } catch {
        deliveryNote = `Email failed. Share this one-time link manually: <a href="${tokenResult.url}">${tokenResult.url}</a>`;
    }

    return htmlResponse(`<h1>Request approved</h1><p>${deliveryNote}</p>`);
}

async function handleGenerateLink(request: Request, env: Env): Promise<Response> {
    if (!(await isAuthorizedAdmin(request, env))) {
        return jsonResponse({ error: "Unauthorized." }, 401, request);
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: "Invalid JSON payload." }, 400, request);
    }

    const payload = (body ?? {}) as Record<string, unknown>;
    const email = String(payload.email ?? "").trim().toLowerCase();
    const format = toFormat(String(payload.format ?? "").toLowerCase());
    const ttlInput = Number(payload.ttlHours ?? 24);
    const ttlHours = Number.isFinite(ttlInput) ? Math.max(1, Math.min(72, ttlInput)) : 24;

    if (!email || !format || !isValidEmail(email)) {
        return jsonResponse({ error: "Valid email and format are required." }, 400, request);
    }

    const tokenResult = await issueDownloadToken(env, {
        email,
        format,
        requestId: null,
        ttlHours,
        baseUrl: resolveBaseUrl(env, new URL(request.url))
    });

    return jsonResponse(
        {
            ok: true,
            downloadUrl: tokenResult.url,
            expiresAt: tokenResult.expiresAt
        },
        201,
        request
    );
}

async function handleDownload(url: URL, env: Env): Promise<Response> {
    if (!env.RESUME_FILES) {
        return jsonResponse({ error: "Resume file storage is not configured yet." }, 503);
    }

    const token = decodeURIComponent(url.pathname.replace("/api/download/", "").trim());
    if (!token) {
        return jsonResponse({ error: "Missing token." }, 400);
    }

    const tokenHash = await sha256Hex(token);

    const row = await env.DB.prepare(
        `SELECT id, file_format, expires_at, max_uses, use_count
     FROM download_tokens
     WHERE token_hash = ?1`
    )
        .bind(tokenHash)
        .first<DownloadTokenRow>();

    if (!row) {
        return jsonResponse({ error: "Invalid token." }, 404);
    }

    const expired = new Date(row.expires_at).getTime() <= Date.now();
    const exhausted = row.use_count >= row.max_uses;
    if (expired || exhausted) {
        return jsonResponse({ error: "Token expired or already used." }, 410);
    }

    const updated = await env.DB.prepare(
        `UPDATE download_tokens
     SET use_count = use_count + 1,
         used_at = CASE WHEN use_count + 1 >= max_uses THEN ?2 ELSE used_at END
     WHERE id = ?1 AND use_count < max_uses`
    )
        .bind(row.id, nowIso())
        .run();

    if (!updated.meta || updated.meta.changes < 1) {
        return jsonResponse({ error: "Token already used." }, 410);
    }

    const object = await env.RESUME_FILES.get(getObjectKey(row.file_format));
    if (!object || !object.body) {
        return jsonResponse({ error: "Requested resume file is not available." }, 404);
    }

    const headers = new Headers();
    headers.set(
        "Content-Type",
        row.file_format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    headers.set("Content-Disposition", `attachment; filename=\"Hasan-Kayman-Resume.${row.file_format}\"`);
    headers.set("Cache-Control", "no-store");

    return new Response(object.body, { headers });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: getCorsHeaders(request) });
        }

        try {
            if (url.pathname === "/api/health" && request.method === "GET") {
                return jsonResponse({ ok: true }, 200, request);
            }

            if (url.pathname === "/api/request-download" && request.method === "POST") {
                return await handleRequestDownload(request, env);
            }

            if (url.pathname === "/api/admin/approve" && request.method === "GET") {
                return await handleAdminDecision(url, env, true);
            }

            if (url.pathname === "/api/admin/reject" && request.method === "GET") {
                return await handleAdminDecision(url, env, false);
            }

            if (url.pathname === "/api/admin/generate-link" && request.method === "POST") {
                return await handleGenerateLink(request, env);
            }

            if (url.pathname.startsWith("/api/download/") && request.method === "GET") {
                return await handleDownload(url, env);
            }

            return jsonResponse({ error: "Not found." }, 404, request);
        } catch (error) {
            console.error(error);
            return jsonResponse({ error: "Unexpected server error." }, 500, request);
        }
    }
} satisfies ExportedHandler<Env>;