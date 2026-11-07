import SwiftUI

// Values read from the approved local .fig KUI Tokens light/dark modes.
// Original input SHA256: e05b094a394839fec55f33919faa68809de3cbf4b2c295d7abdecc97d780dd47.
// Native text scaling remains active; MiSans resolves to the native fallback if absent.
enum ShopTheme {
    static let primary = Color("KUI.brand.primary") // brand/primary
    static let onPrimary = Color("KUI.brand.onPrimary") // brand/onPrimary
    static let subtle = Color("KUI.brand.subtle") // brand/subtle
    static let surface = Color("KUI.surface.primary") // surface/primary
    static let background = Color("KUI.surface.secondary") // surface/secondary
    static let tertiary = Color("KUI.surface.tertiary") // surface/tertiary
    static let text = Color("KUI.text.primary") // text/primary
    static let secondary = Color("KUI.text.secondary") // text/secondary
    static let muted = Color("KUI.text.tertiary") // text/tertiary
    static let border = Color("KUI.border.default") // border/default
    static let strongBorder = Color("KUI.border.strong") // border/strong
    static let success = Color("KUI.status.success") // status/success
    static let successBackground = Color("KUI.status.successBg") // status/successBg
    static let warning = Color("KUI.status.warning") // status/warning
    static let warningBackground = Color("KUI.status.warningBg") // status/warningBg
    static let danger = Color("KUI.status.danger") // status/danger
    static let dangerBackground = Color("KUI.status.dangerBg") // status/dangerBg
    static let radiusSmall:CGFloat=6
    static let radius:CGFloat=10
    static let radiusLarge:CGFloat=14
    static let maximumPageWidth:CGFloat=1360
    static let desktopPadding:CGFloat=40
    static let mobilePadding:CGFloat=16
    static func font(_ size:CGFloat=14,_ weight:Font.Weight = .regular,relativeTo:Font.TextStyle = .body)->Font {
        Font.custom("MiSans",size:size,relativeTo:relativeTo).weight(weight)
    }

}

struct ShopButtonStyle:ButtonStyle {
    enum Kind {case primary,secondary,quiet,destructive}
    var kind:Kind = .primary
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration:Configuration)->some View {
        configuration.label.shopFont(14,.semibold).padding(.horizontal,18).padding(.vertical,10)
            .foregroundStyle(foreground).background(background)
            .clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))
            .overlay(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall).stroke(kind == .secondary ? ShopTheme.border:Color.clear,lineWidth:1))
            .opacity(enabled ? (configuration.isPressed ? 0.78:1):0.42)
            .contentShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))
    }
    private var foreground:Color{switch kind{case .primary:return ShopTheme.onPrimary;case .secondary,.quiet:return ShopTheme.text;case .destructive:return ShopTheme.danger}}
    private var background:Color{switch kind{case .primary:return ShopTheme.primary;case .secondary:return ShopTheme.surface;case .quiet:return .clear;case .destructive:return ShopTheme.dangerBackground}}
}

struct ShopPanel<Content:View>:View {
    var padding:CGFloat=20
    let content:Content
    init(padding:CGFloat=20,@ViewBuilder content:()->Content){self.padding=padding;self.content=content()}
    var body:some View{content.padding(padding).frame(maxWidth:.infinity,alignment:.leading).background(ShopTheme.surface).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius)).overlay(RoundedRectangle(cornerRadius:ShopTheme.radius).stroke(ShopTheme.border,lineWidth:1))}
}
struct ShopSectionTitle:View {
    let title:LocalizedStringKey
    var body:some View{Text(title).shopFont(22,.bold,relativeTo:.title2).foregroundStyle(ShopTheme.text).frame(maxWidth:.infinity,alignment:.leading)}
}
struct ShopNotice:View {
    let title:LocalizedStringKey
    var symbol="info.circle"
    var warning=false
    var body:some View{Label(title,systemImage:symbol).shopFont(13).foregroundStyle(warning ? ShopTheme.warning:ShopTheme.secondary).frame(maxWidth:.infinity,alignment:.leading).padding(12).background(warning ? ShopTheme.warningBackground:ShopTheme.tertiary).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))}
}
struct ShopStatusBadge:View {
    let status:String
    private var success:Bool{["paid","delivered","reviewed","review_required","applied_draft"].contains(status)}
    private var danger:Bool{["failed","rejected","refused","cancelled","refund_rejected"].contains(status)}
    var body:some View{Text(LocalizedStringKey(status)).shopFont(12,.semibold).foregroundStyle(success ? ShopTheme.success:danger ? ShopTheme.danger:ShopTheme.warning).padding(.horizontal,9).padding(.vertical,5).background(success ? ShopTheme.successBackground:danger ? ShopTheme.dangerBackground:ShopTheme.warningBackground).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))}
}

private struct ShopTextScaleKey:EnvironmentKey {static let defaultValue:CGFloat=1}
extension EnvironmentValues {
    var shopTextScale:CGFloat {get{self[ShopTextScaleKey.self]}set{self[ShopTextScaleKey.self]=newValue}}
}
private struct ShopFontModifier:ViewModifier {
    @Environment(\.shopTextScale) private var scale
    let size:CGFloat
    let weight:Font.Weight
    let relativeTo:Font.TextStyle
    func body(content:Content)->some View {content.font(ShopTheme.font(size*scale,weight,relativeTo:relativeTo))}
}
extension View {
    func shopFont(_ size:CGFloat=14,_ weight:Font.Weight = .regular,relativeTo:Font.TextStyle = .body)->some View {
        modifier(ShopFontModifier(size:size,weight:weight,relativeTo:relativeTo))
    }
}
