#import <AppKit/AppKit.h>
#import "PECoordinator.h"

// NSTextView implements NSTextInputClient at runtime; the SDK header does not
// declare that conformance on the class itself.
@interface NSTextView (PEFixtureTextInputClient) <NSTextInputClient>
- (void)setMarkedText:(id)string selectedRange:(NSRange)selectedRange replacementRange:(NSRange)replacementRange;
- (void)insertText:(id)string replacementRange:(NSRange)replacementRange;
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(nullable NSRangePointer)actualRange;
@end

static BOOL PEUsesSystemInputMethod(void) {
    return [[[NSBundle mainBundle] objectForInfoDictionaryKey:@"PEUseSystemInput"] boolValue];
}

/// A deliberately small AppKit client for native text-system QA. It is not
/// installed as an input source and never targets any app but itself.
@interface PEFixtureTextView : NSTextView <PETextClient>
@property (nonatomic, strong, nullable) PECoordinator *promptEnhanceCoordinator;
@property (nonatomic, readonly) BOOL usesSystemInputMethod;
@property (nonatomic) NSInteger preflightRightMouseEventNumber;
- (BOOL)preflightRightMouseDown:(NSEvent *)event;
@end

/// AppKit may unmark composition before the view receives a contextual click.
/// This fixture preflights it at the application boundary, matching the input
/// method's first-chance event handling without altering another app.
@interface PEFixtureApplication : NSApplication
@end

@implementation PEFixtureTextView

- (instancetype)initWithFrame:(NSRect)frameRect textContainer:(NSTextContainer *)container {
    self = [super initWithFrame:frameRect textContainer:container];
    if (self) {
        _usesSystemInputMethod = PEUsesSystemInputMethod();
        if (!_usesSystemInputMethod) _promptEnhanceCoordinator = [[PECoordinator alloc] initWithClient:self];
        _preflightRightMouseEventNumber = NSIntegerMin;
        self.allowsUndo = YES;
        self.automaticQuoteSubstitutionEnabled = NO;
        self.automaticDashSubstitutionEnabled = NO;
        self.automaticTextReplacementEnabled = NO;
        self.font = [NSFont monospacedSystemFontOfSize:14 weight:NSFontWeightRegular];
        self.textColor = NSColor.labelColor;
        self.backgroundColor = NSColor.textBackgroundColor;
        self.insertionPointColor = NSColor.controlAccentColor;
    }
    return self;
}

- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center removeObserver:self name:NSWindowDidBecomeKeyNotification object:nil];
    [center removeObserver:self name:NSWindowDidResignKeyNotification object:nil];
    if (self.usesSystemInputMethod) return;
    if (!self.window) {
        [self.promptEnhanceCoordinator deactivate];
        return;
    }
    [center addObserver:self selector:@selector(windowDidBecomeKey:) name:NSWindowDidBecomeKeyNotification object:self.window];
    [center addObserver:self selector:@selector(windowDidResignKey:) name:NSWindowDidResignKeyNotification object:self.window];
    if (self.window.isKeyWindow) [self.promptEnhanceCoordinator activate];
}

- (void)windowDidBecomeKey:(NSNotification *)notification {
    (void)notification;
    [self.promptEnhanceCoordinator activate];
}

- (void)windowDidResignKey:(NSNotification *)notification {
    (void)notification;
    [self.promptEnhanceCoordinator deactivate];
}

- (void)keyDown:(NSEvent *)event {
    if (![self.promptEnhanceCoordinator handleEvent:event]) [super keyDown:event];
}

- (void)rightMouseDown:(NSEvent *)event {
    if (event.eventNumber == self.preflightRightMouseEventNumber) {
        self.preflightRightMouseEventNumber = NSIntegerMin;
        [super rightMouseDown:event];
        return;
    }
    if (![self.promptEnhanceCoordinator handleEvent:event]) [super rightMouseDown:event];
}

- (BOOL)preflightRightMouseDown:(NSEvent *)event {
    if (self.usesSystemInputMethod) return NO;
    BOOL handled = [self.promptEnhanceCoordinator handleEvent:event];
    if (!handled) self.preflightRightMouseEventNumber = event.eventNumber;
    return handled;
}

- (void)mouseDown:(NSEvent *)event {
    if (![self.promptEnhanceCoordinator handleEvent:event]) [super mouseDown:event];
}

