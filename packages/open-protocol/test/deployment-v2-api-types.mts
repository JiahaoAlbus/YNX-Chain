import {bindDeploymentV2Bytes,encodeDeploymentV2Bind,decodeDeploymentV2Bind,assertDeploymentV2BytesBinding} from '@ynx-chain/open-protocol/deployment-v2';
import type {DeploymentV2Bind} from '@ynx-chain/open-protocol/deployment-v2';
const body=new Uint8Array([0,1,2]);
const b:DeploymentV2Bind=bindDeploymentV2Bytes(body);
const roundtrip:DeploymentV2Bind=decodeDeploymentV2Bind(encodeDeploymentV2Bind(b));
assertDeploymentV2BytesBinding(body,roundtrip);
// @ts-expect-error Decimal U64 fields never accept a lossy JS number.
encodeDeploymentV2Bind({...b,bytes:3});
// @ts-expect-error Actual-byte digest ports never accept a URL as content.
bindDeploymentV2Bytes('https://artifact.invalid/');
// @ts-expect-error No authority flag is defined by this DATA binding.
const current:boolean=roundtrip.current;
void current;
import {createDeploymentManifestV2DATA,decodeDeploymentManifestV2DATA,assertDeploymentArtifactV2DATA} from '@ynx-chain/open-protocol/deployment-v2';
import type {DeploymentManifestV2,DeploymentManifestV2DATA} from '@ynx-chain/open-protocol/deployment-v2';
declare const selected:DeploymentManifestV2;
const built:DeploymentManifestV2DATA=createDeploymentManifestV2DATA(selected,body);
const readback:DeploymentManifestV2=decodeDeploymentManifestV2DATA(built.payloadOriginal,built.binding);
assertDeploymentArtifactV2DATA(built.payloadOriginal,body);
// @ts-expect-error Actual original artifact bytes are mandatory, never just a URL/digest.
createDeploymentManifestV2DATA(selected);
// @ts-expect-error Publisher epoch cannot be inferred from Ref.rev or a number.
createDeploymentManifestV2DATA({...selected,publisherEpoch:7},body);
// @ts-expect-error V2 provides no current publisher or deployment permission.
const permitted:boolean=built.authorized;
void permitted;void readback;
