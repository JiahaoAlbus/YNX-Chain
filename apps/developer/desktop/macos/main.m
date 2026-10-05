#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#import <WebKit/WebKit.h>
#import <sys/socket.h>
#import <netinet/in.h>
#import <fcntl.h>
#import <unistd.h>
#import <sys/stat.h>
#import <errno.h>
#import <stdlib.h>
#import <CoreServices/CoreServices.h>
#import "ynx-wallet-device-bridge.h"

static NSString *YNXCanonicalLocalDirectory(NSString *path) {
    if(![path isKindOfClass:NSString.class]||!path.isAbsolutePath)return nil;
    char *resolved=realpath(path.fileSystemRepresentation,NULL);if(!resolved)return nil;
    NSString *canonical=[NSString stringWithUTF8String:resolved];free(resolved);
    struct stat status;
    return [canonical isEqual:path]&&lstat(path.fileSystemRepresentation,&status)==0&&S_ISDIR(status.st_mode)?canonical:nil;
}
static NSString *YNXCanonicalPickedLocalDirectory(NSURL *url) {
    if(![url isKindOfClass:NSURL.class]||!url.isFileURL||!url.path.isAbsolutePath)return nil;
    // Foundation can present /private/tmp as /tmp even after URL standardizing.
    // Resolve the explicit native selection with the same filesystem authority
    // used by the strict launch boundary; do not relax that boundary itself.
    char *resolved=realpath(url.path.fileSystemRepresentation,NULL);if(!resolved)return nil;
    NSString *canonical=[NSString stringWithUTF8String:resolved];free(resolved);
    return YNXCanonicalLocalDirectory(canonical);
}
static BOOL YNXPrivateLocalDirectory(NSString *path) {
    struct stat status;
    return YNXCanonicalLocalDirectory(path)&&lstat(path.fileSystemRepresentation,&status)==0&&status.st_uid==getuid()&&(status.st_mode&0077)==0;
}
static NSDictionary *YNXPrivateLocalJSONWithLinks(NSString *path,nlink_t maximumLinks) {
    int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return nil;
    struct stat status;BOOL valid=fstat(fd,&status)==0&&S_ISREG(status.st_mode)&&status.st_uid==getuid()&&status.st_nlink>=1&&status.st_nlink<=maximumLinks&&(status.st_mode&0077)==0&&status.st_size>0&&status.st_size<=16384;
    char bytes[16385];ssize_t count=valid?pread(fd,bytes,sizeof(bytes),0):-1;close(fd);
    if(!valid||count!=status.st_size)return nil;
    id value=[NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:bytes length:(NSUInteger)count] options:0 error:nil];
    return [value isKindOfClass:NSDictionary.class]?value:nil;
}
static NSDictionary *YNXPrivateLocalJSON(NSString *path) {return YNXPrivateLocalJSONWithLinks(path,1);}
static BOOL YNXMatchingLocalReadyReceipt(NSDictionary *receipt,NSString *support,NSString *workspace,NSString *origin) {
    if(![receipt isKindOfClass:NSDictionary.class]||receipt.count!=4||![receipt[@"url"] isEqual:origin]||![receipt[@"workspace"] isEqual:workspace]||![receipt[@"projectId"] isKindOfClass:NSString.class]||![[NSUUID alloc]initWithUUIDString:receipt[@"projectId"]])return NO;
    NSString *profile=receipt[@"profile"];
    if(![profile isKindOfClass:NSString.class]||![profile hasPrefix:[support stringByAppendingString:@"/local-projects/"]]||!YNXPrivateLocalDirectory(profile))return NO;
    // The producer preserves its original pending hard link after atomically
    // admitting this binding. Recent-folder records themselves require one link.
    NSDictionary *binding=YNXPrivateLocalJSONWithLinks([profile stringByAppendingPathComponent:@"ynx-local-project.json"],2);
    return binding.count==4&&[binding[@"schemaVersion"] isEqual:@1]&&[binding[@"workspace"] isEqual:workspace]&&[binding[@"profile"] isEqual:profile]&&[binding[@"projectId"] isEqual:receipt[@"projectId"]];
}
static NSString *YNXRecentLocalWorkspace(NSString *support) {
    if(!YNXPrivateLocalDirectory(support))return nil;
    NSDictionary *record=YNXPrivateLocalJSON([support stringByAppendingPathComponent:@"desktop-local-recent.json"]);
    return [record[@"schemaVersion"] isEqual:@1]?YNXCanonicalLocalDirectory(record[@"workspace"]):nil;
}
static NSString *YNXSelectedLocalWorkspace(NSString *explicit,NSString *support) {
    return explicit?:YNXRecentLocalWorkspace(support);
}
static BOOL YNXRecordRecentLocalWorkspace(NSString *support,NSString *workspace) {
    if(!YNXPrivateLocalDirectory(support)||!YNXCanonicalLocalDirectory(workspace))return NO;
    int directory=open(support.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(directory<0)return NO;
    struct stat status;BOOL valid=fstat(directory,&status)==0&&S_ISDIR(status.st_mode)&&status.st_uid==getuid()&&(status.st_mode&0077)==0;
    const char *name="desktop-local-recent.json";
    if(valid&&fstatat(directory,name,&status,AT_SYMLINK_NOFOLLOW)==0)valid=S_ISREG(status.st_mode)&&status.st_uid==getuid()&&status.st_nlink==1&&(status.st_mode&0077)==0;
    else if(valid&&errno!=ENOENT)valid=NO;
    if(!valid){close(directory);return NO;}
    NSString *pending=[NSString stringWithFormat:@".recent-%@",NSUUID.UUID.UUIDString.lowercaseString];
    int fd=openat(directory,pending.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
    if(fd<0){close(directory);return NO;}
    NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"schemaVersion":@1,@"workspace":workspace} options:0 error:nil];
    NSUInteger offset=0;valid=data&&fchmod(fd,0600)==0;
    while(valid&&offset<data.length){ssize_t written=write(fd,(const char *)data.bytes+offset,data.length-offset);if(written<0&&errno==EINTR)continue;if(written<=0){valid=NO;break;}offset+=(NSUInteger)written;}
    valid=valid&&fsync(fd)==0;close(fd);
    if(valid)valid=renameat(directory,pending.fileSystemRepresentation,directory,name)==0;
    if(!valid)unlinkat(directory,pending.fileSystemRepresentation,0);
    close(directory);return valid;
}
static BOOL YNXLocalEditorDocumentURL(NSURL *url,NSInteger port) {
    return port>0&&[url.scheme isEqual:@"http"]&&[url.host isEqual:@"127.0.0.1"]&&url.port.integerValue==port&&!url.user.length&&!url.password.length&&(!url.path.length||[url.path isEqual:@"/"]);
}
static BOOL YNXLocalStartupFailureMayExit(BOOL failed,BOOL editorDocumentLoaded) {return failed&&!editorDocumentLoaded;}
static NSTimeInterval const YNXLocalReadinessBudget=180.0;
typedef NS_ENUM(NSInteger,YNXLocalReadinessDecision){YNXLocalReadinessIgnore,YNXLocalReadinessWait,YNXLocalReadinessLoad,YNXLocalReadinessFail};
static YNXLocalReadinessDecision YNXLocalReadinessState(NSUInteger generation,NSUInteger current,BOOL cancelled,BOOL complete,BOOL running,NSTimeInterval elapsed,BOOL responseReady,BOOL receiptReady){
    if(generation!=current||cancelled||complete)return YNXLocalReadinessIgnore;
    if(!running||elapsed>=YNXLocalReadinessBudget)return YNXLocalReadinessFail;
    return responseReady&&receiptReady?YNXLocalReadinessLoad:YNXLocalReadinessWait;
}
static BOOL YNXLocalReadinessResponse(NSURLResponse *response,NSError *error,NSInteger port){
    return !error&&[response isKindOfClass:NSHTTPURLResponse.class]&&[(NSHTTPURLResponse *)response statusCode]==200&&YNXLocalEditorDocumentURL(response.URL,port);
}
static NSSet<NSString *> *YNXLocalWorkbenchCommands(void) {
    static NSSet *commands;static dispatch_once_t once;dispatch_once(&once,^{commands=[NSSet setWithArray:@[
        @"workbench.action.files.newUntitledFile",@"workspace:openFile",@"core.save",@"file.saveAs",@"core.saveAll",@"core.close.tab",@"preferences:open",
        @"core.undo",@"core.redo",@"core.cut",@"core.copy",@"core.paste",@"core.find",@"core.replace",@"editor.action.commentLine",@"editor.action.formatDocument",
        @"core.selectAll",@"editor.action.smartSelect.expand",@"editor.action.smartSelect.shrink",@"editor.action.selectHighlights",@"editor.action.insertCursorAbove",@"editor.action.insertCursorBelow",
        @"workbench.action.showCommands",@"fileNavigator:toggle",@"search-in-workspace.toggle",@"scmView:toggle",@"debug:toggle",@"vsxExtensions.toggle",@"problemsView:toggle",@"output:toggle",@"outlineView:toggle",@"core.toggle.left.panel",@"core.toggle.bottom.panel",@"workbench.action.selectTheme",
        @"file-search.openFile",@"editor.action.gotoLine",@"editor.action.revealDefinition",@"editor.action.goToReferences",@"textEditor.commands.go.back",@"textEditor.commands.go.forward",
        @"workbench.action.debug.start",@"workbench.action.debug.run",@"workbench.action.debug.stop",@"workbench.action.debug.restart",@"debug.configurations.open",
        @"terminal:new",@"workbench.action.terminal.toggleTerminal",@"terminal:split",@"terminal:clear",@"task:run:build",@"workbench.action.tasks.runTask"
    ]];});return commands;
}
static BOOL YNXLocalCommandResult(id value,NSDictionary *pending) {
    if(![value isKindOfClass:NSDictionary.class])return NO;NSDictionary *body=value;
    if((body.count!=3&&body.count!=4)||![body[@"action"] isEqual:@"command-result"]||![body[@"requestId"] isKindOfClass:NSString.class]||!pending[body[@"requestId"]]||![body[@"accepted"] isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)body[@"accepted"])!=CFBooleanGetTypeID())return NO;
    if(body.count==4&&(![body[@"error"] isKindOfClass:NSString.class]||[body[@"error"] length]>160))return NO;
    return YES;
}
static BOOL YNXLocalOpenFolderPayload(id value) {return [value isKindOfClass:NSDictionary.class]&&[value count]==1&&[value[@"action"] isEqual:@"open-folder"];}
static BOOL YNXLocalLocalePayload(id value) {
    return [value isKindOfClass:NSDictionary.class]&&[value count]==2&&[value[@"action"] isEqual:@"locale"]&&[value[@"locale"] isKindOfClass:NSString.class]&&[@[@"zh-cn",@"en"] containsObject:value[@"locale"]];
}
static NSString *YNXLocalStoredLocale(id value) {return [value isKindOfClass:NSString.class]&&[@[@"en",@"zh-cn"] containsObject:value]?value:@"en";}
static NSString *YNXLocalMenuLabel(NSString *label,NSString *locale) {
    if(![locale isEqual:@"zh-cn"])return label;
    static NSDictionary *labels;static dispatch_once_t once;dispatch_once(&once,^{labels=@{
        @"File":@"文件",@"Edit":@"编辑",@"Selection":@"选择",@"View":@"视图",@"Go":@"转到",@"Run":@"运行",@"Terminal":@"终端",@"Window":@"窗口",@"Help":@"帮助",
        @"About YNX Developer":@"关于 YNX Developer",@"Settings…":@"设置…",@"Quit YNX Developer":@"退出 YNX Developer",
        @"New Text File":@"新建文本文件",@"Open File…":@"打开文件…",@"Open Folder…":@"打开文件夹…",@"Save":@"保存",@"Save As…":@"另存为…",@"Save All":@"全部保存",@"Close Editor":@"关闭编辑器",
        @"Undo":@"撤销",@"Redo":@"重做",@"Cut":@"剪切",@"Copy":@"复制",@"Paste":@"粘贴",@"Find":@"查找",@"Replace":@"替换",@"Toggle Line Comment":@"切换行注释",@"Format Document":@"格式化文档",
        @"Select All":@"全选",@"Expand Selection":@"扩大选区",@"Shrink Selection":@"缩小选区",@"Select All Occurrences":@"选择所有匹配项",@"Add Cursor Above":@"在上方添加光标",@"Add Cursor Below":@"在下方添加光标",
        @"Command Palette…":@"命令面板…",@"Explorer":@"资源管理器",@"Search":@"搜索",@"Source Control":@"源代码管理",@"Run and Debug":@"运行和调试",@"Extensions":@"扩展",@"Problems":@"问题",@"Output":@"输出",@"Outline":@"大纲",
        @"Toggle Primary Side Bar":@"切换主侧边栏",@"Toggle Panel":@"切换面板",@"Color Theme…":@"颜色主题…",
        @"Go to File…":@"转到文件…",@"Go to Line/Column…":@"转到行/列…",@"Go to Definition":@"转到定义",@"Go to References":@"转到引用",@"Back":@"后退",@"Forward":@"前进",
        @"Start Debugging":@"启动调试",@"Run Without Debugging":@"运行而不调试",@"Stop Debugging":@"停止调试",@"Restart Debugging":@"重新启动调试",@"Open Configurations…":@"打开配置…",
        @"New Terminal":@"新建终端",@"Toggle Terminal":@"切换终端",@"Split Terminal":@"拆分终端",@"Clear Terminal":@"清除终端",@"Run Build Task…":@"运行生成任务…",@"Run Task…":@"运行任务…",
        @"Minimize":@"最小化",@"Bring All to Front":@"全部前置",@"Show All Commands…":@"显示所有命令…",
        @"Project already open":@"项目已打开",@"This project is already open in another YNX Developer window. Continue in that window, or use File → Open Folder… to choose a different project. Your files and running terminal were preserved.":@"此项目已在另一个 YNX Developer 窗口中打开。请在已有窗口中继续，或通过“文件 → 打开文件夹…”选择其他项目。文件和运行中的终端已保留。",
        @"Open":@"打开",@"OK":@"确定",@"Action unavailable":@"操作不可用",@"Wait for your workspace to finish opening, then try again.":@"请等待工作区打开完成后重试。",
        @"Finish the current actions before starting another one.":@"请先完成当前操作，再开始其他操作。",@"This action is not available in the current editor.":@"此操作在当前编辑器中不可用。",
        @"This command is unavailable or could not complete. Check the workbench notifications and project configuration.":@"此命令不可用或未能完成，请查看工作台通知和项目配置。",@"This menu command is not supported.":@"不支持此菜单命令。",@"This command is unavailable in the current editor.":@"此命令在当前编辑器中不可用。"
    };});return labels[label]?:label;
}
static SEL YNXLocalNativeEditSelector(NSString *command) {
    NSDictionary *selectors=@{@"core.undo":@"undo:",@"core.redo":@"redo:",@"core.cut":@"cut:",@"core.copy":@"copy:",@"core.paste":@"paste:",@"core.selectAll":@"selectAll:"};
    NSString *name=selectors[command];return name?NSSelectorFromString(name):NULL;
}
static NSString *YNXLocalHTMLEscape(NSString *text) {
    NSString *escaped=[(text?:@"") stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"];
    escaped=[escaped stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"];
    escaped=[escaped stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"];
    escaped=[escaped stringByReplacingOccurrencesOfString:@"\"" withString:@"&quot;"];
    return [escaped stringByReplacingOccurrencesOfString:@"'" withString:@"&#39;"];
}
static NSString *YNXLocalStatusPage(NSString *title,NSString *message) {
    return [NSString stringWithFormat:@"<!doctype html><meta charset=utf-8><meta name=color-scheme content=dark><style>html{background:#111214;color:#E8ECF5}body{font:16px -apple-system;margin:0;padding:48px;line-height:1.6}h1{font-size:24px;color:#E8ECF5;border-left:4px solid #002FA7;padding-left:16px}p{max-width:760px;overflow-wrap:anywhere}a,:focus-visible{color:#7399FF}</style><h1>%@</h1><p>%@</p>",YNXLocalHTMLEscape(title),YNXLocalHTMLEscape(message)];
}
static NSDictionary *YNXLocalAppearancePayload(id value) {
    if(![value isKindOfClass:NSDictionary.class])return nil;
    NSDictionary *body=value;
    if(body.count!=3||![body[@"action"] isEqual:@"appearance"]||![body[@"mode"] isKindOfClass:NSString.class]||![@[@"dark",@"light"] containsObject:body[@"mode"]]||![body[@"background"] isKindOfClass:NSString.class])return nil;
    NSString *color=body[@"background"];
    if(color.length!=7||![color hasPrefix:@"#"]||[[color substringFromIndex:1] rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefABCDEF"] invertedSet]].location!=NSNotFound)return nil;
    NSData *bytes=[NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    return bytes&&bytes.length<=128?body:nil;
}
static NSColor *YNXLocalBackgroundColor(NSString *hex) {
    unsigned value=0;[[NSScanner scannerWithString:[hex substringFromIndex:1]] scanHexInt:&value];
    return [NSColor colorWithSRGBRed:((value>>16)&255)/255.0 green:((value>>8)&255)/255.0 blue:(value&255)/255.0 alpha:1];
}
static NSString *YNXLocalAppearanceScript(void) {
    // Observe only actual theme styles, never a blank page's default white body.
    // The observer is document-scoped and releases itself on navigation away.
    return @"(()=>{if(location.pathname!=='/')return;"
    @"const color=value=>{value=value.trim();let m=/^#([0-9a-f]{6})$/i.exec(value);if(m)return m[1].match(/../g).map(x=>parseInt(x,16));m=/^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*(1(?:\\.0+)?))?\\s*\\)$/i.exec(value);if(!m)return null;const rgb=m.slice(1,4).map(Number);return rgb.every(x=>x<=255)?rgb:null;};"
    @"const luminance=rgb=>rgb.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);"
    @"let last='',scheduled=false,stopped=false;const report=()=>{scheduled=false;if(stopped||!document.body)return;const css=getComputedStyle(document.body),bg=color(css.getPropertyValue('--theia-editor-background')),fg=color(css.getPropertyValue('--theia-editor-foreground'));if(!bg||!fg)return;const b=luminance(bg),f=luminance(fg);if(Math.abs(b-f)<.05)return;const mode=b<f?'dark':'light',background='#'+bg.map(x=>x.toString(16).padStart(2,'0')).join(''),key=mode+background;if(key===last)return;last=key;window.webkit.messageHandlers.ynxLocalWorkbench.postMessage({action:'appearance',mode,background});};"
    @"const schedule=()=>{if(!stopped&&!scheduled){scheduled=true;queueMicrotask(report);}};const observer=new MutationObserver(schedule);const start=()=>{if(stopped)return;if(document.head)observer.observe(document.head,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style']});if(document.body)observer.observe(document.body,{attributes:true,attributeFilter:['class','style']});observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style']});schedule();};"
    @"if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();window.addEventListener('pagehide',()=>{stopped=true;observer.disconnect();document.removeEventListener('DOMContentLoaded',start);},{once:true});})();";
}

static NSString *YNXJSON(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static NSString *YNXOrigin(NSInteger port) { return [NSString stringWithFormat:@"http://127.0.0.1:%ld",(long)port]; }
static BOOL YNXTrustedFrame(WKFrameInfo *frame, NSInteger port) {
    WKSecurityOrigin *origin=frame.securityOrigin;
    return port>0 && port<=65535 && frame.mainFrame && [origin.protocol isEqualToString:@"http"] && [origin.host isEqualToString:@"127.0.0.1"] && origin.port==port;
}
static BOOL YNXTrustedMessage(WKScriptMessage *message, WKWebView *webView, NSInteger port) {
    return webView && message.webView==webView && YNXTrustedFrame(message.frameInfo,port);
}
static NSString *YNXOriginBoundScript(NSString *source, NSInteger port) {
    return [NSString stringWithFormat:@"if(location.origin===%@){%@}",YNXJSON(YNXOrigin(port)),source];
}
static NSString *YNXLocalLocaleSeedScript(id stored) {
    // Every new window/port receives the App preference before nls imports.
    // A same-window language selection writes localeId then reloads: preserve
    // that valid choice rather than replaying the initial window's locale.
    return [NSString stringWithFormat:@"(()=>{if(location.pathname!=='/')return;try{const key='localeId',marker='YNXDeveloperDisplayLocaleSeeded',value=localStorage.getItem(key);let valid=false;if(typeof value==='string'&&value.length>=2&&value.length<=63){try{valid=Intl.getCanonicalLocales(value).length===1;}catch{}}if(sessionStorage.getItem(marker)!=='1'||!valid)localStorage.setItem(key,%@);sessionStorage.setItem(marker,'1');}catch{}})();",YNXJSON(YNXLocalStoredLocale(stored))];
}
static void YNXEvaluateTrustedScript(WKWebView *webView, NSInteger port, NSString *source) {
    // A delayed Keychain/command reply cannot expose data after navigation.
    [webView evaluateJavaScript:YNXOriginBoundScript(source,port) completionHandler:nil];
}
typedef NS_ENUM(NSInteger, YNXNavigationDisposition) { YNXNavigationAllow, YNXNavigationCancel, YNXNavigationOpenExternal };
static YNXNavigationDisposition YNXMainNavigation(NSURL *url, NSInteger port, WKNavigationType type) {
    if([url.absoluteString isEqualToString:@"about:blank"])return YNXNavigationAllow;
    if(port>0 && [url.scheme isEqualToString:@"http"] && [url.host isEqualToString:@"127.0.0.1"] && url.port.integerValue==port)return YNXNavigationAllow;
    if(type==WKNavigationTypeLinkActivated && ([@"https" isEqualToString:url.scheme] || [@"http" isEqualToString:url.scheme]))return YNXNavigationOpenExternal;
    return YNXNavigationCancel;
}
static YNXNavigationDisposition YNXNewWindowNavigation(NSURL *url, NSInteger port, WKNavigationType type, BOOL trustedSource) {
    if(!trustedSource || type!=WKNavigationTypeLinkActivated || [url.absoluteString isEqualToString:@"about:blank"])return YNXNavigationCancel;
    return YNXMainNavigation(url,port,type);
}
static BOOL YNXHostedDocument(NSURL *url) {
    NSString *host=url.host.lowercaseString;
    return [url.scheme isEqualToString:@"https"] && (!url.port || url.port.integerValue==443) && !url.user.length && !url.password.length &&
        [host containsString:@"."] && ![host hasSuffix:@".localhost"] && ![host hasSuffix:@".local"] && ![host hasSuffix:@".internal"] &&
        [host rangeOfString:@"^[0-9.]+$" options:NSRegularExpressionSearch].location==NSNotFound && ![host containsString:@":"];
}
static BOOL YNXWalletProjectsURL(NSURL *url) { return YNXHostedDocument(url) && [url.host isEqualToString:@"developer.ynxweb4.com"] && [url.path isEqualToString:@"/projects"] && !url.query.length && !url.fragment.length; }
static BOOL YNXHostedWalletPair(NSURL *url, NSURL *source, BOOL userInitiated) {
    if(!userInitiated || !YNXHostedDocument(source) || ![source.host isEqualToString:@"wallet-auth.ynxweb4.com"] || ![source.path isEqualToString:@"/v2/browser-sessions/authorize"] ||
       ![url.absoluteString hasPrefix:@"ynxwallet://wc?uri="] || url.fragment.length)return NO;
    NSArray<NSURLQueryItem *> *outer=[NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO].queryItems;
    if(outer.count!=1 || ![outer.firstObject.name isEqualToString:@"uri"])return NO;
    NSString *pairing=outer.firstObject.value;
    if(!pairing.length || pairing.length>2048 || [pairing containsString:@"%"] || [pairing rangeOfString:@"^wc:[a-f0-9]{64}@2\\?" options:NSRegularExpressionSearch].location!=0)return NO;
    NSArray<NSURLQueryItem *> *items=[NSURLComponents componentsWithString:pairing].queryItems;NSMutableDictionary *fields=[NSMutableDictionary new];
    for(NSURLQueryItem *item in items){if(![@[@"relay-protocol",@"symKey",@"expiryTimestamp"] containsObject:item.name] || fields[item.name] || !item.value)return NO;fields[item.name]=item.value;}
    NSString *key=fields[@"symKey"],*expiry=fields[@"expiryTimestamp"];
    return [fields[@"relay-protocol"] isEqualToString:@"irn"] && key.length==64 && [key rangeOfString:@"^[a-f0-9]{64}$" options:NSRegularExpressionSearch].location==0 &&
        (!expiry || ([expiry rangeOfString:@"^[0-9]{1,12}$" options:NSRegularExpressionSearch].location==0 && expiry.longLongValue>NSDate.date.timeIntervalSince1970));
}

static SEL YNXEditSelector(NSString *command) {
    if([command isEqualToString:@"selectAll"])return @selector(selectAll:);
    if([command isEqualToString:@"undo"])return @selector(undo:);
    if([command isEqualToString:@"redo"])return @selector(redo:);
    if([command isEqualToString:@"cut"])return @selector(cut:);
    if([command isEqualToString:@"copy"])return @selector(copy:);
    if([command isEqualToString:@"paste"])return @selector(paste:);
    return NULL;
}
static BOOL YNXShouldForwardNativeEdit(id route, NSError *error, BOOL sameWindow, BOOL sameResponder) {
    return !error && [route isEqual:@"native"] && sameWindow && sameResponder;
}

static NSString *const YNXWalletStorageService = @"com.ynxweb4.developer.product-session-v2";
static BOOL YNXWalletStorageKey(NSString *key) {
    return [key isKindOfClass:NSString.class] && key.length > 24 && key.length <= 256 && [key hasPrefix:@"ynx.product-session.v2:developer:macos:com.ynxweb4.developer.testnetpreview"];
}
static BOOL YNXWalletStorageBody(NSDictionary *body, NSString *action) {
    if(!YNXWalletStorageKey(body[@"key"]))return NO;
    if(![action isEqualToString:@"storage-set"])return YES;
    id value=body[@"value"];
    return [value isKindOfClass:NSString.class] && [value length]<=32768 && [value dataUsingEncoding:NSUTF8StringEncoding]!=nil;
}
static BOOL YNXCommandPath(id path) {
    return [path isKindOfClass:NSString.class] && [path length]>0 && [path length]<=240 && ![path hasPrefix:@"/"] && [path rangeOfString:@"\\"].location==NSNotFound && ![[path pathComponents] containsObject:@".."];
}
static NSDictionary *YNXCommandPayload(id value) {
    if(![value isKindOfClass:NSDictionary.class])return nil;
    NSDictionary *payload=value; id task=payload[@"task"],identifier=payload[@"projectId"],files=payload[@"files"];
    if(![task isKindOfClass:NSString.class] || ![@[@"test",@"check"] containsObject:task] || ![identifier isKindOfClass:NSString.class] || ![identifier length] || [identifier length]>160 || ![files isKindOfClass:NSDictionary.class] || [files count]<1 || [files count]>500)return nil;
    NSCharacterSet *unsafe=[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"] invertedSet];
    if([identifier rangeOfCharacterFromSet:unsafe].location!=NSNotFound)return nil;
    NSUInteger total=0;
    for(id path in files){
        id content=files[path]; if(!YNXCommandPath(path) || ![content isKindOfClass:NSString.class])return nil;
        NSData *data=[content dataUsingEncoding:NSUTF8StringEncoding];if(!data || data.length>524288)return nil;
        total+=data.length;if(total>5242880)return nil;
    }
    return payload;
}
static NSDictionary *YNXWalletAvailability(void) {
    // Native availability cannot safely probe a bare or synthetic authorization
    // route. The exact populated URI is resolved immediately before opening.
    return @{ @"installed":@NO, @"schemeRegistered":@NO };
}
static BOOL YNXWalletStorageSelfTest(void) {
    NSString *account=[NSString stringWithFormat:@"ynx.product-session.v2:developer:macos:com.ynxweb4.developer.testnetpreview:self-test:%@",NSUUID.UUID.UUIDString];
    NSData *expected=[@"ynx-wallet-storage-self-test" dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *query=@{ (__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService:YNXWalletStorageService, (__bridge id)kSecAttrAccount:account };
    SecItemDelete((__bridge CFDictionaryRef)query);
    NSMutableDictionary *insert=[query mutableCopy]; insert[(__bridge id)kSecValueData]=expected; insert[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    OSStatus status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL); if(status!=errSecSuccess)return NO;
    NSMutableDictionary *read=[query mutableCopy]; read[(__bridge id)kSecReturnData]=@YES; read[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne; CFTypeRef result=nil;
    status=SecItemCopyMatching((__bridge CFDictionaryRef)read,&result); NSData *actual=CFBridgingRelease(result); BOOL matches=status==errSecSuccess&&[actual isEqualToData:expected];
    OSStatus removed=SecItemDelete((__bridge CFDictionaryRef)query); return matches&&(removed==errSecSuccess||removed==errSecItemNotFound);
}

static NSInteger YNXAvailablePort(void) {
    int fd = socket(AF_INET, SOCK_STREAM, 0); if (fd < 0) return 4177;
    struct sockaddr_in address = {0}; address.sin_len = sizeof(address); address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); address.sin_port = 0;
    if (bind(fd, (struct sockaddr *)&address, sizeof(address)) != 0) { close(fd); return 4177; }
    socklen_t length = sizeof(address); getsockname(fd, (struct sockaddr *)&address, &length); close(fd); return ntohs(address.sin_port);
}

static NSURL *YNXWorkspaceSnapshotURL(void) {
    NSString *support=NSProcessInfo.processInfo.environment[@"YNX_CODE_DESKTOP_SUPPORT_DIR"];
    if(!support.length) support=[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/YNXDeveloper"];
    return [NSURL fileURLWithPath:[support stringByAppendingPathComponent:@"workspace-ui/project-v1.json"]];
}
static BOOL YNXWorkspacePath(id value) {
    if(![value isKindOfClass:NSString.class])return NO;
    NSString *path=value;
    if(!path.length || path.length>240 || [path hasPrefix:@"/"] || [path containsString:@".."])return NO;
    NSCharacterSet *invalid=[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_./ +@-"] invertedSet];
    if([path rangeOfCharacterFromSet:invalid].location!=NSNotFound)return NO;
    for(NSString *part in [path componentsSeparatedByString:@"/"])if(!part.length || [part isEqualToString:@"."])return NO;
    return YES;
}
static NSDictionary *YNXWorkspaceProject(id value) {
    if(![value isKindOfClass:NSDictionary.class]) return nil;
    NSDictionary *project=value; NSString *identifier=project[@"id"], *name=project[@"name"], *active=project[@"active"];
    if(![identifier isKindOfClass:NSString.class] || !identifier.length || identifier.length>160 || ![name isKindOfClass:NSString.class] || name.length>160 || ![active isKindOfClass:NSString.class]) return nil;
    NSCharacterSet *invalid=[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"] invertedSet];
    if([identifier rangeOfCharacterFromSet:invalid].location!=NSNotFound || ![project[@"files"] isKindOfClass:NSDictionary.class] || [project[@"files"] count]>256 || ![project[@"folders"] isKindOfClass:NSArray.class] || ![project[@"open"] isKindOfClass:NSArray.class] || ![project[@"revision"] isKindOfClass:NSNumber.class] || ![project[@"remoteRevision"] isKindOfClass:NSNumber.class]) return nil;
    NSDictionary *files=project[@"files"];
    for(id path in files)if(!YNXWorkspacePath(path) || ![files[path] isKindOfClass:NSString.class])return nil;
    if(active.length && !files[active])return nil;
    for(id path in project[@"folders"])if(!YNXWorkspacePath(path))return nil;
    for(id path in project[@"open"])if(!YNXWorkspacePath(path) || !files[path])return nil;
    NSData *fileData=[NSJSONSerialization dataWithJSONObject:files options:0 error:nil];
    if(!fileData || fileData.length>2*1024*1024)return nil;
    NSMutableDictionary *snapshot=[NSMutableDictionary dictionary];
    for(NSString *key in @[@"id",@"name",@"files",@"folders",@"open",@"active",@"revision",@"remoteRevision"]) snapshot[key]=project[key];
    NSData *encoded=[NSJSONSerialization dataWithJSONObject:snapshot options:0 error:nil];
    return encoded && encoded.length<=3*1024*1024 ? snapshot : nil;
}
static NSDictionary *YNXReadWorkspaceSnapshot(NSURL *url, NSError **error) {
    NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:url.path error:error];
    if(!attributes) { if((*error).code==NSFileReadNoSuchFileError || (*error).code==NSFileNoSuchFileError) *error=nil; return nil; }
    if(![attributes[NSFileType] isEqual:NSFileTypeRegular] || [attributes[NSFileSize] unsignedLongLongValue]>3*1024*1024) {
        *error=[NSError errorWithDomain:@"YNXWorkspace" code:1 userInfo:@{NSLocalizedDescriptionKey:@"The existing workspace recovery file is invalid; it was preserved."}]; return nil;
    }
    NSData *data=[NSData dataWithContentsOfURL:url options:0 error:error]; if(!data)return nil;
    id envelope=[NSJSONSerialization JSONObjectWithData:data options:0 error:error];
    NSDictionary *project=[envelope isKindOfClass:NSDictionary.class] && [envelope[@"schemaVersion"] isEqual:@1] ? YNXWorkspaceProject(envelope[@"project"]) : nil;
    if(!project && !*error) *error=[NSError errorWithDomain:@"YNXWorkspace" code:2 userInfo:@{NSLocalizedDescriptionKey:@"The existing workspace recovery file is invalid; it was preserved."}];
    return project;
}
static BOOL YNXWriteWorkspaceSnapshot(NSURL *url, id value, NSError **error) {
    NSDictionary *project=YNXWorkspaceProject(value);
    if(!project) { *error=[NSError errorWithDomain:@"YNXWorkspace" code:3 userInfo:@{NSLocalizedDescriptionKey:@"Workspace recovery data exceeded its safe limits."}]; return NO; }
    NSFileManager *fm=NSFileManager.defaultManager; NSURL *directory=url.URLByDeletingLastPathComponent;
    if(![fm createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:error])return NO;
    NSDictionary *attributes=[fm attributesOfItemAtPath:directory.path error:error];
    if(![attributes[NSFileType] isEqual:NSFileTypeDirectory])return NO;
    NSDictionary *existing=[fm attributesOfItemAtPath:url.path error:nil];
    if(existing && ![existing[NSFileType] isEqual:NSFileTypeRegular])return NO;
    NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"schemaVersion":@1,@"project":project} options:0 error:error];
    return data && [data writeToURL:url options:NSDataWritingAtomic error:error] && [fm setAttributes:@{NSFilePosixPermissions:@0600} ofItemAtPath:url.path error:error];
}

typedef NSDictionary *(^YNXSnapshotReader)(NSError **error);
@interface YNXWorkspaceBridge : NSObject <WKScriptMessageHandler>
@property(nonatomic,weak) WKWebView *webView;
@property(nonatomic,weak) NSWindow *window;
@property(nonatomic) NSInteger port;
@property(nonatomic,strong) NSDictionary *initialProject;
@property(nonatomic,strong) NSError *readError;
@property(nonatomic,strong) dispatch_queue_t ioQueue;
@property(nonatomic) BOOL restoring;
@property(nonatomic) BOOL restoreComplete;
- (void)restoreWithCompletion:(void (^)(NSError *))completion;
- (void)restoreUsingReader:(YNXSnapshotReader)reader completion:(void (^)(NSError *))completion;
- (void)saveProject:(id)value completion:(void (^)(NSError *))completion;
@end
@implementation YNXWorkspaceBridge
- (instancetype)init { if((self=[super init])) _ioQueue=dispatch_queue_create("com.ynxweb4.developer.workspace-io",DISPATCH_QUEUE_SERIAL); return self; }
- (void)restoreWithCompletion:(void (^)(NSError *))completion {
    NSURL *url=YNXWorkspaceSnapshotURL();
    [self restoreUsingReader:^NSDictionary *(NSError **error){return YNXReadWorkspaceSnapshot(url,error);} completion:completion];
}
- (void)restoreUsingReader:(YNXSnapshotReader)reader completion:(void (^)(NSError *))completion {
    if(_restoring){completion([NSError errorWithDomain:@"YNXWorkspace" code:6 userInfo:nil]);return;}
    _restoring=YES; _restoreComplete=NO;
    dispatch_async(_ioQueue, ^{
        NSError *error=nil; NSDictionary *project=reader(&error);
        dispatch_async(dispatch_get_main_queue(), ^{
            self.restoring=NO; self.readError=error; self.restoreComplete=error==nil;
            if(!error)self.initialProject=project;
            completion(error);
        });
    });
}
- (void)saveProject:(id)value completion:(void (^)(NSError *))completion {
    // No default/empty project can replace a snapshot that has not been read.
    if(!_restoreComplete || _restoring || _readError){completion(_readError?:[NSError errorWithDomain:@"YNXWorkspace" code:7 userInfo:nil]);return;}
    NSDictionary *project=YNXWorkspaceProject(value);
    if(!project){completion([NSError errorWithDomain:@"YNXWorkspace" code:3 userInfo:nil]);return;}
    NSURL *url=YNXWorkspaceSnapshotURL();
    dispatch_async(_ioQueue, ^{
        NSError *error=nil; BOOL saved=YNXWriteWorkspaceSnapshot(url,project,&error);
        if(!saved && !error)error=[NSError errorWithDomain:@"YNXWorkspace" code:4 userInfo:nil];
        dispatch_async(dispatch_get_main_queue(), ^{if(saved)self.initialProject=project;completion(error);});
    });
}
- (void)reply:(NSString *)job error:(NSError *)error {
    NSDictionary *event=error ? @{@"id":job,@"error":@"Workspace recovery or export could not be saved. Check available disk space and file permissions."} : @{@"id":job};
    YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.__ynxWorkspaceResult(%@)",YNXJSON(event)]);
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if(!YNXTrustedMessage(message,_webView,_port) || ![message.name isEqualToString:@"workspace"])return;
    id rawBody=message.body; NSDictionary *body=[rawBody isKindOfClass:NSDictionary.class]?rawBody:nil;
    NSString *job=body[@"id"], *action=body[@"action"];
    if(![job isKindOfClass:NSString.class] || !job.length || job.length>80 || ![action isKindOfClass:NSString.class] || !action.length || action.length>32)return;
    if([action isEqualToString:@"save-project"]) {
        NSDictionary *project=YNXWorkspaceProject(body[@"project"]);if(!project)return;
        [self saveProject:project completion:^(NSError *error){[self reply:job error:error];}]; return;
    }
    if([action isEqualToString:@"export-project"]) {
        NSString *content=body[@"content"], *filename=body[@"filename"];
        NSData *data=[content isKindOfClass:NSString.class]?[content dataUsingEncoding:NSUTF8StringEncoding]:nil;
        if(!data || data.length>3*1024*1024 || ![filename isKindOfClass:NSString.class] || filename.length>240 || ![filename.lastPathComponent isEqualToString:filename]) { [self reply:job error:[NSError errorWithDomain:@"YNXWorkspace" code:5 userInfo:nil]]; return; }
        NSSavePanel *panel=[NSSavePanel savePanel]; panel.nameFieldStringValue=filename;
        [panel beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){ NSError *error=nil; if(result==NSModalResponseOK)[data writeToURL:panel.URL options:NSDataWritingAtomic error:&error]; [self reply:job error:error]; }];
    }
}
@end

@interface YNXCommandBridge : NSObject <WKScriptMessageHandler>
@property(nonatomic,weak) WKWebView *webView;
@property(nonatomic,strong) NSURL *nodeURL;
@property(nonatomic,strong) NSMutableDictionary<NSString *,NSTask *> *processes;
@property(nonatomic,strong) NSLock *lock;
@property(nonatomic) NSInteger port;
- (instancetype)initWithWebView:(WKWebView *)webView nodeURL:(NSURL *)nodeURL;
@end

@implementation YNXCommandBridge
- (instancetype)initWithWebView:(WKWebView *)webView nodeURL:(NSURL *)nodeURL { if ((self=[super init])) { _webView=webView; _nodeURL=nodeURL; _processes=[NSMutableDictionary dictionary]; _lock=[NSLock new]; } return self; }
- (void)walletStorageReply:(NSString *)job ok:(BOOL)ok value:(id)value error:(NSString *)error {
    NSMutableDictionary *event=[@{ @"id":job, @"ok":@(ok) } mutableCopy]; if(value) event[@"value"]=value; if(error) event[@"error"]=error;
    NSString *json=YNXJSON(event); if(json)YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.__ynxWalletStorageResult(%@)",json]);
}
- (void)handleWalletStorage:(NSDictionary *)body action:(NSString *)action job:(NSString *)job {
    NSString *key=[body[@"key"] isKindOfClass:NSString.class]?body[@"key"]:nil, *value=[body[@"value"] isKindOfClass:NSString.class]?body[@"value"]:nil;
    if(!YNXWalletStorageKey(key) || ([action isEqualToString:@"storage-set"] && (!value || value.length > 32768))) { [self walletStorageReply:job ok:NO value:nil error:@"Wallet secure-storage request is invalid."]; return; }
    NSDictionary *query=@{ (__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService:YNXWalletStorageService, (__bridge id)kSecAttrAccount:key };
    if([action isEqualToString:@"storage-get"]) {
        NSMutableDictionary *read=[query mutableCopy]; read[(__bridge id)kSecReturnData]=@YES; read[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne; CFTypeRef result=nil; OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)read,&result);
        if(status==errSecItemNotFound){ [self walletStorageReply:job ok:YES value:[NSNull null] error:nil]; return; }
        NSData *data=CFBridgingRelease(result); NSString *stored=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]; if(status!=errSecSuccess || !stored){ [self walletStorageReply:job ok:NO value:nil error:@"Wallet secure storage is unavailable."]; return; }
        [self walletStorageReply:job ok:YES value:stored error:nil]; return;
    }
    if([action isEqualToString:@"storage-remove"]) { OSStatus status=SecItemDelete((__bridge CFDictionaryRef)query); [self walletStorageReply:job ok:(status==errSecSuccess||status==errSecItemNotFound) value:nil error:status==errSecSuccess||status==errSecItemNotFound?nil:@"Wallet secure storage could not remove the session."]; return; }
    NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding]; OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)@{ (__bridge id)kSecValueData:data });
    if(status==errSecItemNotFound){ NSMutableDictionary *insert=[query mutableCopy]; insert[(__bridge id)kSecValueData]=data; insert[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly; status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL); }
    [self walletStorageReply:job ok:status==errSecSuccess value:nil error:status==errSecSuccess?nil:@"Wallet secure storage could not protect the session."];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if(!YNXTrustedMessage(message,_webView,_port) || ![@[@"wallet",@"command"] containsObject:message.name])return;
    id rawBody=message.body; NSDictionary *body=[rawBody isKindOfClass:NSDictionary.class]?rawBody:nil;
    NSString *action=[body[@"action"] isKindOfClass:NSString.class]?body[@"action"]:nil, *job=[body[@"id"] isKindOfClass:NSString.class]?body[@"id"]:nil;
    if (!action.length || action.length>32 || !job.length || job.length>80) return;
    if ([message.name isEqualToString:@"wallet"]) {
        if([@[@"storage-get",@"storage-set",@"storage-remove"] containsObject:action]) { if(YNXWalletStorageBody(body,action))[self handleWalletStorage:body action:action job:job]; return; }
        if([action isEqualToString:@"wallet-availability"]) { NSDictionary *availability=YNXWalletAvailability(); NSString *event=YNXJSON(@{ @"id":job,@"ok":@YES,@"installed":availability[@"installed"],@"schemeRegistered":availability[@"schemeRegistered"] }); YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.__ynxWalletAvailabilityResult(%@)",event?:@"{}"]); return; }
        if(![action isEqualToString:@"open-authorization"]) return;
        NSString *value=[body[@"url"] isKindOfClass:NSString.class]?body[@"url"]:nil; NSURLComponents *parts=value.length?[NSURLComponents componentsWithString:value]:nil; NSArray<NSURLQueryItem *> *items=parts.queryItems;
        BOOL reviewedHost=[parts.host isEqualToString:@"authorize"]||[parts.host isEqualToString:@"developer-deploy"];
        NSString *request=items.count==1&&[items.firstObject.name isEqualToString:@"request"]?items.firstObject.value:nil;
        NSRegularExpression *base64url=[NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{80,8192}$" options:0 error:nil];
        BOOL populatedRequest=request && [base64url firstMatchInString:request options:0 range:NSMakeRange(0,request.length)]!=nil;
        BOOL exact=parts && [parts.scheme isEqualToString:@"ynxwallet"] && reviewedHost && parts.path.length==0 && !parts.fragment.length && populatedRequest;
        NSURL *resolved=exact?[NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:parts.URL]:nil;
        BOOL opened=resolved!=nil && [NSWorkspace.sharedWorkspace openURL:parts.URL]; NSString *event=YNXJSON(@{@"id":job,@"ok":@(opened),@"message":opened?@"YNX Wallet review opened.":@"YNX Wallet is not installed or rejected the exact authorization route."});
        YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.__ynxWalletOpenResult(%@)",event?:@"{}"]); return;
    }
    if ([action isEqualToString:@"cancel"]) { [_lock lock]; NSTask *task=_processes[job]; [_lock unlock]; [task terminate]; return; }
    NSDictionary *payload=YNXCommandPayload(body[@"payload"]);
    if (![action isEqualToString:@"run"] || !payload) return;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{ [self run:job payload:payload]; });
}
- (BOOL)validPath:(NSString *)path { return YNXCommandPath(path);
}
- (void)emit:(NSDictionary *)event { NSString *json=YNXJSON(event); if (!json) return; dispatch_async(dispatch_get_main_queue(), ^{ YNXEvaluateTrustedScript(self.webView,self.port,[NSString stringWithFormat:@"window.__ynxDesktopEvent(%@)",json]); }); }
- (void)run:(NSString *)job payload:(NSDictionary *)payload {
    @try {
        NSString *task=payload[@"task"], *projectID=payload[@"projectId"]; NSDictionary *files=[payload[@"files"] isKindOfClass:NSDictionary.class]?payload[@"files"]:nil;
        NSCharacterSet *unsafe=[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"] invertedSet];
        if (![@[@"test",@"check"] containsObject:task] || !projectID.length || [projectID rangeOfCharacterFromSet:unsafe].location!=NSNotFound || files.count<1 || files.count>500) @throw [NSException exceptionWithName:@"InvalidRequest" reason:@"Invalid bounded command request" userInfo:nil];
        NSFileManager *fm=NSFileManager.defaultManager; NSURL *support=[fm URLForDirectory:NSApplicationSupportDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil]; NSURL *project=[[support URLByAppendingPathComponent:@"YNXDeveloper/Workspaces" isDirectory:YES] URLByAppendingPathComponent:projectID isDirectory:YES];
        [fm removeItemAtURL:project error:nil]; [fm createDirectoryAtURL:project withIntermediateDirectories:YES attributes:nil error:nil];
        __block NSUInteger total=0; NSMutableArray<NSString *> *targets=[NSMutableArray array];
        [files enumerateKeysAndObjectsUsingBlock:^(NSString *path, NSString *content, BOOL *stop) {
            NSData *data=[content isKindOfClass:NSString.class]?[content dataUsingEncoding:NSUTF8StringEncoding]:nil; if (![self validPath:path] || !data || data.length>524288) @throw [NSException exceptionWithName:@"InvalidProject" reason:@"Invalid project file" userInfo:nil]; total+=data.length; if(total>5242880) @throw [NSException exceptionWithName:@"InvalidProject" reason:@"Project exceeds five MiB" userInfo:nil];
            NSURL *target=[project URLByAppendingPathComponent:path]; [fm createDirectoryAtURL:target.URLByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil]; [data writeToURL:target options:NSDataWritingAtomic error:nil];
            BOOL selected=[task isEqualToString:@"test"]?([path hasPrefix:@"test/"]&&[path hasSuffix:@".test.js"]):[path hasSuffix:@".js"]; if(selected)[targets addObject:target.path];
        }];
        if(!targets.count) @throw [NSException exceptionWithName:@"NoTargets" reason:@"No allowlisted task targets" userInfo:nil];
        NSString *escaped=[project.path stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"]; escaped=[escaped stringByReplacingOccurrencesOfString:@"\"" withString:@"\\\""];
        NSString *profile=[NSString stringWithFormat:@"(version 1)\n(allow default)\n(deny network*)\n(deny file-write* (require-not (subpath \"%@\")) (require-not (subpath \"/private/tmp\")) (require-not (subpath \"/dev\")))",escaped];
        NSTask *process=[NSTask new]; process.executableURL=[NSURL fileURLWithPath:@"/usr/bin/sandbox-exec"]; NSMutableArray *arguments=[NSMutableArray arrayWithObjects:@"-p",profile,self.nodeURL.path,nil]; if([task isEqualToString:@"test"])[arguments addObject:@"--test"]; else [arguments addObject:@"--check"]; [arguments addObjectsFromArray:targets]; process.arguments=arguments; process.currentDirectoryURL=project;
        NSPipe *pipe=[NSPipe pipe]; process.standardOutput=pipe; process.standardError=pipe; pipe.fileHandleForReading.readabilityHandler=^(NSFileHandle *handle){ NSData *data=handle.availableData; if(data.length){NSString *text=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]; if(text)[self emit:@{@"id":job,@"type":@"chunk",@"text":text}];}};
        process.terminationHandler=^(NSTask *finished){ pipe.fileHandleForReading.readabilityHandler=nil; [self.lock lock]; [self.processes removeObjectForKey:job]; [self.lock unlock]; [self emit:@{@"id":job,@"type":@"done",@"code":@(finished.terminationStatus)}]; };
        [_lock lock]; _processes[job]=process; [_lock unlock]; NSError *error=nil; if(![process launchAndReturnError:&error]) @throw [NSException exceptionWithName:@"LaunchFailed" reason:error.localizedDescription userInfo:nil];
    } @catch(NSException *exception) { [self emit:@{@"id":job,@"type":@"error",@"message":exception.reason?:@"Desktop command failed"}]; }
}
@end

static NSString *YNXPackagedSource(void) {
    NSURL *url=[NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"build-provenance.json"];
    NSData *data=[NSData dataWithContentsOfURL:url];
    NSDictionary *value=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
    NSString *source=[value isKindOfClass:NSDictionary.class]?value[@"sourceCommit"]:nil;
    if(![source isKindOfClass:NSString.class] || source.length!=40 ||
       [source rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet]].location!=NSNotFound)
        return @"unverified";
    return source;
}
static NSString *YNXDesktopTitle(NSString *label) {
    if(NSProcessInfo.processInfo.environment[@"YNX_CODE_DESKTOP_SUPPORT_DIR"].length)
        return [NSString stringWithFormat:@"YNX Developer — QA — %@ — %@",label,YNXPackagedSource()];
    return [NSString stringWithFormat:@"YNX Developer — %@",label];
}

// A separate ordinary browser surface: no native message handlers, injected
// scripts, Keychain bridge, file command dispatcher or local runtime authority.
@interface YNXHostedWorkspace : NSObject <WKNavigationDelegate, WKUIDelegate>
@property(nonatomic,strong) NSWindow *window;
@property(nonatomic,strong) WKWebView *webView;
@property(nonatomic,strong) NSTextField *address;
- (void)open;
@end
@implementation YNXHostedWorkspace
- (void)open {
    if(!_window){
        _window=[[NSWindow alloc]initWithContentRect:NSMakeRect(100,100,1440,900) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
        _window.releasedWhenClosed=NO;_window.title=YNXDesktopTitle(@"Wallet projects");_window.minSize=NSMakeSize(640,480);
        WKWebViewConfiguration *configuration=[WKWebViewConfiguration new];
        configuration.userContentController=[WKUserContentController new];
        configuration.websiteDataStore=WKWebsiteDataStore.defaultDataStore;
        configuration.preferences.javaScriptCanOpenWindowsAutomatically=NO;
        _webView=[[WKWebView alloc]initWithFrame:NSZeroRect configuration:configuration];_webView.navigationDelegate=self;_webView.UIDelegate=self;
        NSStackView *bar=[NSStackView stackViewWithViews:@[
            [NSButton buttonWithTitle:@"Back" target:self action:@selector(back:)],
            [NSButton buttonWithTitle:@"Forward" target:self action:@selector(forward:)],
            [NSButton buttonWithTitle:@"Wallet projects" target:self action:@selector(projects:)],
            [NSButton buttonWithTitle:@"Reload" target:self action:@selector(reload:)]]];
        bar.spacing=10;_address=[NSTextField labelWithString:@"https://developer.ynxweb4.com"];_address.font=[NSFont systemFontOfSize:13];_address.lineBreakMode=NSLineBreakByTruncatingMiddle;[bar addArrangedSubview:_address];
        NSView *content=_window.contentView;bar.translatesAutoresizingMaskIntoConstraints=NO;_webView.translatesAutoresizingMaskIntoConstraints=NO;[content addSubview:bar];[content addSubview:_webView];
        [NSLayoutConstraint activateConstraints:@[[bar.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:12],[bar.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-12],[bar.topAnchor constraintEqualToAnchor:content.topAnchor constant:8],[bar.heightAnchor constraintEqualToConstant:30],[_webView.topAnchor constraintEqualToAnchor:bar.bottomAnchor constant:8],[_webView.leadingAnchor constraintEqualToAnchor:content.leadingAnchor],[_webView.trailingAnchor constraintEqualToAnchor:content.trailingAnchor],[_webView.bottomAnchor constraintEqualToAnchor:content.bottomAnchor]]];
        [self projects:nil];
    }
    [_window makeKeyAndOrderFront:nil];
}
- (void)projects:(id)sender { [_webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"https://developer.ynxweb4.com/projects"]]]; }
- (void)back:(id)sender { if(_webView.canGoBack)[_webView goBack]; }
- (void)forward:(id)sender { if(_webView.canGoForward)[_webView goForward]; }
- (void)reload:(id)sender { [_webView reload]; }
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))reply {
    if(action.targetFrame && !action.targetFrame.mainFrame){reply(WKNavigationActionPolicyAllow);return;}
    if(action.sourceFrame.mainFrame && YNXHostedWalletPair(action.request.URL,action.sourceFrame.request.URL,action.navigationType==WKNavigationTypeLinkActivated)){reply(WKNavigationActionPolicyCancel);if(![NSWorkspace.sharedWorkspace openURL:action.request.URL])_address.stringValue=@"YNX Wallet could not open. Use the pairing QR on the Wallet sign-in page.";return;}
    reply(YNXHostedDocument(action.request.URL)?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation { _address.stringValue=[NSString stringWithFormat:@"https://%@",view.URL.host?:@""];_window.title=YNXDesktopTitle(view.URL.host?:@"Wallet projects"); }
- (void)webView:(WKWebView *)view didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { _address.stringValue=@"Connection unavailable. Saved projects are retained; return to Wallet projects to retry."; }
- (WKWebView *)webView:(WKWebView *)view createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
    if(!action.targetFrame && action.sourceFrame.mainFrame && YNXHostedWalletPair(action.request.URL,action.sourceFrame.request.URL,action.navigationType==WKNavigationTypeLinkActivated)){if(![NSWorkspace.sharedWorkspace openURL:action.request.URL])_address.stringValue=@"YNX Wallet could not open. Use the pairing QR on the Wallet sign-in page.";return nil;}
    if(!action.targetFrame && action.navigationType==WKNavigationTypeLinkActivated && YNXHostedDocument(action.request.URL))[view loadRequest:action.request];
    return nil;
}
- (void)webView:(WKWebView *)view runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))reply {
    NSAlert *alert=[NSAlert new];alert.messageText=view.URL.host?:@"Hosted workspace";alert.informativeText=message;[alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){reply();}];
}
- (void)webView:(WKWebView *)view runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))reply {
    NSAlert *alert=[NSAlert new];alert.messageText=view.URL.host?:@"Hosted workspace";alert.informativeText=message;[alert addButtonWithTitle:@"Continue"];[alert addButtonWithTitle:@"Cancel"];[alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){reply(result==NSAlertFirstButtonReturn);}];
}
- (void)webView:(WKWebView *)view runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))reply {
    if(!frame.mainFrame || !YNXHostedDocument(view.URL)){reply(nil);return;}
    NSString *reviewedDocument=view.URL.absoluteString;
    NSOpenPanel *panel=[NSOpenPanel openPanel];panel.canChooseFiles=YES;panel.canChooseDirectories=parameters.allowsDirectories;panel.allowsMultipleSelection=parameters.allowsMultipleSelection;
    [panel beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){reply(result==NSModalResponseOK && [view.URL.absoluteString isEqualToString:reviewedDocument]?panel.URLs:nil);}];
}
@end

