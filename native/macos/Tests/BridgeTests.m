// This file intentionally uses MRC like PEInputController. It models the
// short-lived IMK proxy returned by -[IMKInputController client].
#import <AppKit/AppKit.h>
#import <InputMethodKit/InputMethodKit.h>
#import "PECompletionEngine.h"

@interface PEClientAdapter : NSObject <PETextClient>
- (instancetype)initWithOwner:(IMKInputController *)owner;
- (void)invalidate;
@end

static NSUInteger PEEphemeralClientDeallocations;
static NSString *const PEBridgePrompt = @"Write isolated bridge coverage.";

@interface PEEphemeralClient : NSObject
@end
@implementation PEEphemeralClient
- (void)dealloc { PEEphemeralClientDeallocations++; [super dealloc]; }
- (NSRange)selectedRange { return NSMakeRange(PEBridgePrompt.length, 0); }
- (NSRange)markedRange { return NSMakeRange(NSNotFound, 0); }
- (NSInteger)length { return (NSInteger)PEBridgePrompt.length; }
- (NSAttributedString *)attributedSubstringFromRange:(NSRange)range {
    return [[[NSAttributedString alloc] initWithString:[PEBridgePrompt substringWithRange:range]] autorelease];
}
- (NSString *)bundleIdentifier { return @"com.promptenhance.input.fixture"; }
- (void)setMarkedText:(id)text selectionRange:(NSRange)selection replacementRange:(NSRange)replacement { (void)text; (void)selection; (void)replacement; }
- (void)insertText:(id)text replacementRange:(NSRange)replacement { (void)text; (void)replacement; }
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actual { if (actual) *actual = range; return NSMakeRect(1, 1, 1, 16); }
- (NSDictionary *)attributesForCharacterIndex:(NSUInteger)index lineHeightRectangle:(NSRect *)rect { (void)index; if (rect) *rect = NSMakeRect(1, 1, 1, 16); return @{}; }
- (NSInteger)characterIndexForPoint:(NSPoint)point tracking:(NSInteger)tracking inMarkedRange:(BOOL *)inside { (void)point; (void)tracking; if (inside) *inside = NO; return NSNotFound; }
@end

@interface PEFreshClientOwner : NSObject {
@public NSUInteger clientCalls;
}
@end
@implementation PEFreshClientOwner
- (id)client { clientCalls++; return [[[PEEphemeralClient alloc] init] autorelease]; }
@end

static void PEBridgeRequire(BOOL condition, NSString *message) {
    if (!condition) { NSLog(@"BRIDGE TEST FAILURE: %@", message); exit(1); }
}

static void PEBridgeDrain(void) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.03]];
}

int PEBridgeTests(void) {
    @autoreleasepool {
        PEEphemeralClientDeallocations = 0;
        PEFreshClientOwner *owner = [[PEFreshClientOwner alloc] init];
        PEClientAdapter *adapter = [[PEClientAdapter alloc] initWithOwner:(IMKInputController *)owner];
        NSUInteger before = owner->clientCalls;
        @autoreleasepool {
            PEBridgeRequire([[adapter bundleIdentifier] isEqualToString:@"com.promptenhance.input.fixture"], @"fresh proxy supplies bundle identifier");
            PEBridgeRequire([adapter length] == (NSInteger)PEBridgePrompt.length, @"fresh proxy supplies length");
            PEBridgeRequire([adapter selectedRange].location == PEBridgePrompt.length, @"fresh proxy supplies selection");
        }
        PEBridgeRequire(owner->clientCalls >= before + 3, @"adapter asks its controller for each bridge operation");
        PEBridgeRequire(PEEphemeralClientDeallocations >= 3, @"adapter does not cache autoreleased IMK proxies");

        __block NSString *receivedPrompt = nil;
        PECompletionEngine *engine = [[PECompletionEngine alloc] initWithRequestHandler:^(NSString *prompt, NSUInteger revision, NSUInteger cursor, PECompletionResponse completion) {
            (void)revision; (void)cursor; (void)completion;
            receivedPrompt = [prompt copy];
        }];
        engine.debounceInterval = 0;
        [engine attachClient:adapter];
        [engine activate];
        [engine scheduleSuggestion];
        PEBridgeDrain();
        PEBridgeRequire([receivedPrompt isEqualToString:PEBridgePrompt], @"delayed engine snapshot uses fresh proxy safely");

        NSUInteger callsBeforeInvalidation = owner->clientCalls;
        [adapter invalidate];
        PEBridgeRequire([adapter length] == NSNotFound, @"invalidated adapter has no text length");
        PEBridgeRequire([adapter selectedRange].location == NSNotFound, @"invalidated adapter has no selection");
        PEBridgeRequire([adapter markedRange].location == NSNotFound, @"invalidated adapter has no marked range");
        PEBridgeRequire([adapter attributedSubstringFromRange:NSMakeRange(0, 1)] == nil, @"invalidated adapter cannot read text");
        PEBridgeRequire([adapter bundleIdentifier] == nil && owner->clientCalls == callsBeforeInvalidation, @"invalidated adapter never re-queries its owner");
        [engine release];
        [adapter release];
        [owner release];
        puts("InputMethodKit bridge lifetime checks passed");
    }
    return 0;
}
