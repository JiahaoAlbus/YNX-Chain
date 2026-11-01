import Foundation

// A navigation selector, never a session, approval, payment or replay capability.
struct OriginalOrderLink:Equatable,Identifiable {
    static let chainID="ynx_6423-1"
    let orderID:String
    let account:String
    var id:String {"ynxshop://orders/\(orderID)?account=\(account)&chainId=\(Self.chainID)"}
    static func parse(_ raw:String)throws->Self {
        let pattern="^ynxshop://orders/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\\?account=(ynx1[023456789acdefghjklmnpqrstuvwxyz]{38})&chainId=ynx_6423-1$"
        guard raw.utf8.count<=512,let match=try NSRegularExpression(pattern:pattern).firstMatch(in:raw,range:NSRange(raw.startIndex...,in:raw)),match.range.length==raw.utf16.count,
              let order=Range(match.range(at:1),in:raw),let account=Range(match.range(at:2),in:raw) else{throw ShopError.security}
        return Self(orderID:String(raw[order]),account:String(raw[account]))
    }
}

extension APIClient {
    func readOriginalOrderLink(_ link:OriginalOrderLink,beforeDispatch:@escaping ()throws->Void)async throws->Order {
        let check=try capture()
        guard let current=currentSession,current.account==link.account,current.nativeGeneration != nil else{throw ShopError.security}
        let raw=try await self.raw("orders/\(link.orderID)",method:"GET",json:[:],beforeDispatch:beforeDispatch)
        try check()
        let order=try AppleBuyerReceipt.decode(raw,account:current.account)
        guard order.orderID==link.orderID else{throw ShopError.security}
        return order
    }
}