@interface YNXAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler>
@property(nonatomic,strong) NSWindow *window; @property(nonatomic,strong) WKWebView *webView; @property(nonatomic,strong) YNXCommandBridge *bridge; @property(nonatomic,strong) NSTask *server; @property(nonatomic,strong) NSFileHandle *serverLog; @property(nonatomic) NSInteger port;
@property(nonatomic,strong) YNXWorkspaceBridge *workspaceBridge;
@property(nonatomic,strong) YNXHostedWorkspace *hostedWorkspace;
@property(nonatomic) BOOL nativeEditPending;
@property(nonatomic) NSUInteger workspaceRestoreAttempt;
@property(nonatomic,strong) NSAlert *workspaceRestoreAlert;
@property(nonatomic) BOOL localWorkbenchMode;
@property(nonatomic,copy) NSString *localCloseRequest;
@property(nonatomic,strong) NSMutableDictionary<NSString *,NSString *> *pendingLocalCommands;
@property(nonatomic) BOOL localCommandDocumentReady;
@property(nonatomic,copy) NSString *localLocale;
@property(nonatomic,strong) NSURL *serverLogURL;
@property(nonatomic,copy) NSString *localSupportRoot;
@property(nonatomic,copy) NSString *localWorkspace;
@property(nonatomic,strong) NSOpenPanel *localFolderPanel;
@property(nonatomic) BOOL recordSelectedWorkspace;
@property(nonatomic) BOOL recentWorkspaceRecorded;
@property(nonatomic) BOOL localEditorDocumentLoaded;
@property(nonatomic) BOOL localStartupFailed;
@property(nonatomic) NSUInteger localReadyGeneration;
@property(nonatomic) NSTimeInterval localReadyStarted;
@property(nonatomic) BOOL localReadyComplete;
@property(nonatomic,strong) NSURLSessionDataTask *localReadyTask;
@property(nonatomic,copy) NSString *localReadyDiagnostic;
@property(nonatomic,strong) YNXWalletDeviceBridge *localWalletBridge;
@property(nonatomic,strong) NSAlert *localWalletConsent;
@property(nonatomic) NSUInteger localWalletGeneration;
@property(nonatomic,strong) NSMutableArray<NSURL *> *pendingNativeWalletURLs;
@end