- (NSInteger)length {
    return self.string.length;
}

- (nullable NSAttributedString *)attributedSubstringFromRange:(NSRange)range {
    if (range.location == NSNotFound || NSMaxRange(range) > self.textStorage.length) return nil;
    return [self.textStorage attributedSubstringFromRange:range];
}

- (nullable NSString *)bundleIdentifier {
    return @"com.promptenhance.input.fixture";
}

- (void)setMarkedText:(id)string selectionRange:(NSRange)selectionRange replacementRange:(NSRange)replacementRange {
    [super setMarkedText:string selectedRange:selectionRange replacementRange:replacementRange];
}

- (void)insertText:(id)string replacementRange:(NSRange)replacementRange {
    [super insertText:string replacementRange:replacementRange];
}

- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actualRange {
    return [super firstRectForCharacterRange:range actualRange:actualRange];
}

// PECoordinator asks this optional adapter method instead of relying on
// NSTextView's responder first-rect implementation. This is screen-space
// Cocoa geometry, which is also what NSEvent.mouseLocation uses.
- (NSRect)caretRect {
    NSRange selection = self.selectedRange;
    if (selection.location == NSNotFound || selection.length != 0) return NSZeroRect;
    NSLayoutManager *layout = self.layoutManager;
    NSTextContainer *container = self.textContainer;
    NSUInteger textLength = self.textStorage.length;
    [layout ensureLayoutForTextContainer:container];

    NSRect caret = NSZeroRect;
    if (textLength == 0) {
        CGFloat height = self.font ? [layout defaultLineHeightForFont:self.font] : 17.0;
        caret = NSMakeRect(self.textContainerOrigin.x, self.textContainerOrigin.y, 1.0, height);
    } else if (selection.location < textLength) {
        NSUInteger glyph = [layout glyphIndexForCharacterAtIndex:selection.location];
        NSRect line = [layout lineFragmentRectForGlyphAtIndex:glyph effectiveRange:NULL];
        NSRect glyphRect = [layout boundingRectForGlyphRange:NSMakeRange(glyph, 1) inTextContainer:container];
        caret = NSMakeRect(self.textContainerOrigin.x + NSMinX(glyphRect),
                           self.textContainerOrigin.y + NSMinY(line), 1.0, NSHeight(line));
    } else {
        NSUInteger lastCharacter = textLength - 1;
        NSRange glyphs = [layout glyphRangeForCharacterRange:NSMakeRange(lastCharacter, 1) actualCharacterRange:NULL];
        NSUInteger glyph = glyphs.location;
        NSRect line = [layout lineFragmentRectForGlyphAtIndex:glyph effectiveRange:NULL];
        NSRect glyphRect = [layout boundingRectForGlyphRange:glyphs inTextContainer:container];
        caret = NSMakeRect(self.textContainerOrigin.x + NSMaxX(glyphRect),
                           self.textContainerOrigin.y + NSMinY(line), 1.0, NSHeight(line));
    }
    return [self.window convertRectToScreen:[self convertRect:caret toView:nil]];
}

// The event location is global screen coordinates. Conversion through the
// window makes this work for wrapped and multi-line marked completions.
- (BOOL)isPointInMarkedText:(NSPoint)screenPoint {
    NSRange marked = self.markedRange;
    if (marked.location == NSNotFound || marked.length == 0 || !self.window) return NO;
    NSPoint windowPoint = [self.window convertPointFromScreen:screenPoint];
    NSPoint viewPoint = [self convertPoint:windowPoint fromView:nil];
    if (!NSPointInRect(viewPoint, self.bounds)) return NO;
    NSUInteger index = [self characterIndexForInsertionAtPoint:viewPoint];
    return index != NSNotFound && index >= marked.location && index <= NSMaxRange(marked);
}

- (void)dealloc {
    [NSNotificationCenter.defaultCenter removeObserver:self];
    [_promptEnhanceCoordinator close];
}

@end

@implementation PEFixtureApplication

- (void)sendEvent:(NSEvent *)event {
    if (event.type == NSEventTypeRightMouseDown) {
        NSResponder *responder = self.keyWindow.firstResponder;
        while (responder && ![responder isKindOfClass:PEFixtureTextView.class]) responder = responder.nextResponder;
        PEFixtureTextView *textView = (PEFixtureTextView *)responder;
        if (textView && event.window == textView.window && [textView preflightRightMouseDown:event]) return;
    }
    [super sendEvent:event];
}

