import { createWalletAddressConnection, type WalletConnectCleanupSnapshot } from "../../src/walletconnect-dapp-connection.js";
const original = createWalletAddressConnection();
const observed: WalletConnectCleanupSnapshot = original.cleanupSnapshot();
const localOnly: "local-only" = observed.scope;
const remoteNotProven: "not-proven" = observed.remoteCleanup;
const unconfirmed: true = observed.remoteCleanupUnconfirmed;
const settled: "not-started" | "pending" | "fulfilled" | "rejected" = observed.connection;
const initialization: typeof settled = observed.initialization;
// @ts-expect-error Observers cannot change the original lifecycle.
observed.connection = "fulfilled";
// @ts-expect-error Nested cause evidence is immutable.
observed.firstCause.present = false;
// @ts-expect-error The public snapshot does not contain the pairing topic.
observed.topic;
// @ts-expect-error The public snapshot does not expose an error object or arbitrary message.
observed.firstCause.message;
void [localOnly, remoteNotProven, unconfirmed, settled, initialization];
