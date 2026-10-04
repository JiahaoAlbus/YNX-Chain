#import <Cocoa/Cocoa.h>
#import <CoreServices/CoreServices.h>

static BOOL WritePNG(NSString *path, NSInteger width, NSInteger height, void (^draw)(void)) {
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:width pixelsHigh:height bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    if (!bitmap) return NO;
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap]];
    [[NSColor clearColor] setFill]; NSRectFill(NSMakeRect(0, 0, width, height));
    draw();
    [NSGraphicsContext restoreGraphicsState];
    return [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path options:NSDataWritingWithoutOverwriting error:NULL];
}
static void Text(NSString *text, NSRect rect, CGFloat size, NSColor *color, NSFontWeight weight) {
    NSMutableParagraphStyle *style = [NSMutableParagraphStyle new]; style.alignment = NSTextAlignmentCenter;
    [text drawInRect:rect withAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:size weight:weight], NSForegroundColorAttributeName:color, NSParagraphStyleAttributeName:style}];
}
int main(int argc, const char *argv[]) { @autoreleasepool {
    if (argc == 5 && strcmp(argv[1], "assets") == 0) {
        NSImage *icon = [[NSImage alloc] initWithContentsOfFile:@(argv[2])], *logo = [[NSImage alloc] initWithContentsOfFile:@(argv[3])];
        NSString *output = @(argv[4]), *iconset = [output stringByAppendingPathComponent:@"YNXDeveloper.iconset"];
        if (!icon || !logo || icon.size.width != icon.size.height || logo.size.width <= 0 || ![[NSFileManager defaultManager] createDirectoryAtPath:iconset withIntermediateDirectories:NO attributes:nil error:NULL]) return 2;
        for (NSNumber *logical in @[@16,@32,@128,@256,@512]) for (NSInteger scale = 1; scale <= 2; scale++) {
            NSInteger pixels = logical.integerValue * scale;
            NSString *name = [NSString stringWithFormat:@"icon_%@x%@%@.png", logical, logical, scale == 2 ? @"@2x" : @""];
            if (!WritePNG([iconset stringByAppendingPathComponent:name], pixels, pixels, ^{ [icon drawInRect:NSMakeRect(0, 0, pixels, pixels) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1 respectFlipped:NO hints:@{NSImageHintInterpolation:@(NSImageInterpolationHigh)}]; })) return 3;
        }
        if (!WritePNG([output stringByAppendingPathComponent:@"installer-background.png"], 780, 520, ^{
            [[NSColor colorWithSRGBRed:17/255.0 green:18/255.0 blue:20/255.0 alpha:1] setFill]; NSRectFill(NSMakeRect(0, 0, 780, 520));
            CGFloat w = 170, h = w * logo.size.height / logo.size.width;
            [logo drawInRect:NSMakeRect((780-w)/2, 390, w, h) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:NO hints:@{NSImageHintInterpolation:@(NSImageInterpolationHigh)}];
            NSColor *text = [NSColor colorWithSRGBRed:232/255.0 green:236/255.0 blue:245/255.0 alpha:1];
            Text(@"YNX Developer", NSMakeRect(60, 344, 660, 40), 28, text, NSFontWeightSemibold);
            Text(@"Drag YNX Developer into Applications", NSMakeRect(60, 308, 660, 26), 17, text, NSFontWeightRegular);
            Text(@"将 YNX Developer 拖入 Applications 文件夹", NSMakeRect(60, 279, 660, 26), 15, text, NSFontWeightRegular);
            NSColor *accent = [NSColor colorWithSRGBRed:115/255.0 green:153/255.0 blue:1 alpha:1];
            NSBezierPath *arrow = [NSBezierPath bezierPath]; arrow.lineWidth = 3; [accent setStroke];
            [arrow moveToPoint:NSMakePoint(360, 184)]; [arrow lineToPoint:NSMakePoint(420, 184)]; [arrow moveToPoint:NSMakePoint(406, 197)]; [arrow lineToPoint:NSMakePoint(420, 184)]; [arrow lineToPoint:NSMakePoint(406, 171)]; [arrow stroke];
            Text(@"Testnet Preview", NSMakeRect(60, 44, 660, 24), 14, text, NSFontWeightRegular);
        })) return 4;
        return 0;
    }
    if (argc == 4 && strcmp(argv[1], "alias") == 0) {
        FSRef ref; AliasHandle alias = NULL;
        if (FSPathMakeRef((const UInt8 *)argv[2], &ref, NULL) != noErr || FSNewAlias(NULL, &ref, &alias) != noErr || !alias) return 5;
        NSData *data = [NSData dataWithBytes:*alias length:GetHandleSize((Handle)alias)]; DisposeHandle((Handle)alias);
        return [data writeToFile:@(argv[3]) options:NSDataWritingWithoutOverwriting error:NULL] ? 0 : 6;
    }
    if (argc == 4 && strcmp(argv[1], "verify-alias") == 0) {
        NSData *data = [NSData dataWithContentsOfFile:@(argv[2])]; if (!data || data.length < 150 || data.length > 65536) return 7;
        AliasHandle alias = (AliasHandle)NewHandle(data.length); if (!alias) return 8;
        memcpy(*alias, data.bytes, data.length); FSRef target; Boolean changed = false; UInt8 path[PATH_MAX];
        OSStatus result = FSResolveAlias(NULL, alias, &target, &changed); DisposeHandle((Handle)alias);
        if (result != noErr || FSRefMakePath(&target, path, sizeof(path)) != noErr) return 9;
        return [[@(argv[3]) stringByResolvingSymlinksInPath] isEqualToString:[[@((const char *)path) stringByStandardizingPath] stringByResolvingSymlinksInPath]] ? 0 : 10;
    }
    fprintf(stderr, "Expected assets ICON LOGO OUTPUT | alias FILE OUTPUT | verify-alias ALIAS FILE\n"); return 1;
} }
