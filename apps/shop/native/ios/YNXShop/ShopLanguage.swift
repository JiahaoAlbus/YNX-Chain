import Foundation

enum ShopLanguage {
    static let supported=["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"]

    static func selection(_ identifier:String)->String {
        let base=identifier.trimmingCharacters(in:.whitespacesAndNewlines).components(separatedBy:"@")[0]
        let parts=base.replacingOccurrences(of:"_",with:"-").lowercased().split(separator:"-").map(String.init)
        guard let language=parts.first else{return "en"}
        if language=="zh" {
            // An explicit script wins over region (e.g. zh-Hans-HK).
            if let script=parts.dropFirst().first(where:{$0=="hans" || $0=="hant"}){return script=="hant" ? "zh-Hant":"zh-Hans"}
            let region=parts.dropFirst().first(where:{$0.count==2})
            return ["tw","hk","mo"].contains(region ?? "") ? "zh-Hant":"zh-Hans"
        }
        return supported.contains(language) ? language:"en"
    }

    static func read(_ preferences:UserDefaults,key:String,locale:String=Locale.current.identifier)->String {
        // Interpret legacy values in memory; startup never rewrites stored preferences.
        selection(preferences.string(forKey:key) ?? locale)
    }

    @discardableResult static func choose(_ value:String,in preferences:UserDefaults,key:String)->String {
        let selected=selection(value)
        preferences.set(selected,forKey:key)
        return selected
    }
}
