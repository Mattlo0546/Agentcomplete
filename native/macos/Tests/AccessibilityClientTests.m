#import <AppKit/AppKit.h>
#import "PEAccessibilityClient.h"

@interface PENativeClientMock : NSObject <PETextClient>
@property(nonatomic, copy) NSString *bundle;
@property(nonatomic) NSRange marked;
@property(nonatomic, copy) NSString *insertedText;
@property(nonatomic) NSRange insertedRange;
@property(nonatomic, copy) void (^didInsert)(NSString *, NSRange);
@property(nonatomic) NSRect nativeCaret;
@end

@implementation PENativeClientMock
- (instancetype)init {
    if ((self = [super init])) {
        _bundle = @"com.openai.codex";
        _marked = NSMakeRange(NSNotFound, 0);
        _insertedRange = NSMakeRange(NSNotFound, 0);
    }
    return self;
}
- (NSRange)selectedRange { return NSMakeRange(NSNotFound, 0); }
- (NSRange)markedRange { return _marked; }
- (NSAttributedString *)attributedSubstringFromRange:(NSRange)range { (void)range; return nil; }
- (NSInteger)length { return NSNotFound; }
- (void)setMarkedText:(id)string selectionRange:(NSRange)selection replacementRange:(NSRange)replacement {
    (void)string; (void)selection; (void)replacement;
}
- (void)insertText:(id)string replacementRange:(NSRange)replacement {
    _insertedText = [string isKindOfClass:NSString.class] ? string : [string string];
    _insertedRange = replacement;
    if (_didInsert) _didInsert(_insertedText, replacement);
}
- (NSString *)bundleIdentifier { return _bundle; }
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actualRange {
    if (actualRange != NULL) *actualRange = range;
    return _nativeCaret;
}
- (NSRect)caretRect { return _nativeCaret; }
@end

@interface PEAccessibilityAPIMock : NSObject <PEAccessibilityAPI> {
    AXUIElementRef _primary;
    AXUIElementRef _alternate;
    AXUIElementRef _child;
}
@property(nonatomic) BOOL trusted;
@property(nonatomic, copy) NSString *frontBundle;
@property(nonatomic) pid_t frontPID;
@property(nonatomic, copy) NSString *value;
@property(nonatomic) CFRange selectedRange;
@property(nonatomic) BOOL settableValue;
@property(nonatomic) AXError valueSetError;
@property(nonatomic) BOOL secure;
@property(nonatomic) BOOL useAlternate;
@property(nonatomic) BOOL focusedChild;
@property(nonatomic) NSUInteger focusedCallCount;
@property(nonatomic) NSUInteger parentCallCount;
@property(nonatomic) NSUInteger valueSetCount;
@property(nonatomic) NSUInteger rangeSetCount;
@property(nonatomic) CGRect bounds;
@property(nonatomic) AXError boundsError;
@end

