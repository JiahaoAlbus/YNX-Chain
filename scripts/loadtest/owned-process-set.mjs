import {validateNativeResourceSample} from './native-resource-sample.mjs';

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
  if (!rows.has(launcherPID)) throw Error('launcher process identity unavailable; monitoring unavailable');
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
  if (!rows.has(jobPID) && owned.size === 1) throw Error('job process identity unavailable; monitoring unavailable');
  const watched = [launcherPID];
  for (const pid of owned) if (pid !== launcherPID && rows.has(pid)) watched.push(pid);
  if (watched.length > maxWatched) throw Error('owned watched PID bound exceeded; monitoring unavailable');
  return watched.sort((a, b) => a - b);
}

// Schema 1 aggregates are deliberately insufficient. Only a new explicitly
// pinned native binary can provide the complete schema 2 identity inventory.
export function ownedProcessSetFromNative(sample, launcherPID, jobPID, maxWatched = 16) {
  const inventory=sample?.inventory;
  if(sample?.schema!==2||sample.scope!=='native owned process inventory'||inventory?.source!=='proc_listpids+kernel_identity'||inventory.complete!==true||inventory.ownershipComplete!==true||inventory.launcherPID!==launcherPID||inventory.jobPID!==jobPID||inventory.unresolved!==0||!Array.isArray(inventory.unresolvedRows)||inventory.unresolvedRows.length!==0||!Number.isSafeInteger(inventory.vanished)||inventory.vanished<0||!Array.isArray(inventory.rows)||inventory.rows.length>65536)throw Error('complete native identity inventory unavailable');
  if(!Number.isSafeInteger(sample.host?.processCount)||inventory.rows.length+inventory.vanished!==sample.host.processCount)throw Error('native identity inventory accounting mismatch');
  if(!inventory.rows.some(r=>r.pid===launcherPID)||!inventory.rows.some(r=>r.pid===jobPID))throw Error('native owned root identity unavailable');
  const rows=inventory.rows.map(r=>{
    if(![r.pid,r.parent,r.group].every(Number.isSafeInteger)||r.pid<1||r.parent<0||r.group<0||!['PROC_PIDTBSDINFO','KERN_PROC_PID'].includes(r.identitySource))throw Error('invalid native identity inventory row');
    return `${r.pid} ${r.parent} ${r.group}`;
  }).join('\n');
  const watched=ownedProcessSet(rows,launcherPID,jobPID,maxWatched);
  validateNativeResourceSample(sample,launcherPID,{expectedPIDs:watched});
  return watched;
}
