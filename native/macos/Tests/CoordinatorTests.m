#import <AppKit/AppKit.h>
#import "PEBackendClient.h"
#import "PECoordinator.h"

@interface PECoordinatorFixtureTextView : NSTextView <PETextClient>
@property(nonatomic) BOOL usesSyntheticCaret;
@property(nonatomic) NSRect syntheticCaret;
@property(nonatomic, copy) NSString *clientBundleID;
@property(nonatomic) NSUInteger draftReadCount;
@end

@interface PEExternalCoordinatorFixtureTextView : PECoordinatorFixtureTextView
@end
@implementation PEExternalCoordinatorFixtureTextView
- (BOOL)usesExternalPreview { return YES; }
- (BOOL)replaceEntireDraft:(NSString *)prompt expectedPrompt:(NSString *)expectedPrompt {
    if (![self.string isEqualToString:expectedPrompt] || self.selectedRange.length != 0 || self.selectedRange.location != self.string.length) return NO;
    self.string = prompt;
    self.selectedRange = NSMakeRange(prompt.length, 0);
    return YES;
}
@end
@implementation PECoordinatorFixtureTextView
- (NSInteger)length { self.draftReadCount++; return (NSInteger)self.string.length; }
- (NSString *)bundleIdentifier { return self.clientBundleID ?: @"com.promptenhance.input.fixture"; }
- (NSAttributedString *)attributedSubstringFromRange:(NSRange)range {
    self.draftReadCount++;
    NSRange actual = NSMakeRange(NSNotFound, 0);
    return [self attributedSubstringForProposedRange:range actualRange:&actual];
}
- (void)setMarkedText:(id)text selectionRange:(NSRange)selectionRange replacementRange:(NSRange)replacementRange {
    [super setMarkedText:text selectedRange:selectionRange replacementRange:replacementRange];
}
- (void)insertText:(id)text replacementRange:(NSRange)replacementRange {
    [super insertText:text replacementRange:replacementRange];
}
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actualRange {
    if (self.usesSyntheticCaret) {
        if (actualRange) *actualRange = range;
        return self.syntheticCaret;
    }
    return [super firstRectForCharacterRange:range actualRange:actualRange];
}
@end

@interface PECoordinator (Tests)
- (void)saveCurrent:(id)sender;
- (void)showHistory:(id)sender;
- (void)restoreVersion:(NSMenuItem *)sender;
- (void)updatePalette;
- (BOOL)isInputMethodProvider;
- (BOOL)isAccessibilityTrusted;
- (void)openSetup:(id)sender;
@end

@interface PEPermissionCoordinator : PECoordinator
@property(nonatomic) BOOL setupOpened;
@property(nonatomic) BOOL accessibilityTrusted;
@property(nonatomic) BOOL inputMethodProvider;
@end
@implementation PEPermissionCoordinator
- (BOOL)isInputMethodProvider { return self.inputMethodProvider; }
- (BOOL)isAccessibilityTrusted { return self.accessibilityTrusted; }
- (void)openSetup:(id)sender { self.setupOpened = YES; }
@end

static NSDictionary *PELastSaveBody;
static NSString *PEHistoryPrompt;
static NSUInteger PEEnhancementRequestCount;
static NSTimeInterval PEEnhancementResponseDelay;

static NSData *PERequestBody(NSURLRequest *request) {
    if (request.HTTPBody) return request.HTTPBody;
    NSInputStream *stream = request.HTTPBodyStream;
    if (!stream) return nil;
    NSMutableData *data = [NSMutableData data];
    uint8_t buffer[1024];
    [stream open];
    for (;;) {
        NSInteger count = [stream read:buffer maxLength:sizeof(buffer)];
        if (count <= 0) break;
        [data appendBytes:buffer length:(NSUInteger)count];
    }
    [stream close];
    return data;
}

