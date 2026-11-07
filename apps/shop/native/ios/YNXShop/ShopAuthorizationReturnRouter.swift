import Foundation
import SwiftUI

// The registered callback is shared by both explicit Shop profiles. Choosing
// a receiver only routes an opaque original return; that profile's original
// SDK still verifies its pending request, scopes, account and device binding.
@MainActor final class ShopAuthorizationReturnRouter:ObservableObject {
    @Published private(set) var original:URL?
    @Published var presented=false
    func receive(_ url:URL)throws {
        guard url.scheme=="ynxshop",url.host=="wallet-auth",url.path=="/callback",url.absoluteString.utf8.count<=16384,original==nil || original==url else{throw ShopError.security}
        original=url;presented=true
    }
    func chooseBuyer(_ buyer:ShopModel){guard let url=original else{return};buyer.resumeAuthorizationReturnByUser(url);original=nil;presented=false}
    func chooseSeller(_ seller:ShopSellerModel){guard let url=original else{return};seller.workspaceVisible=true;seller.resumeAuthorizationReturnByUser(url);original=nil;presented=false}
}
