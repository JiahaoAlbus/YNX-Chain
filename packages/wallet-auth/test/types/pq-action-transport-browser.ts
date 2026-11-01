import {encodePQActionTransportData,decodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
const body:Uint8Array=encodePQActionTransportData({member:new Uint8Array([1]),originals:[]});
const dto=decodePQActionTransportData(body);
const admission:false=dto.nativeAdmission;
const onlyData:true=dto.dataOnly;
// @ts-expect-error transport bytes are never string inputs
encodePQActionTransportData({member:'01',originals:[]});
// @ts-expect-error no caller-supplied permission field
encodePQActionTransportData({member:new Uint8Array([1]),originals:[],authorized:true});
void [admission,onlyData];
