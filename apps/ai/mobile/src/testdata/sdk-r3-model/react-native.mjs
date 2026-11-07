// PUBLIC protocol model only. Not Native/Source/HostObject implementation.
let selected=null;export const moduleNames=[];export function selectFixture(value){selected=value;moduleNames.length=0;}export const TurboModuleRegistry={get(name){moduleNames.push(name);return selected;}};
