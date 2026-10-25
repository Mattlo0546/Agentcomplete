#import "PECompletionEngine.h"
#import <AppKit/AppKit.h>

static const NSUInteger PE_MAX_PROMPT_UNITS = 20000;
static const NSUInteger PE_MAX_SUGGESTION_UNITS = 4000;
static const NSUInteger PE_MIN_PROMPT_UNITS = 12;
#define PEAssertMainThread() NSCAssert(NSThread.isMainThread, @"PECompletionEngine must run on the main thread")

@interface PECompletionSnapshot : NSObject
@property (nonatomic, copy) NSString *text;
@property (nonatomic) NSUInteger cursor;
@end
@implementation PECompletionSnapshot
@end

@interface PECompletionEngine ()
@property (nonatomic, weak, readwrite, nullable) id<PETextClient> client;
@property (nonatomic, copy, readwrite, nullable) NSString *prompt;
@property (nonatomic, copy, readwrite, nullable) NSString *suggestion;
@property (nonatomic, copy, readwrite, nullable) NSString *safeError;
@property (nonatomic, readwrite, getter=isEnabled) BOOL enabled;
@property (nonatomic, readwrite, getter=isActive) BOOL active;
@property (nonatomic, copy) PECompletionRequestHandler requestHandler;
@property (nonatomic) NSUInteger revision;
@property (nonatomic) NSUInteger requestGeneration;
@end

@implementation PECompletionEngine

- (instancetype)initWithRequestHandler:(PECompletionRequestHandler)requestHandler {
    self = [super init];
    if (self) {
        _requestHandler = [requestHandler copy];
        _debounceInterval = 0.30;
    }
    return self;
}

- (void)attachClient:(id<PETextClient>)client {
    PEAssertMainThread();
    [self dismissSuggestion];
    _requestGeneration++;
    _revision++;
    _client = client;
    _enabled = [self clientIsAllowed:client];
    _prompt = nil;
    [self setSafeError:(client && !_enabled) ? @"Prompt Enhance only runs in Codex." : nil];
    [self notifyState];
}

- (void)activate {
    PEAssertMainThread();
    _active = YES;
    _enabled = [self clientIsAllowed:self.client];
    if (!_enabled && self.client) [self setSafeError:@"Prompt Enhance only runs in Codex."];
    [self notifyState];
}

- (void)deactivate {
    PEAssertMainThread();
    [self dismissSuggestion];
    _requestGeneration++;
    _revision++;
    _active = NO;
    _prompt = nil;
    [self notifyState];
}

- (void)textWillChange {
    PEAssertMainThread();
    [self dismissSuggestion];
    _requestGeneration++;
    _revision++;
}

- (void)scheduleSuggestion {
    PEAssertMainThread();
    if (!self.active || !self.enabled || !self.requestHandler) return;
    const NSUInteger generation = ++_requestGeneration;
    const NSUInteger revision = ++_revision;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(MAX(0, self.debounceInterval) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        typeof(self) self = weakSelf;
        if (!self || generation != self.requestGeneration || !self.active || !self.enabled) return;
        // The host applies the passed-through key after handleEvent: returns.
        // Sampling here, after the debounce, prevents requesting the prefix
        // from before that key was inserted.
        id<PETextClient> client = self.client;
        PECompletionSnapshot *snapshot = [self snapshotForClient:client requireNoMarkedText:YES];
        if (!snapshot || snapshot.text.length < PE_MIN_PROMPT_UNITS) return;
        self.prompt = snapshot.text;
        [self setSafeError:nil];
        self.requestHandler(snapshot.text, revision, snapshot.cursor, ^(NSString *suffix, NSString *safeError) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [self finishRequestForClient:client generation:generation revision:revision snapshot:snapshot suffix:suffix safeError:safeError];
            });
        });
    });
}

