#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const QANativeConsentVersion;

// A bounded display packet from the fixed helper child. This is neither a
// signature nor a claim about human identity or production publisher authority.
@interface QANativeConsentPacket : NSObject
@property(nonatomic, copy, readonly) NSDictionary<NSString *, NSString *> *fields;
@property(nonatomic, copy, readonly) NSDate *expiresAt;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

FOUNDATION_EXPORT QANativeConsentPacket *_Nullable QANativeConsentParse(NSData *data, NSDate *now, NSError **error);
FOUNDATION_EXPORT NSString *_Nullable QANativeConsentResolveLocale(NSString *_Nullable explicitLocale, NSArray<NSString *> *preferredLanguages, NSError **error);
FOUNDATION_EXPORT NSString *_Nullable QANativeConsentResolveTheme(NSString *_Nullable explicitTheme, NSError **error);
// The dictionary contains only fixed localized strings plus an exact LTR
// field dump: title, warning, explanation, cancel, approve, details, locale,
// direction. No value grants an OS, Wallet, asset, signer or Root capability.
FOUNDATION_EXPORT NSDictionary<NSString *, NSString *> *_Nullable QANativeConsentDisplay(QANativeConsentPacket *packet, NSString *locale, NSError **error);
FOUNDATION_EXPORT NSData *_Nullable QANativeConsentResponse(QANativeConsentPacket *packet, NSString *decision, NSError **error);

// Call only from the launcher's fixed --native-consent main-thread branch.
// Reads bounded stdin through EOF before showing a real Cocoa NSAlert.
FOUNDATION_EXPORT int QANativeConsentMain(void);

#if defined(QA_NATIVE_CONSENT_TESTING)
// Linked only in the no-GUI contract test. Production main has no injectable
// presenter, JS bridge, JSON allow field, test mode or environment bypass.
typedef NSString *_Nullable (^QANativeConsentTestPresenter)(QANativeConsentPacket *, NSDictionary<NSString *, NSString *> *);
FOUNDATION_EXPORT NSData *_Nullable QANativeConsentWithTestPresenter(NSData *data, NSDate *now, NSString *locale, QANativeConsentTestPresenter presenter, NSError **error);
#endif

NS_ASSUME_NONNULL_END
