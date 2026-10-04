/** Card-owned availability marker, not authentication or a scope grant. */
export const CARD_OPERATION_RECOVERY_CONTRACT='ynx.card.original-key-readback.v1' as const;
export function cardOperationRecoveryContract(version:unknown):typeof CARD_OPERATION_RECOVERY_CONTRACT|undefined{
 if(!version||typeof version!=='object'||Array.isArray(version))return;
 const features=(version as {features?:unknown}).features;
 if(!features||typeof features!=='object'||Array.isArray(features))return;
 if((features as {operationReadback?:unknown}).operationReadback===CARD_OPERATION_RECOVERY_CONTRACT)return CARD_OPERATION_RECOVERY_CONTRACT;
}
