// In-memory persistence is explicit and limited to unrelated serializer fixtures.
export class FixtureIntentStore {
  records = [];
  async snapshot() { return structuredClone(this.records); }
  async add(record) { if (!this.records.some(item => item.hash === record.hash)) this.records.push(structuredClone(record)); }
  async resolve(hash) { this.records = this.records.filter(item => item.hash !== hash); }
}
