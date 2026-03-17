const PLACEHOLDER_CLIENT_ID = "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID";
const DEFAULT_API_BASE = "https://resume-gate-worker.hasankayman.workers.dev";

const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const config = window.ADMIN_CONFIG || {};
const API_BASE = config.apiBase || (isLocalHost ? "http://127.0.0.1:8787" : DEFAULT_API_BASE);
const GOOGLE_CLIENT_ID = config.googleClientId || PLACEHOLDER_CLIENT_ID;
const GOOGLE_SDK_TIMEOUT_MS = 15000;
const GOOGLE_SDK_POLL_MS = 250;

const form = document.getElementById("admin-form");
const statusElement = document.getElementById("admin-status");
const generateButton = document.getElementById("generate-btn");
const resultSection = document.getElementById("admin-result");
const linkElement = document.getElementById("download-link");
const expiresElement = document.getElementById("expires-at");
const copyButton = document.getElementById("copy-link");
const signoutButton = document.getElementById("signout-btn");
const requestsStatusElement = document.getElementById("requests-status");
const requestsFilterElement = document.getElementById("requests-filter");
const refreshRequestsButton = document.getElementById("refresh-requests");
const requestsTableWrap = document.getElementById("requests-table-wrap");
const requestsBody = document.getElementById("requests-body");

let googleIdToken = "";

function hasConfiguredGoogleClientId(clientId) {
    return Boolean(clientId) && !clientId.includes(PLACEHOLDER_CLIENT_ID);
}

function hasGoogleSdkLoaded() {
    return Boolean(window.google && window.google.accounts && window.google.accounts.id);
}

function ensureGoogleScriptTag() {
    if (document.querySelector("script[src='https://accounts.google.com/gsi/client']")) {
        return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

async function waitForGoogleSdk(timeoutMs = GOOGLE_SDK_TIMEOUT_MS) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (hasGoogleSdkLoaded()) {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, GOOGLE_SDK_POLL_MS));
    }

    return hasGoogleSdkLoaded();
}

function decodeTokenEmail(token) {
    try {
        const payload = token.split(".")[1];
        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const json = decodeURIComponent(
            atob(base64)
                .split("")
                .map((char) => `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`)
                .join("")
        );
        const parsed = JSON.parse(json);
        return String(parsed.email || "").trim();
    } catch {
        return "";
    }
}

function setStatus(message, type = "neutral") {
    statusElement.textContent = message;
    statusElement.classList.remove("error", "neutral");

    if (type === "error") {
        statusElement.classList.add("error");
        return;
    }

    if (type === "neutral") {
        statusElement.classList.add("neutral");
    }
}

function setRequestsStatus(message, type = "neutral") {
    requestsStatusElement.textContent = message;
    requestsStatusElement.classList.remove("error", "neutral");

    if (type === "error") {
        requestsStatusElement.classList.add("error");
        return;
    }

    if (type === "neutral") {
        requestsStatusElement.classList.add("neutral");
    }
}

function clearRecentRequests() {
    requestsBody.innerHTML = "";
    requestsTableWrap.hidden = true;
}

function formatTimestamp(value) {
    if (!value) {
        return "—";
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
        return value;
    }

    return parsedDate.toLocaleString();
}

function buildStatusBadge(status) {
    const badge = document.createElement("span");
    const normalizedStatus = String(status || "pending").toLowerCase();
    badge.className = `request-status status-${normalizedStatus}`;
    badge.textContent = normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);
    return badge;
}

function createRequestActionButton(label, requestId, decision, extraClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `request-action-btn ${extraClass}`;
    button.dataset.requestId = requestId;
    button.dataset.decision = decision;
    button.textContent = label;
    return button;
}