static NSDictionary *PEVersion(NSString *prompt, NSString *suggestion, NSString *title) {
    return @{
        @"id": @"17c6a8d2-1e49-4f71-b0e3-9f48d877c2d7",
        @"prompt": prompt,
        @"suggestion_text": suggestion ?: NSNull.null,
        @"saved_text": [prompt stringByAppendingString:suggestion ?: @""],
        @"title": title,
        @"description": @"Saved from the native Codex draft",
        @"created_at": @"2026-10-25T10:00:00Z",
        @"updated_at": @"2026-10-25T10:00:00Z",
    };
}

@interface PECoordinatorProtocol : NSURLProtocol @end
@implementation PECoordinatorProtocol
+ (BOOL)canInitWithRequest:(NSURLRequest *)request { return YES; }
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request { return request; }
- (void)startLoading {
    NSURLRequest *request = self.request;
    NSString *path = request.URL.path;
    NSData *bodyData = PERequestBody(request);
    NSDictionary *body = bodyData.length ? [NSJSONSerialization JSONObjectWithData:bodyData options:0 error:nil] : nil;
    NSDictionary *payload = nil;
    if ([path isEqualToString:@"/v1/enhance"]) {
        PEEnhancementRequestCount++;
        NSString *prompt = body[@"prompt"];
        payload = @{
            @"schema_version": @1,
            @"request_id": body[@"request_id"] ?: @"missing-request-id",
            @"prompt_revision": body[@"prompt_revision"] ?: @0,
            @"type": @"autocomplete",
            @"insert_at": @(prompt.length),
            @"text": @" with focused tests",
        };
    } else if ([path isEqualToString:@"/v1/prompt-history"] && [request.HTTPMethod isEqualToString:@"POST"]) {
        PELastSaveBody = body ?: @{};
        payload = PEVersion(body[@"prompt"] ?: @"missing prompt", body[@"suggestion_text"], body[@"title"] ?: @"Untitled");
    } else if ([path isEqualToString:@"/v1/prompt-history"] && [request.HTTPMethod isEqualToString:@"GET"]) {
        NSDictionary *version = PEVersion(@"Restore this exact saved prompt.", nil, @"Native saved version");
        PEHistoryPrompt = version[@"saved_text"];
        payload = @{ @"items": @[version], @"total": @1 };
    }
    NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:request.URL statusCode:payload ? 200 : 404 HTTPVersion:@"HTTP/1.1" headerFields:@{ @"Content-Type": @"application/json" }];
    NSData *data = [NSJSONSerialization dataWithJSONObject:payload ?: @{} options:0 error:nil];
    void (^deliver)(void) = ^{
        [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
        [self.client URLProtocol:self didLoadData:data];
        [self.client URLProtocolDidFinishLoading:self];
    };
    if ([path isEqualToString:@"/v1/enhance"] && PEEnhancementResponseDelay > 0) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(PEEnhancementResponseDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), deliver);
    } else {
        deliver();
    }
}
- (void)stopLoading {}
@end

static void PECoordinatorRequire(BOOL condition, NSString *message) {
    if (!condition) { NSLog(@"COORDINATOR TEST FAILURE: %@", message); exit(1); }
}

