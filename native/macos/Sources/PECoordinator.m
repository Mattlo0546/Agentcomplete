#import "PECoordinator.h"
#import "PEBackendClient.h"
#import "PEDiagnostics.h"
#import "PEAccessibilityClient.h"

@interface PEPalettePanel : NSPanel
@property(nonatomic) BOOL userPositioned;
@end
@implementation PEPalettePanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

@interface PEPaletteButton : NSButton
@end
@implementation PEPaletteButton
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)needsPanelToBecomeKey { return NO; }
@end

static void PEDragPalette(NSWindow *window, NSEvent *event) {
    if (![window isKindOfClass:PEPalettePanel.class]) return;
    ((PEPalettePanel *)window).userPositioned = YES;
    [window performWindowDragWithEvent:event];
}

@interface PEPaletteSurface : NSVisualEffectView
@end
@implementation PEPaletteSurface
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)mouseDownCanMoveWindow { return YES; }
- (void)mouseDown:(NSEvent *)event { PEDragPalette(self.window, event); }
@end

@interface PEPaletteCaption : NSTextField
@end
@implementation PEPaletteCaption
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)mouseDownCanMoveWindow { return YES; }
- (void)mouseDown:(NSEvent *)event { PEDragPalette(self.window, event); }
@end

@interface PECoordinator (PreviewMenu)
- (void)showActionsAtPoint:(NSPoint)point;
@end
@interface PEPreviewTextField : NSTextField
@property(nonatomic, weak) PECoordinator *coordinator;
@end
@implementation PEPreviewTextField
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)rightMouseDown:(NSEvent *)event {
    NSPoint point = event.window ? [event.window convertPointToScreen:event.locationInWindow] : event.locationInWindow;
    [self.coordinator showActionsAtPoint:point];
}
- (void)mouseDown:(NSEvent *)event { [self.coordinator dismiss]; }
@end

static BOOL PEValidCaretGeometry(NSRect rect) {
    return isfinite(rect.origin.x) && isfinite(rect.origin.y)
        && isfinite(rect.size.width) && isfinite(rect.size.height)
        && rect.size.width >= 0 && rect.size.width <= 300
        && rect.size.height > 0 && rect.size.height <= 300;
}

static NSScreen *PEScreenForCaretRect(NSRect rect) {
    if (!PEValidCaretGeometry(rect)) return nil;
    // Empty-width insertion carets are valid, but offscreen sentinel positions
    // are not. Never turn an unsupported caret into a control at a screen edge.
    NSRect hitRect = NSInsetRect(rect, -0.5, 0);
    for (NSScreen *candidate in NSScreen.screens) {
        if (NSIntersectsRect(hitRect, candidate.frame)) return candidate;
    }
    return nil;
}

static BOOL PEFrameIsOnScreen(NSRect frame) {
    for (NSScreen *screen in NSScreen.screens) {
        if (NSIntersectsRect(frame, screen.visibleFrame)) return YES;
    }
    return NO;
}

static CGFloat PEClampPaletteCoordinate(CGFloat value, CGFloat minimum, CGFloat maximum) {
    return MIN(MAX(value, minimum), MAX(minimum, maximum));
}

@interface PECoordinator ()
@property(nonatomic, strong) id<PETextClient> textClient; // Adapter, never the IMK proxy.
@property(nonatomic, strong) id<PETextClient> nativeClient;
@property(nonatomic, strong) PEBackendClient *backend;
@property(nonatomic, copy) PEMenuPresenter menuPresenter;
@property(nonatomic, strong) PECompletionEngine *engine;
@property(nonatomic, strong) PEPalettePanel *palette;
@property(nonatomic, strong) PEPalettePanel *preview;
@property(nonatomic, strong) PEPreviewTextField *previewText;
@property(nonatomic, strong) NSTextField *caption;
@property(nonatomic, strong) NSButton *saveButton;
@property(nonatomic, strong) NSButton *historyButton;
@property(nonatomic, strong) NSButton *setupButton;
@property(nonatomic, strong) NSURLSessionDataTask *autocompleteTask;
@property(nonatomic, strong) NSURLSessionDataTask *historyTask;
@property(nonatomic, strong) NSTimer *draftWatchTimer;
@property(nonatomic, copy) NSString *watchedDraft;
@property(nonatomic, copy) NSString *pendingDraft;
@property(nonatomic) BOOL hasWatchedDraft;
@property(nonatomic) NSUInteger pendingDraftObservations;
@property(nonatomic) NSUInteger sessionEpoch;
@property(nonatomic) NSUInteger requestEpoch;
@property(nonatomic) BOOL diagnosticFailureWritten;
@property(nonatomic) BOOL permissionRequired;
@property(nonatomic, copy) NSString *status;
@end

