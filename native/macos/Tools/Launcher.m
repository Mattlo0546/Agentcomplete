#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>

static NSString *const PEInputSourceID = @"com.promptenhance.inputmethod.PromptEnhance";
static NSString *const PEInputSourceBundleID = @"com.promptenhance.inputmethod.PromptEnhance";

@interface PEInputSourceStatus : NSObject
@property(nonatomic) BOOL sourceExists;
@property(nonatomic) BOOL enabled;
@property(nonatomic) BOOL selectCapable;
@property(nonatomic) BOOL currentIsOurs;
@property(nonatomic) OSStatus osStatus;
@property(nonatomic, copy) NSString *sourceType;
@property(nonatomic, copy) NSString *sourceCategory;
@property(nonatomic) BOOL installedBundlePresent;
@property(nonatomic) BOOL installedBundleIdentifierMatches;
@property(nonatomic, copy) NSString *installedBundleVersion;
@end

@implementation PEInputSourceStatus
@end

static NSURL *PEInstalledInputMethodURL(void) {
    return [NSURL fileURLWithPath:[NSHomeDirectory()
                                     stringByAppendingPathComponent:@"Library/Input Methods/Prompt Enhance.app"]];
}

static NSURL *PERuntimeStatusURL(void) {
    return [NSURL fileURLWithPath:[NSHomeDirectory()
                                     stringByAppendingPathComponent:@"Library/Logs/Prompt Enhance/native-status.json"]];
}

static NSString *PEBooleanDiagnostic(NSDictionary<NSString *, id> *report, NSString *key) {
    id value = report[key];
    return [value isKindOfClass:NSNumber.class] ? ([value boolValue] ? @"yes" : @"no") : @"unknown";
}

static NSString *PEAccessibilityDiagnostic(NSDictionary<NSString *, id> *report) {
    id value = report[@"accessibilityTrusted"];
    if (![value isKindOfClass:NSNumber.class]) {
        return @"Grant access to Prompt Enhance, then return to Codex.";
    }
    return [value boolValue] ? @"granted" : @"Grant access to Prompt Enhance, then return to Codex.";
}

static NSString *PESafeRuntimeDiagnosticSummary(void) {
    NSData *data = [NSData dataWithContentsOfURL:PERuntimeStatusURL() options:NSDataReadingMappedIfSafe error:nil];
    if (data.length == 0 || data.length > 16384) {
        return @"No input-method diagnostic report is available yet.";
    }
    id decoded = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![decoded isKindOfClass:NSDictionary.class]) {
        return @"The input-method diagnostic report is unavailable.";
    }
    NSDictionary<NSString *, id> *report = decoded;
    NSString *safeError = [report[@"safeError"] isKindOfClass:NSString.class] ? report[@"safeError"] : nil;
    if (safeError.length > 240 || [safeError rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location != NSNotFound) {
        safeError = @"Input method reported an invalid diagnostic error.";
    }
    NSString *errorText = safeError.length ? safeError : @"none";
    return [NSString stringWithFormat:
        @"Input-method report — Accessibility: %@; active: %@; enabled: %@; selected range: %@; document length: %@; caret rect: %@; "
         "draft nonempty: %@; minimum length: %@; selection empty: %@; caret at end: %@; palette visible: %@; on screen: %@; last error: %@",
        PEAccessibilityDiagnostic(report),
        PEBooleanDiagnostic(report, @"active"),
        PEBooleanDiagnostic(report, @"enabled"),
        PEBooleanDiagnostic(report, @"selectedRangeSupported"),
        PEBooleanDiagnostic(report, @"documentLengthSupported"),
        PEBooleanDiagnostic(report, @"caretRectSupported"),
        PEBooleanDiagnostic(report, @"draftNonempty"),
        PEBooleanDiagnostic(report, @"minimumLengthMet"),
        PEBooleanDiagnostic(report, @"selectionEmpty"),
        PEBooleanDiagnostic(report, @"caretAtEnd"),
        PEBooleanDiagnostic(report, @"paletteVisible"),
        PEBooleanDiagnostic(report, @"positionOnScreen"),
        errorText];
}

