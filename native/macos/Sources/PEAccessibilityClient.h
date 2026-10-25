#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import "PECompletionEngine.h"

NS_ASSUME_NONNULL_BEGIN

/// Narrow public-API seam for deterministic unit tests. Production uses the
/// system implementation; callers must not manufacture AX elements.
@protocol PEAccessibilityAPI <NSObject>
- (BOOL)isTrusted;
- (nullable AXUIElementRef)copyFocusedElement CF_RETURNS_RETAINED;
- (nullable AXUIElementRef)copyParentOfElement:(AXUIElementRef)element CF_RETURNS_RETAINED;
- (nullable id)copyAttribute:(CFStringRef)attribute fromElement:(AXUIElementRef)element;
- (AXError)isAttributeSettable:(CFStringRef)attribute onElement:(AXUIElementRef)element settable:(Boolean *)settable;
- (AXError)setAttribute:(CFStringRef)attribute value:(CFTypeRef)value onElement:(AXUIElementRef)element;
/// Electron applications need this documented, per-process opt-in before
/// they expose their Accessibility tree to third-party assistive software.
/// Test doubles record this call without constructing a real application AX
/// element.
- (AXError)enableAccessibilityForApplicationPID:(pid_t)pid;
- (AXError)copyBoundsForRange:(CFRange)range fromElement:(AXUIElementRef)element rect:(CGRect *)rect;
- (pid_t)processIdentifierForElement:(AXUIElementRef)element;
- (pid_t)frontmostApplicationPID;
- (nullable NSString *)frontmostApplicationBundleIdentifier;
@end

/// Text-client bridge for a user-authorized Accessibility session. The bridge
/// is inert until macOS reports Accessibility permission. Ordinary client
/// reads never request permission, and the bridge never synthesizes input.
@interface PEAccessibilityClient : NSObject <PETextClient>

- (instancetype)initWithNativeClient:(id<PETextClient>)nativeClient;

/// Dependency-injection initializer used by isolated unit tests only.
- (instancetype)initWithNativeClient:(id<PETextClient>)nativeClient
                    accessibilityAPI:(id<PEAccessibilityAPI>)accessibilityAPI;

/// The most recent non-sensitive Accessibility failure, suitable for status UI.
@property(nonatomic, copy, readonly, nullable) NSString *safeError;

/// Reads the current system Accessibility authorization without requesting it.
+ (BOOL)isTrusted;

/// May be invoked only for an explicit user setup action, inside the installed
/// input-helper process. Requests macOS authorization and returns the current
/// trust state; a displayed prompt does not mean the user has granted access.
/// Other processes, including Setup and test fixtures, never prompt here.
+ (BOOL)requestAccessibilityPermission;

/// Atomically restore a complete draft only while the focused Codex element and
/// its full Accessibility value still equal `expectedPrompt`.
- (BOOL)replaceEntireDraft:(NSString *)prompt expectedPrompt:(NSString *)expectedPrompt;

@end

NS_ASSUME_NONNULL_END
