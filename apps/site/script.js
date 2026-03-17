const API_BASE = window.RESUME_API_BASE || "https://replace-with-your-worker.workers.dev";

const form = document.getElementById("request-form");
const statusElement = document.getElementById("form-status");

function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle("error", isError);
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

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
        setStatus("Unable to submit right now. Please try later.", true);
    }
});