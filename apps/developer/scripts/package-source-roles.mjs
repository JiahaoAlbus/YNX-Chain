// Artifact provenance only. Different producer stages may be reused when their
// exact immutable receipts and unchanged consumer inputs are reconciled. This
// module grants no business, Root, Source or signing authority.
const commit=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function assertPackageSourceRoles({roles,expected,nativeLink,nativePlan,applicationCommit,applicationTree}){
 if(!roles||roles.schema!=='YNX_IDE_CURRENT_PACKAGE_SOURCE_ROLES/v1'||!expected||!commit(applicationCommit)||!commit(applicationTree))throw Error('Exact current package source roles required');
 for(const key of ['assembledSourceCommit','compiledNativeSourceCommit','consumerVariantSourceCommit','SDKResourceSourceCommit'])if(!commit(roles[key])||roles[key]!==expected[key])throw Error('Package source role differs: '+key);
 if(roles.applicationSourceCommit!==applicationCommit||roles.applicationSourceTree!==applicationTree)throw Error('Current application source identity differs');
 if(roles.sourceVariant!=='SDK49-IDE-R2-SOURCE-ARCHIVE-RUNTIME/v1'||roles.sourceVariant!==expected.sourceVariant)throw Error('Exact explicit SDK source variant required');
 for(const key of ['originalPlanSHA256','originalExecutionSHA256','consumerVariantSHA256','projectionSHA256'])if(!digest(roles[key])||roles[key]!==expected[key])throw Error('Package source receipt differs: '+key);
 if(nativeLink.sourceCommit!==roles.assembledSourceCommit||nativePlan.sourceCommit!==roles.assembledSourceCommit||nativePlan.compiledSource?.commit!==roles.compiledNativeSourceCommit||nativeLink.SDKSourceCommit!==roles.SDKResourceSourceCommit||nativeLink.planSHA256!==roles.originalPlanSHA256||nativeLink.executionSHA256!==roles.originalExecutionSHA256)throw Error('Original native receipts do not match declared stage roles');
 if(expected.consumerVariantVerified!==true||expected.otherConsumerLeavesVerified!==26||expected.projectionBindingVerified!==true)throw Error('Current consumer and projection must be independently verified');
 return {schema:roles.schema,applicationSourceCommit:applicationCommit,assembledSourceCommit:roles.assembledSourceCommit,compiledNativeSourceCommit:roles.compiledNativeSourceCommit,consumerVariantSourceCommit:roles.consumerVariantSourceCommit,SDKResourceSourceCommit:roles.SDKResourceSourceCommit,sourceVariant:roles.sourceVariant,originalNativeReceiptsPreserved:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
}
