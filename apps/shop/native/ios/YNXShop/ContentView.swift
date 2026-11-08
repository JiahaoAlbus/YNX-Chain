import SwiftUI
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

let supportedLanguages=ShopLanguage.supported

// The approved design supplies separate desktop and mobile navigation.
// All commerce values remain owned by the original Model/API and its journals.
struct ContentView:View {
    @EnvironmentObject var model:ShopModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab=0
    @AppStorage("shop-text-size") private var textSize="standard"
    @AppStorage("shop-color-scheme") private var themeChoice="system"
    private var textScale:CGFloat{textSize=="compact" ? 0.925:textSize=="larger" ? 1.15:1}
    var body:some View {
        GeometryReader{geometry in
            let desktop=geometry.size.width>=900
            Group {
                if desktop {
                    NavigationStack{page(desktop:true).id(selectedTab)}
                        .safeAreaInset(edge:.top,spacing:0){DesktopShopHeader(selectedTab:$selectedTab)}
                } else {
                    TabView(selection:$selectedTab){
                        NavigationStack{CatalogView(searchOnly:false)}.tabItem{Label("nav_catalog",systemImage:"house")}.tag(0)
                        NavigationStack{CatalogView(searchOnly:true)}.tabItem{Label("search",systemImage:"magnifyingglass")}.tag(1)
                        NavigationStack{CartView().id(model.privacyRevision)}.tabItem{Label("nav_cart",systemImage:"cart")}.tag(2).badge(model.cart.count)
                        NavigationStack{OrdersView()}.tabItem{Label("nav_orders",systemImage:"shippingbox")}.tag(3)
                        NavigationStack{AccountView().id(model.privacyRevision)}.tabItem{Label("nav_account",systemImage:"person.crop.circle")}.tag(4)
                    }
                }
            }
            .shopFont(14).foregroundStyle(ShopTheme.text)
            .background(ShopTheme.background).tint(ShopTheme.primary)
            .safeAreaInset(edge:.top,spacing:0){ShopRuntimeNotices()}
        }
        .environment(\.shopTextScale,textScale)
        .preferredColorScheme(themeChoice=="dark" ? .dark:themeChoice=="light" ? .light:nil)
        .sheet(item:$model.originalOrderLink,onDismiss:{model.originalOrderSheetDismissed()}){link in OriginalOrderLinkSheet(link:link)}
        .sheet(item:$model.invoicePresentation){presentation in OriginalInvoiceSheet(presentation:presentation)}
        .sheet(isPresented:$model.agentWorkspaceVisible){AgentWorkspaceView()}
        .onChange(of:selectedTab){model.cancelInvoicePresentation();model.agentWorkspaceVisible=false}
        .onChange(of:model.originalOrderLink?.id){if model.originalOrderLink != nil{model.agentWorkspaceVisible=false}}
        .onChange(of:scenePhase){
            if scenePhase != .active{model.cancelInvoicePresentation();if scenePhase == .background{model.suspendOriginalOrderLink()}}
            else{model.sceneActive()}
        }
    }
    @ViewBuilder private func page(desktop:Bool)->some View {
        switch selectedTab {
        case 1:CatalogView(searchOnly:true)
        case 2:CartView().id(model.privacyRevision)
        case 3:OrdersView()
        case 4:AccountView().id(model.privacyRevision)
        default:CatalogView(searchOnly:false)
        }
    }
}

struct DesktopShopHeader:View {
    @EnvironmentObject var model:ShopModel
    @EnvironmentObject var seller:ShopSellerModel
    @Binding var selectedTab:Int
    var body:some View {
        GeometryReader{geometry in
        let spacious=geometry.size.width>=1200
        HStack(spacing:spacious ? 24:16){
            Button{selectedTab=0}label:{HStack(spacing:8){Image("YNXLogo").resizable().scaledToFit().frame(width:35,height:24);Text("YNX Shop").shopFont(20,.bold)}}.buttonStyle(.plain)
            if spacious{Button("nav_catalog"){selectedTab=0}.buttonStyle(ShopButtonStyle(kind:selectedTab==0 ? .quiet:.secondary));Button("nav_orders"){selectedTab=3}.buttonStyle(ShopButtonStyle(kind:.quiet))}
            Spacer(minLength:8)
            ShopSearchField{selectedTab=1;Task{await model.loadCatalog()}}.frame(maxWidth:spacious ? 400:300)
            Button{selectedTab=2}label:{Label{if spacious{Text("nav_cart")};if !model.cart.isEmpty{Text("\(model.cart.count)")}}icon:{Image(systemName:"cart")}}.buttonStyle(.plain)
            Button(model.signedIn ? "wallet_active":"wallet_sign_in"){if model.signedIn{selectedTab=4}else{model.signIn()}}.buttonStyle(ShopButtonStyle(kind:.secondary))
            Button{selectedTab=4}label:{Image(systemName:"person.crop.circle").font(.title2)}.buttonStyle(.plain).accessibilityLabel("nav_account")
            Menu{Button("nav_catalog"){selectedTab=0};Button("nav_orders"){selectedTab=3};Button("nav_account"){selectedTab=4};Divider();Button("seller_console"){seller.workspaceVisible=true};Link("merchant_invoices",destination:URL(string:"https://pay.ynxweb4.com/merchant/")!)}label:{Image(systemName:"square.grid.2x2")}.menuStyle(.automatic).fixedSize().accessibilityLabel("commerce_services")
        }.padding(.horizontal,32).frame(height:64).background(ShopTheme.surface).overlay(alignment:.bottom){ShopTheme.border.frame(height:1)}
        }.frame(height:64)
    }
}
struct ShopSearchField:View {
    @EnvironmentObject var model:ShopModel
    var submit:()->Void
    var body:some View{HStack(spacing:10){Image(systemName:"magnifyingglass").foregroundStyle(ShopTheme.secondary);TextField("search_hint",text:$model.search).shopCapitalization(false).textFieldStyle(.plain).onSubmit(submit);if !model.search.isEmpty{Button{model.search="";submit()}label:{Image(systemName:"xmark.circle.fill").foregroundStyle(ShopTheme.muted)}.buttonStyle(.plain).accessibilityLabel("close")}}.padding(.horizontal,12).frame(minHeight:38).background(ShopTheme.background).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall)).overlay(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall).stroke(ShopTheme.border,lineWidth:1))}
}
struct ShopRuntimeNotices:View {
    @EnvironmentObject var model:ShopModel
    var body:some View{VStack(spacing:0){
        if model.nativeReturnPending{HStack{Text("restore_pending");Spacer();Button("restore_pending"){model.signIn()}.buttonStyle(ShopButtonStyle(kind:.secondary))}.padding(.horizontal,16).padding(.vertical,8).background(ShopTheme.subtle)}
        if model.localDataLocked{HStack(spacing:12){Image(systemName:"lock");Text("local_data_locked");Spacer();Button("unlock_local_data"){model.unlockLocalData()}.buttonStyle(ShopButtonStyle(kind:.secondary))}.shopFont(12).padding(.horizontal,16).padding(.vertical,8).background(ShopTheme.subtle)}
        if !model.state.isEmpty && model.state != "empty_catalog"{HStack(spacing:8){if model.state=="loading"{ProgressView().controlSize(.small)};Text(LocalizedStringKey(model.state)).accessibilityLabel("accessibility_status");Spacer()}.shopFont(12).padding(.horizontal,16).padding(.vertical,8).background(ShopTheme.tertiary)}
    }}
}

