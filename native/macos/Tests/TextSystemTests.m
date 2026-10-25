// Exercise the real AppKit composition boundary, beyond an in-memory mock.
#import <AppKit/AppKit.h>
#import "PECompletionEngine.h"

@interface PEFixtureTextView : NSTextView <PETextClient>
@end
@implementation PEFixtureTextView
- (NSInteger)length { return (NSInteger)self.string.length; }
- (NSString *)bundleIdentifier { return @"com.promptenhance.input.fixture"; }
- (NSAttributedString *)attributedSubstringFromRange:(NSRange)range {
    NSRange actual;
    return [self attributedSubstringForProposedRange:range actualRange:&actual];
}
- (void)setMarkedText:(id)text selectionRange:(NSRange)selection replacementRange:(NSRange)replacement {
    [super setMarkedText:text selectedRange:selection replacementRange:replacement];
}
@end

static void PEWaitFor(BOOL (^condition)(void)) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2];
    while (!condition() && deadline.timeIntervalSinceNow > 0) {
        [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
    NSCAssert(condition(), @"Native text-system condition timed out");
}

int PETextSystemTests(void) {
    [NSApplication sharedApplication];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 640, 400)
        styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    PEFixtureTextView *view = [[PEFixtureTextView alloc] initWithFrame:window.contentView.bounds];
    view.richText = NO;
    window.contentView = view;
    [window makeFirstResponder:view];
    NSString *base = @"Refactor the 🧑🏽‍💻 billing webhook so transient failures retry with";
    NSString *suffix = @" exponential backoff.";
    view.string = base;
    [view setSelectedRange:NSMakeRange(base.length, 0)];
    PECompletionEngine *engine = [[PECompletionEngine alloc] initWithRequestHandler:^(NSString *prompt, NSUInteger revision, NSUInteger cursor, PECompletionResponse completion) {
        completion(suffix, nil);
    }];
    engine.debounceInterval = 0.01;
    [engine attachClient:view];
    [engine activate];
    [engine scheduleSuggestion];
    PEWaitFor(^BOOL { return engine.suggestion.length > 0; });
    NSCAssert([view.string isEqualToString:[base stringByAppendingString:suffix]], @"Marked suffix must appear inline");
    NSCAssert(NSEqualRanges(view.markedRange, NSMakeRange(base.length, suffix.length)), @"The client must own exactly the suffix");
    [engine dismissSuggestion];
    NSCAssert([view.string isEqualToString:base], @"Dismiss must preserve the original text byte for byte");
    [engine scheduleSuggestion];
    PEWaitFor(^BOOL { return engine.suggestion.length > 0; });
    NSCAssert([engine acceptSuggestion], @"Explicit Tab acceptance should succeed");
    NSCAssert(!view.hasMarkedText, @"Accepted text must be committed");
    NSCAssert([view.string isEqualToString:[base stringByAppendingString:suffix]], @"Accept must append exactly once");
    NSCAssert(![engine acceptSuggestion], @"Repeated Tab may not duplicate a suffix");
    NSString *current = view.string;
    NSCAssert(![engine restorePrompt:@"Wrong" expectedPrompt:base], @"Stale restore may not replace a changed draft");
    NSCAssert([view.string isEqualToString:current], @"Stale restore must leave draft intact");
    NSCAssert([engine restorePrompt:base expectedPrompt:current], @"Explicit restore should replace current draft");
    NSCAssert([view.string isEqualToString:base], @"Restore must preserve Unicode");
    [engine scheduleSuggestion];
    PEWaitFor(^BOOL { return engine.suggestion.length > 0; });
    [engine deactivate];
    NSCAssert([view.string isEqualToString:base], @"Switching away must discard unaccepted ghost text");
    puts("Native AppKit composition checks passed");
    return 0;
}
