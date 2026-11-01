#import "native_consent.h"
#import <AppKit/AppKit.h>
#import <errno.h>
#import <math.h>
#import <poll.h>
#import <time.h>
#import <unistd.h>

NSString *const QANativeConsentVersion = @"YNX-NETWORK-NATIVE-CONSENT/v1";
static const NSUInteger QAMaxPacket = 16 * 1024;
static NSString *const QAConsentErrorDomain = @"YNXNetworkNativeConsent";

@interface QANativeConsentPacket ()
@property(nonatomic, copy, readwrite) NSDictionary<NSString *, NSString *> *fields;
@property(nonatomic, copy, readwrite) NSDate *expiresAt;
- (instancetype)initWithFields:(NSDictionary<NSString *, NSString *> *)fields expires:(NSDate *)expires;
@end
@implementation QANativeConsentPacket
- (instancetype)initWithFields:(NSDictionary<NSString *, NSString *> *)fields expires:(NSDate *)expires {
    self = [super init];
    if (self) { _fields = [fields copy]; _expiresAt = [expires copy]; }
    return self;
}
@end

static BOOL QAReject(NSError **error, NSString *code) {
    if (error) *error = [NSError errorWithDomain:QAConsentErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey:code}];
    return NO;
}
static NSArray<NSString *> *QAKeys(void) {
    return @[@"version", @"requestId", @"payloadSHA256", @"action", @"nodeId", @"artifactSHA256", @"generation", @"mode", @"expiresAtUTC"];
}
static NSArray<NSString *> *QALocales(void) {
    return @[@"en", @"zh-Hans", @"zh-Hant", @"ja", @"ko", @"es", @"fr", @"de", @"pt", @"ru", @"ar", @"id"];
}
static BOOL QALowerHex(NSString *s, NSUInteger count) {
    if (![s isKindOfClass:NSString.class] || s.length != count) return NO;
    for (NSUInteger i=0; i<s.length; i++) { unichar c=[s characterAtIndex:i]; if (!(c>='0'&&c<='9') && !(c>='a'&&c<='f')) return NO; }
    return YES;
}
static BOOL QADecimal(NSString *s) {
    if (![s isKindOfClass:NSString.class] || !s.length || s.length>20 || (s.length>1 && [s hasPrefix:@"0"])) return NO;
    for (NSUInteger i=0; i<s.length; i++) { unichar c=[s characterAtIndex:i]; if(c<'0'||c>'9')return NO; }
    return s.length<20 || [s compare:@"18446744073709551615" options:NSLiteralSearch] != NSOrderedDescending;
}

