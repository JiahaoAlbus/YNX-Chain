import {composedTreeDigest} from '../services/codeoss-service/src/composed-runtime.mjs';
// A valid old artifact pin is not evidence that its compiled frontend/backend
// contain this checkout's project-service pipe and lifecycle changes.
export async function verifyOwnedWorkbenchBinding(manifest,source){
 const actual=await composedTreeDigest(source);
 if(!/^[a-f0-9]{64}$/.test(manifest?.workbenchSourceTreeSha256||'')||manifest.workbenchSourceTreeSha256!==actual)throw Object.assign(Error('The composed workbench predates this owned source. Rebuild and seal it before packaging.'),{code:'YNX_COMPOSED_WORKBENCH_SOURCE_MISMATCH'});
 return actual;
}
