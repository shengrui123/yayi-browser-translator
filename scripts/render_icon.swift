import AppKit
import Foundation

let outputDirectory = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "assets")
let sizes = [16, 48, 128]

for size in sizes {
    let canvas = NSSize(width: size, height: size)
    let image = NSImage(size: canvas)
    image.lockFocus()

    let rect = NSRect(origin: .zero, size: canvas)
    let radius = CGFloat(size) * 0.22
    NSColor(calibratedRed: 0.10, green: 0.29, blue: 0.23, alpha: 1).setFill()
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()

    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let fontSize = CGFloat(size) * 0.59
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: fontSize, weight: .bold),
        .foregroundColor: NSColor(calibratedRed: 1, green: 0.96, blue: 0.82, alpha: 1),
        .paragraphStyle: paragraph
    ]
    let text = "译" as NSString
    let textHeight = text.size(withAttributes: attributes).height
    text.draw(in: NSRect(x: 0, y: (CGFloat(size) - textHeight) / 2 - CGFloat(size) * 0.04, width: CGFloat(size), height: textHeight), withAttributes: attributes)

    image.unlockFocus()
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("无法生成 \(size)px 图标")
    }
    try png.write(to: outputDirectory.appendingPathComponent("icon-\(size).png"))
}
