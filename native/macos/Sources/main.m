#import <AppKit/AppKit.h>
#import <InputMethodKit/InputMethodKit.h>
#import "PEAccessibilityClient.h"

static IMKServer *inputServer;
static NSString *const PEQueryAccessibility = @"com.promptenhance.inputmethod.PromptEnhance.queryAccessibility";
static NSString *const PERequestAccessibility = @"com.promptenhance.inputmethod.PromptEnhance.requestAccessibility";
static NSString *const PESetupSender = @"com.promptenhance.setup";

// Setup must ask the input helper about its own permission. Checking from
// Setup would report the permission of a different application.
static void PEWriteAccessibilityStatus(void) {
    if (![NSBundle.mainBundle.bundleIdentifier isEqualToString:@"com.promptenhance.inputmethod.PromptEnhance"]) return;
    NSFileManager *files = NSFileManager.defaultManager;
    NSURL *directory = [NSURL fileURLWithPath:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Logs/Prompt Enhance"] isDirectory:YES];
    NSError *error = nil;
    if (![files createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:&error]) return;
    [files setAttributes:@{NSFilePosixPermissions: @0700} ofItemAtPath:directory.path error:nil];
    NSDictionary *status = @{
        @"accessibilityTrusted": @([PEAccessibilityClient isTrusted]),
        @"buildVersion": [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown",
        @"updatedAt": @(NSDate.date.timeIntervalSince1970),
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:status options:0 error:nil];
    NSURL *target = [directory URLByAppendingPathComponent:@"accessibility-status.json"];
    if (data && [data writeToURL:target options:NSDataWritingAtomic error:nil]) {
        [files setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:target.path error:nil];
    }
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSBundle *bundle = NSBundle.mainBundle;
        NSDistributedNotificationCenter *notifications = NSDistributedNotificationCenter.defaultCenter;
        id queryObserver = [notifications addObserverForName:PEQueryAccessibility object:PESetupSender queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) {
            PEWriteAccessibilityStatus();
        }];
        id requestObserver = [notifications addObserverForName:PERequestAccessibility object:PESetupSender queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) {
            // Only Setup's explicit Allow Accessibility action sends this.
            // This asks macOS to show its prompt; it never grants permission.
            [PEAccessibilityClient requestAccessibilityPermission];
            PEWriteAccessibilityStatus();
        }];
        PEWriteAccessibilityStatus();
        inputServer = [[IMKServer alloc]
            initWithName:[bundle objectForInfoDictionaryKey:@"InputMethodConnectionName"]
            bundleIdentifier:bundle.bundleIdentifier];
        if (!inputServer) return 1;
        [app run];
        [notifications removeObserver:queryObserver];
        [notifications removeObserver:requestObserver];
        inputServer = nil;
    }
    return 0;
}
