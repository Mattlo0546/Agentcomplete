#import <AppKit/AppKit.h>
#import <InputMethodKit/InputMethodKit.h>

static IMKServer *inputServer;

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSBundle *bundle = NSBundle.mainBundle;
        inputServer = [[IMKServer alloc]
            initWithName:[bundle objectForInfoDictionaryKey:@"InputMethodConnectionName"]
            bundleIdentifier:bundle.bundleIdentifier];
        if (!inputServer) return 1;
        [app run];
        inputServer = nil;
    }
    return 0;
}
