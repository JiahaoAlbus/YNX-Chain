import type{OriginalAuthSourceV2Service,OriginalAuthSourceV2Operations}from'../native/original-auth-identity-source-v2-verifier.mjs';
const a:OriginalAuthSourceV2Service='cloud-deployment-execution-authority-v2';const b:OriginalAuthSourceV2Service='cloud-deployment-recovery-authority-v2';const c:OriginalAuthSourceV2Service='ide-deployment-authority-v2';
const x:OriginalAuthSourceV2Operations=['deployment.execute-existing'];const y:OriginalAuthSourceV2Operations=['deployment.read-original'];const z:OriginalAuthSourceV2Operations=['deployment.sign-e11'];void a;void b;void c;void x;void y;void z;
// @ts-expect-error execution and recovery stay separate purposes
const wrong:OriginalAuthSourceV2Operations=['deployment.execute-existing','deployment.read-original'];
// @ts-expect-error no catch-all service string
const bad:OriginalAuthSourceV2Service='ANY';
