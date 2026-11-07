import {acquireRequiredWPRIssuerPublicOriginalLoanV1} from '../native/original-wallet-product-required-loan.mjs';
import type {RequiredWPRIssuerPublicOriginalLoanV1} from '../src/original-wallet-product-materializer-data.js';
const result=acquireRequiredWPRIssuerPublicOriginalLoanV1();
if(result.owner){const loan:RequiredWPRIssuerPublicOriginalLoanV1=result.owner;const raw:string=loan.readCapturedPublicOriginals().root;void raw;loan.assertCurrent();const joined:Promise<void>=loan.join();void joined;const closed:boolean=loan.isClosed();void closed;}
if(result.errorPresent){const error:unknown=result.error;void error;}
// @ts-expect-error provider/owner/config not accepted
acquireRequiredWPRIssuerPublicOriginalLoanV1({});
