#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Writes capability-only native input diagnostics. It never accepts prompt
/// text, selected text, suggestion text, positions, coordinates, or events.
@interface PEDiagnostics : NSObject
+ (void)writeStatusWithBuildVersion:(NSString *)buildVersion
                     clientBundleID:(nullable NSString *)clientBundleID
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
                  fieldAnchorUsed:(BOOL)fieldAnchorUsed
               suggestionAvailable:(BOOL)suggestionAvailable
                  suggestionVisible:(BOOL)suggestionVisible
              autocompleteInFlight:(BOOL)autocompleteInFlight
                          safeError:(nullable NSString *)safeError;
@end

NS_ASSUME_NONNULL_END
