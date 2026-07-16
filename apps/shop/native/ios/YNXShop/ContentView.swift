import SwiftUI

let supportedLanguages=["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"]

struct ContentView:View {
    @EnvironmentObject var model:ShopModel
    var body:some View {TabView{
        NavigationStack{CatalogView()}.tabItem{Label("nav_catalog",systemImage:"sparkle.magnifyingglass")}
        NavigationStack{CartView()}.tabItem{Label("nav_cart",systemImage:"cart")}.badge(model.cart.count)
        NavigationStack{OrdersView()}.tabItem{Label("nav_orders",systemImage:"shippingbox")}
        NavigationStack{AccountView()}.tabItem{Label("nav_account",systemImage:"person.crop.circle")}
    }.tint(Color(red:0,green:47/255,blue:167/255)).safeAreaInset(edge:.top){if !model.state.isEmpty{Text(LocalizedStringKey(model.state)).font(.caption).frame(maxWidth:.infinity).padding(6).background(.thinMaterial).accessibilityLabel("accessibility_status")}}}
}

struct CatalogView:View {@EnvironmentObject var model:ShopModel
    var body:some View{List{Section{TextField("search_hint",text:$model.search).textInputAutocapitalization(.never);Button("search"){Task{await model.loadCatalog()}};Button("ai_compare"){model.runAI(workflow:"search_comparison",summary:model.search)}}
        ForEach(model.products){p in NavigationLink{ProductView(product:p)}label:{VStack(alignment:.leading){Text(p.Name).font(.headline);Text(p.Category ?? "").font(.caption);Text("\(p.Variants.count) variants").foregroundStyle(.secondary)}}}
        if model.state=="empty_catalog"{ContentUnavailableView("empty_catalog",systemImage:"shippingbox",description:Text("no_fake_records"))}
    }.navigationTitle("app_name").refreshable{await model.loadCatalog()}}
}
struct ProductView:View {let product:Product;@EnvironmentObject var model:ShopModel
    var body:some View{List{Text(product.Description ?? "");ForEach(product.Variants){v in HStack{VStack(alignment:.leading){Text(v.Name);Text(v.PriceYNXT.formatted()+" YNXT");Text("\(v.Available) \(String(localized:"inventory"))").font(.caption)};Spacer();Button("add_cart"){model.add(product,v)}.disabled(v.Available<1)}};Section("trust_evidence"){Text("trust_boundary")}}.navigationTitle(product.Name)}
}
struct CartView:View {@EnvironmentObject var model:ShopModel;@State var recipient="",address="",city="",country=""
    var body:some View{Form{if model.cart.isEmpty{ContentUnavailableView("cart_empty",systemImage:"cart")}else{ForEach(model.cart){Text("\($0.Quantity) × \($0.VariantID)")}}
        Section("order_review"){TextField("recipient",text:$recipient);TextField("address",text:$address);TextField("city",text:$city);TextField("country",text:$country);Text("payment_boundary").font(.caption);Button("checkout"){model.checkout(recipient:recipient,address:address,city:city,country:country)}.disabled(model.cart.isEmpty)}}.navigationTitle("nav_cart")}
}
struct OrdersView:View {@EnvironmentObject var model:ShopModel;@State var reason=""
    var body:some View{List{if !model.signedIn{Button("wallet_sign_in"){model.signIn()}}else if model.orders.isEmpty{ContentUnavailableView("no_orders",systemImage:"shippingbox")}else{ForEach(model.orders){o in Section{Text(o.ID).font(.caption.monospaced());Text(LocalizedStringKey(o.Status));Text("\(o.TotalYNXT.formatted()) YNXT");if o.Status=="payment_pending"{Button("pay_handoff"){model.pay(o)};Button("check_payment"){model.transition(o,"settlement_check",reason:"")}};TextField("reason",text:$reason);Menu("order_actions"){Button("cancel_order"){model.transition(o,"cancelled",reason:reason)};Button("confirm_delivery"){model.transition(o,"delivered",reason:reason)};Button("write_review"){model.transition(o,"reviewed",reason:reason)};Button("return_request"){model.transition(o,"return_requested",reason:reason)};Button("refund_request"){model.transition(o,"refund_requested",reason:reason)};Button("dispute"){model.transition(o,"disputed",reason:reason)}};Text(o.TrustStatus ?? "trust_unavailable").font(.caption)}}};Button("restore_pending"){model.retryPending()}}.navigationTitle("nav_orders").task{await model.loadOrders()}.refreshable{await model.loadOrders()}}
}
struct AccountView:View {@EnvironmentObject var model:ShopModel
    var body:some View{Form{Section("wallet_security"){if model.signedIn{Text("wallet_active")}else{Button("wallet_sign_in"){model.signIn()}};Text("privacy_boundary").font(.caption)};Section("settings_language"){Picker("settings_language",selection:Binding(get:{model.appLanguage},set:model.setLanguage)){ForEach(supportedLanguages,id:\.self){Text(Locale.current.localizedString(forIdentifier:$0) ?? $0).tag($0)}};Picker("ai_language",selection:Binding(get:{model.aiLanguage},set:model.setAILanguage)){ForEach(supportedLanguages,id:\.self){Text($0).tag($0)}};Text("ai_privacy").font(.caption)};Section("service_boundaries"){Text("tax_unavailable");Text("logistics_unavailable")}}.navigationTitle("nav_account")}
}
