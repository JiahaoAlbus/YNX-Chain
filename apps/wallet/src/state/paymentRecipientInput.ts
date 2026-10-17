import { parsePaymentRecipient, type PaymentRecipient } from "../chain/paymentRequest";
import { WalletOperationCancelled, WalletOperationLifecycle, type WalletOperationScope } from "../security/operationLifecycle";

export type PaymentRecipientInputAttempt = Readonly<{
  read: (readClipboard: () => Promise<string>) => Promise<PaymentRecipient>;
  assert: () => void;
  isCurrent: () => boolean;
  ownsScope: () => boolean;
  finish: () => void;
}>;

/** A separate scope for an explicitly requested clipboard read. Cancelling a
 * draft input must never cancel a transaction operation or touch its outbox. */
export class PaymentRecipientInput {
  private readonly scope: WalletOperationScope;
  constructor(operations: WalletOperationLifecycle) { this.scope = operations.scope(); }
  cancel(): void { this.scope.cancel(); }
  begin(account: string): PaymentRecipientInputAttempt {
    this.cancel();
    const lease = this.scope.begin({ account });
    let readStarted = false;
    return Object.freeze({
      read: async (readClipboard: () => Promise<string>) => {
        lease.assert();
        if (readStarted) throw new WalletOperationCancelled();
        readStarted = true;
        let text = "";
        try {
          text = await lease.step(readClipboard);
          return parsePaymentRecipient(text);
        } finally { text = ""; }
      },
      assert: lease.assert,
      isCurrent: () => lease.isCurrent(),
      ownsScope: () => lease.ownsScope(),
      finish: () => lease.finish(),
    });
  }
}