function renderRecentRequests(items) {
    requestsBody.innerHTML = "";

    if (!items.length) {
        requestsTableWrap.hidden = true;
        return;
    }

    for (const item of items) {
        const row = document.createElement("tr");

        const nameCell = document.createElement("td");
        nameCell.textContent = String(item.requester_name || "");

        const emailCell = document.createElement("td");
        emailCell.textContent = String(item.requester_email || "");

        const companyCell = document.createElement("td");
        companyCell.textContent = String(item.requester_company || "—");

        const formatCell = document.createElement("td");
        formatCell.textContent = String(item.requested_format || "").toUpperCase();

        const statusCell = document.createElement("td");
        statusCell.appendChild(buildStatusBadge(item.status));

        const createdAtCell = document.createElement("td");
        createdAtCell.textContent = formatTimestamp(item.created_at);

        const actedAtCell = document.createElement("td");
        actedAtCell.textContent = formatTimestamp(item.acted_at);

        const actionsCell = document.createElement("td");
        const normalizedStatus = String(item.status || "").toLowerCase();
        const requestId = String(item.id || "");

        if (normalizedStatus === "pending" && requestId) {
            const actionGroup = document.createElement("div");
            actionGroup.className = "request-actions";

            const approveButton = createRequestActionButton("Approve", requestId, "approve", "request-action-approve");
            const rejectButton = createRequestActionButton("Reject", requestId, "reject", "request-action-reject");

            actionGroup.append(approveButton, rejectButton);
            actionsCell.appendChild(actionGroup);
        } else {
            actionsCell.textContent = "—";
        }

        row.append(nameCell, emailCell, companyCell, formatCell, statusCell, createdAtCell, actedAtCell, actionsCell);
        requestsBody.appendChild(row);
    }

    requestsTableWrap.hidden = false;
}

async function loadRecentRequests() {
    if (!googleIdToken) {
        clearRecentRequests();
        setRequestsStatus("Sign in required before loading requests.", "error");
        return;
    }

    const selectedStatus = String(requestsFilterElement.value || "all").toLowerCase();

    try {
        refreshRequestsButton.disabled = true;
        setRequestsStatus("Loading recent requests...", "neutral");

        const response = await fetch(
            `${API_BASE}/api/admin/requests?status=${encodeURIComponent(selectedStatus)}&limit=30`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${googleIdToken}`
                }
            }
        );

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            clearRecentRequests();
            setRequestsStatus(result.error || "Failed to load recent requests.", "error");
            return;
        }

        const items = Array.isArray(result.items) ? result.items : [];
        renderRecentRequests(items);

        if (!items.length) {
            setRequestsStatus("No requests found for this filter.", "neutral");
            return;
        }

        setRequestsStatus(`Showing ${items.length} recent request${items.length === 1 ? "" : "s"}.`, "neutral");
    } catch {
        clearRecentRequests();
        setRequestsStatus("Unable to load requests. Check Worker URL and connectivity.", "error");
    } finally {
        refreshRequestsButton.disabled = false;
    }
}

function setActionGroupBusy(actionGroup, isBusy) {
    if (!actionGroup) {
        return;
    }

    const buttons = actionGroup.querySelectorAll("button");
    for (const button of buttons) {
        button.disabled = isBusy;
    }
}

async function handleRequestDecision(requestId, decision, clickedButton) {
    if (!googleIdToken) {
        setRequestsStatus("Please sign in with Google first.", "error");
        return;
    }

    const actionGroup = clickedButton.closest(".request-actions");

    try {
        setActionGroupBusy(actionGroup, true);
        setRequestsStatus(`${decision === "approve" ? "Approving" : "Rejecting"} request...`, "neutral");

        const response = await fetch(`${API_BASE}/api/admin/requests/decision`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${googleIdToken}`
            },
            body: JSON.stringify({ requestId, decision })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            setRequestsStatus(result.error || "Unable to update request status.", "error");
            if (response.status === 409) {
                loadRecentRequests();
            }
            return;
        }

        setRequestsStatus(result.message || "Request updated.", "neutral");

        if (decision === "approve" && result.downloadUrl && result.emailSent === false) {
            const manualUrl = String(result.downloadUrl || "").trim();
            const manualExpiry = String(result.expiresAt || "").trim();
            linkElement.href = manualUrl;
            linkElement.textContent = manualUrl;
            expiresElement.textContent = manualExpiry ? `Expires: ${manualExpiry}` : "";
            resultSection.hidden = false;
            setStatus("Requester email could not be sent. Share the generated link manually.", "error");
        }

        await loadRecentRequests();
    } catch {
        setRequestsStatus("Unable to reach admin API. Check Worker URL and connectivity.", "error");
    } finally {
        setActionGroupBusy(actionGroup, false);
    }
}