struct CatalogView:View {
    @EnvironmentObject var model:ShopModel
    var searchOnly=false
    @State private var category:String?
    @State private var sort="default"
    @State private var inStock=false
    @State private var comparisonIDs=Set<String>()
    private var categories:[String]{Array(Set(model.products.compactMap(\.category).filter{!$0.isEmpty})).sorted()}
    private var filtered:[Product]{model.products.filter{p in (category==nil || p.category==category) && (!inStock || p.variants.contains{$0.available>0})}}
    private var comparablePrices:[String:UInt64]?{ShopNativeCatalogOrdering.prices(filtered)}
    private var displayed:[Product]{
        guard sort != "default",let prices=comparablePrices else{return filtered}
        return filtered.sorted{left,right in
            guard let a=prices[left.productID],let b=prices[right.productID] else{return false}
            if a==b{return left.productID<right.productID}
            return sort=="price_low" ? a<b:a>b
        }
    }
    var body:some View{GeometryReader{geometry in
        let desktop=geometry.size.width>=900
        ScrollView{VStack(alignment:.leading,spacing:24){
            if !desktop{HStack{ShopSearchField{Task{await model.loadCatalog()}};Button{model.prepareComparison(ids:Array(comparisonIDs).sorted())}label:{Image(systemName:"sparkles").frame(width:36,height:38)}.buttonStyle(.plain).accessibilityLabel("ai_compare")}}
            if !searchOnly{ShopEditorialHero(desktop:desktop)}
            if !categories.isEmpty{ScrollView(.horizontal,showsIndicators:false){HStack(spacing:12){categoryButton(nil);ForEach(categories,id:\.self){categoryButton($0)}}}}
            HStack(alignment:.firstTextBaseline){ShopSectionTitle(title:searchOnly ? "search":"catalog_heading");Spacer();Button("ai_compare"){model.prepareComparison(ids:Array(comparisonIDs).sorted())}.buttonStyle(ShopButtonStyle(kind:.secondary))}
            HStack(spacing:16){Text("\(displayed.count)").monospacedDigit();Text("shop_visible_results").foregroundStyle(ShopTheme.secondary);Spacer();Toggle("shop_in_stock",isOn:$inStock).toggleStyle(.switch).controlSize(.mini);Picker("shop_sort",selection:$sort){Text("shop_sort_default").tag("default");Text("shop_sort_low").tag("price_low").disabled(comparablePrices==nil);Text("shop_sort_high").tag("price_high").disabled(comparablePrices==nil)}.pickerStyle(.menu).fixedSize()}.shopFont(12)
            if comparablePrices==nil && !filtered.isEmpty{ShopNotice(title:"shop_sort_incomparable")}
            if model.catalogIsStale && !model.products.isEmpty{ShopNotice(title:model.catalogPhase=="offline" ? "shop_catalog_offline_stale":"shop_catalog_stale",symbol:"clock.arrow.circlepath",warning:true)}
            if model.catalogIsStale,let source=model.catalogLoadedQuery{BuyerDetailValue(title:"shop_catalog_source_query",value:source.isEmpty ? String(localized:"shop_all_categories"):source)}
            if model.catalogPhase=="loading" && !model.products.isEmpty{ProgressView("shop_catalog_loading").shopFont(12)}
            if displayed.isEmpty {
                if model.catalogPhase=="loading" || model.catalogPhase=="idle"{ProgressView().frame(maxWidth:.infinity,minHeight:180)}
                else if model.catalogPhase=="failed" || model.catalogPhase=="offline"{ContentUnavailableView(model.catalogPhase=="offline" ? "shop_catalog_offline":"shop_catalog_failed",systemImage:"wifi.exclamationmark",description:Text("shop_catalog_retry_note"));Button("retry"){Task{await model.loadCatalog()}}.buttonStyle(ShopButtonStyle(kind:.secondary))}
                else{ContentUnavailableView(model.products.isEmpty ? "empty_catalog":"shop_no_filter_matches",systemImage:"magnifyingglass",description:Text("no_fake_records")).frame(maxWidth:.infinity,minHeight:220);Button("retry"){Task{await model.loadCatalog()}}.buttonStyle(ShopButtonStyle(kind:.secondary))}
            } else {
                LazyVGrid(columns:[GridItem(.adaptive(minimum:desktop ? 220:150,maximum:desktop ? 320:260),spacing:20)],alignment:.leading,spacing:20){ForEach(displayed){product in
                    ShopProductCard(product:product,selected:comparisonIDs.contains(product.productID)){if comparisonIDs.contains(product.productID){comparisonIDs.remove(product.productID)}else if comparisonIDs.count<3{comparisonIDs.insert(product.productID)}}
                }}
            }
            if !searchOnly{ShopPlatformServices(desktop:desktop)}
            ShopMarketplaceFooter()
        }.padding(desktop ? ShopTheme.desktopPadding:ShopTheme.mobilePadding).frame(maxWidth:ShopTheme.maximumPageWidth+80).frame(maxWidth:.infinity,alignment:.center)}
        .background(ShopTheme.background).navigationTitle(searchOnly ? "search":"app_name").shopInlineTitle().refreshable{await model.loadCatalog()}
        .onChange(of:comparablePrices==nil){if comparablePrices==nil{sort="default"}}
        .onChange(of:model.products.map(\.productID)){comparisonIDs.formIntersection(Set(model.products.map(\.productID)));if let category,!categories.contains(category){self.category=nil}}
    }}
    private func categoryButton(_ value:String?)->some View{Button{category=value}label:{Text(value ?? String(localized:"shop_all_categories")).shopFont(13,.semibold).padding(.horizontal,18).padding(.vertical,12).foregroundStyle(category==value ? ShopTheme.primary:ShopTheme.text).background(category==value ? ShopTheme.subtle:ShopTheme.surface).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))}.buttonStyle(.plain)}
}
struct ShopEditorialHero:View {
    let desktop:Bool
    var body:some View{Group{if desktop{HStack(spacing:32){VStack(alignment:.leading,spacing:16){Text("shop_testnet_label").shopFont(13,.semibold).foregroundStyle(ShopTheme.primary);Text("shop_hero_title").shopFont(34,.bold,relativeTo:.largeTitle);Text("shop_hero_subtitle").shopFont(13).foregroundStyle(ShopTheme.secondary).fixedSize(horizontal:false,vertical:true);Label(OriginalOrderLink.chainID,systemImage:"network").shopFont(12).foregroundStyle(ShopTheme.secondary)}.frame(maxWidth:440,alignment:.leading);Spacer(minLength:0);Image("ShopEditorialDesktop").resizable().aspectRatio(1040.0/472.0,contentMode:.fit).frame(maxWidth:520).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius)).accessibilityLabel("shop_editorial_image")}.padding(.horizontal,48).padding(.vertical,32).frame(minHeight:280).background(ShopTheme.surface).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusLarge)).overlay(RoundedRectangle(cornerRadius:ShopTheme.radiusLarge).stroke(ShopTheme.border,lineWidth:1))}else{VStack(alignment:.leading,spacing:12){Image("ShopEditorialMobile").resizable().aspectRatio(740.0/280.0,contentMode:.fit).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusLarge)).accessibilityLabel("shop_editorial_image");Text("shop_testnet_label").shopFont(12,.semibold).foregroundStyle(ShopTheme.primary);Text("shop_hero_title").shopFont(22,.bold,relativeTo:.title2)}}}}
}
struct ShopProductCard:View {
    @EnvironmentObject var model:ShopModel
    let product:Product
    let selected:Bool
    let toggleComparison:()->Void
    var body:some View{VStack(alignment:.leading,spacing:0){
        ProductImage(product:product,height:190)
        VStack(alignment:.leading,spacing:9){
            NavigationLink{ProductView(product:product)}label:{Text(product.name).shopFont(15,.semibold).foregroundStyle(ShopTheme.text).lineLimit(2).frame(maxWidth:.infinity,alignment:.leading)}.buttonStyle(.plain)
            if let category=product.category{Text(category).shopFont(12).foregroundStyle(ShopTheme.secondary)}
            ShopCatalogProductPrice(product:product).shopFont(17,.bold).foregroundStyle(ShopTheme.text)
            HStack{Text(String(format:String(localized:"catalog_variant_count",locale:Locale(identifier:model.appLanguage)),locale:Locale(identifier:model.appLanguage),Int64(product.variants.count))).foregroundStyle(ShopTheme.secondary);Spacer();Button(action:toggleComparison){Image(systemName:selected ? "checkmark.circle.fill":"plus.circle").foregroundStyle(selected ? ShopTheme.primary:ShopTheme.secondary)}.buttonStyle(.plain).accessibilityLabel("ai_compare")}.shopFont(12)
        }.padding(16)
    }.background(ShopTheme.surface).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius)).overlay(RoundedRectangle(cornerRadius:ShopTheme.radius).stroke(selected ? ShopTheme.primary:ShopTheme.border,lineWidth:1))}
}
struct ProductImage:View {
    let product:Product
    let height:CGFloat
    private var media:ProductMedia?{product.media.first(where:{$0.imageURL != nil})}
    var body:some View{ShopRemoteProductImage(url:media?.imageURL,alt:media?.altText ?? product.name,height:height)}
}
private struct ShopRemoteProductImage:View {
    let url:URL?
    let alt:String
    let height:CGFloat
    var compact=false
    @State private var retryGeneration=0
    @State private var loadedImage:Image?
    @State private var loadPhase="loading"
    private var requestKey:String{(url?.absoluteString ?? "missing")+":"+String(retryGeneration)}
    var body:some View{Group{
        if let loadedImage{loadedImage.resizable().scaledToFit().accessibilityLabel(alt)}
        else if url==nil{state("shop_image_missing",symbol:"photo",loading:false,retry:false)}
        else if loadPhase=="failed"{state("shop_image_failed",symbol:"exclamationmark.triangle",loading:false,retry:!compact)}
        else{state("shop_image_loading",symbol:"photo",loading:true,retry:false)}
    }.frame(maxWidth:.infinity).frame(height:height).background(ShopTheme.tertiary).clipped().task(id:requestKey){await loadOriginalImage()}}
    @MainActor private func loadOriginalImage()async {
        loadedImage=nil
        guard let url else{loadPhase="missing";return}
        loadPhase="loading"
        let configuration=URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies=false
        let session=URLSession(configuration:configuration,delegate:ShopRedirectPolicy(),delegateQueue:nil)
        defer{session.invalidateAndCancel()}
        var request=URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:15)
        request.httpShouldHandleCookies=false
        do{
            let(data,response)=try await session.data(for:request)
            guard !Task.isCancelled else{return}
            guard let http=response as? HTTPURLResponse,(200..<300).contains(http.statusCode),response.url==url,!data.isEmpty,data.count<=16_777_216 else{loadPhase="failed";return}
#if canImport(AppKit)
            guard let native=NSImage(data:data) else{loadPhase="failed";return}
            loadedImage=Image(nsImage:native)
#elseif canImport(UIKit)
            guard let native=UIImage(data:data) else{loadPhase="failed";return}
            loadedImage=Image(uiImage:native)
#endif
            loadPhase="loaded"
        }catch{if !Task.isCancelled{loadPhase="failed"}}
    }
    private func state(_ title:LocalizedStringKey,symbol:String,loading:Bool,retry:Bool)->some View{VStack(spacing:8){
        if loading{ProgressView().controlSize(.small)}else{Image(systemName:symbol).foregroundStyle(ShopTheme.muted)}
        if !compact{Text(title).shopFont(12).foregroundStyle(ShopTheme.secondary).multilineTextAlignment(.center)}
        if retry{Button("shop_retry_image"){retryGeneration+=1}.buttonStyle(.plain).shopFont(12).foregroundStyle(ShopTheme.primary)}
    }.padding(compact ? 4:12).frame(maxWidth:.infinity,maxHeight:.infinity).accessibilityElement(children:.contain).accessibilityLabel(title)}
}
struct ShopPlatformServices:View {
    @EnvironmentObject var model:ShopModel
    let desktop:Bool
    var body:some View{VStack(alignment:.leading,spacing:16){ShopSectionTitle(title:"commerce_services");if desktop{HStack(alignment:.top,spacing:16){services}}else{VStack(spacing:12){services}}}}
    @ViewBuilder private var services:some View {
        Button{model.signIn()}label:{ShopServiceLabel(title:"wallet_sign_in",icon:"wallet.pass",caption:"shop_wallet_service_description")}.buttonStyle(.plain)
        NavigationLink{OrdersView()}label:{ShopServiceLabel(title:"pay_handoff",icon:"creditcard",caption:"shop_pay_service_description")}.buttonStyle(.plain)
        Button{model.prepareComparison()}label:{ShopServiceLabel(title:"ai_compare",icon:"sparkles",caption:"agent_draft_only")}.buttonStyle(.plain)
    }
}
struct ShopServiceLabel:View {
    let title:LocalizedStringKey
    let icon:String
    let caption:LocalizedStringKey
    var body:some View{HStack(alignment:.top,spacing:14){Image(systemName:icon).font(.title3).foregroundStyle(ShopTheme.primary).frame(width:36,height:36).background(ShopTheme.subtle).clipShape(RoundedRectangle(cornerRadius:8));VStack(alignment:.leading,spacing:6){Text(title).shopFont(15,.semibold);Text(caption).shopFont(12).foregroundStyle(ShopTheme.secondary).fixedSize(horizontal:false,vertical:true)};Spacer(minLength:0);Image(systemName:"chevron.right").font(.caption).foregroundStyle(ShopTheme.muted)}.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(ShopTheme.surface).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius)).overlay(RoundedRectangle(cornerRadius:ShopTheme.radius).stroke(ShopTheme.border,lineWidth:1))}
}
struct ShopMarketplaceFooter:View {var body:some View{VStack(alignment:.leading,spacing:14){ShopTheme.border.frame(height:1);HStack{Text("YNX Shop");Spacer();Text("shop_testnet_label");Text(OriginalOrderLink.chainID)}}.shopFont(12).foregroundStyle(ShopTheme.secondary).padding(.top,8)}}