static void PECoordinatorWait(BOOL (^condition)(void)) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2.0];
    while (!condition() && deadline.timeIntervalSinceNow > 0) {
        [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
    PECoordinatorRequire(condition(), @"asynchronous coordinator operation timed out");
}

static void PECoordinatorRunFor(NSTimeInterval interval) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:interval];
    while (deadline.timeIntervalSinceNow > 0) {
        [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
}

static PEBackendClient *PECoordinatorBackend(void) {
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.protocolClasses = @[PECoordinatorProtocol.class];
    NSError *error = nil;
    PEBackendClient *backend = [[PEBackendClient alloc] initWithBaseURL:[NSURL URLWithString:@"http://127.0.0.1:8000"] sessionConfiguration:configuration error:&error];
    PECoordinatorRequire(backend && !error, @"fixture backend initializes");
    return backend;
}

static BOOL PEFrameIntersectsVisibleScreen(NSRect frame) {
    for (NSScreen *screen in NSScreen.screens) {
        if (NSIntersectsRect(frame, screen.visibleFrame)) return YES;
    }
    return NO;
}

static void TestAccessibilityDraftWatcher(void) {
    PEEnhancementResponseDelay = 0;
    NSScreen *screen = NSScreen.mainScreen ?: NSScreen.screens.firstObject;
    PECoordinatorRequire(screen != nil, @"test host has a screen for the accessibility watcher");

    // Codex can publish the AX draft after the input-method session has
    // activated. No InputMethodKit event is delivered for this transition.
    PEExternalCoordinatorFixtureTextView *bootstrapView = [[PEExternalCoordinatorFixtureTextView alloc] initWithFrame:NSMakeRect(0, 0, 320, 120)];
    bootstrapView.clientBundleID = @"com.openai.codex";
    bootstrapView.usesSyntheticCaret = YES;
    bootstrapView.syntheticCaret = NSMakeRect(NSMidX(screen.visibleFrame), NSMidY(screen.visibleFrame), 0, 18);
    bootstrapView.string = @"The late Accessibility draft is now readable.";
    bootstrapView.selectedRange = NSMakeRange(NSNotFound, 0);
    PECoordinator *bootstrap = [[PECoordinator alloc] initWithClient:bootstrapView backend:PECoordinatorBackend() menuPresenter:nil];
    [bootstrap activate];
    PECompletionEngine *bootstrapEngine = [bootstrap valueForKey:@"engine"];
    bootstrapEngine.debounceInterval = 0.01;
    NSUInteger bootstrapRequests = PEEnhancementRequestCount;
    bootstrapView.selectedRange = NSMakeRange(bootstrapView.string.length, 0);
    PECoordinatorWait(^BOOL { return PEEnhancementRequestCount == bootstrapRequests + 1 && bootstrapEngine.suggestion.length > 0; });
    NSPanel *bootstrapPalette = [bootstrap valueForKey:@"palette"];
    PECoordinatorRequire(bootstrapPalette.isVisible, @"the first readable Accessibility draft updates the toolbar without a key event");
    [bootstrap close];

    PEExternalCoordinatorFixtureTextView *view = [[PEExternalCoordinatorFixtureTextView alloc] initWithFrame:NSMakeRect(0, 0, 320, 120)];
    view.clientBundleID = @"com.openai.codex";
    view.usesSyntheticCaret = YES;
    view.syntheticCaret = NSMakeRect(NSMidX(screen.visibleFrame), NSMidY(screen.visibleFrame), 0, 18);
    view.string = @"Initial Accessibility draft.";
    view.selectedRange = NSMakeRange(view.string.length, 0);
    PECoordinator *coordinator = [[PECoordinator alloc] initWithClient:view backend:PECoordinatorBackend() menuPresenter:nil];
    [coordinator activate];
    PECompletionEngine *engine = [coordinator valueForKey:@"engine"];
    engine.debounceInterval = 0.01;
    PECoordinatorWait(^BOOL { return engine.suggestion.length > 0; });
    PECoordinatorRequire([engine.prompt isEqualToString:view.string], @"the first usable Accessibility draft can produce an automatic preview");
    [coordinator dismiss];
    NSUInteger requestsBeforeTyping = PEEnhancementRequestCount;

    // This simulates Chromium editing the AX value without delivering a usable
    // InputMethodKit key callback to the helper.
    view.string = @"Changed through the Accessibility text path.";
    view.selectedRange = NSMakeRange(view.string.length, 0);
    PECoordinatorWait(^BOOL { return PEEnhancementRequestCount == requestsBeforeTyping + 1 && engine.suggestion.length > 0; });
    PECoordinatorRequire(!view.hasMarkedText, @"the accessibility watcher keeps the external preview out of the host draft");
    PECoordinatorRequire([engine.prompt isEqualToString:view.string], @"the watcher submits the observed full draft without a handleEvent callback");

    // A response for an older snapshot must not survive a later observed AX
    // change, even when the host supplied no key event for either change.
    [coordinator dismiss];
    PEEnhancementResponseDelay = 0.6;
    NSUInteger requestsBeforeStaleChange = PEEnhancementRequestCount;
    view.string = @"First delayed Accessibility draft.";
    view.selectedRange = NSMakeRange(view.string.length, 0);
    PECoordinatorWait(^BOOL { return PEEnhancementRequestCount == requestsBeforeStaleChange + 1; });
    view.string = @"Second Accessibility draft wins.";
    view.selectedRange = NSMakeRange(view.string.length, 0);
    PECoordinatorWait(^BOOL { return PEEnhancementRequestCount == requestsBeforeStaleChange + 2 && [engine.prompt isEqualToString:view.string] && engine.suggestion.length > 0; });
    PECoordinatorRequire([engine.prompt isEqualToString:@"Second Accessibility draft wins."], @"a stale delayed response is ignored after the watcher sees a newer draft");
    PEEnhancementResponseDelay = 0;

    view.selectedRange = NSMakeRange(0, 0);
    PECoordinatorRunFor(0.35);
    NSPanel *preview = [coordinator valueForKey:@"preview"];
    NSPanel *palette = [coordinator valueForKey:@"palette"];
    PECoordinatorRequire(!engine.suggestion.length && !preview.isVisible && !palette.isVisible, @"an invalid focused selection cancels and hides the accessibility preview");
    view.selectedRange = NSMakeRange(view.string.length, 0);
    NSUInteger requestsAfterInvalidFocus = PEEnhancementRequestCount;
    PECoordinatorRunFor(0.35);
    PECoordinatorRequire(PEEnhancementRequestCount == requestsAfterInvalidFocus, @"refocusing an unchanged draft establishes a baseline instead of resending it");

    [coordinator close];
    NSUInteger readsAfterClose = view.draftReadCount;
    view.string = @"No watcher should read this after close.";
    view.selectedRange = NSMakeRange(view.string.length, 0);
    PECoordinatorRunFor(0.35);
    PECoordinatorRequire(view.draftReadCount == readsAfterClose, @"closing the coordinator invalidates the accessibility draft watcher");
}

int PECoordinatorTests(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        PELastSaveBody = nil;
        __block NSMenu *presentedMenu = nil;
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 640, 240) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        PECoordinatorFixtureTextView *view = [[PECoordinatorFixtureTextView alloc] initWithFrame:window.contentView.bounds];
        window.contentView = view;
        [window makeFirstResponder:view];
        NSString *base = @"Refactor the billing webhook handler";
        view.string = base;
        view.selectedRange = NSMakeRange(base.length, 0);

        PECoordinator *coordinator = [[PECoordinator alloc] initWithClient:view backend:PECoordinatorBackend() menuPresenter:^(NSMenu *menu, NSPoint point) {
            (void)point;
            presentedMenu = menu;
        }];
        [coordinator activate];
        PECompletionEngine *engine = [coordinator valueForKey:@"engine"];
        engine.debounceInterval = 0.01;
        [engine scheduleSuggestion];
        PECoordinatorWait(^BOOL { return engine.suggestion.length > 0; });
        PECoordinatorRequire(view.hasMarkedText, @"native completion is marked before saving");

        [coordinator saveCurrent:nil];
        PECoordinatorWait(^BOOL { return PELastSaveBody != nil; });
        PECoordinatorRequire([PELastSaveBody[@"prompt"] isEqualToString:base], @"save sends the base draft separately");
        PECoordinatorRequire([PELastSaveBody[@"suggestion_text"] isEqualToString:@" with focused tests"], @"save sends the unaccepted suffix separately");
        PECoordinatorRequire(view.hasMarkedText && engine.suggestion.length > 0, @"saving never accepts the ghost completion");

        [coordinator showHistory:nil];
        PECoordinatorWait(^BOOL { return presentedMenu != nil; });
        PECoordinatorRequire(presentedMenu.numberOfItems == 2, @"history presenter receives heading and version row");
        NSMenuItem *versionRow = [presentedMenu itemAtIndex:1];
        PECoordinatorRequire([versionRow.title isEqualToString:@"Native saved version"] && versionRow.submenu.numberOfItems >= 2, @"history version is rendered as an actionable native menu");
        NSMenuItem *restore = versionRow.submenu.itemArray.lastObject;
        [coordinator restoreVersion:restore];
        PECoordinatorRequire([view.string isEqualToString:PEHistoryPrompt], @"history restore replaces the native draft with saved text");

        presentedMenu = nil;
        [coordinator showHistory:nil];
        PECoordinatorWait(^BOOL { return presentedMenu != nil; });
        NSMenuItem *staleRestore = [presentedMenu itemAtIndex:1].submenu.itemArray.lastObject;
        view.string = @"The user changed this draft after opening history.";
        view.selectedRange = NSMakeRange(view.string.length, 0);
        [coordinator restoreVersion:staleRestore];
        PECoordinatorRequire([view.string isEqualToString:@"The user changed this draft after opening history."], @"stale history selection cannot overwrite a changed native draft");

        NSScreen *screen = NSScreen.mainScreen ?: NSScreen.screens.firstObject;
        PECoordinatorRequire(screen != nil, @"test host has a screen for palette placement");
        PECoordinatorRequire(!window.isKeyWindow, @"palette positioning does not require a key fixture window");
        view.usesSyntheticCaret = YES;
        view.syntheticCaret = NSMakeRect(NSMidX(screen.visibleFrame), NSMidY(screen.visibleFrame), 0, 18);
        [coordinator updatePalette];
        NSPanel *palette = [coordinator valueForKey:@"palette"];
        PECoordinatorRequire(palette.isVisible, @"a valid zero-width caret shows the palette");
        PECoordinatorRequire(PEFrameIntersectsVisibleScreen(palette.frame), @"palette is placed on the caret's screen");

        view.syntheticCaret = NSMakeRect(CGFLOAT_MAX, CGFLOAT_MAX, 0, 18);
        [coordinator updatePalette];
        PECoordinatorRequire(!palette.isVisible, @"finite sentinel caret coordinates cannot strand the bar at a screen edge");
        view.syntheticCaret = NSMakeRect(NSMinX(screen.visibleFrame) - 500, NSMinY(screen.visibleFrame) - 500, 0, 18);
        [coordinator updatePalette];
        PECoordinatorRequire(!palette.isVisible, @"unsupported offscreen caret coordinates never display controls");
        view.syntheticCaret = NSMakeRect(NSMidX(screen.visibleFrame), NSMidY(screen.visibleFrame), 0, NAN);
        [coordinator updatePalette];
        PECoordinatorRequire(!palette.isVisible, @"a nonfinite caret height never displays controls");
        view.syntheticCaret = NSMakeRect(NSMidX(screen.visibleFrame), NSMidY(screen.visibleFrame), 0, 18);
        [coordinator updatePalette];

        NSButton *history = [coordinator valueForKey:@"historyButton"];
        NSTextField *caption = [coordinator valueForKey:@"caption"];
        PECoordinatorRequire([history acceptsFirstMouse:nil] && !history.needsPanelToBecomeKey, @"history is clickable on the first click without making its panel key");
        PECoordinatorRequire(history.refusesFirstResponder && !palette.canBecomeKeyWindow && !palette.ignoresMouseEvents, @"palette buttons retain the host text field's input focus");
        PECoordinatorRequire(palette.movable && palette.movableByWindowBackground && [caption mouseDownCanMoveWindow] && [caption acceptsFirstMouse:nil], @"palette caption and background provide a first-click drag target");
        PECoordinatorRequire([palette.contentView mouseDownCanMoveWindow] && [palette.contentView acceptsFirstMouse:nil], @"palette surface can start a drag without activating the helper");
        NSPoint pinnedOrigin = NSMakePoint(NSMinX(screen.visibleFrame) + 64, NSMinY(screen.visibleFrame) + 64);
        [palette setFrameOrigin:pinnedOrigin];
        [palette setValue:@YES forKey:@"userPositioned"];
        view.syntheticCaret = NSOffsetRect(view.syntheticCaret, 80, 40);
        [coordinator updatePalette];
        PECoordinatorRequire(NSEqualPoints(palette.frame.origin, pinnedOrigin), @"caret updates preserve the position chosen by dragging");
        presentedMenu = nil;
        [history performClick:nil];
        PECoordinatorWait(^BOOL { return presentedMenu != nil; });
        PECoordinatorRequire(presentedMenu.numberOfItems == 2, @"the visible history button opens an actionable history menu");
        PECoordinatorRequire(window.firstResponder == view && !palette.isKeyWindow, @"opening history does not replace the fixture's text responder");
        [coordinator close];

        TestAccessibilityDraftWatcher();

        PECoordinatorFixtureTextView *blockedView = [[PECoordinatorFixtureTextView alloc] initWithFrame:NSMakeRect(0, 0, 320, 120)];
        blockedView.clientBundleID = @"com.openai.codex";
        blockedView.string = @"This draft must not be read without Accessibility.";
        blockedView.selectedRange = NSMakeRange(blockedView.string.length, 0);
        PEPermissionCoordinator *blocked = [[PEPermissionCoordinator alloc] initWithClient:blockedView backend:PECoordinatorBackend() menuPresenter:nil];
        blocked.inputMethodProvider = YES;
        [blocked activate];
        NSPanel *permissionPalette = [blocked valueForKey:@"palette"];
        NSButton *setup = [blocked valueForKey:@"setupButton"];
        NSTextField *permissionCaption = [blocked valueForKey:@"caption"];
        PECompletionEngine *blockedEngine = [blocked valueForKey:@"engine"];
        PECoordinatorRequire(permissionPalette.isVisible && PEFrameIntersectsVisibleScreen(permissionPalette.frame), @"missing permission displays an accessible setup bar without a caret");
        PECoordinatorRequire([permissionCaption.stringValue containsString:@"Accessibility"] && !setup.hidden && setup.enabled, @"the bar explains missing Accessibility and offers setup");
        PECoordinatorRequire([[blocked valueForKey:@"historyButton"] isHidden] && [[blocked valueForKey:@"saveButton"] isHidden], @"unavailable history actions are replaced by the setup action");
        PECoordinatorRequire(!blockedEngine.enabled && blockedView.draftReadCount == 0, @"missing permission never falls back to an unusable native draft reader");
        NSUInteger requestCount = PEEnhancementRequestCount;
        NSEvent *key = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil characters:@"x" charactersIgnoringModifiers:@"x" isARepeat:NO keyCode:7];
        PECoordinatorRequire(![blocked handleEvent:key], @"typing remains pass-through while Accessibility is unavailable");
        PECoordinatorRequire(blockedView.draftReadCount == 0 && PEEnhancementRequestCount == requestCount, @"blocked typing performs no draft reads or model requests");
        [setup performClick:nil];
        PECoordinatorRequire(blocked.setupOpened, @"the permission bar's first-click setup action is connected");
        PECoordinatorRequire([[[blocked inputMenu] itemAtIndex:0].title containsString:@"Accessibility"], @"the input menu gives the same actionable permission state");

        // The coordinator must recover on the first host event after a grant.
        // This test uses the regular fixture text client after the transition;
        // PEAccessibilityClient's exact-focused-field behavior is exercised by
        // AccessibilityClientTests. That keeps this coordinator regression
        // deterministic without requesting real Accessibility access.
        blocked.accessibilityTrusted = YES;
        blocked.inputMethodProvider = NO;
        blockedEngine.debounceInterval = 0.01;
        requestCount = PEEnhancementRequestCount;
        PECoordinatorRequire(![blocked handleEvent:key], @"the first post-grant key remains pass-through");
        PECoordinatorWait(^BOOL { return PEEnhancementRequestCount > requestCount; });
        PECoordinatorRequire(blockedEngine.enabled && [[blocked valueForKey:@"textClient"] isEqual:blockedView], @"a newly granted session reattaches the current Codex draft and resumes requests");
        [blocked close];
        puts("Native coordinator save/history/restore checks passed");
    }
    return 0;
}
