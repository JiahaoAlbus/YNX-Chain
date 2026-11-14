import type { VeilAdmission, VeilProductController } from './productController';
import type { VeilCopyKey } from './copy';
/** Actual root catch adapter: mounted alone does not establish account ownership. */
export function failRootOperation(controller: VeilProductController, lease: VeilAdmission, mounted: () => boolean, publish: (key: VeilCopyKey | null) => void): boolean {
  const accepted = controller.fail(lease);
  if (accepted && mounted()) publish('unknown');
  return accepted;
}
export function clearAccountFeedback(previous: string | null, next: string | null, publish: (key: VeilCopyKey | null) => void): void {
  if (previous !== next) publish(null);
}
