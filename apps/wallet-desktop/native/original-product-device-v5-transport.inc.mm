// Include in the SAME original Node TU after DeviceV4ReadIntrinsics and its
// pure Ref/Keep/PlainFrozen/DataProperty/SignalCurrent helpers. These utilities
// are not Source permission; no V4 Source, E5 or GET capability is consumed.
#include "original-product-device-v5-transport.h"
#include <CommonCrypto/CommonDigest.h>
#include <pthread.h>
#include <thread>
#include <unordered_map>
#include <vector>
#include <algorithm>
#include <string>
#include <cstring>
namespace ynx_auth_private {
struct ProductDeviceV5Transport::Impl:std::enable_shared_from_this<Impl> {
 static constexpr size_t bodyCap=68288512;
 struct Ref {napi_ref value=nullptr;bool deleteSelected=false;};
 struct Runtime {
  napi_ref then=nullptr,promisePrototype=nullptr,promiseConstructor=nullptr,speciesGetter=nullptr,speciesBox=nullptr,resizable=nullptr;
  std::vector<std::weak_ptr<Impl>>owners;std::vector<std::shared_ptr<Impl>>debts;bool closing=false;
 };
 static std::unordered_map<napi_env,Runtime>&runtimes(){static thread_local std::unordered_map<napi_env,Runtime>r;return r;}
 napi_env env=nullptr;ProductDeviceV5NativeSource*source=nullptr;std::thread::id actor=std::this_thread::get_id();
 YNXAuthIdentitySourceAuthority*__strong nativeSource=nil;
 Ref parent,module,peer,context,signal,isPeer,reader,currentFn,recheckFn,bodyReader,contextFn,firstBox,closeBox;
 NSData*__strong body=nil;NSDictionary*__strong metadata=nil;NSDictionary*__strong binding=nil;
 bool firstPresent=false,closePresent=false,captured=false,pending=false,retired=false,closeSelected=false,closed=false,envClosing=false,ownerGone=false;size_t borrows=0;
 static napi_value undefined(napi_env e){return DeviceV4Undefined(e);}
 static napi_value ref(napi_env e,const Ref&r){return DeviceV4Ref(e,r.value);}
 bool onActor(napi_env e)const{return env==e&&actor==std::this_thread::get_id()&&pthread_main_np()&&!envClosing;}
 static bool proxy(napi_env e,napi_value v){auto i=deviceV4ReadIntrinsics.find(e);bool yes=true;return i==deviceV4ReadIntrinsics.end()||!v||!DeviceV4CallBool(e,i->second.proxy,undefined(e),v,yes)||yes;}
 static napi_value descriptor(napi_env e,napi_value object,napi_value key){auto it=deviceV4ReadIntrinsics.find(e);if(it==deviceV4ReadIntrinsics.end()||proxy(e,object))return nullptr;napi_value out=nullptr,args[]={object,key};return napi_call_function(e,undefined(e),DeviceV4Ref(e,it->second.descriptor),2,args,&out)==napi_ok?out:nullptr;}
 static bool keep(napi_env e,napi_value v,Ref&r){return !r.value&&v&&DeviceV4Keep(e,v,r.value);}
 static bool equal(napi_env e,napi_value a,napi_value b){bool same=false;return a&&b&&napi_strict_equals(e,a,b,&same)==napi_ok&&same;}
 static napi_value ownData(napi_env e,napi_value object,const char*name){if(proxy(e,object))return nullptr;napi_value key=nullptr;bool own=false;if(napi_create_string_utf8(e,name,NAPI_AUTO_LENGTH,&key)!=napi_ok||napi_has_own_property(e,object,key,&own)!=napi_ok||!own)return nullptr;auto d=descriptor(e,object,key);napi_value enumerable=nullptr;bool yes=false;if(!d||napi_get_named_property(e,d,"enumerable",&enumerable)!=napi_ok||napi_get_value_bool(e,enumerable,&yes)!=napi_ok||!yes)return nullptr;return DeviceV4DataProperty(e,object,name);}
 static napi_value cause(napi_env e,const Ref&r){auto b=ref(e,r);napi_value v=nullptr;return b&&napi_get_named_property(e,b,"cause",&v)==napi_ok?v:nullptr;}
 bool box(napi_value value,Ref&target){napi_value b=nullptr;if(napi_create_object(env,&b)!=napi_ok)return false;napi_property_descriptor d={"cause",nullptr,nullptr,nullptr,nullptr,value,napi_default,nullptr};return napi_define_properties(env,b,1,&d)==napi_ok&&keep(env,b,target);}
 void remember(napi_value value){if(!firstPresent){firstPresent=true;box(value,firstBox);}}
 void rememberPending(const char*code){bool p=false;napi_value e=nullptr;if(napi_is_exception_pending(env,&p)==napi_ok&&p)napi_get_and_clear_last_exception(env,&e);if(!e)e=DeviceV4Error(env,code);if(e)remember(e);else firstPresent=true;}
 bool fail(const char*code){rememberPending(code);return false;}
 bool throwFirst(){napi_value e=cause(env,firstBox);if(e)napi_throw(env,e);else DeviceV4Throw(env,"PRODUCT_DEVICE_V5_TRANSPORT_FIRST_UNKNOWN");return false;}
 bool closeFailure(const char*code){if(!closePresent){closePresent=true;bool pending=false;napi_value e=nullptr;if(napi_is_exception_pending(env,&pending)==napi_ok&&pending)napi_get_and_clear_last_exception(env,&e);if(!e)e=DeviceV4Error(env,code);if(e)box(e,closeBox);}return false;}
 bool sameOwner(napi_env e,ProductDeviceV5NativeSource*s,napi_value p,napi_value n,napi_value c){
  if(!onActor(e))return false;
  if(source!=s||!equal(e,p,ref(e,parent))||!equal(e,n,ref(e,peer))||!equal(e,c,ref(e,context)))return fail("PRODUCT_DEVICE_V5_TRANSPORT_SAME_OWNER_REQUIRED");return true;
 }
 napi_value call(const Ref&fn,size_t count,napi_value*args){napi_value out=nullptr;return napi_call_function(env,undefined(env),ref(env,fn),count,args,&out)==napi_ok?out:nullptr;}
 bool current(){
  if(!onActor(env))return false;if(firstPresent)return false;if(retired||closeSelected||closed)return fail("PRODUCT_DEVICE_V5_TRANSPORT_RETIRED");
  auto c=ref(env,context),s=ref(env,signal);if(!DeviceV4PlainFrozen(env,c,1)||!equal(env,ownData(env,c,"signal"),s)||!DeviceV4SignalCurrent(env,s))return fail("PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_CONTEXT");
  napi_value args[]={ref(env,peer),c};auto checked=call(contextFn,2,args);napi_valuetype type;
  if(!checked||napi_typeof(env,checked,&type)!=napi_ok||type!=napi_undefined)return fail("PRODUCT_DEVICE_V5_TRANSPORT_CONTEXT_REFUSED");
  checked=call(currentFn,1,args);if(!checked||napi_typeof(env,checked,&type)!=napi_ok||type!=napi_undefined)return fail("PRODUCT_DEVICE_V5_TRANSPORT_CURRENT_REFUSED");
  if(!DeviceV4SignalCurrent(env,s))return fail("PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_CONTEXT");return true;
 }
 static NSString*text(napi_env e,napi_value v,size_t cap,bool empty=false){
  napi_valuetype type;size_t size=0,copied=0;if(!v||napi_typeof(e,v,&type)!=napi_ok||type!=napi_string||napi_get_value_string_utf8(e,v,nullptr,0,&size)!=napi_ok||size>cap||(!empty&&!size))return nil;
  std::vector<char>b(size+1);if(napi_get_value_string_utf8(e,v,b.data(),b.size(),&copied)!=napi_ok||copied!=size||std::memchr(b.data(),0,size))return nil;return [[NSString alloc]initWithBytes:b.data() length:size encoding:NSUTF8StringEncoding];
 }
 static bool asciiToken(NSString*s,size_t min,size_t max,const char*extra=""){
  if(!s||s.length<min||s.length>max)return false;for(NSUInteger i=0;i<s.length;i++){unichar c=[s characterAtIndex:i];if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||std::strchr(extra,(char)c))||c>127||c==0)return false;}return true;
 }
 static bool hex(NSString*s,size_t n){if(!s||s.length!=n)return false;for(NSUInteger i=0;i<n;i++){unichar c=[s characterAtIndex:i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;}return true;}
 static bool decimal(NSString*s,bool nonzero=false){if(!s||!s.length||s.length>20||(s.length>1&&[s characterAtIndex:0]=='0'))return false;for(NSUInteger i=0;i<s.length;i++){auto c=[s characterAtIndex:i];if(c<'0'||c>'9')return false;}if(nonzero&&[s isEqual:@"0"])return false;return s.length<20||[s compare:@"18446744073709551615"]!=NSOrderedDescending;}
 bool captureView(napi_value view){
  if(!DeviceV4PlainFrozen(env,view,9))return fail("PRODUCT_DEVICE_V5_TRANSPORT_VIEW_EXACT9");
  NSMutableDictionary*d=[NSMutableDictionary new];for(const char*k:{"version","requestId","method","path","url","contentType","expectedSlotRevision","rollbackTarget"}){
   auto v=ownData(env,view,k);NSString*s=text(env,v,std::string(k)=="url"?2048:std::string(k)=="contentType"?99:128,std::string(k)=="rollbackTarget");if(!s)return fail("PRODUCT_DEVICE_V5_TRANSPORT_VIEW_DATA");d[[NSString stringWithUTF8String:k]]=s;
  }
  NSString*ctype=d[@"contentType"];NSString*const prefix=@"multipart/form-data; boundary=";NSString*boundary=[ctype hasPrefix:prefix]?[ctype substringFromIndex:prefix.length]:nil;
  NSURLComponents*u=[NSURLComponents componentsWithString:d[@"url"]];
  if(![d[@"version"]isEqual:@"5"]||![d[@"method"]isEqual:@"POST"]||![d[@"path"]isEqual:@"/api/v1/ide/deployments"]||!asciiToken(d[@"requestId"],1,128,"._:-")||!asciiToken(boundary,1,70,"_-")||!decimal(d[@"expectedSlotRevision"])||[d[@"rollbackTarget"]rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"\r\n"]].location!=NSNotFound||!u||![u.scheme isEqual:@"https"]||!u.host.length||u.host.length>253||u.user||u.password||u.query||u.fragment||![u.path isEqual:d[@"path"]]||![u.URL.absoluteString isEqual:d[@"url"]])return fail("PRODUCT_DEVICE_V5_TRANSPORT_VIEW_BINDING");
  napi_value value=ownData(env,view,"bodyOriginal");if(proxy(env,value))return fail("PRODUCT_DEVICE_V5_TRANSPORT_BODY_BYTES");bool buffer=false,ab=false,detached=true;size_t length=0,offset=0;void*raw=nullptr;napi_value arrayBuffer=nullptr;napi_typedarray_type kind;
  if(napi_is_buffer(env,value,&buffer)!=napi_ok||!buffer||napi_get_typedarray_info(env,value,&kind,&length,&raw,&arrayBuffer,&offset)!=napi_ok||kind!=napi_uint8_array||!raw||!length||length>bodyCap||napi_is_arraybuffer(env,arrayBuffer,&ab)!=napi_ok||!ab||napi_is_detached_arraybuffer(env,arrayBuffer,&detached)!=napi_ok||detached)return fail("PRODUCT_DEVICE_V5_TRANSPORT_BODY_BYTES");
  auto runtime=runtimes().find(env);bool resizable=true;if(runtime==runtimes().end()||!DeviceV4CallBool(env,runtime->second.resizable,arrayBuffer,nullptr,resizable)||resizable)return fail("PRODUCT_DEVICE_V5_TRANSPORT_BODY_STABLE");
  // Adopt the original returned bytes before ANY subsequent SDK/current call.
  NSData*copied=[[NSData alloc]initWithBytes:raw length:length];if(!copied||copied.length!=length)return fail("PRODUCT_DEVICE_V5_TRANSPORT_BODY_COPY_UNKNOWN");body=copied;captured=true;metadata=[d copy];return true;
 }
 bool captureBinding(napi_value value){
  if(!DeviceV4PlainFrozen(env,value,3))return fail("PRODUCT_DEVICE_V5_TRANSPORT_BODY_DATA_EXACT3");
  NSString*ctype=text(env,ownData(env,value,"contentType"),99),*sha=text(env,ownData(env,value,"bodyDigest"),64);auto nested=ownData(env,value,"bodyBinding");
  if(!ctype||![ctype isEqual:metadata[@"contentType"]]||!hex(sha,64)||!DeviceV4PlainFrozen(env,nested,3))return fail("PRODUCT_DEVICE_V5_TRANSPORT_BODY_BINDING");
  NSString*size=text(env,ownData(env,nested,"bytes"),20),*a=text(env,ownData(env,nested,"sha3_512"),128),*b=text(env,ownData(env,nested,"sha512"),128);
  if(!decimal(size,true)||![size isEqual:[NSString stringWithFormat:@"%lu",(unsigned long)body.length]]||!hex(a,128)||!hex(b,128))return fail("PRODUCT_DEVICE_V5_TRANSPORT_BODY_BINDING");
  unsigned char digest[32];CC_SHA256(body.bytes,(CC_LONG)body.length,digest);NSMutableString*actual=[NSMutableString new];for(unsigned char c:digest)[actual appendFormat:@"%02x",c];if(![actual isEqual:sha])return fail("PRODUCT_DEVICE_V5_TRANSPORT_BODY_DIGEST");
  binding=@{@"contentType":ctype,@"bodyDigest":sha,@"bodyBinding":@{@"bytes":size,@"sha3_512":a,@"sha512":b}};return true;
 }
 bool read(napi_value fixedModule,napi_value originalPeer,napi_value originalContext,napi_value originalParent){
  if(!keep(env,originalParent,parent)||!keep(env,fixedModule,module)||!keep(env,originalPeer,peer)||!keep(env,originalContext,context))return fail("PRODUCT_DEVICE_V5_TRANSPORT_REFS_UNKNOWN");
  if(proxy(env,fixedModule)||proxy(env,originalPeer)||!DeviceV4PlainFrozen(env,originalContext,1))return fail("PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_PEER_CONTEXT");
  auto s=ownData(env,originalContext,"signal");if(!s||!keep(env,s,signal))return fail("PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_CONTEXT");
  const std::pair<const char*,Ref*>fns[]={{"isOriginalHTTPBinaryTransportV5Peer",&isPeer},{"readOriginalHTTPBinaryTransportV5ForNative",&reader},{"assertOriginalHTTPBinaryTransportV5Current",&currentFn},{"recheckOriginalHTTPBinaryTransportV5",&recheckFn},{"readOriginalHTTPBinaryTransportV5BodyDATAForNative",&bodyReader},{"assertOriginalHTTPBinaryTransportV5Context",&contextFn}};
  for(const auto&f:fns){auto fn=ownData(env,fixedModule,f.first);napi_valuetype type;if(!fn||proxy(env,fn)||napi_typeof(env,fn,&type)!=napi_ok||type!=napi_function||!keep(env,fn,*f.second))return fail(f.second==&contextFn?"PRODUCT_DEVICE_V5_CONTEXT_NOT_SUPPLIED":"PRODUCT_DEVICE_V5_TRANSPORT_FIXED_CALLEE_NOT_SUPPLIED");}
  napi_value args[]={originalPeer};auto recognized=call(isPeer,1,args);bool yes=false;if(!recognized||napi_get_value_bool(env,recognized,&yes)!=napi_ok||!yes)return fail("PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_PEER_REQUIRED");
  if(!current())return false;auto view=call(reader,1,args);if(!view)return fail("PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_READ_FAILED");if(!captureView(view))return false;
  auto data=call(bodyReader,1,args);if(!data)return fail("PRODUCT_DEVICE_V5_TRANSPORT_BODY_DATA_FAILED");if(!captureBinding(data))return false;return current();
 }
 bool safePromise(napi_value promise){
  bool yes=false;if(proxy(env,promise)||napi_is_promise(env,promise,&yes)!=napi_ok||!yes)return false;auto it=runtimes().find(env);if(it==runtimes().end())return false;auto&r=it->second;napi_value proto=nullptr,key=nullptr;bool own=false;
  if(napi_get_prototype(env,promise,&proto)!=napi_ok||!equal(env,proto,DeviceV4Ref(env,r.promisePrototype)))return false;
  napi_create_string_utf8(env,"constructor",NAPI_AUTO_LENGTH,&key);if(napi_has_own_property(env,promise,key,&own)!=napi_ok||own||!equal(env,DeviceV4DataProperty(env,proto,"constructor"),DeviceV4Ref(env,r.promiseConstructor)))return false;
  auto box=DeviceV4Ref(env,r.speciesBox);napi_value species=nullptr;if(!box||napi_get_named_property(env,box,"key",&species)!=napi_ok)return false;auto d=descriptor(env,DeviceV4Ref(env,r.promiseConstructor),species);return d&&equal(env,DeviceV4DataProperty(env,d,"get"),DeviceV4Ref(env,r.speciesGetter));
 }
 struct Flight {
  std::shared_ptr<Impl>owner;napi_ref originalPromise=nullptr;napi_deferred deferred=nullptr;unsigned refs=1;bool done=false;
  void drop(){if(!--refs){if(originalPromise&&!owner->envClosing)napi_delete_reference(owner->env,originalPromise);delete this;}}
  static void finalize(napi_env,void*raw,void*){static_cast<Flight*>(raw)->drop();}
  static napi_value settle(napi_env env,napi_callback_info info){
   size_t count=1;napi_value value=nullptr;void*raw=nullptr;napi_get_cb_info(env,info,&count,&value,nullptr,&raw);auto*pair=static_cast<std::pair<Flight*,bool>*>(raw);auto*f=pair->first;auto p=f->owner;
   if(f->done||p->envClosing)return undefined(env);f->done=true;bool ok=pair->second;
   if(!ok){p->remember(value?value:undefined(env));}else{napi_valuetype t;if(!value||napi_typeof(env,value,&t)!=napi_ok||t!=napi_undefined)ok=p->fail("PRODUCT_DEVICE_V5_TRANSPORT_RECHECK_RESULT");else ok=p->current();}
   p->pending=false;if(ok)napi_resolve_deferred(env,f->deferred,undefined(env));else{if(!p->firstPresent)p->fail("PRODUCT_DEVICE_V5_TRANSPORT_RECHECK_FAILED");napi_reject_deferred(env,f->deferred,cause(env,p->firstBox)?:DeviceV4Error(env,"PRODUCT_DEVICE_V5_TRANSPORT_RECHECK_FAILED"));}p->closeOrphan();return undefined(env);
  }
  static void finalizePair(napi_env e,void*raw,void*){auto*p=static_cast<std::pair<Flight*,bool>*>(raw);finalize(e,p->first,nullptr);delete p;}
 };
 napi_value recheck(){
  if(pending||!current()){if(!firstPresent)fail("PRODUCT_DEVICE_V5_TRANSPORT_RECHECK_PENDING");throwFirst();return nullptr;}
  napi_value returned=nullptr;auto*f=new(std::nothrow)Flight;if(!f){fail("PRODUCT_DEVICE_V5_TRANSPORT_RECHECK_CAPACITY");throwFirst();return nullptr;}f->owner=shared_from_this();
  if(napi_create_promise(env,&f->deferred,&returned)!=napi_ok){delete f;fail("PRODUCT_DEVICE_V5_TRANSPORT_RECHECK_PROMISE");throwFirst();return nullptr;}pending=true;
  napi_value arg=ref(env,peer),promise=call(recheckFn,1,&arg);bool attached=false;
  if(promise&&safePromise(promise)&&DeviceV4Keep(env,promise,f->originalPromise)){
   napi_value callbacks[2]{};bool ready=true;for(unsigned i=0;i<2;i++){auto*pair=new(std::nothrow)std::pair<Flight*,bool>(f,i==0);if(!pair){ready=false;break;}
    if(napi_create_function(env,i?"v5OriginalRecheckRejected":"v5OriginalRecheckComplete",NAPI_AUTO_LENGTH,Flight::settle,pair,&callbacks[i])!=napi_ok||napi_add_finalizer(env,callbacks[i],pair,Flight::finalizePair,nullptr,nullptr)!=napi_ok){delete pair;ready=false;break;}f->refs++;
   }
   napi_value ignored=nullptr;if(ready&&napi_call_function(env,promise,DeviceV4Ref(env,runtimes().at(env).then),2,callbacks,&ignored)==napi_ok)attached=true;
  }
  if(!attached){fail("PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_RECHECK_PROMISE_REQUIRED");pending=false;f->done=true;napi_reject_deferred(env,f->deferred,cause(env,firstBox)?:DeviceV4Error(env,"PRODUCT_DEVICE_V5_TRANSPORT_RECHECK_FAILED"));}f->drop();return returned;
 }
 bool close(){
  if(!onActor(env))return false;retired=true;if(closed)return true;if(pending||borrows)return closeFailure("PRODUCT_DEVICE_V5_TRANSPORT_JOIN_PENDING");if(closeSelected)return false;closeSelected=true;
  bool ok=true;for(Ref*r:{&parent,&module,&peer,&context,&signal,&isPeer,&reader,&currentFn,&recheckFn,&bodyReader,&contextFn})if(r->value){r->deleteSelected=true;if(napi_delete_reference(env,r->value)==napi_ok)r->value=nullptr;else ok=false;}
  if(!ok)return closeFailure("PRODUCT_DEVICE_V5_TRANSPORT_CLOSE_UNKNOWN");body=nil;metadata=nil;binding=nil;source=nullptr;nativeSource=nil;closed=true;return true;
 }
 void closeOrphan(){if(!ownerGone||pending||borrows||!onActor(env))return;if(close()){auto it=runtimes().find(env);if(it!=runtimes().end()){auto&d=it->second.debts;d.erase(std::remove_if(d.begin(),d.end(),[this](const std::shared_ptr<Impl>&p){return p.get()==this;}),d.end());}}}
 ~Impl(){if(!envClosing&&actor==std::this_thread::get_id()&&pthread_main_np())for(Ref*r:{&parent,&module,&peer,&context,&signal,&isPeer,&reader,&currentFn,&recheckFn,&bodyReader,&contextFn,&firstBox,&closeBox})if(r->value&&!r->deleteSelected)napi_delete_reference(env,r->value);}
 static void envCleanup(void*raw){auto env=(napi_env)raw;auto it=runtimes().find(env);if(it==runtimes().end())return;auto&r=it->second;r.closing=true;for(auto&w:r.owners)if(auto p=w.lock()){p->envClosing=true;p->retired=true;}for(auto v:{r.then,r.promisePrototype,r.promiseConstructor,r.speciesGetter,r.speciesBox,r.resizable})if(v)napi_delete_reference(env,v);r.debts.clear();runtimes().erase(it);}
 static bool initialize(napi_env env){
  if(runtimes().count(env))return !runtimes().at(env).closing;if(!pthread_main_np()||!deviceV4ReadIntrinsics.count(env))return false;Runtime r;napi_value global=nullptr,promise=nullptr,proto=nullptr,then=nullptr,ab=nullptr,abproto=nullptr,key=nullptr,d=nullptr,getter=nullptr,symbol=nullptr,species=nullptr,box=nullptr;napi_get_global(env,&global);
  auto keepRef=[&](napi_value v,napi_ref&target){return v&&!proxy(env,v)&&DeviceV4Keep(env,v,target);};bool ok=napi_get_named_property(env,global,"Promise",&promise)==napi_ok&&napi_get_named_property(env,promise,"prototype",&proto)==napi_ok&&napi_get_named_property(env,proto,"then",&then)==napi_ok&&keepRef(then,r.then)&&keepRef(proto,r.promisePrototype)&&keepRef(promise,r.promiseConstructor);
  if(ok)ok=napi_get_named_property(env,global,"Symbol",&symbol)==napi_ok&&napi_get_named_property(env,symbol,"species",&species)==napi_ok&&napi_create_object(env,&box)==napi_ok&&napi_set_named_property(env,box,"key",species)==napi_ok&&keepRef(box,r.speciesBox);
  if(ok){d=descriptor(env,promise,species);getter=d?DeviceV4DataProperty(env,d,"get"):nullptr;ok=keepRef(getter,r.speciesGetter);}
  if(ok)ok=napi_get_named_property(env,global,"ArrayBuffer",&ab)==napi_ok&&napi_get_named_property(env,ab,"prototype",&abproto)==napi_ok&&napi_create_string_utf8(env,"resizable",NAPI_AUTO_LENGTH,&key)==napi_ok;
  if(ok){d=descriptor(env,abproto,key);getter=d?DeviceV4DataProperty(env,d,"get"):nullptr;ok=keepRef(getter,r.resizable);}
  if(ok){runtimes().emplace(env,std::move(r));if(napi_add_env_cleanup_hook(env,envCleanup,env)==napi_ok)return true;envCleanup(env);return false;}
  for(auto v:{r.then,r.promisePrototype,r.promiseConstructor,r.speciesGetter,r.speciesBox,r.resizable})if(v)napi_delete_reference(env,v);return false;
 }
};
ProductDeviceV5Transport::ProductDeviceV5Transport():impl_(std::make_shared<Impl>()){}
bool ProductDeviceV5Transport::initialize(napi_env env){return Impl::initialize(env);}
std::unique_ptr<ProductDeviceV5Transport>ProductDeviceV5Transport::capture(napi_env env,ProductDeviceV5NativeSource*source,YNXAuthIdentitySourceAuthority*nativeSource,napi_value parent,napi_value module,napi_value peer,napi_value context){
 auto t=std::unique_ptr<ProductDeviceV5Transport>(new ProductDeviceV5Transport);auto&p=*t->impl_;p.env=env;p.source=source;p.nativeSource=nativeSource;
 if(!p.onActor(env))return nullptr;auto runtime=Impl::runtimes().find(env);if(runtime==Impl::runtimes().end()||runtime->second.closing){p.fail("PRODUCT_DEVICE_V5_TRANSPORT_INTRINSICS_NOT_SUPPLIED");return t;}runtime->second.owners.push_back(t->impl_);
 try{@try{if(!source||!nativeSource)p.fail("PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_SOURCE_REQUIRED");else p.read(module,peer,context,parent);}@catch(id){p.fail("PRODUCT_DEVICE_V5_TRANSPORT_OBJC_CAPTURE_UNKNOWN");}}catch(...){p.fail("PRODUCT_DEVICE_V5_TRANSPORT_CPP_CAPTURE_UNKNOWN");}return t;
}
bool ProductDeviceV5Transport::assertCurrent(napi_env env,ProductDeviceV5NativeSource*s,napi_value parent,napi_value peer,napi_value context){auto&p=*impl_;if(!p.sameOwner(env,s,parent,peer,context)||!p.current())return p.onActor(env)?p.throwFirst():false;return true;}
napi_value ProductDeviceV5Transport::recheck(napi_env env,ProductDeviceV5NativeSource*s,napi_value parent,napi_value peer,napi_value context){auto&p=*impl_;if(!p.sameOwner(env,s,parent,peer,context)){if(p.onActor(env))p.throwFirst();return nullptr;}return p.recheck();}
ProductDeviceV5Transport::BodyBorrow::BodyBorrow(std::shared_ptr<Impl>p):owner_(std::move(p)),body_(owner_->body){owner_->borrows++;}
ProductDeviceV5Transport::BodyBorrow::~BodyBorrow(){if(owner_&&owner_->onActor(owner_->env)&&owner_->borrows){owner_->borrows--;owner_->closeOrphan();}}
const void*ProductDeviceV5Transport::BodyBorrow::bytes()const{return owner_->onActor(owner_->env)?body_.bytes:nullptr;}
size_t ProductDeviceV5Transport::BodyBorrow::length()const{return owner_->onActor(owner_->env)?body_.length:0;}
NSData*ProductDeviceV5Transport::BodyBorrow::dataDATA()const{return owner_->onActor(owner_->env)?body_:nil;}
std::unique_ptr<ProductDeviceV5Transport::BodyBorrow>ProductDeviceV5Transport::borrowOriginalBody(napi_env env,ProductDeviceV5NativeSource*s,napi_value parent,napi_value peer,napi_value context){if(!assertCurrent(env,s,parent,peer,context)||!impl_->captured||!impl_->body)return nullptr;return std::unique_ptr<BodyBorrow>(new BodyBorrow(impl_));}
bool ProductDeviceV5Transport::assertCurrentForFactory(YNXAuthIdentitySourceAuthority*source){auto&p=*impl_;if(!p.onActor(p.env))return false;if(!source||p.nativeSource!=source)return p.fail("PRODUCT_DEVICE_V5_TRANSPORT_SAME_NATIVE_SOURCE_REQUIRED");return p.sameOwner(p.env,p.source,Impl::ref(p.env,p.parent),Impl::ref(p.env,p.peer),Impl::ref(p.env,p.context))&&p.current();}
std::unique_ptr<ProductDeviceV5Transport::BodyBorrow>ProductDeviceV5Transport::borrowOriginalBodyForFactory(YNXAuthIdentitySourceAuthority*source){if(!assertCurrentForFactory(source)||!impl_->captured||!impl_->body)return nullptr;return std::unique_ptr<BodyBorrow>(new BodyBorrow(impl_));}
NSDictionary*ProductDeviceV5Transport::readonlyMetadataDATA()const{return impl_->onActor(impl_->env)?impl_->metadata:nil;}
NSDictionary*ProductDeviceV5Transport::originalBodyBindingDATA()const{return impl_->onActor(impl_->env)?impl_->binding:nil;}
bool ProductDeviceV5Transport::bodyCapturedDATA()const{return impl_->onActor(impl_->env)&&impl_->captured;}bool ProductDeviceV5Transport::pendingDATA()const{return impl_->onActor(impl_->env)&&impl_->pending;}bool ProductDeviceV5Transport::closedDATA()const{return impl_->onActor(impl_->env)&&impl_->closed;}
bool ProductDeviceV5Transport::firstCausePresentDATA()const{return impl_->onActor(impl_->env)&&impl_->firstPresent;}napi_value ProductDeviceV5Transport::firstCauseDATA()const{return impl_->onActor(impl_->env)?Impl::cause(impl_->env,impl_->firstBox):nullptr;}napi_value ProductDeviceV5Transport::closeCauseDATA()const{return impl_->onActor(impl_->env)?Impl::cause(impl_->env,impl_->closeBox):nullptr;}
void ProductDeviceV5Transport::retire(){if(impl_->onActor(impl_->env))impl_->retired=true;}
bool ProductDeviceV5Transport::close(){return impl_->close();}
ProductDeviceV5Transport::~ProductDeviceV5Transport(){if(!impl_)return;impl_->ownerGone=true;if(impl_->onActor(impl_->env)&&!impl_->close()){auto it=Impl::runtimes().find(impl_->env);if(it!=Impl::runtimes().end())it->second.debts.push_back(impl_);}}
}
