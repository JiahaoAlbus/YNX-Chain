// Validate actual native telemetry without substituting estimates or retrying.
export function validateNativeResourceSample(sample, launcherPID) {
  if (!sample || !Number.isFinite(sample.rssWithControlReserveBytes) || sample.rssWithControlReserveBytes < 0 || !Number.isInteger(sample.threadsWithControlReserve) || sample.threadsWithControlReserve < 1 || !Array.isArray(sample.processes)) throw Error('invalid kernel resource sample');
  if (!sample.processes.some(p => p.pid === launcherPID && p.readable === true)) throw Error('launcher task info unavailable');
  if (sample.host?.scanComplete !== true) throw Error(`native host enumeration incomplete: ${JSON.stringify(sample.host)}`);
  if (sample.forkProbe?.available !== true) throw Error(`ordinary fork probe unavailable: ${JSON.stringify(sample.forkProbe)}`);
}
