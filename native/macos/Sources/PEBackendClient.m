#import "PEBackendClient.h"
#import <CoreFoundation/CoreFoundation.h>

static const NSUInteger PEBackendMaximumPromptUnits = 20000;
static const NSUInteger PEBackendMaximumSuggestionUnits = 4000;
static const NSUInteger PEBackendMaximumOrdinaryResponseBytes = 1024 * 1024;
static const NSUInteger PEBackendMaximumHistoryPageBytes = 8 * 1024 * 1024;
static NSString *const PEBackendErrorDomain = @"com.promptenhance.input.backend";

static void PEDeliver(dispatch_block_t block);
static NSString * _Nullable PEString(id value);
static NSNumber * _Nullable PENumber(id value);
static BOOL PEReadUnsignedInteger(id value, NSUInteger *result);
static BOOL PEValidPrompt(NSString * _Nullable prompt);
static BOOL PEValidSuffix(NSString * _Nullable suffix, NSUInteger promptLength);
static BOOL PEIsLoopbackBaseURL(NSURL *url);
static PEPromptVersion * _Nullable PEVersionFromDictionary(id value);

@interface PEAutocompleteResult ()
@property (nonatomic, copy, readwrite) NSString *requestID;
@property (nonatomic, readwrite) NSUInteger revision;
@property (nonatomic, copy, readwrite) NSString *suffix;
@end

@implementation PEAutocompleteResult

- (instancetype)initWithRequestID:(NSString *)requestID revision:(NSUInteger)revision suffix:(NSString *)suffix {
    self = [super init];
    if (self) {
        _requestID = [requestID copy];
        _revision = revision;
        _suffix = [suffix copy];
    }
    return self;
}

@end

@interface PEPromptVersion ()
@property (nonatomic, copy, readwrite) NSUUID *versionID;
@property (nonatomic, copy, readwrite) NSString *prompt;
@property (nonatomic, copy, readwrite, nullable) NSString *suggestionText;
@property (nonatomic, copy, readwrite) NSString *savedText;
@property (nonatomic, copy, readwrite, nullable) NSString *title;
@property (nonatomic, copy, readwrite, nullable) NSString *versionDescription;
@property (nonatomic, copy, readwrite) NSString *createdAt;
@property (nonatomic, copy, readwrite) NSString *updatedAt;
@end

@implementation PEPromptVersion
@end

@interface PEPromptVersionPage ()
@property (nonatomic, copy, readwrite) NSArray<PEPromptVersion *> *items;
@property (nonatomic, readwrite) NSUInteger total;
@end

@implementation PEPromptVersionPage
@end

@interface PEBackendClient () <NSURLSessionTaskDelegate>
@property (nonatomic, copy) NSURL *baseURL;
@property (nonatomic, strong) NSURLSession *session;
@end

@implementation PEBackendClient

- (nullable instancetype)initWithBaseURL:(NSURL *)baseURL error:(NSError **)error {
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    configuration.URLCache = nil;
    configuration.HTTPShouldSetCookies = NO;
    configuration.HTTPCookieStorage = nil;
    configuration.timeoutIntervalForRequest = 30.0;
    return [self initWithBaseURL:baseURL sessionConfiguration:configuration error:error];
}

