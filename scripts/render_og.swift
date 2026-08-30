import AppKit
import Foundation

let root = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath)
let output = root.appendingPathComponent("docs/og.png")
let iconURL = root.appendingPathComponent("assets/icon-128.png")
let canvas = NSSize(width: 1200, height: 630)
let image = NSImage(size: canvas)
image.lockFocus()

NSColor(calibratedRed: 0.09, green: 0.25, blue: 0.20, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: canvas)).fill()

NSColor(calibratedRed: 0.17, green: 0.37, blue: 0.29, alpha: 1).setStroke()
for index in 0..<4 {
    let inset = CGFloat(index) * 72 + 28
    let circle = NSBezierPath(ovalIn: NSRect(x: 770 - inset / 2, y: 15 - inset / 2, width: 560 + inset, height: 560 + inset))
    circle.lineWidth = 2
    circle.stroke()
}

if let icon = NSImage(contentsOf: iconURL) {
    icon.draw(in: NSRect(x: 84, y: 448, width: 78, height: 78))
}

let gold = NSColor(calibratedRed: 0.91, green: 0.84, blue: 0.59, alpha: 1)
let white = NSColor(calibratedWhite: 0.97, alpha: 1)
let muted = NSColor(calibratedRed: 0.72, green: 0.80, blue: 0.76, alpha: 1)

func draw(_ value: String, in rect: NSRect, size: CGFloat, color: NSColor, weight: NSFont.Weight = .regular) {
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byWordWrapping
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: style
    ]
    (value as NSString).draw(in: rect, withAttributes: attributes)
}

draw("雅 译", in: NSRect(x: 184, y: 465, width: 300, height: 54), size: 30, color: gold, weight: .semibold)
draw("把世界，\n读成中文。", in: NSRect(x: 82, y: 192, width: 710, height: 230), size: 88, color: white, weight: .medium)
draw("网页与视频字幕翻译插件  ·  Chrome / Firefox / Safari", in: NSRect(x: 88, y: 105, width: 850, height: 42), size: 22, color: muted)

let badge = NSBezierPath(roundedRect: NSRect(x: 888, y: 82, width: 220, height: 54), xRadius: 27, yRadius: 27)
gold.setFill()
badge.fill()
draw("信 · 达 · 雅", in: NSRect(x: 935, y: 96, width: 160, height: 30), size: 18, color: NSColor(calibratedRed: 0.09, green: 0.25, blue: 0.20, alpha: 1), weight: .bold)

image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("无法生成社交分享图")
}
try png.write(to: output)
