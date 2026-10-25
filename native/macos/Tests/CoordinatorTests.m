#import <AppKit/AppKit.h>
#import "PEBackendClient.h"
#import "PECoordinator.h"

@interface PECoordinatorFixtureTextView : NSTextView <PETextClient>
@property(nonatomic) BOOL usesSyntheticCaret;
@property(nonatomic) NSRect syntheticCaret;
@end
@implementation PECoordinatorFixtureTextView
- (NSInteger)length { return (NSInteger)self.string.length; }
- (NSString *)bundleIdentifier { return @"com.promptenhance.input.fixture"; }
- (NSAttributedString *)attributedSubstringFromRange:(NSRange)range {
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
@end

static NSDictionary *PELastSaveBody;
static NSString *PEHistoryPrompt;

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
    [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
    [self.client URLProtocol:self didLoadData:data];
    [self.client URLProtocolDidFinishLoading:self];
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
        view.syntheticCaret = NSMakeRect(NSMinX(screen.visibleFrame) - 500, NSMinY(screen.visibleFrame) - 500, 0, 18);
        [coordinator updatePalette];
        NSPanel *palette = [coordinator valueForKey:@"palette"];
        PECoordinatorRequire(palette.isVisible, @"palette remains visible for an offscreen zero-width caret");
        PECoordinatorRequire(PEFrameIntersectsVisibleScreen(palette.frame), @"palette origin is clamped into a visible screen");
        [coordinator close];
        puts("Native coordinator save/history/restore checks passed");
    }
    return 0;
}
