#import <AppKit/AppKit.h>
#import "PECompletionEngine.h"

@interface PEMockClient : NSObject <PETextClient>
@property (nonatomic, copy) NSString *text;
@property (nonatomic) NSRange selection;
@property (nonatomic) NSRange marked;
@property (nonatomic, copy) NSString *bundle;
@property (nonatomic, copy) NSString *markedText;
@end

@implementation PEMockClient
- (instancetype)initWithText:(NSString *)text bundle:(NSString *)bundle {
    if ((self = [super init])) { _text = [text copy]; _bundle = [bundle copy]; _selection = NSMakeRange(text.length, 0); _marked = NSMakeRange(NSNotFound, 0); }
    return self;
}
- (NSRange)selectedRange { return _selection; }
- (NSRange)markedRange { return _marked; }
- (NSAttributedString *)attributedSubstringFromRange:(NSRange)range {
    if (NSEqualRanges(range, _marked) && _marked.location != NSNotFound) return [[NSAttributedString alloc] initWithString:_markedText];
    return range.location == NSNotFound || NSMaxRange(range) > _text.length ? nil : [[NSAttributedString alloc] initWithString:[_text substringWithRange:range]];
}
- (NSInteger)length { return (NSInteger)(_text.length + (_marked.location == NSNotFound ? 0 : _marked.length)); }
- (void)setMarkedText:(id)string selectionRange:(NSRange)selectionRange replacementRange:(NSRange)replacementRange {
    NSString *value = [string isKindOfClass:NSString.class] ? string : [string string];
    _markedText = [value copy];
    _marked = value.length ? NSMakeRange(_text.length, value.length) : NSMakeRange(NSNotFound, 0);
}
- (void)insertText:(id)string replacementRange:(NSRange)replacementRange {
    NSString *value = [string isKindOfClass:NSString.class] ? string : [string string];
    NSRange range = replacementRange.location == NSNotFound ? NSMakeRange(_text.length, 0) : replacementRange;
    _text = [_text stringByReplacingCharactersInRange:range withString:value]; _selection = NSMakeRange(_text.length, 0); _marked = NSMakeRange(NSNotFound, 0); _markedText = nil;
}
- (NSString *)bundleIdentifier { return _bundle; }
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actualRange { if (actualRange) *actualRange = range; return NSZeroRect; }
@end

static void Require(BOOL condition, NSString *message) { if (!condition) { NSLog(@"FAIL: %@", message); exit(1); } }
static void Drain(void) { [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.03]]; }

static PECompletionEngine *EngineWithCapture(void (^configure)(PECompletionResponse, NSString *, NSUInteger)) {
    PECompletionEngine *engine = [[PECompletionEngine alloc] initWithRequestHandler:^(NSString *prompt, NSUInteger revision, NSUInteger cursor, PECompletionResponse completion) { configure(completion, prompt, cursor); }];
    engine.debounceInterval = 0;
    return engine;
}

static void TestAcceptDismissAndUTF16(void) {
    __block PECompletionResponse completion;
    PEMockClient *client = [[PEMockClient alloc] initWithText:@"😀 Build a tool" bundle:@"com.promptenhance.input.fixture"];
    PECompletionEngine *engine = EngineWithCapture(^(PECompletionResponse response, NSString *prompt, NSUInteger cursor) { completion = response; Require(cursor == prompt.length, @"uses UTF-16 caret units"); });
    [engine attachClient:client]; [engine activate]; [engine scheduleSuggestion]; Drain(); completion(@" with tests", nil); Drain();
    Require([engine.suggestion isEqualToString:@" with tests"], @"shows an owned marked suffix");
    Require(client.marked.location == client.text.length, @"ghost starts at the end caret");
    Require([engine acceptSuggestion], @"only an exact owned suffix can be accepted");
    Require([client.text hasSuffix:@" with tests"], @"Tab commits only the suffix");
    [engine textWillChange]; [engine scheduleSuggestion]; Drain(); completion(@" again", nil); Drain(); [engine dismissSuggestion];
    Require(client.marked.location == NSNotFound && !engine.suggestion, @"dismiss does not commit ghost text");
}

