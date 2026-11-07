// Closed Darwin NAPI-only import policy. No blanket dynamic_lookup, weak or
// executable ordinal binding. This is link/readback CODE, never Source admission.
import {isDeepStrictEqual} from 'node:util';
export const REVIEWED_SINGLE49_NAPI_IMPORTS=Object.freeze(["_napi_add_env_cleanup_hook","_napi_add_finalizer","_napi_call_function","_napi_check_object_type_tag","_napi_close_handle_scope","_napi_create_array","_napi_create_array_with_length","_napi_create_arraybuffer","_napi_create_async_work","_napi_create_bigint_uint64","_napi_create_buffer_copy","_napi_create_double","_napi_create_error","_napi_create_function","_napi_create_int32","_napi_create_object","_napi_create_promise","_napi_create_reference","_napi_create_string_utf8","_napi_create_typedarray","_napi_create_uint32","_napi_define_properties","_napi_delete_async_work","_napi_delete_reference","_napi_get_all_property_names","_napi_get_and_clear_last_exception","_napi_get_array_length","_napi_get_boolean","_napi_get_buffer_info","_napi_get_cb_info","_napi_get_element","_napi_get_global","_napi_get_named_property","_napi_get_null","_napi_get_property","_napi_get_prototype","_napi_get_reference_value","_napi_get_typedarray_info","_napi_get_undefined","_napi_get_uv_event_loop","_napi_get_value_bigint_uint64","_napi_get_value_bool","_napi_get_value_double","_napi_get_value_string_utf8","_napi_has_named_property","_napi_has_own_property","_napi_is_arraybuffer","_napi_is_buffer","_napi_is_detached_arraybuffer","_napi_is_exception_pending","_napi_is_promise","_napi_is_typedarray","_napi_new_instance","_napi_object_freeze","_napi_open_handle_scope","_napi_queue_async_work","_napi_reference_unref","_napi_reject_deferred","_napi_remove_env_cleanup_hook","_napi_resolve_deferred","_napi_set_element","_napi_set_named_property","_napi_set_property","_napi_strict_equals","_napi_throw","_napi_throw_error","_napi_type_tag_object","_napi_typeof","_napi_unwrap","_napi_wrap"]);
const fail=c=>{throw Object.assign(Error(c),{code:c});};
export function single49NAPIImportLinkerArgsDATA(){return REVIEWED_SINGLE49_NAPI_IMPORTS.flatMap(s=>['-Xlinker','-U','-Xlinker',s]);}
export function assertSingle49NAPIImportLinkDATA(argv){
 if(!Array.isArray(argv)||argv.some(a=>typeof a!=='string'||/bundle_loader|dynamic_lookup|weak_library|weak_framework|flat_namespace|^-Wl,/.test(a)))fail('NAPI_FINITE_STRICT_LINK_REQUIRED');
 const selected=[];for(let i=0;i<argv.length;i++)if(argv[i]==='-U'){if(argv[i-1]!=='-Xlinker'||argv[i+1]!=='-Xlinker'||typeof argv[i+2]!=='string')fail('NAPI_FINITE_U_FORM');selected.push(argv[i+2]);i+=2;}
 if(!isDeepStrictEqual(selected,REVIEWED_SINGLE49_NAPI_IMPORTS)||!isDeepStrictEqual(argv.slice(-4),['-Xlinker','-undefined','-Xlinker','error']))fail('NAPI_FINITE_IMPORT_LIST_DIFFERS');
 return{reviewedNAPIImports:selected.length,globalUndefined:'error',executableOrdinalBinding:false,RootAdmission:false,SourceAdmission:false};
}
export function replaceSingle49ExecutableNAPIImportsDATA(argv,oldTargetNode){
 const seq=['-Xlinker','-bundle_loader','-Xlinker',oldTargetNode];let at=-1;
 for(let i=0;i<argv.length-3;i++)if(isDeepStrictEqual(argv.slice(i,i+4),seq)){if(at!==-1)fail('NAPI_DUPLICATE_BUNDLE_LOADER');at=i;}
 if(at<0)fail('NAPI_ORIGINAL_BUNDLE_LOADER_REQUIRED');
 const result=[...argv.slice(0,at),...single49NAPIImportLinkerArgsDATA(),...argv.slice(at+4)];assertSingle49NAPIImportLinkDATA(result);return result;
}
export function assertSingle49NAPIImageImportsDATA(nmM){
 if(typeof nmM!=='string')fail('NAPI_NM_M_REQUIRED');const seen=[];
 for(const line of nmM.split('\n')){if(!line.includes('(undefined)'))continue;
  const m=/\s(_[A-Za-z0-9_$]+)(?:\s|$)/.exec(line);if(!m)fail('NAPI_UNDEFINED_ROW_UNKNOWN');const symbol=m[1];
  if(/^_(?:ynx|YNX)/.test(symbol))fail('NAPI_OWN_STRONG_UNDEFINED:'+symbol);
  if(/^_(?:napi_|node_api_)/.test(symbol)){
   if(!REVIEWED_SINGLE49_NAPI_IMPORTS.includes(symbol)||!/\(undefined\) external /.test(line)||/\bweak\b|from executable/.test(line)||!line.endsWith('(dynamically looked up)'))fail('NAPI_INVALID_IMPORT_BINDING:'+symbol);seen.push(symbol);
  }else if(line.includes('dynamically looked up')||line.includes('from executable'))fail('NAPI_FOREIGN_DYNAMIC_OR_EXECUTABLE_IMPORT:'+symbol);
 }
 if(!isDeepStrictEqual(seen.sort(),REVIEWED_SINGLE49_NAPI_IMPORTS))fail('NAPI_NM_IMPORT_SET_DIFFERS');return{NAPIImports:seen.length,allNAPIExplicitDynamic:true,foreignDynamicImports:0,ownedUndefined:0,RootAdmission:false,SourceAdmission:false};
}

export function assertSingle49NAPIHostReadbacksDATA(node,electron,image){
 const check=(v,kind,versions)=>{if(!v||v.kind!==kind||v.actualImageLoaded!==true||v.SourceAcquired!==false||v.RootAdmission!==false||v.SourceAdmission!==false||!isDeepStrictEqual(v.versions,versions)||!isDeepStrictEqual(v.image,{bytes:image.bytes,sha256:image.sha256}))fail('NAPI_ACTUAL_DUAL_RUNTIME_READBACK_REQUIRED');};
 check(node,'node24',{node:'24.19.0',electron:null,modules:'137',napi:'10'});check(electron,'electron42',{node:'24.18.1',electron:'42.10.0',modules:'146',napi:'10'});
 return{NodeLoad:true,ElectronLoad:true,RootAdmission:false,SourceAdmission:false};
}