- (nullable instancetype)initWithBaseURL:(NSURL *)baseURL
                   sessionConfiguration:(NSURLSessionConfiguration *)configuration
                                   error:(NSError **)error {
    if (!PEIsLoopbackBaseURL(baseURL)) {
        if (error) {
            *error = [NSError errorWithDomain:PEBackendErrorDomain
                                          code:1
                                      userInfo:@{NSLocalizedDescriptionKey: @"Prompt Enhance must use a loopback backend URL."}];
        }
        return nil;
    }
    self = [super init];
    if (self) {
        // Preserve test protocol classes but never inherit persistent network
        // state from a caller-supplied configuration.
        configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
        configuration.URLCache = nil;
        configuration.HTTPShouldSetCookies = NO;
        configuration.HTTPCookieStorage = nil;
        configuration.URLCredentialStorage = nil;
        _baseURL = [baseURL copy];
        _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
    }
    return self;
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler {
    // The local service never needs redirects. Refusing them prevents a local
    // endpoint from silently turning this input method into a remote sender.
    completionHandler(nil);
}

- (NSURLSessionDataTask *)requestAutocompleteForPrompt:(NSString *)prompt
                                               revision:(NSUInteger)revision
                                                 cursor:(NSUInteger)cursor
                                             completion:(PEAutocompleteCompletion)completion {
    NSString *requestID = NSUUID.UUID.UUIDString;
    if (!PEValidPrompt(prompt) || cursor > prompt.length) {
        return [self completedTaskWithError:@"The current draft cannot be enhanced." autocompleteCompletion:completion];
    }
    NSDictionary *body = @{
        @"request_id": requestID,
        @"prompt": prompt,
        @"prompt_revision": @(revision),
        @"cursor": @(cursor),
    };
    __weak typeof(self) weakSelf = self;
    return [self JSONRequestWithMethod:@"POST" path:@"v1/enhance" body:body completion:^(NSDictionary * _Nullable json, NSString * _Nullable safeError) {
        if (safeError) {
            PEDeliver(^{ completion(nil, safeError); });
            return;
        }
        NSString *type = PEString(json[@"type"]);
        NSString *returnedID = PEString(json[@"request_id"]);
        NSUInteger schemaVersion = 0;
        NSUInteger returnedRevision = 0;
        if (!PEReadUnsignedInteger(json[@"schema_version"], &schemaVersion) ||
            !PEReadUnsignedInteger(json[@"prompt_revision"], &returnedRevision) ||
            schemaVersion != 1 || ![returnedID isEqualToString:requestID] || returnedRevision != revision) {
            PEDeliver(^{ completion(nil, @"Prompt Enhance returned an invalid response."); });
            return;
        }
        if ([type isEqualToString:@"none"] || [type isEqualToString:@"multiple_choice"]) {
            PEDeliver(^{ completion(nil, nil); });
            return;
        }
        NSUInteger insertAt = 0;
        NSString *suffix = PEString(json[@"text"]);
        if (![type isEqualToString:@"autocomplete"] || !PEReadUnsignedInteger(json[@"insert_at"], &insertAt) || insertAt != prompt.length ||
            !PEValidSuffix(suffix, prompt.length)) {
            PEDeliver(^{ completion(nil, @"Prompt Enhance returned an invalid response."); });
            return;
        }
        PEAutocompleteResult *result = [[PEAutocompleteResult alloc] initWithRequestID:requestID revision:revision suffix:suffix];
        // Keep the client alive until the block finishes while avoiding a cycle.
        (void)weakSelf;
        PEDeliver(^{ completion(result, nil); });
    }];
}

- (NSURLSessionDataTask *)listPromptVersionsWithCompletion:(PEPromptVersionsCompletion)completion {
    return [self fetchPromptVersionPageAtOffset:0 completion:^(PEPromptVersionPage *page, NSString *safeError) {
        PEDeliver(^{ completion(page.items, safeError); });
    }];
}

- (NSURLSessionDataTask *)fetchPromptVersionPageAtOffset:(NSUInteger)offset completion:(PEPromptVersionPageCompletion)completion {
    if (offset > 1000000) {
        return [self completedTaskWithRawCompletion:^(NSDictionary *json, NSString *safeError) {
            (void)json; (void)safeError;
            PEDeliver(^{ completion(nil, @"That history page is unavailable."); });
        } error:@"That history page is unavailable."];
    }
    NSString *path = [NSString stringWithFormat:@"v1/prompt-history?limit=20&offset=%lu", (unsigned long)offset];
    return [self JSONRequestWithMethod:@"GET" path:path body:nil completion:^(NSDictionary * _Nullable json, NSString * _Nullable safeError) {
        if (safeError) {
            PEDeliver(^{ completion(nil, safeError); });
            return;
        }
        NSArray *items = [json[@"items"] isKindOfClass:NSArray.class] ? json[@"items"] : nil;
        NSUInteger total = 0;
        if (!items || !PEReadUnsignedInteger(json[@"total"], &total) || total < offset || total - offset < items.count) {
            PEDeliver(^{ completion(nil, @"Prompt history returned an invalid response."); });
            return;
        }
        NSMutableArray<PEPromptVersion *> *versions = [NSMutableArray arrayWithCapacity:items.count];
        for (id item in items) {
            PEPromptVersion *version = PEVersionFromDictionary(item);
            if (!version) {
                PEDeliver(^{ completion(nil, @"Prompt history returned an invalid response."); });
                return;
            }
            [versions addObject:version];
        }
        PEPromptVersionPage *page = [PEPromptVersionPage new];
        page.items = [versions copy];
        page.total = total;
        PEDeliver(^{ completion(page, nil); });
    }];
}

- (NSURLSessionDataTask *)savePrompt:(NSString *)prompt
                           suggestion:(NSString *)suggestion
                                title:(NSString *)title
                           completion:(PEPromptVersionCompletion)completion {
    if (!PEValidPrompt(prompt) || (suggestion && !PEValidSuffix(suggestion, prompt.length)) ||
        (title && (title.length == 0 || title.length > 120))) {
        return [self completedTaskWithError:@"This prompt version cannot be saved." versionCompletion:completion];
    }
    NSMutableDictionary *body = [@{ @"prompt": prompt } mutableCopy];
    if (suggestion) {
        body[@"suggestion_text"] = suggestion;
    }
    if (title) {
        body[@"title"] = title;
    }
    return [self JSONRequestWithMethod:@"POST" path:@"v1/prompt-history" body:body completion:^(NSDictionary * _Nullable json, NSString * _Nullable safeError) {
        if (safeError) {
            PEDeliver(^{ completion(nil, safeError); });
            return;
        }
        PEPromptVersion *version = PEVersionFromDictionary(json);
        if (!version) {
            PEDeliver(^{ completion(nil, @"Prompt history returned an invalid response."); });
            return;
        }
        PEDeliver(^{ completion(version, nil); });
    }];
}

- (NSURLSessionDataTask *)deletePromptVersion:(NSUUID *)versionID completion:(PEBackendCompletion)completion {
    if (!versionID) {
        return [self completedTaskWithRawCompletion:^(NSDictionary *json, NSString *safeError) {
            (void)json; (void)safeError;
            PEDeliver(^{ completion(@"This prompt version cannot be deleted."); });
        } error:@"This prompt version cannot be deleted."];
    }
    NSString *path = [@"v1/prompt-history/" stringByAppendingString:versionID.UUIDString];
    return [self JSONRequestWithMethod:@"DELETE" path:path body:nil completion:^(NSDictionary *json, NSString *safeError) {
        (void)json;
        PEDeliver(^{ completion(safeError); });
    }];
}

- (void)finishAndInvalidate {
    [self.session finishTasksAndInvalidate];
}

- (NSURLSessionDataTask *)JSONRequestWithMethod:(NSString *)method
                                           path:(NSString *)path
                                           body:(nullable NSDictionary *)body
                                     completion:(void (^)(NSDictionary * _Nullable json, NSString * _Nullable safeError))completion {
    NSURL *url = [NSURL URLWithString:path relativeToURL:self.baseURL];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = method;
    [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
    if (body) {
        NSError *jsonError = nil;
        NSData *data = [NSJSONSerialization dataWithJSONObject:body options:0 error:&jsonError];
        if (!data || jsonError) {
            return [self completedTaskWithRawCompletion:completion error:@"Prompt Enhance could not prepare the request."];
        }
        request.HTTPBody = data;
        [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        NSString *requestID = PEString(body[@"request_id"]);
        if (requestID) [request setValue:requestID forHTTPHeaderField:@"X-Prompt-Enhance-Request-ID"];
    }
    NSURLSessionDataTask *task = [self.session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (error || ![response isKindOfClass:NSHTTPURLResponse.class]) {
            completion(nil, error.code == NSURLErrorCancelled ? @"Prompt Enhance request was cancelled." : @"Prompt Enhance is unavailable.");
            return;
        }
        NSInteger status = ((NSHTTPURLResponse *)response).statusCode;
        if (status < 200 || status >= 300) {
            completion(nil, @"Prompt Enhance could not complete the request.");
            return;
        }
        if (data.length == 0 && [method isEqualToString:@"DELETE"]) {
            completion(@{}, nil);
            return;
        }
        NSUInteger maximumResponseBytes = ([method isEqualToString:@"GET"] && [path hasPrefix:@"v1/prompt-history?"])
            ? PEBackendMaximumHistoryPageBytes
            : PEBackendMaximumOrdinaryResponseBytes;
        if (data.length == 0 || data.length > maximumResponseBytes) {
            completion(nil, @"Prompt Enhance returned an invalid response.");
            return;
        }
        NSError *jsonError = nil;
        id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonError];
        completion([json isKindOfClass:NSDictionary.class] ? json : nil,
                   [json isKindOfClass:NSDictionary.class] ? nil : @"Prompt Enhance returned an invalid response.");
    }];
    [task resume];
    return task;
}

- (NSURLSessionDataTask *)completedTaskWithError:(NSString *)error autocompleteCompletion:(PEAutocompleteCompletion)completion {
    return [self completedTaskWithRawCompletion:^(NSDictionary *json, NSString *unused) {
        (void)json; (void)unused;
        PEDeliver(^{ completion(nil, error); });
    } error:error];
}

- (NSURLSessionDataTask *)completedTaskWithError:(NSString *)error versionCompletion:(PEPromptVersionCompletion)completion {
    return [self completedTaskWithRawCompletion:^(NSDictionary *json, NSString *unused) {
        (void)json; (void)unused;
        PEDeliver(^{ completion(nil, error); });
    } error:error];
}

- (NSURLSessionDataTask *)completedTaskWithRawCompletion:(void (^)(NSDictionary * _Nullable, NSString * _Nullable))completion error:(NSString *)error {
    NSURLSessionDataTask *task = [self.session dataTaskWithURL:self.baseURL completionHandler:^(NSData *data, NSURLResponse *response, NSError *networkError) {
        (void)data; (void)response; (void)networkError;
    }];
    // Never resume this placeholder: input validation failed before any
    // request was created. Still complete asynchronously so callers can clear
    // their loading state exactly like a transport failure.
    PEDeliver(^{ completion(nil, error); });
    return task;
}

@end

static void PEDeliver(dispatch_block_t block) {
    if (NSThread.isMainThread) {
        block();
    } else {
        dispatch_async(dispatch_get_main_queue(), block);
    }
}

static NSString * _Nullable PEString(id value) {
    return [value isKindOfClass:NSString.class] ? value : nil;
}

static NSNumber * _Nullable PENumber(id value) {
    return [value isKindOfClass:NSNumber.class] && ![value isKindOfClass:NSString.class] ? value : nil;
}

static BOOL PEReadUnsignedInteger(id value, NSUInteger *result) {
    NSNumber *number = PENumber(value);
    if (!number || CFGetTypeID((__bridge CFTypeRef)number) == CFBooleanGetTypeID()) return NO;
    NSDecimalNumber *decimal = [NSDecimalNumber decimalNumberWithDecimal:number.decimalValue];
    if ([decimal isEqualToNumber:NSDecimalNumber.notANumber] || [decimal compare:NSDecimalNumber.zero] == NSOrderedAscending) return NO;
    NSDecimalNumberHandler *roundDown = [NSDecimalNumberHandler decimalNumberHandlerWithRoundingMode:NSRoundDown
                                                                                                scale:0
                                                                                     raiseOnExactness:NO
                                                                                      raiseOnOverflow:NO
                                                                                     raiseOnUnderflow:NO
                                                                                  raiseOnDivideByZero:NO];
    if (![decimal isEqualToNumber:[decimal decimalNumberByRoundingAccordingToBehavior:roundDown]]) return NO;
    NSDecimalNumber *maximum = [NSDecimalNumber decimalNumberWithString:[NSString stringWithFormat:@"%llu", (unsigned long long)NSUIntegerMax]];
    if ([decimal compare:maximum] == NSOrderedDescending) return NO;
    if (result) *result = (NSUInteger)decimal.unsignedLongLongValue;
    return YES;
}

static BOOL PEValidPrompt(NSString * _Nullable prompt) {
    return [prompt isKindOfClass:NSString.class] && prompt.length > 0 && prompt.length <= PEBackendMaximumPromptUnits &&
        [[prompt stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] length] > 0;
}

static BOOL PEValidSuffix(NSString * _Nullable suffix, NSUInteger promptLength) {
    return [suffix isKindOfClass:NSString.class] && suffix.length > 0 && suffix.length <= PEBackendMaximumSuggestionUnits &&
        promptLength <= PEBackendMaximumPromptUnits && suffix.length <= PEBackendMaximumPromptUnits - promptLength;
}

static BOOL PEIsLoopbackBaseURL(NSURL *url) {
    NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
    NSString *host = components.host.lowercaseString;
    BOOL loopback = [host isEqualToString:@"127.0.0.1"] || [host isEqualToString:@"localhost"] || [host isEqualToString:@"::1"];
    NSInteger port = components.port.integerValue;
    BOOL validPort = !components.port || (port > 0 && port <= 65535);
    return ([components.scheme isEqualToString:@"http"] || [components.scheme isEqualToString:@"https"]) &&
        loopback && validPort && !components.user && !components.password && !components.query && !components.fragment &&
        (!components.path.length || [components.path isEqualToString:@"/"]);
}

static PEPromptVersion * _Nullable PEVersionFromDictionary(id value) {
    if (![value isKindOfClass:NSDictionary.class]) return nil;
    NSDictionary *dictionary = value;
    NSString *identifier = PEString(dictionary[@"id"]);
    NSString *prompt = PEString(dictionary[@"prompt"]);
    id rawSuggestion = dictionary[@"suggestion_text"];
    NSString *suggestion = rawSuggestion == NSNull.null ? nil : PEString(rawSuggestion);
    NSString *savedText = PEString(dictionary[@"saved_text"]);
    id rawTitle = dictionary[@"title"];
    NSString *title = rawTitle == NSNull.null ? nil : PEString(rawTitle);
    id rawDescription = dictionary[@"description"];
    NSString *description = rawDescription == NSNull.null ? nil : PEString(rawDescription);
    NSString *createdAt = PEString(dictionary[@"created_at"]);
    NSString *updatedAt = PEString(dictionary[@"updated_at"]);
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:identifier];
    if (!uuid || !PEValidPrompt(prompt) || (suggestion && !PEValidSuffix(suggestion, prompt.length)) ||
        ![savedText isEqualToString:[prompt stringByAppendingString:suggestion ?: @""]] || !createdAt.length || !updatedAt.length ||
        (title && title.length > 120) || (description && description.length > 1000)) return nil;
    PEPromptVersion *version = [PEPromptVersion new];
    version.versionID = uuid;
    version.prompt = prompt;
    version.suggestionText = suggestion;
    version.savedText = savedText;
    version.title = title;
    version.versionDescription = description;
    version.createdAt = createdAt;
    version.updatedAt = updatedAt;
    return version;
}
