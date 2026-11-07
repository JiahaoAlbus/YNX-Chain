// Private source-selected original administration input, not user configuration.
// A matching independently reviewed Root release supplies the complete entry
// for exactly ONE role/body/approval/journal. No runtime mutation or installer.
const originalEntries=Object.freeze([]);
export function selectedOriginalIDEContractRelayIssuance(){
 if(arguments.length||originalEntries.length!==1)throw Object.assign(new Error('IDE_RELAY_ISSUANCE_ORIGINAL_NOT_SUPPLIED'),{code:'IDE_RELAY_ISSUANCE_ORIGINAL_NOT_SUPPLIED'});
 return structuredClone(originalEntries[0]);
}
