// Validate actual native telemetry without substituting estimates or retrying.
export function validateNativeResourceSample(sample, launcherPID, { full = true, expectedPIDs, rootCase } = {}) {
  if (!sample || !Number.isFinite(sample.rssWithControlReserveBytes) || sample.rssWithControlReserveBytes < 0 || !Number.isInteger(sample.threadsWithControlReserve) || sample.threadsWithControlReserve < 1 || !Array.isArray(sample.processes)) throw Error('invalid kernel resource sample');
  if (!sample.processes.some(p => p.pid === launcherPID && p.readable === true)) throw Error('launcher task info unavailable');
  if (sample.processes.length > 16) throw Error('owned watched PID bound exceeded');
  const identities = new Set();
  for (const p of sample.processes) {
    if (!Number.isSafeInteger(p.pid) || p.pid < 1 || identities.has(p.pid)) throw Error('invalid or duplicate owned process identity');
    identities.add(p.pid);
    if (p.readable !== true || !Number.isSafeInteger(p.rssBytes) || p.rssBytes < 0 || !Number.isSafeInteger(p.threads) || p.threads < 1) throw Error(`owned task info unavailable: ${JSON.stringify(p)}`);
  }
  if (expectedPIDs !== undefined && (!Array.isArray(expectedPIDs) || expectedPIDs.length < 1 || expectedPIDs.length > 16 || expectedPIDs.some(pid => !Number.isSafeInteger(pid) || pid < 1) || new Set(expectedPIDs).size !== expectedPIDs.length || !expectedPIDs.includes(launcherPID) || expectedPIDs.length !== identities.size || expectedPIDs.some(pid => !identities.has(pid)))) throw Error('native sample watched identities differ from complete owned set');
  if (full && sample.host?.scanComplete !== true) throw Error(`native host enumeration incomplete: ${JSON.stringify(sample.host)}`);
  if (full && sample.forkProbe?.available !== true) throw Error(`ordinary fork probe unavailable: ${JSON.stringify(sample.forkProbe)}`);
  if(rootCase!==undefined&&!["client13-normal-02","client13-normal-03","client13-normal-04","client13-normal-05","client13-normal-06","client13-normal-07","client13-normal-08","client13-normal-09","client13-normal-10","client13-normal-11","client13-normal-12","client13-normal-13","client13-normal-14","client13-normal-15","offline-baseline-stopped-01"].includes(rootCase))throw Error("unsupported explicit Root resource case");
  const pressure = sample.memoryPressure;
  if (pressure?.source !== 'kern.memorystatus_vm_pressure_level' || pressure.readable !== true || (pressure.dispatchLevel !== 1 && !(["client13-normal-02","client13-normal-03","client13-normal-04","client13-normal-05","client13-normal-06","client13-normal-07","client13-normal-08","client13-normal-09","client13-normal-10","client13-normal-11","client13-normal-12","client13-normal-13","client13-normal-14","client13-normal-15","offline-baseline-stopped-01"].includes(rootCase) && pressure.dispatchLevel === 2))) throw Error(`native memory pressure is not normal: ${JSON.stringify(pressure)}`);
}