static BOOL PEBooleanProperty(TISInputSourceRef source, CFStringRef property) {
    const void *value = TISGetInputSourceProperty(source, property);
    return value != NULL && CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(value);
}

static NSString *PEStringProperty(TISInputSourceRef source, CFStringRef property) {
    const void *value = TISGetInputSourceProperty(source, property);
    if (value == NULL || CFGetTypeID(value) != CFStringGetTypeID()) {
        return @"unknown";
    }
    return [(__bridge NSString *)value copy];
}

static TISInputSourceRef PECopyPromptEnhanceSource(void) {
    NSDictionary *filter = @{(__bridge NSString *)kTISPropertyInputSourceID: PEInputSourceID};
    CFArrayRef sources = TISCreateInputSourceList((__bridge CFDictionaryRef)filter, true);
    if (sources == NULL || CFArrayGetCount(sources) != 1) {
        if (sources != NULL) {
            CFRelease(sources);
        }
        return NULL;
    }
    TISInputSourceRef source = (TISInputSourceRef)CFRetain(CFArrayGetValueAtIndex(sources, 0));
    CFRelease(sources);
    return source;
}

static BOOL PESourceHasExpectedBundleID(TISInputSourceRef source) {
    return [PEStringProperty(source, kTISPropertyBundleID) isEqualToString:PEInputSourceBundleID];
}

static BOOL PECurrentSourceIsPromptEnhance(void) {
    TISInputSourceRef current = TISCopyCurrentKeyboardInputSource();
    if (current == NULL) {
        return NO;
    }
    BOOL isOurs = [PEStringProperty(current, kTISPropertyInputSourceID) isEqualToString:PEInputSourceID];
    CFRelease(current);
    return isOurs;
}

