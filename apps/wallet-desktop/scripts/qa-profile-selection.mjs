import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Local package profile selection only. Never open account files, copy a
 * profile, unlock custody, or grant signing/Source authority. */
export function assertPhysicalQAProfile(profile, {
  reuseExisting = false,
  qaRoot = path.join(os.homedir(), 'Library/Application Support/YNX Wallet QA')
} = {}) {
  if (typeof reuseExisting !== 'boolean') throw Error('WALLET_PHYSICAL_QA_PROFILE_MODE_INVALID');
  if (typeof profile !== 'string' || !path.isAbsolute(profile) || path.normalize(profile) !== profile || /[\0\r\n]/.test(profile)) throw Error('WALLET_PHYSICAL_QA_PROFILE_REQUIRED');
  if (fs.realpathSync(profile) !== profile || !fs.lstatSync(profile).isDirectory()) throw Error('WALLET_PHYSICAL_QA_PROFILE_REQUIRED');
  if (reuseExisting) {
    const relative = path.relative(qaRoot, profile);
    if (!path.isAbsolute(qaRoot) || path.normalize(qaRoot) !== qaRoot || fs.realpathSync(qaRoot) !== qaRoot || !relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('WALLET_PHYSICAL_QA_EXISTING_PROFILE_BOUNDARY');
    // Metadata checks only. Existing QA custody is neither enumerated nor read.
  } else if (fs.readdirSync(profile).length) {
    throw Error('WALLET_PHYSICAL_QA_FRESH_PROFILE_REQUIRED');
  }
  return Object.freeze({profile, reuseExisting});
}