@implementation PECoordinator
- (instancetype)initWithClient:(id<PETextClient>)client {
    PEBackendClient *backend = [[PEBackendClient alloc] initWithBaseURL:[NSURL URLWithString:@"http://127.0.0.1:8000"] error:nil];
    return [self initWithClient:client backend:backend menuPresenter:nil];
}
- (instancetype)initWithClient:(id<PETextClient>)client
                       backend:(PEBackendClient *)backend
                 menuPresenter:(PEMenuPresenter)menuPresenter {
    if ((self = [super init])) {
        _textClient = client;
        _nativeClient = client;
        _backend = backend;
        _menuPresenter = [menuPresenter copy];
        __weak typeof(self) weakSelf = self;
        _engine = [[PECompletionEngine alloc] initWithRequestHandler:^(NSString *prompt, NSUInteger revision, NSUInteger cursor, PECompletionResponse completion) {
            typeof(self) self = weakSelf;
            if (!self) return;
            [self.autocompleteTask cancel];
            NSUInteger requestEpoch = ++self.requestEpoch;
            self.status = @"Suggesting…";
            [self updatePalette];
            self.autocompleteTask = [self.backend requestAutocompleteForPrompt:prompt revision:revision cursor:cursor completion:^(PEAutocompleteResult *result, NSString *safeError) {
                typeof(self) self = weakSelf;
                if (!self || self.requestEpoch != requestEpoch) return;
                self.status = nil;
                completion(result.suffix, safeError);
                [self updatePalette];
            }];
        }];
        _engine.debounceInterval = 0.9;
        [_engine attachClient:client];
        _engine.stateDidChange = ^{ [weakSelf updatePalette]; [weakSelf recordDiagnosticFailureIfNeeded]; };
    }
    return self;
}
- (void)activate {
    self.sessionEpoch++;
    self.diagnosticFailureWritten = NO;
    BOOL provider = [self isInputMethodProvider];
    NSString *bundleID = [self.nativeClient bundleIdentifier];
    BOOL scope = [bundleID isEqualToString:@"com.openai.codex"] || [bundleID isEqualToString:@"com.promptenhance.input.fixture"];
    id<PETextClient> client = self.nativeClient;
    BOOL trusted = [self isAccessibilityTrusted];
    self.permissionRequired = provider && [bundleID isEqualToString:@"com.openai.codex"] && !trusted;
    if (provider && scope && trusted) client = [[PEAccessibilityClient alloc] initWithNativeClient:self.nativeClient];
    self.textClient = client;
    // Codex's IME draft ranges are unavailable. Until authorization exists,
    // keep the engine inert and explain the required setup instead of falling
    // back to a nonfunctional native reader.
    [self.engine attachClient:self.permissionRequired ? nil : client];
    [self.engine activate];
    [self recordDiagnosticActivation];
    [self startDraftWatcherIfNeeded];
}
- (BOOL)isInputMethodProvider {
    return [NSBundle.mainBundle.bundleIdentifier isEqualToString:@"com.promptenhance.inputmethod.PromptEnhance"];
}
- (BOOL)isAccessibilityTrusted { return [PEAccessibilityClient isTrusted]; }
- (void)deactivate {
    [self stopDraftWatcher];
    self.sessionEpoch++;
    self.requestEpoch++;
    [self.autocompleteTask cancel];
    [self.historyTask cancel];
    [self.engine deactivate];
    [self.palette orderOut:nil];
    [self.preview orderOut:nil];
}
- (void)close {
    [self deactivate];
    [self.backend finishAndInvalidate];
    self.engine.stateDidChange = nil;
    [self.engine attachClient:nil];
    self.textClient = nil;
    self.nativeClient = nil;
}
- (void)dismiss {
    self.requestEpoch++;
    [self.autocompleteTask cancel];
    [self.engine dismissSuggestion];
    self.status = nil;
    [self updatePalette];
}

// InputMethodKit may not deliver a usable key event for Chromium's composer.
// In the Accessibility-backed session, watch only the already-authorized,
// focused draft. A new value must remain unchanged for a second observation
// before it enters the engine's existing debounce/request path.
- (BOOL)usesExternalPreviewSession {
    return self.textClient != nil
        && [self.textClient respondsToSelector:@selector(usesExternalPreview)]
        && [self.textClient usesExternalPreview];
}

