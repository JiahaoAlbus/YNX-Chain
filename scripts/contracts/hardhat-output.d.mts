export const hardhatArtifactsPath: "./artifacts/hardhat";
export function prepareHardhatOutput(root?: string): {root: string; base: string; managed: string};
export function finishHardhatOutput(root?: string): {managedArtifacts: string; compatibilityDirectories: string[]; retainedPreviousDirectories: string[]};
