#import "PEAccessibilityClient.h"

static const NSUInteger PEMaximumPromptUTF16Length = 20000;
static const NSUInteger PEMaximumSuggestionUTF16Length = 4000;

static BOOL PEAllowedBundle(NSString *bundleIdentifier);
static BOOL PEReadAXRange(id value, CFRange *range);
static BOOL PEValidRect(NSRect rect);

@interface PESystemAccessibilityAPI : NSObject <PEAccessibilityAPI>
@end

@implementation PESystemAccessibilityAPI

- (BOOL)isTrusted { return AXIsProcessTrusted(); }

- (AXUIElementRef)copyFocusedElement {
    AXUIElementRef system = AXUIElementCreateSystemWide();
    if (system == NULL) return NULL;
    CFTypeRef focused = NULL;
    AXError error = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute, &focused);
    CFRelease(system);
    return error == kAXErrorSuccess && focused != NULL && CFGetTypeID(focused) == AXUIElementGetTypeID()
        ? (AXUIElementRef)focused
        : (focused != NULL ? (CFRelease(focused), NULL) : NULL);
}

- (AXUIElementRef)copyParentOfElement:(AXUIElementRef)element {
    CFTypeRef parent = NULL;
    AXError error = AXUIElementCopyAttributeValue(element, kAXParentAttribute, &parent);
    return error == kAXErrorSuccess && parent != NULL && CFGetTypeID(parent) == AXUIElementGetTypeID()
        ? (AXUIElementRef)parent
        : (parent != NULL ? (CFRelease(parent), NULL) : NULL);
}

- (id)copyAttribute:(CFStringRef)attribute fromElement:(AXUIElementRef)element {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || value == NULL) return nil;
    return CFBridgingRelease(value);
}

- (AXError)isAttributeSettable:(CFStringRef)attribute onElement:(AXUIElementRef)element settable:(Boolean *)settable {
    return AXUIElementIsAttributeSettable(element, attribute, settable);
}

- (AXError)setAttribute:(CFStringRef)attribute value:(CFTypeRef)value onElement:(AXUIElementRef)element {
    return AXUIElementSetAttributeValue(element, attribute, value);
}

- (AXError)copyBoundsForRange:(CFRange)range fromElement:(AXUIElementRef)element rect:(CGRect *)rect {
    AXValueRef rangeValue = AXValueCreate(kAXValueCFRangeType, &range);
    if (rangeValue == NULL) return kAXErrorFailure;
    CFTypeRef bounds = NULL;
    AXError error = AXUIElementCopyParameterizedAttributeValue(element, kAXBoundsForRangeParameterizedAttribute, rangeValue, &bounds);
    CFRelease(rangeValue);
    if (error != kAXErrorSuccess || bounds == NULL || CFGetTypeID(bounds) != AXValueGetTypeID()) {
        if (bounds != NULL) CFRelease(bounds);
        return error == kAXErrorSuccess ? kAXErrorFailure : error;
    }
    BOOL valid = AXValueGetValue((AXValueRef)bounds, kAXValueCGRectType, rect);
    CFRelease(bounds);
    return valid ? kAXErrorSuccess : kAXErrorFailure;
}

- (pid_t)processIdentifierForElement:(AXUIElementRef)element {
    pid_t pid = 0;
    return AXUIElementGetPid(element, &pid) == kAXErrorSuccess ? pid : 0;
}

- (pid_t)frontmostApplicationPID { return NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier; }
- (NSString *)frontmostApplicationBundleIdentifier { return NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier; }

@end

@interface PEAccessibilityClient ()
// The parent supplies a PEClientAdapter object, not InputMethodKit's temporary
// client proxy. Retaining that adapter keeps this bridge usable between Tab
// and the verified Accessibility re-read.
@property(nonatomic, strong) id<PETextClient> nativeClient;
@property(nonatomic, strong) id<PEAccessibilityAPI> accessibilityAPI;
@property(nonatomic, copy, readwrite, nullable) NSString *safeError;
@property(nonatomic) AXUIElementRef boundElement;
@property(nonatomic) pid_t boundPID;
@end

@implementation PEAccessibilityClient

- (instancetype)initWithNativeClient:(id<PETextClient>)nativeClient {
    return [self initWithNativeClient:nativeClient accessibilityAPI:[PESystemAccessibilityAPI new]];
}

- (instancetype)initWithNativeClient:(id<PETextClient>)nativeClient accessibilityAPI:(id<PEAccessibilityAPI>)accessibilityAPI {
    self = [super init];
    if (self) {
        _nativeClient = nativeClient;
        _accessibilityAPI = accessibilityAPI;
    }
    return self;
}

