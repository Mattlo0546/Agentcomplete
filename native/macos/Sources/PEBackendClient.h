#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// A validated autocomplete reply. `suffix` is never an accepted prompt; the
/// input-method controller decides whether and when to commit it.
@interface PEAutocompleteResult : NSObject
@property (nonatomic, copy, readonly) NSString *requestID;
@property (nonatomic, readonly) NSUInteger revision;
@property (nonatomic, copy, readonly) NSString *suffix;
- (instancetype)initWithRequestID:(NSString *)requestID
                          revision:(NSUInteger)revision
                            suffix:(NSString *)suffix NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@end

/// A complete, immutable prompt-history record. `suggestionText` remains
/// separate from `prompt` so an unaccepted completion can be restored safely.
@interface PEPromptVersion : NSObject
@property (nonatomic, copy, readonly) NSUUID *versionID;
@property (nonatomic, copy, readonly) NSString *prompt;
@property (nonatomic, copy, readonly, nullable) NSString *suggestionText;
@property (nonatomic, copy, readonly) NSString *savedText;
@property (nonatomic, copy, readonly, nullable) NSString *title;
@property (nonatomic, copy, readonly, nullable) NSString *versionDescription;
@property (nonatomic, copy, readonly) NSString *createdAt;
@property (nonatomic, copy, readonly) NSString *updatedAt;
@end

/// One bounded history response. Callers may request another page only after
/// explicitly opening the history UI; this keeps ordinary typing traffic small.
@interface PEPromptVersionPage : NSObject
@property (nonatomic, copy, readonly) NSArray<PEPromptVersion *> *items;
@property (nonatomic, readonly) NSUInteger total;
@end

typedef void (^PEAutocompleteCompletion)(PEAutocompleteResult * _Nullable result,
                                         NSString * _Nullable safeError);
typedef void (^PEPromptVersionsCompletion)(NSArray<PEPromptVersion *> * _Nullable versions,
                                           NSString * _Nullable safeError);
typedef void (^PEPromptVersionPageCompletion)(PEPromptVersionPage * _Nullable page,
                                              NSString * _Nullable safeError);
typedef void (^PEPromptVersionCompletion)(PEPromptVersion * _Nullable version,
                                          NSString * _Nullable safeError);
typedef void (^PEBackendCompletion)(NSString * _Nullable safeError);

/// Local-only client for the Prompt Enhance backend. All callbacks are made on
/// the main queue. The returned task can be cancelled by the caller whenever
/// the editor state changes.
@interface PEBackendClient : NSObject

- (nullable instancetype)initWithBaseURL:(NSURL *)baseURL error:(NSError * _Nullable * _Nullable)error;

/// Test-only designated initializer. The supplied configuration is still
/// constrained to a loopback base URL, but may contain NSURLProtocol stubs.
- (nullable instancetype)initWithBaseURL:(NSURL *)baseURL
                   sessionConfiguration:(NSURLSessionConfiguration *)configuration
                                   error:(NSError * _Nullable * _Nullable)error NS_DESIGNATED_INITIALIZER;

- (instancetype)init NS_UNAVAILABLE;

- (NSURLSessionDataTask *)requestAutocompleteForPrompt:(NSString *)prompt
                                               revision:(NSUInteger)revision
                                                 cursor:(NSUInteger)cursor
                                             completion:(PEAutocompleteCompletion)completion;

- (NSURLSessionDataTask *)listPromptVersionsWithCompletion:(PEPromptVersionsCompletion)completion;

/// Fetches at most 20 complete records, accepting an 8 MiB response bound.
/// There is no endpoint that exposes metadata-only rows, so callers must
/// paginate rather than downloading every saved prompt into memory.
- (NSURLSessionDataTask *)fetchPromptVersionPageAtOffset:(NSUInteger)offset
                                               completion:(PEPromptVersionPageCompletion)completion;

- (NSURLSessionDataTask *)savePrompt:(NSString *)prompt
                           suggestion:(nullable NSString *)suggestion
                                title:(nullable NSString *)title
                           completion:(PEPromptVersionCompletion)completion;

/// Used only by the test harness to remove the exact temporary version it
/// created. The history UI intentionally uses its own confirmation flow.
- (NSURLSessionDataTask *)deletePromptVersion:(NSUUID *)versionID
                                    completion:(PEBackendCompletion)completion;

/// Ends the local session after already-started explicit saves finish. Call
/// this only when its owning input session is permanently closed.
- (void)finishAndInvalidate;
@end

NS_ASSUME_NONNULL_END
