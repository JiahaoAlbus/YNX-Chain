import {openOriginalSocialDeviceDirectoryPrincipalDispatchV4,type SocialDeviceDirectoryAcceptedRequestV4DATA} from '../../src/original-social-device-directory-principal-dispatch-private.js';
declare const request:SocialDeviceDirectoryAcceptedRequestV4DATA;const loan=openOriginalSocialDeviceDirectoryPrincipalDispatchV4({},request,'currentExistingSocialDeviceDirectoryPrincipalV4');loan.run();loan.retire();loan.join();loan.close();
// @ts-expect-error developer operation is not part of this finite dispatcher
openOriginalSocialDeviceDirectoryPrincipalDispatchV4({},request,'currentExistingDeveloperPrincipalV5');
// @ts-expect-error no POST
openOriginalSocialDeviceDirectoryPrincipalDispatchV4({},{...request,method:'POST'},'currentExistingSocialDeviceDirectoryPrincipalV4');
// @ts-expect-error exact empty-body GET
openOriginalSocialDeviceDirectoryPrincipalDispatchV4({},{...request,body:'{}'},'currentExistingSocialDeviceDirectoryPrincipalV4');
// @ts-expect-error no effect/other route
openOriginalSocialDeviceDirectoryPrincipalDispatchV4({},{...request,path:'/api/v1/ide/deployments'},'currentExistingSocialDeviceDirectoryPrincipalV4');
// @ts-expect-error no caller approval/options/provider parameter
openOriginalSocialDeviceDirectoryPrincipalDispatchV4({},request,'currentExistingSocialDeviceDirectoryPrincipalV4',{approved:true});
