import SwiftUI

let supportedLanguages=["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"]

struct ContentView:View {
    @EnvironmentObject var model:ShopModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab=0
    @AppStorage("shop-text-size") private var textSize="standard"
    @ScaledMetric(relativeTo:.body) private var bodySize:CGFloat=16
    private var textScale:CGFloat{textSize=="compact" ? 0.925 : textSize=="larger" ? 1.15 : 1}
    var body:some View {TabView(selection:$selectedTab){
        NavigationStack{CatalogView()}.tabItem{Label("nav_catalog",systemImage:"sparkle.magnifyingglass")}.tag(0)
        NavigationStack{CartView()}.tabItem{Label("nav_cart",systemImage:"cart")}.tag(1).badge(model.cart.count)
        NavigationStack{OrdersView()}.tabItem{Label("nav_orders",systemImage:"shippingbox")}.tag(2)
        NavigationStack{AccountView()}.tabItem{Label("nav_account",systemImage:"person.crop.circle")}.tag(3)
    }.sheet(item:$model.invoicePresentation){presentation in VStack(alignment:.leading,spacing:18){Text("order_review").font(.title2);Text(presentation.review.original.orderID).font(.caption.monospaced());Text("\(presentation.review.original.totalYNXT.formatted()) YNXT").font(.title);Text(presentation.review.invoiceID ?? "").font(.caption.monospaced());Text("payment_boundary");Button("pay_handoff"){model.openReviewedInvoice()}.buttonStyle(.borderedProminent);Button("close"){model.cancelInvoicePresentation()}}.padding(24).frame(minWidth:300)}.onChange(of:selectedTab){model.cancelInvoicePresentation()}.onChange(of:scenePhase){if scenePhase != .active{model.cancelInvoicePresentation()}else{model.sceneActive()}}.font(.system(size:bodySize*textScale)).tint(Color(red:0,green:47/255,blue:167/255)).safeAreaInset(edge:.top){VStack(spacing:0){
        HStack(spacing:10){Image("YNXLogo").resizable().scaledToFit().frame(width:45.6,height:24).accessibilityLabel("YNX");Text("app_name").font(.system(size:bodySize*textScale,weight:.semibold)).fixedSize(horizontal:false,vertical:true);Spacer(minLength:8);Menu{Link("seller_console",destination:URL(string:"https://shop.ynxweb4.com/seller/")!);Link("merchant_invoices",destination:URL(string:"https://pay.ynxweb4.com/merchant/")!)}label:{Label("commerce_services",systemImage:"square.grid.2x2").labelStyle(.iconOnly).frame(minWidth:44,minHeight:44)}.accessibilityLabel("commerce_services")}.padding(.horizontal,16).padding(.vertical,8).background(.regularMaterial)
        if !model.state.isEmpty{Text(LocalizedStringKey(model.state)).font(.caption).frame(maxWidth:.infinity).padding(6).background(.thinMaterial).accessibilityLabel("accessibility_status")}
    }}}
}

