#import <Foundation/Foundation.h>
#if !defined(YNX_AI_REVIEW_PUBLIC_MODEL)
#import <UIKit/UIKit.h>
#endif
#include "MobileAIProtectedReviewPrivate.hpp"
#include "MobileAISigningCapturePairedPrivate.hpp"
#include "MobileAISigningCaptureSourceFencePrivate.hpp"
#include "MobileRegisteredAccountPhasePrivate.h"
#include "MobileInstalledApplicationOriginalPrivate.hpp"
#include <array>
#include <atomic>
#include <condition_variable>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>
namespace ynx::platform::ai::review {
namespace {
constexpr int32_t invalid=-68301,pending=-68302,rejected=-68303,cancelled=-68304,wrongActor=-68305;
using Bytes=std::vector<uint8_t>;using Snapshot=std::array<Bytes,6>;
enum Decision{waiting=0,approved=1,denied=2,cancel=3};
}
struct OriginalReview {
 std::thread::id actor=std::this_thread::get_id();YNXAIMobileSigningCapture*capture=nullptr;
 std::unique_ptr<ynx::sdk::mobileapplication::InstalledApplicationOriginal>installation;
 YNXMobilePQSelectedOriginal*account=nullptr;std::vector<std::string>accountOriginal;Snapshot originals;
 std::atomic<int>decision{waiting};std::atomic<bool>retired{false},uiDone{true},dismissRequested{false};std::atomic<uint32_t>uiWork{0};
 std::mutex waitMutex;std::condition_variable wake;Failure first{},cleanup{};
 bool claimSelected=false,closeSelected=false,accountClosed=false,accountReleased=false,installationClosed=false,closed=false;
 uint64_t id=0;std::string presentation;
};
namespace {
std::mutex ownersMutex;std::map<OriginalReview*,std::shared_ptr<OriginalReview>>owners;uint64_t nextID=1;
std::shared_ptr<OriginalReview>known(OriginalReview*p){std::lock_guard<std::mutex>lock(ownersMutex);auto i=owners.find(p);return i==owners.end()?nullptr:i->second;}
Failure note(OriginalReview&p,Failure f){if(f.present&&!p.first.present)p.first=f;return p.first;}
Failure cleanup(OriginalReview&p,Failure f){if(f.present&&!p.cleanup.present)p.cleanup=f;return f;}
std::string bytesText(const uint8_t*b,size_t n){if(!b||!n||n>16384)throw invalid;std::string text(reinterpret_cast<const char*>(b),n);if(text.find('\0')!=std::string::npos)throw invalid;return text;}
NSString*string(const std::string&s){return [[NSString alloc]initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];}
NSDictionary*json(const Bytes&b){NSError*error=nil;id value=[NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:b.data() length:b.size()] options:0 error:&error];if(error||![value isKindOfClass:NSDictionary.class])throw invalid;return value;}
std::string field(NSDictionary*d,NSString*key){id v=d[key];if(![v isKindOfClass:NSString.class]||![v length])throw invalid;return [v UTF8String];}
Failure snapshot(OriginalReview&p,Snapshot&out){
 auto r=ynx::auth::ai::mobile::readOriginalProtectedReviewDATA(p.capture);
 if(r.failure.present)return {true,r.failure.code};if(r.status)return {true,r.status};
 const YNXAIMobileSpanV6 parts[]={r.originals.unsignedOriginal,r.originals.messageOriginal,r.originals.bodyOriginal,r.originals.scopeOriginal,r.originals.requestDigest,r.originals.agentExpectedOriginal};
 const size_t caps[]={16384,16384,1048576,65536,64,65536};Snapshot copy;
 for(size_t i=0;i<copy.size();++i){if(parts[i].bytes>caps[i]||(!parts[i].data&&parts[i].bytes)||(i!=2&&!parts[i].bytes))return {true,invalid};if(parts[i].bytes)copy[i].assign(parts[i].data,parts[i].data+parts[i].bytes);}
 if(auto rc=ynx::auth::ai::mobile::signingCaptureSourceCurrentOriginal(p.capture))return {true,rc};
 auto late=ynx::auth::ai::mobile::signingCaptureSourceFailureOriginal(p.capture);if(late.present)return {true,late.code};out=std::move(copy);return {};
}
Failure phase(YNXMobileRegisteredPhaseV2 s){
 if(s.failure.present)return {true,s.failure.code};if(s.version!=2||s.size!=sizeof(s)||s.phase!=YNX_MOBILE_REGISTERED_READY_V2)return {true,pending};return {};
}
Failure accountSnapshot(OriginalReview&p,std::vector<std::string>&out){
 auto f=phase(ynx_mobile_pq_registered_account_current_v2(p.account));if(f.present)return f;
 YNXMobilePQSelectedOriginalDATA d{};d.version=1;d.size=sizeof(d);f=phase(ynx_mobile_pq_registered_account_read_v2(p.account,&d));if(f.present)return f;
 if(d.version!=1||d.size!=sizeof(d)||d.mode!=2)return {true,invalid};
 const YNXMobileSelectedPublicSpan values[]={d.reference,d.original_operation_id,d.network_id,d.account,d.platform,d.application_id,d.protected_resource_ref,d.native_chain_id,d.vault_revision,d.registration_digest,d.key_version,d.execution_height,d.nonce,d.spending_budget_original_digest};
 std::vector<std::string>copy;for(auto v:values)copy.push_back(v.length?bytesText(v.bytes,v.length):std::string());
 if(copy[2].empty()||copy[3].empty()||copy[4]!="ios"||copy[5]!="com.ynxweb4.ai"||copy[10].empty())return {true,invalid};
 f=phase(ynx_mobile_pq_registered_account_current_v2(p.account));if(!f.present)out=std::move(copy);return f;
}
Failure current(OriginalReview&p,YNXAIMobileSigningCapture*c,bool needApproved){
 if(p.actor!=std::this_thread::get_id())return {true,wrongActor};if(p.first.present)return p.first;
 if(p.capture!=c||p.retired||p.closed)return note(p,{true,cancelled});
 auto installed=p.installation->current();if(installed.present)return note(p,{true,installed.code});
 Snapshot now;auto f=snapshot(p,now);if(f.present)return note(p,f);if(now!=p.originals)return note(p,{true,invalid});
 std::vector<std::string>account;f=accountSnapshot(p,account);if(f.present)return note(p,f);if(account!=p.accountOriginal)return note(p,{true,invalid});
 const auto choice=p.decision.load();if(choice==denied)return note(p,{true,rejected});if(choice==cancel)return note(p,{true,cancelled});
 if(needApproved&&choice!=approved)return {true,pending};return {};
}
id redacted(id value){
 if([value isKindOfClass:NSDictionary.class]){NSMutableDictionary*copy=[NSMutableDictionary dictionary];
  NSSet*hidden=[NSSet setWithArray:@[@"authorizationref",@"token",@"password",@"secret",@"privatekey",@"accesstoken",@"refreshtoken",@"cookie"]];
  for(NSString*key in value)copy[key]=[hidden containsObject:key.lowercaseString]?@"<protected reference; not displayed>":redacted(value[key]);return copy;}
 if([value isKindOfClass:NSArray.class]){NSMutableArray*copy=[NSMutableArray array];for(id v in value)[copy addObject:redacted(v)];return copy;}return value;
}
std::string display(OriginalReview&p){
 NSDictionary*u=json(p.originals[0]);NSDictionary*agent=json(p.originals[5]);
 if(field(u,@"applicationId")!="com.ynxweb4.ai"||field(u,@"account")!=p.accountOriginal[3]||field(u,@"canonicalOwner")!=p.accountOriginal[3]||field(agent,@"canonicalOwner")!=p.accountOriginal[3]||field(agent,@"networkId")!=p.accountOriginal[2])throw invalid;
 id body=p.originals[2].empty()?@{}:json(p.originals[2]);NSError*error=nil;
 NSData*bodyJSON=[NSJSONSerialization dataWithJSONObject:redacted(body) options:NSJSONWritingPrettyPrinted|NSJSONWritingSortedKeys error:&error];if(error||!bodyJSON)throw invalid;
 NSString*budget=body[@"budget"]||body[@"spendingBudget"]?@"仅显示下方原始请求中的预算字段；不据此授予预算":@"未供应；本次请求签名不授予工具或资金预算";
 NSString*text=[NSString stringWithFormat:@"任务请求签名确认\n\n动作：%@\n目标：%@ %@\n来源：%@\n任务：%@\n步骤：%@\n操作：%@\n\n原生账户：%@\n账户密钥版本：%@\n任务 Agent 密钥时期：%@\n有效期原件：%@\n\n预算：%@\n请求摘要：%@\n\n参数（保护引用已隐藏）：\n%@\n\n此确认仅同意签署这一条原始任务请求，不替代工具授权、资金确认或业务回执。",
  string(field(u,@"action")),string(field(u,@"method")),string(field(u,@"path")),string(field(u,@"origin")),u[@"taskId"]?:@"未供应",u[@"stepId"]?:@"未供应",string(field(u,@"operationId")),string(p.accountOriginal[3]),string(p.accountOriginal[10]),string(field(agent,@"keyEpoch")),string(field(u,@"expiresAt")),budget,string(bytesText(p.originals[4].data(),p.originals[4].size())),[[NSString alloc]initWithData:bodyJSON encoding:NSUTF8StringEncoding]];
 return text.UTF8String;
}
void choose(const std::shared_ptr<OriginalReview>&p,Decision choice){int expected=waiting;p->decision.compare_exchange_strong(expected,choice);p->wake.notify_all();}
void showUI(const std::shared_ptr<OriginalReview>&);
void dismissUI(const std::shared_ptr<OriginalReview>&);
Result drain(OriginalReview&p){
 if(p.actor!=std::this_thread::get_id())return {{true,wrongActor},false};
 if(!p.uiDone||p.uiWork.load())return {p.first.present?p.first:p.cleanup,false};
 if(p.account&&!p.accountClosed){auto r=ynx_mobile_pq_registered_account_join_v2(p.account);if(r.first_failure.present)note(p,{true,r.first_failure.code});if(r.cleanup_failure.present)cleanup(p,{true,r.cleanup_failure.code});p.accountClosed=r.physical_done==1;}
 if(p.account&&!p.accountClosed)return {p.first.present?p.first:p.cleanup,false};
 if(p.account&&!p.accountReleased){auto f=ynx_mobile_pq_registered_account_release_closed_v2(p.account);if(f.present){cleanup(p,{true,f.code});return {p.cleanup,false};}p.accountReleased=true;p.account=nullptr;}
 if(p.installation&&!p.installationClosed){bool done=false;auto f=p.installation->close(done);if(f.present)cleanup(p,{true,f.code});p.installationClosed=done;}
 if(p.installation&&!p.installationClosed)return {p.first.present?p.first:p.cleanup,false};
 p.closed=true;return {p.first.present?p.first:p.cleanup,true};
}
}
Acquisition acquireOriginalProtectedReview(YNXAIMobileSigningCapture*c)noexcept {
 std::shared_ptr<OriginalReview>p;try{
  p=std::make_shared<OriginalReview>();p->capture=c;{std::lock_guard<std::mutex>lock(ownersMutex);if(owners.size()>=32||nextID==UINT64_MAX)return {nullptr,{true,pending}};p->id=nextID++;owners.emplace(p.get(),p);}
  if([NSThread isMainThread])return {p.get(),note(*p,{true,wrongActor})};
  auto installed=ynx::sdk::mobileapplication::InstalledApplicationOriginal::acquire(p->installation);if(installed.present)return {p.get(),note(*p,{true,installed.code})};if(!p->installation)return {p.get(),note(*p,{true,invalid})};
  auto f=snapshot(*p,p->originals);if(f.present)return {p.get(),note(*p,f)};
  auto initial=ynx_mobile_pq_registered_account_acquire_v2(&p->account);f=phase(initial);if(!p->account&&!f.present)f={true,invalid};if(f.present)return {p.get(),note(*p,f)};
  f=accountSnapshot(*p,p->accountOriginal);if(f.present)return {p.get(),note(*p,f)};@autoreleasepool {p->presentation=display(*p);}
  p->uiDone=false;showUI(p);
  while(p->decision.load()==waiting&&!p->retired){std::unique_lock<std::mutex>lock(p->waitMutex);p->wake.wait_for(lock,std::chrono::milliseconds(250));lock.unlock();f=current(*p,c,false);if(f.present){choose(p,cancel);dismissUI(p);return {p.get(),f};}}
  f=current(*p,c,true);return {p.get(),f};
 }catch(...){return {p.get(),p?note(*p,{true,invalid}):Failure{true,invalid}};}
}
Failure currentOriginalProtectedReview(OriginalReview*raw,YNXAIMobileSigningCapture*c)noexcept {try{auto p=known(raw);return p?current(*p,c,true):Failure{true,invalid};}catch(...){return {true,invalid};}}
Failure claimOriginalProtectedReview(OriginalReview*raw,YNXAIMobileSigningCapture*c)noexcept {try{auto p=known(raw);if(!p)return {true,invalid};if(p->actor!=std::this_thread::get_id())return {true,wrongActor};if(p->claimSelected)return {true,invalid};p->claimSelected=true;return current(*p,c,true);}catch(...){return {true,invalid};}}
void retireOriginalProtectedReview(OriginalReview*raw)noexcept {try{auto p=known(raw);if(!p)return;p->retired=true;choose(p,cancel);if(!p->uiDone&&!p->dismissRequested.exchange(true))dismissUI(p);}catch(...){}}
Result closeOriginalProtectedReview(OriginalReview*raw)noexcept {try{auto p=known(raw);if(!p)return {{true,invalid},false};if(p->actor!=std::this_thread::get_id())return {{true,wrongActor},false};
 if(!p->closeSelected){p->closeSelected=true;retireOriginalProtectedReview(raw);if(p->account){auto f=ynx_mobile_pq_registered_account_retire_v2(p->account);if(f.present)cleanup(*p,{true,f.code});auto d=ynx_mobile_pq_registered_account_close_v2(p->account);if(d.first_failure.present)note(*p,{true,d.first_failure.code});if(d.cleanup_failure.present)cleanup(*p,{true,d.cleanup_failure.code});p->accountClosed=d.physical_done==1;}}
 return drain(*p);}catch(...){return {{true,invalid},false};}}
