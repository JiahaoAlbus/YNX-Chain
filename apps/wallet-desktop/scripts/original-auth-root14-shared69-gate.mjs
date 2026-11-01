import fs from'node:fs';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';import{check as checkOriginal}from'./original-auth-common-image-gate.mjs';
export const go45=Object.freeze([
  "YNXAccountInitialSignV1",
  "YNXAccountMigrationPossessionSignV1",
  "YNXArtifactPublicationSignV1",
  "YNXDeploymentManifestSignV2",
  "YNXProductSessionDeviceChallengeSignV4",
  "YNXProductSessionDeviceKeypairGenerateV4",
  "YNXProductSessionDeviceRegistrationSignV4",
  "YNXProductSessionHTTPProofSignV4",
  "YNXProductSessionHTTPProofSignV5",
  "YNXProjectControlSignV1",
  "YNXPublisherCustodianSignV1",
  "YNXPublisherGenerateV1",
  "YNXPublisherPoPSignV1",
  "YNXRegisteredANDMemberVerifyN1V1",
  "YNXTransactionBatchSignV1",
  "ynx_link_pay_native_startup_adopt_source_v1",
  "ynx_link_pay_native_startup_close_v1",
  "ynx_link_pay_native_startup_closed_v1",
  "ynx_link_pay_native_startup_error_v1",
  "ynx_link_pay_native_startup_free_v1",
  "ynx_link_pay_native_startup_join_v1",
  "ynx_link_pay_native_startup_open_v1",
  "ynx_link_pay_native_startup_retire_v1",
  "ynx_link_private_client_call_v1",
  "ynx_link_private_client_capture_v1",
  "ynx_link_private_client_close_v1",
  "ynx_link_private_client_current_local_v1",
  "ynx_link_private_client_current_source_v1",
  "ynx_link_private_client_error_v1",
  "ynx_link_private_client_free_v1",
  "ynx_link_private_client_join_v1",
  "ynx_link_private_client_packet_free_v1",
  "ynx_link_private_client_recheck_v1",
  "ynx_link_private_client_registration_borrow_current_v1",
  "ynx_link_private_client_registration_borrow_release_v1",
  "ynx_link_private_client_registration_from_borrow_v1",
  "ynx_link_private_client_retire_v1",
  "ynx_product_pay_transport_cancel_v1",
  "ynx_product_pay_transport_close_v1",
  "ynx_product_pay_transport_join_v1",
  "ynx_product_pay_transport_open_v1",
  "ynx_product_pay_transport_release_response_v1",
  "ynx_product_pay_transport_request_v1",
  "ynx_product_pay_transport_response_diagnostics_v1",
  "ynx_product_pay_transport_retire_v1"
]);
export const auth5=Object.freeze([
  "ynx_product_pay_source_profile_v1",
  "ynx_product_pay_source_full_current_v1",
  "ynx_product_pay_source_current_no_io_v1",
  "ynx_product_pay_source_retain_v1",
  "ynx_product_pay_source_release_v1"
]);
export function assertRoot14StrongSymbolsDATA(globals,attributes,names){
 if(typeof globals!=='string'||typeof attributes!=='string'||!Array.isArray(names))throw Error('ROOT14_STRONG_DATA_INVALID');
 for(const name of names){const token='_'+name,rows=globals.split('\n').filter(l=>l.trim().split(/\s+/).at(-1)===token),attrs=attributes.split('\n').filter(l=>l.trim().split(/\s+/).at(-1)===token);if(rows.length!==1||!/^[a-f0-9]+\s+[TDSB]\s+_/.test(rows[0].trim())||attrs.length!==1||/\bweak\b|\bundefined\b/.test(attrs[0]))throw Error('ROOT14_MISSING_WEAK_OR_DUPLICATE:'+name);}
 return {symbols:names.length,RootAdmission:false};
}
function nm(p,flags){const r=spawnSync('/usr/bin/nm',[...flags,p],{encoding:'utf8',maxBuffer:64<<20});if(r.status!==0)throw Error('ROOT14_NM_FAILED');return r.stdout;}
export function check(plan){
 if(plan.recipeRole!=='YNX_ROOT14_PRODUCT45_RESOURCE8_SHARED69_NORMAL_NATIVE/v1'||plan.goArchives?.length!==1||plan.goArchives[0].sha256!=='b5e020d2d7f7e5fc501320be2da85e9b76a2e54433fdd70814447dbc06e180ed')throw Error('ROOT14_EXACT_SINGLE_B5_ARCHIVE_REQUIRED');
 const original=checkOriginal(plan);assertRoot14StrongSymbolsDATA(nm(plan.goArchives[0].path,['-g']),nm(plan.goArchives[0].path,['-m']),go45);assertRoot14StrongSymbolsDATA(nm(plan.image.path,['-g']),nm(plan.image.path,['-m']),[...go45,...auth5]);
 return {kind:'ROOT14_PRODUCT45_STRONG_GATE/v1',passed:true,Core15:15,LINK22:22,Product8:8,GoArchiveStrong:45,AuthNativeStrong:5,legacyRequired42Preserved:true,ownedUndefined:0,image:plan.image,archive:plan.goArchives[0],original,RootAdmission:false,SourceAdmission:false,normalFactoryComplete:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv.length!==3)throw Error('ROOT14_GATE_ARGV');console.log(JSON.stringify(check(JSON.parse(fs.readFileSync(process.argv[2]))),null,2));}