static PEInputSourceStatus *PEReadStatus(OSStatus operationStatus) {
    PEInputSourceStatus *status = [PEInputSourceStatus new];
    NSURL *bundleURL = PEInstalledInputMethodURL();
    status.installedBundlePresent = [[NSFileManager defaultManager] fileExistsAtPath:bundleURL.path];
    NSBundle *bundle = status.installedBundlePresent ? [NSBundle bundleWithURL:bundleURL] : nil;
    status.installedBundleIdentifierMatches = [bundle.bundleIdentifier isEqualToString:PEInputSourceBundleID];
    status.installedBundleVersion = status.installedBundleIdentifierMatches
        ? ([bundle objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown")
        : @"unavailable";

    TISInputSourceRef source = PECopyPromptEnhanceSource();
    status.sourceExists = source != NULL;
    status.enabled = source != NULL && PEBooleanProperty(source, kTISPropertyInputSourceIsEnabled);
    status.selectCapable = source != NULL && PEBooleanProperty(source, kTISPropertyInputSourceIsSelectCapable);
    status.sourceType = source != NULL ? PEStringProperty(source, kTISPropertyInputSourceType) : @"unavailable";
    status.sourceCategory = source != NULL ? PEStringProperty(source, kTISPropertyInputSourceCategory) : @"unavailable";
    status.currentIsOurs = PECurrentSourceIsPromptEnhance();
    status.osStatus = operationStatus == noErr && source == NULL ? fnfErr : operationStatus;
    if (source != NULL) {
        CFRelease(source);
    }
    return status;
}

static NSDictionary<NSString *, id> *PEStatusDictionary(PEInputSourceStatus *status) {
    return @{
        @"sourceExists": @(status.sourceExists),
        @"enabled": @(status.enabled),
        @"selectCapable": @(status.selectCapable),
        @"currentIsOurs": @(status.currentIsOurs),
        @"sourceType": status.sourceType,
        @"sourceCategory": status.sourceCategory,
        @"osStatus": @(status.osStatus),
        @"installedBundlePresent": @(status.installedBundlePresent),
        @"installedBundleIdentifierMatches": @(status.installedBundleIdentifierMatches),
        @"installedBundleVersion": status.installedBundleVersion,
    };
}

static void PEWriteStatusReport(PEInputSourceStatus *status) {
    NSURL *directory = [[NSURL fileURLWithPath:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Logs"]]
                         URLByAppendingPathComponent:@"Prompt Enhance" isDirectory:YES];
    NSError *error = nil;
    if (![[NSFileManager defaultManager] createDirectoryAtURL:directory
                                  withIntermediateDirectories:YES
                                                   attributes:nil
                                                        error:&error]) {
        return;
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:PEStatusDictionary(status)
                                                    options:NSJSONWritingSortedKeys
                                                      error:&error];
    if (data != nil) {
        [data writeToURL:[directory URLByAppendingPathComponent:@"input-source-status.json"] options:NSDataWritingAtomic error:nil];
    }
}

static void PEPrintStatus(void) {
    PEInputSourceStatus *status = PEReadStatus(noErr);
    NSDictionary *report = @{
        @"sourceExists": @(status.sourceExists),
        @"enabled": @(status.enabled),
        @"selectCapable": @(status.selectCapable),
        @"currentIsOurs": @(status.currentIsOurs),
        @"sourceType": status.sourceType,
        @"sourceCategory": status.sourceCategory,
        @"osStatus": @(status.osStatus),
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingSortedKeys error:nil];
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
}

@interface PESetupController : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSTextField *statusLabel;
@property(nonatomic, strong) NSButton *restoreButton;
@property(nonatomic) TISInputSourceRef previousInputSource;
@end

@implementation PESetupController

- (void)dealloc {
    if (_previousInputSource != NULL) {
        CFRelease(_previousInputSource);
    }
}

- (void)setPreviousInputSource:(TISInputSourceRef)source {
    if (_previousInputSource != NULL) {
        CFRelease(_previousInputSource);
    }
    _previousInputSource = source;
    self.restoreButton.enabled = source != NULL;
}

- (void)capturePreviousInputSourceIfExternal {
    TISInputSourceRef current = TISCopyCurrentKeyboardInputSource();
    if (current != NULL && ![PEStringProperty(current, kTISPropertyInputSourceID) isEqualToString:PEInputSourceID]) {
        [self setPreviousInputSource:current];
        return;
    }
    if (current != NULL) {
        CFRelease(current);
    }
    // If setup starts while Prompt Enhance is already selected, retain a normal
    // keyboard-layout escape hatch without changing the user's input source.
    TISInputSourceRef fallback = TISCopyCurrentASCIICapableKeyboardLayoutInputSource();
    if (fallback != NULL && ![PEStringProperty(fallback, kTISPropertyInputSourceID) isEqualToString:PEInputSourceID]) {
        [self setPreviousInputSource:fallback];
    } else if (fallback != NULL) {
        CFRelease(fallback);
    }
}

- (void)refreshStatusWithMessage:(NSString *)message operationStatus:(OSStatus)operationStatus {
    PEInputSourceStatus *status = PEReadStatus(operationStatus);
    PEWriteStatusReport(status);
    self.statusLabel.stringValue = [NSString stringWithFormat:
        @"%@\n\nInstalled source: %@\nEnabled: %@   Select-capable: %@   Active now: %@\n"
         "Source type: %@\nSource category: %@\nInstalled bundle verified: %@ (version %@)\nOSStatus: %d\n\n%@",
        message,
        status.sourceExists ? @"found" : @"not found",
        status.enabled ? @"yes" : @"no",
        status.selectCapable ? @"yes" : @"no",
        status.currentIsOurs ? @"yes" : @"no",
        status.sourceType,
        status.sourceCategory,
        status.installedBundleIdentifierMatches ? @"yes" : @"no",
        status.installedBundleVersion,
        (int)status.osStatus,
        PESafeRuntimeDiagnosticSummary()];
}

- (void)activatePromptEnhance:(id)sender {
    (void)sender;
    [self capturePreviousInputSourceIfExternal];
    PEInputSourceStatus *before = PEReadStatus(noErr);
    if (before.currentIsOurs) {
        [self refreshStatusWithMessage:@"Prompt Enhance is already active. If Codex has a stale input-method connection, click Reconnect Prompt Enhance; otherwise return to Codex."
                   operationStatus:noErr];
        return;
    }
    if (!before.installedBundleIdentifierMatches) {
        [self refreshStatusWithMessage:@"The expected installed Prompt Enhance bundle was not verified. Reinstall it, then try again."
                   operationStatus:fnfErr];
        return;
    }

    TISInputSourceRef source = PECopyPromptEnhanceSource();
    if (source == NULL || !PESourceHasExpectedBundleID(source)) {
        if (source != NULL) {
            CFRelease(source);
        }
        [self refreshStatusWithMessage:@"Prompt Enhance is not registered as the expected input source. Reinstall it, then try again."
                   operationStatus:fnfErr];
        return;
    }

    OSStatus result = TISEnableInputSource(source);
    if (result == noErr && PEBooleanProperty(source, kTISPropertyInputSourceIsSelectCapable)) {
        result = TISSelectInputSource(source);
    }
    CFRelease(source);
    NSString *message = result == noErr && PECurrentSourceIsPromptEnhance()
        ? @"Prompt Enhance is active. Return to Codex, type and pause for a suggestion, press Tab to accept it, or right-click the ghost text to save history."
        : @"macOS could not activate Prompt Enhance. The status below shows the public input-source capability result.";
    [self refreshStatusWithMessage:message operationStatus:result];
}

- (void)reconnectPromptEnhance:(id)sender {
    (void)sender;
    [self capturePreviousInputSourceIfExternal];
    if (!PECurrentSourceIsPromptEnhance()) {
        [self activatePromptEnhance:nil];
        return;
    }
    TISInputSourceRef fallback = TISCopyCurrentASCIICapableKeyboardLayoutInputSource();
    if (fallback == NULL || [PEStringProperty(fallback, kTISPropertyInputSourceID) isEqualToString:PEInputSourceID]) {
        if (fallback != NULL) CFRelease(fallback);
        [self refreshStatusWithMessage:@"macOS did not provide a regular keyboard layout for reconnecting. Use previous keyboard or choose one in the input menu, then activate Prompt Enhance again."
                   operationStatus:fnfErr];
        return;
    }
    OSStatus result = TISSelectInputSource(fallback);
    CFRelease(fallback);
    if (result != noErr) {
        [self refreshStatusWithMessage:@"macOS could not switch temporarily to a regular keyboard layout for reconnecting."
                   operationStatus:result];
        return;
    }
    [self refreshStatusWithMessage:@"Reconnecting Prompt Enhance…"
               operationStatus:noErr];
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        typeof(self) strongSelf = weakSelf;
        if (!strongSelf) return;
        TISInputSourceRef source = PECopyPromptEnhanceSource();
        OSStatus reconnectStatus = fnfErr;
        if (source != NULL && PESourceHasExpectedBundleID(source)) {
            reconnectStatus = TISEnableInputSource(source);
            if (reconnectStatus == noErr && PEBooleanProperty(source, kTISPropertyInputSourceIsSelectCapable)) {
                reconnectStatus = TISSelectInputSource(source);
            }
        }
        if (source != NULL) CFRelease(source);
        [strongSelf refreshStatusWithMessage:reconnectStatus == noErr && PECurrentSourceIsPromptEnhance()
                                             ? @"Prompt Enhance reconnected. Return to Codex and try again."
                                             : @"macOS could not reconnect Prompt Enhance. The status below shows the public input-source result."
                              operationStatus:reconnectStatus];
    });
}

- (void)openAccessibilitySettings:(id)sender {
    (void)sender;
    NSURL *url = [NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"];
    if (url != nil) {
        [[NSWorkspace sharedWorkspace] openURL:url];
    }
}

- (void)restorePreviousKeyboard:(id)sender {
    (void)sender;
    if (_previousInputSource == NULL) {
        [self refreshStatusWithMessage:@"No previous keyboard input source was recorded for this setup session." operationStatus:noErr];
        return;
    }
    OSStatus result = TISSelectInputSource(_previousInputSource);
    [self refreshStatusWithMessage:result == noErr
                                  ? @"Your previous keyboard input source is active again."
                                  : @"macOS could not restore the previously selected input source."
                   operationStatus:result];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    NSRect frame = NSMakeRect(0, 0, 650, 500);
    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable)
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    self.window.title = @"Prompt Enhance Setup";
    self.window.releasedWhenClosed = NO;

    NSStackView *stack = [NSStackView stackViewWithViews:@[]];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 14.0;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self.window.contentView addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
        [stack.leadingAnchor constraintEqualToAnchor:self.window.contentView.leadingAnchor constant:28],
        [stack.trailingAnchor constraintEqualToAnchor:self.window.contentView.trailingAnchor constant:-28],
        [stack.topAnchor constraintEqualToAnchor:self.window.contentView.topAnchor constant:28],
        [stack.bottomAnchor constraintLessThanOrEqualToAnchor:self.window.contentView.bottomAnchor constant:-28],
    ]];

    NSTextField *headline = [NSTextField labelWithString:@"Activate Prompt Enhance input" ];
    headline.font = [NSFont boldSystemFontOfSize:20.0];
    [stack addArrangedSubview:headline];

    NSTextField *instructions = [NSTextField wrappingLabelWithString:
        @"First open Accessibility settings and manually allow Prompt Enhance. Click Activate only when you want macOS to switch to Prompt Enhance. Then return to Codex: type and pause for a suggestion, press Tab to accept it, or right-click ghost text to save it to history."];
    instructions.maximumNumberOfLines = 0;
    [stack addArrangedSubview:instructions];

    NSStackView *buttons = [NSStackView stackViewWithViews:@[]];
    buttons.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    buttons.spacing = 10.0;
    NSButton *activate = [NSButton buttonWithTitle:@"Activate Prompt Enhance" target:self action:@selector(activatePromptEnhance:)];
    activate.keyEquivalent = @"\r";
    [buttons addArrangedSubview:activate];
    NSButton *reconnect = [NSButton buttonWithTitle:@"Reconnect Prompt Enhance" target:self action:@selector(reconnectPromptEnhance:)];
    [buttons addArrangedSubview:reconnect];
    self.restoreButton = [NSButton buttonWithTitle:@"Use previous keyboard" target:self action:@selector(restorePreviousKeyboard:)];
    [buttons addArrangedSubview:self.restoreButton];
    [stack addArrangedSubview:buttons];

    NSButton *accessibility = [NSButton buttonWithTitle:@"Open Accessibility settings" target:self action:@selector(openAccessibilitySettings:)];
    [stack addArrangedSubview:accessibility];

    self.statusLabel = [NSTextField wrappingLabelWithString:@""];
    self.statusLabel.maximumNumberOfLines = 0;
    self.statusLabel.font = [NSFont monospacedSystemFontOfSize:12.0 weight:NSFontWeightRegular];
    [stack addArrangedSubview:self.statusLabel];
    [self capturePreviousInputSourceIfExternal];
    PEInputSourceStatus *initialStatus = PEReadStatus(noErr);
    [self refreshStatusWithMessage:initialStatus.currentIsOurs
                                      ? @"Prompt Enhance is already active. Return to Codex to use it."
                                      : @"Setup is ready. No keyboard input source has been changed."
                   operationStatus:noErr];

    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    (void)sender;
    return YES;
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 2 && strcmp(argv[1], "--status") == 0) {
            PEPrintStatus();
            return 0;
        }
        if (argc != 1) {
            fprintf(stderr, "Usage: PromptEnhanceSetup [--status]\n");
            return 2;
        }
        NSApplication *application = [NSApplication sharedApplication];
        PESetupController *controller = [PESetupController new];
        application.delegate = controller;
        [application run];
    }
    return 0;
}