// Deliberately small canonical ASCII JSON grammar: one flat object containing
// string pairs only, no escapes/aliases, duplicate names, nesting or trailing
// value. All nine allowed values have ASCII-only formats. JSON whitespace and
// field order remain independent of semantic display and the helper's hash.
typedef struct { const uint8_t *bytes; NSUInteger length, offset; } QAScanner;
static void QASpace(QAScanner *s) {
    while (s->offset<s->length) { uint8_t c=s->bytes[s->offset]; if(c!=' '&&c!='\t'&&c!='\r'&&c!='\n')break; s->offset++; }
}
static BOOL QATake(QAScanner *s, uint8_t c) {
    QASpace(s); if(s->offset>=s->length||s->bytes[s->offset]!=c)return NO; s->offset++; return YES;
}
static NSString *QAString(QAScanner *s, NSUInteger limit) {
    if(!QATake(s,'"'))return nil;
    NSUInteger begin=s->offset;
    while(s->offset<s->length) {
        uint8_t c=s->bytes[s->offset++];
        if(c=='"') {
            NSUInteger count=s->offset-begin-1;
            return count<=limit?[[NSString alloc]initWithBytes:s->bytes+begin length:count encoding:NSASCIIStringEncoding]:nil;
        }
        if(c<0x20||c>=0x7f||c=='\\'||s->offset-begin>limit)return nil;
    }
    return nil;
}
QANativeConsentPacket *QANativeConsentParse(NSData *data, NSDate *now, NSError **error) {
    if(![data isKindOfClass:NSData.class]||!data.length||data.length>QAMaxPacket||![now isKindOfClass:NSDate.class]||!isfinite(now.timeIntervalSince1970)) {
        QAReject(error,@"INVALID_PACKET"); return nil;
    }
    QAScanner s={data.bytes,data.length,0};
    if(!QATake(&s,'{')) { QAReject(error,@"INVALID_JSON");return nil; }
    NSMutableDictionary<NSString *,NSString *> *fields=[NSMutableDictionary new];
    for(NSUInteger i=0;i<9;i++) {
        NSString *key=QAString(&s,32);
        if(!key||![QAKeys() containsObject:key]||fields[key]||!QATake(&s,':')) { QAReject(error,@"INVALID_FIELDS");return nil; }
        NSString *value=QAString(&s,128);
        if(!value) { QAReject(error,@"STRING_REQUIRED");return nil; }
        fields[key]=value;
        if(i<8&&!QATake(&s,',')) { QAReject(error,@"MISSING_FIELDS");return nil; }
    }
    if(!QATake(&s,'}')) { QAReject(error,@"EXTRA_FIELDS");return nil; }
    QASpace(&s);
    if(s.offset!=s.length) { QAReject(error,@"TRAILING_DATA");return nil; }
    if(![fields[@"version"] isEqualToString:QANativeConsentVersion]||
       !QALowerHex(fields[@"requestId"],48)||!QALowerHex(fields[@"payloadSHA256"],64)||
       !QALowerHex(fields[@"artifactSHA256"],64)||![fields[@"nodeId"] isEqualToString:@"ordinary-node"]||
       ![@[@"install",@"start",@"stop"] containsObject:fields[@"action"]]||
       ![@[@"production",@"isolated-lifecycle-fixture"] containsObject:fields[@"mode"]]||
       !QADecimal(fields[@"generation"])) { QAReject(error,@"INVALID_INTENT");return nil; }
    NSString *expiry=fields[@"expiresAtUTC"];
    NSDateFormatter *format=[NSDateFormatter new];
    format.locale=[[NSLocale alloc]initWithLocaleIdentifier:@"en_US_POSIX"];
    format.calendar=[[NSCalendar alloc]initWithCalendarIdentifier:NSCalendarIdentifierGregorian];
    format.timeZone=[NSTimeZone timeZoneForSecondsFromGMT:0];
    format.dateFormat=@"yyyy-MM-dd'T'HH:mm:ss'Z'";
    format.lenient=NO;
    NSDate *expires=expiry.length==20?[format dateFromString:expiry]:nil;
    if(!expires||![[format stringFromDate:expires]isEqualToString:expiry]) { QAReject(error,@"INVALID_EXPIRY");return nil; }
    NSTimeInterval remaining=[expires timeIntervalSinceDate:now];
    if(!isfinite(remaining)||remaining<=0||remaining>60) { QAReject(error,@"EXPIRED_OR_TOO_LONG");return nil; }
    return [[QANativeConsentPacket alloc]initWithFields:fields expires:expires];
}
NSString *QANativeConsentResolveLocale(NSString *explicitLocale, NSArray<NSString *> *preferred, NSError **error) {
    if(explicitLocale) {
        if(![explicitLocale isKindOfClass:NSString.class]||![QALocales() containsObject:explicitLocale]) { QAReject(error,@"INVALID_LOCALE");return nil; }
        return explicitLocale;
    }
    for(id value in preferred) {
        if(![value isKindOfClass:NSString.class])continue;
        NSString *language=value;
        if([QALocales() containsObject:language])return language;
        if([language hasPrefix:@"zh-Hant"]||[language hasPrefix:@"zh-TW"]||[language hasPrefix:@"zh-HK"]||[language hasPrefix:@"zh-MO"])return @"zh-Hant";
        if([language hasPrefix:@"zh-"])return @"zh-Hans";
        NSString *base=[language componentsSeparatedByString:@"-"].firstObject;
        if([QALocales() containsObject:base])return base;
    }
    return @"zh-Hans";
}
NSString *QANativeConsentResolveTheme(NSString *explicitTheme, NSError **error) {
    if(!explicitTheme)return @"system";
    if(![explicitTheme isKindOfClass:NSString.class]||![@[@"light",@"dark",@"system"]containsObject:explicitTheme]) { QAReject(error,@"INVALID_THEME");return nil; }
    return explicitTheme;
}
static NSArray<NSString *> *QAStrings(NSString *locale) {
    // Each locale supplies the complete fixed title/scope/explanation/buttons.
    NSDictionary<NSString *,NSArray<NSString *> *> *catalog=@{
      @"en":@[@"YNX Network · Confirm ordinary-node operation",
        @"Only this ordinary-node operation; no validator, signer, funds or Root authority is granted.",
        @"This is a visible local decision only, not a cryptographic signature, verified human identity or production publisher approval.",
        @"Cancel",@"Approve only this node operation"],
      @"zh-Hans":@[@"YNX Network · 普通节点操作确认",
        @"仅此普通节点操作；不授予验证者/签名器/资金/Root权力",
        @"这仅是可见的本地决定，不是密码学签名、人类身份核验或生产发布者批准。",
        @"取消",@"仅批准本次普通节点操作"],
      @"zh-Hant":@[@"YNX Network · 普通節點操作確認",
        @"僅限此次普通節點操作；不授予驗證者/簽署器/資金/Root權力",
        @"這僅是可見的本機決定，不是密碼學簽章、人類身分核驗或正式發行者批准。",
        @"取消",@"僅批准本次普通節點操作"],
      @"ja":@[@"YNX Network · 通常ノード操作の確認",
        @"この通常ノード操作のみが対象です。バリデーター、署名器、資金、Root の権限は与えません。",
        @"これは画面で確認するローカルな決定のみです。暗号学的署名、人間の身元確認、本番発行者の承認ではありません。",
        @"キャンセル",@"今回の通常ノード操作のみ承認"],
      @"ko":@[@"YNX Network · 일반 노드 작업 확인",
        @"이번 일반 노드 작업에만 적용되며 검증자, 서명기, 자금 또는 Root 권한을 부여하지 않습니다.",
        @"화면에 표시되는 로컬 결정일 뿐이며 암호학적 서명, 사람의 신원 확인 또는 운영 배포자의 승인이 아닙니다.",
        @"취소",@"이번 일반 노드 작업만 승인"],
      @"es":@[@"YNX Network · Confirmar operación del nodo ordinario",
        @"Solo esta operación del nodo ordinario; no se conceden permisos de validador, firmante, fondos ni Root.",
        @"Es solo una decisión local visible, no una firma criptográfica, una identidad humana verificada ni la aprobación de un editor de producción.",
        @"Cancelar",@"Aprobar solo esta operación del nodo"],
      @"fr":@[@"YNX Network · Confirmer l’opération du nœud ordinaire",
        @"Uniquement cette opération du nœud ordinaire ; aucun droit de validateur, signataire, fonds ou Root n’est accordé.",
        @"Il s’agit uniquement d’une décision locale visible, pas d’une signature cryptographique, d’une identité humaine vérifiée ni de l’approbation d’un éditeur de production.",
        @"Annuler",@"Approuver uniquement cette opération du nœud"],
      @"de":@[@"YNX Network · Aktion des regulären Knotens bestätigen",
        @"Nur diese Aktion des regulären Knotens; keine Rechte für Validator, Signierer, Geldmittel oder Root werden erteilt.",
        @"Dies ist nur eine sichtbare lokale Entscheidung, keine kryptografische Signatur, geprüfte menschliche Identität oder Genehmigung eines Produktionsherausgebers.",
        @"Abbrechen",@"Nur diese Knotenaktion genehmigen"],
      @"pt":@[@"YNX Network · Confirmar operação do nó comum",
        @"Somente esta operação do nó comum; não concede autoridade de validador, assinador, fundos ou Root.",
        @"É apenas uma decisão local visível, não uma assinatura criptográfica, identidade humana verificada ou aprovação de um editor de produção.",
        @"Cancelar",@"Aprovar somente esta operação do nó"],
      @"ru":@[@"YNX Network · Подтвердить действие обычного узла",
        @"Только это действие обычного узла; права валидатора, подписанта, распоряжения средствами или Root не предоставляются.",
        @"Это лишь видимое локальное решение, а не криптографическая подпись, проверка личности человека или одобрение издателя рабочего выпуска.",
        @"Отмена",@"Одобрить только это действие узла"],
      @"ar":@[@"YNX Network · تأكيد إجراء العقدة العادية",
        @"لهذا الإجراء على العقدة العادية فقط؛ لا تُمنح صلاحيات المدقق أو الموقّع أو الأموال أو Root.",
        @"هذا قرار محلي ظاهر فقط، وليس توقيعًا تشفيريًا أو تحققًا من هوية إنسان أو موافقة ناشر إنتاج.",
        @"إلغاء",@"الموافقة على إجراء العقدة هذا فقط"],
      @"id":@[@"YNX Network · Konfirmasi operasi node biasa",
        @"Hanya operasi node biasa ini; tidak memberi wewenang validator, penanda tangan, dana, atau Root.",
        @"Ini hanya keputusan lokal yang terlihat, bukan tanda tangan kriptografis, identitas manusia terverifikasi, atau persetujuan penerbit produksi.",
        @"Batal",@"Setujui hanya operasi node ini"]
    };
    return catalog[locale];
}
NSDictionary<NSString *,NSString *> *QANativeConsentDisplay(QANativeConsentPacket *packet, NSString *locale, NSError **error) {
    if(![locale isKindOfClass:NSString.class]||![QALocales()containsObject:locale]) { QAReject(error,@"INVALID_LOCALE");return nil; }
    NSArray<NSString *> *strings=QAStrings(locale);
    if(![packet isKindOfClass:QANativeConsentPacket.class]||!strings) { QAReject(error,@"INVALID_DISPLAY");return nil; }
    NSMutableArray<NSString *> *lines=[NSMutableArray new];
    for(NSString *key in QAKeys())[lines addObject:[NSString stringWithFormat:@"%@: %@",key,packet.fields[key]]];
    return @{@"title":strings[0],@"warning":strings[1],@"explanation":strings[2],@"cancel":strings[3],@"approve":strings[4],
      @"details":[lines componentsJoinedByString:@"\n"],@"locale":locale,@"direction":[locale isEqualToString:@"ar"]?@"rtl":@"ltr"};
}
NSData *QANativeConsentResponse(QANativeConsentPacket *packet, NSString *decision, NSError **error) {
    if(![packet isKindOfClass:QANativeConsentPacket.class]||![decision isKindOfClass:NSString.class]||![@[@"approved",@"cancelled"]containsObject:decision]) { QAReject(error,@"INVALID_DECISION");return nil; }
    return [NSJSONSerialization dataWithJSONObject:@{@"version":QANativeConsentVersion,@"requestId":packet.fields[@"requestId"],
      @"payloadSHA256":packet.fields[@"payloadSHA256"],@"decision":decision} options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:error];
}
#if defined(QA_NATIVE_CONSENT_TESTING)
NSData *QANativeConsentWithTestPresenter(NSData *data, NSDate *now, NSString *locale, QANativeConsentTestPresenter presenter, NSError **error) {
    QANativeConsentPacket *packet=QANativeConsentParse(data,now,error);
    if(!packet||!presenter)return nil;
    NSDictionary *display=QANativeConsentDisplay(packet,locale,error);
    if(!display)return nil;
    NSString *decision=presenter(packet,display);
    return QANativeConsentResponse(packet,[decision isEqualToString:@"approved"]?@"approved":@"cancelled",error);
}
#endif