function setSignedOutState() {
    googleIdToken = "";
    generateButton.disabled = true;
    signoutButton.hidden = true;
    requestsFilterElement.disabled = true;
    refreshRequestsButton.disabled = true;
    clearRecentRequests();
    setRequestsStatus("Sign in required before loading requests.", "error");
    resultSection.hidden = true;
    setStatus("Sign in required before generating links.", "error");
}

function setSignedInState(token) {
    googleIdToken = token;
    generateButton.disabled = false;
    signoutButton.hidden = false;
    requestsFilterElement.disabled = false;
    refreshRequestsButton.disabled = false;
    loadRecentRequests();

    const signedInEmail = decodeTokenEmail(token);
    if (signedInEmail) {
        setStatus(`Signed in as ${signedInEmail}.`, "neutral");
    } else {
        setStatus("Signed in. You can now generate links.", "neutral");
    }
}

async function initGoogleSignIn() {
    if (!hasConfiguredGoogleClientId(GOOGLE_CLIENT_ID)) {
        setStatus("Set your Google OAuth client ID in admin.html before using this page.", "error");
        return;
    }

    setStatus("Loading Google Sign-In...", "neutral");
    ensureGoogleScriptTag();

    const sdkReady = await waitForGoogleSdk();
    if (!sdkReady) {
        setStatus("Google Sign-In failed to load. Refresh this page and disable script blockers for accounts.google.com.", "error");
        return;
    }

    window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
            const token = String(response.credential || "").trim();
            if (!token) {
                setStatus("Google sign-in did not return a valid token.", "error");
                return;
            }

            setSignedInState(token);
        }
    });

    window.google.accounts.id.renderButton(document.getElementById("google-signin"), {
        type: "standard",
        shape: "pill",
        theme: "outline",
        text: "signin_with",
        size: "large"
    });
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!googleIdToken) {
        setStatus("Please sign in with Google first.", "error");
        return;
    }

    const formData = new FormData(form);
    const payload = {
        email: String(formData.get("email") || "").trim(),
        format: String(formData.get("format") || "pdf").toLowerCase(),
        ttlHours: Number(formData.get("ttlHours") || 24)
    };

    if (!payload.email) {
        setStatus("Recruiter email is required.", "error");
        return;
    }

    try {
        setStatus("Generating one-time link...", "neutral");

        const response = await fetch(`${API_BASE}/api/admin/generate-link`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${googleIdToken}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            setStatus(result.error || "Failed to generate link.", "error");
            return;
        }

        const downloadUrl = String(result.downloadUrl || "").trim();
        const expiresAt = String(result.expiresAt || "").trim();

        linkElement.href = downloadUrl;
        linkElement.textContent = downloadUrl;
        expiresElement.textContent = expiresAt ? `Expires: ${expiresAt}` : "";

        resultSection.hidden = false;
        setStatus("One-time link created successfully.", "neutral");
    } catch {
        setStatus("Unable to reach admin API. Check Worker URL and connectivity.", "error");
    }
});

copyButton.addEventListener("click", async () => {
    const value = linkElement.textContent || "";
    if (!value) {
        return;
    }

    try {
        await navigator.clipboard.writeText(value);
        setStatus("Download link copied to clipboard.", "neutral");
    } catch {
        setStatus("Copy failed. You can copy the link manually.", "error");
    }
});

signoutButton.addEventListener("click", () => {
    if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.disableAutoSelect();
    }
    setSignedOutState();
});

refreshRequestsButton.addEventListener("click", () => {
    loadRecentRequests();
});

requestsFilterElement.addEventListener("change", () => {
    loadRecentRequests();
});

requestsBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const actionButton = target.closest(".request-action-btn");
    if (!(actionButton instanceof HTMLButtonElement)) {
        return;
    }

    const requestId = String(actionButton.dataset.requestId || "").trim();
    const decision = String(actionButton.dataset.decision || "").trim().toLowerCase();

    if (!requestId || (decision !== "approve" && decision !== "reject")) {
        return;
    }

    handleRequestDecision(requestId, decision, actionButton);
});

setSignedOutState();
initGoogleSignIn();
