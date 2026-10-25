// Keep the legacy InputMethodKit controller and client proxy outside ARC.
#import <InputMethodKit/InputMethodKit.h>
#import "PECoordinator.h"

@interface PEClientAdapter : NSObject <PETextClient> {
    IMKInputController *_owner; // Assign only; InputMethodKit owns its proxy.
}
- (instancetype)initWithOwner:(IMKInputController *)owner;
- (void)invalidate;
@end

@implementation PEClientAdapter
- (instancetype)initWithOwner:(IMKInputController *)owner {
    if ((self = [super init])) _owner = owner;
    return self;
}
- (void)invalidate { _owner = nil; }

// IMKInputController documents -client as an autoreleased proxy. Never retain
// or cache that proxy: a delayed completion may otherwise dereference it after
// InputMethodKit has recycled the callback's autorelease pool.
- (id<IMKTextInput>)freshInput {
    return _owner ? [_owner client] : nil;
}
- (NSRange)selectedRange {
    @autoreleasepool { id<IMKTextInput> input = [self freshInput]; return input ? [input selectedRange] : NSMakeRange(NSNotFound, 0); }
}
- (NSRange)markedRange {
    @autoreleasepool { id<IMKTextInput> input = [self freshInput]; return input ? [input markedRange] : NSMakeRange(NSNotFound, 0); }
}
- (NSInteger)length {
    @autoreleasepool { id<IMKTextInput> input = [self freshInput]; return input ? [input length] : NSNotFound; }
}
- (NSAttributedString *)attributedSubstringFromRange:(NSRange)range {
    NSAttributedString *result = nil;
    @autoreleasepool { id<IMKTextInput> input = [self freshInput]; result = [[input attributedSubstringFromRange:range] copy]; }
    return [result autorelease];
}
- (NSString *)bundleIdentifier {
    NSString *result = nil;
    @autoreleasepool { id<IMKTextInput> input = [self freshInput]; result = [[input bundleIdentifier] copy]; }
    return [result autorelease];
}
- (void)setMarkedText:(id)text selectionRange:(NSRange)selection replacementRange:(NSRange)replacement {
    @autoreleasepool { id<IMKTextInput> input = [self freshInput]; if (input) [input setMarkedText:text selectionRange:selection replacementRange:replacement]; }
}
- (void)insertText:(id)text replacementRange:(NSRange)replacement {
    @autoreleasepool { id<IMKTextInput> input = [self freshInput]; if (input) [input insertText:text replacementRange:replacement]; }
}
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actual {
    @autoreleasepool { id<IMKTextInput> input = [self freshInput]; return input ? [input firstRectForCharacterRange:range actualRange:actual] : NSZeroRect; }
}
- (NSRect)caretRect {
    NSRect rect = NSZeroRect;
    @autoreleasepool { id<IMKTextInput> input = [self freshInput]; if (input) [input attributesForCharacterIndex:0 lineHeightRectangle:&rect]; }
    return rect;
}
- (BOOL)isPointInMarkedText:(NSPoint)point {
    @autoreleasepool {
        id<IMKTextInput> input = [self freshInput];
        if (!input) return NO;
        BOOL inside = NO;
        NSInteger index = [input characterIndexForPoint:point tracking:kIMKNearestBoundaryMode inMarkedRange:&inside];
        return index != NSNotFound && inside;
    }
}
@end

@interface PEInputController : IMKInputController {
    PEClientAdapter *_adapter;
    PECoordinator *_coordinator;
}
@end

@implementation PEInputController
- (id)initWithServer:(IMKServer *)server delegate:(id)delegate client:(id)client {
    self = [super initWithServer:server delegate:delegate client:client];
    if (self) {
        _adapter = [[PEClientAdapter alloc] initWithOwner:self];
        _coordinator = [[PECoordinator alloc] initWithClient:_adapter];
    }
    return self;
}
- (void)activateServer:(id)sender { [_coordinator activate]; }
- (void)deactivateServer:(id)sender { [_coordinator deactivate]; }
- (NSUInteger)recognizedEvents:(id)sender {
    return NSEventMaskKeyDown | NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown;
}
- (BOOL)handleEvent:(NSEvent *)event client:(id)sender { return [_coordinator handleEvent:event]; }
- (void)commitComposition:(id)sender { [_coordinator dismiss]; }
- (NSMenu *)menu { return [_coordinator inputMenu]; }
- (void)doCommandBySelector:(SEL)selector commandDictionary:(NSDictionary *)context {
    if ([_coordinator respondsToSelector:selector]) {
        [NSApp sendAction:selector to:_coordinator from:context[kIMKCommandMenuItemName]];
    } else {
        [super doCommandBySelector:selector commandDictionary:context];
    }
}
- (void)inputControllerWillClose {
    [_coordinator close];
    [_adapter invalidate];
    [super inputControllerWillClose];
}
- (void)dealloc {
    [_coordinator close];
    [_adapter invalidate];
    [_coordinator release];
    [_adapter release];
    [super dealloc];
}
@end
