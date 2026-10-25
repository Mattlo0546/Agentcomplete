#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>

static NSString *const PEInputSourceID = @"com.promptenhance.inputmethod.PromptEnhance";
static NSString *const PEInputSourceBundleID = @"com.promptenhance.inputmethod.PromptEnhance";
static NSString *const PEQueryAccessibility = @"com.promptenhance.inputmethod.PromptEnhance.queryAccessibility";
static NSString *const PERequestAccessibility = @"com.promptenhance.inputmethod.PromptEnhance.requestAccessibility";
static NSString *const PESetupSender = @"com.promptenhance.setup";

static NSNumber *PELatestAccessibilityTrust(NSString *buildVersion) {
    NSString *path = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Logs/Prompt Enhance/accessibility-status.json"];
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (!data.length || data.length > 4096) return nil;
    id decoded = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![decoded isKindOfClass:NSDictionary.class]) return nil;
    NSDictionary *report = decoded;
    NSNumber *updatedAt = report[@"updatedAt"];
    NSNumber *trusted = report[@"accessibilityTrusted"];
    if (![report[@"buildVersion"] isEqual:buildVersion] || ![updatedAt isKindOfClass:NSNumber.class] || ![trusted isKindOfClass:NSNumber.class]) return nil;
    NSTimeInterval age = NSDate.date.timeIntervalSince1970 - updatedAt.doubleValue;
    return age >= -1 && age <= 5 ? trusted : nil;
}

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

