#import "PEDiagnostics.h"
#import <fcntl.h>
#import <unistd.h>
#import <ApplicationServices/ApplicationServices.h>

@implementation PEDiagnostics

+ (void)writeStatusWithBuildVersion:(NSString *)buildVersion
                     clientBundleID:(NSString *)clientBundleID
                             active:(BOOL)active
                            enabled:(BOOL)enabled
             selectedRangeSupported:(BOOL)selectedRangeSupported
            documentLengthSupported:(BOOL)documentLengthSupported
                  caretRectSupported:(BOOL)caretRectSupported
                    draftNonempty:(BOOL)draftNonempty
                 minimumLengthMet:(BOOL)minimumLengthMet
                   selectionEmpty:(BOOL)selectionEmpty
                      caretAtEnd:(BOOL)caretAtEnd
                   paletteVisible:(BOOL)paletteVisible
                positionOnScreen:(BOOL)positionOnScreen
                          safeError:(NSString *)safeError {
    // Fixtures and unit-test processes must not overwrite a live host report.
    if (![NSBundle.mainBundle.bundleIdentifier isEqualToString:@"com.promptenhance.inputmethod.PromptEnhance"]) return;
    if (!enabled || ![clientBundleID isEqualToString:@"com.openai.codex"]) return;
    NSURL *directory = [NSURL fileURLWithPath:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Logs/Prompt Enhance"] isDirectory:YES];
    NSError *directoryError = nil;
    [[NSFileManager defaultManager] createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:&directoryError];
    if (directoryError) return;
    [[NSFileManager defaultManager] setAttributes:@{NSFilePosixPermissions: @0700} ofItemAtPath:directory.path error:nil];
    NSDictionary *status = @{
        @"buildVersion": [self safeBuildVersion:buildVersion],
        @"clientBundleID": [self safeBundleID:clientBundleID],
        @"active": @(active),
        @"accessibilityTrusted": @(AXIsProcessTrusted()),
        @"enabled": @(enabled),
        @"selectedRangeSupported": @(selectedRangeSupported),
        @"documentLengthSupported": @(documentLengthSupported),
        @"caretRectSupported": @(caretRectSupported),
        @"draftNonempty": @(draftNonempty),
        @"minimumLengthMet": @(minimumLengthMet),
        @"selectionEmpty": @(selectionEmpty),
        @"caretAtEnd": @(caretAtEnd),
        @"paletteVisible": @(paletteVisible),
        @"positionOnScreen": @(positionOnScreen),
        @"safeError": safeError ?: NSNull.null,
        @"timestamp": [[NSISO8601DateFormatter new] stringFromDate:NSDate.date],
    };
    NSError *jsonError = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:status options:NSJSONWritingSortedKeys error:&jsonError];
    if (!data || jsonError) return;
    NSString *target = [[directory path] stringByAppendingPathComponent:@"native-status.json"];
    NSString *temporary = [[directory path] stringByAppendingPathComponent:[NSString stringWithFormat:@".native-status.%@", NSUUID.UUID.UUIDString]];
    int fd = open(temporary.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd < 0) return;
    const uint8_t *bytes = data.bytes;
    NSUInteger remaining = data.length;
    BOOL complete = YES;
    while (remaining) {
        ssize_t written = write(fd, bytes, remaining);
        if (written <= 0) { complete = NO; break; }
        bytes += written;
        remaining -= (NSUInteger)written;
    }
    BOOL flushed = complete && fsync(fd) == 0;
    BOOL closed = close(fd) == 0;
    if (!complete || !flushed || !closed) { unlink(temporary.fileSystemRepresentation); return; }
    if (rename(temporary.fileSystemRepresentation, target.fileSystemRepresentation) != 0) unlink(temporary.fileSystemRepresentation);
}

+ (NSString *)safeBuildVersion:(NSString *)value {
    if (![value isKindOfClass:NSString.class] || value.length == 0 || value.length > 80) return @"unknown";
    NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-+"];
    return [value rangeOfCharacterFromSet:allowed.invertedSet].location == NSNotFound ? value : @"unknown";
}

+ (NSString *)safeBundleID:(NSString *)value {
    if (![value isKindOfClass:NSString.class] || value.length == 0 || value.length > 255) return @"unavailable";
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$" options:0 error:nil];
    NSRange range = NSMakeRange(0, value.length);
    return [pattern firstMatchInString:value options:0 range:range] ? value : @"unavailable";
}

@end