struct ProductView:View {
    let initialProduct:Product
    init(product:Product){self.initialProduct=product}
    private var product:Product{model.cachedProduct(initialProduct.productID) ?? initialProduct}
    @EnvironmentObject var model:ShopModel
    var body:some View{GeometryReader{geometry in
        let desktop=geometry.size.width>=900
        ScrollView{VStack(alignment:.leading,spacing:24){
            ShopProductLoadStatus(productID:initialProduct.productID)

            HStack{Text("nav_catalog");Text("/");if let category=product.category{Text(category);Text("/")};Text(product.name).lineLimit(1)}.shopFont(12).foregroundStyle(ShopTheme.secondary)
            if desktop{HStack(alignment:.top,spacing:40){ProductGallery(product:product).frame(maxWidth:560);productInformation}}else{VStack(alignment:.leading,spacing:24){ProductGallery(product:product);productInformation}}
            ShopPanel{VStack(alignment:.leading,spacing:18){ShopSectionTitle(title:"shop_product_details");Text(product.description ?? String(localized:"unavailable")).shopFont(14).textSelection(.enabled);Divider();Text("trust_evidence").shopFont(17,.semibold);Text("trust_boundary").shopFont(13).foregroundStyle(ShopTheme.secondary)}}
        }.padding(desktop ? 40:16).frame(maxWidth:1440).frame(maxWidth:.infinity)}.background(ShopTheme.background).navigationTitle(product.name).shopInlineTitle()
    }.task(id:initialProduct.productID){await model.refreshProduct(initialProduct.productID)}.refreshable{await model.refreshProduct(initialProduct.productID)}}
    private var productInformation:some View{VStack(alignment:.leading,spacing:20){
        Text(product.category ?? String(localized:"nav_catalog")).shopFont(13,.semibold).foregroundStyle(ShopTheme.primary)
        Text(product.name).shopFont(28,.bold,relativeTo:.title).fixedSize(horizontal:false,vertical:true)
        Text(product.description ?? "").shopFont(14).foregroundStyle(ShopTheme.secondary)
        ShopCatalogProductPrice(product:product).shopFont(28,.bold).padding(.vertical,6)
        Divider()
        Text("shop_choose_variant").shopFont(15,.semibold)
        ForEach(product.variants){variant in ProductVariantRow(product:product,variant:variant)}
        ShopNotice(title:"payment_boundary")
        Button("ai_compare"){model.prepareComparison(ids:[product.productID])}.buttonStyle(ShopButtonStyle(kind:.secondary))
    }.frame(maxWidth:.infinity,alignment:.leading)}
}
struct ProductGallery:View {
    let product:Product
    @State private var selectedURL:String?
    private var media:[ProductMedia]{product.media.filter{$0.imageURL != nil}}
    private var current:ProductMedia?{media.first(where:{$0.url==selectedURL}) ?? media.first}
    var body:some View{VStack(spacing:12){
        ShopRemoteProductImage(url:current?.imageURL,alt:current?.altText ?? product.name,height:360).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius))
        if media.count>1{ScrollView(.horizontal){HStack(spacing:10){ForEach(Array(media.enumerated()),id:\.offset){_,item in Button{selectedURL=item.url}label:{
            ShopRemoteProductImage(url:item.imageURL,alt:item.altText ?? product.name,height:76,compact:true).frame(width:76).clipShape(RoundedRectangle(cornerRadius:6)).overlay(RoundedRectangle(cornerRadius:6).stroke(current?.url==item.url ? ShopTheme.primary:ShopTheme.border,lineWidth:1))
        }.buttonStyle(.plain).accessibilityLabel(item.altText ?? product.name).accessibilityAddTraits(current?.url==item.url ? .isSelected:[])}}}}
    }.onChange(of:media.map(\.url)){if let selectedURL,!media.contains(where:{$0.url==selectedURL}){self.selectedURL=nil}}}
}
struct ProductVariantRow:View {
    @EnvironmentObject var model:ShopModel
    let product:Product
    let variant:Variant
    var body:some View{ShopPanel(padding:16){HStack(alignment:.center,spacing:16){VStack(alignment:.leading,spacing:7){Text(variant.name).shopFont(15,.semibold);ShopCatalogVariantPrice(variant:variant).shopFont(17,.bold);Text("\(variant.available) \(String(localized:"inventory",locale:Locale(identifier:model.appLanguage)))").shopFont(12).foregroundStyle(variant.available>0 ? ShopTheme.secondary:ShopTheme.danger)};Spacer();Button("add_cart"){model.add(product,variant)}.buttonStyle(ShopButtonStyle()).disabled(!model.canAdd(product,variant))}}}
}

