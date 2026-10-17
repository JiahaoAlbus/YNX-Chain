// Parse one bounded ps inventory. Membership follows the launched process group
// and transitive PPID descendants, never an arbitrary shared launcher ancestor.
export function ownedProcessSet(inventory, launcherPID, jobPID, maxWatched = 16) {
  if (!Number.isSafeInteger(launcherPID) || launcherPID < 1 || !Number.isSafeInteger(jobPID) || jobPID < 1 || !Number.isInteger(maxWatched) || maxWatched < 1 || maxWatched > 16) throw Error('invalid owned process roots/bound');
  if (typeof inventory !== 'string' || Buffer.byteLength(inventory) > 1024 * 1024) throw Error('process inventory byte bound');
  const rows = new Map();
  for (const line of inventory.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 3 || fields.some(field => !/^\d+$/.test(field))) throw Error('invalid process inventory row');
    const [pid, parent, group] = fields.map(Number);
    if (![pid, parent, group].every(Number.isSafeInteger) || pid < 1 || parent < 0 || group < 0 || rows.has(pid)) throw Error('invalid or duplicate process identity');
    rows.set(pid, { parent, group });
  }
  const owned = new Set([jobPID]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [pid, row] of rows) {
      if ((row.group === jobPID || owned.has(row.parent)) && !owned.has(pid)) {
        owned.add(pid);
        changed = true;
      }
    }
  }
  const watched = [launcherPID];
  for (const pid of owned) if (pid !== launcherPID && rows.has(pid)) watched.push(pid);
  if (watched.length > maxWatched) throw Error('owned watched PID bound exceeded; monitoring unavailable');
  return watched.sort((a, b) => a - b);
}