- (BOOL)acceptSuggestion {
    PEAssertMainThread();
    id<PETextClient> client = self.client;
    BOOL accepted = [self usesExternalPreviewForClient:client]
        ? [self canAcceptExternalPreviewSuggestionInClient:client]
        : [self canAcceptOwnedSuggestionInClient:client];
    if (!accepted) {
        [self dismissSuggestion];
        return NO;
    }
    if ([self usesExternalPreviewForClient:client]) {
        NSString *completedPrompt = [self.prompt stringByAppendingString:self.suggestion];
        if (![client respondsToSelector:@selector(replaceEntireDraft:expectedPrompt:)] || ![client replaceEntireDraft:completedPrompt expectedPrompt:self.prompt]) {
            [self setSafeError:@"Could not apply Codex completion."];
            [self dismissSuggestion];
            return NO;
        }
    } else {
        [client insertText:self.suggestion replacementRange:NSMakeRange(NSNotFound, 0)];
    }
    [self forgetSuggestion];
    _requestGeneration++;
    _revision++;
    return YES;
}

- (void)dismissSuggestion {
    PEAssertMainThread();
    _requestGeneration++;
    _revision++;
    id<PETextClient> client = self.client;
    if (![self usesExternalPreviewForClient:client] && [self ownsExactlyMarkedSuggestionInClient:client]) {
        [client setMarkedText:@"" selectionRange:NSMakeRange(0, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
    }
    [self forgetSuggestion];
}

- (NSString *)readCurrentPrompt {
    PEAssertMainThread();
    if (!self.active || !self.enabled) return nil;
    if (self.suggestion && [self ownsExactlyMarkedSuggestionInClient:self.client]) return self.prompt;
    PECompletionSnapshot *snapshot = [self snapshotForClient:self.client requireNoMarkedText:YES];
    if (!snapshot) return nil;
    self.prompt = snapshot.text;
    return snapshot.text;
}

- (BOOL)restorePrompt:(NSString *)prompt expectedPrompt:(NSString *)expectedPrompt {
    PEAssertMainThread();
    if (!prompt || prompt.length > PE_MAX_PROMPT_UNITS || !self.active || !self.enabled) {
        [self setSafeError:@"That prompt cannot be restored here."];
        return NO;
    }
    [self dismissSuggestion];
    PECompletionSnapshot *snapshot = [self snapshotForClient:self.client requireNoMarkedText:YES];
    if (!snapshot || ![snapshot.text isEqualToString:expectedPrompt]) {
        [self setSafeError:@"The Codex draft changed before this version could be restored."];
        return NO;
    }
    id<PETextClient> client = self.client;
    if ([self usesExternalPreviewForClient:client]) {
        if (![client respondsToSelector:@selector(replaceEntireDraft:expectedPrompt:)] || ![client replaceEntireDraft:prompt expectedPrompt:expectedPrompt]) {
            [self setSafeError:@"The Codex draft changed before this version could be restored."];
            return NO;
        }
    } else {
        [client insertText:prompt replacementRange:NSMakeRange(0, snapshot.text.length)];
    }
    self.prompt = prompt;
    _requestGeneration++;
    _revision++;
    [self setSafeError:nil];
    [self notifyState];
    return YES;
}

- (void)finishRequestForClient:(id<PETextClient>)client generation:(NSUInteger)generation revision:(NSUInteger)revision snapshot:(PECompletionSnapshot *)snapshot suffix:(NSString *)suffix safeError:(NSString *)safeError {
    if (generation != self.requestGeneration || revision != self.revision || client != self.client || !self.active || !self.enabled) return;
    if (safeError.length) { [self setSafeError:safeError]; return; }
    if (!suffix.length || suffix.length > PE_MAX_SUGGESTION_UNITS || snapshot.text.length + suffix.length > PE_MAX_PROMPT_UNITS) return;
    PECompletionSnapshot *now = [self snapshotForClient:client requireNoMarkedText:YES];
    if (!now || now.cursor != snapshot.cursor || ![now.text isEqualToString:snapshot.text]) return;
    if (![self usesExternalPreviewForClient:client]) {
        NSAttributedString *ghost = [[NSAttributedString alloc] initWithString:suffix attributes:@{
            NSForegroundColorAttributeName: NSColor.secondaryLabelColor,
            NSUnderlineStyleAttributeName: @(NSUnderlineStyleSingle),
        }];
        [client setMarkedText:ghost selectionRange:NSMakeRange(0, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
    }
    self.prompt = snapshot.text;
    self.suggestion = suffix;
    [self notifyState];
}

- (PECompletionSnapshot *)snapshotForClient:(id<PETextClient>)client requireNoMarkedText:(BOOL)requireNoMarkedText {
    if (![self clientIsAllowed:client]) return nil;
    NSInteger documentLength = [client length];
    if (documentLength == NSNotFound || documentLength < 0 || (NSUInteger)documentLength > PE_MAX_PROMPT_UNITS) {
        [self setSafeError:@"Codex did not provide a supported draft range."];
        return nil;
    }
    NSRange selection = [client selectedRange];
    if (selection.location == NSNotFound || selection.length != 0 || selection.location != (NSUInteger)documentLength) {
        [self setSafeError:@"Codex did not provide a supported draft range."];
        return nil;
    }
    NSRange marked = [client markedRange];
    // Some native clients represent "no composition" as { caret, 0 } instead
    // of { NSNotFound, 0 }. A non-empty composition is always left alone.
    if (requireNoMarkedText && marked.location != NSNotFound && marked.length != 0) return nil;
    NSAttributedString *attributed = [client attributedSubstringFromRange:NSMakeRange(0, (NSUInteger)documentLength)];
    if (!attributed || attributed.string.length != (NSUInteger)documentLength) {
        [self setSafeError:@"Codex did not provide a supported draft range."];
        return nil;
    }
    PECompletionSnapshot *snapshot = [PECompletionSnapshot new];
    snapshot.text = attributed.string;
    snapshot.cursor = selection.location;
    return snapshot;
}

- (BOOL)clientIsAllowed:(id<PETextClient>)client {
    NSString *bundleIdentifier = [client bundleIdentifier];
    return [bundleIdentifier isEqualToString:@"com.openai.codex"] || [bundleIdentifier isEqualToString:@"com.promptenhance.input.fixture"];
}

- (BOOL)usesExternalPreviewForClient:(id<PETextClient>)client {
    return client && [client respondsToSelector:@selector(usesExternalPreview)] && [client usesExternalPreview];
}

- (BOOL)ownsExactlyMarkedSuggestionInClient:(id<PETextClient>)client {
    if (!client || !self.suggestion.length || !self.prompt) return NO;
    NSRange marked = [client markedRange];
    if (marked.location == NSNotFound || marked.location != self.prompt.length || marked.length != self.suggestion.length || marked.length > PE_MAX_SUGGESTION_UNITS) return NO;
    // A matching range is insufficient: another input method could replace the
    // composition with a same-length value after this request was invalidated.
    NSAttributedString *markedText = [client attributedSubstringFromRange:marked];
    return [markedText.string isEqualToString:self.suggestion];
}

- (BOOL)canAcceptOwnedSuggestionInClient:(id<PETextClient>)client {
    if (!self.active || !self.enabled || ![self clientIsAllowed:client] || ![self ownsExactlyMarkedSuggestionInClient:client]) return NO;
    NSUInteger prefixLength = self.prompt.length;
    NSUInteger suffixLength = self.suggestion.length;
    NSInteger documentLength = [client length];
    NSRange selection = [client selectedRange];
    if (documentLength == NSNotFound || documentLength < 0 || (NSUInteger)documentLength != prefixLength + suffixLength || selection.location != prefixLength || selection.length != 0) return NO;
    NSAttributedString *prefix = [client attributedSubstringFromRange:NSMakeRange(0, prefixLength)];
    return [prefix.string isEqualToString:self.prompt];
}

- (BOOL)canAcceptExternalPreviewSuggestionInClient:(id<PETextClient>)client {
    if (!self.active || !self.enabled || ![self clientIsAllowed:client] || !self.prompt || !self.suggestion.length) return NO;
    PECompletionSnapshot *snapshot = [self snapshotForClient:client requireNoMarkedText:YES];
    return snapshot && snapshot.cursor == self.prompt.length && [snapshot.text isEqualToString:self.prompt];
}

- (void)forgetSuggestion {
    if (self.suggestion) {
        self.suggestion = nil;
        [self notifyState];
    }
}

- (void)setSafeError:(NSString *)safeError {
    if ((_safeError == safeError) || [_safeError isEqualToString:safeError]) return;
    _safeError = [safeError copy];
    [self notifyState];
}

- (void)notifyState { if (self.stateDidChange) self.stateDidChange(); }
@end
