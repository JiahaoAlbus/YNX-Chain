export type PQContractName='SampleEVMWriteCounter'|'SampleYNXTCompatibleERC20';
export type PQDeploymentPayload={name:PQContractName;sourceHash:string;deployedBytecodeHash:string;compilerConfigHash:string;constructorArgs:[string];value:'0'};
export type PQExecutionPayload={name:PQContractName;target:string;sourceHash:string;deployedBytecodeHash:string;compilerConfigHash:string;expectedStorageCommitment:string;calldata:string;value:'0'};
/** Material values are canonical standard base64, NOT paths or URLs. */
export type PQConnectedContractAction=
 |{kind:'contract_deploy';fee:'10';payload:PQDeploymentPayload;deployment:{source:string;material:{artifactFile:string;buildInfoFile:string}}}
 |{kind:'contract_execute';fee:'2';payload:PQExecutionPayload};
export type PQPrepareContractRequest={version:1;account:string;action:PQConnectedContractAction};
export type PQPrepareBroadcastRequest={version:1;account:string;operationId:string};
/** Recovery after a lost signing response may use SHA256(UTF8(JSON.stringify([originalTopic, originalJsonRpcId]))). Not authority. */
export type PQOriginalQueryRequest={version:1;account:string;refresh:boolean}&({operationId:string;originalRequestKeyHash?:never}|{originalRequestKeyHash:string;operationId?:never});
export type PQSignedOriginalReference={version:1;account:string;hash:string;transportHash:string;memberHash:string;operationId:string;savedLocally:true;submitted:false;confirmed:false};
export type PQOriginalQueryResult={version:1;operationId:string;account:string;origin:string;kind:'contract_deploy'|'contract_execute';transportHash:string;memberHash:string;status:string;observation:null|{outcome?:string;status?:string};queryOnly:true;canRetry:false;consensusFinality:false};
export const PQ_CONNECTION_METHODS:readonly ['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
export function canonicalPQConnectionOrigin(value:unknown):string;
/** Main-only request correlation, not an Auth grant. Never exposed in preload. */
declare const privateConnection:unique symbol;
export type WalletPQConnection={readonly [privateConnection]:true};
export function captureWalletPQConnection(input:{origin:string;account:string;sessionBinding:string;requestKey:string;assertCurrent:()=>void}):WalletPQConnection;
export function readWalletPQConnection(token:WalletPQConnection):Readonly<{origin:string;account:string;sessionBindingHash:string;requestKeyHash:string}>;
export function parsePQConnectionRequest(method:string,params:unknown):{version:1;account:string;action?:unknown;operationId?:string;originalRequestKeyHash?:string;refresh?:boolean};
export function validatePQOriginalInitiator(value:unknown):{origin:string;sessionBindingHash:string;requestKeyHash:string};
