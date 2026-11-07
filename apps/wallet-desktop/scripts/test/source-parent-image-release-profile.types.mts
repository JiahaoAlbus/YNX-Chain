import {inspectSourceParentImageReleaseProfileDATA,materializeSourceParentImageReleaseProfileDATA} from '../source-parent-image-release-profile.mjs';const p=inspectSourceParentImageReleaseProfileDATA('original','independent');const data=materializeSourceParentImageReleaseProfileDATA('/normal/build','original','independent');const triple:readonly [string,string,string]=data.images;const noRoot:false=data.RootAdmission;void triple;void noRoot;
// @ts-expect-error release profile has no Manager installation home
p.observerOptions;
// @ts-expect-error no Source qualification from copied image DATA
const root:true=data.RootAdmission;
