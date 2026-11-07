import SwiftUI

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
    private var displayed:[Product]{
        let filtered=model.products.filter{p in (category==nil || p.category==category) && (!inStock || p.variants.contains{$0.available>0})}
        if sort=="price_low"{return filtered.sorted{($0.variants.map(\.priceYNXT).min() ?? .max)<($1.variants.map(\.priceYNXT).min() ?? .max)}}
        if sort=="price_high"{return filtered.sorted{($0.variants.map(\.priceYNXT).min() ?? .min)>($1.variants.map(\.priceYNXT).min() ?? .min)}}
        return filtered
    }
    var body:some View{GeometryReader{geometry in
        let desktop=geometry.size.width>=900
        ScrollView{VStack(alignment:.leading,spacing:24){
            if !desktop{HStack{ShopSearchField{Task{await model.loadCatalog()}};Button{model.prepareComparison(ids:Array(comparisonIDs).sorted())}label:{Image(systemName:"sparkles").frame(width:36,height:38)}.buttonStyle(.plain).accessibilityLabel("ai_compare")}}
            if !searchOnly{ShopEditorialHero(desktop:desktop)}
            if !categories.isEmpty{ScrollView(.horizontal,showsIndicators:false){HStack(spacing:12){categoryButton(nil);ForEach(categories,id:\.self){categoryButton($0)}}}}
            HStack(alignment:.firstTextBaseline){ShopSectionTitle(title:searchOnly ? "search":"catalog_heading");Spacer();Button("ai_compare"){model.prepareComparison(ids:Array(comparisonIDs).sorted())}.buttonStyle(ShopButtonStyle(kind:.secondary))}
            HStack(spacing:16){Text("\(displayed.count)").monospacedDigit();Text("shop_visible_results").foregroundStyle(ShopTheme.secondary);Spacer();Toggle("shop_in_stock",isOn:$inStock).toggleStyle(.switch).controlSize(.mini);Picker("shop_sort",selection:$sort){Text("shop_sort_default").tag("default");Text("shop_sort_low").tag("price_low");Text("shop_sort_high").tag("price_high")}.pickerStyle(.menu).fixedSize()}.shopFont(12)
            if displayed.isEmpty {
                if model.state=="loading"{ProgressView().frame(maxWidth:.infinity,minHeight:180)}
                else{ContentUnavailableView("empty_catalog",systemImage:"magnifyingglass",description:Text("no_fake_records")).frame(maxWidth:.infinity,minHeight:220);Button("retry"){Task{await model.loadCatalog()}}.buttonStyle(ShopButtonStyle(kind:.secondary))}
            } else {
                LazyVGrid(columns:[GridItem(.adaptive(minimum:desktop ? 220:150,maximum:desktop ? 320:260),spacing:20)],alignment:.leading,spacing:20){ForEach(displayed){product in
                    ShopProductCard(product:product,selected:comparisonIDs.contains(product.productID)){if comparisonIDs.contains(product.productID){comparisonIDs.remove(product.productID)}else if comparisonIDs.count<3{comparisonIDs.insert(product.productID)}}
                }}
            }
            if !searchOnly{ShopPlatformServices(desktop:desktop)}
            ShopMarketplaceFooter()
        }.padding(desktop ? ShopTheme.desktopPadding:ShopTheme.mobilePadding).frame(maxWidth:ShopTheme.maximumPageWidth+80).frame(maxWidth:.infinity,alignment:.center)}
        .background(ShopTheme.background).navigationTitle(searchOnly ? "search":"app_name").shopInlineTitle().refreshable{await model.loadCatalog()}
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
        NavigationLink{ProductView(product:product)}label:{ProductImage(product:product,height:190)}.buttonStyle(.plain)
        VStack(alignment:.leading,spacing:9){
            NavigationLink{ProductView(product:product)}label:{Text(product.name).shopFont(15,.semibold).foregroundStyle(ShopTheme.text).lineLimit(2).frame(maxWidth:.infinity,alignment:.leading)}.buttonStyle(.plain)
            if let category=product.category{Text(category).shopFont(12).foregroundStyle(ShopTheme.secondary)}
            if let price=product.variants.map(\.priceYNXT).min(){Text(ShopMoneyDisplay.legacyYNXT(price,locale:Locale(identifier:model.appLanguage))).shopFont(17,.bold).foregroundStyle(ShopTheme.text)}
            HStack{Text(String(format:String(localized:"catalog_variant_count",locale:Locale(identifier:model.appLanguage)),locale:Locale(identifier:model.appLanguage),Int64(product.variants.count))).foregroundStyle(ShopTheme.secondary);Spacer();Button(action:toggleComparison){Image(systemName:selected ? "checkmark.circle.fill":"plus.circle").foregroundStyle(selected ? ShopTheme.primary:ShopTheme.secondary)}.buttonStyle(.plain).accessibilityLabel("ai_compare")}.shopFont(12)
        }.padding(16)
    }.background(ShopTheme.surface).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius)).overlay(RoundedRectangle(cornerRadius:ShopTheme.radius).stroke(selected ? ShopTheme.primary:ShopTheme.border,lineWidth:1))}
}
struct ProductImage:View {
    let product:Product
    let height:CGFloat
    private var media:ProductMedia?{product.media.first(where:{$0.imageURL != nil})}
    var body:some View{Group{if let url=media?.imageURL{AsyncImage(url:url){phase in if let image=phase.image{image.resizable().scaledToFit()}else{placeholder.overlay{if phase.error==nil{ProgressView()}}}}}else{placeholder}}.frame(maxWidth:.infinity).frame(height:height).background(ShopTheme.background).clipped().accessibilityLabel(media?.altText ?? product.name)}
    private var placeholder:some View{Rectangle().fill(ShopTheme.tertiary).overlay{Image(systemName:"photo").font(.largeTitle).foregroundStyle(ShopTheme.muted).accessibilityHidden(true)}}
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
    let product:Product
    @EnvironmentObject var model:ShopModel
    var body:some View{GeometryReader{geometry in
        let desktop=geometry.size.width>=900
        ScrollView{VStack(alignment:.leading,spacing:24){
            HStack{Text("nav_catalog");Text("/");if let category=product.category{Text(category);Text("/")};Text(product.name).lineLimit(1)}.shopFont(12).foregroundStyle(ShopTheme.secondary)
            if desktop{HStack(alignment:.top,spacing:40){ProductGallery(product:product).frame(maxWidth:560);productInformation}}else{VStack(alignment:.leading,spacing:24){ProductGallery(product:product);productInformation}}
            ShopPanel{VStack(alignment:.leading,spacing:18){ShopSectionTitle(title:"shop_product_details");Text(product.description ?? String(localized:"unavailable")).shopFont(14).textSelection(.enabled);Divider();Text("trust_evidence").shopFont(17,.semibold);Text("trust_boundary").shopFont(13).foregroundStyle(ShopTheme.secondary)}}
        }.padding(desktop ? 40:16).frame(maxWidth:1440).frame(maxWidth:.infinity)}.background(ShopTheme.background).navigationTitle(product.name).shopInlineTitle()
    }}
    private var productInformation:some View{VStack(alignment:.leading,spacing:20){
        Text(product.category ?? String(localized:"nav_catalog")).shopFont(13,.semibold).foregroundStyle(ShopTheme.primary)
        Text(product.name).shopFont(28,.bold,relativeTo:.title).fixedSize(horizontal:false,vertical:true)
        Text(product.description ?? "").shopFont(14).foregroundStyle(ShopTheme.secondary)
        if let price=product.variants.map(\.priceYNXT).min(){Text(ShopMoneyDisplay.legacyYNXT(price,locale:Locale(identifier:model.appLanguage))).shopFont(28,.bold).padding(.vertical,6)}
        Divider()
        Text("shop_choose_variant").shopFont(15,.semibold)
        ForEach(product.variants){variant in ProductVariantRow(product:product,variant:variant)}
        ShopNotice(title:"payment_boundary")
        Button("ai_compare"){model.prepareComparison(ids:[product.productID])}.buttonStyle(ShopButtonStyle(kind:.secondary))
    }.frame(maxWidth:.infinity,alignment:.leading)}
}
struct ProductGallery:View {
    let product:Product
    @State private var selected=0
    private var media:[ProductMedia]{product.media.filter{$0.imageURL != nil}}
    var body:some View{VStack(spacing:12){
        if media.indices.contains(selected),let url=media[selected].imageURL {
            AsyncImage(url:url){phase in if let image=phase.image{image.resizable().scaledToFit()}else if phase.error==nil{ProgressView()}else{Image(systemName:"photo").font(.largeTitle).foregroundStyle(ShopTheme.muted)}}.frame(maxWidth:.infinity).frame(height:360).background(ShopTheme.surface).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius)).accessibilityLabel(media[selected].altText ?? product.name)
        }else{ProductImage(product:product,height:360).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius))}
        if media.count>1{ScrollView(.horizontal){HStack(spacing:10){ForEach(Array(media.enumerated()),id:\.offset){index,image in Button{selected=index}label:{AsyncImage(url:image.imageURL){phase in if let item=phase.image{item.resizable().scaledToFit()}else{Image(systemName:"photo")}}.frame(width:76,height:76).background(ShopTheme.surface).clipShape(RoundedRectangle(cornerRadius:6)).overlay(RoundedRectangle(cornerRadius:6).stroke(selected==index ? ShopTheme.primary:ShopTheme.border,lineWidth:1))}.buttonStyle(.plain).accessibilityLabel(image.altText ?? product.name)}}}}
    }}
}
struct ProductVariantRow:View {
    @EnvironmentObject var model:ShopModel
    let product:Product
    let variant:Variant
    var body:some View{ShopPanel(padding:16){HStack(alignment:.center,spacing:16){VStack(alignment:.leading,spacing:7){Text(variant.name).shopFont(15,.semibold);Text(ShopMoneyDisplay.legacyYNXT(variant.priceYNXT,locale:Locale(identifier:model.appLanguage))).shopFont(17,.bold);NativeCatalogUnitAmount(price:variant.nativePrice);Text("\(variant.available) \(String(localized:"inventory",locale:Locale(identifier:model.appLanguage)))").shopFont(12).foregroundStyle(variant.available>0 ? ShopTheme.secondary:ShopTheme.danger)};Spacer();Button("add_cart"){model.add(product,variant)}.buttonStyle(ShopButtonStyle()).disabled(model.localDataLocked || model.mutationBusy || model.checkoutRecoveryRequired || variant.priceYNXT<1 || variant.available<1 || (model.cart.first(where:{$0.productID==product.productID && $0.variantID==variant.variantID})?.quantity ?? 0)>=20)}}}
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
            ShopMarketplaceFooter()
        }.padding(desktop ? 40:16).frame(maxWidth:1440).frame(maxWidth:.infinity)}.background(ShopTheme.background).navigationTitle("nav_cart").shopInlineTitle()
    }}
    private var cartLines:some View{VStack(spacing:16){ForEach(model.cart){item in CartItemView(item:item,revision:model.privacyRevision)}}.frame(maxWidth:.infinity,alignment:.topLeading)}
}
struct CartItemView:View {
    let item:CartItem
    let revision:Int
    @EnvironmentObject var model:ShopModel
    private var product:Product?{let matches=model.products.filter{$0.productID==item.productID};return matches.count==1 ? matches[0]:nil}
    private var variant:Variant?{let matches=product?.variants.filter{$0.variantID==item.variantID} ?? [];return matches.count==1 ? matches[0]:nil}
    var body:some View{ShopPanel{HStack(alignment:.top,spacing:16){if let product{ProductImage(product:product,height:96).frame(width:96).clipShape(RoundedRectangle(cornerRadius:6))};VStack(alignment:.leading,spacing:10){Text(product?.name ?? item.productID).shopFont(15,.semibold);Text(variant?.name ?? item.variantID).shopFont(12).foregroundStyle(ShopTheme.secondary);if let variant{Text(ShopMoneyDisplay.legacyYNXT(variant.priceYNXT,locale:Locale(identifier:model.appLanguage))).shopFont(17,.bold);NativeCatalogUnitAmount(price:variant.nativePrice)};Stepper(value:Binding(get:{item.quantity},set:{model.setCartQuantity(item,quantity:$0,revision:revision)}),in:1...20){Text("\(item.quantity)").monospacedDigit()}.fixedSize();Button("cart_remove",role:.destructive){model.removeCart(item,revision:revision)}.buttonStyle(.plain).shopFont(12).foregroundStyle(ShopTheme.secondary)};Spacer(minLength:0)}}.disabled(model.localDataLocked || model.mutationBusy || model.checkoutRecoveryRequired)}
}
struct CartSummary:View {
    @EnvironmentObject var model:ShopModel
    let showCheckout:Bool
    private var estimate:Int64?{
        var total:Int64=0
        for item in model.cart {
            let products=model.products.filter{$0.productID==item.productID}
            guard products.count==1 else{return nil}
            let variants=products[0].variants.filter{$0.variantID==item.variantID}
            guard variants.count==1,(1...20).contains(item.quantity),variants[0].priceYNXT>=0 else{return nil}
            let line=variants[0].priceYNXT.multipliedReportingOverflow(by:Int64(item.quantity));guard !line.overflow else{return nil}
            let sum=total.addingReportingOverflow(line.partialValue);guard !sum.overflow else{return nil};total=sum.partialValue
        }
        return total
    }
    private var itemCount:String{var total=0;for item in model.cart{guard item.quantity>=0 else{return String(localized:"unavailable")};let sum=total.addingReportingOverflow(item.quantity);guard !sum.overflow else{return String(localized:"unavailable")};total=sum.partialValue};return String(total)}
    var body:some View{ShopPanel{VStack(alignment:.leading,spacing:18){
        Text("order_review").shopFont(17,.semibold);Divider()
        HStack{Text("shop_cart_items");Spacer();Text(itemCount).monospacedDigit()}.shopFont(13)
        HStack(alignment:.firstTextBaseline){Text("shop_estimated_total");Spacer();if let estimate{Text(ShopMoneyDisplay.legacyYNXT(estimate,locale:Locale(identifier:model.appLanguage))).shopFont(22,.bold).multilineTextAlignment(.trailing)}else{Text("unavailable").foregroundStyle(ShopTheme.secondary)}}
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
            if let createdOrder{ShopPanel{VStack(alignment:.leading,spacing:16){ShopStatusBadge(status:createdOrder.status);Text(createdOrder.orderID).font(.caption.monospaced());Text(ShopMoneyDisplay.order(createdOrder,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable")).shopFont(22,.bold);NavigationLink{OrderDetailView(orderID:createdOrder.orderID)}label:{Text("nav_orders")}.buttonStyle(ShopButtonStyle())}}}
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
        switch filter{case "payment_pending":return matching && order.status=="payment_pending";case "fulfillment":return matching && ["paid","shipped"].contains(order.status);case "aftersale":return matching && (order.status.contains("return") || order.status.contains("refund") || order.status=="disputed");case "complete":return matching && ["delivered","reviewed"].contains(order.status);default:return matching}
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
        Divider();HStack(alignment:.firstTextBaseline){Text(ShopMoneyDisplay.order(order,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable")).shopFont(22,.bold);Spacer();NavigationLink{OrderDetailView(orderID:order.orderID)}label:{Text("shop_order_details")}.buttonStyle(ShopButtonStyle(kind:.secondary))}
        if let refund=order.refundStatus,!refund.isEmpty{Text(LocalizedStringKey(refund)).shopFont(12).foregroundStyle(ShopTheme.secondary)}
        NativeOrderAmounts(order:order)
        OrderActions(order:order)
    }}}
}
struct OrderActions:View {
    @EnvironmentObject var model:ShopModel
    let order:Order
    var body:some View{ViewThatFits(in:.horizontal){HStack(spacing:12){buttons};VStack(alignment:.leading,spacing:12){buttons}}}
    @ViewBuilder private var buttons:some View {
        if order.status=="payment_pending"{Button("pay_handoff"){model.pay(order)}.buttonStyle(ShopButtonStyle()).disabled(model.mutationBusy)}
        if order.status=="payment_pending" || (order.payIntentID ?? "").hasPrefix("npi_"){Button("check_payment"){model.checkPayment(order)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(model.mutationBusy)}
        Menu("order_actions"){ForEach([("cancelled","cancel_order"),("delivered","confirm_delivery"),("reviewed","write_review"),("return_requested","return_request"),("refund_requested","refund_request"),("disputed","dispute")],id:\.0){action,title in if BuyerOrderActionInput.allowed(order.status,action){Button(LocalizedStringKey(title)){model.beginOrderAction(order,action,title:title)}}}}.disabled(model.mutationBusy)
    }
}
struct OrderDetailView:View {
    @EnvironmentObject var model:ShopModel
    let orderID:String
    private var current:Order?{model.orders.first{$0.orderID==orderID}}
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:24){
        ShopSectionTitle(title:"shop_order_details")
        if let order=current {
            OrderSummaryRow(order:order)
            ShopPanel{VStack(alignment:.leading,spacing:12){Text("payment_boundary").shopFont(14);if let invoice=order.invoiceID{LabeledContent("shop_invoice_reference"){Text(invoice).font(.caption.monospaced()).textSelection(.enabled)}};if let operation=order.payIntentID{LabeledContent("shop_original_operation"){Text(operation).font(.caption.monospaced()).textSelection(.enabled)}};Text("trust_evidence").shopFont(17,.semibold);Text(order.trustStatus ?? String(localized:"trust_unavailable")).shopFont(13).foregroundStyle(ShopTheme.secondary)}}
        }else{ContentUnavailableView("unavailable",systemImage:"shippingbox")}
        Button("retry"){Task{await model.loadOrders()}}.buttonStyle(ShopButtonStyle(kind:.secondary))
    }.padding(24).frame(maxWidth:1200).frame(maxWidth:.infinity)}.background(ShopTheme.background).navigationTitle("shop_order_details").shopInlineTitle().sheet(item:$model.orderActionPresentation){presentation in BuyerOrderActionForm(presentation:presentation)}.onDisappear{model.orderActionPresentation=nil}}
}
struct BuyerOrderActionForm:View {
    let presentation:ShopModel.OrderActionPresentation
    @EnvironmentObject var model:ShopModel
    @State private var rating=0
    @State private var reason=""
    @State private var detail=""
    @State private var invalid=false
    private var review:Bool{presentation.action=="reviewed"}
    private var resolution:Bool{["return_requested","refund_requested","disputed"].contains(presentation.action)}
    var body:some View{NavigationStack{Form{
        Section{Text(presentation.order.orderID).font(.caption.monospaced());Text(ShopMoneyDisplay.order(presentation.order,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable"))}
        if review{Section{Picker("order_rating",selection:$rating){Text("order_rating_select").tag(0);ForEach(1...5,id:\.self){Text("\($0) ★").tag($0)}};TextField("order_review_text",text:$detail,axis:.vertical).lineLimit(3...8)}}
        else if resolution{Section{TextField("order_reason",text:$reason);TextField("order_explanation",text:$detail,axis:.vertical).lineLimit(3...8)}}
        else{Text(LocalizedStringKey(presentation.title))}
        if invalid{Text(LocalizedStringKey(model.state.isEmpty ? "order_input_required":model.state)).foregroundStyle(ShopTheme.danger)}
        Button("order_submit"){invalid = !model.submitOrderAction(presentation,rating:review ? rating:0,reason:resolution ? reason:"",detail:review || resolution ? detail:"")}.disabled(model.mutationBusy)
        Button("cancel"){model.orderActionPresentation=nil}
    }.navigationTitle(LocalizedStringKey(presentation.title)).shopInlineTitle()}.frame(minWidth:300,minHeight:360)}
}
struct OriginalOrderLinkSheet:View {
    @EnvironmentObject var model:ShopModel
    let link:OriginalOrderLink
    var body:some View{NavigationStack{ScrollView{VStack(alignment:.leading,spacing:20){
        ShopSectionTitle(title:"nav_orders");Text(link.orderID).font(.caption.monospaced()).textSelection(.enabled);Text(link.account).font(.caption.monospaced());Text(OriginalOrderLink.chainID).shopFont(12).foregroundStyle(ShopTheme.secondary)
        if !model.signedIn{Button("wallet_sign_in"){model.signIn()}.buttonStyle(ShopButtonStyle())}
        else if model.originalOrderLoading{ProgressView()}
        else if let order=model.linkedOriginalOrder{ShopStatusBadge(status:order.status);Text(ShopMoneyDisplay.order(order,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable")).shopFont(22,.bold);if let refund=order.refundStatus{Text(LocalizedStringKey(refund)).shopFont(13)};NativeOrderAmounts(order:order)}
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
        ShopSectionTitle(title:"order_review");Text(presentation.review.original.orderID).font(.caption.monospaced()).textSelection(.enabled);Text(ShopMoneyDisplay.order(presentation.review.original,locale:Locale(identifier:model.appLanguage)) ?? String(localized:"unavailable")).shopFont(28,.bold);Text(presentation.review.invoiceID ?? "").font(.caption.monospaced());ShopNotice(title:"payment_boundary")
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
    var body:some View{HStack(alignment:.top,spacing:12){ProductImage(product:product,height:64).frame(width:64).clipShape(RoundedRectangle(cornerRadius:6));VStack(alignment:.leading,spacing:6){Text(product.name).shopFont(14,.semibold);if let price=product.variants.map(\.priceYNXT).min(){Text(ShopMoneyDisplay.legacyYNXT(price,locale:Locale(identifier:model.appLanguage))).shopFont(15,.bold)};Text(String(format:String(localized:"catalog_variant_count",locale:Locale(identifier:model.appLanguage)),locale:Locale(identifier:model.appLanguage),Int64(product.variants.count))).shopFont(12).foregroundStyle(ShopTheme.secondary)}}.frame(maxWidth:.infinity,alignment:.leading)}
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
            else if validated(payment){VStack(alignment:.leading,spacing:8){HStack{Text("native_paid_atoms");Spacer();Text(payment.PaidAtoms).monospacedDigit()};HStack{Text("native_refunded_atoms");Spacer();Text(payment.RefundedAtoms).monospacedDigit()};HStack{Text("native_net_atoms");Spacer();Text(payment.NetPaidAtoms).monospacedDigit()};if !payment.CompleteKnownOriginals || !(payment.PendingOriginals ?? []).isEmpty{Text("native_history_pending").foregroundStyle(ShopTheme.warning)}}.shopFont(12).padding(12).background(ShopTheme.tertiary).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))}
            else{ShopNotice(title:"seller_native_receipt_unavailable",symbol:"lock",warning:true)}
        }
    }
    private func validated(_ payment:NativePaymentProjection)->Bool{do{try payment.validate(order,requirePaid:false);return true}catch{return false}}
}

private struct NativeCatalogUnitAmount:View {
    let price:SellerNativePriceDATA?
    var body:some View{if let price,price.AssetID=="YNXT",price.UnitVersion=="1",price.Genesis.utf8.count==64,NativeWire.matches(price.Genesis,"^[a-f0-9]{64}$"),let chain=UInt64(price.NativeChainID),chain>0,String(chain)==price.NativeChainID,let amount=UInt64(price.AmountAtoms),amount>0,String(amount)==price.AmountAtoms {Text(price.AmountAtoms+" "+String(localized:"native_atoms_unit")).shopFont(12).foregroundStyle(ShopTheme.secondary)}}
}
