#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@protocol PETextClient <NSObject>
- (NSRange)selectedRange;
- (NSRange)markedRange;
- (nullable NSAttributedString *)attributedSubstringFromRange:(NSRange)range;
- (NSInteger)length;
- (void)setMarkedText:(id)string selectionRange:(NSRange)selectionRange replacementRange:(NSRange)replacementRange;
- (void)insertText:(id)string replacementRange:(NSRange)replacementRange;
- (nullable NSString *)bundleIdentifier;
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(nullable NSRangePointer)actualRange;
@optional
/// A content-free reason a focused draft could not be read.
@property (nonatomic, copy, readonly, nullable) NSString *safeError;
- (NSRect)caretRect;
/// Verified focused editor bounds when the host cannot expose a caret rect.
- (NSRect)focusedEditorRect;
- (BOOL)isPointInMarkedText:(NSPoint)point;
/// When enabled by an accessibility-authorized adapter, the coordinator draws
/// the preview itself. The engine must not use the host's marked-text APIs.
- (BOOL)usesExternalPreview;
/// Atomically replaces a whole verified draft, or returns NO without editing.
- (BOOL)replaceEntireDraft:(NSString *)prompt expectedPrompt:(NSString *)expectedPrompt;
@end

typedef void (^PECompletionResponse)(NSString * _Nullable suffix, NSString * _Nullable safeError);
typedef void (^PECompletionRequestHandler)(NSString *prompt, NSUInteger revision, NSUInteger cursor, PECompletionResponse completion);

/// Owns only the temporary marked suffix it created. It never accepts text on
/// its own; the InputMethodKit controller calls -acceptSuggestion for Tab only.
@interface PECompletionEngine : NSObject
- (instancetype)initWithRequestHandler:(PECompletionRequestHandler)requestHandler;

@property (nonatomic, weak, readonly, nullable) id<PETextClient> client;
@property (nonatomic, copy, readonly, nullable) NSString *prompt;
@property (nonatomic, copy, readonly, nullable) NSString *suggestion;
@property (nonatomic, copy, readonly, nullable) NSString *safeError;
@property (nonatomic, readonly, getter=isEnabled) BOOL enabled;
@property (nonatomic, readonly, getter=isActive) BOOL active;
@property (nonatomic) NSTimeInterval debounceInterval;
@property (nonatomic, copy, nullable) dispatch_block_t stateDidChange;

- (void)attachClient:(nullable id<PETextClient>)client;
- (void)activate;
- (void)deactivate;
- (void)textWillChange;
- (void)scheduleSuggestion;
- (BOOL)acceptSuggestion;
- (void)dismissSuggestion;
- (nullable NSString *)readCurrentPrompt;
- (BOOL)restorePrompt:(NSString *)prompt expectedPrompt:(NSString *)expectedPrompt;
@end

NS_ASSUME_NONNULL_END