- (void)dealloc {
    if (_boundElement != NULL) CFRelease(_boundElement);
}

+ (BOOL)isTrusted { return AXIsProcessTrusted(); }

- (BOOL)usesExternalPreview { return YES; }

- (NSString *)bundleIdentifier { return [self.nativeClient bundleIdentifier]; }
- (NSRange)markedRange { return [self.nativeClient markedRange]; }

- (void)setMarkedText:(id)string selectionRange:(NSRange)selectionRange replacementRange:(NSRange)replacementRange {
    // Accessibility preview is drawn externally. Never write IME marked text.
    (void)string; (void)selectionRange; (void)replacementRange;
}

- (NSInteger)length {
    NSString *value = nil;
    NSRange selection;
    return [self readFocusedValue:&value selection:&selection bind:YES] ? (NSInteger)value.length : NSNotFound;
}

- (NSRange)selectedRange {
    NSString *value = nil;
    NSRange selection = NSMakeRange(NSNotFound, 0);
    return [self readFocusedValue:&value selection:&selection bind:YES] ? selection : NSMakeRange(NSNotFound, 0);
}

- (NSAttributedString *)attributedSubstringFromRange:(NSRange)range {
    NSString *value = nil;
    NSRange selection;
    if (![self readFocusedValue:&value selection:&selection bind:YES] || range.location == NSNotFound || NSMaxRange(range) > value.length) return nil;
    return [[NSAttributedString alloc] initWithString:[value substringWithRange:range]];
}

- (void)insertText:(id)text replacementRange:(NSRange)replacementRange {
    NSString *suffix = [text isKindOfClass:NSString.class] ? text : [text string];
    if (suffix.length == 0 || suffix.length > PEMaximumSuggestionUTF16Length || replacementRange.location != NSNotFound) {
        [self setSafeError:@"Codex did not provide a supported draft range."];
        return;
    }
    NSString *value = nil;
    NSRange selection;
    AXUIElementRef current = NULL;
    if (![self copyFocusedValue:&value selection:&selection element:&current] || ![self isCurrentElementBound:current] || selection.length != 0 || selection.location != value.length) {
        if (current != NULL) CFRelease(current);
        [self setSafeError:@"The Codex draft changed before this suggestion could be accepted."];
        return;
    }
    CFRelease(current);
    [self.nativeClient insertText:suffix replacementRange:replacementRange];
}

- (BOOL)replaceEntireDraft:(NSString *)prompt expectedPrompt:(NSString *)expectedPrompt {
    if (prompt.length > PEMaximumPromptUTF16Length || expectedPrompt.length > PEMaximumPromptUTF16Length) {
        [self setSafeError:@"That prompt cannot be restored here."];
        return NO;
    }
    NSString *currentValue = nil;
    NSRange selection;
    AXUIElementRef element = NULL;
    if (![self copyFocusedValue:&currentValue selection:&selection element:&element]
        || ![self isCurrentElementBound:element]
        || ![currentValue isEqualToString:expectedPrompt]
        || selection.length != 0
        || selection.location != currentValue.length) {
        if (element != NULL) CFRelease(element);
        [self setSafeError:@"The Codex draft changed before this version could be restored."];
        return NO;
    }

    Boolean settable = false;
    AXError settableError = [self.accessibilityAPI isAttributeSettable:kAXValueAttribute onElement:element settable:&settable];
    if (settableError == kAXErrorSuccess && settable) {
        AXError error = [self.accessibilityAPI setAttribute:kAXValueAttribute value:(__bridge CFTypeRef)prompt onElement:element];
        if (error != kAXErrorSuccess) {
            CFRelease(element);
            [self setSafeError:@"The Codex draft could not be restored."];
            return NO;
        }
        CFRange caret = CFRangeMake(prompt.length, 0);
        AXValueRef caretValue = AXValueCreate(kAXValueCFRangeType, &caret);
        AXError caretError = caretValue == NULL ? kAXErrorFailure
            : [self.accessibilityAPI setAttribute:kAXSelectedTextRangeAttribute value:caretValue onElement:element];
        if (caretValue != NULL) CFRelease(caretValue);
        CFRelease(element);
        if (caretError == kAXErrorSuccess && [self currentValueEquals:prompt caretAtEnd:YES]) {
            [self setSafeError:nil];
            return YES;
        }
        [self setSafeError:@"The Codex draft could not be restored."];
        return NO;
    }

    CFRange allText = CFRangeMake(0, currentValue.length);
    AXValueRef rangeValue = AXValueCreate(kAXValueCFRangeType, &allText);
    AXError selectError = rangeValue == NULL ? kAXErrorFailure
        : [self.accessibilityAPI setAttribute:kAXSelectedTextRangeAttribute value:rangeValue onElement:element];
    if (rangeValue != NULL) CFRelease(rangeValue);
    CFRelease(element);
    if (selectError != kAXErrorSuccess) {
        [self setSafeError:@"The selected Codex draft cannot be restored."];
        return NO;
    }
    [self.nativeClient insertText:prompt replacementRange:NSMakeRange(0, currentValue.length)];
    if ([self currentValueEquals:prompt caretAtEnd:YES]) {
        [self setSafeError:nil];
        return YES;
    }
    [self restoreSelection:selection whenFocusedValueEquals:expectedPrompt];
    [self setSafeError:@"The Codex draft could not be restored."];
    return NO;
}

- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actualRange {
    if (actualRange != NULL) *actualRange = range;
    NSRect nativeRect = [self nativeCaretRect];
    if (PEValidRect(nativeRect)) return nativeRect;
    return [self accessibilityRectForRange:range];
}

- (NSRect)caretRect {
    NSRect nativeRect = [self nativeCaretRect];
    if (PEValidRect(nativeRect)) return nativeRect;
    NSString *value = nil;
    NSRange selection;
    if (![self readFocusedValue:&value selection:&selection bind:YES]) return NSZeroRect;
    return [self accessibilityRectForRange:NSMakeRange(selection.location, 0)];
}

- (NSRect)nativeCaretRect {
    if ([self.nativeClient respondsToSelector:@selector(caretRect)]) {
        NSRect rect = [self.nativeClient caretRect];
        if (PEValidRect(rect)) return rect;
    }
    return NSZeroRect;
}

- (NSRect)accessibilityRectForRange:(NSRange)range {
    NSString *value = nil;
    NSRange selection;
    AXUIElementRef element = NULL;
    if (![self copyFocusedValue:&value selection:&selection element:&element] || range.location == NSNotFound || NSMaxRange(range) > value.length) {
        if (element != NULL) CFRelease(element);
        return NSZeroRect;
    }
    CGRect quartzRect = CGRectZero;
    AXError error = [self.accessibilityAPI copyBoundsForRange:CFRangeMake(range.location, range.length) fromElement:element rect:&quartzRect];
    CFRelease(element);
    if (error != kAXErrorSuccess || !isfinite(quartzRect.origin.x) || !isfinite(quartzRect.origin.y)
        || !isfinite(quartzRect.size.width) || !isfinite(quartzRect.size.height)
        || quartzRect.size.width < 0 || quartzRect.size.height <= 0) return NSZeroRect;
    NSScreen *primaryScreen = NSScreen.screens.firstObject ?: NSScreen.mainScreen;
    CGFloat top = primaryScreen != nil ? NSMaxY(primaryScreen.frame) : 0;
    return NSMakeRect(CGRectGetMinX(quartzRect), top - CGRectGetMaxY(quartzRect), CGRectGetWidth(quartzRect), CGRectGetHeight(quartzRect));
}

- (BOOL)readFocusedValue:(NSString * _Nullable * _Nonnull)value selection:(NSRange *)selection bind:(BOOL)bind {
    AXUIElementRef element = NULL;
    BOOL found = [self copyFocusedValue:value selection:selection element:&element];
    if (!found) return NO;
    if (bind) [self bindElement:element];
    CFRelease(element);
    return YES;
}