@end

@interface PEFixtureAppDelegate : NSObject <NSApplicationDelegate>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) PEFixtureTextView *textView;
@property (nonatomic, strong) NSTextField *diagnostics;
@property (nonatomic, strong) NSTimer *diagnosticsTimer;
@end

@implementation PEFixtureAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    [self installMenuBar];

    NSRect frame = NSMakeRect(0, 0, 760, 460);
    self.window = [[NSWindow alloc] initWithContentRect:frame
                                               styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                                                 backing:NSBackingStoreBuffered
                                                   defer:NO];
    self.window.title = @"Prompt Enhance Fixture — Native Composer QA";
    self.window.minSize = NSMakeSize(520, 320);
    self.window.releasedWhenClosed = NO;

    NSView *content = self.window.contentView;
    NSTextField *instructions = [NSTextField wrappingLabelWithString:@"Native text-system fixture. Type a prompt and pause for a completion. Tab accepts it; Esc dismisses it. Two-finger click a visible completion to save it, or use the clock button to restore saved versions."];
    instructions.frame = NSMakeRect(20, NSHeight(frame) - 72, NSWidth(frame) - 40, 44);
    instructions.textColor = NSColor.secondaryLabelColor;
    instructions.font = [NSFont systemFontOfSize:13];
    instructions.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin;
    [content addSubview:instructions];

    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(20, 40, NSWidth(frame) - 40, NSHeight(frame) - 124)];
    scroll.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    scroll.hasVerticalScroller = YES;
    scroll.borderType = NSBezelBorder;
    NSTextContainer *container = [[NSTextContainer alloc] initWithContainerSize:NSMakeSize(NSWidth(scroll.contentView.bounds), CGFLOAT_MAX)];
    NSLayoutManager *layoutManager = [NSLayoutManager new];
    NSTextStorage *storage = [NSTextStorage new];
    [layoutManager addTextContainer:container];
    [storage addLayoutManager:layoutManager];
    PEFixtureTextView *textView = [[PEFixtureTextView alloc] initWithFrame:scroll.contentView.bounds textContainer:container];
    textView.minSize = NSMakeSize(0, 0);
    textView.maxSize = NSMakeSize(CGFLOAT_MAX, CGFLOAT_MAX);
    textView.verticallyResizable = YES;
    textView.horizontallyResizable = NO;
    textView.autoresizingMask = NSViewWidthSizable;
    container.widthTracksTextView = YES;
    scroll.documentView = textView;
    [content addSubview:scroll];
    if (!textView.usesSystemInputMethod) [self installPromptEnhanceMenuForTextView:textView];
    self.textView = textView;

    self.diagnostics = [NSTextField labelWithString:@"Native state: waiting for an active editor session…"];
    self.diagnostics.frame = NSMakeRect(20, 12, NSWidth(frame) - 40, 16);
    self.diagnostics.autoresizingMask = NSViewWidthSizable | NSViewMaxYMargin;
    self.diagnostics.font = [NSFont monospacedSystemFontOfSize:10 weight:NSFontWeightRegular];
    self.diagnostics.textColor = NSColor.secondaryLabelColor;
    self.diagnostics.lineBreakMode = NSLineBreakByTruncatingTail;
    self.diagnostics.toolTip = @"Fixture-only native state diagnostic. Prompt text is never displayed here.";
    [content addSubview:self.diagnostics];
    self.diagnosticsTimer = [NSTimer scheduledTimerWithTimeInterval:1.0 target:self selector:@selector(refreshDiagnostics:) userInfo:nil repeats:YES];
    [NSRunLoop.mainRunLoop addTimer:self.diagnosticsTimer forMode:NSRunLoopCommonModes];
    [self refreshDiagnostics:nil];

    [self.window makeFirstResponder:textView];
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)installMenuBar {
    NSMenu *bar = [NSMenu new];
    NSMenuItem *appItem = [NSMenuItem new];
    [bar addItem:appItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Prompt Enhance Fixture"];
    NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:@"Quit Prompt Enhance Fixture" action:@selector(terminate:) keyEquivalent:@"q"];
    [appMenu addItem:quit];
    appItem.submenu = appMenu;

    NSMenuItem *editItem = [NSMenuItem new];
    [bar addItem:editItem];
    NSMenu *edit = [[NSMenu alloc] initWithTitle:@"Edit"];
    for (NSDictionary<NSString *, id> *entry in @[
        @{ @"title": @"Undo", @"action": NSStringFromSelector(@selector(undo:)), @"key": @"z" },
        @{ @"title": @"Redo", @"action": NSStringFromSelector(@selector(redo:)), @"key": @"Z" },
        @{ @"title": @"Cut", @"action": NSStringFromSelector(@selector(cut:)), @"key": @"x" },
        @{ @"title": @"Copy", @"action": NSStringFromSelector(@selector(copy:)), @"key": @"c" },
        @{ @"title": @"Paste", @"action": NSStringFromSelector(@selector(paste:)), @"key": @"v" },
        @{ @"title": @"Select All", @"action": NSStringFromSelector(@selector(selectAll:)), @"key": @"a" },
    ]) {
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:entry[@"title"] action:NSSelectorFromString(entry[@"action"]) keyEquivalent:entry[@"key"]];
        [edit addItem:item];
    }
    editItem.submenu = edit;
    NSApp.mainMenu = bar;
}

