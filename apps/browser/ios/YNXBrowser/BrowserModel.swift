import Foundation
import SwiftUI
import UIKit
import Security
import CryptoKit

struct BrowserTab: Identifiable, Codable, Equatable { var id=UUID();var url:String;var title:String;var isPrivate:Bool;var crashed=false }
struct BrowserRecord: Identifiable, Codable { var id=UUID();var title:String;var url:String;var at=Date() }
struct PersistedBrowser: Codable { var tabs:[BrowserTab];var history:[BrowserRecord];var bookmarks:[BrowserRecord];var downloads:[BrowserRecord];var locale:String;var aiLocale:String;var audit:[BrowserRecord] }

@MainActor final class BrowserModel: ObservableObject {
    @Published var tabs:[BrowserTab]=[];@Published var active:UUID?;@Published var history:[BrowserRecord]=[];@Published var bookmarks:[BrowserRecord]=[];@Published var downloads:[BrowserRecord]=[];@Published var notice="";@Published var locale="en";@Published var aiLocale="en";@Published var library:LibraryKind?;@Published var showSettings=false;@Published var aiPreview:AiPreview?
    enum LibraryKind:String,Identifiable{case history,bookmarks,downloads;var id:String{rawValue}}
    struct AiPreview:Identifiable{let id=UUID();let url:String;let characters:Int;let provider:String}
    private let stateURL:URL;private var usedNonces=Set<String>();private var pendingNonce:String?
    init(){let base=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("YNXBrowser",isDirectory:true);try?FileManager.default.createDirectory(at:base,withIntermediateDirectories:true);stateURL=base.appendingPathComponent("state.json");restore();if tabs.isEmpty{open("https://search-staging.43.153.202.237.sslip.io",privateMode:false)}}
    var current:BrowserTab?{tabs.first{$0.id==active}}
    func open(_ url:String,privateMode:Bool){let tab=BrowserTab(url:url,title:privateMode ? L.text(locale,"private") : L.text(locale,"new"),isPrivate:privateMode);tabs.append(tab);active=tab.id;if privateMode{notice=L.text(locale,"privateBoundary")};persist()}
    func close(_ id:UUID){tabs.removeAll{$0.id==id};if active==id{active=tabs.last?.id};if tabs.isEmpty{open("https://search-staging.43.153.202.237.sslip.io",privateMode:false)};persist()}
    func navigated(_ id:UUID,url:String,title:String){guard let index=tabs.firstIndex(where:{$0.id==id})else{return};tabs[index].url=url;tabs[index].title=title;if !tabs[index].isPrivate{history.insert(BrowserRecord(title:title,url:url),at:0);history=Array(history.prefix(5000))};persist()}
    func processCrashed(_ id:UUID){guard let index=tabs.firstIndex(where:{$0.id==id})else{return};tabs[index].crashed=true;notice="WebKit content process recovered";persist()}
    func bookmark(){guard let tab=current else{return};bookmarks.insert(BrowserRecord(title:tab.title,url:tab.url),at:0);persist()}
    func downloaded(title:String,url:String,privateMode:Bool){if !privateMode{downloads.insert(BrowserRecord(title:title,url:url),at:0);persist()}}
    func clear(history clearHistory:Bool,bookmarks clearBookmarks:Bool,permissions:Bool,recovery:Bool){if clearHistory{history=[]};if clearBookmarks{bookmarks=[]};if permissions{UserDefaults.standard.removeObject(forKey:"sitePermissions")};if recovery{tabs=tabs.filter{$0.isPrivate};active=tabs.last?.id};notice="Local data cleared. Downloaded files remain.";persist()}
    func setLocale(_ value:String){locale=L.resolve(value);UserDefaults.standard.set(locale,forKey:"browserLocale");persist()}
    func startWallet(){let nonce=randomToken();pendingNonce=nonce;UserDefaults.standard.set(nonce,forKey:"walletNonce");UserDefaults.standard.set(Date().addingTimeInterval(300).timeIntervalSince1970,forKey:"walletExpiry");guard let productDeviceKey=devicePublicKey() else{notice="Wallet request creation failed: device key unavailable";return};let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds];let request:[String:Any]=["version":"1","nonce":nonce,"chainId":"ynx_6423-1","requestingProduct":"browser","productClientId":"ynx-browser-ios","bundleId":"com.ynxweb4.browser.ios","productDeviceAlgorithm":"p256-sha256","productDeviceKey":productDeviceKey,"callback":"ynxbrowser://com.ynxweb4.browser.ios/auth/callback","scopes":["account:read","browser:wallet-request"],"purpose":"Sign in to YNX Browser","issuedAt":formatter.string(from:Date()),"expiresAt":formatter.string(from:Date().addingTimeInterval(300))];guard let data=try?JSONSerialization.data(withJSONObject:request),let link=URL(string:"ynxwallet://authorize?request="+data.base64URLEncodedString())else{notice="Wallet request creation failed";return};UIApplication.shared.open(link,options:[:]){ok in Task{@MainActor in if !ok{self.notice="YNX Wallet is not installed."}}}}
    func handleWalletCallback(_ url:URL){guard url.scheme=="ynxbrowser",url.host=="com.ynxweb4.browser.ios",url.path=="/auth/callback",let components=URLComponents(url:url,resolvingAgainstBaseURL:false),components.queryItems?.count==1,components.queryItems?.first?.name=="response",let encoded=components.queryItems?.first?.value,let data=Data(base64URLEncoded:encoded),let object=try?JSONSerialization.jsonObject(with:data)as?[String:Any],let nonce=object["nonce"]as?String else{notice="Wallet callback rejected: route or payload mismatch";return};let expected=UserDefaults.standard.string(forKey:"walletNonce"),expiry=UserDefaults.standard.double(forKey:"walletExpiry");guard nonce==expected,expiry>Date().timeIntervalSince1970,!usedNonces.contains(nonce),object["chainId"]as?String=="ynx_6423-1",object["productClientId"]as?String=="ynx-browser-ios",object["bundleId"]as?String=="com.ynxweb4.browser.ios" else{notice="Wallet callback rejected: replay, expiry or binding mismatch";return};usedNonces.insert(nonce);UserDefaults.standard.removeObject(forKey:"walletNonce");notice="Wallet response received. Gateway signature/device challenge verification is required; no local session was created."}
    func prepareAi(characters:Int){guard let tab=current,!tab.isPrivate else{notice="AI is unavailable for private tabs.";return};aiPreview=AiPreview(url:tab.url,characters:characters,provider:"unavailable until Gateway session is verified")}
    func approveAi(){notice="AI provider unavailable — no verified Gateway session configured.";aiPreview=nil}
    private func restore(){locale=L.resolve(UserDefaults.standard.string(forKey:"browserLocale") ?? Locale.preferredLanguages.first ?? "en");aiLocale=L.resolve(UserDefaults.standard.string(forKey:"aiLocale") ?? locale);guard let data=try?Data(contentsOf:stateURL),let saved=try?JSONDecoder().decode(PersistedBrowser.self,from:data)else{return};tabs=saved.tabs.filter{!$0.isPrivate};history=saved.history;bookmarks=saved.bookmarks;downloads=saved.downloads;active=tabs.last?.id}
    private func persist(){let saved=PersistedBrowser(tabs:tabs.filter{!$0.isPrivate},history:history,bookmarks:bookmarks,downloads:downloads,locale:locale,aiLocale:aiLocale,audit:[]);if let data=try?JSONEncoder().encode(saved){try?data.write(to:stateURL,options:.atomic)}}
    private func randomToken()->String{var bytes=[UInt8](repeating:0,count:32);_ = SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes);return Data(bytes).base64URLEncodedString()}
    private func devicePublicKey()->String?{
        let account="wallet-product-device-p256"
        let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"com.ynxweb4.browser.ios",kSecAttrAccount as String:account,kSecReturnData as String:true]
        var item:CFTypeRef?
        let key:P256.Signing.PrivateKey
        if SecItemCopyMatching(query as CFDictionary,&item)==errSecSuccess,let data=item as?Data,let restored=try?P256.Signing.PrivateKey(rawRepresentation:data){key=restored}else{
            key=P256.Signing.PrivateKey()
            let add:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"com.ynxweb4.browser.ios",kSecAttrAccount as String:account,kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,kSecValueData as String:key.rawRepresentation]
            SecItemDelete(query as CFDictionary)
            guard SecItemAdd(add as CFDictionary,nil)==errSecSuccess else{return nil}
        }
        guard let compact=key.publicKey.compactRepresentation else{return nil}
        return compact.base64URLEncodedString()
    }
}

extension Data{
    func base64URLEncodedString()->String{base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")}
    init?(base64URLEncoded:String){var value=base64URLEncoded.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");value+=String(repeating:"=",count:(4-value.count%4)%4);self.init(base64Encoded:value)}
}
