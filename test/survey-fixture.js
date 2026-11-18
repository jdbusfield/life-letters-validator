import { randomUUID } from "node:crypto";

export function memoryDatabase() {
  const tables = { surveys: [], survey_photos: [], orders: [], letter_entries: [] };
  const files = new Map();
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.operation = "select"; }
    select() { this.returning = true; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    insert(value) { this.operation = "insert"; this.value = value; return this; }
    update(value) { this.operation = "update"; this.value = value; return this; }
    order() { return this; }
    limit() { return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }
    run() {
      let rows = tables[this.table].filter(row => this.filters.every(test => test(row)));
      if (this.operation === "insert") {
        rows = structuredClone(Array.isArray(this.value) ? this.value : [this.value]);
        if (this.table === "surveys" && rows.some(row => tables.surveys.some(old => old.provisioning_key === row.provisioning_key))) return { data: null, error: { code: "23505" } };
        rows.forEach(row => { row.id ||= randomUUID(); if (this.table === "surveys") Object.assign(row, { status: "draft", revision: 0, created_at: new Date().toISOString(), ...row }); });
        tables[this.table].push(...rows);
      }
      if (this.operation === "update") rows.forEach(row => Object.assign(row, structuredClone(this.value)));
      return { data: this.returning || this.operation === "select" ? structuredClone(this.one ? rows[0] || null : rows) : null, error: null };
    }
  }
  return { tables, files,
    from: table => new Query(table),
    storage: { from: bucket => ({
      async upload(path, bytes, options) { files.set(`${bucket}/${path}`, new Blob([bytes], { type: options.contentType })); return { error: null }; },
      async download(path) { const data = files.get(`${bucket}/${path}`); return { data, error: data ? null : new Error("missing") }; },
      async remove(paths) { paths.forEach(path => files.delete(`${bucket}/${path}`)); return { error: null }; },
    }) },
    async rpc(name, args) {
      const survey = tables.surveys.find(row => row.id === args.p_survey_id);
      if (name === "reopen_life_letters_survey") {
        const order = tables.orders.find(row => row.id === survey.submitted_order_id);
        if (order.status !== "submitted") return { error: { code: "22023" } };
        survey.status = "draft"; survey.revision++; order.pdf_url = null;
        return { data: { alreadyOpen: false }, error: null };
      }
      if (args.p_token_hash !== survey.access_token_hash) return { error: { code: "42501" } };
      if (survey.status === "submitted") return { data: { orderId: survey.submitted_order_id, alreadySubmitted: true }, error: null };
      if (args.p_revision !== survey.revision) return { error: { code: "40001" } };
      const order = { id: randomUUID(), survey_id: survey.id, order_number: `LL-${survey.id}`, status: "submitted", customer_email: survey.customer_email, child_name: survey.draft.childName, card_color: survey.draft.cardColor };
      tables.orders.push(order);
      tables.letter_entries.push(...args.p_entries.map(entry => ({ ...entry, order_id: order.id })));
      survey.status = "submitted"; survey.revision++; survey.submitted_order_id = order.id;
      return { data: { orderId: order.id, orderNumber: order.order_number, alreadySubmitted: false }, error: null };
    },
  };
}