static NSString *PESafeRuntimeDiagnosticSummary(NSString *buildVersion) {
    NSData *data = [NSData dataWithContentsOfURL:PERuntimeStatusURL() options:NSDataReadingMappedIfSafe error:nil];
    if (data.length == 0 || data.length > 16384) {
        return @"No input-method diagnostic report is available yet.";
    }
    id decoded = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![decoded isKindOfClass:NSDictionary.class]) {
        return @"The input-method diagnostic report is unavailable.";
    }
    NSDictionary<NSString *, id> *report = decoded;
    NSString *timestamp = [report[@"timestamp"] isKindOfClass:NSString.class] ? report[@"timestamp"] : nil;
    NSDate *checkedAt = timestamp ? [[NSISO8601DateFormatter new] dateFromString:timestamp] : nil;
    NSTimeInterval age = checkedAt ? -checkedAt.timeIntervalSinceNow : INFINITY;
    if (![report[@"buildVersion"] isEqual:buildVersion] || ![report[@"accessibilityTrusted"] boolValue]
        || ![report[@"enabled"] boolValue] || age < -1 || age > 10) {
        return @"Input helper access is allowed. Return to Codex and focus your draft to refresh the editor check.";
    }
    NSString *safeError = [report[@"safeError"] isKindOfClass:NSString.class] ? report[@"safeError"] : nil;
    if (safeError != nil && (safeError.length > 240 || [safeError rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location != NSNotFound)) {
        safeError = @"Input method reported an invalid diagnostic error.";
    }
    NSString *errorText = safeError.length ? safeError : @"none";
    return [NSString stringWithFormat:@"Last Codex check — draft readable: %@; caret available: %@; toolbar visible: %@.\n%@",
        PEBooleanDiagnostic(report, @"selectedRangeSupported"),
        PEBooleanDiagnostic(report, @"caretRectSupported"),
        PEBooleanDiagnostic(report, @"paletteVisible"),
        [errorText isEqualToString:@"none"] ? @"Return to Codex to refresh this check." : errorText];
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
@property(nonatomic, strong) NSButton *permissionButton;
@property(nonatomic, strong) NSTimer *permissionTimer;
@property(nonatomic, copy) NSString *latestMessage;
@property(nonatomic) OSStatus latestOperationStatus;
@property(nonatomic) TISInputSourceRef previousInputSource;
@end

@implementation PESetupController

- (void)dealloc {
    [_permissionTimer invalidate];
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
    self.latestMessage = message;
    self.latestOperationStatus = operationStatus;
    PEInputSourceStatus *status = PEReadStatus(operationStatus);
    PEWriteStatusReport(status);
    NSNumber *trusted = PELatestAccessibilityTrust(status.installedBundleVersion);
    NSString *permission = trusted == nil ? @"Checking the installed input helper…"
        : trusted.boolValue ? @"Allowed for the input helper" : @"Off — add Prompt Enhance at the path above, then enable it.";
    self.permissionButton.enabled = !trusted.boolValue;
    self.permissionButton.title = trusted.boolValue ? @"Input helper allowed" : @"Allow input helper…";
    self.statusLabel.stringValue = [NSString stringWithFormat:
        @"%@\n\nInput helper Accessibility: %@\nKeyboard input source: %@\nInstalled input helper: %@ (build %@)\n\n%@",
        message,
        permission,
        status.currentIsOurs ? @"Prompt Enhance is selected" : @"Click Activate Prompt Enhance when ready",
        status.installedBundleIdentifierMatches ? @"Prompt Enhance" : @"Not found — reinstall required",
        status.installedBundleVersion,
        trusted.boolValue ? PESafeRuntimeDiagnosticSummary(status.installedBundleVersion) : @"Allowing Prompt Enhance Setup does not authorize the input helper. Autocomplete stays off until the helper itself is allowed."];
}

- (void)queryAccessibilityStatus:(id)sender {
    (void)sender;
    [NSDistributedNotificationCenter.defaultCenter postNotificationName:PEQueryAccessibility object:PESetupSender userInfo:nil deliverImmediately:YES];
    [self refreshStatusWithMessage:self.latestMessage ?: @"Setup is ready." operationStatus:self.latestOperationStatus];
}

- (void)startInstalledHelperWithPermissionRequest:(BOOL)request {
    PEInputSourceStatus *status = PEReadStatus(noErr);
    if (!status.installedBundleIdentifierMatches) {
        [self refreshStatusWithMessage:@"The installed Prompt Enhance helper was not found. Reinstall it before continuing." operationStatus:fnfErr];
        return;
    }
    NSWorkspaceOpenConfiguration *configuration = NSWorkspaceOpenConfiguration.configuration;
    configuration.activates = NO;
    __weak typeof(self) weakSelf = self;
    [NSWorkspace.sharedWorkspace openApplicationAtURL:PEInstalledInputMethodURL() configuration:configuration completionHandler:^(NSRunningApplication *application, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            typeof(self) self = weakSelf;
            if (!self) return;
            if (error || !application) {
                [self refreshStatusWithMessage:@"macOS could not start the installed input helper. Try Reconnect Prompt Enhance." operationStatus:fnfErr];
                return;
            }
            [NSDistributedNotificationCenter.defaultCenter postNotificationName:request ? PERequestAccessibility : PEQueryAccessibility object:PESetupSender userInfo:nil deliverImmediately:YES];
            if (request) {
                [self openAccessibilitySettings:nil];
                [self showInstalledHelper:nil];
                [self refreshStatusWithMessage:@"The exact input helper is selected in Finder. Add that Prompt Enhance app in Accessibility settings, then enable it." operationStatus:noErr];
            }
        });
    }];
}

- (void)requestAccessibility:(id)sender {
    (void)sender;
    [self startInstalledHelperWithPermissionRequest:YES];
}

- (void)showInstalledHelper:(id)sender {
    (void)sender;
    [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[PEInstalledInputMethodURL()]];
}