- (void)startDraftWatcherIfNeeded {
    [self stopDraftWatcher];
    if (!self.engine.active || self.permissionRequired || ![self usesExternalPreviewSession]) return;
    NSString *initialDraft = [self.engine readCurrentPrompt];
    self.watchedDraft = initialDraft;
    self.hasWatchedDraft = initialDraft != nil;
    self.pendingDraft = initialDraft;
    self.pendingDraftObservations = initialDraft != nil ? 1 : 0;
    __weak typeof(self) weakSelf = self;
    self.draftWatchTimer = [NSTimer scheduledTimerWithTimeInterval:0.2 repeats:YES block:^(NSTimer *timer) {
        (void)timer;
        [weakSelf pollAccessibilityDraft];
    }];
}

- (void)stopDraftWatcher {
    [self.draftWatchTimer invalidate];
    self.draftWatchTimer = nil;
    self.watchedDraft = nil;
    self.pendingDraft = nil;
    self.hasWatchedDraft = NO;
    self.pendingDraftObservations = 0;
}

- (void)resetDraftWatcherBaseline {
    if (!self.draftWatchTimer || ![self usesExternalPreviewSession]) return;
    NSString *draft = [self.engine readCurrentPrompt];
    self.watchedDraft = draft;
    self.hasWatchedDraft = draft != nil;
    self.pendingDraft = nil;
    self.pendingDraftObservations = 0;
}

