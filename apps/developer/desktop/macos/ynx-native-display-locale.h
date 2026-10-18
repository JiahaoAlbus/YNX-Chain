#pragma once
#import <Foundation/Foundation.h>

// Preserve standard language-pack identifiers across native windows/ports.
// A locale is bounded DATA only: never a path, command argument or permission.
static BOOL YNXLocalLocaleIdentifier(id value) {
    if(![value isKindOfClass:NSString.class]||[value length]<2||[value length]>63)return NO;
    NSArray<NSString *> *parts=[value componentsSeparatedByString:@"-"];
    NSString *language=parts.firstObject;
    if(language.length<2||language.length>8)return NO;
    NSCharacterSet *letters=[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"];
    NSCharacterSet *alphanumeric=[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"];
    if([language rangeOfCharacterFromSet:letters.invertedSet].location!=NSNotFound)return NO;
    for(NSString *part in parts)if(part.length<1||part.length>8||[part rangeOfCharacterFromSet:alphanumeric.invertedSet].location!=NSNotFound)return NO;
    return YES;
}
static BOOL YNXLocalLocalePayload(id value) {
    return [value isKindOfClass:NSDictionary.class]&&[value count]==2&&[value[@"action"]isEqual:@"locale"]&&YNXLocalLocaleIdentifier(value[@"locale"]);
}
static NSString *YNXLocalStoredLocale(id value) {return YNXLocalLocaleIdentifier(value)?value:@"en";}