@implementation YNXAppDelegate
- (NSURL *)resources { return NSBundle.mainBundle.resourceURL; }
- (NSURL *)nodeURL { return [[self resources] URLByAppendingPathComponent:@"runtime/node"]; }
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSString *mode=NSProcessInfo.processInfo.environment[@"YNX_DEVELOPER_DESKTOP_MODE"]?:NSBundle.mainBundle.infoDictionary[@"YNXDesktopMode"];
    _localWorkbenchMode=[mode isEqualToString:@"local-workbench"];
    if(_localWorkbenchMode){[self beginLocalWorkbench];return;}
    _port=YNXAvailablePort(); _workspaceBridge=[YNXWorkspaceBridge new]; _workspaceBridge.port=_port;
    [self installMenus]; WKWebViewConfiguration *configuration=[WKWebViewConfiguration new]; WKUserContentController *controller=[WKUserContentController new];
    NSString *script=@"(()=>{const jobs=new Map(),walletJobs=new Map(),storageJobs=new Map();window.__ynxDesktopEvent=e=>{const j=jobs.get(e.id);if(!j)return;if(e.type==='chunk')j.onChunk(e.text);if(e.type==='done'){jobs.delete(e.id);j.resolve({code:e.code});}if(e.type==='error'){jobs.delete(e.id);j.reject(new Error(e.message));}};window.__ynxWalletOpenResult=e=>{const j=walletJobs.get(e.id);if(!j)return;walletJobs.delete(e.id);e.ok?j.resolve():j.reject(new Error(e.message));};window.__ynxWalletStorageResult=e=>{const j=storageJobs.get(e.id);if(!j)return;storageJobs.delete(e.id);e.ok?j.resolve(Object.hasOwn(e,'value')?e.value:null):j.reject(new Error(e.error||'Wallet secure storage failed.'));};const storage=(action,key,value)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();storageJobs.set(id,{resolve,reject});window.webkit.messageHandlers.wallet.postMessage({action,id,key,...(value===undefined?{}:{value})});});globalThis.ynxDesktop={executeApprovedCommand(payload,options={}){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();jobs.set(id,{resolve,reject,onChunk:options.onChunk||(()=>{})});options.signal?.addEventListener('abort',()=>window.webkit.messageHandlers.command.postMessage({action:'cancel',id}),{once:true});window.webkit.messageHandlers.command.postMessage({action:'run',id,payload});});}};globalThis.ynxDesktopWallet={openAuthorization(url){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();walletJobs.set(id,{resolve,reject});window.webkit.messageHandlers.wallet.postMessage({action:'open-authorization',id,url});});},protectedStorage:{securityLevel:'os-protected',get:key=>storage('storage-get',key),set:(key,value)=>storage('storage-set',key,value),remove:key=>storage('storage-remove',key)}}})();";
    NSString *availabilityScript=@"(()=>{const jobs=new Map();window.__ynxWalletAvailabilityResult=e=>{const j=jobs.get(e.id);if(!j)return;jobs.delete(e.id);e.ok?j.resolve({walletInstalled:e.installed===true,schemeRegistered:e.schemeRegistered===true}):j.reject(new Error('Wallet availability check failed.'));};globalThis.ynxDesktopWallet.walletAvailability=()=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();jobs.set(id,{resolve,reject});window.webkit.messageHandlers.wallet.postMessage({action:'wallet-availability',id});});})();";
    [controller addUserScript:[[WKUserScript alloc]initWithSource:YNXOriginBoundScript(script,_port) injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    [controller addUserScript:[[WKUserScript alloc]initWithSource:YNXOriginBoundScript(availabilityScript,_port) injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    configuration.userContentController=controller; _webView=[[WKWebView alloc]initWithFrame:NSZeroRect configuration:configuration]; _bridge=[[YNXCommandBridge alloc]initWithWebView:_webView nodeURL:self.nodeURL]; _bridge.port=_port; [controller addScriptMessageHandler:_bridge name:@"command"]; [controller addScriptMessageHandler:_bridge name:@"wallet"];
    _window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1440,900) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO]; _window.title=YNXDesktopTitle(@"Testnet Preview (unsigned)"); _window.contentView=_webView; if(![_window setFrameUsingName:@"YNXDeveloperTestnetPreviewMainWindow"])[_window center]; [_window setFrameAutosaveName:@"YNXDeveloperTestnetPreviewMainWindow"]; _window.restorable=YES; [_window makeKeyAndOrderFront:nil];
    _webView.UIDelegate=self; _webView.navigationDelegate=self; _workspaceBridge.webView=_webView; _workspaceBridge.window=_window; [controller addScriptMessageHandler:_workspaceBridge name:@"workspace"];
    [self beginWorkspaceRestore];
}
- (void)beginLocalWorkbench {
    _localLocale=YNXLocalStoredLocale([NSUserDefaults.standardUserDefaults objectForKey:@"YNXDeveloperDisplayLocale"]);
    NSDictionary *environment=NSProcessInfo.processInfo.environment;
    _localSupportRoot=environment[@"YNX_CODE_DESKTOP_SUPPORT_DIR"]?:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/YNXDeveloper"];
    NSString *explicit=environment[@"YNX_LOCAL_WORKSPACE"];
    _localWorkspace=YNXSelectedLocalWorkspace(explicit,_localSupportRoot);
    _recordSelectedWorkspace=explicit&&[environment[@"YNX_LOCAL_WORKSPACE_SELECTION"] isEqual:@"native-panel"];
    _port=YNXAvailablePort();
    [self installLocalMenus];
    // The local editor receives only the finite native V2 device capability,
    // never the legacy command/Wallet transaction or JSON-workspace handler.
    WKWebViewConfiguration *configuration=[WKWebViewConfiguration new];
    [configuration.userContentController addScriptMessageHandler:self name:@"ynxLocalWorkbench"];
    _localWalletBridge=[[YNXWalletDeviceBridge alloc]initWithTag:@"com.ynxweb4.developer.native-device-p256-v2" storageService:YNXWalletStorageService lockDirectory:_localSupportRoot];
    [configuration.userContentController addScriptMessageHandler:self name:@"ynxLocalWallet"];
    NSString *walletScript=@"(()=>{if(location.pathname!=='/')return;const jobs=new Map();const call=(action,args={})=>new Promise((resolve,reject)=>{if(jobs.size>=32){reject(new Error('Too many native Wallet requests'));return;}const id=crypto.randomUUID();const timer=setTimeout(()=>{jobs.delete(id);reject(new Error('Native Wallet request timed out'));},60000);jobs.set(id,{resolve,reject,timer});window.webkit.messageHandlers.ynxLocalWallet.postMessage({action,id,...args});});Object.defineProperty(window,'__ynxNativeWalletReply',{value:e=>{const job=jobs.get(e.id);if(!job)return;jobs.delete(e.id);clearTimeout(job.timer);e.ok?job.resolve(e.value):job.reject(new Error(e.error||'Native Wallet operation failed'));}});const device=value=>Object.freeze({...value,scopes:Object.freeze(['account:read','developer:deploy']),purpose:'Connect YNX Developer to the approved testnet Developer account',sign:input=>call('device-sign',{input})});Object.defineProperty(window,'ynxDesktopWallet',{value:Object.freeze({beginConnection:async()=>device(await call('begin-connection')),endConnection:()=>call('end-connection'),device:async()=>device(await call('device-info')),openAuthorization:url=>call('open-authorization',{url}),walletAvailability:()=>call('availability'),protectedStorage:Object.freeze({securityLevel:'os-protected',get:key=>call('storage-get',{key}),set:(key,value)=>call('storage-set',{key,value}),remove:key=>call('storage-remove',{key})})})});addEventListener('pagehide',()=>{for(const j of jobs.values()){clearTimeout(j.timer);j.reject(new Error('Native Wallet document closed'));}jobs.clear();},{once:true});})();";
    [configuration.userContentController addUserScript:[[WKUserScript alloc]initWithSource:YNXOriginBoundScript(walletScript,_port) injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    [NSDistributedNotificationCenter.defaultCenter addObserver:self selector:@selector(localWalletReturnReady:) name:[@"com.ynxweb4.developer.wallet-return." stringByAppendingString:_localWalletBridge.instanceID] object:nil];
    NSArray<NSURL *> *pendingWalletURLs=[_pendingNativeWalletURLs copy];_pendingNativeWalletURLs=nil;
    for(NSURL *callback in pendingWalletURLs){NSString *owner=[_localWalletBridge routeCallback:callback.absoluteString];if(owner)[NSDistributedNotificationCenter.defaultCenter postNotificationName:[@"com.ynxweb4.developer.wallet-return." stringByAppendingString:owner] object:nil userInfo:nil deliverImmediately:YES];}
    [configuration.userContentController addUserScript:[[WKUserScript alloc]initWithSource:YNXOriginBoundScript(YNXLocalLocaleSeedScript(_localLocale),_port) injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    [configuration.userContentController addUserScript:[[WKUserScript alloc]initWithSource:YNXOriginBoundScript(YNXLocalAppearanceScript(),_port) injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    _webView=[[WKWebView alloc]initWithFrame:NSMakeRect(0,0,1440,900) configuration:configuration];
    _webView.underPageBackgroundColor=YNXLocalBackgroundColor(@"#111214");
    _webView.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    _webView.UIDelegate=self;_webView.navigationDelegate=self;
    _window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1440,900) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    _window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    _window.backgroundColor=YNXLocalBackgroundColor(@"#111214");
    NSString *project=_localWorkspace;
    NSString *folderName=project.length?project.lastPathComponent:@"Workspace";
    _window.title=[NSString stringWithFormat:@"YNX Developer — %@",folderName];_window.contentView=_webView;_window.delegate=self;
    if(![_window setFrameUsingName:@"YNXDeveloperLocalWorkbenchMainWindow"])[_window center];
    [_window setFrameAutosaveName:@"YNXDeveloperLocalWorkbenchMainWindow"];[_webView layoutSubtreeIfNeeded];[_window makeKeyAndOrderFront:nil];[_window makeFirstResponder:_webView];
    // The pre-run activation request has no window yet. Activate once after
    // launch has built the visible editor; WebKit can pause drawing frames in
    // an inactive or occluded application.
    dispatch_async(dispatch_get_main_queue(),^{
        // A user-opened window also needs activation when its executable was
        // launched directly without another application's cooperative yield.
        [NSApp activateIgnoringOtherApps:YES];
        [self.window makeKeyAndOrderFront:nil];[self.webView layoutSubtreeIfNeeded];[self.window displayIfNeeded];
    });
    [_webView loadHTMLString:YNXLocalStatusPage(@"Opening YNX Developer…",@"Your local workspace is being opened.") baseURL:nil];
    if(explicit&&!YNXCanonicalLocalDirectory(explicit)){[self showFailure:@"The selected local folder is unavailable. Existing projects and recent-folder records were preserved."];return;}
    if([self launchServer])[self loadWhenReady:0];else[self showFailure:[NSString stringWithFormat:@"The bundled local workbench could not start. Log: %@",_serverLogURL.path?:@"unavailable"]];
}
- (void)applicationDidBecomeActive:(NSNotification *)note {
    if(!_localWorkbenchMode||!_window)return;
    [_webView layoutSubtreeIfNeeded];[_window displayIfNeeded];
}
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
    if(_localWorkbenchMode&&view==_webView)_localCommandDocumentReady=YNXLocalEditorDocumentURL(view.URL,_port);
    if(_localWorkbenchMode&&view==_webView&&YNXLocalEditorDocumentURL(view.URL,_port))_localEditorDocumentLoaded=YES;
    if(!_localWorkbenchMode||!_recordSelectedWorkspace||_recentWorkspaceRecorded||view!=_webView||!_server.running||![view.URL.absoluteString hasPrefix:[YNXOrigin(_port) stringByAppendingString:@"/"]]||!YNXCanonicalLocalDirectory(_localWorkspace)||!YNXPrivateLocalDirectory(_localSupportRoot))return;
    int fd=open(_serverLogURL.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return;
    struct stat status;BOOL valid=fstat(fd,&status)==0&&S_ISREG(status.st_mode)&&status.st_uid==getuid()&&status.st_nlink==1&&(status.st_mode&0077)==0;
    NSMutableData *bytes=[NSMutableData dataWithLength:1024*1024];ssize_t count=valid?pread(fd,bytes.mutableBytes,bytes.length,0):-1;close(fd);if(count<=0)return;bytes.length=(NSUInteger)count;
    NSString *output=[[NSString alloc]initWithData:bytes encoding:NSUTF8StringEncoding];
    for(NSString *line in [output componentsSeparatedByString:@"\n"]){
        NSString *prefix=@"YNX_LOCAL_WORKBENCH ";if(![line hasPrefix:prefix]||line.length>16384)continue;
        id receipt=[NSJSONSerialization JSONObjectWithData:[[line substringFromIndex:prefix.length] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        if(!YNXMatchingLocalReadyReceipt(receipt,_localSupportRoot,_localWorkspace,YNXOrigin(_port)))continue;
        _recentWorkspaceRecorded=YNXRecordRecentLocalWorkspace(_localSupportRoot,_localWorkspace);break;
    }
}
- (void)webView:(WKWebView *)view didStartProvisionalNavigation:(WKNavigation *)navigation {
    if(_localWorkbenchMode&&view==_webView){_localCommandDocumentReady=NO;[_pendingLocalCommands removeAllObjects];_localWalletGeneration++;[_localWalletBridge endUserOperation];if(_localWalletConsent){[_window endSheet:_localWalletConsent.window returnCode:NSModalResponseCancel];_localWalletConsent=nil;}}
}
- (void)webView:(WKWebView *)view didCommitNavigation:(WKNavigation *)navigation {
    // Preserve a workbench document as soon as loading commits: restored draft
    // content can appear before its navigation finishes.
    if(_localWorkbenchMode&&view==_webView&&YNXLocalEditorDocumentURL(view.URL,_port))_localEditorDocumentLoaded=YES;
}
- (void)installLocalMenus {
    NSMenu *main=[NSMenu new];NSApp.mainMenu=main;
    NSMenuItem *appItem=[NSMenuItem new];[main addItem:appItem];NSMenu *app=[NSMenu new];appItem.submenu=app;
    [app addItemWithTitle:YNXLocalMenuLabel(@"About YNX Developer",_localLocale) action:@selector(showAbout:) keyEquivalent:@""];
    [app addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:app title:@"Settings…" command:@"preferences:open" key:@"," modifiers:NSEventModifierFlagCommand];
    [app addItem:[NSMenuItem separatorItem]];[app addItemWithTitle:YNXLocalMenuLabel(@"Quit YNX Developer",_localLocale) action:@selector(terminate:) keyEquivalent:@"q"];
    NSMenu *file=[self localMenu:main title:@"File"];
    [self localCommandItem:file title:@"New Text File" command:@"workbench.action.files.newUntitledFile" key:@"n" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:file title:@"Open File…" command:@"workspace:openFile" key:@"o" modifiers:NSEventModifierFlagCommand];
    NSMenuItem *open=[file addItemWithTitle:YNXLocalMenuLabel(@"Open Folder…",_localLocale) action:@selector(openLocalFolder:) keyEquivalent:@"o"];open.target=self;open.keyEquivalentModifierMask=NSEventModifierFlagCommand|NSEventModifierFlagShift;
    [file addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:file title:@"Save" command:@"core.save" key:@"s" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:file title:@"Save As…" command:@"file.saveAs" key:@"s" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [self localCommandItem:file title:@"Save All" command:@"core.saveAll" key:@"s" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagOption];
    [file addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:file title:@"Close Editor" command:@"core.close.tab" key:@"w" modifiers:NSEventModifierFlagCommand];
    NSMenu *edit=[self localMenu:main title:@"Edit"];
    [self localCommandItem:edit title:@"Undo" command:@"core.undo" key:@"z" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:edit title:@"Redo" command:@"core.redo" key:@"z" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [edit addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:edit title:@"Cut" command:@"core.cut" key:@"x" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:edit title:@"Copy" command:@"core.copy" key:@"c" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:edit title:@"Paste" command:@"core.paste" key:@"v" modifiers:NSEventModifierFlagCommand];
    [edit addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:edit title:@"Find" command:@"core.find" key:@"f" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:edit title:@"Replace" command:@"core.replace" key:@"f" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagOption];
    [edit addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:edit title:@"Toggle Line Comment" command:@"editor.action.commentLine" key:@"/" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:edit title:@"Format Document" command:@"editor.action.formatDocument" key:@"f" modifiers:NSEventModifierFlagOption|NSEventModifierFlagShift];
    NSMenu *selection=[self localMenu:main title:@"Selection"];
    [self localCommandItem:selection title:@"Select All" command:@"core.selectAll" key:@"a" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:selection title:@"Expand Selection" command:@"editor.action.smartSelect.expand" key:@"" modifiers:0];
    [self localCommandItem:selection title:@"Shrink Selection" command:@"editor.action.smartSelect.shrink" key:@"" modifiers:0];
    [selection addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:selection title:@"Select All Occurrences" command:@"editor.action.selectHighlights" key:@"" modifiers:0];
    [self localCommandItem:selection title:@"Add Cursor Above" command:@"editor.action.insertCursorAbove" key:@"" modifiers:0];
    [self localCommandItem:selection title:@"Add Cursor Below" command:@"editor.action.insertCursorBelow" key:@"" modifiers:0];
    NSMenu *view=[self localMenu:main title:@"View"];
    [self localCommandItem:view title:@"Command Palette…" command:@"workbench.action.showCommands" key:@"p" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [view addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:view title:@"Explorer" command:@"fileNavigator:toggle" key:@"e" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [self localCommandItem:view title:@"Search" command:@"search-in-workspace.toggle" key:@"f" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [self localCommandItem:view title:@"Source Control" command:@"scmView:toggle" key:@"g" modifiers:NSEventModifierFlagControl|NSEventModifierFlagShift];
    [self localCommandItem:view title:@"Run and Debug" command:@"debug:toggle" key:@"d" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [self localCommandItem:view title:@"Extensions" command:@"vsxExtensions.toggle" key:@"x" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [view addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:view title:@"Problems" command:@"problemsView:toggle" key:@"m" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [self localCommandItem:view title:@"Output" command:@"output:toggle" key:@"u" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [self localCommandItem:view title:@"Terminal" command:@"workbench.action.terminal.toggleTerminal" key:@"`" modifiers:NSEventModifierFlagControl];
    [self localCommandItem:view title:@"Outline" command:@"outlineView:toggle" key:@"" modifiers:0];
    [view addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:view title:@"Toggle Primary Side Bar" command:@"core.toggle.left.panel" key:@"b" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:view title:@"Toggle Panel" command:@"core.toggle.bottom.panel" key:@"j" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:view title:@"Color Theme…" command:@"workbench.action.selectTheme" key:@"" modifiers:0];
    NSMenu *go=[self localMenu:main title:@"Go"];
    [self localCommandItem:go title:@"Go to File…" command:@"file-search.openFile" key:@"p" modifiers:NSEventModifierFlagCommand];
    [self localCommandItem:go title:@"Go to Line/Column…" command:@"editor.action.gotoLine" key:@"g" modifiers:NSEventModifierFlagControl];
    [self localCommandItem:go title:@"Go to Definition" command:@"editor.action.revealDefinition" key:[NSString stringWithFormat:@"%C",(unichar)NSF12FunctionKey] modifiers:0];
    [self localCommandItem:go title:@"Go to References" command:@"editor.action.goToReferences" key:[NSString stringWithFormat:@"%C",(unichar)NSF12FunctionKey] modifiers:NSEventModifierFlagShift];
    [go addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:go title:@"Back" command:@"textEditor.commands.go.back" key:@"-" modifiers:NSEventModifierFlagControl];
    [self localCommandItem:go title:@"Forward" command:@"textEditor.commands.go.forward" key:@"-" modifiers:NSEventModifierFlagControl|NSEventModifierFlagShift];
    NSMenu *run=[self localMenu:main title:@"Run"];
    [self localCommandItem:run title:@"Start Debugging" command:@"workbench.action.debug.start" key:[NSString stringWithFormat:@"%C",(unichar)NSF5FunctionKey] modifiers:0];
    [self localCommandItem:run title:@"Run Without Debugging" command:@"workbench.action.debug.run" key:[NSString stringWithFormat:@"%C",(unichar)NSF5FunctionKey] modifiers:NSEventModifierFlagControl];
    [self localCommandItem:run title:@"Stop Debugging" command:@"workbench.action.debug.stop" key:[NSString stringWithFormat:@"%C",(unichar)NSF5FunctionKey] modifiers:NSEventModifierFlagShift];
    [self localCommandItem:run title:@"Restart Debugging" command:@"workbench.action.debug.restart" key:[NSString stringWithFormat:@"%C",(unichar)NSF5FunctionKey] modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [run addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:run title:@"Open Configurations…" command:@"debug.configurations.open" key:@"" modifiers:0];
    NSMenu *terminal=[self localMenu:main title:@"Terminal"];
    [self localCommandItem:terminal title:@"New Terminal" command:@"terminal:new" key:@"`" modifiers:NSEventModifierFlagControl|NSEventModifierFlagShift];
    [self localCommandItem:terminal title:@"Toggle Terminal" command:@"workbench.action.terminal.toggleTerminal" key:@"" modifiers:0];
    [self localCommandItem:terminal title:@"Split Terminal" command:@"terminal:split" key:@"" modifiers:0];
    [self localCommandItem:terminal title:@"Clear Terminal" command:@"terminal:clear" key:@"" modifiers:0];
    [terminal addItem:[NSMenuItem separatorItem]];
    [self localCommandItem:terminal title:@"Run Build Task…" command:@"task:run:build" key:@"b" modifiers:NSEventModifierFlagCommand|NSEventModifierFlagShift];
    [self localCommandItem:terminal title:@"Run Task…" command:@"workbench.action.tasks.runTask" key:@"" modifiers:0];
    NSMenu *windows=[self localMenu:main title:@"Window"];NSApp.windowsMenu=windows;
    [windows addItemWithTitle:YNXLocalMenuLabel(@"Minimize",_localLocale) action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [windows addItemWithTitle:YNXLocalMenuLabel(@"Bring All to Front",_localLocale) action:@selector(arrangeInFront:) keyEquivalent:@""];
    NSMenu *help=[self localMenu:main title:@"Help"];NSApp.helpMenu=help;
    [self localCommandItem:help title:@"Show All Commands…" command:@"workbench.action.showCommands" key:@"" modifiers:0];
    [help addItemWithTitle:YNXLocalMenuLabel(@"About YNX Developer",_localLocale) action:@selector(showAbout:) keyEquivalent:@""];
}
- (NSMenu *)localMenu:(NSMenu *)main title:(NSString *)title {
    title=YNXLocalMenuLabel(title,_localLocale);
    NSMenuItem *item=[[NSMenuItem alloc]initWithTitle:title action:nil keyEquivalent:@""];NSMenu *menu=[[NSMenu alloc]initWithTitle:title];item.submenu=menu;[main addItem:item];return menu;
}
- (NSMenuItem *)localCommandItem:(NSMenu *)menu title:(NSString *)title command:(NSString *)command key:(NSString *)key modifiers:(NSEventModifierFlags)modifiers {
    title=YNXLocalMenuLabel(title,_localLocale);
    NSMenuItem *item=[menu addItemWithTitle:title action:@selector(localWorkbenchCommand:) keyEquivalent:key];item.target=self;item.representedObject=command;item.keyEquivalentModifierMask=modifiers;return item;
}
- (void)localCommandUnavailable:(NSString *)message {
    if(!_window||_window.attachedSheet)return;NSAlert *alert=[NSAlert new];alert.messageText=YNXLocalMenuLabel(@"Action unavailable",_localLocale);alert.informativeText=YNXLocalMenuLabel(message.length?message:@"Wait for your workspace to finish opening, then try again.",_localLocale);[alert addButtonWithTitle:YNXLocalMenuLabel(@"OK",_localLocale)];
    [alert beginSheetModalForWindow:_window completionHandler:nil];
}
- (void)localWorkbenchCommand:(NSMenuItem *)sender {
    NSString *command=[sender.representedObject isKindOfClass:NSString.class]?sender.representedObject:nil;
    if(!_localWorkbenchMode||![YNXLocalWorkbenchCommands() containsObject:command])return;
    NSWindow *window=NSApp.keyWindow;NSResponder *responder=window.firstResponder;
    BOOL webResponder=window==_window&&[responder isKindOfClass:NSView.class]&&[(NSView *)responder isDescendantOf:_webView];
    SEL editSelector=YNXLocalNativeEditSelector(command);
    // Native sheets/text fields keep their genuine Cocoa responder behavior.
    // A workbench edit never falls back to WebKit's unrelated undo stack.
    if(!webResponder&&editSelector&&responder){[NSApp sendAction:editSelector to:responder from:sender];return;}
    if(window!=_window||!_localCommandDocumentReady||!_server.running||!YNXLocalEditorDocumentURL(_webView.URL,_port)||_localCloseRequest)return;
    if(!_pendingLocalCommands)_pendingLocalCommands=[NSMutableDictionary new];
    if(_pendingLocalCommands.count>=32){[self localCommandUnavailable:@"Finish the current actions before starting another one."];return;}
    NSString *request=NSUUID.UUID.UUIDString.lowercaseString;_pendingLocalCommands[request]=command;
    [_webView callAsyncJavaScript:@"if(location.origin!==origin||location.pathname!=='/'||typeof window.__ynxLocalWorkbenchCommand!=='function')return false;window.__ynxLocalWorkbenchCommand(commandId,requestId);return true;"
        arguments:@{@"origin":YNXOrigin(_port),@"commandId":command,@"requestId":request} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id invoked,NSError *error){
            if(!self.pendingLocalCommands[request])return;
            if(error||![invoked isEqual:@YES]){[self.pendingLocalCommands removeObjectForKey:request];[self localCommandUnavailable:nil];}
        }];
}
- (void)openLocalFolder:(id)sender {
    if(!_localWorkbenchMode||!_window||_window.attachedSheet||_localFolderPanel)return;
    NSOpenPanel *panel=[NSOpenPanel openPanel];panel.canChooseFiles=NO;panel.canChooseDirectories=YES;panel.allowsMultipleSelection=NO;panel.canCreateDirectories=YES;
    panel.title=YNXLocalMenuLabel(@"Open Folder…",_localLocale);panel.prompt=YNXLocalMenuLabel(@"Open",_localLocale);
    // Keep selection asynchronous without attaching a sheet: on the supported
    // macOS runtime the sheet's directory confirmation remains disabled.
    self.localFolderPanel=panel;
    [panel beginWithCompletionHandler:^(NSModalResponse result){
        self.localFolderPanel=nil;
        if(result!=NSModalResponseOK)return;
        NSString *selectedWorkspace=YNXCanonicalPickedLocalDirectory(panel.URL);
        if(!selectedWorkspace||!YNXPrivateLocalDirectory(self.localSupportRoot))return;
        NSWorkspaceOpenConfiguration *configuration=[NSWorkspaceOpenConfiguration configuration];configuration.activates=YES;configuration.createsNewApplicationInstance=YES;configuration.allowsRunningApplicationSubstitution=NO;
        configuration.environment=@{@"YNX_DEVELOPER_DESKTOP_MODE":@"local-workbench",@"YNX_LOCAL_WORKSPACE":selectedWorkspace,@"YNX_CODE_DESKTOP_SUPPORT_DIR":self.localSupportRoot,@"YNX_LOCAL_WORKSPACE_SELECTION":@"native-panel"};
        [NSWorkspace.sharedWorkspace openApplicationAtURL:NSBundle.mainBundle.bundleURL configuration:configuration completionHandler:^(NSRunningApplication *application,NSError *error){
            if(error)dispatch_async(dispatch_get_main_queue(),^{NSAlert *alert=[NSAlert new];alert.messageText=@"The folder could not be opened";alert.informativeText=error.localizedDescription?:@"Try opening the folder again.";[alert beginSheetModalForWindow:self.window completionHandler:nil];});
        }];
    }];
}
- (void)beginWorkspaceRestore {
    if(_workspaceBridge.restoring)return;
    NSUInteger attempt=++_workspaceRestoreAttempt;
    [_webView loadHTMLString:YNXLocalStatusPage(@"Opening your saved workspace…",@"If macOS asks for access to your workspace folder, allow access to continue. Your saved project is being preserved.") baseURL:nil];
    [_workspaceBridge restoreWithCompletion:^(NSError *error){
        if(attempt!=self.workspaceRestoreAttempt)return;
        if(self.workspaceRestoreAlert){[NSApp endSheet:self.workspaceRestoreAlert.window returnCode:NSModalResponseCancel];self.workspaceRestoreAlert=nil;}
        if(error){[self showWorkspaceRestoreIssue:NO];return;}
        [self finishWorkspaceRestore];
    }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,10*NSEC_PER_SEC),dispatch_get_main_queue(),^{
        if(attempt==self.workspaceRestoreAttempt && self.workspaceBridge.restoring)[self showWorkspaceRestoreIssue:YES];
    });
}
- (void)showWorkspaceRestoreIssue:(BOOL)pending {
    if(_workspaceRestoreAlert)return;
    NSAlert *alert=[NSAlert new]; _workspaceRestoreAlert=alert;
    alert.messageText=pending?@"Still opening your saved workspace":@"Your saved workspace could not be opened";
    alert.informativeText=pending?@"macOS may be waiting for folder access, or storage may be slow. You can keep waiting or quit. Your saved project has not been replaced.":@"Check access to your workspace folder and try again. Your saved project has not been replaced.";
    [alert addButtonWithTitle:pending?@"Keep Waiting":@"Try Again"]; [alert addButtonWithTitle:@"Quit"];
    [alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){
        if(self.workspaceRestoreAlert==alert)self.workspaceRestoreAlert=nil;
        if(result==NSAlertSecondButtonReturn)[NSApp terminate:nil];
        else if(result==NSAlertFirstButtonReturn && !pending)[self beginWorkspaceRestore];
    }];
}
- (void)finishWorkspaceRestore {
    if(!_workspaceBridge.restoreComplete)return;
    // Only a completed read (including a confirmed absent file) may initialize
    // Workbench. It never mounts and auto-saves a starter while recovery waits.
    NSString *workspaceScript=[NSString stringWithFormat:@"(()=>{if(location.origin!=='http://127.0.0.1:%ld')return;const jobs=new Map();window.__ynxWorkspaceResult=e=>{const job=jobs.get(e.id);if(!job)return;jobs.delete(e.id);e.error?job.reject(new Error(e.error)):job.resolve();};const request=(action,payload)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();jobs.set(id,{resolve,reject});window.webkit.messageHandlers.workspace.postMessage({id,action,...payload});});window.ynxDesktopWorkspace={initialProject:%@,saveProject:project=>request('save-project',{project}),exportProject:(filename,content)=>request('export-project',{filename,content})};})();",(long)_port,YNXJSON(_workspaceBridge.initialProject?:[NSNull null])];
    [_webView.configuration.userContentController addUserScript:[[WKUserScript alloc]initWithSource:YNXOriginBoundScript(workspaceScript,_port) injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    if([self launchServer]) [self loadWhenReady:0]; else [self showFailure:@"The bundled local runtime could not start."];
}
- (BOOL)launchServer {
    if(![NSFileManager.defaultManager isExecutableFileAtPath:self.nodeURL.path]) return NO;
    NSURL *library=[NSFileManager.defaultManager URLForDirectory:NSLibraryDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil];
    NSURL *directory=[library URLByAppendingPathComponent:@"Logs/YNXDeveloper" isDirectory:YES];
    if(_localWorkbenchMode){
        if(!directory||![NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:nil])return NO;
        NSString *name=[NSString stringWithFormat:@"desktop-local-%d-%@.log",NSProcessInfo.processInfo.processIdentifier,NSUUID.UUID.UUIDString.lowercaseString];
        _serverLogURL=[directory URLByAppendingPathComponent:name];
        int fd=open(_serverLogURL.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC|O_APPEND,0600);
        if(fd<0)return NO;
        struct stat status;
        if(fstat(fd,&status)!=0||!S_ISREG(status.st_mode)||status.st_uid!=getuid()||status.st_nlink!=1||fchmod(fd,0600)!=0){close(fd);return NO;}
        _serverLog=[[NSFileHandle alloc]initWithFileDescriptor:fd closeOnDealloc:YES];
        NSString *metadata=[NSString stringWithFormat:@"YNX Developer local desktop; packaged source %@; port %ld\n",YNXPackagedSource(),(long)_port];
        [_serverLog writeData:[metadata dataUsingEncoding:NSUTF8StringEncoding]];
    }else{
        _serverLogURL=[directory URLByAppendingPathComponent:@"desktop-server.log"];
        [NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:nil];
        [@"" writeToURL:_serverLogURL atomically:YES encoding:NSUTF8StringEncoding error:nil];_serverLog=[NSFileHandle fileHandleForWritingToURL:_serverLogURL error:nil];
    }
    _server=[NSTask new]; _server.executableURL=self.nodeURL; _server.arguments=@[[[self resources] URLByAppendingPathComponent:@"server.mjs"].path]; NSMutableDictionary *environment=[NSProcessInfo.processInfo.environment mutableCopy]; environment[@"PORT"]=[NSString stringWithFormat:@"%ld",(long)_port]; if(_localWorkbenchMode){environment[@"YNX_DEVELOPER_DESKTOP_MODE"]=@"local-workbench";environment[@"YNX_CODE_DESKTOP_SUPPORT_DIR"]=_localSupportRoot;if(_localWorkspace)environment[@"YNX_LOCAL_WORKSPACE"]=_localWorkspace;else[environment removeObjectForKey:@"YNX_LOCAL_WORKSPACE"];} _server.environment=environment; _server.standardOutput=_serverLog; _server.standardError=_serverLog; __weak typeof(self) weakSelf=self; _server.terminationHandler=^(NSTask *task){ if(task.terminationStatus!=0) dispatch_async(dispatch_get_main_queue(),^{if(task!=weakSelf.server||(weakSelf.localWorkbenchMode&&weakSelf.localStartupFailed&&!weakSelf.localEditorDocumentLoaded))return;if(weakSelf.localWorkbenchMode&&task.terminationStatus==73){[weakSelf showLocalProjectAlreadyOpen];return;}NSString *message=weakSelf.localWorkbenchMode?[NSString stringWithFormat:@"Local server exited with code %d. Log: %@",task.terminationStatus,weakSelf.serverLogURL.path?:@"unavailable"]:[NSString stringWithFormat:@"Local server exited with code %d. Log: ~/Library/Logs/YNXDeveloper/desktop-server.log",task.terminationStatus];[weakSelf showFailure:message];});}; NSError *error=nil; return [_server launchAndReturnError:&error];
}
- (void)cancelLocalReadiness {++_localReadyGeneration;[_localReadyTask cancel];_localReadyTask=nil;}
- (void)stopUnopenedLocalServer {
    // Startup has no admitted editor document yet. Stop only this window's
    // supervisor; its normal SIGTERM handler releases its own children/lock.
    // Once a document was loaded, standard editor close/veto remains required.
    if(_localWorkbenchMode&&!_localEditorDocumentLoaded&&_server.running)[_server terminate];
}
- (BOOL)localReadinessReceiptMatched {
    int fd=open(_serverLogURL.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return NO;
    struct stat status;BOOL valid=fstat(fd,&status)==0&&S_ISREG(status.st_mode)&&status.st_uid==getuid()&&status.st_nlink==1&&(status.st_mode&0077)==0;
    NSMutableData *bytes=[NSMutableData dataWithLength:1024*1024];ssize_t count=valid?pread(fd,bytes.mutableBytes,bytes.length,0):-1;close(fd);if(count<=0)return NO;bytes.length=(NSUInteger)count;
    NSString *output=[[NSString alloc]initWithData:bytes encoding:NSUTF8StringEncoding];
    for(NSString *line in [output componentsSeparatedByString:@"\n"]){
        NSString *prefix=@"YNX_LOCAL_WORKBENCH ";if(![line hasPrefix:prefix]||line.length>16384)continue;
        id receipt=[NSJSONSerialization JSONObjectWithData:[[line substringFromIndex:prefix.length] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        if(![receipt isKindOfClass:NSDictionary.class])continue;
        NSString *workspace=_localWorkspace?:receipt[@"workspace"];
        if(YNXCanonicalLocalDirectory(workspace)&&YNXMatchingLocalReadyReceipt(receipt,_localSupportRoot,workspace,YNXOrigin(_port)))return YES;
    }
    return NO;
}
- (void)pollLocalReadiness:(NSUInteger)generation attempt:(NSInteger)attempt {
    NSTask *child=_server;NSTimeInterval elapsed=NSProcessInfo.processInfo.systemUptime-_localReadyStarted;
    YNXLocalReadinessDecision state=YNXLocalReadinessState(generation,_localReadyGeneration,_localStartupFailed,_localReadyComplete,child.running,elapsed,NO,NO);
    if(state==YNXLocalReadinessIgnore)return;
    if(state==YNXLocalReadinessFail){[self showFailure:[NSString stringWithFormat:@"The local workbench could not finish starting. Log: %@",_serverLogURL.path?:@"unavailable"]];return;}
    NSURL *url=[NSURL URLWithString:YNXOrigin(_port)];
    NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:1];
    _localReadyTask=[[NSURLSession sharedSession]dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
        dispatch_async(dispatch_get_main_queue(),^{
            if(generation!=self.localReadyGeneration||child!=self.server||self.localStartupFailed||self.localReadyComplete)return;
            self.localReadyTask=nil;NSTimeInterval elapsed=NSProcessInfo.processInfo.systemUptime-self.localReadyStarted;
            BOOL receipt=[self localReadinessReceiptMatched];NSInteger status=[response isKindOfClass:NSHTTPURLResponse.class]?[(NSHTTPURLResponse *)response statusCode]:0;
            NSString *diagnostic=[NSString stringWithFormat:@"%ld|%@|%ld|%d",(long)status,error.domain?:@"none",(long)error.code,receipt];
            if(![diagnostic isEqual:self.localReadyDiagnostic]||attempt%20==0){
                self.localReadyDiagnostic=diagnostic;
                NSDictionary *record=@{@"generation":@(generation),@"attempt":@(attempt),@"elapsedSeconds":@(elapsed),@"status":@(status),@"errorDomain":error.domain?:@"none",@"errorCode":@(error.code),@"receiptMatched":@(receipt),@"childRunning":@(child.running)};
                NSData *json=[NSJSONSerialization dataWithJSONObject:record options:0 error:nil];NSString *line=[NSString stringWithFormat:@"YNX_NATIVE_READINESS %@\n",[[NSString alloc]initWithData:json encoding:NSUTF8StringEncoding]];
                [self.serverLog writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
            }
            YNXLocalReadinessDecision state=YNXLocalReadinessState(generation,self.localReadyGeneration,self.localStartupFailed,self.localReadyComplete,child.running,elapsed,YNXLocalReadinessResponse(response,error,self.port),receipt);
            if(state==YNXLocalReadinessLoad){self.localReadyComplete=YES;[self.webView loadRequest:[NSURLRequest requestWithURL:url]];return;}
            if(state==YNXLocalReadinessFail){[self showFailure:[NSString stringWithFormat:@"The local workbench could not finish starting. Log: %@",self.serverLogURL.path?:@"unavailable"]];return;}
            if(state==YNXLocalReadinessWait)dispatch_after(dispatch_time(DISPATCH_TIME_NOW,250*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[self pollLocalReadiness:generation attempt:attempt+1];});
        });
    }];[_localReadyTask resume];
}
- (void)loadWhenReady:(NSInteger)attempt {
    if(_localWorkbenchMode){
        if(_localStartupFailed)return;
        [self cancelLocalReadiness];_localReadyStarted=NSProcessInfo.processInfo.systemUptime;_localReadyComplete=NO;_localReadyDiagnostic=nil;
        [self pollLocalReadiness:_localReadyGeneration attempt:0];return;
    }
    if(attempt>=60){[self showFailure:@"Local server did not become ready. Log: ~/Library/Logs/YNXDeveloper/desktop-server.log"];return;}
    NSURL *url=[NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%ld",(long)_port]];NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:1];
    [[[NSURLSession sharedSession]dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){dispatch_async(dispatch_get_main_queue(),^{if([(NSHTTPURLResponse*)response statusCode]==200)[self.webView loadRequest:[NSURLRequest requestWithURL:url]];else dispatch_after(dispatch_time(DISPATCH_TIME_NOW,150*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[self loadWhenReady:attempt+1];});});}]resume];
}
- (void)showLocalProjectAlreadyOpen {
    [self cancelLocalReadiness];
    _localStartupFailed=YES;
    [_webView loadHTMLString:YNXLocalStatusPage(YNXLocalMenuLabel(@"Project already open",_localLocale),YNXLocalMenuLabel(@"This project is already open in another YNX Developer window. Continue in that window, or use File → Open Folder… to choose a different project. Your files and running terminal were preserved.",_localLocale)) baseURL:nil];
}
- (void)showFailure:(NSString *)message {
    if(_localWorkbenchMode&&_localEditorDocumentLoaded){NSAlert *alert=[NSAlert new];alert.messageText=@"The local workbench encountered a problem";alert.informativeText=message;[alert beginSheetModalForWindow:_window completionHandler:nil];return;}
    if(_localWorkbenchMode){[self cancelLocalReadiness];_localStartupFailed=YES;[self stopUnopenedLocalServer];[_webView loadHTMLString:YNXLocalStatusPage(@"YNX Developer could not open",message) baseURL:nil];return;}
    [_webView loadHTMLString:YNXLocalStatusPage(@"YNX Developer Testnet Preview",[NSString stringWithFormat:@"%@ No project, Wallet key, or deployment was changed.",message]) baseURL:nil];
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
    NSString *configuredMode=NSProcessInfo.processInfo.environment[@"YNX_DEVELOPER_DESKTOP_MODE"]?:NSBundle.mainBundle.infoDictionary[@"YNXDesktopMode"];
    if(!_localWalletBridge&&[configuredMode isEqual:@"local-workbench"]){if(!_pendingNativeWalletURLs)_pendingNativeWalletURLs=[NSMutableArray new];for(NSURL *url in urls)if(_pendingNativeWalletURLs.count<4&&url.absoluteString.length<=4096&&[url.scheme isEqual:@"ynxdeveloper"]&&[url.host isEqual:@"wallet-auth"]&&[url.path isEqual:@"/callback"])[_pendingNativeWalletURLs addObject:url];return;}
    for(NSURL *url in urls){
        if(_localWorkbenchMode){NSString *owner=[_localWalletBridge routeCallback:url.absoluteString];if(owner){[NSDistributedNotificationCenter.defaultCenter postNotificationName:[@"com.ynxweb4.developer.wallet-return." stringByAppendingString:owner] object:nil userInfo:nil deliverImmediately:YES];if([owner isEqual:_localWalletBridge.instanceID])[self localWalletReturnReady:nil];}continue;}
        NSURLComponents *parts=[NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];NSArray<NSURLQueryItem *> *items=parts.queryItems;BOOL walletAuth=[parts.host isEqualToString:@"wallet-auth"]&&[parts.path isEqualToString:@"/callback"],deployment=[parts.host isEqualToString:@"deployment"]&&[parts.path isEqualToString:@"/callback"];BOOL exact=[parts.scheme isEqualToString:@"ynxdeveloper"]&&(walletAuth||deployment)&&!parts.fragment.length&&items.count==1&&[items.firstObject.name isEqualToString:@"response"]&&items.firstObject.value.length>32;if(!exact)continue;NSString *encoded=YNXJSON(url.absoluteString),*event=deployment?@"ynx-deployment-callback":@"ynx-wallet-callback";YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.dispatchEvent(new CustomEvent('%@',{detail:%@}))",event,encoded?:@"null"]);
    }
}
- (void)localWalletReturnReady:(NSNotification *)note {
    if(!_localWorkbenchMode||!YNXLocalEditorDocumentURL(_webView.URL,_port))return;NSString *url=[_localWalletBridge takeRoutedCallback];if(!url)return;
    YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"if(location.pathname==='/')window.dispatchEvent(new CustomEvent('ynx-wallet-callback',{detail:%@}));",YNXJSON(url)]);
}
- (void)localWalletReply:(NSString *)identifier value:(id)value error:(NSError *)error {
    NSDictionary *reply=error?@{@"id":identifier,@"ok":@NO,@"error":error.localizedDescription}:@{@"id":identifier,@"ok":@YES,@"value":value?:NSNull.null};
    YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"if(location.pathname==='/')window.__ynxNativeWalletReply?.(%@);",YNXJSON(reply)]);
}
- (void)handleLocalWalletMessage:(id)value {
    NSDictionary *body=[value isKindOfClass:NSDictionary.class]?value:nil;NSString *identifier=body[@"id"],*action=body[@"action"];
    if(![identifier isKindOfClass:NSString.class]||![[NSUUID alloc]initWithUUIDString:identifier]||![action isKindOfClass:NSString.class])return;
    NSDictionary *fields=@{@"availability":@"id action",@"begin-connection":@"id action",@"end-connection":@"id action",@"device-info":@"id action",@"device-sign":@"id action input",@"open-authorization":@"id action url",@"storage-get":@"id action key",@"storage-set":@"id action key value",@"storage-remove":@"id action key"};
    NSError *error=nil;id result=nil;
    if(!fields[action]||!YNXDeviceFields(body,fields[action])){error=[NSError errorWithDomain:@"YNXDeveloperNativeWallet" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Unsupported native Wallet request."}];}
    else if([action isEqual:@"availability"]){NSString *handler=CFBridgingRelease(LSCopyDefaultHandlerForURLScheme(CFSTR("ynxwallet")));BOOL installed=handler&&[NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:handler]!=nil;result=@{@"walletInstalled":@(installed),@"schemeRegistered":@(handler!=nil)};}
    else if([action isEqual:@"begin-connection"]){
        if(_localWalletConsent||_window.attachedSheet){error=[NSError errorWithDomain:@"YNXDeveloperNativeWallet" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Finish the current native dialog before connecting Wallet."}];}
        else {NSURL *document=_webView.URL;NSAlert *alert=[NSAlert new];_localWalletConsent=alert;BOOL zh=[_localLocale isEqual:@"zh-cn"];alert.messageText=zh?@"连接 YNX Wallet？":@"Connect YNX Wallet?";alert.informativeText=zh?@"允许此 YNX Developer 窗口使用系统保护的设备密钥，完成登录审阅和会话查询/撤销。不会批准交易、部署或授予项目和扩展签名能力。":@"Allow this YNX Developer window to use its OS-protected device key for Wallet connection review and session introspection/revocation. This does not approve transactions, deployments, or project/extension signing.";[alert addButtonWithTitle:zh?@"连接":@"Connect"];[alert addButtonWithTitle:zh?@"取消":@"Cancel"];
            [alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse answer){self.localWalletConsent=nil;NSError *failure=nil;NSDictionary *device=nil;if(answer==NSAlertFirstButtonReturn&&[self.webView.URL isEqual:document]&&YNXLocalEditorDocumentURL(document,self.port)){device=[self.localWalletBridge beginUserOperation:&failure];if(device){NSUInteger generation=++self.localWalletGeneration;dispatch_after(dispatch_time(DISPATCH_TIME_NOW,300*NSEC_PER_SEC),dispatch_get_main_queue(),^{if(self.localWalletGeneration==generation)[self.localWalletBridge endUserOperation];});}}else failure=[NSError errorWithDomain:@"YNXDeveloperNativeWallet" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Native Wallet connection was cancelled."}];[self localWalletReply:identifier value:device error:failure];}];return;
        }
    }
    else if([action isEqual:@"end-connection"]){_localWalletGeneration++;[_localWalletBridge endUserOperation];}
    else if([action isEqual:@"device-info"]){NSString *key=_localWalletBridge.publicKey;if(key)result=@{@"id":@"ynx-developer-macos-device-v2",@"key":key,@"algorithm":@"p256-sha256",@"securityLevel":@"os-protected"};else error=[NSError errorWithDomain:@"YNXDeveloperNativeWallet" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Connect Wallet explicitly to initialize the native device."}];}
    else if([action isEqual:@"device-sign"]){result=[_localWalletBridge sign:body[@"input"] error:&error];}
    else if([action isEqual:@"storage-get"]){result=[_localWalletBridge stored:body[@"key"] error:&error];}
    else if([action isEqual:@"storage-set"]){[_localWalletBridge store:body[@"value"] key:body[@"key"] error:&error];}
    else if([action isEqual:@"storage-remove"]){[_localWalletBridge remove:body[@"key"] error:&error];}
    else if([action isEqual:@"open-authorization"]){
        if([_localWalletBridge prepareAuthorizationURL:body[@"url"] error:&error]){NSURL *url=[NSURL URLWithString:body[@"url"]];if(![NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:url]||![NSWorkspace.sharedWorkspace openURL:url])error=[NSError errorWithDomain:@"YNXDeveloperNativeWallet" code:1 userInfo:@{NSLocalizedDescriptionKey:@"YNX Wallet is unavailable or rejected this authorization route."}];}
    }
    [self localWalletReply:identifier value:result error:error];
}
- (void)click:(NSString *)selector { YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"document.querySelector('%@')?.click()",selector]); }
- (NSMenuItem *)editItem:(NSMenu *)menu title:(NSString *)title command:(NSString *)command key:(NSString *)key {
    NSMenuItem *item=[menu addItemWithTitle:title action:@selector(desktopEdit:) keyEquivalent:key];
    item.target=self; item.representedObject=command; return item;
}
- (void)installMenus { NSMenu *main=[NSMenu new]; NSApp.mainMenu=main; NSMenuItem *appItem=[NSMenuItem new];[main addItem:appItem];NSMenu *app=[NSMenu new];appItem.submenu=app;[app addItemWithTitle:@"About YNX Developer Testnet Preview" action:@selector(showAbout:) keyEquivalent:@""];[app addItem:[NSMenuItem separatorItem]];[app addItemWithTitle:@"Check for Updates…" action:@selector(checkUpdates:) keyEquivalent:@""];[app addItem:[NSMenuItem separatorItem]];[app addItemWithTitle:@"Quit YNX Developer" action:@selector(terminate:) keyEquivalent:@"q"]; NSMenuItem *fileItem=[NSMenuItem new];[main addItem:fileItem];NSMenu *file=[[NSMenu alloc]initWithTitle:@"File"];fileItem.submenu=file;NSMenuItem *walletProjects=[file addItemWithTitle:@"Wallet projects…" action:@selector(openWalletProjects:) keyEquivalent:@""];walletProjects.target=self;[file addItem:[NSMenuItem separatorItem]];[file addItemWithTitle:@"New File…" action:@selector(newProject:) keyEquivalent:@"n"];[file addItemWithTitle:@"Open Project…" action:@selector(openProject:) keyEquivalent:@"o"];[file addItemWithTitle:@"Save" action:@selector(save:) keyEquivalent:@"s"];NSMenuItem *export=[file addItemWithTitle:@"Export Project…" action:@selector(exportProject:) keyEquivalent:@"s"];export.keyEquivalentModifierMask=NSEventModifierFlagCommand|NSEventModifierFlagShift; NSMenuItem *editItem=[NSMenuItem new];[main addItem:editItem];NSMenu *edit=[[NSMenu alloc]initWithTitle:@"Edit"];editItem.submenu=edit;[self editItem:edit title:@"Undo" command:@"undo" key:@"z"];NSMenuItem *redo=[self editItem:edit title:@"Redo" command:@"redo" key:@"z"];redo.keyEquivalentModifierMask=NSEventModifierFlagCommand|NSEventModifierFlagShift;[edit addItem:[NSMenuItem separatorItem]];[self editItem:edit title:@"Cut" command:@"cut" key:@"x"];[self editItem:edit title:@"Copy" command:@"copy" key:@"c"];[self editItem:edit title:@"Paste" command:@"paste" key:@"v"];[self editItem:edit title:@"Select All" command:@"selectAll" key:@"a"]; NSMenuItem *windowItem=[NSMenuItem new];[main addItem:windowItem];NSMenu *windows=[[NSMenu alloc]initWithTitle:@"Window"];windowItem.submenu=windows;[windows addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];[windows addItemWithTitle:@"Bring All to Front" action:@selector(arrangeInFront:) keyEquivalent:@""]; }
- (void)dispatchWorkbenchCommand:(NSDictionary *)detail { YNXEvaluateTrustedScript(_webView,_port,[NSString stringWithFormat:@"window.dispatchEvent(new CustomEvent('ynx-desktop-command',{detail:%@}))",YNXJSON(detail)]); }
- (void)openWalletProjects:(id)sender { if(!_hostedWorkspace)_hostedWorkspace=[YNXHostedWorkspace new];[_hostedWorkspace open]; }
- (BOOL)validateMenuItem:(NSMenuItem *)item {
    if(item.action==@selector(localWorkbenchCommand:)){
        NSString *command=[item.representedObject isKindOfClass:NSString.class]?item.representedObject:nil;
        if(!_localWorkbenchMode||![YNXLocalWorkbenchCommands() containsObject:command])return NO;
        NSWindow *window=NSApp.keyWindow;NSResponder *responder=window.firstResponder;
        BOOL webResponder=window==_window&&[responder isKindOfClass:NSView.class]&&[(NSView *)responder isDescendantOf:_webView];
        SEL selector=YNXLocalNativeEditSelector(command);
        if(!webResponder&&selector)return responder&&[responder respondsToSelector:selector];
        return window==_window&&_localCommandDocumentReady&&_server.running&&YNXLocalEditorDocumentURL(_webView.URL,_port)&&!_localCloseRequest&&_pendingLocalCommands.count<32;
    }
    if(item.action==@selector(desktopEdit:))return !_nativeEditPending && NSApp.keyWindow.firstResponder!=nil;
    if(item.action==@selector(newProject:) || item.action==@selector(openProject:) || item.action==@selector(save:) || item.action==@selector(exportProject:))return NSApp.keyWindow==_window && _workspaceBridge.restoreComplete;
    return YES;
}
- (void)desktopEdit:(NSMenuItem *)sender {
    NSString *command=sender.representedObject;
    SEL selector=YNXEditSelector(command);
    NSWindow *window=NSApp.keyWindow;
    NSResponder *responder=window.firstResponder;
    if(!selector || !responder || _nativeEditPending)return;
    BOOL webResponder=window==_window && [responder isKindOfClass:NSView.class] && [(NSView *)responder isDescendantOf:_webView];
    if(!webResponder){
        // Native text fields in sheets retain their own responder/undo system.
        [NSApp sendAction:selector to:responder from:sender];
        return;
    }
    if(_localWorkbenchMode){[NSApp sendAction:selector to:responder from:sender];return;}
    NSURL *url=_webView.URL;
    if(![url.scheme isEqualToString:@"http"] || ![url.host isEqualToString:@"127.0.0.1"] || url.port.integerValue!=_port)return;
    _nativeEditPending=YES;
    NSString *origin=[NSString stringWithFormat:@"http://127.0.0.1:%ld",(long)_port];
    [_webView callAsyncJavaScript:@"if(location.origin!==origin || typeof window.__ynxDesktopEdit!=='function')return 'blocked';return window.__ynxDesktopEdit(command);"
        arguments:@{@"command":command,@"origin":origin} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id route, NSError *error){
        self.nativeEditPending=NO;
        // No fallback after a handled, blocked or failed JS command. Never apply
        // an old menu operation to a different window or native responder.
        if(!YNXShouldForwardNativeEdit(route,error,NSApp.keyWindow==window,window.firstResponder==responder))return;
        // Exactly one genuine WebKit action produces Monaco's clipboard event,
        // or edits the ordinary input that the page router confirmed is focused.
        [NSApp sendAction:selector to:responder from:sender];
    }];
}
- (void)newProject:(id)sender { [self dispatchWorkbenchCommand:@{@"command":@"new-file"}]; }
- (void)openProject:(id)sender {
    NSOpenPanel *panel=[NSOpenPanel openPanel]; panel.canChooseFiles=YES; panel.canChooseDirectories=NO; panel.allowsMultipleSelection=NO; panel.allowedFileTypes=@[@"json"];
    [panel beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){
        if(result!=NSModalResponseOK)return;
        NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:panel.URL.path error:nil];
        NSData *data=[attributes[NSFileSize] unsignedLongLongValue]<=2359296 ? [NSData dataWithContentsOfURL:panel.URL] : nil;
        NSString *content=data?[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]:nil;
        if(!content){NSAlert *alert=[NSAlert new];alert.messageText=@"Project import could not be read";alert.informativeText=@"Choose a UTF-8 project JSON file within the 2 MiB workspace limit.";[alert beginSheetModalForWindow:self.window completionHandler:nil];return;}
        [self dispatchWorkbenchCommand:@{@"command":@"import-project",@"filename":panel.URL.lastPathComponent,@"content":content}];
    }];
}
- (void)save:(id)sender { [self dispatchWorkbenchCommand:@{@"command":@"save"}]; }
- (void)exportProject:(id)sender { [self dispatchWorkbenchCommand:@{@"command":@"export-project"}]; }
- (BOOL)trustedFrame:(WKFrameInfo *)frame { return YNXTrustedFrame(frame,_port); }
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    if(view!=_webView){decisionHandler(WKNavigationActionPolicyCancel);return;}
    if(!action.targetFrame && ![self trustedFrame:action.sourceFrame]){decisionHandler(WKNavigationActionPolicyCancel);return;}
    if(action.targetFrame && !action.targetFrame.mainFrame){decisionHandler(WKNavigationActionPolicyAllow);return;}
    if(action.navigationType==WKNavigationTypeLinkActivated && [self trustedFrame:action.sourceFrame] && YNXWalletProjectsURL(action.request.URL)){decisionHandler(WKNavigationActionPolicyCancel);[self openWalletProjects:nil];return;}
    YNXNavigationDisposition disposition=YNXMainNavigation(action.request.URL,_port,action.navigationType);
    decisionHandler(disposition==YNXNavigationAllow?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
    if(disposition==YNXNavigationOpenExternal)[NSWorkspace.sharedWorkspace openURL:action.request.URL];
}
- (WKWebView *)webView:(WKWebView *)view createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
    if(view!=_webView || action.targetFrame)return nil;
    if(action.navigationType==WKNavigationTypeLinkActivated && [self trustedFrame:action.sourceFrame] && YNXWalletProjectsURL(action.request.URL)){[self openWalletProjects:nil];return nil;}
    YNXNavigationDisposition disposition=YNXNewWindowNavigation(action.request.URL,_port,action.navigationType,[self trustedFrame:action.sourceFrame]);
    // WKWebView otherwise silently drops target=_blank links. Keep trusted
    // local Tools in this window; public links use the system browser without
    // giving a remote document access to the native workspace bridge.
    if(disposition==YNXNavigationAllow)[view loadRequest:action.request];
    else if(disposition==YNXNavigationOpenExternal)[NSWorkspace.sharedWorkspace openURL:action.request.URL];
    return nil;
}
- (void)webView:(WKWebView *)view runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))completionHandler {
    if(view!=_webView || ![self trustedFrame:frame]){completionHandler(nil);return;}
    NSOpenPanel *panel=[NSOpenPanel openPanel];panel.canChooseFiles=YES;panel.canChooseDirectories=parameters.allowsDirectories;panel.allowsMultipleSelection=parameters.allowsMultipleSelection;
    [panel beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){completionHandler(result==NSModalResponseOK?panel.URLs:nil);}];
}
- (void)webView:(WKWebView *)view runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    if(view!=_webView || ![self trustedFrame:frame]){completionHandler();return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"YNX Developer";alert.informativeText=message;[alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){completionHandler();}];
}
- (void)webView:(WKWebView *)view runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    if(view!=_webView || ![self trustedFrame:frame]){completionHandler(NO);return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"YNX Developer";alert.informativeText=message;[alert addButtonWithTitle:@"Continue"];[alert addButtonWithTitle:@"Cancel"];
    [alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){completionHandler(result==NSAlertFirstButtonReturn);}];
}
- (void)webView:(WKWebView *)view runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt defaultText:(NSString *)defaultText initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSString *))completionHandler {
    if(view!=_webView || ![self trustedFrame:frame]){completionHandler(nil);return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"YNX Developer";alert.informativeText=prompt;[alert addButtonWithTitle:@"Create"];[alert addButtonWithTitle:@"Cancel"];
    NSTextField *field=[[NSTextField alloc]initWithFrame:NSMakeRect(0,0,360,24)];field.stringValue=defaultText?:@"";alert.accessoryView=field;
    [alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse result){completionHandler(result==NSAlertFirstButtonReturn?field.stringValue:nil);}];
}
- (void)showAbout:(id)sender{NSAlert *a=[NSAlert new];a.messageText=@"YNX Developer Testnet Preview";a.informativeText=[NSString stringWithFormat:@"Version: %@\nPackaged source: %@\n%@Unsigned ad-hoc local build for YNX public testnet engineering. It is not a production-signed desktop release.",NSBundle.mainBundle.infoDictionary[@"CFBundleShortVersionString"]?:@"unverified",YNXPackagedSource(),NSProcessInfo.processInfo.environment[@"YNX_CODE_DESKTOP_SUPPORT_DIR"].length?@"QA profile — not the normal user profile.\n":@""];[a runModal];} - (void)checkUpdates:(id)sender{NSAlert *a=[NSAlert new];a.messageText=@"Updates require signed release metadata";a.informativeText=@"This unsigned Testnet Preview never downloads or installs updates automatically.";[a runModal];}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    if(_localWorkbenchMode){
        if(YNXLocalStartupFailureMayExit(_localStartupFailed,_localEditorDocumentLoaded))return NSTerminateNow;
        if(_localCloseRequest)return NSTerminateCancel;
        _localCloseRequest=NSUUID.UUID.UUIDString.lowercaseString;
        NSString *request=_localCloseRequest;
        [_webView callAsyncJavaScript:@"if(location.origin!==origin||typeof window.__ynxLocalWorkbenchClose!=='function')throw new Error('The workbench is not ready to close');window.__ynxLocalWorkbenchClose(requestId);"
            arguments:@{@"origin":YNXOrigin(_port),@"requestId":request} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result,NSError *error){
            if(error&&[self.localCloseRequest isEqualToString:request]){self.localCloseRequest=nil;[sender replyToApplicationShouldTerminate:NO];}
        }];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,60*NSEC_PER_SEC),dispatch_get_main_queue(),^{if([self.localCloseRequest isEqualToString:request]){self.localCloseRequest=nil;[sender replyToApplicationShouldTerminate:NO];}});
        return NSTerminateLater;
    }
    if(!_webView || !_workspaceBridge || !_workspaceBridge.restoreComplete)return NSTerminateNow;
    // Wait for the real Workbench's current snapshot and native disk ACK. A
    // random-port relaunch must not race the final edited character at quit.
    [_webView callAsyncJavaScript:@"if(location.origin!==origin)throw new Error('Workspace origin changed');if (typeof window.__ynxFlushWorkspace === 'function') await window.__ynxFlushWorkspace();" arguments:@{@"origin":YNXOrigin(_port)} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result, NSError *error){
        if(!error){[sender replyToApplicationShouldTerminate:YES];return;}
        NSAlert *alert=[NSAlert new];alert.messageText=@"Workspace recovery could not be saved";alert.informativeText=@"Keep editing to retry Save, or quit without saving the latest changes.";[alert addButtonWithTitle:@"Keep Editing"];[alert addButtonWithTitle:@"Quit Without Saving"];
        [sender replyToApplicationShouldTerminate:[alert runModal]==NSAlertSecondButtonReturn];
    }];
    return NSTerminateLater;
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if(_localWorkbenchMode&&[message.name isEqual:@"ynxLocalWallet"]){
        if(YNXTrustedMessage(message,_webView,_port)&&YNXLocalEditorDocumentURL(message.frameInfo.request.URL,_port)&&YNXLocalEditorDocumentURL(_webView.URL,_port)) [self handleLocalWalletMessage:message.body];
        return;
    }
    if(!_localWorkbenchMode||![message.name isEqualToString:@"ynxLocalWorkbench"]||!YNXTrustedMessage(message,_webView,_port))return;
    NSDictionary *body=[message.body isKindOfClass:NSDictionary.class]?message.body:nil;
    if([body[@"action"] isEqual:@"locale"]){
        if(!YNXLocalEditorDocumentURL(message.frameInfo.request.URL,_port)||!YNXLocalEditorDocumentURL(_webView.URL,_port)||!YNXLocalLocalePayload(body))return;
        [NSUserDefaults.standardUserDefaults setObject:body[@"locale"] forKey:@"YNXDeveloperDisplayLocale"];
        if(![_localLocale isEqual:body[@"locale"]]){
            _localLocale=[body[@"locale"] copy];
            // The command IDs, requests and document binding stay intact. End
            // menu tracking before replacing only this local window's labels.
            [NSApp.mainMenu cancelTrackingWithoutAnimation];[self installLocalMenus];
        }return;
    }
    if([body[@"action"] isEqual:@"open-folder"]){
        // Only the genuine OS picker may select a new workspace. A page/hash
        // cannot submit a filesystem path or alter this instance's binding.
        if(!YNXLocalOpenFolderPayload(body)||!YNXLocalEditorDocumentURL(message.frameInfo.request.URL,_port)||!YNXLocalEditorDocumentURL(_webView.URL,_port)||!_localCommandDocumentReady||!_server.running)return;
        [self openLocalFolder:nil];return;
    }
    if([body[@"action"] isEqual:@"command-result"]){
        if(!YNXLocalEditorDocumentURL(message.frameInfo.request.URL,_port)||!YNXLocalEditorDocumentURL(_webView.URL,_port)||!YNXLocalCommandResult(body,_pendingLocalCommands))return;
        [_pendingLocalCommands removeObjectForKey:body[@"requestId"]];
        if(![body[@"accepted"] boolValue])[self localCommandUnavailable:body[@"error"]?:@"This action is not available in the current editor."];
        return;
    }
    if([body[@"action"] isEqual:@"appearance"]){
        if(!YNXLocalEditorDocumentURL(message.frameInfo.request.URL,_port)||!YNXLocalEditorDocumentURL(_webView.URL,_port)||!YNXLocalAppearancePayload(body))return;
        _window.appearance=[NSAppearance appearanceNamed:[body[@"mode"] isEqual:@"light"]?NSAppearanceNameAqua:NSAppearanceNameDarkAqua];
        NSColor *background=YNXLocalBackgroundColor(body[@"background"]);_window.backgroundColor=background;_webView.underPageBackgroundColor=background;return;
    }
    if(!_localCloseRequest)return;
    if(body.count!=3||![body[@"action"] isEqual:@"close-result"]||![body[@"requestId"] isEqual:_localCloseRequest]||![body[@"accepted"] isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)body[@"accepted"])!=CFBooleanGetTypeID())return;
    BOOL accepted=[body[@"accepted"] boolValue];_localCloseRequest=nil;[NSApp replyToApplicationShouldTerminate:accepted];
}
- (BOOL)windowShouldClose:(NSWindow *)sender {
    if(_localWorkbenchMode&&sender==_window){[NSApp terminate:nil];return NO;}
    return YES;
}
- (void)applicationWillTerminate:(NSNotification *)note{[self cancelLocalReadiness];if(_server.running){[_server terminate];[_server waitUntilExit];}[_serverLog closeFile];} - (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender{return YES;} - (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag{if(!flag)[_window makeKeyAndOrderFront:nil];return YES;}
@end

int main(int argc,const char *argv[]){@autoreleasepool{if(argc>=3&&!strcmp(argv[1],"--self-test")){NSURL *resources=[NSURL fileURLWithPath:@(argv[2])];BOOL web=[NSFileManager.defaultManager fileExistsAtPath:[[resources URLByAppendingPathComponent:@"code/apps/developer/frontend/dist/index.html"]path]],gateway=[NSFileManager.defaultManager fileExistsAtPath:[[resources URLByAppendingPathComponent:@"code/apps/developer/services/gateway/src/server.mjs"]path]],node=[NSFileManager.defaultManager isExecutableFileAtPath:[[resources URLByAppendingPathComponent:@"runtime/node"]path]];if(!web||!gateway||!node)return 2;if(!YNXWalletStorageSelfTest())return 4;NSDictionary *availability=YNXWalletAvailability();NSTask *task=[NSTask new];task.executableURL=[resources URLByAppendingPathComponent:@"runtime/node"];task.arguments=@[@"--version"];task.standardOutput=[NSPipe pipe];NSError *error=nil;if(![task launchAndReturnError:&error])return 3;[task waitUntilExit];printf("YNX Developer YNX Code resources, bundled runtime and Keychain session storage OK\n");printf("YNX Wallet scheme state: installed=%s schemeRegistered=%s\n",[availability[@"installed"] boolValue]?"true":"false",[availability[@"schemeRegistered"] boolValue]?"true":"false");return task.terminationStatus;}NSApplication *app=NSApplication.sharedApplication;YNXAppDelegate *delegate=[YNXAppDelegate new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app activateIgnoringOtherApps:YES];[app run];}return 0;}