static void TestStaleAndMouseBlurSafety(void) {
    __block PECompletionResponse oldCompletion;
    PEMockClient *client = [[PEMockClient alloc] initWithText:@"Write documentation" bundle:@"com.promptenhance.input.fixture"];
    PECompletionEngine *engine = EngineWithCapture(^(PECompletionResponse response, NSString *prompt, NSUInteger cursor) { oldCompletion = response; });
    [engine attachClient:client]; [engine activate]; [engine scheduleSuggestion]; Drain();
    [engine textWillChange]; // controller does this for a key, click, blur, or Return.
    client.text = @"Write documentation now"; client.selection = NSMakeRange(client.text.length, 0);
    Require(oldCompletion != nil, @"eligible draft starts one request");
    oldCompletion(@" safely", nil); Drain();
    Require(!engine.suggestion && client.marked.location == NSNotFound, @"stale response cannot mark a changed draft");
    Require(![engine acceptSuggestion], @"non-Tab paths cannot accidentally accept");
}

static void TestDebounceSamplesAfterHostEdit(void) {
    __block NSString *requested = nil;
    PEMockClient *client = [[PEMockClient alloc] initWithText:@"Draft before edit" bundle:@"com.promptenhance.input.fixture"];
    PECompletionEngine *engine = EngineWithCapture(^(PECompletionResponse response, NSString *prompt, NSUInteger cursor) { requested = prompt; });
    engine.debounceInterval = 0.01;
    [engine attachClient:client]; [engine activate]; [engine scheduleSuggestion];
    // handleEvent: returns before the host inserts the key; no second engine
    // callback is required for this same event.
    client.text = @"Draft after edit"; client.selection = NSMakeRange(client.text.length, 0);
    Drain();
    Require([requested isEqualToString:@"Draft after edit"], @"debounce samples the post-event native draft");
}

static void TestAcceptRequiresUnchangedPrefix(void) {
    __block PECompletionResponse completion;
    PEMockClient *client = [[PEMockClient alloc] initWithText:@"Refactor billing flow" bundle:@"com.promptenhance.input.fixture"];
    PECompletionEngine *engine = EngineWithCapture(^(PECompletionResponse response, NSString *prompt, NSUInteger cursor) { completion = response; });
    [engine attachClient:client]; [engine activate]; [engine scheduleSuggestion]; Drain(); completion(@" safely", nil); Drain();
    client.text = @"Rewrite billing flow "; // same UTF-16 length, different prefix
    client.selection = NSMakeRange(engine.prompt.length, 0);
    Require(![engine acceptSuggestion], @"Tab rejects a same-length changed prefix");
    Require(client.marked.location == NSNotFound, @"rejected Tab also clears owned ghost text");
}

static void TestScopeAndUnsafeRanges(void) {
    __block NSUInteger calls = 0;
    PECompletionEngine *engine = EngineWithCapture(^(PECompletionResponse response, NSString *prompt, NSUInteger cursor) { calls++; });
    PEMockClient *other = [[PEMockClient alloc] initWithText:@"secret" bundle:@"com.example.other"];
    [engine attachClient:other]; [engine activate]; [engine scheduleSuggestion]; Drain(); Require(calls == 0 && !engine.enabled, @"does not read another app");
    PEMockClient *client = [[PEMockClient alloc] initWithText:@"Draft" bundle:@"com.promptenhance.input.fixture"];
    [engine attachClient:client]; [engine activate]; client.marked = NSMakeRange(0, 1); [engine scheduleSuggestion]; Drain(); Require(calls == 0, @"leaves third-party marked text alone");
    client.marked = NSMakeRange(NSNotFound, 0); client.selection = NSMakeRange(0, 0); [engine scheduleSuggestion]; Drain(); Require(calls == 0, @"does not autocomplete at a mid-draft cursor");
}

static void TestRestoreGuard(void) {
    PEMockClient *client = [[PEMockClient alloc] initWithText:@"draft" bundle:@"com.promptenhance.input.fixture"];
    PECompletionEngine *engine = EngineWithCapture(^(PECompletionResponse response, NSString *prompt, NSUInteger cursor) {});
    [engine attachClient:client]; [engine activate];
    Require([engine restorePrompt:@"saved version" expectedPrompt:@"draft"], @"restores the exact visible draft");
    Require([client.text isEqualToString:@"saved version"], @"restore replaces instead of appending");
    Require(![engine restorePrompt:@"other" expectedPrompt:@"draft"], @"restore refuses a stale history click");
}

int PEEngineTests(void) { @autoreleasepool { TestAcceptDismissAndUTF16(); TestStaleAndMouseBlurSafety(); TestDebounceSamplesAfterHostEdit(); TestAcceptRequiresUnchangedPrefix(); TestScopeAndUnsafeRanges(); TestRestoreGuard(); NSLog(@"PECompletionEngine tests passed"); } return 0; }