@implementation PEAccessibilityAPIMock
- (instancetype)init {
    if ((self = [super init])) {
        _primary = AXUIElementCreateApplication(701);
        _alternate = AXUIElementCreateApplication(702);
        _child = AXUIElementCreateApplication(703);
        _trusted = YES;
        _frontBundle = @"com.openai.codex";
        _frontPID = 701;
        _value = @"Draft accessible to the adapter";
        _selectedRange = CFRangeMake(_value.length, 0);
        _settableValue = YES;
        _bounds = CGRectMake(16, 24, 0, 18);
    }
    return self;
}
- (void)dealloc {
    if (_primary != NULL) CFRelease(_primary);
    if (_alternate != NULL) CFRelease(_alternate);
    if (_child != NULL) CFRelease(_child);
}
- (AXUIElementRef)current { return _focusedChild ? _child : (_useAlternate ? _alternate : _primary); }
- (BOOL)isTrusted { return _trusted; }
- (AXUIElementRef)copyFocusedElement {
    _focusedCallCount++;
    return (AXUIElementRef)CFRetain(self.current);
}
- (AXUIElementRef)copyParentOfElement:(AXUIElementRef)element {
    _parentCallCount++;
    return CFEqual(element, _child) ? (AXUIElementRef)CFRetain(_primary) : NULL;
}
- (id)copyAttribute:(CFStringRef)attribute fromElement:(AXUIElementRef)element {
    if (CFEqual(element, _child)) {
        if (CFEqual(attribute, kAXRoleAttribute)) return [@"AXGroup" copy];
        return nil;
    }
    if (!CFEqual(element, self.current)) return nil;
    if (CFEqual(attribute, kAXRoleAttribute)) return [(__bridge NSString *)kAXTextAreaRole copy];
    if (CFEqual(attribute, kAXSubroleAttribute)) return _secure ? [@"AXSecureTextField" copy] : nil;
    if (CFEqual(attribute, kAXValueAttribute)) return [_value copy];
    if (CFEqual(attribute, kAXSelectedTextRangeAttribute)) {
        AXValueRef value = AXValueCreate(kAXValueCFRangeType, &_selectedRange);
        return CFBridgingRelease(value);
    }
    return nil;
}
- (AXError)isAttributeSettable:(CFStringRef)attribute onElement:(AXUIElementRef)element settable:(Boolean *)settable {
    if (!CFEqual(element, self.current) || !CFEqual(attribute, kAXValueAttribute)) return kAXErrorInvalidUIElement;
    *settable = _settableValue;
    return kAXErrorSuccess;
}
- (AXError)setAttribute:(CFStringRef)attribute value:(CFTypeRef)value onElement:(AXUIElementRef)element {
    if (!CFEqual(element, self.current)) return kAXErrorInvalidUIElement;
    if (CFEqual(attribute, kAXValueAttribute)) {
        if (_valueSetError != kAXErrorSuccess) return _valueSetError;
        _value = [(__bridge NSString *)value copy];
        _valueSetCount++;
        return kAXErrorSuccess;
    }
    if (CFEqual(attribute, kAXSelectedTextRangeAttribute)
        && AXValueGetType((AXValueRef)value) == kAXValueCFRangeType
        && AXValueGetValue((AXValueRef)value, kAXValueCFRangeType, &_selectedRange)) {
        _rangeSetCount++;
        return kAXErrorSuccess;
    }
    return kAXErrorAttributeUnsupported;
}
- (AXError)copyBoundsForRange:(CFRange)range fromElement:(AXUIElementRef)element rect:(CGRect *)rect {
    (void)range;
    if (!CFEqual(element, self.current)) return kAXErrorInvalidUIElement;
    if (_boundsError != kAXErrorSuccess) return _boundsError;
    *rect = _bounds;
    return kAXErrorSuccess;
}
- (pid_t)processIdentifierForElement:(AXUIElementRef)element {
    return (CFEqual(element, _primary) || CFEqual(element, _child)) ? 701 : (CFEqual(element, _alternate) ? 702 : 0);
}
- (pid_t)frontmostApplicationPID { return _frontPID; }
- (NSString *)frontmostApplicationBundleIdentifier { return _frontBundle; }
@end

static void PEAccessRequire(BOOL condition, NSString *message) {
    if (!condition) {
        NSLog(@"FAIL: %@", message);
        exit(1);
    }
}

static PEAccessibilityClient *PEAccessClient(PENativeClientMock **nativeOut, PEAccessibilityAPIMock **apiOut) {
    PENativeClientMock *native = [PENativeClientMock new];
    PEAccessibilityAPIMock *api = [PEAccessibilityAPIMock new];
    if (nativeOut != NULL) *nativeOut = native;
    if (apiOut != NULL) *apiOut = api;
    return [[PEAccessibilityClient alloc] initWithNativeClient:native accessibilityAPI:api];
}

static void TestUntrustedNeverReadsAccessibility(void) {
    PEAccessibilityAPIMock *api = nil;
    PEAccessibilityClient *client = PEAccessClient(NULL, &api);
    api.trusted = NO;
    PEAccessRequire(client.length == NSNotFound, @"untrusted accessibility client must be inert");
    PEAccessRequire(api.focusedCallCount == 0, @"authorization is checked before AX focused-element access");
    PEAccessRequire([client.safeError containsString:@"Accessibility permission"], @"untrusted state has a generic explanation");
}

