import Foundation

@main struct ProductMediaChecks {
    static func main()throws {
        let original:[String:Any]=["ID":"original-product","StoreID":"original-store","Title":"Original listing","Variants":[["ID":"original-variant","Name":"Original variant","PriceYNXT":24,"Inventory":8,"Reserved":3]]]
        func decode(_ extra:[String:Any]=[:])throws->Product {var row=original;row.merge(extra){_,new in new};return try JSONDecoder().decode(Product.self,from:JSONSerialization.data(withJSONObject:row))}
        func check(_ value:Bool,_ name:String)throws {guard value else{throw NSError(domain:name,code:1)};print("PASS "+name)}
        let legacy=try decode();try check(legacy.media.isEmpty && legacy.variants[0].available==5,"legacy no-media listing preserves reserved stock and original identities")
        let current=try decode(["Media":[["URL":"https://shop.ynxweb4.com/shop/assets/catalog/original.png","AltText":"Original public photo","Kind":"image"]]])
        try check(current.media.first?.imageURL?.absoluteString=="https://shop.ynxweb4.com/shop/assets/catalog/original.png" && current.media.first?.altText=="Original public photo","original public image and accessibility text decode")
        for raw in ["file:///private/original.png","http://shop.ynxweb4.com/image.png","https://account:secret@shop.ynxweb4.com/image.png","data:image/png;base64,AAAA","javascript:alert(1)","/relative.png"] {
            let product=try decode(["Media":[["URL":raw,"Kind":"image"]]])
            try check(product.media[0].imageURL==nil && product.productID==legacy.productID,"unsafe media uses placeholder without losing original listing: "+raw.components(separatedBy:":").first!)
        }
        let video=try decode(["Media":[["URL":"https://shop.ynxweb4.com/video.mp4","Kind":"video"]]])
        try check(video.media[0].imageURL==nil,"non-image media is not loaded as a photograph")
        for value:Any in [NSNull(),"old malformed metadata",[["URL":42]],[["AltText":"missing URL"]]] {
            let product=try decode(["Media":value]);try check(product.media.isEmpty && product.variants[0].variantID==legacy.variants[0].variantID,"invalid optional presentation retains purchasable original variant")
        }
        let roundtrip=try JSONDecoder().decode(Product.self,from:JSONEncoder().encode(current))
        try check(roundtrip.media.first?.imageURL==current.media.first?.imageURL && roundtrip.storeID==current.storeID,"media coding preserves original source fields")
    }
}