struct CatalogView:View {@EnvironmentObject var model:ShopModel
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:24){
        HStack(spacing:12){TextField("search_hint",text:$model.search).shopCapitalization(false).textFieldStyle(.roundedBorder).onSubmit{Task{await model.loadCatalog()}};Button("search"){Task{await model.loadCatalog()}}.buttonStyle(.borderedProminent)}
        HStack{Text("catalog_heading").font(.title2.weight(.semibold));Spacer();Button("ai_compare"){model.runAI(workflow:"search_comparison",summary:model.search)}.buttonStyle(.bordered)}
        LazyVGrid(columns:[GridItem(.adaptive(minimum:220,maximum:360),spacing:20)],alignment:.leading,spacing:20){
            ForEach(model.products){p in NavigationLink{ProductView(product:p)}label:{VStack(alignment:.leading,spacing:0){
                ProductImage(product:p,height:200)
                VStack(alignment:.leading,spacing:10){Text(p.name).font(.headline).fixedSize(horizontal:false,vertical:true);if let category=p.category,!category.isEmpty{Text(category).font(.caption).foregroundStyle(.secondary)}
                    if let price=p.variants.map(\.priceYNXT).min(){Text(price.formatted(.number.locale(Locale(identifier:model.appLanguage)))+" YNXT").font(.headline).foregroundStyle(Color.accentColor)}
                    Text(String(format:String(localized:"catalog_variant_count",locale:Locale(identifier:model.appLanguage)),locale:Locale(identifier:model.appLanguage),Int64(p.variants.count))).font(.caption).foregroundStyle(.secondary)
                }.padding(18).frame(maxWidth:.infinity,alignment:.leading)
            }.background(.background).clipShape(RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).stroke(Color.gray.opacity(0.18),lineWidth:1))}.buttonStyle(.plain)}
        }
        if model.state=="empty_catalog"{ContentUnavailableView("empty_catalog",systemImage:"shippingbox",description:Text("no_fake_records"))}
    }.padding(24).frame(maxWidth:1200).frame(maxWidth:.infinity,alignment:.center)}.navigationTitle("app_name").shopInlineTitle().refreshable{await model.loadCatalog()}}
}
struct ProductImage:View {
    let product:Product
    let height:CGFloat
    private var media:ProductMedia?{product.media.first(where:{$0.imageURL != nil})}
    var body:some View{Group{if let url=media?.imageURL{AsyncImage(url:url){phase in
        if let image=phase.image{image.resizable().scaledToFill()}
        else{placeholder.overlay{if phase.error==nil{ProgressView()}}}
    }}else{placeholder}}.frame(maxWidth:.infinity).frame(height:height).clipped().accessibilityLabel(media?.altText ?? product.name)}
    private var placeholder:some View{Rectangle().fill(Color.gray.opacity(0.08)).overlay{Image(systemName:"photo").font(.largeTitle).foregroundStyle(.secondary).accessibilityHidden(true)}}
}
struct ProductView:View {let product:Product;@EnvironmentObject var model:ShopModel
    var body:some View{List{ProductImage(product:product,height:280).listRowInsets(EdgeInsets());Text(product.description ?? "");ForEach(product.variants){v in HStack{VStack(alignment:.leading){Text(v.name);Text(v.priceYNXT.formatted(.number.locale(Locale(identifier:model.appLanguage)))+" YNXT");Text("\(v.available) \(String(localized:"inventory",locale:Locale(identifier:model.appLanguage)))").font(.caption)};Spacer();Button("add_cart"){model.add(product,v)}.disabled(v.available<1)}};Section("trust_evidence"){Text("trust_boundary")}}.navigationTitle(product.name).shopInlineTitle()}
}
struct CartView:View {@EnvironmentObject var model:ShopModel
    @State var recipient=""
    @State var address=""
    @State var city=""
    @State var country=""
    var body:some View{Form{if model.cart.isEmpty{ContentUnavailableView("cart_empty",systemImage:"cart")}else{ForEach(model.cart){item in HStack{Text("\(item.quantity) × \(item.variantID)");Spacer();Button("cart_remove"){model.removeCart(item)}}}}
        Section{Button("cart_sync_button"){model.syncCart()};Button("cart_recover_checkout"){model.recoverCheckout()}}
        Section("order_review"){TextField("recipient",text:$recipient);TextField("address",text:$address);TextField("city",text:$city);TextField("country",text:$country);Text("payment_boundary").font(.caption);Button("checkout"){model.checkout(recipient:recipient,address:address,city:city,country:country)}.disabled(model.cart.isEmpty || model.mutationBusy)}}.navigationTitle("nav_cart").shopInlineTitle()}
}
struct OrdersView:View {
    @EnvironmentObject var model:ShopModel
    var body:some View{List{
        if !model.signedIn{Button("wallet_sign_in"){model.signIn()}}
        else if model.orders.isEmpty{ContentUnavailableView("no_orders",systemImage:"shippingbox")}
        else{ForEach(model.orders){o in Section{
            Text(o.orderID).font(.caption.monospaced());Text(LocalizedStringKey(o.status));Text("\(o.totalYNXT.formatted()) YNXT")
            if o.status=="payment_pending"{Button("pay_handoff"){model.pay(o)};Button("check_payment"){model.checkPayment(o)}}
            Menu("order_actions"){
                ForEach([("cancelled","cancel_order"),("delivered","confirm_delivery"),("reviewed","write_review"),("return_requested","return_request"),("refund_requested","refund_request"),("disputed","dispute")],id:\.0){action,title in
                    if BuyerOrderActionInput.allowed(o.status,action){Button(LocalizedStringKey(title)){model.beginOrderAction(o,action,title:title)}}
                }
            }.disabled(model.mutationBusy)
            Text(o.trustStatus ?? "trust_unavailable").font(.caption)
        }}}
        Button("restore_pending"){model.retryPending()}
    }.navigationTitle("nav_orders").shopInlineTitle().task{await model.loadOrders()}.refreshable{await model.loadOrders()}
    .sheet(item:$model.orderActionPresentation){presentation in BuyerOrderActionForm(presentation:presentation)}
    .onDisappear{model.orderActionPresentation=nil}
    }
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
        Section{Text(presentation.order.orderID).font(.caption.monospaced());Text("\(presentation.order.totalYNXT.formatted()) YNXT")}
        if review{Section{
            Picker("order_rating",selection:$rating){Text("order_rating_select").tag(0);ForEach(1...5,id:\.self){Text("\($0) ★").tag($0)}}
            TextField("order_review_text",text:$detail,axis:.vertical).lineLimit(3...8)
        }}else if resolution{Section{TextField("order_reason",text:$reason);TextField("order_explanation",text:$detail,axis:.vertical).lineLimit(3...8)}}
        else{Text(LocalizedStringKey(presentation.title))}
        if invalid{Text(LocalizedStringKey(model.state.isEmpty ? "order_input_required":model.state)).foregroundStyle(.red)}
        Button("order_submit"){invalid = !model.submitOrderAction(presentation,rating:review ? rating:0,reason:resolution ? reason:"",detail:review || resolution ? detail:"")}.disabled(model.mutationBusy)
        Button("cancel"){model.orderActionPresentation=nil}
    }.navigationTitle(LocalizedStringKey(presentation.title)).shopInlineTitle()}.frame(minWidth:300,minHeight:360)}
}
struct AccountView:View {@EnvironmentObject var model:ShopModel;@State private var deletionConfirmation="";@AppStorage("shop-text-size") private var textSize="standard"
    var body:some View{Form{Section("wallet_security"){if model.signedIn{Text("wallet_active");Button("sign_out",role:.destructive){model.signOut()}}else{Button("wallet_sign_in"){model.signIn()}};Text("privacy_boundary").font(.caption)};if model.signedIn{Section("save_profile"){TextField("recipient",text:$model.profileRecipient);TextField("address",text:$model.profileAddress);TextField("city",text:$model.profileCity);TextField("country",text:$model.profileCountry);Button("retry"){model.loadProfile()};Button("save_profile"){model.saveProfile()}.disabled(model.mutationBusy)};Section("privacy_data_title"){Text("privacy_data_description").font(.caption);Button("privacy_export_button"){model.exportPrivacyData()};if let url=model.privacyExportURL{ShareLink(item:url){Label("privacy_share_label",systemImage:"square.and.arrow.up")}};Text("privacy_delete_warning").font(.caption);TextField("DELETE_MY_SHOP_DATA",text:$deletionConfirmation).shopCapitalization(true).autocorrectionDisabled();Button("privacy_delete_button",role:.destructive){model.deletePrivacyData(deletionConfirmation)}}};Section("text_size"){Picker("text_size",selection:$textSize){Text("text_compact").tag("compact");Text("text_standard").tag("standard");Text("text_larger").tag("larger")}};Section("settings_language"){Picker("settings_language",selection:Binding(get:{model.appLanguage},set:model.setLanguage)){ForEach(supportedLanguages,id:\.self){Text(Locale.current.localizedString(forIdentifier:$0) ?? $0).tag($0)}};Picker("ai_language",selection:Binding(get:{model.aiLanguage},set:model.setAILanguage)){ForEach(supportedLanguages,id:\.self){Text($0).tag($0)}};Text("ai_privacy").font(.caption)};Section("service_boundaries"){Text("tax_unavailable");Text("logistics_unavailable")}}.navigationTitle("nav_account").shopInlineTitle()}
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
