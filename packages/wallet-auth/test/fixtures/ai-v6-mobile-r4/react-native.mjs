// PUBLIC protocol model only; no real Native brand/Source/context/permission.
let selected=null;export function selectFixture(value){selected=value;}export const TurboModuleRegistry={get(name){if(name!=='YNXOriginalAIMobileV6')throw Error('wrong module');return selected;}};