- (BOOL)copyFocusedValue:(NSString * _Nullable * _Nonnull)value selection:(NSRange *)selection element:(AXUIElementRef _Nullable * _Nonnull)outElement {
    *value = nil;
    *selection = NSMakeRange(NSNotFound, 0);
    *outElement = NULL;
    if (![self.accessibilityAPI isTrusted]) {
        [self setSafeError:@"Accessibility permission is required to read the active Codex draft."];
        return NO;
    }
    NSString *clientBundle = self.nativeClient.bundleIdentifier;
    NSString *frontBundle = [self.accessibilityAPI frontmostApplicationBundleIdentifier];
    pid_t frontPID = [self.accessibilityAPI frontmostApplicationPID];
    if (!PEAllowedBundle(clientBundle) || ![frontBundle isEqualToString:clientBundle] || frontPID <= 0) {
        [self setSafeError:@"Prompt Enhance can only access the active Codex draft."];
        return NO;
    }

    AXUIElementRef candidate = [self.accessibilityAPI copyFocusedElement];
    for (NSUInteger depth = 0; candidate != NULL && depth <= 3; depth++) {
        pid_t elementPID = [self.accessibilityAPI processIdentifierForElement:candidate];
        id role = [self.accessibilityAPI copyAttribute:kAXRoleAttribute fromElement:candidate];
        id subrole = [self.accessibilityAPI copyAttribute:kAXSubroleAttribute fromElement:candidate];
        BOOL isTextArea = [role isKindOfClass:NSString.class] && [role isEqualToString:(__bridge NSString *)kAXTextAreaRole];
        BOOL isSecure = ([role isKindOfClass:NSString.class] && [role isEqualToString:@"AXSecureTextField"])
            || ([subrole isKindOfClass:NSString.class] && [subrole isEqualToString:@"AXSecureTextField"]);
        if (isSecure) {
            CFRelease(candidate);
            [self setSafeError:@"Prompt Enhance cannot access secure text fields."];
            return NO;
        }
        if (elementPID == frontPID && isTextArea && !isSecure) {
            id rawValue = [self.accessibilityAPI copyAttribute:kAXValueAttribute fromElement:candidate];
            id rawRange = [self.accessibilityAPI copyAttribute:kAXSelectedTextRangeAttribute fromElement:candidate];
            CFRange axRange;
            if ([rawValue isKindOfClass:NSString.class] && [(NSString *)rawValue length] <= PEMaximumPromptUTF16Length
                && PEReadAXRange(rawRange, &axRange) && axRange.location >= 0 && axRange.length >= 0
                && (NSUInteger)(axRange.location + axRange.length) <= [(NSString *)rawValue length]) {
                *value = rawValue;
                *selection = NSMakeRange((NSUInteger)axRange.location, (NSUInteger)axRange.length);
                *outElement = candidate;
                return YES;
            }
            [self setSafeError:@"Codex did not provide a supported Accessibility draft."];
        }
        AXUIElementRef parent = depth < 3 ? [self.accessibilityAPI copyParentOfElement:candidate] : NULL;
        CFRelease(candidate);
        candidate = parent;
    }
    [self setSafeError:@"Prompt Enhance requires the focused Codex message field."];
    return NO;
}

- (void)bindElement:(AXUIElementRef)element {
    if (_boundElement != NULL) CFRelease(_boundElement);
    _boundElement = (AXUIElementRef)CFRetain(element);
    _boundPID = [self.accessibilityAPI processIdentifierForElement:element];
}

- (BOOL)isCurrentElementBound:(AXUIElementRef)element {
    return _boundElement != NULL && _boundPID == [self.accessibilityAPI processIdentifierForElement:element] && CFEqual(_boundElement, element);
}

- (BOOL)currentValueEquals:(NSString *)expected caretAtEnd:(BOOL)caretAtEnd {
    NSString *value = nil;
    NSRange selection;
    AXUIElementRef element = NULL;
    BOOL valid = [self copyFocusedValue:&value selection:&selection element:&element]
        && [self isCurrentElementBound:element]
        && [value isEqualToString:expected]
        && (!caretAtEnd || (selection.length == 0 && selection.location == value.length));
    if (element != NULL) CFRelease(element);
    return valid;
}

- (void)restoreSelection:(NSRange)selection whenFocusedValueEquals:(NSString *)expected {
    NSString *value = nil;
    NSRange currentSelection;
    AXUIElementRef element = NULL;
    BOOL valid = [self copyFocusedValue:&value selection:&currentSelection element:&element]
        && [self isCurrentElementBound:element]
        && [value isEqualToString:expected];
    if (!valid) {
        if (element != NULL) CFRelease(element);
        return;
    }
    CFRange original = CFRangeMake(selection.location, selection.length);
    AXValueRef originalValue = AXValueCreate(kAXValueCFRangeType, &original);
    if (originalValue != NULL) {
        [self.accessibilityAPI setAttribute:kAXSelectedTextRangeAttribute value:originalValue onElement:element];
        CFRelease(originalValue);
    }
    CFRelease(element);
}

- (void)setSafeError:(NSString *)safeError { _safeError = [safeError copy]; }

@end

static BOOL PEAllowedBundle(NSString *bundleIdentifier) {
    return [bundleIdentifier isEqualToString:@"com.openai.codex"]
        || [bundleIdentifier isEqualToString:@"com.promptenhance.input.fixture"];
}

static BOOL PEReadAXRange(id value, CFRange *range) {
    if (value == nil || CFGetTypeID((__bridge CFTypeRef)value) != AXValueGetTypeID()) return NO;
    return AXValueGetType((AXValueRef)(__bridge CFTypeRef)value) == kAXValueCFRangeType
        && AXValueGetValue((AXValueRef)(__bridge CFTypeRef)value, kAXValueCFRangeType, range);
}

static BOOL PEValidRect(NSRect rect) {
    return isfinite(rect.origin.x) && isfinite(rect.origin.y) && rect.size.width >= 0 && rect.size.height > 0;
}
