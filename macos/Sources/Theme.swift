// Kolory i kształty z aplikacji webowej (globals.css): tło, powierzchnie, akcent, pigułki. Jasny i ciemny tryb jak w systemie.
import AppKit
import SwiftUI

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
    static func dynamic(light: NSColor, dark: NSColor) -> NSColor {
        NSColor(name: nil) { a in a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light }
    }
}

enum Theme {
    static let bgNS = NSColor.dynamic(light: NSColor(hex: 0xECEEF7), dark: NSColor(hex: 0x101018))
    static let surfaceNS = NSColor.dynamic(light: NSColor(hex: 0xFFFFFF), dark: NSColor(hex: 0x1B1B28))
    static let textNS = NSColor.dynamic(light: NSColor(hex: 0x20203A), dark: NSColor(hex: 0xECECF5))
    static let subNS = NSColor.dynamic(light: NSColor(hex: 0x6E7090), dark: NSColor(hex: 0x9A9CB8))
    static let lineNS = NSColor.dynamic(light: NSColor(hex: 0x20203A, alpha: 0.10), dark: NSColor(hex: 0xECECF5, alpha: 0.10))
    static let accentNS = NSColor.dynamic(light: NSColor(hex: 0x5A5CE6), dark: NSColor(hex: 0x7C7EF5))
    static let accent2NS = NSColor.dynamic(light: NSColor(hex: 0x6A6CF0), dark: NSColor(hex: 0x8B8DF7))
    static let accentSoftNS = NSColor.dynamic(light: NSColor(hex: 0x5A5CE6, alpha: 0.10), dark: NSColor(hex: 0x7C7EF5, alpha: 0.16))
    static let dangerNS = NSColor.dynamic(light: NSColor(hex: 0xD64B5A), dark: NSColor(hex: 0xF07A86))
    static let okNS = NSColor.dynamic(light: NSColor(hex: 0x2E8A5C), dark: NSColor(hex: 0x5CC28F))      // --ok: wysłane, zrobione
    static let warnNS = NSColor.dynamic(light: NSColor(hex: 0xA86A12), dark: NSColor(hex: 0xE6B055))    // --warn: w trakcie (obwódka kafelka w toku)
    static let glassNS = NSColor.dynamic(light: NSColor(hex: 0xFFFFFF, alpha: 0.78), dark: NSColor(hex: 0x1E1E2C, alpha: 0.80))   // --glass

    static let bg = Color(nsColor: bgNS)
    static let surface = Color(nsColor: surfaceNS)
    static let text = Color(nsColor: textNS)
    static let sub = Color(nsColor: subNS)
    static let line = Color(nsColor: lineNS)
    static let accent = Color(nsColor: accentNS)
    static let accent2 = Color(nsColor: accent2NS)
    static let accentSoft = Color(nsColor: accentSoftNS)
    static let danger = Color(nsColor: dangerNS)
    static let ok = Color(nsColor: okNS)
    static let warn = Color(nsColor: warnNS)
    static let glass = Color(nsColor: glassNS)
}

// przycisk-pigułka jak .pill / .pill.primary w aplikacji webowej
struct PillStyle: ButtonStyle {
    var primary = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .semibold))
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .foregroundColor(primary ? Color.white : Theme.accent)
            .background(
                Group {
                    if primary {
                        LinearGradient(colors: [Theme.accent2, Theme.accent], startPoint: .top, endPoint: .bottom)
                    } else {
                        Theme.accentSoft
                    }
                }
            )
            .clipShape(Capsule())
            .shadow(color: primary ? Theme.accent.opacity(0.35) : Color.clear, radius: 6, x: 0, y: 3)
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

// logo jak w lewym górnym rogu aplikacji webowej: kwadrat z gradientem i dwiema kreskami
struct LogoMark: View {
    var size: CGFloat = 22
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
                .fill(LinearGradient(colors: [Theme.accent2, Theme.accent], startPoint: .top, endPoint: .bottom))
            VStack(alignment: .leading, spacing: size * 0.14) {
                Capsule().fill(Color.white).frame(width: size * 0.5, height: size * 0.11)
                Capsule().fill(Color.white.opacity(0.85)).frame(width: size * 0.32, height: size * 0.11)
            }
        }
        .frame(width: size, height: size)
    }
}
