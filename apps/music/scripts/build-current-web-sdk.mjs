// Normal pre-embed generation: never restamp or replace the historical5c vendor.
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {buildCurrentMediaSdk} from '../../video/scripts/current-media-sdk.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
await buildCurrentMediaSdk(root,join(root,'apps/music/web/vendor/wallet-auth-r9-2689bece/artifacts'),'browser',{filename:'product-session-browser.mjs'});
