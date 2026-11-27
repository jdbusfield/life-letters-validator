(() => {
  async function load() {
    const status = document.getElementById("submissionAlertsStatus");
    const list = document.getElementById("submissionAlertsJobs");
    list.replaceChildren();
    try {
      const response = await fetch("/api/admin/submission-alerts");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not check submission notifications");
      status.textContent = result.enabled && !result.missing.length
        ? `Newly submitted sets notify ${result.recipient}. “Sent to provider” confirms acceptance; check Resend for delivery or bounces.`
        : `Submission notifications are not active.${result.missing.length ? ` Setup needed: ${result.missing.join(", ")}.` : " Ready to enable."}`;
      const labels = { pending: "Notification queued", sending: "Sending notification", sent: "Sent to provider", needs_review: "Needs attention", cancelled: "Superseded or reopened" };
      for (const job of result.jobs) {
        const row = document.createElement("p");
        const action = job.status === "needs_review" ? " · Check Resend before sending again" : "";
        row.textContent = `${job.order_reference} · ${job.set_label} · ${labels[job.status] || job.status}${action}`;
        list.append(row);
      }
      if (!result.jobs.length) list.textContent = "No submission notifications yet. Historical submissions are not emailed automatically.";
    } catch (error) { status.textContent = error.message; }
  }
  document.addEventListener("DOMContentLoaded", () => {
    window.loadSubmissionAlerts = load;
    document.getElementById("refreshSubmissionAlerts").addEventListener("click", load);
    if (document.getElementById("dashboard").style.display !== "none") load();
  });
})();
