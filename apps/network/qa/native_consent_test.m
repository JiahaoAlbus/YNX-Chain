#import "native_consent.h"
#import <stdio.h>
#import <stdlib.h>

static NSUInteger checks=0;
static void check(BOOL pass, const char *name) {
    checks++; if(!pass) { fprintf(stderr,"FAIL %s\n",name);exit(1); }
}
static NSData *encode(NSDictionary *object) { return [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:NULL]; }
static NSDate *now(void) { return [NSDate dateWithTimeIntervalSince1970:1793534400]; }
static NSMutableDictionary *fields(void) {
    return [@{@"version":QANativeConsentVersion,@"requestId":[@"a" stringByPaddingToLength:48 withString:@"a" startingAtIndex:0],
      @"payloadSHA256":[@"b" stringByPaddingToLength:64 withString:@"b" startingAtIndex:0],@"action":@"start",@"nodeId":@"ordinary-node",
      @"artifactSHA256":[@"c" stringByPaddingToLength:64 withString:@"c" startingAtIndex:0],@"generation":@"18446744073709551615",
      @"mode":@"production",@"expiresAtUTC":@"2026-11-01T12:00:30Z"} mutableCopy];
}
static QANativeConsentPacket *parse(NSDictionary *object) { return QANativeConsentParse(encode(object),now(),NULL); }
static void parseTests(void) {
    QANativeConsentPacket *packet=parse(fields()); check(packet!=nil,"valid fixed packet");
    check([packet.fields isEqualToDictionary:fields()],"all values preserved exactly");
    NSMutableDictionary *input=fields(); packet=parse(input); input[@"action"]=@"stop";
    check([packet.fields[@"action"] isEqualToString:@"start"],"packet does not retain mutable input");
    for(NSString *action in @[@"install",@"start",@"stop"]) {
        NSMutableDictionary *f=fields();f[@"action"]=action;check(parse(f)!=nil,"all three fixed actions");
    }
    for(NSString *mode in @[@"production",@"isolated-lifecycle-fixture"]) {
        NSMutableDictionary *f=fields();f[@"mode"]=mode;check(parse(f)!=nil,"production and fixture modes");
    }
    for(NSString *key in fields()) {
        NSMutableDictionary *f=fields();[f removeObjectForKey:key];check(parse(f)==nil,"every field required");
        for(id value in @[@YES,@NO,@0,@1,@{},@[],NSNull.null]) {
            f=fields();f[key]=value;check(parse(f)==nil,"every field must be string, bool never approval");
        }
    }
    NSArray *mutations=@[
      @[@"version",@"YNX-NETWORK-NATIVE-CONSENT/v2"],@[@"requestId",[@"" stringByPaddingToLength:48 withString:@"A" startingAtIndex:0]],
      @[@"requestId",@"short"],@[@"payloadSHA256",[@"" stringByPaddingToLength:64 withString:@"g" startingAtIndex:0]],
      @[@"payloadSHA256",[@"" stringByPaddingToLength:64 withString:@"B" startingAtIndex:0]],@[@"artifactSHA256",@"0x123"],
      @[@"action",@"validator-start"],@[@"action",@"Start"],@[@"action",@"start\n"],@[@"nodeId",@"validator"],
      @[@"nodeId",@"../ordinary-node"],@[@"mode",@"developer"],@[@"mode",@"production "],
      @[@"generation",@"01"],@[@"generation",@"-1"],@[@"generation",@"+1"],@[@"generation",@"1e3"],
      @[@"generation",@"1.0"],@[@"generation",@"18446744073709551616"],@[@"generation",@"１２"],
      @[@"expiresAtUTC",@"2026-11-01T12:00:00Z"],@[@"expiresAtUTC",@"2026-11-01T11:59:59Z"],
      @[@"expiresAtUTC",@"2026-11-01T12:01:01Z"],@[@"expiresAtUTC",@"2026-11-01T12:00:30.000Z"],
      @[@"expiresAtUTC",@"2026-11-01T12:00:30+00:00"],@[@"expiresAtUTC",@"2026-02-30T12:00:30Z"],
      @[@"expiresAtUTC",@"2026-11-01T24:00:30Z"],@[@"expiresAtUTC",@"not a date"]
    ];
    for(NSArray *change in mutations) { NSMutableDictionary *f=fields();f[change[0]]=change[1];check(parse(f)==nil,"malformed intent or expiry rejected"); }
    for(NSString *g in @[@"0",@"1",@"9007199254740993",@"18446744073709551615"]) {
        NSMutableDictionary *f=fields();f[@"generation"]=g;check([parse(f).fields[@"generation"]isEqualToString:g],"canonical decimal retained without rounding");
    }
    NSMutableDictionary *f=fields();f[@"expiresAtUTC"]=@"2026-11-01T12:01:00Z";check(parse(f)!=nil,"exact sixty second expiry allowed");
    for(NSString *key in @[@"title",@"text",@"url",@"path",@"command",@"allow",@"approved",@"Authority",@"RequestId"]) {
        f=fields();f[key]=@"caller value";check(parse(f)==nil,"unknown or alias fields rejected");
    }
    NSString *valid=[[NSString alloc]initWithData:encode(fields()) encoding:NSUTF8StringEncoding];
    NSArray *raw=@[
      @"", @"{}", @"[]", @"true", [valid stringByAppendingString:@"{}"],[valid stringByAppendingString:@"x"],
      [@"{\"version\":\"forged\"," stringByAppendingString:[valid substringFromIndex:1]],
      [valid stringByReplacingOccurrencesOfString:@"\"version\"" withString:@"\"vers\\u0069on\""],
      [valid stringByReplacingOccurrencesOfString:@"ordinary-node" withString:@"ordinary\\u002dnode"],
      [valid stringByReplacingOccurrencesOfString:@"\"production\"" withString:@"false"],
      [valid stringByReplacingOccurrencesOfString:@"\"production\"" withString:@"null"],
      [@"\ufeff" stringByAppendingString:valid], [valid stringByReplacingOccurrencesOfString:@"start" withString:@"sta\u202ert"],
      [valid stringByReplacingOccurrencesOfString:@"start" withString:@"sta\0rt"]
    ];
    for(NSString *text in raw)check(QANativeConsentParse([text dataUsingEncoding:NSUTF8StringEncoding],now(),NULL)==nil,"strict flat canonical JSON rejection");
    NSData *invalidUTF8=[NSData dataWithBytes:(uint8_t[]){'{','"',0xff,'"',':','"','x','"','}'} length:9];
    check(QANativeConsentParse(invalidUTF8,now(),NULL)==nil,"invalid UTF8 rejected");
    NSMutableData *oversize=[[valid dataUsingEncoding:NSUTF8StringEncoding]mutableCopy];[oversize increaseLengthBy:16385];
    check(QANativeConsentParse(oversize,now(),NULL)==nil,"oversized packet rejected");
    NSMutableData *boundary=[[valid dataUsingEncoding:NSUTF8StringEncoding]mutableCopy];
    while(boundary.length<16384)[boundary appendBytes:" " length:1];
    check(QANativeConsentParse(boundary,now(),NULL)!=nil,"bounded exact 16KiB JSON whitespace accepted");
    [boundary appendBytes:" " length:1];check(QANativeConsentParse(boundary,now(),NULL)==nil,"16KiB plus one rejected");
    check(QANativeConsentParse([[NSString stringWithFormat:@" \n%@\t\r",valid]dataUsingEncoding:NSUTF8StringEncoding],now(),NULL)!=nil,"JSON whitespace accepted");
}
static void displayTests(void) {
    QANativeConsentPacket *packet=parse(fields());
    NSArray *locales=@[@"en",@"zh-Hans",@"zh-Hant",@"ja",@"ko",@"es",@"fr",@"de",@"pt",@"ru",@"ar",@"id"];
    NSMutableSet *warnings=[NSMutableSet new];
    NSString *expected=nil;
    for(NSString *locale in locales) {
        NSDictionary *display=QANativeConsentDisplay(packet,locale,NULL);
        check(display.count==8,"fixed display shape");
        for(NSString *key in @[@"title",@"warning",@"explanation",@"cancel",@"approve",@"details",@"locale",@"direction"])
            check([display[key]isKindOfClass:NSString.class]&&[display[key]length]>0,"all visible text supplied in every locale");
        check(![display[@"cancel"]isEqualToString:display[@"approve"]],"cancel and approve distinct");
        check([display[@"warning"]containsString:@"Root"],"scope warning retains Root restriction");
        [warnings addObject:display[@"warning"]];
        if(!expected)expected=display[@"details"];
        check([display[@"details"]isEqualToString:expected],"locale never mutates intent bytes or labels");
        for(NSString *key in packet.fields) {
            NSString *line=[NSString stringWithFormat:@"%@: %@",key,packet.fields[key]];
            check([[display[@"details"]componentsSeparatedByString:@"\n"]containsObject:line],"each exact field displayed without ellipsis");
        }
        check([display[@"direction"]isEqualToString:[locale isEqualToString:@"ar"]?@"rtl":@"ltr"],"Arabic layout intention, raw fields unchanged");
        check([display[@"locale"]isEqualToString:locale],"locale bound in display");
    }
    check(warnings.count==12,"all twelve warnings explicitly localized");
    check([QANativeConsentDisplay(packet,@"zh-Hans",NULL)[@"warning"]isEqualToString:@"仅此普通节点操作；不授予验证者/签名器/资金/Root权力"],"exact fixed Chinese boundary");
    for(NSString *locale in @[@"en-US",@"zh-CN",@"AR",@"ar-SA",@"",@"../en"]) {
        check(QANativeConsentDisplay(packet,locale,NULL)==nil,"invalid explicit display locale rejected");
        check(QANativeConsentResolveLocale(locale,@[@"en"],NULL)==nil,"explicit locale whitelist strict");
    }
    for(NSString *locale in locales)check([QANativeConsentResolveLocale(locale,@[],NULL)isEqualToString:locale],"all explicit locales allowed");
    check([QANativeConsentResolveLocale(nil,@[@"ar-SA"],NULL)isEqualToString:@"ar"],"OS preferred Arabic matched");
    check([QANativeConsentResolveLocale(nil,@[@"zh-TW"],NULL)isEqualToString:@"zh-Hant"],"OS traditional matched");
    check([QANativeConsentResolveLocale(nil,@[@"zh-Hans-CN"],NULL)isEqualToString:@"zh-Hans"],"OS simplified matched");
    check([QANativeConsentResolveLocale(nil,@[@"unknown",@"fr-CA"],NULL)isEqualToString:@"fr"],"OS supported fallback matched");
    check([QANativeConsentResolveLocale(nil,@[@"unknown"],NULL)isEqualToString:@"zh-Hans"],"unsupported preferences default");
    check([QANativeConsentResolveTheme(nil,NULL)isEqualToString:@"system"],"theme defaults to system");
    for(NSString *theme in @[@"light",@"dark",@"system"])check([QANativeConsentResolveTheme(theme,NULL)isEqualToString:theme],"fixed themes accepted");
    for(NSString *theme in @[@"Dark",@"",@"file://theme",@"blue"])check(QANativeConsentResolveTheme(theme,NULL)==nil,"arbitrary themes rejected");
}
static void responseTests(void) {
    QANativeConsentPacket *packet=parse(fields());
    for(NSString *decision in @[@"approved",@"cancelled"]) {
        NSData *data=QANativeConsentResponse(packet,decision,NULL);
        NSDictionary *out=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        check(out.count==4,"only four response fields");
        check([out[@"version"]isEqualToString:QANativeConsentVersion],"response fixed protocol");
        check([out[@"requestId"]isEqualToString:packet.fields[@"requestId"]],"response request bound");
        check([out[@"payloadSHA256"]isEqualToString:packet.fields[@"payloadSHA256"]],"response hash bound");
        check([out[@"decision"]isEqualToString:decision],"decision exact enum");
        for(NSString *key in @[@"signature",@"humanVerified",@"publisher",@"root",@"walletApproval"])check(!out[key],"no signature or authority claim");
    }
    for(id decision in @[@"true",@"yes",@"Approved",@YES,@1,NSNull.null])check(QANativeConsentResponse(packet,decision,NULL)==nil,"boolean and arbitrary values never approval");
    __block BOOL called=NO;
    NSData *response=QANativeConsentWithTestPresenter(encode(fields()),now(),@"ar",^NSString *(QANativeConsentPacket *shown,NSDictionary *display) {
        called=YES;check([shown.fields isEqualToDictionary:fields()],"injected presenter sees exact fields");
        check([display[@"direction"]isEqualToString:@"rtl"],"injected Arabic display metadata");
        return @"approved";
    },NULL);
    check(called&&response!=nil,"test presenter contract only, not actual human evidence");
    called=NO;
    NSMutableDictionary *f=fields();f[@"expiresAtUTC"]=@"2026-11-01T11:59:59Z";
    check(QANativeConsentWithTestPresenter(encode(f),now(),@"en",^NSString *(QANativeConsentPacket *p,NSDictionary *d){(void)p;(void)d;called=YES;return @"approved";},NULL)==nil&&!called,"expired packet never reaches presenter");
    response=QANativeConsentWithTestPresenter(encode(fields()),now(),@"en",^NSString *(QANativeConsentPacket *p,NSDictionary *d){(void)p;(void)d;return nil;},NULL);
    NSDictionary *out=[NSJSONSerialization JSONObjectWithData:response options:0 error:NULL];
    check([out[@"decision"]isEqualToString:@"cancelled"],"close/no explicit decision is cancellation");
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        if(argc==2&&strcmp(argv[1],"--invalid-stdin")==0)return QANativeConsentMain();
        parseTests();displayTests();responseTests();
        printf("PASS %lu native consent no-GUI contract checks; presenter injection is not actual human/GUI evidence\n",(unsigned long)checks);
        return 0;
    }
}
