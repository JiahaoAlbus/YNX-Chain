#import <UIKit/UIKit.h>
#include "NativeAccountPicker.h"
namespace picker=ynx::mobilepq::picker;
@interface YNXOriginalAccountPicker : UITableViewController <UIAdaptivePresentationControllerDelegate>
@property(nonatomic) uint64_t token;
@property(nonatomic,strong) NSArray<NSString*>*rows;
@property(nonatomic) BOOL closedAck;
@property(nonatomic) BOOL presentationStarted;
@property(nonatomic) BOOL presentationCompleted;
@property(nonatomic) BOOL dismissRequested;
@property(nonatomic,strong) UINavigationController*originalNavigation;
- (void)closeOriginal;
@end
static NSMutableDictionary<NSNumber*,YNXOriginalAccountPicker*>*pickers;
@implementation YNXOriginalAccountPicker
- (void)viewDidLoad {
 [super viewDidLoad];self.title=@"Select account";
 self.navigationItem.leftBarButtonItem=[[UIBarButtonItem alloc]initWithBarButtonSystemItem:UIBarButtonSystemItemCancel target:self action:@selector(cancelOriginal)];
 self.tableView.rowHeight=UITableViewAutomaticDimension;self.tableView.estimatedRowHeight=100;
 [[NSNotificationCenter defaultCenter]addObserver:self selector:@selector(cancelOriginal) name:UIApplicationWillResignActiveNotification object:nil];
}
- (void)dealloc {[[NSNotificationCenter defaultCenter]removeObserver:self];}
- (NSInteger)tableView:(UITableView*)table numberOfRowsInSection:(NSInteger)section {(void)table;(void)section;return self.rows.count;}
- (NSString*)tableView:(UITableView*)table titleForHeaderInSection:(NSInteger)section {(void)table;(void)section;return @"Account selection only. Signing and sending need separate approval.";}
- (UITableViewCell*)tableView:(UITableView*)table cellForRowAtIndexPath:(NSIndexPath*)index {
 (void)table;UITableViewCell*cell=[[UITableViewCell alloc]initWithStyle:UITableViewCellStyleDefault reuseIdentifier:nil];cell.textLabel.numberOfLines=0;cell.textLabel.text=self.rows[index.row];return cell;
}
- (void)tableView:(UITableView*)table didSelectRowAtIndexPath:(NSIndexPath*)index {(void)table;picker::selected(self.token,uint32_t(index.row),0);[self closeOriginal];}
- (void)cancelOriginal {picker::selected(self.token,0,picker::cancelled);[self closeOriginal];}
- (void)ackClosed {if(self.closedAck)return;self.closedAck=YES;[pickers removeObjectForKey:@(self.token)];self.originalNavigation=nil;picker::presentationClosed(self.token);}
- (void)closeOriginal {
 self.dismissRequested=YES;UINavigationController*nav=self.originalNavigation;
 // A posted presentation owns debt before UIKit completes. Cancellation in
 // that interval must await its completion, never infer absence from nil.
 if(self.presentationStarted&&!self.presentationCompleted)return;
 if(!nav.presentingViewController&&!nav.viewIfLoaded.window&&!nav.isBeingPresented&&!nav.isBeingDismissed){[self ackClosed];return;}
 [nav dismissViewControllerAnimated:YES completion:^{
  if(!nav.presentingViewController&&!nav.viewIfLoaded.window&&!nav.isBeingPresented&&!nav.isBeingDismissed)[self ackClosed];
 }];
}
- (void)viewDidDisappear:(BOOL)animated {
 [super viewDidDisappear:animated];UINavigationController*nav=self.originalNavigation;
 if(self.presentationCompleted&&!nav.presentingViewController&&!nav.viewIfLoaded.window&&!nav.isBeingPresented&&!nav.isBeingDismissed)[self ackClosed];
}
- (void)presentationControllerDidDismiss:(UIPresentationController*)presentation {(void)presentation;picker::selected(self.token,0,picker::cancelled);[self ackClosed];}
@end
namespace ynx::mobilepq::picker {
int32_t platformShow(uint64_t token,const std::vector<std::string>&rows)noexcept{
 @try{try{
  NSMutableArray<NSString*>*labels=[NSMutableArray arrayWithCapacity:rows.size()];for(const auto&row:rows){NSString*text=[[NSString alloc]initWithBytes:row.data() length:row.size() encoding:NSUTF8StringEncoding];if(!text)return invalid;[labels addObject:text];}
  dispatch_async(dispatch_get_main_queue(),^{
   @try{
    if(!presentationCurrent(token)){presentationClosed(token);return;}
    UIWindow*window=nil;for(UIScene*scene in UIApplication.sharedApplication.connectedScenes)if(scene.activationState==UISceneActivationStateForegroundActive&&[scene isKindOfClass:UIWindowScene.class])for(UIWindow*w in ((UIWindowScene*)scene).windows)if(w.isKeyWindow){window=w;break;}
    UIViewController*presenter=window.rootViewController;while(presenter.presentedViewController)presenter=presenter.presentedViewController;
    if(!presenter||!presenter.view.window||UIApplication.sharedApplication.applicationState!=UIApplicationStateActive){selected(token,0,unavailable);presentationClosed(token);return;}
    if(!pickers)pickers=[NSMutableDictionary dictionary];auto*controller=[[YNXOriginalAccountPicker alloc]initWithStyle:UITableViewStyleInsetGrouped];controller.token=token;controller.rows=[labels copy];pickers[@(token)]=controller;
    auto*nav=[[UINavigationController alloc]initWithRootViewController:controller];controller.originalNavigation=nav;nav.modalPresentationStyle=UIModalPresentationFormSheet;nav.presentationController.delegate=controller;
    controller.presentationStarted=YES;
    [presenter presentViewController:nav animated:YES completion:^{controller.presentationCompleted=YES;if(controller.dismissRequested||!presentationCurrent(token))[controller closeOriginal];}];
   }@catch(id){selected(token,0,unavailable);YNXOriginalAccountPicker*c=pickers[@(token)];if(c)[c closeOriginal];else presentationClosed(token);}
  });return 0;
 }catch(...){return unavailable;}}@catch(id){return unavailable;}
}
void platformDismiss(uint64_t token)noexcept{dispatch_async(dispatch_get_main_queue(),^{YNXOriginalAccountPicker*c=pickers[@(token)];if(c)[c closeOriginal];else presentationClosed(token);});}
}