- (void)activatePromptEnhance:(id)sender {
    (void)sender;
    [self capturePreviousInputSourceIfExternal];
    PEInputSourceStatus *before = PEReadStatus(noErr);
    if (before.currentIsOurs) {
        [self refreshStatusWithMessage:@"The input source is already selected. Check that Accessibility shows Allowed below, then return to Codex."
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
        ? @"The input source is selected. Check that Accessibility shows Allowed below before returning to Codex."
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
                                             ? @"Input source reconnected. When Accessibility shows Allowed below, return to Codex and type."
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
    NSRect frame = NSMakeRect(0, 0, 760, 640);
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

    NSTextField *headline = [NSTextField labelWithString:@"Set up Prompt Enhance" ];
    headline.font = [NSFont boldSystemFontOfSize:20.0];
    [stack addArrangedSubview:headline];

    NSTextField *instructions = [NSTextField wrappingLabelWithString:
        @"1. Allow the Prompt Enhance input helper shown below in macOS Accessibility.\n2. Activate the input source, or reconnect it if already selected.\n3. Return to Codex, type a sentence and pause. Tab accepts a suggestion; right-click saves it; the clock restores history."];
    instructions.maximumNumberOfLines = 0;
    [stack addArrangedSubview:instructions];

    NSTextField *helperIdentity = [NSTextField wrappingLabelWithString:[NSString stringWithFormat:
        @"APP TO ALLOW: Prompt Enhance (input helper)\n%@\n\nPrompt Enhance Setup only manages settings. Its Accessibility permission does not enable autocomplete.", PEInstalledInputMethodURL().path]];
    helperIdentity.maximumNumberOfLines = 0;
    helperIdentity.selectable = YES;
    helperIdentity.font = [NSFont systemFontOfSize:12.0];
    [stack addArrangedSubview:helperIdentity];

    NSStackView *buttons = [NSStackView stackViewWithViews:@[]];
    buttons.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    buttons.spacing = 10.0;
    NSButton *activate = [NSButton buttonWithTitle:@"Activate input source" target:self action:@selector(activatePromptEnhance:)];
    activate.keyEquivalent = @"\r";
    [buttons addArrangedSubview:activate];
    NSButton *reconnect = [NSButton buttonWithTitle:@"Reconnect helper" target:self action:@selector(reconnectPromptEnhance:)];
    [buttons addArrangedSubview:reconnect];
    self.restoreButton = [NSButton buttonWithTitle:@"Use previous keyboard" target:self action:@selector(restorePreviousKeyboard:)];
    [buttons addArrangedSubview:self.restoreButton];
    [stack addArrangedSubview:buttons];

    NSStackView *permissionButtons = [NSStackView stackViewWithViews:@[]];
    permissionButtons.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    permissionButtons.spacing = 10;
    self.permissionButton = [NSButton buttonWithTitle:@"Allow input helper…" target:self action:@selector(requestAccessibility:)];
    [permissionButtons addArrangedSubview:self.permissionButton];
    [permissionButtons addArrangedSubview:[NSButton buttonWithTitle:@"Accessibility settings" target:self action:@selector(openAccessibilitySettings:)]];
    [permissionButtons addArrangedSubview:[NSButton buttonWithTitle:@"Reveal app to allow" target:self action:@selector(showInstalledHelper:)]];
    [stack addArrangedSubview:permissionButtons];

    self.statusLabel = [NSTextField wrappingLabelWithString:@""];
    self.statusLabel.maximumNumberOfLines = 0;
    self.statusLabel.font = [NSFont monospacedSystemFontOfSize:12.0 weight:NSFontWeightRegular];
    [stack addArrangedSubview:self.statusLabel];
    [self capturePreviousInputSourceIfExternal];
    PEInputSourceStatus *initialStatus = PEReadStatus(noErr);
    [self refreshStatusWithMessage:initialStatus.currentIsOurs
                                      ? @"Prompt Enhance is selected. Check the Accessibility status below before returning to Codex."
                                      : @"Setup is ready. No keyboard input source has been changed."
                   operationStatus:noErr];

    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [self startInstalledHelperWithPermissionRequest:NO];
    self.permissionTimer = [NSTimer scheduledTimerWithTimeInterval:1 target:self selector:@selector(queryAccessibilityStatus:) userInfo:nil repeats:YES];
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
