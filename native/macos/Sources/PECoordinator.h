#import <AppKit/AppKit.h>
#import "PECompletionEngine.h"

@class PEBackendClient;
NS_ASSUME_NONNULL_BEGIN
typedef void (^PEMenuPresenter)(NSMenu *menu, NSPoint point);

@interface PECoordinator : NSObject
/// Capability-only window state from the helper, without querying host text.
+ (NSDictionary<NSString *, NSNumber *> *)runtimeWindowCapabilities;
- (instancetype)initWithClient:(id<PETextClient>)client;
/// The injected backend and presenter make the native save/history behavior
/// testable. Passing nil for presenter retains the standard AppKit popup.
- (instancetype)initWithClient:(id<PETextClient>)client
                       backend:(PEBackendClient *)backend
                 menuPresenter:(nullable PEMenuPresenter)menuPresenter;
- (void)activate;
- (void)deactivate;
- (void)close;
- (void)dismiss;
- (BOOL)handleEvent:(NSEvent *)event;
- (NSMenu *)inputMenu;
@end
NS_ASSUME_NONNULL_END
