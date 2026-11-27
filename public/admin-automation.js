(() => {
  async function load() {
    const status = document.getElementById("orderAutomationStatus");
    const list = document.getElementById("orderAutomationJobs");
    try {
      const response = await fetch("/api/admin/automation");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not check the order connection");
      status.textContent = result.enabled && !result.missing.length
        ? "Paid-order automation is enabled. Email status means accepted by the email provider; check delivery or bounces in its dashboard."
        : `Automatic order emails are not active yet.${result.missing.length ? ` Setup needed: ${result.missing.join(", ")}.` : " Ready to enable after a test."}`;
      list.replaceChildren();
      const labels = { pending: "Email queued", sending: "Sending email", sent: "Email sent to provider", needs_review: "Needs attention" };
      for (const job of result.jobs) {
        const row = document.createElement("p");
        row.textContent = `${job.order_reference}${job.test_order ? " (test)" : ""} · ${job.customer_email || "No email address"} · ${labels[job.status] || job.status}${job.error_code ? ` · ${job.error_code.replaceAll("_", " ")}` : ""}`;
        list.append(row);
      }
      if (!result.jobs.length) list.textContent = "No automatic order emails yet. Manual personalization forms remain in the list above.";
    } catch (error) { status.textContent = error.message; }
  }
  document.addEventListener("DOMContentLoaded", () => {
    window.loadOrderAutomation = load;
    if (document.getElementById("dashboard").style.display !== "none") load();
  });
})();
