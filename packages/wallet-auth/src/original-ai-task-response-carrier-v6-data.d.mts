export const AI_RESPONSE_ORIGINALS_CARRIER_V6:'YNX-AI-TASK-V6-RESPONSE-ORIGINALS/v1';
export const AI_RESPONSE_ORIGINALS_CARRIER_LIMIT_V6:1048576;
export interface AIResponseOriginalsCarrierInputDATA {readonly bodyOriginal:Uint8Array;readonly outcomeMetadataOriginal:Uint8Array;readonly businessReceiptOriginal:Uint8Array|null}
export interface AIResponseOriginalsCarrierDecodedDATA extends AIResponseOriginalsCarrierInputDATA {readonly transportOriginal:Uint8Array;readonly dataOnly:true;readonly receiptProvenanceVerified:false;readonly SourceAdmission:false;readonly RootAdmission:false;readonly operationVerified:false}
/** Fixed private paired carrier. No Source, signature or receipt provenance is supplied. */
export function encodeOriginalAITaskResponseCarrierV6DATA(input:AIResponseOriginalsCarrierInputDATA):Uint8Array;
export function decodeOriginalAITaskResponseCarrierV6DATA(transportOriginal:Uint8Array):Readonly<AIResponseOriginalsCarrierDecodedDATA>;
