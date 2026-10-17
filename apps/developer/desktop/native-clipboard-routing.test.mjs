import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Execute the production Objective-C menu method against controlled responders.
// This tests dispatch ordering, not real WebKit clipboard or CUA acceptance.
test('native clipboard dispatch is synchronous, preserving editor undo and scope guards', { skip: process.platform !== 'darwin' }, async () => {
  const source = await readFile(new URL('./macos/main.m', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('- (void)localWorkbenchCommand:(NSMenuItem *)sender {'), source.indexOf('- (void)newLocalProject:'));
  const selectorHelper = source.slice(source.indexOf('static SEL YNXLocalNativeEditSelector('), source.indexOf('static NSString *YNXLocalHTMLEscape('));
  assert.ok(method.length > 1000);
  assert.ok(selectorHelper.includes('NSSelectorFromString'));
  const dir = await mkdtemp(path.join(tmpdir(), 'ynx-clipboard-dispatch-'));
  try {
    const harness = `#import <Foundation/Foundation.h>
static NSString *clipboard; static NSString *consumed; static NSString *sentSelector; static id sentTarget; static int actions, asyncCalls;
@interface FakeView:NSObject
@property BOOL inside; @property NSURL *URL;
- (BOOL)isDescendantOf:(id)view;
- (void)callAsyncJavaScript:(NSString*)script arguments:(NSDictionary*)arguments inFrame:(id)frame inContentWorld:(id)world completionHandler:(void(^)(id,NSError*))handler;
@end
@implementation FakeView
- (BOOL)isDescendantOf:(id)view{return self.inside;}
- (void)callAsyncJavaScript:(NSString*)script arguments:(NSDictionary*)arguments inFrame:(id)frame inContentWorld:(id)world completionHandler:(void(^)(id,NSError*))handler{asyncCalls++;}
@end
@interface FakeWindow:NSObject
@property id firstResponder;
@end
@implementation FakeWindow @end
@interface FakeApplication:NSObject
@property FakeWindow *keyWindow;
- (BOOL)sendAction:(SEL)selector to:(id)target from:(id)sender;
@end
@implementation FakeApplication
- (BOOL)sendAction:(SEL)selector to:(id)target from:(id)sender{actions++;consumed=clipboard;sentSelector=NSStringFromSelector(selector);sentTarget=target;return YES;}
@end
static FakeApplication *application;
@interface FakeMenu:NSObject
@property id representedObject;
@end
@implementation FakeMenu @end
@interface FakeServer:NSObject @property BOOL running; @end
@implementation FakeServer @end
@interface FakeWorld:NSObject + (id)pageWorld; @end
@implementation FakeWorld + (id)pageWorld{return nil;} @end
#define NSApp application
#define NSView FakeView
#define NSWindow FakeWindow
#define NSResponder NSObject
#define NSMenuItem FakeMenu
#define WKContentWorld FakeWorld
static NSSet *YNXLocalWorkbenchCommands(void){return [NSSet setWithArray:@[@"core.cut",@"core.copy",@"core.paste",@"core.undo",@"core.redo",@"core.selectAll"]];}
${selectorHelper}
static BOOL YNXLocalEditorDocumentURL(NSURL *url,NSInteger port){return [url.absoluteString isEqual:@"http://127.0.0.1:1234/"];}
static NSString *YNXOrigin(NSInteger port){return @"http://127.0.0.1:1234";}
@interface Host:NSObject {
@public BOOL _localWorkbenchMode,_localCommandDocumentReady; FakeWindow *_window; FakeView *_webView; FakeServer *_server; id _localCloseRequest; NSInteger _port; NSMutableDictionary *_pendingLocalCommands;
}
@property NSMutableDictionary *pendingLocalCommands;
- (void)localWorkbenchCommand:(FakeMenu*)sender;
- (void)localCommandUnavailable:(NSString*)message;
@end
@implementation Host
@synthesize pendingLocalCommands=_pendingLocalCommands;
- (void)localCommandUnavailable:(NSString*)message{}
${method}
@end
int main(void){@autoreleasepool{
NSMutableArray *results=[NSMutableArray new];
for(NSString *scenario in @[@"core.paste",@"core.copy",@"core.cut",@"core.undo",@"core.redo",@"core.selectAll",@"unready",@"foreign-origin",@"server-stopped",@"closing",@"native-field"]){
Host *h=[Host new];h->_localWorkbenchMode=YES;h->_localCommandDocumentReady=![scenario isEqual:@"unready"];h->_window=[FakeWindow new];h->_webView=[FakeView new];h->_webView.inside=YES;h->_webView.URL=[NSURL URLWithString:[scenario isEqual:@"foreign-origin"]?@"https://example.invalid/":@"http://127.0.0.1:1234/"];h->_server=[FakeServer new];h->_server.running=YES;
application=[FakeApplication new];application.keyWindow=h->_window;h->_window.firstResponder=h->_webView;
if([scenario isEqual:@"server-stopped"])h->_server.running=NO;
if([scenario isEqual:@"closing"])h->_localCloseRequest=@YES;
if([scenario isEqual:@"native-field"]){FakeView *field=[FakeView new];field.inside=NO;h->_window.firstResponder=field;}
FakeMenu *item=[FakeMenu new];item.representedObject=[scenario hasPrefix:@"core."]?scenario:@"core.paste";
actions=0;asyncCalls=0;consumed=nil;sentSelector=nil;sentTarget=nil;clipboard=@"intended-current-clipboard";
[h localWorkbenchCommand:item];clipboard=@"restored-previous-clipboard";
[results addObject:@{@"scenario":scenario,@"nativeActions":@(actions),@"asyncCalls":@(asyncCalls),@"consumed":consumed?:@"none",@"selector":sentSelector?:@"none",@"currentResponder":@(sentTarget==application.keyWindow.firstResponder)}];
}
NSData *data=[NSJSONSerialization dataWithJSONObject:results options:0 error:nil];puts([[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}return 0;}`;
    const input = path.join(dir, 'dispatch.m'), binary = path.join(dir, 'dispatch');
    await writeFile(input, harness);
    execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang', ['-isysroot', process.env.SDKROOT || '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-mmacosx-version-min=15.0', input, '-o', binary], { timeout: 30000, stdio: 'pipe' });
    const results = JSON.parse(execFileSync(binary, [], { encoding: 'utf8', timeout: 5000 }));
    for (const row of results) {
      const clipboard = ['core.cut', 'core.copy', 'core.paste', 'native-field'].includes(row.scenario);
      assert.equal(row.nativeActions, clipboard ? 1 : 0, row.scenario + ': native responder count');
      assert.equal(row.asyncCalls, ['core.undo', 'core.redo', 'core.selectAll'].includes(row.scenario) ? 1 : 0, row.scenario + ': async registry count');
      assert.equal(row.consumed, clipboard ? 'intended-current-clipboard' : 'none', row.scenario + ': clipboard ordering');
      assert.equal(row.selector, clipboard ? (row.scenario === 'native-field' ? 'paste:' : row.scenario.slice(5) + ':') : 'none', row.scenario + ': correct native selector');
      assert.equal(row.currentResponder, clipboard ? 1 : 0, row.scenario + ': exact current responder');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