struct CartView:View {
    @EnvironmentObject var model:ShopModel
    var body:some View{GeometryReader{geometry in
        let desktop=geometry.size.width>=1000
        ScrollView{VStack(alignment:.leading,spacing:24){
            HStack{ShopSectionTitle(title:"nav_cart");Text("\(model.cart.count)").foregroundStyle(ShopTheme.secondary).monospacedDigit()}
            if model.cart.isEmpty{ContentUnavailableView("cart_empty",systemImage:"cart").frame(maxWidth:.infinity,minHeight:260)}
            else if desktop{HStack(alignment:.top,spacing:32){cartLines;CartSummary(showCheckout:true).frame(width:360)}}
            else{cartLines;CartSummary(showCheckout:true)}
            if model.checkoutRecoveryRequired{ShopNotice(title:"cart_checkout_recovery_required",symbol:"clock.arrow.circlepath",warning:true)}
            HStack(spacing:12){Button("cart_sync_button"){model.syncCart()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!model.signedIn || model.localDataLocked || model.mutationBusy || model.checkoutRecoveryRequired);Button("cart_recover_checkout"){model.recoverCheckout()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!model.signedIn || model.localDataLocked || model.mutationBusy)}
            Button("shop_refresh_cart_products"){Task{await model.refreshCartProducts()}}.buttonStyle(ShopButtonStyle(kind:.secondary))
            ShopMarketplaceFooter()
        }.padding(desktop ? 40:16).frame(maxWidth:1440).frame(maxWidth:.infinity)}.background(ShopTheme.background).navigationTitle("nav_cart").shopInlineTitle()
    }.task{await model.refreshCartProducts()}.refreshable{await model.refreshCartProducts()}}
    private var cartLines:some View{VStack(spacing:16){ForEach(model.cart){item in CartItemView(item:item,revision:model.privacyRevision)}}.frame(maxWidth:.infinity,alignment:.topLeading)}
}
struct CartItemView:View {
    let item:CartItem
    let revision:Int
    @EnvironmentObject var model:ShopModel
    private var product:Product?{model.cachedProduct(item.productID)}
    private var variant:Variant?{let matches=product?.variants.filter{$0.variantID==item.variantID} ?? [];return matches.count==1 ? matches[0]:nil}
    var body:some View{ShopPanel{VStack(alignment:.leading,spacing:14){
        HStack(alignment:.top,spacing:16){
            if let product{ProductImage(product:product,height:96).frame(width:96).clipShape(RoundedRectangle(cornerRadius:6))}
            VStack(alignment:.leading,spacing:10){
                if let product{NavigationLink{ProductView(product:product)}label:{Text(product.name).shopFont(15,.semibold)}}else{Text(verbatim:item.productID).shopFont(15,.semibold)}
                Text(verbatim:variant?.name ?? item.variantID).shopFont(12).foregroundStyle(ShopTheme.secondary)
                if let variant{ShopCatalogVariantPrice(variant:variant).shopFont(17,.bold)}
                HStack(spacing:16){
                    Button{model.setCartQuantity(item,quantity:item.quantity-1,revision:revision)}label:{Image(systemName:"minus.circle")}.disabled(item.quantity<=1).accessibilityLabel("shop_decrease_quantity")
                    Text(String(item.quantity)).monospacedDigit()
                    Button{model.setCartQuantity(item,quantity:item.quantity+1,revision:revision)}label:{Image(systemName:"plus.circle")}.disabled(model.maximumCartQuantity(item).map{item.quantity >= $0} ?? true).accessibilityLabel("shop_increase_quantity")
                }.buttonStyle(.plain)
                Button("cart_remove",role:.destructive){model.removeCart(item,revision:revision)}.buttonStyle(.plain).shopFont(12).foregroundStyle(ShopTheme.secondary)
            };Spacer(minLength:0)
        }
        ShopProductLoadStatus(productID:item.productID)
        if product != nil && variant==nil && model.productPhase(item.productID)=="loaded"{ShopNotice(title:"shop_cart_variant_missing",warning:true)}
        if let maximum=model.maximumCartQuantity(item),item.quantity>maximum{ShopNotice(title:"shop_cart_quantity_exceeds_stock",warning:true)}
    }}.disabled(model.localDataLocked || model.mutationBusy || model.checkoutRecoveryRequired)}
}
struct CartSummary:View {
    @EnvironmentObject var model:ShopModel
    let showCheckout:Bool
    private var itemCount:String{var total=0;for item in model.cart{guard item.quantity>=0 else{return String(localized:"unavailable")};let sum=total.addingReportingOverflow(item.quantity);guard !sum.overflow else{return String(localized:"unavailable")};total=sum.partialValue};return String(total)}
    var body:some View{ShopPanel{VStack(alignment:.leading,spacing:18){
        Text("order_review").shopFont(17,.semibold);Divider()
        HStack{Text("shop_cart_items");Spacer();Text(itemCount).monospacedDigit()}.shopFont(13)
        HStack(alignment:.firstTextBaseline){Text("shop_merchandise_subtotal");Spacer();if let native=model.cartNativeSubtotal{Text(ShopMoneyDisplay.atoms(String(native.atoms),locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable")).shopFont(22,.bold).multilineTextAlignment(.trailing)}else if let legacy=model.cartLegacySubtotal{Text(ShopMoneyDisplay.legacyYNXT(legacy,locale:Locale(identifier:model.appLanguage))).shopFont(22,.bold).multilineTextAlignment(.trailing)}else{Text("unavailable").foregroundStyle(ShopTheme.secondary)}}
        if let issue=model.cartCatalogIssue{ShopNotice(title:LocalizedStringKey(issue),warning:true)}
        Text("shop_subtotal_estimate_note").shopFont(12).foregroundStyle(ShopTheme.secondary)
        Text("shop_checkout_verifies_terms").shopFont(12).foregroundStyle(ShopTheme.secondary)
        Divider();Text("tax_unavailable").shopFont(12).foregroundStyle(ShopTheme.secondary);Text("logistics_unavailable").shopFont(12).foregroundStyle(ShopTheme.secondary)
        if showCheckout{NavigationLink{CheckoutView().id(model.privacyRevision)}label:{Text("order_review").frame(maxWidth:.infinity)}.buttonStyle(ShopButtonStyle()).disabled(model.localDataLocked || model.cart.isEmpty || model.mutationBusy || model.checkoutRecoveryRequired);if !model.signedIn{Button("wallet_sign_in"){model.signIn()}.buttonStyle(ShopButtonStyle(kind:.secondary))}}
        Text("payment_boundary").shopFont(12).foregroundStyle(ShopTheme.secondary)
    }}}
}
struct CheckoutView:View {
    @EnvironmentObject var model:ShopModel
    @State private var recipient=""
    @State private var address=""
    @State private var city=""
    @State private var country=""
    @State private var submitted=false
    @State private var createdOrder:Order?
    private var disabled:Bool{!model.signedIn || model.localDataLocked || model.cart.isEmpty || model.mutationBusy || model.checkoutRecoveryRequired || [recipient,address,city,country].contains{$0.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty}}
    var body:some View{GeometryReader{geometry in
        let desktop=geometry.size.width>=1000
        ScrollView{VStack(alignment:.leading,spacing:24){
            ShopSectionTitle(title:"order_review")
            if let createdOrder{ShopPanel{VStack(alignment:.leading,spacing:16){ShopStatusBadge(status:createdOrder.status);Text(createdOrder.orderID).font(.caption.monospaced());Text(buyerOrderTotal(createdOrder,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable")).shopFont(22,.bold);NavigationLink{OrderDetailView(orderID:createdOrder.orderID)}label:{Text("nav_orders")}.buttonStyle(ShopButtonStyle())}}}
            if desktop{HStack(alignment:.top,spacing:32){checkoutForm;CartSummary(showCheckout:false).frame(width:360)}}else{checkoutForm;CartSummary(showCheckout:false)}
            if model.checkoutRecoveryRequired{ShopNotice(title:"cart_checkout_recovery_required",symbol:"clock.arrow.circlepath",warning:true);Button("cart_recover_checkout"){model.recoverCheckout()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(model.mutationBusy)}
        }.padding(desktop ? 40:16).frame(maxWidth:1440).frame(maxWidth:.infinity)}.background(ShopTheme.background).navigationTitle("order_review").shopInlineTitle()
    }.onChange(of:model.checkoutResult?.orderID){if submitted,let order=model.checkoutResult{createdOrder=order;submitted=false}}}
    private var checkoutForm:some View{ShopPanel{VStack(alignment:.leading,spacing:18){
        Text("shop_shipping_address").shopFont(17,.semibold)
        addressField("recipient",text:$recipient);addressField("address",text:$address);addressField("city",text:$city);addressField("country",text:$country)
        ShopNotice(title:"payment_boundary")
        Button{submitted=true;model.checkout(recipient:recipient,address:address,city:city,country:country)}label:{Text("checkout").frame(maxWidth:.infinity)}.buttonStyle(ShopButtonStyle()).disabled(disabled)
    }}.disabled(model.mutationBusy || model.checkoutRecoveryRequired)}
    private func addressField(_ title:LocalizedStringKey,text:Binding<String>)->some View{VStack(alignment:.leading,spacing:8){Text(title).shopFont(13,.semibold);TextField(title,text:text).textFieldStyle(.roundedBorder).autocorrectionDisabled()}}
}

struct OrdersView:View {
    @EnvironmentObject var model:ShopModel
    @State private var filter="all"
    @State private var query=""
    private var displayed:[Order]{model.orders.filter{order in
        let matching=query.isEmpty || order.orderID.localizedCaseInsensitiveContains(query)
        switch filter{case "payment_pending":return matching && (order.status=="payment_pending" || BuyerPaymentDisplay.needsReview(order));case "fulfillment":return matching && ["paid","shipped"].contains(order.status);case "aftersale":return matching && (order.status.contains("return") || order.status.contains("refund") || order.status=="disputed");case "complete":return matching && ["delivered","reviewed"].contains(order.status);default:return matching}
    }}
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:24){
        HStack{ShopSectionTitle(title:"nav_orders");Spacer();TextField("shop_order_search",text:$query).textFieldStyle(.roundedBorder).frame(maxWidth:280)}
        if !model.signedIn{ContentUnavailableView("wallet_sign_in",systemImage:"lock",description:Text("privacy_boundary"));Button("wallet_sign_in"){model.signIn()}.buttonStyle(ShopButtonStyle())}
        else{
            Picker("nav_orders",selection:$filter){Text("shop_all_orders").tag("all");Text("payment_pending").tag("payment_pending");Text("shop_fulfillment").tag("fulfillment");Text("shop_completed").tag("complete");Text("shop_aftersale").tag("aftersale")}.pickerStyle(.segmented)
            if displayed.isEmpty{ContentUnavailableView("no_orders",systemImage:"shippingbox").frame(maxWidth:.infinity,minHeight:220)}
            ForEach(displayed){order in OrderSummaryRow(order:order)}
        }
        HStack{Button("retry"){Task{await model.loadOrders()}}.buttonStyle(ShopButtonStyle(kind:.secondary));Button("restore_pending"){model.retryPending()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!model.signedIn || model.mutationBusy)}
        ShopMarketplaceFooter()
    }.padding(24).frame(maxWidth:1440).frame(maxWidth:.infinity)}.background(ShopTheme.background).navigationTitle("nav_orders").shopInlineTitle().task{await model.loadOrders()}.refreshable{await model.loadOrders()}.sheet(item:$model.orderActionPresentation){presentation in BuyerOrderActionForm(presentation:presentation)}.onDisappear{model.orderActionPresentation=nil}}
}
struct OrderSummaryRow:View {
    @EnvironmentObject var model:ShopModel
    let order:Order
    var body:some View{ShopPanel{VStack(alignment:.leading,spacing:18){
        HStack(alignment:.top){VStack(alignment:.leading,spacing:8){Text(order.orderID).font(.caption.monospaced()).textSelection(.enabled);if let store=order.storeID{Text(store).shopFont(12).foregroundStyle(ShopTheme.secondary)}};Spacer();ShopStatusBadge(status:order.status)}
        Divider();HStack(alignment:.firstTextBaseline){Text(buyerOrderTotal(order,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable")).shopFont(22,.bold);Spacer();NavigationLink{OrderDetailView(orderID:order.orderID)}label:{Text("shop_order_details")}.buttonStyle(ShopButtonStyle(kind:.secondary))}
        if let refund=order.refundStatus,!refund.isEmpty{Text(LocalizedStringKey(refund)).shopFont(12).foregroundStyle(ShopTheme.secondary)}
        BuyerPaymentStatus(order:order)
        NativeOrderAmounts(order:order)
        OrderActions(order:order)
    }}}
}
struct OrderActions:View {
    @EnvironmentObject var model:ShopModel
    let order:Order
    private var recovery:String{model.orderRecoveryState(order)}
    var body:some View{VStack(alignment:.leading,spacing:12){
        let phase=recovery
        ViewThatFits(in:.horizontal){HStack(spacing:12){buttons(phase)};VStack(alignment:.leading,spacing:12){buttons(phase)}}
        if phase != "none"{BuyerOrderRecovery(order:order,phase:phase)}
        if order.status=="payment_pending" && !model.canCancelOrder(order){ShopNotice(title:"buyer_native_cancel_unavailable",symbol:"clock.arrow.circlepath",warning:true)}
    }}
    @ViewBuilder private func buttons(_ phase:String)->some View {
        if order.status=="payment_pending" {
            if (order.payIntentID ?? "").hasPrefix("npi_") {
                Button("buyer_review_payment"){model.reviewPayment(order)}.buttonStyle(ShopButtonStyle()).disabled(model.mutationBusy || phase != "none")
            }else{Button("pay_handoff"){model.pay(order)}.buttonStyle(ShopButtonStyle()).disabled(model.mutationBusy || phase != "none")}
        }
        if order.status=="payment_pending" || (order.payIntentID ?? "").hasPrefix("npi_"){Button("check_payment"){model.checkPayment(order)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!model.signedIn || model.mutationBusy)}
        let actions=BuyerOrderUIAction.available(order.status).filter{$0 != .cancelled || model.canCancelOrder(order)}
        if !actions.isEmpty{Menu("order_actions"){ForEach(actions){action in Button(action.title){model.beginOrderAction(order,action.rawValue,title:action.key)}}}.disabled(!model.signedIn || model.mutationBusy || phase != "none")}
    }
}
private enum BuyerOrderUIAction:String,CaseIterable,Identifiable {
    case cancelled,delivered,reviewed,returnRequested="return_requested",refundRequested="refund_requested",disputed
    var id:String{rawValue}
    var key:String{switch self{case .cancelled:return "cancel_order";case .delivered:return "confirm_delivery";case .reviewed:return "write_review";case .returnRequested:return "return_request";case .refundRequested:return "refund_request";case .disputed:return "dispute"}}
    var title:LocalizedStringKey{LocalizedStringKey(key)}
    static func available(_ status:String)->[Self]{allCases.filter{BuyerOrderActionInput.allowed(status,$0.rawValue)}}
}
struct OrderDetailView:View {
    @EnvironmentObject var model:ShopModel
    let orderID:String
    private var current:Order?{model.orders.first{$0.orderID==orderID}}
    var body:some View{GeometryReader{geometry in ScrollView{VStack(alignment:.leading,spacing:24){
        ShopSectionTitle(title:"shop_order_details")
        if let order=current {
            OrderSummaryRow(order:order)
            if geometry.size.width>=1000{HStack(alignment:.top,spacing:24){BuyerOriginalTerms(order:order).frame(maxWidth:.infinity);BuyerDeliveryDetails(order:order).frame(width:320)}}else{BuyerOriginalTerms(order:order);BuyerDeliveryDetails(order:order)}
            BuyerPaymentDetails(order:order)
            BuyerResolutionDetails(order:order)
            BuyerTimeline(order:order)
            ShopPanel{VStack(alignment:.leading,spacing:12){Text("trust_evidence").shopFont(17,.semibold);Text(verbatim:order.trustStatus ?? String(localized:"trust_unavailable")).shopFont(13).foregroundStyle(ShopTheme.secondary)}}
        }else{ContentUnavailableView("unavailable",systemImage:"shippingbox")}
        Button("retry"){Task{await model.loadOrders()}}.buttonStyle(ShopButtonStyle(kind:.secondary))
    }.padding(24).frame(maxWidth:1360).frame(maxWidth:.infinity)}.background(ShopTheme.background)}.navigationTitle("shop_order_details").shopInlineTitle().sheet(item:$model.orderActionPresentation){presentation in BuyerOrderActionForm(presentation:presentation)}.onDisappear{model.orderActionPresentation=nil}}
}
func buyerOrderTotal(_ order:Order,locale:Locale)->String? {
    if let quote=order.nativePrice{guard (try? quote.validate(order)) != nil else{return nil};return ShopMoneyDisplay.atoms(quote.Price.AmountAtoms,locale:locale)}
    if let payment=order.nativePayment,(try? payment.validate(order,requirePaid:false)) != nil{return ShopMoneyDisplay.atoms(payment.PrincipalAtoms,locale:locale)}
    if (order.payIntentID ?? "").hasPrefix("npi_"){return nil}
    return ShopMoneyDisplay.order(order,locale:locale)
}
private enum BuyerPaymentDisplay {
    static func state(_ order:Order)->String {
        guard (order.payIntentID ?? "").hasPrefix("npi_") else{return order.settlement?.Status ?? (order.status=="payment_pending" ? "payment_pending":"unavailable")}
        guard let payment=order.nativePayment,(try? payment.validate(order,requirePaid:false)) != nil else{return "seller_native_receipt_unavailable"}
        if payment.ReconciliationRequired{return "seller_native_reconcile_required"}
        if payment.PaidAtoms=="0"{return "seller_native_unpaid"}
        if payment.RefundedAtoms=="0"{return "seller_native_paid"}
        return payment.RefundedAtoms==payment.PaidAtoms ? "seller_native_refunded":"seller_native_partial_refund"
    }
    static func needsReview(_ order:Order)->Bool {
        guard (order.payIntentID ?? "").hasPrefix("npi_") else{return order.status=="payment_pending"}
        return !["seller_native_paid","seller_native_partial_refund","seller_native_refunded"].contains(state(order))
    }
}
private struct BuyerPaymentStatus:View {
    let order:Order
    var body:some View{VStack(alignment:.leading,spacing:8){Text("buyer_payment_status").shopFont(12).foregroundStyle(ShopTheme.secondary);Text(LocalizedStringKey(BuyerPaymentDisplay.state(order))).shopFont(13,.semibold).foregroundStyle(BuyerPaymentDisplay.needsReview(order) ? ShopTheme.warning:ShopTheme.secondary)}}
}
private struct BuyerDetailValue:View {
    let title:LocalizedStringKey
    let value:String
    var body:some View{VStack(alignment:.leading,spacing:6){Text(title).shopFont(12).foregroundStyle(ShopTheme.secondary);Text(verbatim:value.isEmpty ? "—":value).shopFont(13).textSelection(.enabled)}}
}
private struct BuyerOrderRecovery:View {
    @EnvironmentObject var model:ShopModel
    let order:Order
    let phase:String
    private var title:LocalizedStringKey{switch phase{case "prepared":return "buyer_order_prepared";case "unknown":return "buyer_order_unknown";default:return "buyer_order_recovery_unavailable"}}
    var body:some View{VStack(alignment:.leading,spacing:12){
        ShopNotice(title:title,symbol:"clock.arrow.circlepath",warning:true)
        if phase=="unknown"{Button("buyer_read_original_request"){model.recoverOrder(order)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!model.signedIn || model.mutationBusy)}
        if phase=="prepared" {
            if model.canRetryPreparedOrder(order){Button("buyer_submit_original_prepared"){model.retryPreparedOrder(order)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!model.signedIn || model.mutationBusy)}
            else{Button("buyer_continue_original_invoice"){model.pay(order)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!model.signedIn || model.mutationBusy || order.status != "payment_pending")}
        }
    }}
}
private struct BuyerOriginalTerms:View {
    @EnvironmentObject var model:ShopModel
    let order:Order
    private var locale:Locale{Locale(identifier:model.appLanguage)}
    private var nativePrice:NativeCheckoutPrice?{guard let price=order.nativePrice,(try? price.validate(order)) != nil else{return nil};return price}
    var body:some View{ShopPanel{VStack(alignment:.leading,spacing:18){
        Text("seller_original_terms").shopFont(17,.semibold)
        if let lines=order.nativeLines,!lines.isEmpty{ForEach(Array(lines.enumerated()),id:\.offset){_,line in VStack(alignment:.leading,spacing:8){
            Text(verbatim:line.Title ?? line.ProductID).shopFont(15,.semibold)
            Text(verbatim:line.VariantName ?? line.VariantID).shopFont(13).foregroundStyle(ShopTheme.secondary)
            BuyerDetailValue(title:"buyer_quantity",value:String(line.Quantity))
            if nativePrice != nil,let price=line.NativePrice{BuyerDetailValue(title:"seller_price",value:ShopMoneyDisplay.atoms(price.AmountAtoms,locale:locale) ?? String(localized:"unavailable"))}
            else if !(order.payIntentID ?? "").hasPrefix("npi_"),order.nativePrice==nil,let price=line.UnitPriceYNXT{BuyerDetailValue(title:"seller_price",value:order.currency==nil || order.currency=="YNXT" ? ShopMoneyDisplay.legacyYNXT(price,locale:locale):String(localized:"unavailable"))}
            Divider()
        }}}else{Text("buyer_original_lines_unavailable").shopFont(13).foregroundStyle(ShopTheme.secondary)}
        if let price=nativePrice{BuyerDetailValue(title:"buyer_order_total",value:ShopMoneyDisplay.atoms(price.Price.AmountAtoms,locale:locale) ?? String(localized:"unavailable"));BuyerDetailValue(title:"seller_shipping_amount",value:ShopMoneyDisplay.atoms(price.Charges.ShippingAtoms,locale:locale) ?? String(localized:"unavailable"));BuyerDetailValue(title:"seller_tax_amount",value:ShopMoneyDisplay.atoms(price.Charges.TaxAtoms,locale:locale) ?? String(localized:"unavailable"))}
        Text("buyer_terms_snapshot_note").shopFont(12).foregroundStyle(ShopTheme.secondary)
    }}}
}
private struct BuyerDeliveryDetails:View {
    let order:Order
    var body:some View{ShopPanel{VStack(alignment:.leading,spacing:16){
        Text("shop_shipping_address").shopFont(17,.semibold)
        if let address=order.address{Text(verbatim:address.Recipient).shopFont(14,.semibold);Text(verbatim:[address.Line1,address.City,address.Region,address.PostalCode,address.Country].filter{!$0.isEmpty}.joined(separator:"\n")).shopFont(13).textSelection(.enabled)}else{Text("buyer_delivery_unavailable").shopFont(13).foregroundStyle(ShopTheme.secondary)}
        Divider();Text("seller_fulfillment").shopFont(17,.semibold)
        if let shipment=order.shipment{BuyerDetailValue(title:"seller_carrier",value:shipment.Carrier);BuyerDetailValue(title:"seller_tracking",value:shipment.TrackingNumber);Text(LocalizedStringKey(shipment.Status)).shopFont(13);Text(verbatim:shipment.UpdatedAt).shopFont(12).foregroundStyle(ShopTheme.secondary)}else{Text("buyer_shipment_unavailable").shopFont(13).foregroundStyle(ShopTheme.secondary)}
    }}}
}
private struct BuyerPaymentDetails:View {
    @EnvironmentObject var model:ShopModel
    let order:Order
    var body:some View{ShopPanel{VStack(alignment:.leading,spacing:16){
        Text("seller_payment_evidence").shopFont(17,.semibold);BuyerPaymentStatus(order:order)
        if let invoice=order.invoiceID{BuyerDetailValue(title:"shop_invoice_reference",value:invoice)}
        if let operation=order.payIntentID{BuyerDetailValue(title:"shop_original_operation",value:operation)}
        NativeOrderAmounts(order:order)
        if let payment=order.nativePayment,(try? payment.validate(order,requirePaid:false)) != nil {
            BuyerDetailValue(title:"seller_native_session",value:payment.SessionID)
            BuyerDetailValue(title:"seller_native_terms_hash",value:payment.TermsHash)
            ForEach(Array(payment.Receipts.enumerated()),id:\.offset){_,receipt in DisclosureGroup{VStack(alignment:.leading,spacing:12){BuyerDetailValue(title:"seller_transaction_hash",value:receipt.nativeHash);BuyerDetailValue(title:"seller_native_settlement_hash",value:receipt.settlementNativeHash);if let refund=receipt.refundId{BuyerDetailValue(title:"seller_refund_record",value:refund)};BuyerDetailValue(title:"seller_native_claim_status",value:receipt.status)}}label:{Text(verbatim:receipt.kind).shopFont(13)}}
            if !(payment.PendingOriginals ?? []).isEmpty{ShopNotice(title:"shop_explicit_reconcile_note",symbol:"clock.arrow.circlepath",warning:true)}
            ForEach(Array((payment.PendingOriginals ?? []).enumerated()),id:\.offset){_,original in VStack(alignment:.leading,spacing:10){
                BuyerDetailValue(title:"shop_original_operation",value:original)
                Button("shop_reconcile_original_transaction"){model.reconcilePayment(order,nativeHash:original)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!model.canReconcilePayment(order,nativeHash:original) || model.mutationBusy)
            }}
        }
        Text("payment_boundary").shopFont(12).foregroundStyle(ShopTheme.secondary)
    }}}
}
private struct BuyerResolutionDetails:View {
    let order:Order
    var body:some View{ShopPanel{VStack(alignment:.leading,spacing:16){
        Text("shop_aftersale").shopFont(17,.semibold)
        if let resolution=order.resolution{Text(LocalizedStringKey(resolution.Status)).shopFont(13,.semibold);BuyerDetailValue(title:"order_reason",value:resolution.Reason);BuyerDetailValue(title:"order_explanation",value:resolution.Explanation)}else{Text("buyer_resolution_unavailable").shopFont(13).foregroundStyle(ShopTheme.secondary)}
        if let status=order.refundStatus,!status.isEmpty{Text(LocalizedStringKey(status)).shopFont(13)}
        ShopNotice(title:"seller_refund_boundary")
    }}}
}
private struct BuyerTimeline:View {
    let order:Order
    var body:some View{ShopPanel{VStack(alignment:.leading,spacing:16){
        Text("seller_order_events").shopFont(17,.semibold)
        if let timeline=order.timeline,!timeline.isEmpty{ForEach(timeline){event in VStack(alignment:.leading,spacing:8){Text(LocalizedStringKey(event.Status)).shopFont(13,.semibold);Text(verbatim:event.At).shopFont(12).foregroundStyle(ShopTheme.secondary);if !event.Detail.isEmpty{Text(verbatim:event.Detail).shopFont(13)};Text(verbatim:event.ID).font(.caption.monospaced()).foregroundStyle(ShopTheme.secondary);Divider()}}}else{Text("buyer_timeline_unavailable").shopFont(13).foregroundStyle(ShopTheme.secondary)}
    }}}
}
struct BuyerOrderActionForm:View {
    let presentation:ShopModel.OrderActionPresentation
    @EnvironmentObject var model:ShopModel
    @State private var rating=0
    @State private var reason=""
    @State private var detail=""
    @State private var invalid=false
    @State private var confirmed=false
    private var review:Bool{presentation.action=="reviewed"}
    private var resolution:Bool{["return_requested","refund_requested","disputed"].contains(presentation.action)}
    private var submitDisabled:Bool{model.mutationBusy || !confirmed || !inputValid || model.orderRecoveryState(presentation.order) != "none"}
    private var inputValid:Bool{(try? BuyerOrderActionInput.build(status:presentation.order.status,action:presentation.action,rating:review ? rating:0,reason:resolution ? reason:"",detail:review || resolution ? detail:"")) != nil}
    var body:some View{NavigationStack{Form{
        Section{Text(presentation.order.orderID).font(.caption.monospaced());Text(buyerOrderTotal(presentation.order,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable"))}
        if review{Section{Picker("order_rating",selection:$rating){Text("order_rating_select").tag(0);ForEach(1...5,id:\.self){Text("\($0) ★").tag($0)}};TextField("order_review_text",text:$detail,axis:.vertical).lineLimit(3...8)}}
        else if resolution{Section{TextField("order_reason",text:$reason);TextField("order_explanation",text:$detail,axis:.vertical).lineLimit(3...8)}}
        else{Text(LocalizedStringKey(presentation.title))}
        if presentation.action=="cancelled"{ShopNotice(title:"buyer_cancel_order_note",warning:true)}
        if resolution{ShopNotice(title:"seller_refund_boundary")}
        Toggle("buyer_confirm_order_action",isOn:$confirmed)
        if invalid{Text(LocalizedStringKey(model.state.isEmpty ? "order_input_required":model.state)).foregroundStyle(ShopTheme.danger)}
        Button("order_submit"){invalid = !model.submitOrderAction(presentation,rating:review ? rating:0,reason:resolution ? reason:"",detail:review || resolution ? detail:"")}.disabled(submitDisabled)
        Button("cancel"){model.orderActionPresentation=nil}
    }.onChange(of:[reason,detail,String(rating)]){confirmed=false}.navigationTitle(LocalizedStringKey(presentation.title)).shopInlineTitle()}.frame(minWidth:300,minHeight:360)}
}
struct OriginalOrderLinkSheet:View {
    @EnvironmentObject var model:ShopModel
    let link:OriginalOrderLink
    var body:some View{NavigationStack{ScrollView{VStack(alignment:.leading,spacing:20){
        ShopSectionTitle(title:"nav_orders");Text(link.orderID).font(.caption.monospaced()).textSelection(.enabled);Text(link.account).font(.caption.monospaced());Text(OriginalOrderLink.chainID).shopFont(12).foregroundStyle(ShopTheme.secondary)
        if !model.signedIn{Button("wallet_sign_in"){model.signIn()}.buttonStyle(ShopButtonStyle())}
        else if model.originalOrderLoading{ProgressView()}
        else if let order=model.linkedOriginalOrder{ShopStatusBadge(status:order.status);Text(buyerOrderTotal(order,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable")).shopFont(22,.bold);if let refund=order.refundStatus{Text(LocalizedStringKey(refund)).shopFont(13)};NativeOrderAmounts(order:order)}
        else{Text("unavailable")}
        ShopNotice(title:"payment_boundary")
        if model.linkedOriginalOrder != nil{Button("check_payment"){Task{await model.checkLinkedOriginalPayment()}}.buttonStyle(ShopButtonStyle()).disabled(model.originalOrderLoading)}
        if model.signedIn{Button("retry"){Task{await model.refreshOriginalOrderLink()}}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(model.originalOrderLoading)}
        Button("close"){model.closeOriginalOrderLink()}.buttonStyle(ShopButtonStyle(kind:.secondary))
    }.padding(24)}}.frame(minWidth:320,idealWidth:480,minHeight:400)}
}
struct OriginalInvoiceSheet:View {
    @EnvironmentObject var model:ShopModel
    let presentation:ShopModel.InvoicePresentation
    var body:some View{NavigationStack{ScrollView{VStack(alignment:.leading,spacing:20){
        ShopSectionTitle(title:"order_review");Text(presentation.review.original.orderID).font(.caption.monospaced()).textSelection(.enabled);Text(buyerOrderTotal(presentation.review.original,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable")).shopFont(28,.bold);Text(presentation.review.invoiceID ?? "").font(.caption.monospaced());ShopNotice(title:"payment_boundary")
        Button("pay_handoff"){model.openReviewedInvoice()}.buttonStyle(ShopButtonStyle());Button("close"){model.cancelInvoicePresentation()}.buttonStyle(ShopButtonStyle(kind:.secondary))
    }.padding(24)}}.frame(minWidth:320,idealWidth:480,minHeight:380)}
}

struct AccountView:View {
    @EnvironmentObject var model:ShopModel
    @EnvironmentObject var seller:ShopSellerModel
    @State private var deletionConfirmation=""
    @AppStorage("shop-text-size") private var textSize="standard"
    @AppStorage("shop-color-scheme") private var themeChoice="system"
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:24){
        ShopSectionTitle(title:"nav_account")
        ShopPanel{VStack(alignment:.leading,spacing:16){Label("wallet_security",systemImage:"lock.shield").shopFont(17,.semibold);if model.signedIn{Text("wallet_active");Button("sign_out",role:.destructive){model.signOut()}.buttonStyle(ShopButtonStyle(kind:.secondary))}else{Button("wallet_sign_in"){model.signIn()}.buttonStyle(ShopButtonStyle())};Text("privacy_boundary").shopFont(13).foregroundStyle(ShopTheme.secondary)}}
        if model.signedIn{profile;privacy}
        ShopPanel{VStack(alignment:.leading,spacing:18){Text("settings_language").shopFont(17,.semibold);Picker("settings_language",selection:Binding(get:{model.appLanguage},set:model.setLanguage)){ForEach(supportedLanguages,id:\.self){Text(Locale.current.localizedString(forIdentifier:$0) ?? $0).tag($0)}};Picker("ai_language",selection:Binding(get:{model.aiLanguage},set:model.setAILanguage)){ForEach(supportedLanguages,id:\.self){Text($0).tag($0)}};Picker("text_size",selection:$textSize){Text("text_compact").tag("compact");Text("text_standard").tag("standard");Text("text_larger").tag("larger")};Picker("shop_theme",selection:$themeChoice){Text("shop_theme_system").tag("system");Text("shop_theme_light").tag("light");Text("shop_theme_dark").tag("dark")};Text("ai_privacy").shopFont(12).foregroundStyle(ShopTheme.secondary)}}
        ShopPanel{VStack(alignment:.leading,spacing:12){Text("service_boundaries").shopFont(17,.semibold);Text("tax_unavailable");Text("logistics_unavailable");Divider();Button("seller_console"){seller.workspaceVisible=true};Link("merchant_invoices",destination:URL(string:"https://pay.ynxweb4.com/merchant/")!)}.shopFont(13)}
    }.padding(24).frame(maxWidth:1000).frame(maxWidth:.infinity)}.background(ShopTheme.background).navigationTitle("nav_account").shopInlineTitle()}
    private var profile:some View{ShopPanel{VStack(alignment:.leading,spacing:14){Text("save_profile").shopFont(17,.semibold);TextField("recipient",text:$model.profileRecipient);TextField("address",text:$model.profileAddress);TextField("city",text:$model.profileCity);TextField("country",text:$model.profileCountry);HStack{Button("retry"){model.loadProfile()}.buttonStyle(ShopButtonStyle(kind:.secondary));Button("save_profile"){model.saveProfile()}.buttonStyle(ShopButtonStyle()).disabled(model.mutationBusy)}}.textFieldStyle(.roundedBorder)}}
    private var privacy:some View{ShopPanel{VStack(alignment:.leading,spacing:16){Text("privacy_data_title").shopFont(17,.semibold);Text("privacy_data_description").shopFont(13).foregroundStyle(ShopTheme.secondary);Button("privacy_export_button"){model.exportPrivacyData()}.buttonStyle(ShopButtonStyle(kind:.secondary));if let url=model.privacyExportURL{ShareLink(item:url){Label("privacy_share_label",systemImage:"square.and.arrow.up")}};Divider();Text("privacy_delete_warning").shopFont(13);TextField("DELETE_MY_SHOP_DATA",text:$deletionConfirmation).shopCapitalization(true).autocorrectionDisabled().textFieldStyle(.roundedBorder);Button("privacy_delete_button",role:.destructive){model.deletePrivacyData(deletionConfirmation)}.buttonStyle(ShopButtonStyle(kind:.destructive)).disabled(model.mutationBusy)}}}
}

struct AgentWorkspaceView:View {
    @EnvironmentObject var model:ShopModel
    @State private var section="compare"
    @State private var disclosed=false
    var body:some View{NavigationStack{VStack(spacing:0){
        HStack(spacing:12){Image(systemName:"sparkles").font(.title3).foregroundStyle(ShopTheme.primary).frame(width:32,height:32).background(ShopTheme.subtle).clipShape(RoundedRectangle(cornerRadius:8));VStack(alignment:.leading,spacing:4){Text("YNX Agent").shopFont(17,.semibold);Text("agent_draft_only").shopFont(12).foregroundStyle(ShopTheme.secondary)};Spacer();if model.agentBusy{ProgressView().controlSize(.small)}}.padding(16)
        ShopTheme.border.frame(height:1)
        Picker("YNX Agent",selection:$section){Text("ai_compare").tag("compare");Text("agent_draft").tag("draft");Text("agent_tasks").tag("tasks");Text("agent_authorization").tag("authority")}.pickerStyle(.segmented).padding(16)
        ScrollView{VStack(alignment:.leading,spacing:16){
            if section=="compare"{comparison}
            else if section=="draft"{draft}
            else if section=="tasks"{tasks}
            else{authority}
        }.padding(16)}.background(ShopTheme.background)
        ShopTheme.border.frame(height:1)
        VStack(alignment:.leading,spacing:8){Text("agent_keys_and_payment_boundary").shopFont(12).foregroundStyle(ShopTheme.secondary);if ["running","creation_unknown","run_unknown","decision_unknown","cancel_unknown"].contains(model.agentPhase){Text("agent_close_keeps_original").shopFont(12).foregroundStyle(ShopTheme.warning)}}.padding(16)
    }.background(ShopTheme.surface).toolbar{ToolbarItem(placement:.cancellationAction){Button("close"){model.agentWorkspaceVisible=false}}}}.frame(minWidth:320,idealWidth:420,minHeight:600,idealHeight:780)}
    private var comparison:some View{VStack(alignment:.leading,spacing:16){
        Text("agent_public_comparison").shopFont(17,.semibold)
        if let proposal=model.agentPresentation {
            if !proposal.query.isEmpty{Text(proposal.query).shopFont(14).padding(12).frame(maxWidth:.infinity,alignment:.leading).background(ShopTheme.subtle).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius))}
            if proposal.products.isEmpty && model.agentPhase != "prepared"{ContentUnavailableView("empty_catalog",systemImage:"shippingbox",description:Text("no_fake_records"))}
            ForEach(proposal.products){product in AgentProductSummary(product:product)}
            ShopPanel(padding:14){VStack(alignment:.leading,spacing:12){Text("agent_disclosure_title").shopFont(15,.semibold);Text(proposal.contextSummary).shopFont(12).foregroundStyle(ShopTheme.secondary).textSelection(.enabled);Text("agent_processing_unit_not_money").shopFont(12).foregroundStyle(ShopTheme.secondary);Text("\(proposal.processingUnits)").shopFont(12).monospacedDigit()}}
        }
        if model.agentJob==nil {
            Toggle("agent_disclosure_consent",isOn:$disclosed).shopFont(13)
            if !model.signedIn{Button("wallet_sign_in"){model.signIn()}.buttonStyle(ShopButtonStyle())}
            Button("agent_confirm_disclosure"){model.authorizeComparison()}.buttonStyle(ShopButtonStyle()).disabled(!disclosed || !model.signedIn || model.agentBusy || ["creating","creation_unknown","run_unknown"].contains(model.agentPhase) || (model.agentPresentation==nil || (model.agentPhase != "prepared" && (model.agentPresentation?.products.isEmpty ?? true))))
        }
        if model.agentPhase=="prepared"{Button("cancel"){model.discardPreparedComparison()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(model.agentBusy)}
        if model.agentJob==nil && ["cancelled","creation_unknown","run_unknown","decision_unknown","cancel_unknown"].contains(model.agentPhase){AgentPhaseLabel(phase:model.agentPhase)}
        if let job=model.agentJob{Text(job.contextSummary).shopFont(12).foregroundStyle(ShopTheme.secondary).textSelection(.enabled);AgentPhaseLabel(phase:model.agentPhase);Text(job.jobID).font(.caption.monospaced()).textSelection(.enabled);if job.status=="permission_granted"{Button("agent_generate_draft"){model.runComparison()}.buttonStyle(ShopButtonStyle()).disabled(model.agentBusy || model.agentPhase != "permission_granted")};if !job.failure.isEmpty{Text(job.failure).shopFont(12).foregroundStyle(ShopTheme.danger)};if !job.result.isEmpty{Text("agent_generated_draft").shopFont(15,.semibold);Text(job.result).shopFont(13).textSelection(.enabled)}}
        operationControls
    }}
    private var draft:some View{VStack(alignment:.leading,spacing:16){
        Text("agent_generated_draft").shopFont(17,.semibold);ShopNotice(title:"agent_draft_no_order")
        if let job=model.agentJob,!job.result.isEmpty {
            ShopPanel{VStack(alignment:.leading,spacing:12){Text(job.contextSummary).shopFont(12).foregroundStyle(ShopTheme.secondary).textSelection(.enabled);Divider();Text(job.result).shopFont(14).textSelection(.enabled)}}
            if job.status=="review_required"{HStack{Button("agent_accept_draft"){model.decideComparison(apply:true)}.buttonStyle(ShopButtonStyle());Button("agent_reject_draft"){model.decideComparison(apply:false)}.buttonStyle(ShopButtonStyle(kind:.secondary))}.disabled(model.agentBusy || model.agentPhase != "review_required")}
            AgentPhaseLabel(phase:model.agentPhase)
        }else{Text("agent_no_generated_draft").foregroundStyle(ShopTheme.secondary)}
        if model.agentJob==nil,let proposal=model.agentPresentation{ForEach(proposal.products){product in
            ShopPanel(padding:14){VStack(alignment:.leading,spacing:12){AgentProductSummary(product:product);Menu("add_cart"){ForEach(product.variants){variant in Button(variant.name){model.add(product,variant)}.disabled(variant.available<1)}}.disabled(model.localDataLocked || model.mutationBusy || model.checkoutRecoveryRequired)}}
        }}
        if model.localDataLocked{Button("unlock_local_data"){model.unlockLocalData()}.buttonStyle(ShopButtonStyle(kind:.secondary))}
        Text("agent_cart_selection_explicit").shopFont(12).foregroundStyle(ShopTheme.secondary)
    }}
    private var tasks:some View{VStack(alignment:.leading,spacing:16){
        Text("agent_tasks").shopFont(17,.semibold);Text("agent_tasks_are_draft_jobs").shopFont(12).foregroundStyle(ShopTheme.secondary)
        if model.agentJobs.isEmpty{ContentUnavailableView("agent_no_tasks",systemImage:"list.bullet.rectangle")}
        ForEach(model.agentJobs,id:\.jobID){job in ShopPanel(padding:14){VStack(alignment:.leading,spacing:10){Text(job.jobID).font(.caption.monospaced()).textSelection(.enabled);Text("agent_public_comparison").shopFont(15,.semibold);AgentPhaseLabel(phase:job.status);if !job.failure.isEmpty{Text(job.failure).shopFont(12).foregroundStyle(ShopTheme.danger)};if !job.result.isEmpty{Text(job.result).shopFont(13).lineLimit(5).textSelection(.enabled)};Button("agent_view_original_job"){model.selectComparisonJob(job);section="draft"}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(model.agentBusy)}}}
        operationControls
    }}
    private var authority:some View{VStack(alignment:.leading,spacing:16){
        Text("agent_authorization").shopFont(17,.semibold);ShopNotice(title:"agent_financial_authority_unavailable",symbol:"lock.shield",warning:true)
        ShopPanel{VStack(alignment:.leading,spacing:14){LabeledContent("agent_context_class"){Text(verbatim:"public_catalog").font(.caption.monospaced())};LabeledContent("agent_allowed_action"){Text(verbatim:"draft_comparison").font(.caption.monospaced())};Divider();LabeledContent("agent_spend_budget"){Text("unavailable")};LabeledContent("agent_grant_expiry"){Text("unavailable")};Text("agent_disclosure_is_not_grant").shopFont(12).foregroundStyle(ShopTheme.secondary)}}
        if let job=model.agentJob{ShopPanel{VStack(alignment:.leading,spacing:12){Text("agent_actual_job_actions").shopFont(15,.semibold);ForEach(job.allowedActions,id:\.self){action in Text(action).font(.caption.monospaced())}}}}
        Text("agent_no_financial_effects").shopFont(13).foregroundStyle(ShopTheme.secondary)
    }}
    private var operationControls:some View{HStack(spacing:12){Button("agent_read_original"){model.refreshComparison()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(model.agentBusy || !model.signedIn);if let job=model.agentJob,["permission_granted","running"].contains(job.status){Button("agent_cancel_generation",role:.destructive){model.cancelComparison()}.buttonStyle(ShopButtonStyle(kind:.destructive)).disabled(!["permission_granted","running","run_unknown"].contains(model.agentPhase))}}}
}
struct AgentProductSummary:View {
    @EnvironmentObject var model:ShopModel
    let product:Product
    var body:some View{HStack(alignment:.top,spacing:12){ProductImage(product:product,height:64).frame(width:64).clipShape(RoundedRectangle(cornerRadius:6));VStack(alignment:.leading,spacing:6){Text(product.name).shopFont(14,.semibold);ShopCatalogProductPrice(product:product).shopFont(15,.bold);Text(String(format:String(localized:"catalog_variant_count",locale:Locale(identifier:model.appLanguage)),locale:Locale(identifier:model.appLanguage),Int64(product.variants.count))).shopFont(12).foregroundStyle(ShopTheme.secondary)}}.frame(maxWidth:.infinity,alignment:.leading)}
}
struct AgentPhaseLabel:View {
    let phase:String
    private var title:LocalizedStringKey{switch phase{case "permission_granted":return "agent_disclosure_confirmed";case "running":return "agent_generation_running";case "review_required":return "agent_draft_review";case "applied_draft":return "agent_draft_applied";case "rejected":return "agent_draft_rejected";case "cancelled":return "agent_generation_cancelled";case "creation_unknown","run_unknown","decision_unknown","cancel_unknown":return "agent_original_unknown";case "failed","unavailable":return "unavailable";case "creating":return "loading";case "history_read_only":return "agent_history_read_only";case "decision_conflict":return "agent_decision_conflict";default:return "agent_draft_only"}}
    var body:some View{Label(title,systemImage:["creation_unknown","run_unknown","decision_unknown","cancel_unknown"].contains(phase) ? "clock.arrow.circlepath":"text.document").shopFont(12,.semibold).foregroundStyle(["creation_unknown","run_unknown","decision_unknown","cancel_unknown","failed","decision_conflict"].contains(phase) ? ShopTheme.warning:ShopTheme.primary).padding(.horizontal,10).padding(.vertical,7).background(ShopTheme.subtle).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))}
}

extension View {
    @ViewBuilder func shopInlineTitle()->some View {
#if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
#else
        self
#endif
    }
    @ViewBuilder func shopCapitalization(_ uppercase:Bool)->some View {
#if os(iOS)
        self.textInputAutocapitalization(uppercase ? .characters:.never)
#else
        self
#endif
    }
}
// Exact accepted atom strings, independent of order, shipment or return labels.
struct NativeOrderAmounts:View {
    let order:Order
    var body:some View {
        if let quote=order.nativePrice,(try? quote.validate(order)) != nil {
            VStack(alignment:.leading,spacing:8){Text("seller_original_terms").shopFont(13,.semibold);HStack{Text("seller_principal");Spacer();Text(quote.Price.AmountAtoms+" "+String(localized:"native_atoms_unit")).monospacedDigit()};Text("native_quote_not_payment").foregroundStyle(ShopTheme.secondary)}.shopFont(12).padding(12).background(ShopTheme.tertiary)
        }
        if let payment=order.nativePayment {
            if payment.ReconciliationRequired{ShopNotice(title:"native_reconcile_required",symbol:"clock.arrow.circlepath",warning:true)}
            if validated(payment){VStack(alignment:.leading,spacing:8){HStack{Text("native_paid_atoms");Spacer();Text(payment.PaidAtoms).monospacedDigit()};HStack{Text("native_refunded_atoms");Spacer();Text(payment.RefundedAtoms).monospacedDigit()};HStack{Text("native_net_atoms");Spacer();Text(payment.NetPaidAtoms).monospacedDigit()};if !payment.CompleteKnownOriginals || !(payment.PendingOriginals ?? []).isEmpty{Text("native_history_pending").foregroundStyle(ShopTheme.warning)}}.shopFont(12).padding(12).background(ShopTheme.tertiary).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))}
            else{ShopNotice(title:"seller_native_receipt_unavailable",symbol:"lock",warning:true)}
        }
    }
    private func validated(_ payment:NativePaymentProjection)->Bool{do{try payment.validate(order,requirePaid:false);return true}catch{return false}}
}



private enum ShopNativeCatalogOrdering {
    static func prices(_ products:[Product])->[String:UInt64]? {
        guard !products.isEmpty else{return nil}
        var domain:CatalogNativeDomain?,result:[String:UInt64]=[:]
        for product in products {
            guard result[product.productID]==nil,let range=CatalogPricing.nativeRange(product) else{return nil}
            if let domain,domain != range.domain{return nil};domain=range.domain
            result[product.productID]=range.minimum
        }
        return result
    }
}
private struct ShopProductLoadStatus:View {
    @EnvironmentObject var model:ShopModel
    let productID:String
    var body:some View{let phase=model.productPhase(productID)
        VStack(alignment:.leading,spacing:10){
            if phase=="loading"{ProgressView("shop_product_loading").shopFont(12)}
            if phase=="failed" || phase=="offline" || phase=="not_found" || (phase=="idle" && model.cachedProduct(productID)==nil){
                ShopNotice(title:phase=="not_found" ? "shop_product_not_found":phase=="offline" ? "shop_product_offline":model.cachedProduct(productID)==nil ? "shop_product_load_failed":"shop_product_stale",symbol:"clock.arrow.circlepath",warning:true)
                Button("shop_refresh_product"){Task{await model.refreshProduct(productID)}}.buttonStyle(ShopButtonStyle(kind:.secondary))
            }
        }
    }
}

private struct ShopCatalogProductPrice:View {
    @Environment(\.locale) private var locale
    let product:Product
    private var text:String {
        if let range=CatalogPricing.nativeRange(product) {
            let low=ShopMoneyDisplay.atoms(String(range.minimum),locale:locale) ?? String(localized:"unavailable")
            if range.minimum==range.maximum{return low}
            return low+" – "+(ShopMoneyDisplay.atoms(String(range.maximum),locale:locale) ?? String(localized:"unavailable"))
        }
        if CatalogPricing.isLegacy(product),let minimum=product.variants.map(\.priceYNXT).min(){return ShopMoneyDisplay.legacyYNXT(minimum,locale:locale)}
        return String(localized:"unavailable",locale:locale)
    }
    var body:some View{Text(verbatim:text).fixedSize(horizontal:false,vertical:true)}
}

private struct ShopCatalogVariantPrice:View {
    @Environment(\.locale) private var locale
    let variant:Variant
    private var text:String {
        if let unit=CatalogPricing.nativeUnit(variant){return ShopMoneyDisplay.atoms(String(unit.atoms),locale:locale) ?? String(localized:"unavailable",locale:locale)}
        if variant.nativePrice==nil{return ShopMoneyDisplay.legacyYNXT(variant.priceYNXT,locale:locale)}
        return String(localized:"unavailable",locale:locale)
    }
    var body:some View{Text(verbatim:text).fixedSize(horizontal:false,vertical:true)}
}
