#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 2;
        NSURL *url = [NSURL fileURLWithPath:@(argv[1])];
        NSBundle *bundle = [NSBundle bundleWithURL:url];
        NSString *identifier = @"com.promptenhance.inputmethod.PromptEnhance";
        if (![bundle.bundleIdentifier isEqualToString:identifier]) return 2;
        OSStatus result = TISRegisterInputSource((__bridge CFURLRef)url);
        if (result != noErr) {
            fprintf(stderr, "Input source registration failed (%d). Add it in Keyboard settings.\n", (int)result);
            return 1;
        }
        NSDictionary *filter = @{(__bridge NSString *)kTISPropertyInputSourceID: identifier};
        CFArrayRef sources = TISCreateInputSourceList((__bridge CFDictionaryRef)filter, true);
        BOOL enabled = NO;
        for (id source in (__bridge NSArray *)sources) {
            if (TISEnableInputSource((__bridge TISInputSourceRef)source) == noErr) enabled = YES;
        }
        if (sources) CFRelease(sources);
        // Selection is deliberately manual: installation must not switch the user's keyboard.
        puts(enabled ? "Registered and enabled. Choose Prompt Enhance in the macOS input menu."
                     : "Registered. Add Prompt Enhance in System Settings > Keyboard > Text Input > Edit.");
        return 0;
    }
}
