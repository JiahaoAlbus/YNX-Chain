import SwiftUI

let supportedLanguages=["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"]

struct ContentView:View {
    @EnvironmentObject var model:ShopModel
    @AppStorage("shop-text-size") private var textSize="standard"
    @ScaledMetric(relativeTo:.body) private var bodySize:CGFloat=16
    private var textScale:CGFloat{textSize=="compact" ? 0.925 : textSize=="larger" ? 1.15 : 1}
    var body:some View {TabView{
        NavigationStack{CatalogView()}.tabItem{Label("nav_catalog",systemImage:"sparkle.magnifyingglass")}
        NavigationStack{CartView()}.tabItem{Label("nav_cart",systemImage:"cart")}.badge(model.cart.count)
        NavigationStack{OrdersView()}.tabItem{Label("nav_orders",systemImage:"shippingbox")}
        NavigationStack{AccountView()}.tabItem{Label("nav_account",systemImage:"person.crop.circle")}
    }.font(.system(size:bodySize*textScale)).tint(Color(red:0,green:47/255,blue:167/255)).safeAreaInset(edge:.top){VStack(spacing:0){
        HStack(spacing:10){Image("YNXLogo").resizable().scaledToFit().frame(width:45.6,height:24).accessibilityLabel("YNX");Text("app_name").font(.system(size:bodySize*textScale,weight:.semibold)).fixedSize(horizontal:false,vertical:true);Spacer(minLength:8);Menu{Link("seller_console",destination:URL(string:"https://shop.ynxweb4.com/seller/")!);Link("merchant_invoices",destination:URL(string:"https://pay.ynxweb4.com/merchant/")!)}label:{Label("commerce_services",systemImage:"square.grid.2x2").labelStyle(.iconOnly).frame(minWidth:44,minHeight:44)}.accessibilityLabel("commerce_services")}.padding(.horizontal,16).padding(.vertical,8).background(.regularMaterial)
        if !model.state.isEmpty{Text(LocalizedStringKey(model.state)).font(.caption).frame(maxWidth:.infinity).padding(6).background(.thinMaterial).accessibilityLabel("accessibility_status")}
    }}}
}

struct CatalogView:View {@EnvironmentObject var model:ShopModel
    var body:some View{List{Section{TextField("search_hint",text:$model.search).shopCapitalization(false);Button("search"){Task{await model.loadCatalog()}};Button("ai_compare"){model.runAI(workflow:"search_comparison",summary:model.search)}}
        ForEach(model.products){p in NavigationLink{ProductView(product:p)}label:{VStack(alignment:.leading){Text(p.name).font(.headline);Text(p.category ?? "").font(.caption);Text("\(p.variants.count) variants").foregroundStyle(.secondary)}}}
        if model.state=="empty_catalog"{ContentUnavailableView("empty_catalog",systemImage:"shippingbox",description:Text("no_fake_records"))}
    }.navigationTitle("app_name").shopInlineTitle().refreshable{await model.loadCatalog()}}
}
struct ProductView:View {let product:Product;@EnvironmentObject var model:ShopModel
    var body:some View{List{Text(product.description ?? "");ForEach(product.variants){v in HStack{VStack(alignment:.leading){Text(v.name);Text(v.priceYNXT.formatted()+" YNXT");Text("\(v.available) \(String(localized:"inventory"))").font(.caption)};Spacer();Button("add_cart"){model.add(product,v)}.disabled(v.available<1)}};Section("trust_evidence"){Text("trust_boundary")}}.navigationTitle(product.name).shopInlineTitle()}
}
struct CartView:View {@EnvironmentObject var model:ShopModel
    @State var recipient=""
    @State var address=""
    @State var city=""
    @State var country=""
    var body:some View{Form{if model.cart.isEmpty{ContentUnavailableView("cart_empty",systemImage:"cart")}else{ForEach(model.cart){Text("\($0.quantity) × \($0.variantID)")}}
        Section("order_review"){TextField("recipient",text:$recipient);TextField("address",text:$address);TextField("city",text:$city);TextField("country",text:$country);Text("payment_boundary").font(.caption);Button("checkout"){model.checkout(recipient:recipient,address:address,city:city,country:country)}.disabled(model.cart.isEmpty)}}.navigationTitle("nav_cart").shopInlineTitle()}
}
struct OrdersView:View {@EnvironmentObject var model:ShopModel;@State var reason=""
    var body:some View{List{if !model.signedIn{Button("wallet_sign_in"){model.signIn()}}else if model.orders.isEmpty{ContentUnavailableView("no_orders",systemImage:"shippingbox")}else{ForEach(model.orders){o in Section{Text(o.orderID).font(.caption.monospaced());Text(LocalizedStringKey(o.status));Text("\(o.totalYNXT.formatted()) YNXT");if o.status=="payment_pending"{Button("pay_handoff"){model.pay(o)};Button("check_payment"){model.checkPayment(o)}};TextField("reason",text:$reason);Menu("order_actions"){Button("cancel_order"){model.transition(o,"cancelled",reason:reason)};Button("confirm_delivery"){model.transition(o,"delivered",reason:reason)};Button("write_review"){model.transition(o,"reviewed",reason:reason)};Button("return_request"){model.transition(o,"return_requested",reason:reason)};Button("refund_request"){model.transition(o,"refund_requested",reason:reason)};Button("dispute"){model.transition(o,"disputed",reason:reason)}};Text(o.trustStatus ?? "trust_unavailable").font(.caption)}}};Button("restore_pending"){model.retryPending()}}.navigationTitle("nav_orders").shopInlineTitle().task{await model.loadOrders()}.refreshable{await model.loadOrders()}}
}
struct AccountView:View {@EnvironmentObject var model:ShopModel;@State private var deletionConfirmation="";@AppStorage("shop-text-size") private var textSize="standard"
    var body:some View{Form{Section("wallet_security"){if model.signedIn{Text("wallet_active");Button("sign_out",role:.destructive){model.signOut()}}else{Button("wallet_sign_in"){model.signIn()}};Text("privacy_boundary").font(.caption)};if model.signedIn{Section("privacy_data_title"){Text("privacy_data_description").font(.caption);Button("privacy_export_button"){model.exportPrivacyData()};if let url=model.privacyExportURL{ShareLink(item:url){Label("privacy_share_label",systemImage:"square.and.arrow.up")}};Text("privacy_delete_warning").font(.caption);TextField("DELETE_MY_SHOP_DATA",text:$deletionConfirmation).shopCapitalization(true).autocorrectionDisabled();Button("privacy_delete_button",role:.destructive){model.deletePrivacyData(deletionConfirmation)}}};Section("text_size"){Picker("text_size",selection:$textSize){Text("text_compact").tag("compact");Text("text_standard").tag("standard");Text("text_larger").tag("larger")}};Section("settings_language"){Picker("settings_language",selection:Binding(get:{model.appLanguage},set:model.setLanguage)){ForEach(supportedLanguages,id:\.self){Text(Locale.current.localizedString(forIdentifier:$0) ?? $0).tag($0)}};Picker("ai_language",selection:Binding(get:{model.aiLanguage},set:model.setAILanguage)){ForEach(supportedLanguages,id:\.self){Text($0).tag($0)}};Text("ai_privacy").font(.caption)};Section("service_boundaries"){Text("tax_unavailable");Text("logistics_unavailable")}}.navigationTitle("nav_account").shopInlineTitle()}
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
