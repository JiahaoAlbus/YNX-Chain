import * as WalletAuth from '../../src/index.js';
void WalletAuth;
// Browser entry must not bring Node globals into a DOM-only consumer.
// @ts-expect-error Node-only Buffer must not enter the browser root.
Buffer;
// @ts-expect-error Node-only process must not enter the browser root.
process;
