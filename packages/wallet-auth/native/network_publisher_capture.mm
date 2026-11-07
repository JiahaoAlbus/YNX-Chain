#include "network_publisher_napi_private.hpp"
#include "network_publisher_release_private.hpp"
#include "network_publisher_resource_ref_private.h"
#import "network_publisher_source_private.h"
#include "original-auth-source-v2-native-data.h"
#include "NetworkCurrentPairStore.h"
#include "NetworkPublisherReaderV2.hpp"
#include <cstdio>
#include <atomic>
#include <mutex>
#include <unordered_map>
#include <chrono>
#include <thread>
#include <array>
using Store=ynx::auth::network_current::NetworkCurrentPairStore;
using Journal=ynx_auth_private::HostDirfdJournal;
using Release=ynx::network::publisher::Release;
struct YNXOriginalNetworkPublisherResourceRef {
 std::atomic<unsigned>refs{1};std::atomic<bool>retired{false},closed{false};
 std::atomic<int64_t>lastWall{0},wallDeadline{0},monoDeadlineNS{0};
 std::array<std::string,10>text;YNXOriginalNetworkPublisherResourceBinding binding{};
};
namespace {
constexpr napi_type_tag captureTag={0x821aa36053ae4adfULL,0xad13fcd4a75f3471ULL},storeTag={0x327d825ab7124da7ULL,0x9a284462bb721731ULL};
struct Owner{napi_env env;std::thread::id actor=std::this_thread::get_id();YNXAuthIdentitySourceAuthority* __strong source=nil;NSDictionary* __strong context=nil;NSDictionary* __strong freshContext=nil;NSDictionary* __strong originals=nil;NSData* __strong p09Response=nil;std::shared_ptr<Journal>journal=std::make_shared<Journal>();std::unique_ptr<Store>pair;std::shared_ptr<YNXOriginalNetworkPublisherResourceRef>resource;std::unique_ptr<ynx::auth::network_publisher::ReaderV2>reader;const Release*release=nullptr;napi_ref first=nullptr,storeClose=nullptr,captureClose=nullptr;bool retired=false,joined=false,storeRetired=false,storeClosed=false,captureClosed=false,sourceLoan=false,intentSelected=false;};
struct Anchor{Owner*owner;bool store;};
std::mutex&inventoryMutex=*new std::mutex;
auto&owners=*new std::unordered_map<Owner*,std::shared_ptr<Owner>>;
auto&resources=*new std::unordered_map<YNXOriginalNetworkPublisherResourceRef*,std::shared_ptr<YNXOriginalNetworkPublisherResourceRef>>;
std::shared_ptr<YNXOriginalNetworkPublisherResourceRef>knownResource(YNXOriginalNetworkPublisherResourceRef*p){std::lock_guard<std::mutex>lock(inventoryMutex);auto i=resources.find(p);return i==resources.end()?nullptr:i->second;}
int64_t clockMS(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
int64_t monoNS(){return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
void ck(napi_status s){if(s!=napi_ok)throw std::runtime_error("NETWORK_PUBLISHER_NAPI_CALL");}
napi_value null(napi_env e){napi_value v;napi_get_null(e,&v);return v;}
napi_value text(napi_env e,const std::string&s){napi_value v;ck(napi_create_string_utf8(e,s.data(),s.size(),&v));return v;}
napi_value error(napi_env e,const char*c){auto s=text(e,c);napi_value v;ck(napi_create_error(e,nullptr,s,&v));ck(napi_set_named_property(e,v,"code",s));return v;}
napi_value getRef(napi_env e,napi_ref r){napi_value v;ck(napi_get_reference_value(e,r,&v));return v;}
void remember(const std::shared_ptr<Owner>&o,const char*code){if(o->resource)o->resource->retired=true;if(o->first)return;bool pending=false;napi_is_exception_pending(o->env,&pending);napi_value value;if(pending)napi_get_and_clear_last_exception(o->env,&value);else value=error(o->env,code);napi_value box;ck(napi_create_object(o->env,&box));ck(napi_set_named_property(o->env,box,"cause",value));ck(napi_create_reference(o->env,box,1,&o->first));}
napi_value first(const std::shared_ptr<Owner>&o){napi_value v;ck(napi_get_named_property(o->env,getRef(o->env,o->first),"cause",&v));return v;}
napi_value result(napi_env e,napi_value cause,napi_value partial=nullptr){napi_value v;ck(napi_create_object(e,&v));ck(napi_set_named_property(e,v,"error",cause));if(partial)ck(napi_set_named_property(e,v,"partial",partial));return v;}
napi_value promise(napi_env e,napi_value v){napi_value p;napi_deferred d;ck(napi_create_promise(e,&d,&p));ck(napi_resolve_deferred(e,d,v));return p;}
napi_value bytes(napi_env e,const std::string&s){void*p=nullptr;napi_value b,v;ck(napi_create_arraybuffer(e,s.size(),&p,&b));if(!s.empty())memcpy(p,s.data(),s.size());ck(napi_create_typedarray(e,napi_uint8_array,s.size(),b,0,&v));return v;}
std::string publicBytes(napi_env e,napi_value v,size_t max){bool typed=false;ck(napi_is_typedarray(e,v,&typed));if(!typed)throw std::runtime_error("NETWORK_PUBLISHER_BYTES_REQUIRED");napi_typedarray_type t;size_t n=0;void*p=nullptr;napi_value buffer;size_t off=0;ck(napi_get_typedarray_info(e,v,&t,&n,&p,&buffer,&off));bool ab=false;ck(napi_is_arraybuffer(e,buffer,&ab));if(!ab||t!=napi_uint8_array||!n||n>max||!p)throw std::runtime_error("NETWORK_PUBLISHER_OWNED_BYTES_REQUIRED");return std::string(static_cast<const char*>(p),n);}
std::string json(id value){NSData*d=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!d)throw std::runtime_error("NETWORK_PUBLISHER_PUBLIC_JSON");return std::string(static_cast<const char*>(d.bytes),d.length);}
napi_value convert(napi_env e,id value){if(!value||value==NSNull.null)return null(e);if([value isKindOfClass:NSString.class])return text(e,std::string([value UTF8String]?:""));if([value isKindOfClass:NSNumber.class]){napi_value v;if(CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID())napi_get_boolean(e,[value boolValue],&v);else napi_create_double(e,[value doubleValue],&v);return v;}if([value isKindOfClass:NSArray.class]){napi_value v;ck(napi_create_array_with_length(e,[value count],&v));for(NSUInteger i=0;i<[value count];++i)ck(napi_set_element(e,v,(uint32_t)i,convert(e,value[i])));ck(napi_object_freeze(e,v));return v;}if([value isKindOfClass:NSDictionary.class]){napi_value v;ck(napi_create_object(e,&v));for(NSString*k in value)ck(napi_set_named_property(e,v,k.UTF8String,convert(e,value[k])));ck(napi_object_freeze(e,v));return v;}throw std::runtime_error("NETWORK_PUBLISHER_PUBLIC_TYPE");}
bool op64(const std::string&s){return s.size()==64&&std::all_of(s.begin(),s.end(),[](char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');});}
void mintResource(const std::shared_ptr<Owner>&o){
 // Private normal call only, after full independent Cocoa Source admission.
 // These are EXPECTED target identities, NOT an observation of a Go peer.
 const auto&r=*o->release;NSDictionary*d=o->context[@"descriptor"];
 if(!o->source||![d isKindOfClass:NSDictionary.class]||r.registeredResourceRef!=std::string([d[@"resourceKey"]UTF8String]?:"")||r.registeredResourceRef!=std::string([d[@"originalLocator"][@"protectedResourceRef"]UTF8String]?:"")||r.peerUID!=getuid()||r.peerPID<=1||r.peerPID>INT32_MAX||r.peerStartSeconds==0||r.peerStartMicros>999999||!op64(r.peerImageSHA256)||!r.peerImageBytes||r.peerImagePath.empty()||r.peerImagePath==r.source.nodeImagePath||r.socketDirectory.empty()||r.socketLeaf.empty()||r.socketLeaf.find('/')!=std::string::npos||!r.directoryInode||!r.socketInode||r.timeoutMS<1||r.timeoutMS>10000)throw std::runtime_error("NETWORK_PUBLISHER_REGISTERED_P09_MAPPING_NOT_SUPPLIED");
 auto ref=std::make_shared<YNXOriginalNetworkPublisherResourceRef>();
 ref->text={std::string([d[@"networkId"]UTF8String]?:""),std::string([d[@"sourceId"]UTF8String]?:""),std::string([d[@"instanceId"]UTF8String]?:""),r.registeredResourceRef,r.registeredResourceRef,std::string([d[@"publisherOwner"]UTF8String]?:""),r.peerImagePath,r.peerImageSHA256,r.socketDirectory,r.socketLeaf};
 auto wall=clockMS();auto expires=[o->context[@"expiresAtMs"]longLongValue];if(wall<[o->context[@"issuerSourceInputs"][@"atMs"]longLongValue]||expires<=wall||expires-wall>30000)throw std::runtime_error("NETWORK_PUBLISHER_ROOT_WINDOW");ref->wallDeadline=expires;ref->lastWall=wall;ref->monoDeadlineNS=monoNS()+(expires-wall)*1000000;
 auto&b=ref->binding;b.version=1;b.size=sizeof(b);b.network_id=ref->text[0].c_str();b.source_id=ref->text[1].c_str();b.instance_id=ref->text[2].c_str();b.resource_key=ref->text[3].c_str();b.registered_resource_ref=ref->text[4].c_str();b.publisher_owner=ref->text[5].c_str();b.peer_image_path=ref->text[6].c_str();b.peer_image_sha256=ref->text[7].c_str();b.socket_directory=ref->text[8].c_str();b.socket_leaf=ref->text[9].c_str();b.peer_uid=r.peerUID;b.peer_pid=r.peerPID;b.peer_start_seconds=r.peerStartSeconds;b.peer_start_microseconds=r.peerStartMicros;b.directory_device=r.directoryDevice;b.directory_inode=r.directoryInode;b.socket_device=r.socketDevice;b.socket_inode=r.socketInode;
 b.peer_image_bytes=r.peerImageBytes;b.timeout_ms=r.timeoutMS;{std::lock_guard<std::mutex>lock(inventoryMutex);resources.emplace(ref.get(),ref);}o->resource=std::move(ref);
}
std::shared_ptr<Owner>known(napi_env e,napi_callback_info i,bool&store,size_t&count,napi_value*args){napi_value self;void*role=nullptr;ck(napi_get_cb_info(e,i,&count,args,&self,&role));store=role!=nullptr;bool tag=false;ck(napi_check_object_type_tag(e,self,store?&storeTag:&captureTag,&tag));if(!tag)throw std::runtime_error("NETWORK_PUBLISHER_NATIVE_OWNER_REQUIRED");Anchor*a=nullptr;ck(napi_unwrap(e,self,reinterpret_cast<void**>(&a)));std::lock_guard<std::mutex>lock(inventoryMutex);auto it=a?owners.find(a->owner):owners.end();if(it==owners.end()||a->store!=store||it->second->env!=e||it->second->actor!=std::this_thread::get_id())throw std::runtime_error("NETWORK_PUBLISHER_NATIVE_OWNER_REQUIRED");return it->second;}
void rootCurrent(const std::shared_ptr<Owner>&o){if(o->retired||o->captureClosed||o->first||!o->source||!o->context)throw std::runtime_error("NETWORK_PUBLISHER_UNRESOLVED");NSError*e=nil;NSDictionary*now=[o->source copyOriginalNetworkCurrentPublisherContext:&e];if(e||!now)throw std::runtime_error(e.localizedDescription.UTF8String?:"NETWORK_PUBLISHER_ROOT_CURRENT");for(NSString*k in @[@"descriptor",@"sourceScope",@"node",@"originalOperation64"]){if(![now[k]isEqual:o->context[k]])throw std::runtime_error("NETWORK_PUBLISHER_ROOT_SELECTION_CHANGED");}for(NSString*k in @[@"rootRaw",@"enrollmentRaw",@"profileRaw",@"policy"]){if(![now[@"issuerSourceInputs"][k]isEqual:o->context[@"issuerSourceInputs"][k]])throw std::runtime_error("NETWORK_PUBLISHER_ROOT_ORIGINAL_CHANGED");}NSData*before=[o->context[@"issuerSourceInputs"][@"currentRaw"]dataUsingEncoding:NSUTF8StringEncoding],*after=[now[@"issuerSourceInputs"][@"currentRaw"]dataUsingEncoding:NSUTF8StringEncoding];NSDictionary*a=[NSJSONSerialization JSONObjectWithData:before options:0 error:nil],*b=[NSJSONSerialization JSONObjectWithData:after options:0 error:nil];if(![a[@"keyVersion"]isEqual:b[@"keyVersion"]]||![SourceOriginalBodyHint(before)[@"subjectKeyVersion"]isEqual:SourceOriginalBodyHint(after)[@"subjectKeyVersion"]])throw std::runtime_error("NETWORK_PUBLISHER_CURRENT_ROLE_CHANGED");if(!o->resource||ynx_auth_network_publisher_resource_current_v1(o->resource.get()))throw std::runtime_error("NETWORK_PUBLISHER_NATIVE_OBSERVATION_EXPIRED");o->freshContext=now;}
NSDictionary*issuerInputs(NSDictionary*ctx){NSMutableDictionary*out=[NSMutableDictionary dictionary];for(NSString*k in @[@"rootRaw",@"enrollmentRaw",@"profileRaw",@"currentRaw",@"policy",@"expectedNonce",@"previous"]){if(!ctx[@"issuerSourceInputs"][k])throw std::runtime_error("NETWORK_PUBLISHER_ISSUER_ORIGINAL_REQUIRED");out[k]=ctx[@"issuerSourceInputs"][k];}return[out copy];}
NSDictionary*readP09(const std::shared_ptr<Owner>&o){
#ifdef YNX_NETWORK_PUBLISHER_LINK_RESOURCE_CURRENT_V2
 if(!o->reader)throw std::runtime_error("NETWORK_PUBLISHER_P09_READER_REQUIRED");
 std::vector<uint8_t>body;const int32_t rc=o->reader->copyCurrent(body);
 const auto&actual=body.empty()?o->reader->lastBody():body;
 if(!actual.empty())o->p09Response=[NSData dataWithBytes:actual.data() length:actual.size()];
 if(rc||actual.empty())throw std::runtime_error("NETWORK_PUBLISHER_P09_RESPONSE_UNKNOWN");
 NSDictionary*response=[NSJSONSerialization JSONObjectWithData:o->p09Response options:0 error:nil];NSDictionary*payload=response[@"result"][@"payload"],*v=payload[@"resourceCurrent"],*d=o->context[@"descriptor"];
 if(![payload[@"code"]isEqual:@"DATA_ONLY"]||![payload[@"classification"]isEqual:@"UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA"]||![payload[@"authority"]isEqual:@NO]||![payload[@"registeredIssuer"]isEqual:@NO]||![payload[@"productionEnabled"]isEqual:@NO]||![v isKindOfClass:NSDictionary.class]||v.count!=9)throw std::runtime_error("NETWORK_PUBLISHER_P09_DATA_FRAME");
 for(NSString*k in @[@"sourceId",@"instanceId",@"resourceKey"])if(![v[k]isEqual:d[k]])throw std::runtime_error("NETWORK_PUBLISHER_P09_RESOURCE_CHANGED");
 for(NSString*k in @[@"epoch",@"sequence"]){id s=v[k];if(![s isKindOfClass:NSString.class]||![s length]||[s length]>20||[s characterAtIndex:0]=='0'||[s rangeOfCharacterFromSet:NSCharacterSet.decimalDigitCharacterSet.invertedSet].location!=NSNotFound)throw std::runtime_error("NETWORK_PUBLISHER_P09_COUNTER");}
 if(![v[@"head"]isKindOfClass:NSString.class]||!op64([v[@"head"]UTF8String])||![@[@"active",@"revoked",@"retired"]containsObject:v[@"status"]])throw std::runtime_error("NETWORK_PUBLISHER_P09_STATE");
 auto now=clockMS();for(NSString*k in @[@"issuedAtMs",@"expiresAtMs"]){id x=v[k];if(![x isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)x)==CFBooleanGetTypeID()||[x doubleValue]!=(double)[x longLongValue])throw std::runtime_error("NETWORK_PUBLISHER_P09_WINDOW");}auto issued=[v[@"issuedAtMs"]longLongValue],expires=[v[@"expiresAtMs"]longLongValue];if(issued>now||expires<=now||expires-issued>20000||expires<=issued)throw std::runtime_error("NETWORK_PUBLISHER_P09_WINDOW");
 if(o->originals){for(NSString*k in @[@"sourceId",@"instanceId",@"resourceKey",@"epoch",@"sequence",@"head",@"status"])if(![v[k]isEqual:o->originals[@"current9"][k]])throw std::runtime_error("NETWORK_PUBLISHER_P09_ORIGINAL_STATE_CHANGED");}
 else{auto old=o->resource->wallDeadline.load();if(expires<old){o->resource->wallDeadline=expires;o->resource->monoDeadlineNS=monoNS()+(expires-now)*1000000;}}
 return v;
#else
 (void)o;throw std::runtime_error("NETWORK_PUBLISHER_PROTECTED_P09_READER_NOT_LINKED");
#endif
}
void fullCurrent(const std::shared_ptr<Owner>&o){rootCurrent(o);(void)readP09(o);rootCurrent(o);}
napi_value freshInputs(napi_env e,napi_callback_info i){size_t n=0;bool s=false;std::shared_ptr<Owner>o;try{o=known(e,i,s,n,nullptr);NSError*ce=nil;if(o->first||!o->freshContext||![o->source assertOriginalNetworkCurrentPublisherCompletedCurrent:&ce])throw std::runtime_error("NETWORK_PUBLISHER_FRESH_CURRENT_REQUIRED");return convert(e,issuerInputs(o->freshContext));}catch(const std::exception&x){if(o){remember(o,x.what());napi_throw(e,first(o));}else napi_throw(e,error(e,x.what()));return nullptr;}}
void retire(const std::shared_ptr<Owner>&o){o->retired=true;if(o->resource)o->resource->retired=true;if(o->source)[o->source retire];
#ifdef YNX_NETWORK_PUBLISHER_LINK_RESOURCE_CURRENT_V2
 if(o->reader){const auto rc=o->reader->retire();if(rc)remember(o,"NETWORK_PUBLISHER_READER_RETIRE_FIRST_ERROR");}
#endif
}
void drainReader(const std::shared_ptr<Owner>&o){
#ifdef YNX_NETWORK_PUBLISHER_LINK_RESOURCE_CURRENT_V2
 if(!o->reader)return;
 bool done=false;const int32_t rc=o->reader->drain(done);
 if(!done)throw std::runtime_error("NETWORK_PUBLISHER_READER_REMOTE_OR_PACKET_DEBT");
 o->reader.reset();
 // Cleanup completion does not erase the original first operation failure.
 if(rc)remember(o,"NETWORK_PUBLISHER_READER_FIRST_ERROR");
#else
 (void)o;
#endif
}
void finalize(napi_env,void*raw,void*){std::unique_ptr<Anchor>a(static_cast<Anchor*>(raw));std::shared_ptr<Owner>o;{std::lock_guard<std::mutex>lock(inventoryMutex);auto i=owners.find(a->owner);if(i!=owners.end())o=i->second;}if(o)retire(o);/* unresolved physical owners stay in inventory; no GC close */}
// Separate callbacks prevent caller operation selectors from choosing cleanup.
napi_value retireCall(napi_env e,napi_callback_info i){size_t n=0;bool s=false;try{auto o=known(e,i,s,n,nullptr);if(s){o->storeRetired=true;if(o->pair)o->pair->retire();}else retire(o);return promise(e,result(e,null(e)));}catch(const std::exception&x){return promise(e,result(e,error(e,x.what())));}}
napi_value joinCall(napi_env e,napi_callback_info i){size_t n=0;bool s=false;try{auto o=known(e,i,s,n,nullptr);if((s&&!o->storeRetired)||(!s&&!o->retired))throw std::runtime_error("NETWORK_PUBLISHER_RETIRE_BEFORE_JOIN");if(!s)drainReader(o);if(o->resource&&o->resource->refs.load()!=1)throw std::runtime_error("NETWORK_PUBLISHER_READER_BORROW_DEBT");if(s&&o->pair)o->pair->join();if(!s)o->joined=true;return promise(e,result(e,null(e)));}catch(const std::exception&x){return promise(e,result(e,error(e,x.what())));}}
napi_value closeCall(napi_env e,napi_callback_info i){size_t n=0;bool s=false;try{auto o=known(e,i,s,n,nullptr);napi_ref&cached=s?o->storeClose:o->captureClose;if(cached)return getRef(e,cached);napi_value outcome;try{if(s){if(!o->storeRetired)throw std::runtime_error("NETWORK_PUBLISHER_STORE_RETIRE_REQUIRED");bool done=o->pair?o->pair->close():o->journal->close();if(!done)throw std::runtime_error("NETWORK_PUBLISHER_STORE_CLOSE_UNKNOWN");o->storeClosed=true;}else{if(!o->retired||!o->joined||!o->storeClosed||(o->resource&&o->resource->refs.load()!=1))throw std::runtime_error("NETWORK_PUBLISHER_CAPTURE_CLOSE_DEBT");NSError*ce=nil;if(o->sourceLoan){[o->source releaseOriginalNetworkCurrentPublisherChild];o->sourceLoan=false;}if(o->source&&(![o->source join:&ce]||![o->source closeOriginalNetworkCurrentPublisherSource:&ce]))throw std::runtime_error(ce.localizedDescription.UTF8String?:"NETWORK_PUBLISHER_ROOT_CLOSE_UNKNOWN");if(o->resource)o->resource->closed=true;o->captureClosed=true;}outcome=result(e,null(e));}catch(const std::exception&x){outcome=result(e,error(e,x.what()));}auto p=promise(e,outcome);ck(napi_create_reference(e,p,1,&cached));return p;}catch(const std::exception&x){return promise(e,result(e,error(e,x.what())));}}
napi_value current(napi_env e,napi_callback_info i){size_t n=0;bool s=false;std::shared_ptr<Owner>o;try{o=known(e,i,s,n,nullptr);fullCurrent(o);return promise(e,result(e,null(e)));}catch(const std::exception&x){if(o){remember(o,x.what());return promise(e,result(e,first(o)));}return promise(e,result(e,error(e,x.what())));}}
napi_value completed(napi_env e,napi_callback_info i){size_t n=0;bool s=false;try{auto o=known(e,i,s,n,nullptr);if(o->retired||!o->resource||ynx_auth_network_publisher_resource_current_v1(o->resource.get())||o->first)throw std::runtime_error("NETWORK_PUBLISHER_COMPLETED_CURRENT_REQUIRED");NSError*ce=nil;if(![o->source assertOriginalNetworkCurrentPublisherCompletedCurrent:&ce])throw std::runtime_error(ce.localizedDescription.UTF8String?:"NETWORK_PUBLISHER_ROOT_COMPLETED_CHANGED");
#ifdef YNX_NETWORK_PUBLISHER_LINK_RESOURCE_CURRENT_V2
if(!o->reader||o->reader->currentLocal())throw std::runtime_error("NETWORK_PUBLISHER_READER_COMPLETED_CHANGED");
#endif
return result(e,null(e));}catch(const std::exception&x){return result(e,error(e,x.what()));}}
napi_value clockCall(napi_env e,napi_callback_info i){size_t n=0;bool s=false;try{(void)known(e,i,s,n,nullptr);napi_value v;ck(napi_create_double(e,(double)clockMS(),&v));return v;}catch(const std::exception&x){napi_throw(e,error(e,x.what()));return nullptr;}}
napi_value originals(napi_env e,napi_callback_info i){size_t n=0;bool s=false;try{auto o=known(e,i,s,n,nullptr);if(o->first){napi_throw(e,first(o));return nullptr;}if(!o->originals)throw std::runtime_error("NETWORK_PUBLISHER_P09_READER_NOT_SUPPLIED");return convert(e,o->originals);}catch(const std::exception&x){napi_throw(e,error(e,x.what()));return nullptr;}}
napi_value intent(napi_env e,napi_callback_info i){size_t n=3;napi_value a[3];bool s=false;std::shared_ptr<Owner>o;try{o=known(e,i,s,n,a);if(n!=2)throw std::runtime_error("NETWORK_PUBLISHER_INTENT_ARGS");fullCurrent(o);if(o->intentSelected)throw std::runtime_error("NETWORK_PUBLISHER_SIGN_ONCE");auto c=publicBytes(e,a[0],65536),statement=publicBytes(e,a[1],98304);if(c!=json(o->originals[@"current9"]))throw std::runtime_error("NETWORK_PUBLISHER_CURRENT9_CHANGED");o->intentSelected=true;ynx::auth::network_current::PairIntent pi;pi.originalOperation64=o->release->originalOperation64;pi.resourceKey=[o->context[@"descriptor"][@"resourceKey"]UTF8String];pi.protectedResourceRef=[o->context[@"descriptor"][@"originalLocator"][@"protectedResourceRef"]UTF8String];pi.descriptorOriginal=json(o->context[@"descriptor"]);pi.bindingOriginal=json(o->originals[@"binding"]);pi.current9Original=c;pi.statementE8Original=statement;o->pair=std::make_unique<Store>(o->journal,std::move(pi));o->pair->retainSigningIntentOnce();fullCurrent(o);return promise(e,result(e,null(e)));}catch(const std::exception&x){if(o){remember(o,x.what());return promise(e,result(e,first(o)));}return promise(e,result(e,error(e,x.what())));}}
napi_value publication(napi_env e,napi_callback_info i){size_t n=3;napi_value a[3];bool s=false;std::shared_ptr<Owner>o;try{o=known(e,i,s,n,a);if(n!=2||!o->pair)throw std::runtime_error("NETWORK_PUBLISHER_ORIGINAL_INTENT_REQUIRED");fullCurrent(o);auto c=publicBytes(e,a[0],65536),envelope=publicBytes(e,a[1],393216);o->pair->retainPublicationIntentOnce(c,envelope);fullCurrent(o);return promise(e,result(e,null(e)));}catch(const std::exception&x){if(o){remember(o,x.what());return promise(e,result(e,first(o)));}return promise(e,result(e,error(e,x.what())));}}
napi_value publish(napi_env e,napi_callback_info i){size_t n=3;napi_value a[3];bool s=false;std::shared_ptr<Owner>o;try{o=known(e,i,s,n,a);if(n!=2||!o->pair)throw std::runtime_error("NETWORK_PUBLISHER_ORIGINAL_INTENT_REQUIRED");fullCurrent(o);o->pair->publishOriginalPairOnce(publicBytes(e,a[0],65536),publicBytes(e,a[1],393216));fullCurrent(o);return promise(e,result(e,null(e)));}catch(const std::exception&x){if(o){remember(o,x.what());return promise(e,result(e,first(o)));}return promise(e,result(e,error(e,x.what())));}}
napi_value queryResult(napi_env e,const ynx::auth::network_current::PairQuery&q){napi_value data;ck(napi_create_object(e,&data));ck(napi_set_named_property(e,data,"currentOriginal",bytes(e,q.current9Original)));ck(napi_set_named_property(e,data,"envelopeOriginal",bytes(e,q.envelopeOriginal)));ck(napi_set_named_property(e,data,"readOnly",convert(e,@YES)));ck(napi_set_named_property(e,data,"state",text(e,q.state==ynx::auth::network_current::PairQueryState::complete?"complete":q.state==ynx::auth::network_current::PairQueryState::entered_only?"entered-only":"unknown")));return data;}
napi_value query(napi_env e,napi_callback_info i){size_t n=0;bool s=false;try{auto o=known(e,i,s,n,nullptr);auto q=o->pair?o->pair->querySameOriginalLocal():ynx::auth::network_current::PairQuery{};return promise(e,queryResult(e,q));}catch(const std::exception&x){return promise(e,result(e,error(e,x.what())));}}
napi_value readPair(napi_env e,napi_callback_info i){size_t n=0;bool s=false;std::shared_ptr<Owner>o;napi_value partial=nullptr;try{o=known(e,i,s,n,nullptr);if(!o->pair)throw std::runtime_error("NETWORK_PUBLISHER_ORIGINAL_INTENT_REQUIRED");auto q=o->pair->readOriginalPair();partial=queryResult(e,q);if(q.error)std::rethrow_exception(q.error);fullCurrent(o);return promise(e,result(e,null(e),partial));}catch(const std::exception&x){if(o){remember(o,x.what());return promise(e,result(e,first(o),partial));}return promise(e,result(e,error(e,x.what()),partial));}}
napi_value child(napi_env e,const std::shared_ptr<Owner>&o,bool store){napi_value v;ck(napi_create_object(e,&v));auto*a=new Anchor{o.get(),store};ck(napi_wrap(e,v,a,finalize,nullptr,nullptr));ck(napi_type_tag_object(e,v,store?&storeTag:&captureTag));auto add=[&](const char*n,napi_callback f){napi_property_descriptor d={n,nullptr,f,nullptr,nullptr,nullptr,napi_default,store?(void*)1:nullptr};ck(napi_define_properties(e,v,1,&d));};for(auto p:{std::pair<const char*,napi_callback>{"retire",retireCall},{"join",joinCall},{"close",closeCall},{"querySameOriginal",query}})add(p.first,p.second);if(store){add("retainPublicationIntentOnce",publication);add("publishOriginalPairOnce",publish);add("readOriginalPair",readPair);}else{add("current",current);add("assertCompletedCurrent",completed);add("clockMs",clockCall);add("readOriginals",originals);add("readFreshIssuerSourceInputs",freshInputs);add("retainSigningIntentOnce",intent);}ck(napi_object_freeze(e,v));return v;}
napi_value acquire(napi_env e,napi_callback_info i){size_t n=1;napi_value ignored;ck(napi_get_cb_info(e,i,&n,&ignored,nullptr,nullptr));if(n)return result(e,error(e,"NETWORK_PUBLISHER_ZERO_INPUT"),null(e));auto o=std::make_shared<Owner>();o->env=e;{std::lock_guard<std::mutex>lock(inventoryMutex);owners.emplace(o.get(),o);}napi_value partial;ck(napi_create_object(e,&partial));ck(napi_set_named_property(e,partial,"capture",child(e,o,false)));ck(napi_set_named_property(e,partial,"store",child(e,o,true)));ck(napi_object_freeze(e,partial));
 try{for(const auto&r:ynx::network::publisher::releases())if(r.uid==getuid()&&r.source.purpose==ynx::network::publisher::purpose){if(o->release)throw std::runtime_error("NETWORK_PUBLISHER_DUPLICATE_RELEASE");o->release=&r;}if(!o->release)throw std::runtime_error("NETWORK_PUBLISHER_NO_ROOT_SELECTION");
#ifdef YNX_REVIEWED_NETWORK_CURRENT_PUBLISHER_ROWS
  NSError*ce=nil;o->source=[YNXAuthIdentitySourceAuthority acquireOriginalNetworkCurrentPublisherSource:&ce];if(ce||!o->source)throw std::runtime_error(ce.localizedDescription.UTF8String?:"NETWORK_PUBLISHER_SOURCE_REQUIRED");o->context=[o->source copyOriginalNetworkCurrentPublisherContext:&ce];if(ce||!o->context)throw std::runtime_error(ce.localizedDescription.UTF8String?:"NETWORK_PUBLISHER_CONTEXT_REQUIRED");if(![o->source retainOriginalNetworkCurrentPublisherChild:&ce])throw std::runtime_error("NETWORK_PUBLISHER_SOURCE_LOAN_REQUIRED");o->sourceLoan=true;
#endif
  if(!o->context||!op64(o->release->originalOperation64))throw std::runtime_error("NETWORK_PUBLISHER_ORIGINAL_OPERATION_NOT_SELECTED");mintResource(o);
  NSString*directory=o->context[@"journalDirectory"];if(![directory isKindOfClass:NSString.class])throw std::runtime_error("NETWORK_PUBLISHER_JOURNAL_NOT_SELECTED");o->journal->openProductDeviceV4PendingExisting(directory.stringByDeletingLastPathComponent.UTF8String,directory.lastPathComponent.UTF8String);
 #ifdef YNX_NETWORK_PUBLISHER_LINK_RESOURCE_CURRENT_V2
  o->reader=std::make_unique<ynx::auth::network_publisher::ReaderV2>();
  // LINK's strong adapter uses this SAME actual inventory ref, original
  // typed fence, independently bound OS start and all four endpoint stamps.
  int rc=o->reader->openOriginal(o->resource.get());
  if(rc||!o->reader)throw std::runtime_error("NETWORK_PUBLISHER_P09_OPEN_UNKNOWN");
  rootCurrent(o);NSDictionary*nine=readP09(o);rootCurrent(o);
  NSData*raw=[o->context[@"issuerSourceInputs"][@"currentRaw"]dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary*envelope=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
  NSDictionary*binding=@{@"networkId":o->context[@"descriptor"][@"networkId"],@"owner":o->context[@"descriptor"][@"publisherOwner"],@"keyVersion":envelope[@"keyVersion"],@"executionHeight":envelope[@"executionHeight"]};
  o->originals=@{@"descriptor":o->context[@"descriptor"],@"binding":binding,@"current9":nine,@"issuerSourceInputs":issuerInputs(o->context)};
 #else
  throw std::runtime_error("NETWORK_PUBLISHER_PROTECTED_P09_READER_NOT_LINKED");
 #endif
 }catch(const std::exception&x){remember(o,x.what());}return result(e,o->first?first(o):null(e),partial);
}
}
extern "C" int32_t ynx_auth_network_publisher_resource_retain_v1(YNXOriginalNetworkPublisherResourceRef*p){auto r=knownResource(p);if(!r||r->closed.load())return 1;auto n=r->refs.load();do{if(!n||n==UINT32_MAX)return 2;}while(!r->refs.compare_exchange_weak(n,n+1));return 0;}
extern "C" int32_t ynx_auth_network_publisher_resource_current_v1(YNXOriginalNetworkPublisherResourceRef*p){auto r=knownResource(p);if(!r||r->retired.load()||r->closed.load()||!r->refs.load())return 1;auto wall=clockMS();auto previous=r->lastWall.load();if(wall<previous||wall>=r->wallDeadline.load()||monoNS()>=r->monoDeadlineNS.load()){r->retired=true;return 3;}while(wall>previous&&!r->lastWall.compare_exchange_weak(previous,wall)){if(wall<previous){r->retired=true;return 3;}}return 0;}
extern "C" int32_t ynx_auth_network_publisher_resource_copy_binding_v1(YNXOriginalNetworkPublisherResourceRef*p,YNXOriginalNetworkPublisherResourceBinding*out){if(!out||out->version!=1||out->size!=sizeof(*out))return 1;if(auto e=ynx_auth_network_publisher_resource_current_v1(p))return e;auto r=knownResource(p);*out=r->binding;return ynx_auth_network_publisher_resource_current_v1(p);}
extern "C" void ynx_auth_network_publisher_resource_release_v1(YNXOriginalNetworkPublisherResourceRef*p){auto r=knownResource(p);if(!r)return;auto n=r->refs.load();while(n>1&&!r->refs.compare_exchange_weak(n,n-1)){} }
namespace {
int32_t resourceFenceCurrent(void*p){return ynx_auth_network_publisher_resource_current_v1(static_cast<YNXOriginalNetworkPublisherResourceRef*>(p));}
int32_t resourceFenceRetain(void*p){return ynx_auth_network_publisher_resource_retain_v1(static_cast<YNXOriginalNetworkPublisherResourceRef*>(p));}
void resourceFenceRelease(void*p){ynx_auth_network_publisher_resource_release_v1(static_cast<YNXOriginalNetworkPublisherResourceRef*>(p));}
template<size_t N>bool boundedCopy(char(&out)[N],const std::string&s){if(s.empty()||s.size()>=N||s.find('\0')!=std::string::npos)return false;memcpy(out,s.c_str(),s.size()+1);return true;}
}
extern "C" int32_t ynx_auth_network_publisher_resource_copy_link_profile_v1(YNXOriginalNetworkPublisherResourceRef*p,ynx_link_resource_current_profile_v1*out,ynx_link_private_client_source_fence_v1*fence){
 if(!out||!fence)return 1;if(auto rc=ynx_auth_network_publisher_resource_current_v1(p))return rc;auto r=knownResource(p);if(!r)return 1;ynx_link_resource_current_profile_v1 v{};v.version=1;v.size=sizeof(v);const auto&b=r->binding;v.peer_uid=b.peer_uid;v.peer_pid=(int32_t)b.peer_pid;v.start_kind=YNX_LINK_RESOURCE_CURRENT_DARWIN_START_V1;v.start_a=b.peer_start_seconds;v.start_b=b.peer_start_microseconds;v.image_bytes=b.peer_image_bytes;v.timeout_ms=b.timeout_ms;
 if(!boundedCopy(v.socket_path,r->text[8]+"/"+r->text[9])||!boundedCopy(v.image_path,r->text[6])||!boundedCopy(v.source_id,r->text[1])||!boundedCopy(v.instance_id,r->text[2])||!boundedCopy(v.resource_key,r->text[3])||!op64(r->text[7]))return 2;
 auto digit=[](char c)->uint8_t{return(uint8_t)(c<='9'?c-'0':c-'a'+10);};for(size_t i=0;i<32;++i)v.image_sha256[i]=(uint8_t)((digit(r->text[7][i*2])<<4)|digit(r->text[7][i*2+1]));if(auto rc=ynx_auth_network_publisher_resource_current_v1(p))return rc;*out=v;*fence={p,resourceFenceCurrent,resourceFenceRetain,resourceFenceRelease};return 0;
}
napi_value RegisterOriginalNetworkCurrentPublisherCaptureV1(napi_env e,napi_value exports){napi_property_descriptor d={"acquireOriginalNetworkCurrentPublisherCaptureV1",nullptr,acquire,nullptr,nullptr,nullptr,napi_default,nullptr};ck(napi_define_properties(e,exports,1,&d));return exports;}

