import {openOriginalWPRMaterializationHostV1} from '../native/original-wpr-normal-host-private.mjs';import type {RequiredWPRIssuerPublicOriginalLoanV1} from '../src/original-wallet-product-materializer-data.js';
const outcome=await openOriginalWPRMaterializationHostV1();const loan:RequiredWPRIssuerPublicOriginalLoanV1=outcome.owner;const error:unknown=outcome.error;void error;void loan;const drain:Promise<void>=outcome.owner.drainPartial();void drain;
// @ts-expect-error noprovider/peer/pathconfig
openOriginalWPRMaterializationHostV1({});
