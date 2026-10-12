#define main YNXDesktopProductionMain
#include "../../desktop/macos/main.m"
#undef main

int main(void) {
    @autoreleasepool {
        for(NSString *command in @[@"selectAll",@"undo",@"redo",@"cut",@"copy",@"paste"])
            if(![NSStringFromSelector(YNXEditSelector(command)) isEqual:[command stringByAppendingString:@":"]])return 1;
        if(YNXEditSelector(@"unknown")!=NULL)return 2;
        if(!YNXShouldForwardNativeEdit(@"native",nil,YES,YES))return 3;
        for(id route in @[@"handled",@"blocked",@"",@YES,[NSNull null]])
            if(YNXShouldForwardNativeEdit(route,nil,YES,YES))return 4;
        if(YNXShouldForwardNativeEdit(@"native",nil,NO,YES))return 5;
        if(YNXShouldForwardNativeEdit(@"native",nil,YES,NO))return 6;
        if(YNXShouldForwardNativeEdit(@"native",[NSError errorWithDomain:@"Test" code:1 userInfo:nil],YES,YES))return 7;
        puts("Native Edit selectors and no-fallback forwarding gates passed");
        return 0;
    }
}
