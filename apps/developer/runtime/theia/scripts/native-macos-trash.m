// YNX native replacement for trash@7.2.0's macOS executable. MIT.
// The existing JavaScript caller resolves paths and invokes at most 1000 items.
#import <Foundation/Foundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2 || argc > 1001) {
            fputs("macos-trash requires 1 to 1000 absolute paths\n", stderr);
            return 64;
        }
        int status = 0;
        const char *qaFlag = getenv("YNX_NATIVE_TRASH_QA_RECEIPT");
        // Observability only: ordinary callers remain silent, and even an
        // inherited QA flag cannot produce 1000 success receipts per chunk.
        BOOL emitReceipt = argc == 2 && qaFlag && strcmp(qaFlag, "1") == 0;
        for (int i = 1; i < argc; i++) {
            @autoreleasepool {
                if (strnlen(argv[i], 4097) > 4096) {
                    fputs("macos-trash path exceeds 4096 bytes\n", stderr);
                    status = 1; continue;
                }
                NSString *path = [NSString stringWithUTF8String:argv[i]];
                if (!path || ![path isAbsolutePath]) {
                    fputs("macos-trash requires an absolute UTF-8 path\n", stderr);
                    status = 1; continue;
                }
                NSError *error = nil;
                NSURL *result = nil;
                BOOL moved = [[NSFileManager defaultManager]
                    trashItemAtURL:[NSURL fileURLWithPath:path]
                    resultingItemURL:&result error:&error];
                if (!moved || !result.isFileURL) {
                    fprintf(stderr, "macos-trash: %s: %s\n", argv[i],
                        (error.localizedDescription ?: @"No recoverable trash URL returned").UTF8String);
                    status = 1; continue;
                }
                if (!emitReceipt) continue;
                // One explicitly requested, bounded exact-object QA receipt.
                NSData *receipt = [NSJSONSerialization dataWithJSONObject:
                    @{ @"source": path, @"resultingPath": result.path }
                    options:0 error:&error];
                if (!receipt || receipt.length > 65536 || fwrite(receipt.bytes, 1, receipt.length, stdout) != receipt.length ||
                    fputc('\n', stdout) == EOF) { status = 1; }
            }
        }
        return status;
    }
}
