#import "BrowserOriginalPageSourceRoot.h"
#include <cstdio>
#include <cstdlib>

static unsigned checks = 0;
static void require(bool value, const char *label) {
    if (!value) { std::fprintf(stderr,"BRIDGE_DELTA_FAIL:%s\n",label); std::exit(1); }
    ++checks;
}
int main() {
    @autoreleasepool {
        // Calls the actual original r3 zero-input constructor. Production-empty
        // reviewed rows return NOT_SUPPLIED and a genuine partial Source owner.
        // No PUBLIC Source/current implementation or injected ABI is used here.
        BrowserOriginalPageSourceRoot *held = [BrowserOriginalPageSourceRoot acquireOriginal];
        require(held != nil,"adopt-original-holder-before-error");
        require(held.acquisitionStatus == 71 && held.firstStatus == 71,"original-Root0-error-preserved");
        require(held.ownsOriginalRoot,"actual-nonnull-partial-owned");
        require([held requireCurrent] == 71,"failed-acquisition-not-current");
        NSDictionary *sentinel = @{ @"PUBLIC_OUTPUT_SENTINEL": @"unchanged" };
        NSDictionary *context = sentinel;
        require([held copyOriginalContext:&context] == 71 && context == sentinel,"failed-original-context-no-publication");
        uint64_t deadline = 0xfeedbeef;
        require([held copyOriginalReadDeadline:&deadline] == 71 && deadline == 0xfeedbeef,"failed-original-deadline-no-renewal-or-write");
        require([held retireOriginal] == 71 && held.ownsOriginalRoot,"retire-retains-failed-partial");
        BrowserOriginalPageRootDrain drain = [held closeOriginal];
        require(drain.firstStatus == 71 && drain.completed == 1 && drain.destroyed == 1 && !held.ownsOriginalRoot,
                "actual-original-close-and-destroy-independent-from-first-error");
        require([held requireCurrent] == 71,"no-current-revival-after-physical-cleanup");
        BrowserOriginalPageRootDrain again = [held closeOriginal];
        require(again.firstStatus == 71 && again.completed == 1 && again.destroyed == 1 && !held.ownsOriginalRoot,
                "idempotent-closed-holder-no-reacquire");
        held = nil;
        std::printf("{\"schema\":\"P05_ORIGINAL_AUTH_ROOT_BRIDGE_DELTA_V1\",\"checks\":%u,\"actualOriginalRoot0\":true,\"actualPartialAdoptedAndDestroyed\":true,\"SourceAdmission\":false,\"RootAdmission\":false,\"normalEndpointReceiver\":\"NOT_SUPPLIED\",\"GUIOrNetworkUsed\":false}\n",checks);
    }
}