static void TestReadsFullAccessibilityValueAndUsesExternalPreview(void) {
    PENativeClientMock *native = nil;
    PEAccessibilityAPIMock *api = nil;
    PEAccessibilityClient *client = PEAccessClient(&native, &api);
    PEAccessRequire(client.length == (NSInteger)api.value.length, @"length comes from the full AX value, not the IME cache");
    PEAccessRequire(NSEqualRanges(client.selectedRange, NSMakeRange(api.value.length, 0)), @"selection comes from AXSelectedTextRange");
    PEAccessRequire([[client attributedSubstringFromRange:NSMakeRange(0, 5)].string isEqualToString:@"Draft"], @"full AX value is sliceable");
    PEAccessRequire([client usesExternalPreview], @"accessibility path requests an external preview");
    [client setMarkedText:@"never inserted" selectionRange:NSMakeRange(0, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
    PEAccessRequire(native.marked.location == NSNotFound, @"accessibility preview never creates native marked text");
}

static void TestSecureFieldIsRejectedWithoutParentTraversal(void) {
    PEAccessibilityAPIMock *api = nil;
    PEAccessibilityClient *client = PEAccessClient(NULL, &api);
    api.secure = YES;
    PEAccessRequire(client.length == NSNotFound, @"secure accessibility fields are never readable");
    PEAccessRequire(api.parentCallCount == 0, @"a secure focused leaf is rejected before a parent walk");
}

static void TestExternalGeometryUsesAuthorizedAXBoundsInsteadOfNativePlaceholders(void) {
    PENativeClientMock *native = nil;
    PEAccessibilityAPIMock *api = nil;
    PEAccessibilityClient *client = PEAccessClient(&native, &api);
    native.nativeCaret = NSMakeRect(0, 0, 1, 18);
    NSRange range = NSMakeRange(api.value.length, 0);
    NSRect caret = [client firstRectForCharacterRange:range actualRange:NULL];
    NSScreen *primary = NSScreen.screens.firstObject ?: NSScreen.mainScreen;
    CGFloat top = primary ? NSMaxY(primary.frame) : 0;
    NSRect expected = NSMakeRect(16, top - 42, 0, 18);
    PEAccessRequire(NSEqualRects(caret, expected), @"AX zero-width caret overrides a finite native placeholder");
    PEAccessRequire(NSEqualRects([client caretRect], expected), @"caret fallback also uses only verified AX geometry");

    api.boundsError = kAXErrorParameterizedAttributeUnsupported;
    PEAccessRequire(NSEqualRects([client firstRectForCharacterRange:range actualRange:NULL], NSZeroRect), @"missing AX bounds cannot fall back to a detached native clock");
    PEAccessRequire(NSEqualRects([client caretRect], NSZeroRect), @"unsupported AX geometry stays unavailable");

    api.boundsError = kAXErrorSuccess;
    api.trusted = NO;
    NSUInteger priorReads = api.focusedCallCount;
    PEAccessRequire(NSEqualRects([client firstRectForCharacterRange:range actualRange:NULL], NSZeroRect), @"untrusted helper cannot use native geometry to appear operational");
    PEAccessRequire(api.focusedCallCount == priorReads, @"geometry checks never inspect the focused field before authorization");
}

static void TestFocusedChildNeverEscalatesToAParentTextArea(void) {
    PEAccessibilityAPIMock *api = nil;
    PEAccessibilityClient *client = PEAccessClient(NULL, &api);
    api.focusedChild = YES;
    PEAccessRequire(client.length == NSNotFound, @"a focused child control is not a readable draft");
    PEAccessRequire(api.parentCallCount == 0, @"the adapter never walks from a focused child into a broader parent text area");
}

static void TestTabInsertRequiresTheBoundFocusedField(void) {
    PENativeClientMock *native = nil;
    PEAccessibilityAPIMock *api = nil;
    PEAccessibilityClient *client = PEAccessClient(&native, &api);
    (void)client.length; // Bind the approved focused AX text area.
    [client insertText:@" safely" replacementRange:NSMakeRange(NSNotFound, 0)];
    PEAccessRequire([native.insertedText isEqualToString:@" safely"], @"explicit Tab may delegate an accepted suffix to the native client");
    native.insertedText = nil;
    api.useAlternate = YES;
    api.frontPID = 702;
    [client insertText:@" wrong field" replacementRange:NSMakeRange(NSNotFound, 0)];
    PEAccessRequire(native.insertedText == nil, @"a changed focused field cannot receive a delegated write");
}

static void TestRestoreRevalidatesAndUsesSettableAXValue(void) {
    PEAccessibilityAPIMock *api = nil;
    PEAccessibilityClient *client = PEAccessClient(NULL, &api);
    NSString *expected = api.value;
    (void)client.length;
    PEAccessRequire([client replaceEntireDraft:@"Restored complete draft" expectedPrompt:expected], @"settable AX value restores an unchanged exact draft");
    PEAccessRequire([api.value isEqualToString:@"Restored complete draft"] && api.valueSetCount == 1, @"restore uses AXValue atomically when supported");
    PEAccessRequire(![client replaceEntireDraft:@"Nope" expectedPrompt:expected], @"stale expected draft is refused");
}

static void TestRestoreFallbackUsesSelectedRangeAndNativeInsert(void) {
    PENativeClientMock *native = nil;
    PEAccessibilityAPIMock *api = nil;
    PEAccessibilityClient *client = PEAccessClient(&native, &api);
    api.settableValue = NO;
    NSString *expected = api.value;
    native.didInsert = ^(NSString *text, NSRange range) {
        api.value = [api.value stringByReplacingCharactersInRange:range withString:text];
        api.selectedRange = CFRangeMake(api.value.length, 0);
    };
    (void)client.length;
    PEAccessRequire([client replaceEntireDraft:@"Fallback restored" expectedPrompt:expected], @"read-only AXValue falls back to selected-range native insertion");
    PEAccessRequire(api.rangeSetCount == 1 && [native.insertedText isEqualToString:@"Fallback restored"], @"fallback selects exactly the complete expected draft before native insertion");
}

static void TestFailedWritesPreserveOrRestoreTheOriginalSelection(void) {
    PEAccessibilityAPIMock *api = nil;
    PEAccessibilityClient *client = PEAccessClient(NULL, &api);
    NSString *expected = api.value;
    CFRange original = api.selectedRange;
    (void)client.length;
    api.valueSetError = kAXErrorCannotComplete;
    PEAccessRequire(![client replaceEntireDraft:@"Must not write" expectedPrompt:expected], @"a failed AX value write fails closed");
    PEAccessRequire(api.rangeSetCount == 0 && api.selectedRange.location == original.location && api.selectedRange.length == original.length, @"failed AX value write does not move the caret");

    PENativeClientMock *native = nil;
    client = PEAccessClient(&native, &api);
    api.valueSetError = kAXErrorSuccess;
    api.settableValue = NO;
    api.selectedRange = CFRangeMake(api.value.length, 0);
    original = api.selectedRange;
    (void)client.length;
    PEAccessRequire(![client replaceEntireDraft:@"Native no-op" expectedPrompt:expected], @"a no-op native fallback reports failure");
    PEAccessRequire(api.selectedRange.location == original.location && api.selectedRange.length == original.length, @"no-op fallback restores the original selection only after exact revalidation");
}

int PEAccessibilityClientTests(void) {
    @autoreleasepool {
        TestUntrustedNeverReadsAccessibility();
        TestReadsFullAccessibilityValueAndUsesExternalPreview();
        TestSecureFieldIsRejectedWithoutParentTraversal();
        TestExternalGeometryUsesAuthorizedAXBoundsInsteadOfNativePlaceholders();
        TestFocusedChildNeverEscalatesToAParentTextArea();
        TestTabInsertRequiresTheBoundFocusedField();
        TestRestoreRevalidatesAndUsesSettableAXValue();
        TestRestoreFallbackUsesSelectedRangeAndNativeInsert();
        TestFailedWritesPreserveOrRestoreTheOriginalSelection();
        NSLog(@"PEAccessibilityClient tests passed");
    }
    return 0;
}