static double QAMonotonic(void) { struct timespec t; if(clock_gettime(CLOCK_MONOTONIC,&t)!=0)return NAN; return t.tv_sec+t.tv_nsec/1e9; }
static NSData *QAReadPacket(void) {
    uint8_t buffer[16*1024+1]; NSUInteger length=0;
    double began=QAMonotonic(); if(!isfinite(began))return nil;
    double deadline=began+5;
    while(length<sizeof(buffer)) {
        double remaining=deadline-QAMonotonic(); if(!isfinite(remaining)||remaining<=0)return nil;
        struct pollfd p={STDIN_FILENO,POLLIN,0};
        int ready=poll(&p,1,(int)(remaining*1000)+1);
        if(ready<0&&errno==EINTR)continue;
        if(ready<=0||p.revents&(POLLERR|POLLNVAL))return nil;
        ssize_t n=read(STDIN_FILENO,buffer+length,sizeof(buffer)-length);
        if(n<0&&errno==EINTR)continue;
        if(n<0)return nil;
        if(n==0)return length<=QAMaxPacket?[NSData dataWithBytes:buffer length:length]:nil;
        length+=(NSUInteger)n;
    }
    return nil;
}
@interface QAConsentCloseDelegate : NSObject <NSWindowDelegate>
@property(nonatomic) BOOL closed;
@end
@implementation QAConsentCloseDelegate
- (BOOL)windowShouldClose:(NSWindow *)window {
    self.closed=YES; [NSApp stopModalWithCode:NSAlertFirstButtonReturn]; [window orderOut:nil]; return NO;
}
@end

