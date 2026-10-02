/** Account-bound public history. Refresh invalidates an old page before await. */
export function createTransactionHistoryUI({ getAccount, request, render }) {
  let revision = 0, records = [], cursor = null, busy = false;
  function clear() { revision++; records = []; cursor = null; busy = false; render({ records, nextCursor: null, busy: false, loaded: false, error: null }); }
  async function load(more = false) {
    if (more && (busy || cursor === null)) return;
    if (!more) clear();
    const account = getAccount(), current = revision;
    if (!account) return;
    busy = true; render({ records, nextCursor: cursor, busy, loaded: false, error: null });
    try {
      const response = await request(more ? cursor : null);
      if (current !== revision || getAccount() !== account) return;
      if (!response?.ok || !Array.isArray(response.value?.records) || response.value.records.length > 50 ||
          response.value.records.some(record => record.account !== account || !/^0x[0-9a-f]{64}$/.test(record.hash) || record.confirmed !== true || record.confirmationScope !== "local-snapshot" || record.consensusFinality !== false || "raw" in record)) throw new Error("Unverified history");
      const next = response.value.nextCursor;
      if (next !== null && !/^0x[0-9a-f]{64}$/.test(next)) throw new Error("Invalid page");
      const combined = more ? [...records, ...response.value.records] : response.value.records;
      if (new Set(combined.map(record => record.hash)).size !== combined.length) throw new Error("Repeated history");
      records = combined; cursor = next; busy = false;
      render({ records, nextCursor: cursor, busy, loaded: true, error: null });
    } catch {
      if (current !== revision || getAccount() !== account) return;
      busy = false; render({ records, nextCursor: cursor, busy, loaded: false, error: "Saved transaction history could not be verified. Original records remain on this device." });
    }
  }
  return { clear, refresh: () => load(false), older: () => load(true) };
}
