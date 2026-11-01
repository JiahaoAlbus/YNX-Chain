// PREPARED source fixture only, NOT_RUN. Original IDE writer applies this exact
// call in Resources/server.mjs, where import.meta.url is that running module.
export function adoptOriginalIDEAdmission(openOriginalIDEServiceAdmissionSupplier,runningBackendModuleURL){
 return openOriginalIDEServiceAdmissionSupplier(runningBackendModuleURL);
}
// Mandatory receiver cases: actual server.mjs+external approved final digest;
// argv mismatch/old App pointer; symlink ancestor/leaf; wrong final digest;
// old consumerProvenancePath extra field; missing independent root/ROLE;
// same current final file after external clock source drift; all fail closed.