static NSString *QAPresentConsent(QANativeConsentPacket *packet, NSDictionary<NSString *,NSString *> *display, NSString *theme) {
    if(!NSThread.isMainThread)return @"cancelled";
    NSTimeInterval remaining=[packet.expiresAt timeIntervalSinceNow];
    double began=QAMonotonic();
    if(!isfinite(remaining)||remaining<=0||remaining>60||!isfinite(began))return @"cancelled";
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    NSApp.appearance=[theme isEqualToString:@"system"]?nil:[NSAppearance appearanceNamed:[theme isEqualToString:@"dark"]?NSAppearanceNameDarkAqua:NSAppearanceNameAqua];
    NSAlert *alert=[NSAlert new];
    alert.alertStyle=NSAlertStyleWarning;
    alert.messageText=display[@"title"];
    alert.informativeText=[NSString stringWithFormat:@"%@\n\n%@",display[@"warning"],display[@"explanation"]];
    NSButton *cancel=[alert addButtonWithTitle:display[@"cancel"]];
    NSButton *approve=[alert addButtonWithTitle:display[@"approve"]];
    cancel.keyEquivalent=@"\e"; approve.keyEquivalent=@"";
    alert.window.defaultButtonCell=cancel.cell; // Return never defaults to Approve.
    alert.window.contentView.userInterfaceLayoutDirection=[display[@"direction"]isEqualToString:@"rtl"]?NSUserInterfaceLayoutDirectionRightToLeft:NSUserInterfaceLayoutDirectionLeftToRight;
    NSScrollView *scroll=[[NSScrollView alloc]initWithFrame:NSMakeRect(0,0,660,270)];
    scroll.hasVerticalScroller=YES; scroll.hasHorizontalScroller=YES; scroll.borderType=NSBezelBorder;
    NSTextView *values=[[NSTextView alloc]initWithFrame:NSMakeRect(0,0,640,270)];
    values.editable=NO; values.selectable=YES; values.richText=NO;
    values.automaticLinkDetectionEnabled=NO; values.automaticDataDetectionEnabled=NO;
    values.font=[NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular];
    values.baseWritingDirection=NSWritingDirectionLeftToRight;
    values.string=display[@"details"]; // Raw ASCII field names and exact intent values, never localized.
    scroll.documentView=values; alert.accessoryView=scroll;
    QAConsentCloseDelegate *delegate=[QAConsentCloseDelegate new]; alert.window.delegate=delegate;
    __block BOOL expired=NO;
    NSTimer *timer=[NSTimer timerWithTimeInterval:MIN(remaining,0.1) repeats:YES block:^(NSTimer *unused) {
        (void)unused;
        double elapsed=QAMonotonic()-began;
        if([packet.expiresAt timeIntervalSinceNow]<=0||!isfinite(elapsed)||elapsed>=remaining) {
            expired=YES; [NSApp abortModal]; [alert.window orderOut:nil];
        }
    }];
    [NSRunLoop.mainRunLoop addTimer:timer forMode:NSModalPanelRunLoopMode];
    [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
    [NSApp activateIgnoringOtherApps:YES];
    NSModalResponse response=[alert runModal];
    [timer invalidate]; [alert.window orderOut:nil]; alert.window.delegate=nil;
    double elapsed=QAMonotonic()-began;
    BOOL validTime=[packet.expiresAt timeIntervalSinceNow]>0 && isfinite(elapsed) && elapsed<remaining;
    return response==NSAlertSecondButtonReturn&&!expired&&!delegate.closed&&validTime?@"approved":@"cancelled";
}
static NSString *QAEnvironment(const char *key, BOOL *valid) {
    const char *value=getenv(key);
    if(!value)return nil;
    size_t length=strnlen(value,128);
    if(length==128) { *valid=NO;return nil; }
    NSString *text=[[NSString alloc]initWithBytes:value length:length encoding:NSUTF8StringEncoding];
    if(!text)*valid=NO;
    return text;
}
int QANativeConsentMain(void) {
    @autoreleasepool {
        if(!NSThread.isMainThread) { fputs("MAIN_THREAD_REQUIRED\n",stderr);return 2; }
        BOOL valid=YES; NSError *error=nil;
        NSString *locale=QANativeConsentResolveLocale(QAEnvironment("YNX_NETWORK_NATIVE_LOCALE",&valid),NSLocale.preferredLanguages,&error);
        NSString *theme=QANativeConsentResolveTheme(QAEnvironment("YNX_NETWORK_NATIVE_THEME",&valid),&error);
        if(!valid||!locale||!theme) { fputs("INVALID_PREFERENCE\n",stderr);return 2; }
        NSData *data=QAReadPacket();
        QANativeConsentPacket *packet=data?QANativeConsentParse(data,NSDate.date,&error):nil;
        if(!packet) { fputs("INVALID_PACKET\n",stderr);return 2; }
        NSDictionary *display=QANativeConsentDisplay(packet,locale,&error);
        NSString *decision=@"cancelled";
        @try { decision=QAPresentConsent(packet,display,theme); }
        @catch(NSException *exception) { fputs("PRESENTATION_FAILED\n",stderr);return 3; }
        NSData *response=QANativeConsentResponse(packet,decision,&error);
        if(!response) { fputs("RESPONSE_FAILED\n",stderr);return 3; }
        const uint8_t *bytes=response.bytes; NSUInteger offset=0;
        while(offset<response.length) {
            ssize_t n=write(STDOUT_FILENO,bytes+offset,response.length-offset);
            if(n<0&&errno==EINTR)continue;
            if(n<=0) { fputs("OUTPUT_FAILED\n",stderr);return 3; }
            offset+=(NSUInteger)n;
        }
        return 0;
    }
}
