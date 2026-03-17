const PLACEHOLDER_CLIENT_ID = "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID";
const DEFAULT_API_BASE = "https://resume-gate-worker.hasankayman.workers.dev";

const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const config = window.ADMIN_CONFIG || {};
const API_BASE = config.apiBase || (isLocalHost ? "http://127.0.0.1:8787" : DEFAULT_API_BASE);
const GOOGLE_CLIENT_ID = config.googleClientId || PLACEHOLDER_CLIENT_ID;

const form = document.getElementById("admin-form");
const statusElement = document.getElementById("admin-status");
const generateButton = document.getElementById("generate-btn");
const resultSection = document.getElementById("admin-result");
const linkElement = document.getElementById("download-link");
const expiresElement = document.getElementById("expires-at");
const copyButton = document.getElementById("copy-link");
const signoutButton = document.getElementById("signout-btn");

let googleIdToken = "";

function hasConfiguredGoogleClientId(clientId) {
    return Boolean(clientId) && !clientId.includes(PLACEHOLDER_CLIENT_ID);
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

function setSignedOutState() {
    googleIdToken = "";
    generateButton.disabled = true;
    signoutButton.hidden = true;
    resultSection.hidden = true;
    setStatus("Sign in required before generating links.", "error");
}

function setSignedInState(token) {
    googleIdToken = token;
    generateButton.disabled = false;
    signoutButton.hidden = false;

    const signedInEmail = decodeTokenEmail(token);
    if (signedInEmail) {
        setStatus(`Signed in as ${signedInEmail}.`, "neutral");
    } else {
        setStatus("Signed in. You can now generate links.", "neutral");
    }
}

function initGoogleSignIn() {
    if (!hasConfiguredGoogleClientId(GOOGLE_CLIENT_ID)) {
        setStatus("Set your Google OAuth client ID in admin.html before using this page.", "error");
        return;
    }

    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        setStatus("Google Sign-In failed to load. Refresh this page and try again.", "error");
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

setSignedOutState();
initGoogleSignIn();
