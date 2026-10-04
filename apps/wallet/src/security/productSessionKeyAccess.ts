import type { WalletRepository } from "../storage/walletRepository";
import type { WalletOperationLifecycle } from "./operationLifecycle";

type Guard = () => void;
type Dependencies = {
  operations: WalletOperationLifecycle;
  repository: Pick<WalletRepository, "accountSecret">;
  checkBiometrics: (guard: Guard) => Promise<void>;
  authorizeLegacyMigration: () => Promise<void>;
};

/** The review button grants product consent; the native protected-key read grants
 * key access. Availability checks do not display a second authentication prompt. */
export function createProductSessionKeyAccess(dependencies: Dependencies) {
  return async <T>(account: string, assertRequest: Guard, use: (secret: string, assertKeyCurrent: Guard) => T | Promise<T>): Promise<T> => {
    const lease = dependencies.operations.scope().begin({ account, requireUnlocked: false });
    const guard = () => { lease.assert(); assertRequest(); };
    try {
      guard();
      await dependencies.checkBiometrics(guard); guard();
      return await lease.withSecret(() => dependencies.repository.accountSecret(account, guard, {
        allowLegacyMigration: true,
        authorizeLegacyMigration: async () => {
          guard(); await dependencies.authorizeLegacyMigration(); guard();
        },
      }), async (secret) => {
        guard(); const result = await use(secret, guard); guard(); return result;
      });
    } finally { lease.finish(); }
  };
}