Result joinOriginalProtectedReview(OriginalReview*raw)noexcept {try{auto p=known(raw);if(!p)return {{true,invalid},false};if(!p->closeSelected)return closeOriginalProtectedReview(raw);return drain(*p);}catch(...){return {{true,invalid},false};}}
Result releaseClosedOriginalProtectedReview(OriginalReview*raw)noexcept {try{auto p=known(raw);if(!p||p->actor!=std::this_thread::get_id())return {{true,invalid},false};if(!p->closed||!p->uiDone||p->uiWork.load())return {p->first.present?p->first:p->cleanup,false};auto result=Result{p->first.present?p->first:p->cleanup,true};{std::lock_guard<std::mutex>lock(ownersMutex);owners.erase(raw);}return result;}catch(...){return {{true,invalid},false};}}
}

#if !defined(YNX_AI_REVIEW_PUBLIC_MODEL)
namespace review=ynx::platform::ai::review;
@interface YNXAIOriginalReviewController : UIViewController <UIAdaptivePresentationControllerDelegate> {
@public std::shared_ptr<review::OriginalReview> original;
}
@property(nonatomic)BOOL dismissStarted;
@end
static NSMutableDictionary<NSNumber*,YNXAIOriginalReviewController*>*reviewControllers;
static void dismissOriginalController(YNXAIOriginalReviewController*controller){
 auto owner=controller->original;if(!owner||controller.dismissStarted)return;controller.dismissStarted=YES;owner->uiWork++;
 [controller dismissViewControllerAnimated:YES completion:^{[reviewControllers removeObjectForKey:@(owner->id)];owner->uiDone=true;owner->uiWork--;owner->wake.notify_all();}];
}
@implementation YNXAIOriginalReviewController
- (void)viewDidLoad {
 [super viewDidLoad];self.view.backgroundColor=UIColor.systemBackgroundColor;self.modalInPresentation=YES;
 UITextView*text=[[UITextView alloc]init];text.text=review::string(original->presentation);text.editable=NO;text.dataDetectorTypes=UIDataDetectorTypeNone;text.font=[UIFont monospacedSystemFontOfSize:14 weight:UIFontWeightRegular];text.translatesAutoresizingMaskIntoConstraints=NO;
 UIButton*allow=[UIButton buttonWithType:UIButtonTypeSystem];[allow setTitle:@"确认签署此任务请求" forState:UIControlStateNormal];[allow addTarget:self action:@selector(approveRequest) forControlEvents:UIControlEventTouchUpInside];
 UIButton*deny=[UIButton buttonWithType:UIButtonTypeSystem];[deny setTitle:@"拒绝" forState:UIControlStateNormal];[deny addTarget:self action:@selector(denyRequest) forControlEvents:UIControlEventTouchUpInside];
 UIButton*cancel=[UIButton buttonWithType:UIButtonTypeSystem];[cancel setTitle:@"取消" forState:UIControlStateNormal];[cancel addTarget:self action:@selector(cancelRequest) forControlEvents:UIControlEventTouchUpInside];
 UIStackView*buttons=[[UIStackView alloc]initWithArrangedSubviews:@[allow,deny,cancel]];buttons.axis=UILayoutConstraintAxisVertical;buttons.spacing=12;buttons.translatesAutoresizingMaskIntoConstraints=NO;
 [self.view addSubview:text];[self.view addSubview:buttons];UILayoutGuide*safe=self.view.safeAreaLayoutGuide;
 [NSLayoutConstraint activateConstraints:@[[text.topAnchor constraintEqualToAnchor:safe.topAnchor constant:16],[text.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],[text.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],[text.bottomAnchor constraintEqualToAnchor:buttons.topAnchor constant:-16],[buttons.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],[buttons.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],[buttons.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor constant:-16]]];
}
- (void)approveRequest {review::choose(original,UIApplication.sharedApplication.applicationState==UIApplicationStateActive?review::approved:review::cancel);dismissOriginalController(self);}
- (void)denyRequest {review::choose(original,review::denied);dismissOriginalController(self);}
- (void)cancelRequest {review::choose(original,review::cancel);dismissOriginalController(self);}
- (void)presentationControllerDidDismiss:(UIPresentationController*)presentationController {(void)presentationController;review::choose(original,review::cancel);[reviewControllers removeObjectForKey:@(original->id)];original->uiDone=true;original->wake.notify_all();}
@end
namespace ynx::platform::ai::review {namespace {
void showUI(const std::shared_ptr<OriginalReview>&p){
 p->uiWork++;dispatch_async(dispatch_get_main_queue(),^{
  @autoreleasepool {
   UIWindow*window=nil;for(UIScene*scene in UIApplication.sharedApplication.connectedScenes)if([scene isKindOfClass:UIWindowScene.class]&&scene.activationState==UISceneActivationStateForegroundActive)for(UIWindow*w in ((UIWindowScene*)scene).windows)if(w.isKeyWindow)window=w;
   id<UIApplicationDelegate>delegate=UIApplication.sharedApplication.delegate;if(!window&&[delegate respondsToSelector:@selector(window)])window=delegate.window;
   UIViewController*parent=window.rootViewController;
   if(!parent||parent.presentedViewController||p->retired||UIApplication.sharedApplication.applicationState!=UIApplicationStateActive){choose(p,cancel);p->uiDone=true;p->uiWork--;p->wake.notify_all();return;}
   if(!reviewControllers)reviewControllers=[NSMutableDictionary dictionary];YNXAIOriginalReviewController*controller=[[YNXAIOriginalReviewController alloc]init];controller->original=p;controller.modalPresentationStyle=UIModalPresentationFormSheet;reviewControllers[@(p->id)]=controller;
   [parent presentViewController:controller animated:YES completion:^{controller.presentationController.delegate=controller;p->uiWork--;if(p->retired||p->decision.load()!=waiting)dismissOriginalController(controller);p->wake.notify_all();}];
  }
 });
}
void dismissUI(const std::shared_ptr<OriginalReview>&p){
 p->uiWork++;dispatch_async(dispatch_get_main_queue(),^{YNXAIOriginalReviewController*controller=reviewControllers[@(p->id)];
  if(controller){if(!controller.isBeingPresented)dismissOriginalController(controller);}else p->uiDone=true;
  p->uiWork--;p->wake.notify_all();});
}
}}
#endif
