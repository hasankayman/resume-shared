const PLACEHOLDER_API_BASE = "https://resume-gate-worker.hasankayman.workers.dev";
const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE = window.RESUME_API_BASE || (isLocalHost ? "http://127.0.0.1:8787" : PLACEHOLDER_API_BASE);

const form = document.getElementById("request-form");
const statusElement = document.getElementById("form-status");

function hasConfiguredApiBase(apiBase) {
    return Boolean(apiBase) && !apiBase.includes("replace-with-your-worker");
}

function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle("error", isError);
}

if (!hasConfiguredApiBase(API_BASE)) {
    setStatus("Request service is not configured yet. Set RESUME_API_BASE to your deployed Worker URL.", true);
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!hasConfiguredApiBase(API_BASE)) {
        setStatus("Request service is not configured yet. Please try again after backend setup.", true);
        return;
    }

    const formData = new FormData(form);
    const payload = {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        company: String(formData.get("company") || "").trim(),
        format: String(formData.get("format") || "pdf").toLowerCase()
    };

    if (!payload.name || !payload.email) {
        setStatus("Please fill in name and work email.", true);
        return;
    }

    try {
        setStatus("Sending request...");

        const response = await fetch(`${API_BASE}/api/request-download`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            setStatus(result.error || "Request failed. Please try again.", true);
            return;
        }

        setStatus("Request submitted. You will receive a download link after approval.");
        form.reset();
    } catch {
        setStatus("Unable to reach the request service. Verify Worker URL and network connectivity.", true);
    }
});