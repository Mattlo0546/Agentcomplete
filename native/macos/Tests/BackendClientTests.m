// Run locally with:
// clang -fobjc-arc -fmodules -DPE_BACKEND_CLIENT_TEST_MAIN \
//   -I native/macos/Sources native/macos/Sources/PEBackendClient.m \
//   native/macos/Tests/BackendClientTests.m -framework Foundation -o /tmp/pe-backend-tests && /tmp/pe-backend-tests

#import <Foundation/Foundation.h>
#import "PEBackendClient.h"

static NSData *PEStubData;
static NSInteger PEStubStatus;
static BOOL PEStubOmitRevision;

@interface PEStubProtocol : NSURLProtocol @end
@implementation PEStubProtocol
+ (BOOL)canInitWithRequest:(NSURLRequest *)request { return YES; }
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request { return request; }
- (void)startLoading {
    NSData *responseData = PEStubData;
    if (PEStubOmitRevision) {
        NSString *requestID = [self.request valueForHTTPHeaderField:@"X-Prompt-Enhance-Request-ID"];
        responseData = requestID ? [NSJSONSerialization dataWithJSONObject:@{
            @"schema_version": @1,
            @"request_id": requestID,
            @"type": @"autocomplete",
            @"insert_at": @3,
            @"text": @" suffix",
        } options:0 error:nil] : [@"{}" dataUsingEncoding:NSUTF8StringEncoding];
    }
    NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:self.request.URL
                                                                statusCode:PEStubStatus
                                                               HTTPVersion:@"HTTP/1.1"
                                                              headerFields:@{ @"Content-Type": @"application/json" }];
    [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
    [self.client URLProtocol:self didLoadData:responseData];
    [self.client URLProtocolDidFinishLoading:self];
}
- (void)stopLoading {}
@end

static void PERequire(BOOL condition, NSString *message) {
    if (!condition) {
        NSLog(@"TEST FAILURE: %@", message);
        exit(1);
    }
}

static PEBackendClient *PEClient(void) {
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.protocolClasses = @[PEStubProtocol.class];
    NSError *error = nil;
    PEBackendClient *client = [[PEBackendClient alloc] initWithBaseURL:[NSURL URLWithString:@"http://127.0.0.1:8000"]
                                                  sessionConfiguration:configuration
                                                                  error:&error];
    PERequire(client != nil && error == nil, @"fixture client must initialize");
    return client;
}