- (void)pollAccessibilityDraft {
    if (!self.engine.active || self.permissionRequired || ![self usesExternalPreviewSession]) {
        [self stopDraftWatcher];
        return;
    }
    NSString *draft = [self.engine readCurrentPrompt];
    if (draft == nil) {
        if (self.hasWatchedDraft || self.pendingDraft != nil) {
            [self.autocompleteTask cancel];
            self.requestEpoch++;
            [self.engine dismissSuggestion];
            self.status = nil;
            self.pendingDraft = nil;
            self.pendingDraftObservations = 0;
            self.hasWatchedDraft = NO;
            [self.palette orderOut:nil];
            [self.preview orderOut:nil];
        }
        return;
    }
    if (!self.hasWatchedDraft) {
        BOOL unchanged = [draft isEqualToString:self.watchedDraft];
        self.watchedDraft = draft;
        self.hasWatchedDraft = YES;
        // Chromium can expose the field only after this input-method session
        // starts. Treat its first usable draft as a change candidate rather
        // than silently adopting it forever as a baseline.
        self.pendingDraft = unchanged ? nil : draft;
        self.pendingDraftObservations = unchanged ? 0 : 1;
        [self recordDiagnosticActivation];
        [self updatePalette];
        return;
    }
    if ([draft isEqualToString:self.pendingDraft]) {
        self.pendingDraftObservations++;
    } else if ([draft isEqualToString:self.watchedDraft]) {
        self.pendingDraft = nil;
        self.pendingDraftObservations = 0;
        return;
    } else {
        self.pendingDraft = draft;
        self.pendingDraftObservations = 1;
        return;
    }
    if (self.pendingDraftObservations < 2) return;

    self.watchedDraft = draft;
    self.pendingDraft = nil;
    self.pendingDraftObservations = 0;
    [self.autocompleteTask cancel];
    [self.historyTask cancel];
    self.requestEpoch++;
    self.status = nil;
    [self.engine textWillChange];
    [self.engine scheduleSuggestion];
    [self recordDiagnosticActivation];
}
- (void)recordDiagnosticActivation { [self recordDiagnostic:YES]; }
- (void)recordDiagnosticFailureIfNeeded {
    if (self.diagnosticFailureWritten || !self.engine.safeError.length) return;
    self.diagnosticFailureWritten = YES;
    [self recordDiagnostic:NO];
}
- (void)recordDiagnostic:(BOOL)activation {
    if (!activation && !self.engine.safeError.length) return;
    NSString *bundleID = [self.textClient bundleIdentifier];
    BOOL allowed = self.engine.enabled;
    BOOL selectedRangeSupported = NO;
    BOOL documentLengthSupported = NO;
    BOOL caretRectSupported = NO;
    BOOL draftNonempty = NO;
    BOOL minimumLengthMet = NO;
    BOOL selectionEmpty = NO;
    BOOL caretAtEnd = NO;
    if (allowed) {
        NSRange selection = [self.textClient selectedRange];
        selectedRangeSupported = selection.location != NSNotFound;
        selectionEmpty = selectedRangeSupported && selection.length == 0;
        NSInteger documentLength = [self.textClient length];
        documentLengthSupported = documentLength != NSNotFound && documentLength >= 0;
        draftNonempty = documentLengthSupported && documentLength > 0;
        minimumLengthMet = documentLengthSupported && documentLength >= 12;
        caretAtEnd = selectedRangeSupported && documentLengthSupported && selection.location == (NSUInteger)documentLength;
        NSRect caret = selectedRangeSupported ? [self.textClient firstRectForCharacterRange:NSMakeRange(selection.location, 0) actualRange:NULL] : NSZeroRect;
        if (!PEScreenForCaretRect(caret) && [self.textClient respondsToSelector:@selector(caretRect)]) caret = [self.textClient caretRect];
        caretRectSupported = PEScreenForCaretRect(caret) != nil;
    }
    BOOL paletteVisible = self.palette.isVisible;
    BOOL positionOnScreen = NO;
    if (paletteVisible) for (NSScreen *screen in NSScreen.screens) if (NSIntersectsRect(self.palette.frame, screen.visibleFrame)) { positionOnScreen = YES; break; }
    NSString *version = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown";
    [PEDiagnostics writeStatusWithBuildVersion:version clientBundleID:bundleID active:self.engine.active enabled:allowed selectedRangeSupported:selectedRangeSupported documentLengthSupported:documentLengthSupported caretRectSupported:caretRectSupported draftNonempty:draftNonempty minimumLengthMet:minimumLengthMet selectionEmpty:selectionEmpty caretAtEnd:caretAtEnd paletteVisible:paletteVisible positionOnScreen:positionOnScreen safeError:self.permissionRequired ? @"Enable Accessibility in Prompt Enhance setup." : self.engine.safeError];
}
- (BOOL)handleEvent:(NSEvent *)event {
    if (self.permissionRequired) {
        if ([self isAccessibilityTrusted]) [self activate];
        else { [self updatePalette]; return NO; }
    }
    if (!self.engine.active || !self.engine.enabled) return NO;
    if (event.type == NSEventTypeRightMouseDown && self.engine.suggestion.length) {
        NSPoint point = event.window ? [event.window convertPointToScreen:event.locationInWindow] : event.locationInWindow;
        NSRange marked = [self.textClient markedRange];
        NSRect rect = [self.textClient firstRectForCharacterRange:marked actualRange:NULL];
        BOOL inside = [self.textClient respondsToSelector:@selector(isPointInMarkedText:)] ? [self.textClient isPointInMarkedText:point] : NSPointInRect(point, NSInsetRect(rect, -8, -6));
        if (inside) {
            [self showActionsAtPoint:point];
            return YES;
        }
    }
    BOOL plainKey = !(event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagShift));
    if (event.type == NSEventTypeKeyDown && plainKey && event.keyCode == 48 && [self.engine acceptSuggestion]) {
        [self resetDraftWatcherBaseline];
        return YES;
    }
    if (event.type == NSEventTypeKeyDown && plainKey && event.keyCode == 53) {
        BOOL hadSuggestion = self.engine.suggestion.length > 0;
        [self.historyTask cancel];
        [self dismiss];
        [self resetDraftWatcherBaseline];
        return hadSuggestion;
    }
    [self.autocompleteTask cancel];
    [self.historyTask cancel];
    self.requestEpoch++;
    self.status = nil;
    [self.engine textWillChange];
    // Let the host handle typing/paste/delete/navigation first. The engine's
    // debounce reads the resulting native text; it does not synthesize keys.
    if (event.type == NSEventTypeKeyDown && event.keyCode != 36 && event.keyCode != 76 && event.keyCode != 53 && event.keyCode != 48) {
        __weak typeof(self) weakSelf = self;
        dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf.engine scheduleSuggestion]; });
    }
    return NO;
}
- (NSMenu *)inputMenu {
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Prompt Enhance"];
    if (self.permissionRequired) {
        [self addAction:@"Enable Accessibility…" selector:@selector(openSetup:) menu:menu object:nil];
        return menu;
    }
    [self addAction:@"Prompt history…" selector:@selector(showHistory:) menu:menu object:nil];
    [self addAction:@"Save current prompt version" selector:@selector(saveCurrent:) menu:menu object:nil];
    [self addAction:@"Dismiss suggestion" selector:@selector(dismissAction:) menu:menu object:nil];
    [self addAction:@"Prompt Enhance setup…" selector:@selector(openSetup:) menu:menu object:nil];
    return menu;
}
- (void)openSetup:(id)sender {
    NSURL *url = [NSURL fileURLWithPath:[NSHomeDirectory() stringByAppendingPathComponent:@"Applications/Prompt Enhance Setup.app"]];
    [NSWorkspace.sharedWorkspace openApplicationAtURL:url configuration:NSWorkspaceOpenConfiguration.configuration completionHandler:nil];
}
- (void)addAction:(NSString *)title selector:(SEL)action menu:(NSMenu *)menu object:(id)object {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:@""];
    item.target = self;
    item.representedObject = object;
    [menu addItem:item];
}
- (void)ensurePalette {
    if (self.palette) return;
    self.palette = [[PEPalettePanel alloc] initWithContentRect:NSMakeRect(0, 0, 196, 36)
        styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    self.palette.level = NSPopUpMenuWindowLevel;
    self.palette.hidesOnDeactivate = NO;
    self.palette.movable = YES;
    self.palette.movableByWindowBackground = YES;
    self.palette.becomesKeyOnlyIfNeeded = YES;
    self.palette.worksWhenModal = YES;
    self.palette.ignoresMouseEvents = NO;
    self.palette.backgroundColor = NSColor.clearColor;
    self.palette.opaque = NO;
    self.palette.hasShadow = YES;
    self.palette.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorFullScreenAuxiliary;
    PEPaletteSurface *surface = [[PEPaletteSurface alloc] initWithFrame:NSMakeRect(0, 0, 196, 36)];
    surface.material = NSVisualEffectMaterialPopover;
    surface.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    surface.state = NSVisualEffectStateActive;
    surface.wantsLayer = YES;
    surface.layer.cornerRadius = 10;
    surface.layer.masksToBounds = YES;
    self.palette.contentView = surface;
    NSButton *history = [self iconButton:@"clock.arrow.circlepath" label:@"Prompt history" action:@selector(showHistory:) frame:NSMakeRect(160, 2, 34, 32)];
    self.historyButton = history;
    [surface addSubview:history];
    self.saveButton = [self iconButton:@"bookmark" label:@"Save prompt version" action:@selector(saveCurrent:) frame:NSMakeRect(126, 2, 34, 32)];
    [surface addSubview:self.saveButton];
    self.caption = [PEPaletteCaption labelWithString:@"Prompt Enhance"];
    self.caption.frame = NSMakeRect(12, 10, 112, 17);
    self.caption.font = [NSFont systemFontOfSize:11 weight:NSFontWeightMedium];
    self.caption.textColor = NSColor.secondaryLabelColor;
    self.caption.lineBreakMode = NSLineBreakByTruncatingTail;
    [surface addSubview:self.caption];
    self.caption.toolTip = @"Drag to move Prompt Enhance";
    self.setupButton = [[PEPaletteButton alloc] initWithFrame:NSMakeRect(204, 4, 92, 32)];
    self.setupButton.title = @"Set up…";
    self.setupButton.bezelStyle = NSBezelStyleRounded;
    self.setupButton.target = self;
    self.setupButton.action = @selector(openSetup:);
    self.setupButton.refusesFirstResponder = YES;
    self.setupButton.hidden = YES;
    [surface addSubview:self.setupButton];
}
- (NSButton *)iconButton:(NSString *)symbol label:(NSString *)label action:(SEL)action frame:(NSRect)frame {
    NSButton *button = [[PEPaletteButton alloc] initWithFrame:frame];
    button.refusesFirstResponder = YES;
    button.image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:label];
    button.bordered = NO;
    button.imagePosition = NSImageOnly;
    button.target = self;
    button.action = action;
    button.toolTip = label;
    button.accessibilityLabel = label;
    return button;
}
- (void)updatePalette {
    if (self.permissionRequired && self.engine.active) {
        [self showPermissionPalette];
        return;
    }
    if (!self.engine.active || !self.engine.enabled) { [self.palette orderOut:nil]; [self.preview orderOut:nil]; return; }
    NSRange selection = [self.textClient selectedRange];
    if (selection.location == NSNotFound) { [self.palette orderOut:nil]; [self.preview orderOut:nil]; return; }
    NSRect caret = [self.textClient firstRectForCharacterRange:NSMakeRange(selection.location, 0) actualRange:NULL];
    if (!PEScreenForCaretRect(caret) && [self.textClient respondsToSelector:@selector(caretRect)]) caret = [self.textClient caretRect];
    NSScreen *screen = PEScreenForCaretRect(caret);
    if (!screen) { [self.palette orderOut:nil]; [self.preview orderOut:nil]; return; }
    [self ensurePalette];
    [self configurePermissionPalette:NO];
    self.caption.stringValue = self.engine.suggestion.length ? @"Tab to accept" : (self.engine.safeError ?: self.status ?: @"Prompt Enhance");
    self.caption.toolTip = [self.caption.stringValue stringByAppendingString:@" · Drag to move"];
    self.saveButton.enabled = self.engine.prompt.length > 0 || [self.engine readCurrentPrompt].length > 0;
    NSRect visible = screen.visibleFrame;
    if (NSIsEmptyRect(visible)) visible = screen.frame;
    if (NSIsEmptyRect(visible)) { [self.palette orderOut:nil]; return; }
    NSSize paletteSize = self.palette.frame.size;
    CGFloat inset = 4;
    CGFloat x = PEClampPaletteCoordinate(caret.origin.x, NSMinX(visible) + inset, NSMaxX(visible) - paletteSize.width - inset);
    CGFloat y = NSMinY(caret) - paletteSize.height - 6;
    if (y < NSMinY(visible) + inset) y = NSMaxY(caret) + 6;
    y = PEClampPaletteCoordinate(y, NSMinY(visible) + inset, NSMaxY(visible) - paletteSize.height - inset);
    if (!self.palette.userPositioned || !PEFrameIsOnScreen(self.palette.frame)) {
        self.palette.userPositioned = NO;
        [self.palette setFrameOrigin:NSMakePoint(x, y)];
    }
    [self.palette orderFrontRegardless];
    [self updateExternalPreviewAtCaret:caret screen:screen];
}
- (void)configurePermissionPalette:(BOOL)permission {
    NSRect frame = self.palette.frame;
    frame.size = permission ? NSMakeSize(304, 40) : NSMakeSize(196, 36);
    [self.palette setFrame:frame display:NO];
    self.palette.contentView.frame = NSMakeRect(0, 0, frame.size.width, frame.size.height);
    self.caption.frame = permission ? NSMakeRect(12, 12, 184, 17) : NSMakeRect(12, 10, 112, 17);
    self.historyButton.hidden = permission;
    self.saveButton.hidden = permission;
    self.setupButton.hidden = !permission;
}
- (void)showPermissionPalette {
    [self.preview orderOut:nil];
    [self ensurePalette];
    [self configurePermissionPalette:YES];
    self.caption.stringValue = @"Enable Accessibility";
    self.caption.toolTip = @"Allow Prompt Enhance in macOS Accessibility to enable autocomplete and history. Drag this bar to move it.";
    NSScreen *screen = NSScreen.mainScreen ?: NSScreen.screens.firstObject;
    if (!screen) { [self.palette orderOut:nil]; return; }
    NSRect visible = screen.visibleFrame;
    if (!self.palette.userPositioned || !PEFrameIsOnScreen(self.palette.frame)) {
        self.palette.userPositioned = NO;
        [self.palette setFrameOrigin:NSMakePoint(NSMidX(visible) - self.palette.frame.size.width / 2, NSMaxY(visible) - self.palette.frame.size.height - 48)];
    }
    [self.palette orderFrontRegardless];
}
- (void)updateExternalPreviewAtCaret:(NSRect)caret screen:(NSScreen *)screen {
    BOOL external = [self.textClient respondsToSelector:@selector(usesExternalPreview)] && [self.textClient usesExternalPreview];
    if (!external || !self.engine.suggestion.length || !screen) { [self.preview orderOut:nil]; return; }
    if (!self.preview) {
        self.preview = [[PEPalettePanel alloc] initWithContentRect:NSMakeRect(0, 0, 400, 52)
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
        self.preview.level = NSPopUpMenuWindowLevel;
        self.preview.opaque = NO;
        self.preview.backgroundColor = NSColor.clearColor;
        self.preview.hasShadow = NO;
        self.preview.hidesOnDeactivate = NO;
        self.preview.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorFullScreenAuxiliary;
        self.previewText = [[PEPreviewTextField alloc] initWithFrame:NSMakeRect(0, 0, 400, 52)];
        self.previewText.editable = NO;
        self.previewText.selectable = NO;
        self.previewText.bordered = NO;
        self.previewText.drawsBackground = NO;
        self.previewText.textColor = NSColor.secondaryLabelColor;
        self.previewText.maximumNumberOfLines = 3;
        self.previewText.lineBreakMode = NSLineBreakByTruncatingTail;
        self.previewText.coordinator = self;
        self.previewText.accessibilityLabel = @"Autocomplete suggestion. Tab accepts; right-click saves a version.";
        self.preview.contentView = self.previewText;
    }
    NSRect visible = screen.visibleFrame;
    CGFloat x = PEClampPaletteCoordinate(NSMinX(caret) + 2, NSMinX(visible) + 4, NSMaxX(visible) - 124);
    CGFloat width = MIN(560, MAX(120, NSMaxX(visible) - x - 8));
    CGFloat height = MAX(22, MIN(60, caret.size.height * 3));
    CGFloat y = PEClampPaletteCoordinate(NSMaxY(caret) - height, NSMinY(visible) + 4, NSMaxY(visible) - height - 4);
    self.previewText.font = [NSFont systemFontOfSize:MAX(12, MIN(17, caret.size.height * 0.8))];
    self.previewText.stringValue = self.engine.suggestion;
    self.previewText.frame = NSMakeRect(0, 0, width, height);
    [self.preview setFrame:NSMakeRect(x, y, width, height) display:YES];
    [self.preview orderFrontRegardless];
    NSPoint bar = self.palette.frame.origin;
    bar.y = PEClampPaletteCoordinate(y - 42, NSMinY(visible) + 4, NSMaxY(visible) - 40);
    if (!self.palette.userPositioned) [self.palette setFrameOrigin:bar];
}
- (void)showActionsAtPoint:(NSPoint)point {
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Prompt Enhance"];
    NSDictionary *snapshot = @{@"prompt": self.engine.prompt ?: @"", @"suggestion": self.engine.suggestion ?: @""};
    [self addAction:@"Save suggestion as prompt version" selector:@selector(saveCurrent:) menu:menu object:snapshot];
    [self addAction:@"Prompt history…" selector:@selector(showHistory:) menu:menu object:nil];
    [self addAction:@"Dismiss suggestion" selector:@selector(dismissAction:) menu:menu object:nil];
    [self presentMenu:menu atPoint:point];
}
- (void)presentMenu:(NSMenu *)menu atPoint:(NSPoint)point {
    if (self.menuPresenter) {
        self.menuPresenter(menu, point);
    } else {
        [menu popUpMenuPositioningItem:nil atLocation:point inView:nil];
    }
}
- (void)dismissAction:(id)sender { [self dismiss]; }
- (void)saveCurrent:(id)sender {
    if (self.permissionRequired) return;
    NSDictionary *snapshot = [sender isKindOfClass:NSMenuItem.class] ? [sender representedObject] : nil;
    NSString *prompt = snapshot ? snapshot[@"prompt"] : (self.engine.suggestion.length ? self.engine.prompt : [self.engine readCurrentPrompt]);
    NSString *suggestion = snapshot ? snapshot[@"suggestion"] : self.engine.suggestion;
    if (!prompt.length || (!snapshot && !self.engine.active)) return;
    NSString *firstLine = [[prompt componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet] firstObject];
    if (firstLine.length > 72) firstLine = [firstLine substringWithRange:[firstLine rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, 72)]];
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.dateStyle = NSDateFormatterNoStyle;
    formatter.timeStyle = NSDateFormatterShortStyle;
    NSString *title = [NSString stringWithFormat:@"%@ · %@", firstLine, [formatter stringFromDate:NSDate.date]];
    NSUInteger epoch = self.sessionEpoch;
    __weak typeof(self) weakSelf = self;
    [self.backend savePrompt:prompt suggestion:suggestion title:title completion:^(PEPromptVersion *version, NSString *safeError) {
        typeof(self) self = weakSelf;
        if (!self || self.sessionEpoch != epoch || !self.engine.active) return;
        self.status = version ? @"Version saved" : (safeError ?: @"Could not save");
        [self updatePalette];
    }];
}
- (void)showHistory:(id)sender {
    if (self.permissionRequired) { [self openSetup:sender]; return; }
    if (!self.engine.active || !self.engine.enabled) return;
    self.requestEpoch++;
    [self.autocompleteTask cancel];
    [self.engine dismissSuggestion];
    NSString *expected = [self.engine readCurrentPrompt];
    if (!expected) return;
    NSUInteger epoch = self.sessionEpoch;
    [self showHistoryAtOffset:0 expectedPrompt:expected epoch:epoch];
}
- (void)showHistoryAtOffset:(NSUInteger)offset expectedPrompt:(NSString *)expected epoch:(NSUInteger)epoch {
    self.status = @"Loading history…";
    [self updatePalette];
    __weak typeof(self) weakSelf = self;
    self.historyTask = [self.backend fetchPromptVersionPageAtOffset:offset completion:^(PEPromptVersionPage *page, NSString *safeError) {
        typeof(self) self = weakSelf;
        if (!self || !self.engine.active || self.sessionEpoch != epoch || ![[self.engine readCurrentPrompt] isEqualToString:expected]) return;
        if (!page) { self.status = safeError ?: @"History unavailable"; [self updatePalette]; return; }
        NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Prompt history"];
        NSMenuItem *heading = [[NSMenuItem alloc] initWithTitle:page.items.count ? @"Restore a saved prompt" : @"No saved prompt versions" action:nil keyEquivalent:@""];
        heading.enabled = NO;
        [menu addItem:heading];
        for (PEPromptVersion *version in page.items) {
            NSString *title = version.title ?: @"Untitled prompt";
            NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
            NSMenu *details = [[NSMenu alloc] initWithTitle:title];
            NSString *preview = version.savedText;
            if (preview.length > 160) preview = [[preview substringWithRange:[preview rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, 160)]] stringByAppendingString:@"…"];
            NSMenuItem *previewItem = [[NSMenuItem alloc] initWithTitle:[preview stringByReplacingOccurrencesOfString:@"\n" withString:@" "] action:nil keyEquivalent:@""];
            previewItem.enabled = NO;
            [details addItem:previewItem];
            if (version.versionDescription.length) {
                NSMenuItem *description = [[NSMenuItem alloc] initWithTitle:version.versionDescription action:nil keyEquivalent:@""];
                description.enabled = NO;
                [details addItem:description];
            }
            [self addAction:@"Replace current draft with this version" selector:@selector(restoreVersion:) menu:details object:@{@"version": version, @"expected": expected, @"epoch": @(epoch)}];
            item.submenu = details;
            [menu addItem:item];
        }
        if (offset > 0 || offset + page.items.count < page.total) [menu addItem:NSMenuItem.separatorItem];
        if (offset > 0) [self addAction:@"Newer versions…" selector:@selector(loadHistoryPage:) menu:menu object:@{@"offset": @(offset >= 20 ? offset - 20 : 0), @"expected": expected, @"epoch": @(epoch)}];
        if (offset + page.items.count < page.total) [self addAction:@"Older versions…" selector:@selector(loadHistoryPage:) menu:menu object:@{@"offset": @(offset + page.items.count), @"expected": expected, @"epoch": @(epoch)}];
        self.status = nil;
        [self updatePalette];
        NSPoint point = NSMakePoint(NSMinX(self.palette.frame), NSMinY(self.palette.frame));
        // Source-menu and button actions can still be in AppKit's tracking
        // loop when HTTP completes. Present only after that loop ends, or its
        // cleanup immediately dismisses the newly opened history picker.
        [NSRunLoop.mainRunLoop performInModes:@[NSDefaultRunLoopMode] block:^{
            typeof(self) self = weakSelf;
            if (!self || !self.engine.active || self.sessionEpoch != epoch || ![[self.engine readCurrentPrompt] isEqualToString:expected]) return;
            [self presentMenu:menu atPoint:point];
        }];
    }];
}
- (void)loadHistoryPage:(NSMenuItem *)sender {
    NSDictionary *context = sender.representedObject;
    NSUInteger epoch = [context[@"epoch"] unsignedIntegerValue];
    if (epoch != self.sessionEpoch || !self.engine.active || ![[self.engine readCurrentPrompt] isEqualToString:context[@"expected"]]) return;
    [self showHistoryAtOffset:[context[@"offset"] unsignedIntegerValue] expectedPrompt:context[@"expected"] epoch:epoch];
}
- (void)restoreVersion:(NSMenuItem *)sender {
    NSDictionary *context = sender.representedObject;
    PEPromptVersion *version = context[@"version"];
    if (!version || [context[@"epoch"] unsignedIntegerValue] != self.sessionEpoch || !self.engine.active) return;
    BOOL restored = [self.engine restorePrompt:version.savedText expectedPrompt:context[@"expected"]];
    if (restored) [self resetDraftWatcherBaseline];
    self.status = restored ? @"Version restored" : @"Draft changed; try again";
    [self updatePalette];
}
- (void)dealloc {
    [_draftWatchTimer invalidate];
    _engine.stateDidChange = nil;
    [_autocompleteTask cancel];
    [_historyTask cancel];
    [_palette orderOut:nil];
    [_preview orderOut:nil];
}
@end
