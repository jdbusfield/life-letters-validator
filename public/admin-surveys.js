(() => {
  const byId = id => document.getElementById(id);
  let requestId = crypto.randomUUID();
  async function request(path = "", body) {
    const response = await fetch(`/api/admin/surveys${path}`, body ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    } : {});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Saved surveys are not available yet");
    return result;
  }
  function notice(message) { byId("surveyAdminNotice").textContent = message; }
  function button(label, action) {
    const element = document.createElement("button");
    element.className = "btn btn-small";
    element.textContent = label;
    element.addEventListener("click", action);
    return element;
  }
  function showLinks(items) {
    const container = byId("surveyLinks");
    container.replaceChildren();
    for (const item of items) {
      const panel = document.createElement("div");
      panel.className = "survey-link-panel";
      const label = document.createElement("strong");
      label.textContent = `${item.setLabel} · ${item.email}`;
      const field = document.createElement("textarea");
      field.readOnly = true;
      field.value = `Your Life Letters cards are ready to personalize!\n\nOpen your private link for ${item.setLabel}:\n${item.link}\n\nYour progress saves automatically. Reopen this link on any device to continue. When you are ready, preview your cards and click Submit My Life Letters Cards. Keep this link private. It expires in 180 days; contact us if you need a new link.`;
      const copy = value => async () => {
        try { await navigator.clipboard.writeText(value); notice("Copied. You can paste this into your customer email."); }
        catch { field.focus(); field.select(); notice("Select and copy the email text above."); }
      };
      panel.append(label, field, button("Copy private link", copy(item.link)), button("Copy email text", copy(field.value)));
      container.append(panel);
    }
    notice("Private links created. Copy them now; full links are not stored in the database. No email has been sent.");
  }
  async function load() {
    try {
      const { surveys } = await request();
      const container = byId("savedSurveysList");
      container.replaceChildren();
      for (const survey of surveys) {
        const row = document.createElement("div");
        row.className = "survey-admin-row";
        const description = document.createElement("span");
        description.textContent = `${survey.order_reference} · ${survey.set_label} · ${survey.customer_email} · ${survey.status}`;
        row.append(description, button("Replace private link", async () => {
          if (!confirm("Replace this private link? The previous link and device access will stop working.")) return;
          try { showLinks([await request(`/${survey.id}/link`, {})]); } catch (error) { notice(error.message); }
        }));
        if (survey.submitted_order_id) row.append(button("View submitted cards", () => window.viewOrder(survey.submitted_order_id)));
        if (survey.status === "submitted") row.append(button("Reopen for changes", async () => {
          if (!confirm("Reopen this survey for the customer? Its current PDF will need to be generated again after resubmission.")) return;
          try { await request(`/${survey.id}/reopen`, {}); await load(); notice("Survey reopened. The customer can use their current private link."); }
          catch (error) { notice(error.message); }
        }));
        container.append(row);
      }
      if (!surveys.length) container.textContent = "No saved surveys yet.";
    } catch (error) { notice(error.message); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    byId("createSurveysForm").addEventListener("submit", async event => {
      event.preventDefault();
      const submit = event.target.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const result = await request("", { customerName: byId("surveyCustomerName").value,
          customerEmail: byId("surveyCustomerEmail").value, orderReference: byId("surveyOrderReference").value,
          setCount: Number(byId("surveySetCount").value), requestId });
        showLinks(result.surveys);
        requestId = crypto.randomUUID();
        await load();
      } catch (error) { notice(error.message); }
      finally { submit.disabled = false; }
    });
    window.loadSavedSurveys = load;
    if (byId("dashboard").style.display !== "none") load();
  });
})();
