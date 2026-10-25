#import <AppKit/AppKit.h>
int PEEngineTests(void);
int PEBackendClientTests(void);
int PETextSystemTests(void);
int PECoordinatorTests(void);
int PEBridgeTests(void);
int main(void) {
    @autoreleasepool {
        if (PEEngineTests() != 0) return 1;
        if (PEBackendClientTests() != 0) return 1;
        if (PETextSystemTests() != 0) return 1;
        if (PECoordinatorTests() != 0) return 1;
        if (PEBridgeTests() != 0) return 1;
    }
    return 0;
}
