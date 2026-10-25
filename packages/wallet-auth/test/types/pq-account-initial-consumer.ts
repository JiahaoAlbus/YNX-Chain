import {decodePQAccountInitialRequest,preparePQAccountInitialTransport,type PQAccountInitialExpected} from '../../src/pq-wallet-authorization.js';
const expected:PQAccountInitialExpected={chainId:'',owner:'',pkA:'',pkB:'',executionHeight:'1'};
const wire=new Uint8Array();
const d=decodePQAccountInitialRequest(wire,expected),p=preparePQAccountInitialTransport(wire,expected);
const noAdmission:false=d.bootstrapAdmission;const math:true=d.signatureVerified;const method:'POST'=p.method;const hash:string=p.abciTransactionHash;void[noAdmission,math,method,hash];
// @ts-expect-error Selected context is mandatory, not inferred from submitted keys.
decodePQAccountInitialRequest(wire);
// @ts-expect-error Real U64 H cannot be rounded through Number.
preparePQAccountInitialTransport(wire,{...expected,executionHeight:1});
// @ts-expect-error The public parser does not grant bootstrap admission.
const grant:true=d.bootstrapAdmission;
// @ts-expect-error Caller cannot alter retained wire identity.
p.transportHash='';
void grant;
