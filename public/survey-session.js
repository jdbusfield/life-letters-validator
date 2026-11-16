// Each set uses its own HttpOnly cookie path and its own local backup.
window.LifeLettersSurvey = {
  async open() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const id = fragment.get("survey") || new URLSearchParams(location.search).get("survey");
    const config = await fetch("/api/survey-config").then(response => {
      if (!response.ok) throw new Error("Could not connect to saved surveys. Please reload.");
      return response.json();
    });
    if (!id) return { active: false, required: config.accessRequired };
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("This private survey link is invalid");
    const path = `/api/surveys/${id}`;
    const request = async (suffix = "", options = {}) => {
      const response = await fetch(path + suffix, { credentials: "same-origin", ...options });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || "Could not save. Keep this tab open and try again."), { status: response.status });
      return data;
    };
    const json = body => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (fragment.get("token")) {
      await request("/session", { method: "POST", ...json({ token: fragment.get("token") }) });
      history.replaceState(null, "", `/?survey=${encodeURIComponent(id)}`);
    }
    const info = await request();
    const session = {
      active: true, id, path, info, revision: info.revision, pending: null, running: null, conflict: false,
      async flush() {
        if (this.conflict) throw new Error("This survey changed on another device. Reload before editing further.");
        if (this.running) return this.running;
        this.running = (async () => {
          while (this.pending) {
            const draft = this.pending;
            this.pending = null;
            this.notice("Saving your progress…");
            try {
              const result = await request("", { method: "PUT", ...json({ revision: this.revision, draft }) });
              this.revision = result.revision;
              this.notice("Saved online — reopen your private email link on any device.");
            } catch (error) {
              this.pending ||= draft;
              this.conflict = error.status === 409;
              this.notice(error.message, true);
              throw error;
            }
          }
        })().finally(() => { this.running = null; });
        return this.running;
      },
      save(draft) {
        if (this.info.status === "submitted") return Promise.resolve();
        this.pending = structuredClone(draft);
        return this.flush();
      },
      notice(message, error = false) {
        const element = document.getElementById("surveySaveStatus");
        if (element) { element.textContent = message; element.classList.toggle("error", error); }
      },
      async submit() {
        await this.flush();
        const result = await request("/submit", { method: "POST", ...json({ revision: this.revision }) });
        this.info.status = "submitted";
        return result;
      },
    };
    window.addEventListener("beforeunload", event => {
      if (session.pending || session.running) { event.preventDefault(); event.returnValue = ""; }
    });
    return session;
  },
};
