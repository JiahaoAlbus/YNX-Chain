import {copySocialF06DirectoryDATA,selectSocialF06DirectoryTargetDATA,type SocialF06DirectoryDATA} from '../native/social-f06-directory-readonly-data.mjs';
const view:SocialF06DirectoryDATA=copySocialF06DirectoryDATA({});
const target=selectSocialF06DirectoryTargetDATA(view,'device-A','1');
if(target){ const state:'committed'|'revoked'=target.state; void state; }
// @ts-expect-error immutable DATA
view.epoch='2';
// @ts-expect-error immutable rows
view.devices.push({});
// @ts-expect-error not a Source/Root brand
const source:{readonly qualified:true}=view;
// @ts-expect-error no private originals exported
view.devices[0].Subject;
// @ts-expect-error generation must stay canonical text, no numeric API
selectSocialF06DirectoryTargetDATA(view,'device-A',1);
