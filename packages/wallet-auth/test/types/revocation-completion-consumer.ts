import type {BrowserProductSessionAdapter, RecoverableProductSessionClient, ProductSessionRevocationCompletion} from "../../src/index.js";
import type {NativeProductSessionAdapter, NativeProductStorage} from "../../src/product-session-native.js";
declare const browser: BrowserProductSessionAdapter;
declare const native: NativeProductSessionAdapter;
declare const client: RecoverableProductSessionClient;
declare const store: NativeProductStorage;
const browserPort: true = browser.capabilities.durableRevocationCompletion;
const nativePort: boolean = native.capabilities.durableRevocationCompletion;
const cold: Promise<readonly ProductSessionRevocationCompletion[]> = client.getRevocationCompletions();
async function commitConsumerThenAcknowledge(commit:(r:ProductSessionRevocationCompletion)=>Promise<void>) {
 for (const receipt of await native.getRevocationCompletions()) { await commit(receipt); await native.acknowledgeRevocationCompletion(receipt); }
}
void browserPort; void nativePort; void cold; void store; void commitConsumerThenAcknowledge;
