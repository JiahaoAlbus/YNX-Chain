#pragma once
#import <Foundation/Foundation.h>
// Frames from the one actual child stderr pipe. A frame is transport only;
// the controller and protected device independently require live read approval.
@interface YNXServiceReadChannel : NSObject
- (instancetype)initWithLog:(NSFileHandle *)log receive:(void(^)(NSDictionary *))receive;
- (void)acceptData:(NSData *)data;
- (void)close;
@end
@implementation YNXServiceReadChannel {
 NSMutableData *_buffer;NSFileHandle *_log;void(^_receive)(NSDictionary *);BOOL _closed,_ordinaryContinuation,_discardControl;
}
- (instancetype)initWithLog:(NSFileHandle *)log receive:(void(^)(NSDictionary *))receive {
 if((self=[super init])){_log=log;_receive=[receive copy];_buffer=[NSMutableData new];}return self;
}
- (void)acceptData:(NSData *)data {
 @synchronized(self){
  if(_closed||!data.length)return;
  const unsigned char *bytes=data.bytes;
  for(NSUInteger i=0;i<data.length;i++){
   if(_discardControl){if(bytes[i]==10)_discardControl=NO;continue;}
   [_buffer appendBytes:bytes+i length:1];
   if(_ordinaryContinuation){
    if(_buffer.length>=32768||bytes[i]==10){[_log writeData:_buffer error:nil];_buffer.length=0;}
    if(bytes[i]==10)_ordinaryContinuation=NO;continue;
   }
   if(_buffer.length>32768){
    NSData *prefix=[@"@YNX_NATIVE_SERVICE_READ_V1:" dataUsingEncoding:NSUTF8StringEncoding];
    BOOL control=[[_buffer subdataWithRange:NSMakeRange(0,prefix.length)]isEqual:prefix];
    if(control){_discardControl=bytes[i]!=10;}else{[_log writeData:_buffer error:nil];_ordinaryContinuation=bytes[i]!=10;}
    _buffer.length=0;continue;
   }
   if(bytes[i]!=10)continue;
   NSData *line=[_buffer copy];_buffer.length=0;
   NSData *prefix=[@"@YNX_NATIVE_SERVICE_READ_V1:" dataUsingEncoding:NSUTF8StringEncoding];
   if(line.length>=prefix.length&&[[line subdataWithRange:NSMakeRange(0,prefix.length)]isEqual:prefix]){
    // Never persist recognized control bytes (including malformed frames).
    if(line.length>32768)continue;
    NSData *raw=[line subdataWithRange:NSMakeRange(prefix.length,line.length-prefix.length-1)];
    id value=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
    if([value isKindOfClass:NSDictionary.class]&&_receive)_receive(value);
   }else{[_log writeData:line error:nil];}
  }
 }
}
- (void)close {@synchronized(self){if(_closed)return;_closed=YES;NSData *prefix=[@"@YNX_NATIVE_SERVICE_READ_V1:" dataUsingEncoding:NSUTF8StringEncoding];BOOL sensitive=_buffer.length>=prefix.length&&[[_buffer subdataWithRange:NSMakeRange(0,prefix.length)]isEqual:prefix];if(_buffer.length&&!sensitive)[_log writeData:_buffer error:nil];_buffer.length=0;_receive=nil;}}
@end
