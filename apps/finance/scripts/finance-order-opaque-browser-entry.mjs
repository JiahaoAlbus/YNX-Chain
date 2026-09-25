import { createFinanceOrderOpaqueLaunchURL } from '@ynx-chain/wallet-auth';

// A Web page may construct/copy an opaque ticket link, but never navigate to
// a custom scheme. Native Finance must use a resolver-first launch separately.
window.YNXFinanceOpaqueOrder = Object.freeze({ launchURL: createFinanceOrderOpaqueLaunchURL });
