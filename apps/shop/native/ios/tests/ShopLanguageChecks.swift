import Foundation

@main struct ShopLanguageChecks {
    static func main()throws {
        var checks=0
        func check(_ condition:Bool,_ name:String)throws {
            guard condition else{throw NSError(domain:name,code:1)}
            checks+=1;print("PASS "+name)
        }
        let suite="com.ynxweb4.shop.language-checks."+UUID().uuidString
        let preferences=UserDefaults(suiteName:suite)!
        defer{preferences.removePersistentDomain(forName:suite)}
        // Reproduce the old Picker mismatch using real stored values and its actual tags.
        preferences.set("en_US",forKey:"app-language");preferences.set("zh",forKey:"ai-language")
        try check(!ShopLanguage.supported.contains(preferences.string(forKey:"app-language")!) && !ShopLanguage.supported.contains(preferences.string(forKey:"ai-language")!),"legacy regional/zh values reproduce unmatched Picker tags")
        let before=preferences.persistentDomain(forName:suite)! as NSDictionary
        try check(ShopLanguage.read(preferences,key:"app-language")=="en","legacy en_US displays English")
        try check(ShopLanguage.read(preferences,key:"ai-language")=="zh-Hans","legacy zh displays a supported Chinese selection")
        try check(before.isEqual(to:preferences.persistentDomain(forName:suite)!),"reading does not migrate or rewrite legacy stored values")
        for language in ShopLanguage.supported {
            try check(ShopLanguage.selection(language)==language,"supported selection remains stable: "+language)
        }
        for (locale,expected) in [("en_AU","en"),("pt_BR","pt"),("fr-CA","fr"),("ja_JP","ja"),("ko_KR","ko"),("ar_SA","ar"),("zh_CN","zh-Hans"),("zh_SG","zh-Hans"),("zh_TW","zh-Hant"),("zh_HK","zh-Hant"),("zh_MO","zh-Hant"),("zh-Hans-HK","zh-Hans"),("zh-Hant-CN","zh-Hant"),("zh_HK@calendar=gregorian","zh-Hant"),("","en"),("it_IT","en")] {
            try check(ShopLanguage.selection(locale)==expected,"locale maps to supported tag: "+locale)
        }
        try check(ShopLanguage.read(preferences,key:"missing",locale:"zh_TW")=="zh-Hant","missing preference respects full locale script/region")
        try check(preferences.object(forKey:"missing")==nil,"default selection is not silently persisted")
        let aiBefore=preferences.string(forKey:"ai-language")
        try check(ShopLanguage.choose("zh-Hant",in:preferences,key:"app-language")=="zh-Hant","explicit selection updates presentation")
        let restored=UserDefaults(suiteName:suite)!
        try check(ShopLanguage.read(restored,key:"app-language")=="zh-Hant","fresh preferences reader restores explicit choice")
        try check(restored.string(forKey:"ai-language")==aiBefore,"changing app language preserves independent AI language")
        preferences.set("unknown_legacy",forKey:"ai-language")
        try check(ShopLanguage.read(preferences,key:"ai-language")=="en" && preferences.string(forKey:"ai-language")=="unknown_legacy","unsupported legacy value falls back without erasure")
        print("\(checks) production language/preference checks PASS; UI/cold application launch not exercised")
    }
}