- (void)installPromptEnhanceMenuForTextView:(PEFixtureTextView *)textView {
    NSMenuItem *promptEnhanceItem = [NSMenuItem new];
    promptEnhanceItem.title = @"Prompt Enhance";
    promptEnhanceItem.submenu = [textView.promptEnhanceCoordinator inputMenu];
    [NSApp.mainMenu addItem:promptEnhanceItem];
}

- (void)refreshDiagnostics:(NSTimer *)timer {
    (void)timer;
    if (self.textView.usesSystemInputMethod) {
        NSRange marked = self.textView.markedRange;
        self.diagnostics.stringValue = [NSString stringWithFormat:@"System input method mode  len=%lu marked=%@:%@",
            (unsigned long)self.textView.string.length,
            marked.location == NSNotFound ? @"—" : [NSString stringWithFormat:@"%lu", (unsigned long)marked.location],
            marked.location == NSNotFound ? @"—" : [NSString stringWithFormat:@"%lu", (unsigned long)marked.length]];
        return;
    }
    // These values are fixture diagnostics only. Do not read the engine's
    // prompt or suggestion properties: raw user text must never be displayed.
    @try {
        PECoordinator *coordinator = self.textView.promptEnhanceCoordinator;
        id engine = [coordinator valueForKey:@"engine"];
        id palette = [coordinator valueForKey:@"palette"];
        BOOL active = [[engine valueForKey:@"active"] boolValue];
        BOOL enabled = [[engine valueForKey:@"enabled"] boolValue];
        NSRange marked = self.textView.markedRange;
        BOOL paletteVisible = [palette respondsToSelector:@selector(isVisible)] && [palette isVisible];
        NSRect paletteFrame = paletteVisible ? [palette frame] : NSZeroRect;
        NSString *safeError = [engine valueForKey:@"safeError"] ?: @"—";
        NSString *status = [coordinator valueForKey:@"status"] ?: @"—";
        self.diagnostics.stringValue = [NSString stringWithFormat:
            @"Native state  active=%@ enabled=%@ len=%lu marked=%@:%@ palette=%@ (%.0f,%.0f %.0f×%.0f) status=%@ error=%@",
            active ? @"yes" : @"no", enabled ? @"yes" : @"no", (unsigned long)self.textView.string.length,
            marked.location == NSNotFound ? @"—" : [NSString stringWithFormat:@"%lu", (unsigned long)marked.location],
            marked.location == NSNotFound ? @"—" : [NSString stringWithFormat:@"%lu", (unsigned long)marked.length],
            paletteVisible ? @"visible" : @"hidden", NSMinX(paletteFrame), NSMinY(paletteFrame), NSWidth(paletteFrame), NSHeight(paletteFrame),
            status, safeError];
    } @catch (NSException *exception) {
        // Keep fixture instrumentation from affecting the AppKit QA surface.
        self.diagnostics.stringValue = @"Native state unavailable";
    }
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    (void)sender;
    return YES;
}

- (void)dealloc {
    [_diagnosticsTimer invalidate];
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        PEFixtureApplication *application = PEFixtureApplication.sharedApplication;
        PEFixtureAppDelegate *delegate = [PEFixtureAppDelegate new];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
