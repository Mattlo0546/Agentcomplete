import AppKit
let image = NSImage(size: NSSize(width: 18, height: 18))
image.lockFocus()
let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
("PE" as NSString).draw(in: NSRect(x: 0, y: 1, width: 18, height: 16), withAttributes: [
    .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
    .foregroundColor: NSColor.black,
    .paragraphStyle: paragraph,
])
image.unlockFocus()
try image.tiffRepresentation!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
