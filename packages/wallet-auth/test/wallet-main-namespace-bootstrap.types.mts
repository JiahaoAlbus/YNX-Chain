import {initializeOriginalWalletMainNamespaceV1} from '../src/original-wallet-main-namespace-bootstrap.js';
const attempt=initializeOriginalWalletMainNamespaceV1();
attempt.retire();const joined:Promise<void>=attempt.join();const closed:Promise<void>=attempt.close();
const completion=await attempt.completion;const noAdmission:false=completion.NativeAdmission;
const cause:unknown=completion.error;
// @ts-expect-error controller is synchronous and not an awaitable startup result
const result:Promise<unknown>=attempt;
// @ts-expect-error no namespace/path/provider input
initializeOriginalWalletMainNamespaceV1({namespace:{}});
// @ts-expect-error no caller success/admitted setter
attempt.statusDATA().NativeAdmission=true;
void [joined,closed,noAdmission,cause,result];

import {startOriginalWalletMainNamespaceNodeLoadV1} from '../src/original-wallet-main-namespace-node-loader-private.js';
const load=startOriginalWalletMainNamespaceNodeLoadV1({});load.retire();await load.join();
const loaded=await load.completion;const noMain:false=loaded.MainRegistered;
// @ts-expect-error no caller URI/provider accepted
startOriginalWalletMainNamespaceNodeLoadV1({},'file:///tmp/main.mjs');
void noMain;

import {isOriginalWalletMainNamespaceImportDATA,consumeOriginalWalletMainNamespaceImportDATA} from '../src/original-wallet-main-namespace-node-loader-private.js';
const originalImport:boolean=isOriginalWalletMainNamespaceImportDATA({},{});
const consumedImport:boolean=consumeOriginalWalletMainNamespaceImportDATA({},{});
// @ts-expect-error exact owner/namespace required
isOriginalWalletMainNamespaceImportDATA({});
void [originalImport,consumedImport];