static void PEWait(BOOL *done) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1.0];
    while (!*done && [deadline timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
    PERequire(*done, @"asynchronous completion must finish");
}

static void testRejectsRemoteBaseURL(void) {
    NSError *error = nil;
    PEBackendClient *client = [[PEBackendClient alloc] initWithBaseURL:[NSURL URLWithString:@"https://example.com"] error:&error];
    PERequire(client == nil && error != nil, @"remote backend must be rejected");
}

static void testInvalidPromptCompletesWithoutNetwork(void) {
    __block BOOL done = NO;
    __block NSString *safeError = nil;
    [[PEClient() requestAutocompleteForPrompt:@"   " revision:0 cursor:0 completion:^(PEAutocompleteResult *result, NSString *error) {
        PERequire(result == nil, @"invalid draft cannot produce a suffix");
        safeError = error;
        done = YES;
    }] cancel];
    PEWait(&done);
    PERequire(safeError.length > 0, @"invalid draft must report a safe error");
}

static void testRejectsMalformedAutocomplete(void) {
    PEStubStatus = 200;
    PEStubData = [NSJSONSerialization dataWithJSONObject:@{
        @"schema_version": @1, @"request_id": @"wrong", @"prompt_revision": @0,
        @"type": @"autocomplete", @"insert_at": @3, @"text": @" suffix"
    } options:0 error:nil];
    __block BOOL done = NO;
    __block NSString *safeError = nil;
    [[PEClient() requestAutocompleteForPrompt:@"one" revision:0 cursor:3 completion:^(PEAutocompleteResult *result, NSString *error) {
        PERequire(result == nil, @"mismatched request id cannot produce a suffix");
        safeError = error;
        done = YES;
    }] resume]; // A second resume is harmless; the client has already started the task.
    PEWait(&done);
    PERequire(safeError.length > 0, @"malformed reply must report a safe error");
}

static void testRejectsMissingRevisionAtZero(void) {
    PEStubStatus = 200;
    PEStubOmitRevision = YES;
    __block BOOL done = NO;
    __block NSString *safeError = nil;
    [PEClient() requestAutocompleteForPrompt:@"one" revision:0 cursor:3 completion:^(PEAutocompleteResult *result, NSString *error) {
        PERequire(result == nil, @"a missing revision must never be treated as revision zero");
        safeError = error;
        done = YES;
    }];
    PEWait(&done);
    PEStubOmitRevision = NO;
    PERequire(safeError.length > 0, @"missing revision must report a safe error");
}

static NSDictionary *PEHistoryItem(NSString *prompt) {
    return @{
        @"id": NSUUID.UUID.UUIDString,
        @"prompt": prompt,
        @"suggestion_text": NSNull.null,
        @"saved_text": prompt,
        @"title": @"Unicode fixture",
        @"description": NSNull.null,
        @"created_at": @"2026-10-25T10:00:00Z",
        @"updated_at": @"2026-10-25T10:00:00Z",
    };
}

static void testAcceptsBoundedLargeUnicodeHistoryPage(void) {
    NSString *prompt = [@"界" stringByPaddingToLength:20000 withString:@"界" startingAtIndex:0];
    NSMutableArray *items = [NSMutableArray arrayWithCapacity:20];
    for (NSUInteger index = 0; index < 20; index++) [items addObject:PEHistoryItem(prompt)];
    PEStubStatus = 200;
    PEStubData = [NSJSONSerialization dataWithJSONObject:@{ @"items": items, @"total": @20 } options:0 error:nil];
    PERequire(PEStubData.length > 1024 * 1024 && PEStubData.length <= 8 * 1024 * 1024,
              @"fixture must exercise the history-specific response bound");
    __block BOOL done = NO;
    __block PEPromptVersionPage *page = nil;
    __block NSString *safeError = nil;
    [PEClient() fetchPromptVersionPageAtOffset:0 completion:^(PEPromptVersionPage *result, NSString *error) {
        page = result;
        safeError = error;
        done = YES;
    }];
    PEWait(&done);
    PERequire(safeError == nil && page.items.count == 20 && page.total == 20,
              @"a bounded Unicode-heavy history page must be accepted");
}

static void testRejectsHistoryPageAboveEightMiB(void) {
    NSMutableString *wire = [NSMutableString stringWithString:@"{\"items\":[],\"total\":0,\"padding\":\""];
    [wire appendString:[@"x" stringByPaddingToLength:(8 * 1024 * 1024) withString:@"x" startingAtIndex:0]];
    [wire appendString:@"\"}"];
    PEStubStatus = 200;
    PEStubData = [wire dataUsingEncoding:NSUTF8StringEncoding];
    PERequire(PEStubData.length > 8 * 1024 * 1024, @"fixture must exceed the history response bound");
    __block BOOL done = NO;
    __block PEPromptVersionPage *page = nil;
    __block NSString *safeError = nil;
    [PEClient() fetchPromptVersionPageAtOffset:0 completion:^(PEPromptVersionPage *result, NSString *error) {
        page = result;
        safeError = error;
        done = YES;
    }];
    PEWait(&done);
    PERequire(page == nil && safeError.length > 0, @"history page above eight MiB must be rejected");
}

static void testLiveHistoryRoundTripWhenEnabled(void) {
    if (![[NSProcessInfo processInfo].environment[@"PROMPT_ENHANCE_LIVE_TESTS"] boolValue]) return;
    NSError *initializationError = nil;
    PEBackendClient *client = [[PEBackendClient alloc] initWithBaseURL:[NSURL URLWithString:@"http://127.0.0.1:8000"]
                                                                  error:&initializationError];
    PERequire(client != nil && initializationError == nil, @"live client must initialize");
    NSString *title = [@"Prompt Enhance input verification " stringByAppendingString:NSUUID.UUID.UUIDString];
    __block BOOL saved = NO;
    __block PEPromptVersion *created = nil;
    __block NSString *safeError = nil;
    [client savePrompt:@"Keep temporary prompt history isolated."
             suggestion:@" Verify it before sending."
                  title:title
             completion:^(PEPromptVersion *version, NSString *error) {
        created = version;
        safeError = error;
        saved = YES;
    }];
    PEWait(&saved);
    PERequire(created != nil && safeError == nil, @"live save must succeed");

    __block BOOL listed = NO;
    __block NSArray<PEPromptVersion *> *versions = nil;
    [client listPromptVersionsWithCompletion:^(NSArray<PEPromptVersion *> *result, NSString *error) {
        versions = result;
        safeError = error;
        listed = YES;
    }];
    PEWait(&listed);
    PEPromptVersion *reloaded = nil;
    for (PEPromptVersion *version in versions) {
        if ([version.versionID isEqual:created.versionID]) { reloaded = version; break; }
    }
    PERequire(safeError == nil && [reloaded.savedText isEqualToString:@"Keep temporary prompt history isolated. Verify it before sending."],
              @"live history must retain the base prompt and suffix together");
    PERequire([reloaded.suggestionText isEqualToString:@" Verify it before sending."],
              @"live history must preserve the unaccepted suffix separately");

    __block BOOL deleted = NO;
    [client deletePromptVersion:created.versionID completion:^(NSString *error) {
        safeError = error;
        deleted = YES;
    }];
    PEWait(&deleted);
    PERequire(safeError == nil, @"live test must clean up only its own version");
}

int PEBackendClientTests(void) {
    @autoreleasepool {
        testRejectsRemoteBaseURL();
        testInvalidPromptCompletesWithoutNetwork();
        testRejectsMalformedAutocomplete();
        testRejectsMissingRevisionAtZero();
        testAcceptsBoundedLargeUnicodeHistoryPage();
        testRejectsHistoryPageAboveEightMiB();
        testLiveHistoryRoundTripWhenEnabled();
        NSLog(@"PEBackendClientTests passed");
    }
    return 0;
}

#if defined(PE_BACKEND_CLIENT_TEST_MAIN)
int main(void) { return PEBackendClientTests(); }
#endif
