import {createDeveloperContractConnection,DEVELOPER_CONTRACT_METHODS,type DeveloperContractRequestSnapshot} from '@ynx-chain/wallet-auth/walletconnect-dapp-connection';
const connection=createDeveloperContractConnection();
const handle=connection.beginContractRequest({method:DEVELOPER_CONTRACT_METHODS[2],params:[{version:1,account:'0x',operationId:'op',refresh:false}]});
const observation:DeveloperContractRequestSnapshot=handle.snapshot();
const replay:false=observation.replayAllowed;
void replay;void handle.outcome;
// @ts-expect-error a dedicated profile cannot override origin
createDeveloperContractConnection({origin:'https://social.ynxweb4.com'});
// @ts-expect-error arbitrary signing is not a developer contract method
connection.beginContractRequest({method:'personal_sign',params:[]});
// @ts-expect-error caller ids are not original transport correlation
connection.beginContractRequest({method:DEVELOPER_CONTRACT_METHODS[2],params:[{version:1,account:'0x'}],id:123});
