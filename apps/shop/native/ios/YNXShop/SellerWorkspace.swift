import SwiftUI

// Native layouts adapted from the approved local .fig's 11 seller desktop and
// 7 seller mobile frames. API data and authority belong to ShopSellerModel.
private enum SellerSection:String,CaseIterable,Identifiable {
    case overview,products,inventory,orders,fulfillment,aftersales,reconciliation,members,audit
    var id:String{rawValue}
    var title:LocalizedStringKey{switch self {
    case .overview:return "seller_workbench"
    case .products:return "seller_products"
    case .inventory:return "seller_inventory"
    case .orders:return "nav_orders"
    case .fulfillment:return "seller_fulfillment"
    case .aftersales:return "seller_aftersales"
    case .reconciliation:return "seller_reconciliation"
    case .members:return "seller_members"
    case .audit:return "seller_audit"
    }}
    var symbol:String{switch self {
    case .overview:return "checklist"
    case .products:return "shippingbox"
    case .inventory:return "square.stack.3d.up"
    case .orders:return "list.bullet.rectangle"
    case .fulfillment:return "truck.box"
    case .aftersales:return "arrow.uturn.backward"
    case .reconciliation:return "list.bullet.clipboard"
    case .members:return "person.2"
    case .audit:return "clock.arrow.circlepath"
    }}
}

private struct SellerPage<Content:View>:View {
    let title:LocalizedStringKey
    let subtitle:LocalizedStringKey?
    let desktop:Bool
    let content:Content
    init(_ title:LocalizedStringKey,subtitle:LocalizedStringKey?=nil,desktop:Bool,@ViewBuilder content:()->Content){self.title=title;self.subtitle=subtitle;self.desktop=desktop;self.content=content()}
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:24){
        VStack(alignment:.leading,spacing:8){Text(title).shopFont(28,.bold,relativeTo:.title);if let subtitle{Text(subtitle).shopFont(13).foregroundStyle(ShopTheme.secondary).fixedSize(horizontal:false,vertical:true)}}
        content
    }.padding(desktop ? 32:16).frame(maxWidth:1440).frame(maxWidth:.infinity,alignment:.topLeading)}.background(ShopTheme.background)}
}
private struct SellerLedger<Content:View>:View {
    let content:Content
    init(@ViewBuilder content:()->Content){self.content=content()}
    var body:some View{VStack(alignment:.leading,spacing:0){content}.frame(maxWidth:.infinity,alignment:.leading).background(ShopTheme.surface).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radius)).overlay(RoundedRectangle(cornerRadius:ShopTheme.radius).stroke(ShopTheme.border,lineWidth:1))}
}
private struct SellerField:View {
    let title:LocalizedStringKey
    @Binding var text:String
    var multiline=false
    var body:some View{VStack(alignment:.leading,spacing:8){Text(title).shopFont(13,.semibold);if multiline{TextField(title,text:$text,axis:.vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)}else{TextField(title,text:$text).textFieldStyle(.roundedBorder).shopCapitalization(false).autocorrectionDisabled()}}}
}
private struct SellerEmpty:View {
    var symbol="tray"
    var body:some View{ContentUnavailableView("seller_empty",systemImage:symbol,description:Text("no_fake_records")).frame(maxWidth:.infinity,minHeight:180)}
}
private struct SellerTaskRow:View {
    let title:LocalizedStringKey
    let count:Int?
    let symbol:String
    let action:()->Void
    var body:some View{Button(action:action){HStack(spacing:14){Image(systemName:symbol).foregroundStyle(ShopTheme.primary).frame(width:24);Text(title).shopFont(14);Spacer(minLength:8);Text(count.map{$0.formatted()} ?? String(localized:"unavailable")).shopFont(17,.semibold).monospacedDigit();Image(systemName:"chevron.right").font(.caption).foregroundStyle(ShopTheme.muted)}.foregroundStyle(ShopTheme.text).padding(18).contentShape(Rectangle())}.buttonStyle(.plain)}
}
private struct SellerValue:View {
    let title:LocalizedStringKey
    let value:String
    var body:some View{LabeledContent{Text(verbatim:value).shopFont(13).textSelection(.enabled)}label:{Text(title).shopFont(13).foregroundStyle(ShopTheme.secondary)}}
}
private struct SellerOperationSheet<Content:View>:View {
    @Environment(\.dismiss) private var dismiss
    let title:LocalizedStringKey
    let content:Content
    init(_ title:LocalizedStringKey,@ViewBuilder content:()->Content){self.title=title;self.content=content()}
    var body:some View{NavigationStack{ScrollView{VStack(alignment:.leading,spacing:18){content}.padding(24)}.background(ShopTheme.background).navigationTitle(title).shopInlineTitle().toolbar{ToolbarItem(placement:.cancellationAction){Button("close"){dismiss()}}}}.frame(minWidth:320,idealWidth:560,minHeight:480)}
}
private func sellerCanonicalInteger(_ value:String,positive:Bool=false)->Int64? {
    guard value.range(of:"^(0|[1-9][0-9]{0,18})$",options:.regularExpression) != nil,let number=Int64(value),!positive || number>0 else{return nil};return number
}
private func sellerRequiredText(_ value:String,_ maximum:Int)->Bool{!value.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && value.utf8.count<=maximum}

private enum SellerSheet:Identifiable {
    case listing(String),inventory(String,String),ship(String),returnDecision(String,Bool),revoke(String),createStore,createProduct,activateStore,invite,editStore(SellerStore)
    var id:String{switch self{case .listing(let id):return "listing:"+id;case .inventory(let product,let variant):return "inventory:"+product+":"+variant;case .ship(let id):return "ship:"+id;case .returnDecision(let id,let approve):return "return:"+id+String(approve);case .revoke(let account):return "revoke:"+account;case .createStore:return "create-store";case .createProduct:return "create-product";case .activateStore:return "activate-store";case .invite:return "invite";case .editStore(let snapshot):return "edit-store:"+snapshot.ID}}
}
struct SellerWorkspaceView:View {
    @EnvironmentObject var seller:ShopSellerModel
    @Environment(\.dismiss) private var dismiss
    @State private var section=SellerSection.overview
    @State private var sheet:SellerSheet?
    var body:some View{GeometryReader{geometry in
        let desktop=geometry.size.width>=1000
        VStack(spacing:0){
            header(desktop:desktop)
            if !seller.state.isEmpty{Text(LocalizedStringKey(seller.state)).shopFont(12).frame(maxWidth:.infinity,alignment:.leading).padding(12).background(ShopTheme.tertiary).accessibilityLabel("accessibility_status")}
            if seller.pendingOriginalCount>0{VStack(alignment:.leading,spacing:10){
                HStack{Label("seller_pending_originals",systemImage:"clock.arrow.circlepath");Text(seller.pendingOriginalCount.formatted()).monospacedDigit();Spacer()}
                ViewThatFits(in:.horizontal){HStack{originalActions};VStack(alignment:.leading,spacing:10){originalActions}}
            }.shopFont(12).padding(12).background(ShopTheme.warningBackground)}
            if seller.signedIn{HStack{Button("seller_invitation_inbox"){seller.loadInvitationInbox()}.disabled(seller.busy);Spacer()}.padding(.horizontal,16)}
            if !seller.signedIn{signedOut}
            else if seller.invitationInboxVisible{SellerInvitationInbox()}
            else if seller.stores.isEmpty && seller.busy{ProgressView().frame(maxWidth:.infinity,maxHeight:.infinity)}
            else if seller.stores.isEmpty, SellerReadRefusal(rawValue: seller.state) != nil {
                Button("retry"){seller.refresh()}.buttonStyle(ShopButtonStyle(kind:.secondary))
                    .frame(maxWidth:.infinity,maxHeight:.infinity)
            }
            else if seller.stores.isEmpty{VStack(spacing:20){ContentUnavailableView("seller_no_stores",systemImage:"storefront",description:Text("seller_create_store_note"));Button("seller_create_store"){sheet = .createStore}.buttonStyle(ShopButtonStyle()).disabled(!seller.signedIn || seller.busy || seller.hasPending("create-store"))}.frame(maxWidth:.infinity,maxHeight:.infinity)}
            else if desktop{HStack(spacing:0){sidebar.frame(width:232);ShopTheme.border.frame(width:1);NavigationStack{page(section,desktop:true)}}}
            else{mobile}
        }.background(ShopTheme.background).foregroundStyle(ShopTheme.text).tint(ShopTheme.primary)
    }.sheet(item:$sheet){value in operation(value)}
    .onChange(of:seller.selectedStoreID){sheet=nil}
    .onChange(of:seller.signedIn){if !seller.signedIn{sheet=nil}}
    .frame(minWidth:320,minHeight:500)}
    @ViewBuilder private var originalActions:some View {
        Button("seller_recover_originals"){seller.recoverOriginals()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(seller.busy || !seller.signedIn)
        if seller.preparedOriginalCount>0{Button("seller_retry_prepared"){seller.retryPreparedOriginals()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(seller.busy || !seller.signedIn)}
    }
    private func header(desktop:Bool)->some View{VStack(spacing:12){
        HStack(spacing:16){Label("seller_workspace",systemImage:"storefront").shopFont(17,.semibold);if desktop{storePicker};Spacer(minLength:0);if desktop{sessionControls};Button("close"){dismiss()}.buttonStyle(ShopButtonStyle(kind:.quiet))}
        if !desktop && seller.signedIn{HStack{storePicker;Spacer(minLength:0);sessionControls}}
    }.padding(.horizontal,desktop ? 24:16).padding(.vertical,12).background(ShopTheme.surface).overlay(alignment:.bottom){ShopTheme.border.frame(height:1)}}
    @ViewBuilder private var storePicker:some View {
        if seller.signedIn && !seller.stores.isEmpty{Picker("seller_store",selection:Binding(get:{seller.selectedStoreID},set:{sheet=nil;seller.selectStore($0)})){ForEach(seller.stores){store in Text(verbatim:store.Name).tag(store.ID)}}.labelsHidden().frame(maxWidth:300).disabled(seller.busy)}
    }
    @ViewBuilder private var sessionControls:some View {
        if seller.busy{ProgressView().controlSize(.small)}
        if seller.signedIn{Button{seller.refresh()}label:{Image(systemName:"arrow.clockwise")}.buttonStyle(.plain).disabled(seller.busy).accessibilityLabel("retry");Menu{Button("seller_create_store"){sheet = .createStore}.disabled(seller.busy || seller.hasPending("create-store"));Divider();Button("seller_disconnect",role:.destructive){sheet=nil;seller.disconnect()}}label:{Image(systemName:"person.crop.circle.badge.checkmark")}.accessibilityLabel("seller_disconnect")}
    }
    private var signedOut:some View{VStack(spacing:20){Spacer();Image(systemName:"storefront").font(.system(size:40)).foregroundStyle(ShopTheme.primary);Text("seller_workspace").shopFont(28,.bold);Text("seller_authority_boundary").shopFont(14).foregroundStyle(ShopTheme.secondary).multilineTextAlignment(.center).frame(maxWidth:500);Button("seller_connect"){seller.connect()}.buttonStyle(ShopButtonStyle()).disabled(seller.busy);Spacer()}.padding(24).frame(maxWidth:.infinity)}
    private var sidebar:some View{ScrollView{VStack(alignment:.leading,spacing:6){ForEach(SellerSection.allCases){destination in Button{section=destination}label:{Label(destination.title,systemImage:destination.symbol).shopFont(14,.semibold).frame(maxWidth:.infinity,alignment:.leading).padding(12).foregroundStyle(section==destination ? ShopTheme.primary:ShopTheme.secondary).background(section==destination ? ShopTheme.subtle:Color.clear).clipShape(RoundedRectangle(cornerRadius:6))}.buttonStyle(.plain)};Divider().padding(.vertical,12);Text("seller_authority_boundary").shopFont(12).foregroundStyle(ShopTheme.secondary)}.padding(16)}.background(ShopTheme.surface)}
    private var mobile:some View{TabView{
        NavigationStack {
            page(section,desktop:false).toolbar {
                ToolbarItem(placement:.cancellationAction) {
                    if section != .overview {
                        Button{section = .overview}label:{Label("seller_workbench",systemImage:"chevron.backward")}
                    }
                }
            }
        }.tabItem{Label("seller_workbench",systemImage:"checklist")}
        NavigationStack{SellerOrdersList(desktop:false,mode:.orders,onAction:open)}.tabItem{Label("nav_orders",systemImage:"list.bullet.rectangle")}
        NavigationStack{SellerProductsList(desktop:false,onAction:open)}.tabItem{Label("seller_products",systemImage:"shippingbox")}
        NavigationStack{SellerMembersView(desktop:false,onAction:open)}.tabItem{Label("seller_members",systemImage:"storefront")}
    }}
    private func page(_ destination:SellerSection,desktop:Bool)->AnyView {AnyView(Group{switch destination {
    case .overview:SellerPage("seller_workbench",desktop:desktop){workbench;if !desktop{mobileDestinations}}
    case .products:SellerProductsList(desktop:desktop,onAction:open)
    case .inventory:SellerInventoryView(desktop:desktop,onAction:open)
    case .orders,.fulfillment,.aftersales:SellerOrdersList(desktop:desktop,mode:destination,onAction:open)
    case .reconciliation:SellerReconciliationView(desktop:desktop)
    case .members:SellerMembersView(desktop:desktop,onAction:open)
    case .audit:SellerAuditView(desktop:desktop)
    }})}
    private var workbench:some View{VStack(alignment:.leading,spacing:24){
        ShopSectionTitle(title:"seller_tasks")
        SellerLedger{
            SellerTaskRow(title:"seller_fulfillment",count:seller.sectionUnavailable.contains("orders") ? nil:seller.orders.filter{$0.StoreID==seller.selectedStoreID && $0.Status=="paid"}.count,symbol:"truck.box"){section = .fulfillment};Divider()
            SellerTaskRow(title:"seller_aftersales",count:seller.sectionUnavailable.contains("orders") ? nil:seller.orders.filter{$0.StoreID==seller.selectedStoreID && ["return_requested","refund_requested","disputed"].contains($0.Status)}.count,symbol:"arrow.uturn.backward"){section = .aftersales};Divider()
            SellerTaskRow(title:"seller_payment_unresolved",count:seller.sectionUnavailable.contains("orders") ? nil:seller.orders.filter{$0.StoreID==seller.selectedStoreID && sellerPaymentNeedsReview($0)}.count,symbol:"clock.arrow.circlepath"){section = .reconciliation};Divider()
            SellerTaskRow(title:"seller_inventory",count:zeroStockCount,symbol:"square.stack.3d.up"){section = .inventory}
        }
        if seller.sectionUnavailable.contains("orders") || seller.sectionUnavailable.contains("products"){ShopNotice(title:"seller_section_unavailable",symbol:"lock",warning:true)}
        Text("seller_no_inferred_metrics").shopFont(12).foregroundStyle(ShopTheme.secondary)
        ShopSectionTitle(title:"seller_recent_activity")
        Text("seller_audit_scope").shopFont(12).foregroundStyle(ShopTheme.secondary)
        SellerAuditRows(events:Array(seller.audit.prefix(8)))
    }}
    private var zeroStockCount:Int? {
        guard !seller.sectionUnavailable.contains("products") else{return nil}
        let variants=seller.products.filter{$0.StoreID==seller.selectedStoreID}.flatMap(\.Variants)
        guard variants.allSatisfy({$0.Inventory>=0 && $0.Reserved>=0 && $0.Reserved<=$0.Inventory}) else{return nil}
        return variants.filter{$0.available==0}.count
    }
    private var mobileDestinations:some View{VStack(alignment:.leading,spacing:16){
        ForEach([SellerSection.inventory,.fulfillment,.aftersales,.reconciliation,.audit]){destination in NavigationLink{page(destination,desktop:false)}label:{Label(destination.title,systemImage:destination.symbol).shopFont(14).padding(.vertical,8)}}
    }}
    private func open(_ value:SellerSheet){sheet=value}
    @ViewBuilder private func operation(_ value:SellerSheet)->some View{switch value {
    case .listing(let id):if let product=seller.products.first(where:{$0.ID==id && $0.StoreID==seller.selectedStoreID}){SellerListingEditor(product:product,draft:seller.draft(for:product))}else{SellerEmpty()}
    case .inventory(let productID,let variantID):if let product=seller.products.first(where:{$0.ID==productID && $0.StoreID==seller.selectedStoreID}),let variant=product.Variants.first(where:{$0.ID==variantID}){SellerInventoryEditor(product:product,variant:variant)}else{SellerEmpty()}
    case .ship(let id):if let order=seller.orders.first(where:{$0.ID==id && $0.StoreID==seller.selectedStoreID}){SellerShipForm(order:order)}else{SellerEmpty()}
    case .returnDecision(let id,let approve):if let order=seller.orders.first(where:{$0.ID==id && $0.StoreID==seller.selectedStoreID}){SellerReturnForm(order:order,approve:approve)}else{SellerEmpty()}
    case .revoke(let account):if let member=seller.members.first(where:{$0.Account==account}){SellerRevokeForm(member:member)}else{SellerEmpty()}
    case .createStore:SellerCreateStoreForm()
    case .createProduct:SellerCreateProductForm()
    case .activateStore:if let store=seller.stores.first(where:{$0.ID==seller.selectedStoreID}){SellerActivateStoreForm(store:store)}else{SellerEmpty()}
    case .invite:SellerInviteForm()
    case .editStore(let snapshot):SellerStoreProfileEditor(snapshot:snapshot)
    }}
}

private struct SellerProductThumbnail:View {
    let product:SellerProduct
    var body:some View{Group{if let media=product.Media?.first(where:{$0.imageURL != nil}),let url=media.imageURL{AsyncImage(url:url){phase in if let image=phase.image{image.resizable().scaledToFit()}else{Image(systemName:"photo").foregroundStyle(ShopTheme.muted)}}.accessibilityLabel(media.altText ?? product.Title)}else{Image(systemName:"photo").foregroundStyle(ShopTheme.muted).accessibilityLabel(product.Title)}}.frame(width:56,height:56).background(ShopTheme.tertiary).clipShape(RoundedRectangle(cornerRadius:6))}
}
private struct SellerProductsList:View {
    @EnvironmentObject var seller:ShopSellerModel
    @Environment(\.locale) private var locale
    let desktop:Bool
    let onAction:(SellerSheet)->Void
    @State private var query=""
    @State private var filter="all"
    private var products:[SellerProduct]{seller.products.filter{$0.StoreID==seller.selectedStoreID && (filter=="all" || (filter=="published")==$0.Published) && (query.isEmpty || $0.Title.localizedCaseInsensitiveContains(query) || $0.ID.localizedCaseInsensitiveContains(query) || $0.Variants.contains{$0.SKU.localizedCaseInsensitiveContains(query)})}}
    var body:some View{SellerPage("seller_products",desktop:desktop){
        HStack{TextField("seller_search_product",text:$query).textFieldStyle(.roundedBorder);Picker("seller_listing_state",selection:$filter){Text("seller_all_states").tag("all");Text("seller_published").tag("published");Text("seller_unpublished").tag("draft")}.pickerStyle(.menu)}
        HStack{Spacer();Button{onAction(.createProduct)}label:{Label("seller_create_product",systemImage:"plus")}.buttonStyle(ShopButtonStyle()).disabled(!seller.can("catalog.write") || seller.busy || seller.hasPending("create-product"))}
        if seller.sectionUnavailable.contains("products"){ShopNotice(title:"seller_section_unavailable",symbol:"lock",warning:true)}
        else if products.isEmpty{SellerEmpty()}
        else{SellerLedger{
            if desktop{ScrollView(.horizontal){VStack(spacing:0){
                HStack{Text("seller_products").frame(maxWidth:.infinity,alignment:.leading);Text("seller_category").frame(width:110,alignment:.leading);Text("seller_price").frame(width:135,alignment:.leading);Text("seller_available").frame(width:90);Text("seller_listing_state").frame(width:100);Text("seller_actions").frame(width:80)}.shopFont(12,.semibold).foregroundStyle(ShopTheme.secondary).padding(16).background(ShopTheme.tertiary)
                ForEach(products){product in Divider();HStack(spacing:16){productLabel(product).frame(maxWidth:.infinity,alignment:.leading);Text(verbatim:product.Category).frame(width:110,alignment:.leading).lineLimit(2);Text(price(product)).monospacedDigit().frame(width:135,alignment:.leading);Text(available(product)).monospacedDigit().frame(width:90);Text(product.Published ? "seller_published":"seller_unpublished").frame(width:100);Button("seller_edit"){onAction(.listing(product.ID))}.buttonStyle(ShopButtonStyle(kind:.secondary)).frame(width:80).disabled(!seller.can("catalog.write") || seller.busy )}.shopFont(13).padding(16)}
            }.frame(minWidth:900)}}
            else{ForEach(products){product in HStack(alignment:.top,spacing:12){productLabel(product);Spacer(minLength:0);Button("seller_edit"){onAction(.listing(product.ID))}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!seller.can("catalog.write") || seller.busy )}.padding(16);HStack{Text(price(product)).shopFont(15,.semibold);Spacer();Text(product.Published ? "seller_published":"seller_unpublished").shopFont(12)}.padding(.horizontal,16).padding(.bottom,16);Divider()}}
        }}
    }}
    private func productLabel(_ product:SellerProduct)->some View{HStack(spacing:12){SellerProductThumbnail(product:product);VStack(alignment:.leading,spacing:6){Text(verbatim:product.Title).shopFont(14,.semibold).lineLimit(2);Text(verbatim:product.ID).font(.caption.monospaced()).foregroundStyle(ShopTheme.secondary).lineLimit(1);if !desktop{HStack{Text("seller_available");Text(available(product))}.shopFont(12).foregroundStyle(ShopTheme.secondary)}}}}
    private func price(_ product:SellerProduct)->String{product.Variants.map(\.PriceYNXT).min().map{ShopMoneyDisplay.legacyYNXT($0,locale:locale)} ?? String(localized:"unavailable")}
    private func available(_ product:SellerProduct)->String{var n:Int64=0;for variant in product.Variants{guard variant.Inventory>=0,variant.Reserved>=0,variant.Reserved<=variant.Inventory else{return String(localized:"unavailable")};let next=n.addingReportingOverflow(variant.available);guard !next.overflow else{return String(localized:"unavailable")};n=next.partialValue};return n.formatted()}
}
private struct SellerInventoryView:View {
    @EnvironmentObject var seller:ShopSellerModel
    let desktop:Bool
    let onAction:(SellerSheet)->Void
    @State private var query=""
    private var products:[SellerProduct]{seller.products.filter{$0.StoreID==seller.selectedStoreID && (query.isEmpty || $0.Title.localizedCaseInsensitiveContains(query) || $0.Variants.contains{$0.SKU.localizedCaseInsensitiveContains(query)})}}
    var body:some View{SellerPage("seller_inventory",subtitle:"seller_inventory_note",desktop:desktop){
        TextField("seller_search_product",text:$query).textFieldStyle(.roundedBorder)
        if seller.sectionUnavailable.contains("products"){ShopNotice(title:"seller_section_unavailable",symbol:"lock",warning:true)}
        else if products.isEmpty{SellerEmpty()}
        else{SellerLedger{ForEach(products){product in
            HStack(spacing:12){SellerProductThumbnail(product:product);VStack(alignment:.leading,spacing:6){Text(verbatim:product.Title).shopFont(15,.semibold);Text(verbatim:product.ID).font(.caption.monospaced()).foregroundStyle(ShopTheme.secondary)};Spacer();Text(String(product.Revision)).font(.caption.monospaced()).accessibilityLabel("seller_revision")}.padding(16).background(ShopTheme.tertiary)
            ForEach(product.Variants){variant in VStack(alignment:.leading,spacing:14){
                HStack(alignment:.top){VStack(alignment:.leading,spacing:6){Text(verbatim:variant.Name).shopFont(14,.semibold);Text(verbatim:variant.SKU).font(.caption.monospaced()).foregroundStyle(ShopTheme.secondary)};Spacer();Button("seller_adjust_inventory"){onAction(.inventory(product.ID,variant.ID))}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!seller.can("inventory.write") || seller.busy || seller.hasPending(product.ID))}
                ViewThatFits(in:.horizontal){HStack(spacing:32){counts(variant)};VStack(alignment:.leading,spacing:10){counts(variant)}}
            }.padding(16);Divider()}
        }}}
        ShopSectionTitle(title:"seller_inventory_history")
        SellerAuditRows(events:seller.audit.filter{event in event.Action.localizedCaseInsensitiveContains("inventory") && (event.ObjectID==seller.selectedStoreID || products.contains(where:{$0.ID==event.ObjectID}))})
    }}
    @ViewBuilder private func counts(_ variant:SellerVariant)->some View{SellerValue(title:"seller_total_inventory",value:variant.Inventory.formatted());SellerValue(title:"seller_reserved",value:variant.Reserved.formatted());SellerValue(title:"seller_available",value:variant.Inventory>=variant.Reserved && variant.Reserved>=0 ? variant.available.formatted():String(localized:"unavailable"))}
}

private struct SellerOrdersList:View {
    @EnvironmentObject var seller:ShopSellerModel
    @Environment(\.locale) private var locale
    let desktop:Bool
    let mode:SellerSection
    let onAction:(SellerSheet)->Void
    @State private var query=""
    @State private var filter="all"
    private var orders:[SellerOrder]{seller.orders.filter{order in
        guard order.StoreID==seller.selectedStoreID,query.isEmpty || order.ID.localizedCaseInsensitiveContains(query) || order.Buyer.localizedCaseInsensitiveContains(query) else{return false}
        let scope=mode == .fulfillment ? "fulfillment":mode == .aftersales ? "aftersales":filter
        switch scope{case "fulfillment":return order.Status=="paid" || order.Shipment != nil;case "aftersales":return order.Resolution != nil || !order.RefundStatus.isEmpty;case "pending":return sellerPaymentNeedsReview(order);default:return true}
    }}
    var body:some View{SellerPage(mode.title,subtitle:"seller_order_states_note",desktop:desktop){
        TextField("shop_order_search",text:$query).textFieldStyle(.roundedBorder)
        if mode == .orders{Picker("nav_orders",selection:$filter){Text("shop_all_orders").tag("all");Text("seller_fulfillment").tag("fulfillment");Text("payment_pending").tag("pending");Text("seller_aftersales").tag("aftersales")}.pickerStyle(.segmented)}
        if seller.sectionUnavailable.contains("orders"){ShopNotice(title:"seller_section_unavailable",symbol:"lock",warning:true)}
        else if orders.isEmpty{SellerEmpty()}
        else{SellerLedger{
            if desktop{ScrollView(.horizontal){VStack(spacing:0){
                HStack{Text("nav_orders").frame(maxWidth:.infinity,alignment:.leading);Text("seller_principal").frame(width:140,alignment:.leading);Text("seller_payment_evidence").frame(width:150,alignment:.leading);Text("seller_fulfillment").frame(width:110,alignment:.leading);Text("seller_aftersales").frame(width:150,alignment:.leading);Text("seller_actions").frame(width:90)}.shopFont(12,.semibold).foregroundStyle(ShopTheme.secondary).padding(16).background(ShopTheme.tertiary)
                ForEach(orders){order in Divider();HStack(alignment:.top,spacing:16){NavigationLink{SellerOrderDetail(orderID:order.ID,desktop:desktop,onAction:onAction)}label:{VStack(alignment:.leading,spacing:8){Text(verbatim:order.ID).font(.caption.monospaced());Text(verbatim:order.Buyer).font(.caption.monospaced()).foregroundStyle(ShopTheme.secondary);SellerState(status:order.Status)}}.frame(maxWidth:.infinity,alignment:.leading);Text(buyerOrderTotal(order.paymentOrder,locale:locale) ?? String(localized:"unavailable")).frame(width:140,alignment:.leading).monospacedDigit();SellerPaymentState(order:order).frame(width:150,alignment:.leading);SellerState(status:order.Shipment?.Status ?? "unavailable").frame(width:110,alignment:.leading);SellerState(status:order.Resolution?.Status ?? (order.RefundStatus.isEmpty ? "unavailable":order.RefundStatus)).frame(width:150,alignment:.leading);NavigationLink{SellerOrderDetail(orderID:order.ID,desktop:desktop,onAction:onAction)}label:{Text("shop_order_details")}.buttonStyle(ShopButtonStyle(kind:.secondary)).frame(width:90)}.shopFont(13).padding(16)}
            }.frame(minWidth:1050)}}
            else{ForEach(orders){order in VStack(alignment:.leading,spacing:14){HStack{Text(verbatim:order.ID).font(.caption.monospaced()).lineLimit(1);Spacer();SellerState(status:order.Status)};ForEach(order.Lines){line in Text(verbatim:line.Title+" × "+String(line.Quantity)).shopFont(14,.semibold)};Text(buyerOrderTotal(order.paymentOrder,locale:locale) ?? String(localized:"unavailable")).shopFont(17,.bold);SellerPaymentState(order:order);SellerValue(title:"seller_fulfillment",value:order.Shipment?.Status ?? String(localized:"unavailable"));NavigationLink{SellerOrderDetail(orderID:order.ID,desktop:desktop,onAction:onAction)}label:{Text("shop_order_details")}.buttonStyle(ShopButtonStyle(kind:.secondary))}.padding(16);Divider()}}
        }}
        ShopNotice(title:"seller_unknown_warning",symbol:"clock.arrow.circlepath",warning:true)
    }}
}
private struct SellerOrderDetail:View {
    @EnvironmentObject var seller:ShopSellerModel
    @Environment(\.locale) private var locale
    let orderID:String
    let desktop:Bool
    let onAction:(SellerSheet)->Void
    private var current:SellerOrder?{seller.orders.first{$0.ID==orderID && $0.StoreID==seller.selectedStoreID}}
    var body:some View{SellerPage("shop_order_details",desktop:desktop){
        if let order=current {
            SellerLedger{VStack(alignment:.leading,spacing:16){Text(verbatim:order.ID).font(.caption.monospaced()).textSelection(.enabled);SellerState(status:order.Status);Text(buyerOrderTotal(order.paymentOrder,locale:locale) ?? String(localized:"unavailable")).shopFont(28,.bold);HStack{Text("seller_payment_evidence").shopFont(13).foregroundStyle(ShopTheme.secondary);Spacer();SellerPaymentState(order:order)};SellerValue(title:"seller_fulfillment",value:order.Shipment?.Status ?? String(localized:"unavailable"));if !order.RefundStatus.isEmpty{SellerState(status:order.RefundStatus)}}.padding(20)}
            Button("seller_read_original_order"){seller.readOriginalOrder(order)}
                .buttonStyle(ShopButtonStyle(kind:.secondary))
                .disabled(!seller.signedIn || seller.busy)
            SellerTargetRecovery(target:order.ID)
            if desktop{HStack(alignment:.top,spacing:24){terms(order).frame(maxWidth:.infinity);buyer(order).frame(width:320)}}else{terms(order);buyer(order)}
            SellerLedger{VStack(alignment:.leading,spacing:16){Text("seller_fulfillment").shopFont(17,.semibold);if let shipment=order.Shipment{SellerValue(title:"seller_carrier",value:shipment.Carrier);SellerValue(title:"seller_tracking",value:shipment.TrackingNumber);SellerState(status:shipment.Status)};Button("seller_ship"){onAction(.ship(order.ID))}.buttonStyle(ShopButtonStyle()).disabled(!seller.can("fulfillment.write") || order.Status != "paid" || (sellerIsNativePayment(order) && (sellerPaymentNeedsReview(order) || order.paymentDisplayState=="native_refunded")) || seller.busy || seller.hasPending(order.ID));ShopNotice(title:"seller_fulfillment_boundary")}.padding(20)}
            if let resolution=order.Resolution{SellerLedger{VStack(alignment:.leading,spacing:14){Text("seller_aftersales").shopFont(17,.semibold);SellerState(status:resolution.Status);Text(verbatim:resolution.Reason).shopFont(14);Text(verbatim:resolution.Explanation).shopFont(13);if order.Status=="return_requested",order.originalReturnID != nil{HStack{Button("seller_approve_return"){onAction(.returnDecision(order.ID,true))}.buttonStyle(ShopButtonStyle());Button("seller_reject_return"){onAction(.returnDecision(order.ID,false))}.buttonStyle(ShopButtonStyle(kind:.secondary))}.disabled(!seller.can("returns.resolve") || seller.busy || seller.hasPending(order.ID))};ShopNotice(title:"seller_refund_boundary")}.padding(20)}}
            if !order.approvedReturnIDs.isEmpty || !(order.ReturnReceipts ?? []).isEmpty{SellerWarehouseView(order:order)}
            if sellerIsNativePayment(order){SellerNativePaymentRecord(order:order);SellerRefundReviewForm(order:order)}
            else if let settlement=order.Settlement{SellerSettlementRecord(settlement:settlement)}
            if !sellerIsNativePayment(order),let refund=order.Refund{SellerLedger{VStack(alignment:.leading,spacing:12){Text("seller_refund_record").shopFont(17,.semibold);SellerState(status:refund.Status);SellerValue(title:"seller_reference",value:refund.ID);SellerValue(title:"seller_principal",value:sellerMoney(refund.AmountYNXT,currency:refund.Currency,locale:locale));SellerValue(title:"seller_transaction_hash",value:refund.TransactionHash);SellerValue(title:"seller_block",value:String(refund.BlockHeight));Text("seller_finance_read_only").shopFont(12).foregroundStyle(ShopTheme.secondary)}.padding(20)}}
            ShopSectionTitle(title:"seller_order_events")
            SellerLedger{ForEach(order.Timeline){event in VStack(alignment:.leading,spacing:8){HStack{SellerState(status:event.Status);Spacer();Text(verbatim:event.At).shopFont(12).foregroundStyle(ShopTheme.secondary)};Text(verbatim:event.Action).font(.caption.monospaced());if !event.Detail.isEmpty{Text(verbatim:event.Detail).shopFont(13)};Text(verbatim:event.ID).font(.caption.monospaced()).foregroundStyle(ShopTheme.secondary)}.padding(16);Divider()}}
        }else{SellerEmpty()}
    }.navigationTitle("shop_order_details").shopInlineTitle()}
    private func terms(_ order:SellerOrder)->some View{SellerLedger{VStack(alignment:.leading,spacing:16){Text("seller_original_terms").shopFont(17,.semibold);ForEach(order.Lines){line in VStack(alignment:.leading,spacing:8){Text(verbatim:line.Title).shopFont(15,.semibold);Text(verbatim:line.VariantName+" × "+String(line.Quantity)).shopFont(13).foregroundStyle(ShopTheme.secondary);Text(sellerOrderLineAmount(line,order:order,locale:locale)).shopFont(15,.semibold);Divider()}};SellerValue(title:"seller_principal",value:sellerOrderComponent(order,kind:"subtotal",locale:locale));SellerValue(title:"seller_shipping_amount",value:sellerOrderComponent(order,kind:"shipping",locale:locale));SellerValue(title:"seller_tax_amount",value:sellerOrderComponent(order,kind:"tax",locale:locale));Text("seller_network_fee_unavailable").shopFont(12).foregroundStyle(ShopTheme.secondary)}.padding(20)}}
    private func buyer(_ order:SellerOrder)->some View{SellerLedger{VStack(alignment:.leading,spacing:16){Text("seller_buyer").shopFont(17,.semibold);Text(verbatim:order.Buyer).font(.caption.monospaced()).textSelection(.enabled);Divider();Text(verbatim:order.Address.Recipient).shopFont(14,.semibold);Text(verbatim:[order.Address.Line1,order.Address.City,order.Address.Region,order.Address.PostalCode,order.Address.Country].filter{!$0.isEmpty}.joined(separator:"\n")).shopFont(13).textSelection(.enabled)}.padding(20)}}
}
private func sellerMoney(_ amount:Int64,currency:String,locale:Locale)->String{guard currency==ShopMoneyDisplay.legacySymbol,amount>=0 else{return String(localized:"unavailable",locale:locale)};return ShopMoneyDisplay.legacyYNXT(amount,locale:locale)}
private struct SellerState:View {
    let status:String
    private let known:Set<String>=["paid","shipped","delivered","reviewed","cancelled","return_requested","return_approved","return_rejected","refund_requested","refund_approved","refund_rejected","refunded","disputed","failed","rejected","payment_pending","review_required","applied_draft","recorded_by_authoritative_pay","requested_no_transfer","approved_pending_authoritative_pay_refund","rejected_no_transfer","unavailable"]
    var body:some View{Group{if known.contains(status){Text(LocalizedStringKey(status))}else{Text(verbatim:status)}}.shopFont(12,.semibold).foregroundStyle(ShopTheme.secondary).padding(.horizontal,8).padding(.vertical,5).background(ShopTheme.tertiary).clipShape(RoundedRectangle(cornerRadius:6))}
}

private struct SellerReconciliationView:View {
    @EnvironmentObject var seller:ShopSellerModel
    let desktop:Bool
    private var nativeOrders:[SellerOrder]{seller.orders.filter{$0.StoreID==seller.selectedStoreID && sellerIsNativePayment($0)}}
    private var related:[SellerSettlement]{let ids=Set(seller.orders.filter{$0.StoreID==seller.selectedStoreID && !sellerIsNativePayment($0)}.map(\.InvoiceID).filter{!$0.isEmpty});return seller.settlements.filter{ids.contains($0.InvoiceID)}}
    private var unresolved:[SellerOrder]{seller.orders.filter{$0.StoreID==seller.selectedStoreID && sellerPaymentNeedsReview($0)}}
    var body:some View{SellerPage("seller_reconciliation",subtitle:"seller_finance_read_only",desktop:desktop){
        ShopNotice(title:"seller_network_fee_unavailable")
        if seller.sectionUnavailable.contains("settlements") || seller.sectionUnavailable.contains("orders"){ShopNotice(title:"seller_section_unavailable",symbol:"lock",warning:true)}
        ShopSectionTitle(title:"seller_payment_unresolved")
        if unresolved.isEmpty{SellerEmpty(symbol:"checklist")}
        else{SellerLedger{ForEach(unresolved){order in VStack(alignment:.leading,spacing:10){Text(verbatim:order.ID).font(.caption.monospaced()).textSelection(.enabled);SellerPaymentState(order:order);SellerValue(title:"shop_invoice_reference",value:order.InvoiceID);SellerValue(title:"shop_original_operation",value:order.PayIntentID);Text("seller_unknown_warning").shopFont(12).foregroundStyle(ShopTheme.warning)}.padding(16);Divider()}}}
        ShopSectionTitle(title:"seller_native_receipts")
        if nativeOrders.isEmpty{SellerEmpty(symbol:"doc.text.magnifyingglass")}
        ForEach(nativeOrders){order in SellerNativePaymentRecord(order:order)}
        ShopSectionTitle(title:"seller_payment_evidence")
        if related.isEmpty{SellerEmpty(symbol:"list.bullet.clipboard")}
        ForEach(related){settlement in SellerSettlementRecord(settlement:settlement)}
        Text("seller_settlement_scope").shopFont(12).foregroundStyle(ShopTheme.secondary)
    }}
}
private struct SellerSettlementRecord:View {
    @Environment(\.locale) private var locale
    let settlement:SellerSettlement
    var body:some View{SellerLedger{VStack(alignment:.leading,spacing:14){
        HStack{Text(verbatim:settlement.InvoiceID).font(.caption.monospaced()).textSelection(.enabled);Spacer();SellerState(status:settlement.Status)}
        Text(sellerMoney(settlement.AmountYNXT,currency:settlement.Currency,locale:locale)).shopFont(22,.bold).monospacedDigit()
        SellerValue(title:"shop_original_operation",value:settlement.IntentID)
        SellerValue(title:"seller_transaction_hash",value:settlement.TransactionHash)
        SellerValue(title:"seller_block",value:String(settlement.BlockHeight))
        SellerValue(title:"seller_payout_address",value:settlement.PayoutAddress)
        SellerValue(title:"seller_audit_hash",value:settlement.AuditHash)
        SellerValue(title:"seller_recorded_at",value:settlement.ConfirmedAt)
        Text("seller_finance_read_only").shopFont(12).foregroundStyle(ShopTheme.secondary)
    }.padding(20)}}
}
private struct SellerMembersView:View {
    @EnvironmentObject var seller:ShopSellerModel
    let desktop:Bool
    let onAction:(SellerSheet)->Void
    private var store:SellerStore?{seller.stores.first{$0.ID==seller.selectedStoreID}}
    var body:some View{SellerPage("seller_members",desktop:desktop){
        if let store{SellerLedger{VStack(alignment:.leading,spacing:16){Text(verbatim:store.Name).shopFont(22,.bold);SellerValue(title:"seller_store",value:store.ID);SellerValue(title:"seller_role",value:seller.storeRole);SellerState(status:store.Status);Text(verbatim:store.Description).shopFont(14);Divider();SellerValue(title:"seller_payout_address",value:store.SettlementAccount);SellerValue(title:"seller_store_policy",value:store.Policy);SellerValue(title:"seller_trust_reference",value:store.TrustURL);Text("seller_store_profile_edit_note").shopFont(12).foregroundStyle(ShopTheme.secondary)
            Button("seller_edit_store_profile"){onAction(.editStore(store))}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!seller.canManageMembers || seller.busy || seller.hasPending(store.ID))
            if store.Status != "active"{Button("seller_activate_store"){onAction(.activateStore)}.buttonStyle(ShopButtonStyle()).disabled(!seller.canManageMembers || seller.busy || seller.hasPending(store.ID) || store.UpdatedAt==nil)}
            if store.Status != "active" && store.UpdatedAt==nil{Text("seller_activation_snapshot_missing").shopFont(12).foregroundStyle(ShopTheme.warning)}
            if store.Status != "active" && store.Policy.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty{Text("seller_activation_policy_required").shopFont(12).foregroundStyle(ShopTheme.warning)}}.padding(20)}}
        ShopSectionTitle(title:"seller_members")
        if seller.sectionUnavailable.contains("members"){ShopNotice(title:"seller_section_unavailable",symbol:"lock",warning:true)}
        else if seller.members.isEmpty{SellerEmpty(symbol:"person.2")}
        else{SellerLedger{ForEach(seller.members){member in HStack(alignment:.top,spacing:16){Image(systemName:"person.crop.circle").font(.title2).foregroundStyle(ShopTheme.secondary);VStack(alignment:.leading,spacing:8){Text(verbatim:member.Account).font(.caption.monospaced()).textSelection(.enabled);SellerValue(title:"seller_role",value:member.Role)};Spacer(minLength:0);Button("seller_revoke",role:.destructive){onAction(.revoke(member.Account))}.buttonStyle(ShopButtonStyle(kind:.destructive)).disabled(!seller.canManageMembers || member.Role=="owner" || seller.busy || seller.hasPending(member.Account))}.padding(16);Divider()}}}
        ShopSectionTitle(title:"seller_revocation_records")
        SellerLedger{ForEach(seller.revocations.filter{$0.StoreID==seller.selectedStoreID}){record in VStack(alignment:.leading,spacing:12){
            SellerValue(title:"seller_member_account",value:record.Account)
            SellerValue(title:"seller_reference",value:record.ID)
            SellerValue(title:"seller_session_revocation",value:record.SessionStatus)
            SellerValue(title:"seller_session_reference",value:record.SessionRevocationID)
            SellerValue(title:"seller_session_count",value:String(record.SessionCount))
            SellerValue(title:"seller_revoke_reason",value:record.Reason)
            if !record.LastError.isEmpty{Text(verbatim:record.LastError).shopFont(12).foregroundStyle(ShopTheme.warning)}
            Text("seller_revoke_warning").shopFont(12).foregroundStyle(ShopTheme.secondary)
        }.padding(16);Divider()}}
        HStack{Button("seller_invite_member"){onAction(.invite)}.buttonStyle(ShopButtonStyle()).disabled(!seller.canManageMembers || seller.busy);Spacer()}
        ShopSectionTitle(title:"seller_invitations")
        SellerInvitationRows()
        Text("seller_authority_boundary").shopFont(12).foregroundStyle(ShopTheme.secondary)
    }}
}
private struct SellerAuditView:View {
    @EnvironmentObject var seller:ShopSellerModel
    let desktop:Bool
    var body:some View{SellerPage("seller_audit",subtitle:"seller_audit_scope",desktop:desktop){if seller.sectionUnavailable.contains("audit"){ShopNotice(title:"seller_section_unavailable",symbol:"lock",warning:true)}else{SellerAuditRows(events:seller.audit)}}}
}
private struct SellerAuditRows:View {
    let events:[SellerAudit]
    var body:some View{if events.isEmpty{SellerEmpty(symbol:"clock.arrow.circlepath")}else{SellerLedger{ForEach(events){event in DisclosureGroup{VStack(alignment:.leading,spacing:12){SellerValue(title:"seller_reference",value:event.ID);SellerValue(title:"seller_actor",value:event.Actor);SellerValue(title:"seller_role",value:event.Role);SellerValue(title:"seller_object",value:event.ObjectType+": "+event.ObjectID);Text(verbatim:event.Detail).shopFont(13).textSelection(.enabled)}.padding(.top,12)}label:{HStack(alignment:.top,spacing:16){VStack(alignment:.leading,spacing:6){Text(verbatim:event.Action).shopFont(14,.semibold);Text(verbatim:event.At).shopFont(12).foregroundStyle(ShopTheme.secondary)};Spacer();SellerState(status:event.Outcome)}}.padding(16);Divider()}}}}
}

private struct SellerListingEditor:View {
    @EnvironmentObject var seller:ShopSellerModel
    let product:SellerProduct
    @State private var draft:SellerListingDraft
    @State private var reviewed=false
    @State private var submitted=false
    @State private var reloadConfirmation=false
    @State private var localSaveRequested=false
    init(product:SellerProduct,draft:SellerListingDraft){self.product=product;_draft=State(initialValue:draft)}
    private var inputValid:Bool{
        guard sellerRequiredText(draft.title,160),draft.description.utf8.count<=5000,draft.category.utf8.count<=80,(1...50).contains(draft.variants.count),Set(draft.variants.map(\.SKU)).count==draft.variants.count else{return false}
        for variant in draft.variants{guard sellerRequiredText(variant.Name,120),sellerRequiredText(variant.SKU,80),sellerCanonicalInteger(variant.PriceYNXT,positive:true) != nil,let inventory=sellerCanonicalInteger(variant.Inventory),inventory >= (product.Variants.first{$0.ID==variant.ID}?.Reserved ?? 0) else{return false}}
        for variant in draft.variants {if let price=variant.nativePrice {
            guard sellerNativeIdentityValid(genesis:price.genesis,chain:price.nativeChainID),sellerCanonicalUInt64(price.amountAtoms,positive:true),price.assetID=="YNXT",price.unitVersion=="1" else{return false}
        }}
        return true
    }
    private var valid:Bool{inputValid && seller.products.first(where:{$0.ID==product.ID})?.Revision==Int64(draft.expectedRevision)}
    private var reviewContent:[String]{[draft.title,draft.description,draft.category]+draft.variants.flatMap{[$0.ID,$0.Name,$0.SKU,$0.PriceYNXT,$0.Inventory]+sellerNativePriceFields($0.nativePrice)}}
    var body:some View{SellerOperationSheet("seller_edit_product"){
        SellerValue(title:"seller_reference",value:product.ID);SellerValue(title:"seller_revision",value:draft.expectedRevision)
        if seller.products.first(where:{$0.ID==product.ID})?.Revision != Int64(draft.expectedRevision){ShopNotice(title:"seller_revision_changed",warning:true)}
        SellerField(title:"seller_product_title",text:$draft.title);SellerField(title:"seller_description",text:$draft.description,multiline:true);SellerField(title:"seller_category",text:$draft.category)
        ShopSectionTitle(title:"seller_variants")
        ForEach(draft.variants.indices,id:\.self){index in SellerLedger{VStack(alignment:.leading,spacing:14){
            if !draft.variants[index].ID.isEmpty{Text(verbatim:draft.variants[index].ID).font(.caption.monospaced()).foregroundStyle(ShopTheme.secondary)}
            SellerField(title:"seller_variant_name",text:$draft.variants[index].Name);SellerField(title:"seller_sku",text:$draft.variants[index].SKU);SellerField(title:"seller_price",text:$draft.variants[index].PriceYNXT);SellerField(title:"seller_total_inventory",text:$draft.variants[index].Inventory)
            SellerNativePriceEditor(price:$draft.variants[index].nativePrice)
            Button("seller_remove_variant",role:.destructive){draft.variants.remove(at:index);reviewed=false}.buttonStyle(.plain).disabled(draft.variants.count<=1 || (product.Variants.first{$0.ID==draft.variants[index].ID}?.Reserved ?? 0)>0)
        }.padding(16)}}
        Button("seller_add_variant"){draft.variants.append(SellerVariantDraft());reviewed=false}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(draft.variants.count>=50 || submitted)
        ShopNotice(title:"seller_local_draft_note")
        Button("seller_save_local_draft"){localSaveRequested=true;seller.saveLocalDraft(draft)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!inputValid || !seller.can("catalog.write") || seller.busy || seller.hasPending(product.ID))
        Button("seller_reload_listing"){reloadConfirmation=true}.buttonStyle(.plain)
        if localSaveRequested && !submitted && ["seller_local_draft_saved","seller_local_draft_failed"].contains(seller.state){Text(LocalizedStringKey(seller.state)).shopFont(12).foregroundStyle(ShopTheme.secondary)}
        Text("seller_publish_boundary").shopFont(12).foregroundStyle(ShopTheme.secondary)
        Toggle("seller_review_changes",isOn:$reviewed).shopFont(13)
        Button("seller_publish"){submitted=true;seller.perform(.publish(draft))}.buttonStyle(ShopButtonStyle()).disabled(!valid || !reviewed || submitted || !seller.can("catalog.write") || seller.busy || seller.hasPending(product.ID))
        SellerFormResult(submitted:submitted)
    }.onChange(of:reviewContent){reviewed=false;localSaveRequested=false}.disabled(seller.busy).confirmationDialog("seller_reload_listing_confirmation",isPresented:$reloadConfirmation,titleVisibility:.visible){Button("seller_reload_listing",role:.destructive){draft=SellerListingDraft(product);reviewed=false;submitted=false;localSaveRequested=false};Button("cancel",role:.cancel){}}
    }
}
private struct SellerInventoryEditor:View {
    @EnvironmentObject var seller:ShopSellerModel
    let product:SellerProduct
    let variant:SellerVariant
    @State private var inventory:String
    @State private var expectedRevision:String
    @State private var reviewed=false
    @State private var submitted=false
    init(product:SellerProduct,variant:SellerVariant){self.product=product;self.variant=variant;_inventory=State(initialValue:String(variant.Inventory));_expectedRevision=State(initialValue:String(product.Revision))}
    private var valid:Bool{guard let number=sellerCanonicalInteger(inventory),number>=variant.Reserved,number != variant.Inventory else{return false};return seller.products.first{$0.ID==product.ID}?.Revision==Int64(expectedRevision)}
    var body:some View{SellerOperationSheet("seller_adjust_inventory"){
        Text(verbatim:product.Title).shopFont(17,.semibold);Text(verbatim:variant.Name).shopFont(14);SellerValue(title:"seller_sku",value:variant.SKU);SellerValue(title:"seller_revision",value:expectedRevision);SellerValue(title:"seller_reserved",value:String(variant.Reserved));SellerValue(title:"seller_available",value:String(variant.available))
        if seller.products.first(where:{$0.ID==product.ID})?.Revision != Int64(expectedRevision){ShopNotice(title:"seller_revision_changed",warning:true)}
        SellerField(title:"seller_total_inventory",text:$inventory);ShopNotice(title:"seller_inventory_note")
        Toggle("seller_review_changes",isOn:$reviewed).shopFont(13)
        Button("seller_adjust_inventory"){submitted=true;seller.perform(.inventory(productID:product.ID,variantID:variant.ID,expectedRevision:expectedRevision,inventory:inventory))}.buttonStyle(ShopButtonStyle()).disabled(!valid || !reviewed || submitted || !seller.can("inventory.write") || seller.busy || seller.hasPending(product.ID))
        SellerFormResult(submitted:submitted)
    }.disabled(seller.busy)}
}
private struct SellerShipForm:View {
    @EnvironmentObject var seller:ShopSellerModel
    let order:SellerOrder
    @State private var carrier=""
    @State private var tracking=""
    @State private var reviewed=false
    @State private var submitted=false
    var body:some View{SellerOperationSheet("seller_ship"){
        Text(verbatim:order.ID).font(.caption.monospaced());ForEach(order.Lines){line in Text(verbatim:line.Title+" × "+String(line.Quantity)).shopFont(14,.semibold)}
        SellerField(title:"seller_carrier",text:$carrier);SellerField(title:"seller_tracking",text:$tracking)
        ShopNotice(title:"seller_fulfillment_boundary",symbol:"truck.box")
        Toggle("seller_confirm_shipment",isOn:$reviewed).shopFont(13)
        Button("seller_ship"){submitted=true;seller.perform(.ship(orderID:order.ID,carrier:carrier,trackingNumber:tracking))}.buttonStyle(ShopButtonStyle()).disabled(!reviewed || !sellerRequiredText(carrier,120) || !sellerRequiredText(tracking,200) || order.Status != "paid" || (sellerIsNativePayment(order) && (sellerPaymentNeedsReview(order) || order.paymentDisplayState=="native_refunded")) || submitted || !seller.can("fulfillment.write") || seller.busy || seller.hasPending(order.ID))
        SellerFormResult(submitted:submitted)
    }.onChange(of:[carrier,tracking]){reviewed=false}.disabled(seller.busy)}
}
private struct SellerReturnForm:View {
    @EnvironmentObject var seller:ShopSellerModel
    let order:SellerOrder
    let approve:Bool
    @State private var originalReturnID:String?
    init(order:SellerOrder,approve:Bool){self.order=order;self.approve=approve;_originalReturnID=State(initialValue:order.originalReturnID)}
    @State private var explanation=""
    @State private var reviewed=false
    @State private var submitted=false
    var body:some View{SellerOperationSheet(approve ? "seller_approve_return":"seller_reject_return"){
        Text(verbatim:order.ID).font(.caption.monospaced());SellerValue(title:"seller_original_return",value:originalReturnID ?? String(localized:"unavailable"));if let resolution=order.Resolution{Text(verbatim:resolution.Reason).shopFont(14);Text(verbatim:resolution.Explanation).shopFont(13)}
        SellerField(title:"seller_explanation",text:$explanation,multiline:true);ShopNotice(title:"seller_return_boundary")
        Toggle("seller_review_changes",isOn:$reviewed).shopFont(13)
        Button(approve ? "seller_approve_return":"seller_reject_return"){guard let returnID=originalReturnID else{return};submitted=true;seller.perform(.returnDecision(orderID:order.ID,returnID:returnID,approve:approve,explanation:explanation))}.buttonStyle(ShopButtonStyle(kind:approve ? .primary:.destructive)).disabled(!reviewed || originalReturnID==nil || order.originalReturnID != originalReturnID || order.Status != "return_requested" || explanation.utf8.count>5000 || (!approve && !sellerRequiredText(explanation,5000)) || submitted || !seller.can("returns.resolve") || seller.busy || seller.hasPending(order.ID))
        SellerFormResult(submitted:submitted)
    }.disabled(seller.busy)}
}
private struct SellerRevokeForm:View {
    @EnvironmentObject var seller:ShopSellerModel
    let member:SellerMember
    @State private var reason=""
    @State private var reviewed=false
    @State private var submitted=false
    var body:some View{SellerOperationSheet("seller_revoke"){
        SellerValue(title:"seller_member_account",value:member.Account);SellerValue(title:"seller_role",value:member.Role)
        ShopNotice(title:"seller_revoke_warning",symbol:"person.crop.circle.badge.xmark",warning:true)
        SellerField(title:"seller_revoke_reason",text:$reason)
        Text("seller_revoke_reason_hint").shopFont(12).foregroundStyle(ShopTheme.secondary)
        Toggle("seller_confirm_revoke",isOn:$reviewed).shopFont(13)
        Button("seller_confirm_revoke_action",role:.destructive){submitted=true;seller.perform(.revoke(account:member.Account,reason:reason))}.buttonStyle(ShopButtonStyle(kind:.destructive)).disabled(!reviewed || !sellerRequiredText(reason,240) || reason.utf8.count<8 || reason.contains("\n") || reason.contains("\r") || member.Role=="owner" || submitted || !seller.canManageMembers || seller.busy || seller.hasPending(member.Account))
        SellerFormResult(submitted:submitted)
    }.disabled(seller.busy)}
}
private struct SellerFormResult:View {
    @EnvironmentObject var seller:ShopSellerModel
    let submitted:Bool
    var body:some View{if submitted{VStack(alignment:.leading,spacing:12){Text("seller_check_result").shopFont(12).foregroundStyle(ShopTheme.secondary);if !seller.state.isEmpty{Text(LocalizedStringKey(seller.state)).shopFont(13)};if seller.pendingOriginalCount>0{Button("seller_recover_originals"){seller.recoverOriginals()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(seller.busy)};if seller.preparedOriginalCount>0{Button("seller_retry_prepared"){seller.retryPreparedOriginals()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(seller.busy || !seller.signedIn)};Button("retry"){seller.refresh()}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(seller.busy)}}}
}

private struct SellerCreateStoreForm:View {
    @EnvironmentObject var seller:ShopSellerModel
    @State private var name=""
    @State private var description=""
    @State private var policy=""
    @State private var trustURL=""
    @State private var settlementAccount=""
    @State private var reviewed=false
    @State private var submitted=false
    private var valid:Bool{
        guard sellerRequiredText(name,100),description.utf8.count<=3000,sellerRequiredText(policy,5000),trustURL.utf8.count<=500 else{return false}
        if !trustURL.isEmpty{guard let url=URLComponents(string:trustURL),url.scheme=="https",let host=url.host,!host.isEmpty,url.user==nil,url.password==nil else{return false}}
        return settlementAccount.isEmpty || NativeWire.matches(settlementAccount,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$")
    }
    var body:some View{SellerOperationSheet("seller_create_store"){
        SellerField(title:"seller_store_name",text:$name)
        SellerField(title:"seller_description",text:$description,multiline:true)
        SellerField(title:"seller_store_policy",text:$policy,multiline:true)
        if policy.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty{Text("seller_activation_policy_required").shopFont(12).foregroundStyle(ShopTheme.secondary)}
        SellerField(title:"seller_trust_reference",text:$trustURL)
        SellerField(title:"seller_payout_address",text:$settlementAccount)
        ShopNotice(title:"seller_create_store_note")
        Text("seller_store_input_note").shopFont(12).foregroundStyle(ShopTheme.secondary)
        Toggle("seller_review_changes",isOn:$reviewed).shopFont(13)
        Button("seller_create_store"){submitted=true;seller.perform(.createStore(name:name,description:description,policy:policy,trustURL:trustURL,settlementAccount:settlementAccount))}.buttonStyle(ShopButtonStyle()).disabled(!valid || !reviewed || submitted || !seller.signedIn || seller.busy || seller.hasPending("create-store"))
        SellerFormResult(submitted:submitted)
    }.onChange(of:[name,description,policy,trustURL,settlementAccount]){reviewed=false}.disabled(seller.busy)}
}
private struct SellerCreateProductForm:View {
    @EnvironmentObject var seller:ShopSellerModel
    @State private var draft=SellerListingDraft(productID:"",expectedRevision:"0",title:"",description:"",category:"",variants:[SellerVariantDraft()])
    @State private var reviewed=false
    @State private var submitted=false
    private var valid:Bool{
        guard sellerRequiredText(draft.title,160),draft.description.utf8.count<=5000,draft.category.utf8.count<=80,(1...50).contains(draft.variants.count),Set(draft.variants.map(\.SKU)).count==draft.variants.count else{return false}
        return draft.variants.allSatisfy{sellerRequiredText($0.Name,120) && sellerRequiredText($0.SKU,80) && sellerCanonicalInteger($0.PriceYNXT,positive:true) != nil && sellerCanonicalInteger($0.Inventory) != nil}
    }
    private var reviewContent:[String]{[draft.title,draft.description,draft.category]+draft.variants.flatMap{[$0.ID,$0.Name,$0.SKU,$0.PriceYNXT,$0.Inventory]}}
    var body:some View{SellerOperationSheet("seller_create_product"){
        ShopNotice(title:"seller_create_product_note")
        SellerField(title:"seller_product_title",text:$draft.title)
        SellerField(title:"seller_description",text:$draft.description,multiline:true)
        SellerField(title:"seller_category",text:$draft.category)
        ShopSectionTitle(title:"seller_variants")
        ForEach(draft.variants.indices,id:\.self){index in SellerLedger{VStack(alignment:.leading,spacing:14){
            SellerField(title:"seller_variant_name",text:$draft.variants[index].Name)
            SellerField(title:"seller_sku",text:$draft.variants[index].SKU)
            SellerField(title:"seller_price",text:$draft.variants[index].PriceYNXT)
            SellerField(title:"seller_total_inventory",text:$draft.variants[index].Inventory)
            Button("seller_remove_variant",role:.destructive){draft.variants.remove(at:index);reviewed=false}.buttonStyle(.plain).disabled(draft.variants.count<=1)
        }.padding(16)}}
        Button("seller_add_variant"){draft.variants.append(SellerVariantDraft());reviewed=false}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(draft.variants.count>=50 || submitted)
        Toggle("seller_review_changes",isOn:$reviewed).shopFont(13)
        Button("seller_create_product"){submitted=true;seller.perform(.createProduct(draft))}.buttonStyle(ShopButtonStyle()).disabled(!valid || !reviewed || submitted || !seller.can("catalog.write") || seller.busy || seller.hasPending("create-product"))
        SellerFormResult(submitted:submitted)
    }.onChange(of:reviewContent){reviewed=false}.disabled(seller.busy)}
}
private struct SellerActivateStoreForm:View {
    @EnvironmentObject var seller:ShopSellerModel
    let store:SellerStore
    @State private var expectedUpdatedAt:String?
    @State private var expectedPolicy:String
    @State private var expectedSettlementAccount:String
    @State private var reviewed=false
    @State private var submitted=false
    init(store:SellerStore){self.store=store;_expectedUpdatedAt=State(initialValue:store.UpdatedAt);_expectedPolicy=State(initialValue:store.Policy);_expectedSettlementAccount=State(initialValue:store.SettlementAccount)}
    private var snapshotMatches:Bool{guard let current=seller.stores.first(where:{$0.ID==store.ID}) else{return false};return current.UpdatedAt==expectedUpdatedAt && current.Policy==expectedPolicy && current.SettlementAccount==expectedSettlementAccount}
    private var valid:Bool{expectedUpdatedAt != nil && snapshotMatches && sellerRequiredText(expectedPolicy,5000) && store.Status != "active"}
    var body:some View{SellerOperationSheet("seller_activate_store"){
        Text(verbatim:store.Name).shopFont(22,.bold)
        SellerValue(title:"seller_store",value:store.ID)
        SellerState(status:store.Status)
        SellerValue(title:"seller_recorded_at",value:expectedUpdatedAt ?? String(localized:"unavailable"))
        ShopSectionTitle(title:"seller_store_policy")
        Text(verbatim:expectedPolicy).shopFont(14).textSelection(.enabled)
        SellerValue(title:"seller_payout_address",value:expectedSettlementAccount)
        ShopNotice(title:"seller_activation_note")
        if expectedPolicy.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty{ShopNotice(title:"seller_activation_policy_required",warning:true)}
        if expectedUpdatedAt==nil{ShopNotice(title:"seller_activation_snapshot_missing",warning:true)}
        else if !snapshotMatches{ShopNotice(title:"seller_store_changed",warning:true)}
        Toggle("seller_confirm_activation",isOn:$reviewed).shopFont(13)
        Button("seller_activate_store"){guard let expectedUpdatedAt else{return};submitted=true;seller.perform(.activateStore(expectedUpdatedAt:expectedUpdatedAt,expectedPolicy:expectedPolicy,expectedSettlementAccount:expectedSettlementAccount))}.buttonStyle(ShopButtonStyle()).disabled(!valid || !reviewed || submitted || !seller.canManageMembers || seller.busy || seller.hasPending(store.ID))
        SellerFormResult(submitted:submitted)
    }.disabled(seller.busy)}
}
private enum SellerInviteRole:String,CaseIterable,Identifiable {
    case admin,catalog,inventory,fulfillment,finance,support,viewer
    var id:String{rawValue}
    var title:LocalizedStringKey{switch self{case .admin:return "seller_role_admin";case .catalog:return "seller_role_catalog";case .inventory:return "seller_role_inventory";case .fulfillment:return "seller_role_fulfillment";case .finance:return "seller_role_finance";case .support:return "seller_role_support";case .viewer:return "seller_role_viewer"}}
}
private struct SellerInviteForm:View {
    @EnvironmentObject var seller:ShopSellerModel
    @State private var account=""
    @State private var role=""
    @State private var ttlSeconds=""
    @State private var reviewed=false
    @State private var submitted=false
    private var valid:Bool{guard NativeWire.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$"),SellerInviteRole(rawValue:role) != nil,let seconds=sellerCanonicalInteger(ttlSeconds),(900...604800).contains(seconds) else{return false};return true}
    var body:some View{SellerOperationSheet("seller_invite_member"){
        SellerField(title:"seller_member_account",text:$account)
        Picker("seller_role",selection:$role){Text("seller_select_role").tag("");ForEach(SellerInviteRole.allCases){value in Text(value.title).tag(value.rawValue)}}
        SellerField(title:"seller_invitation_ttl",text:$ttlSeconds)
        ShopNotice(title:"seller_invitation_note")
        Toggle("seller_confirm_invitation",isOn:$reviewed).shopFont(13)
        Button("seller_invite_member"){submitted=true;seller.perform(.invite(account:account,role:role,ttlSeconds:ttlSeconds))}.buttonStyle(ShopButtonStyle()).disabled(!valid || !reviewed || submitted || !seller.canManageMembers || seller.busy || seller.hasPending(account))
        SellerFormResult(submitted:submitted)
    }.onChange(of:[account,role,ttlSeconds]){reviewed=false}.disabled(seller.busy)}
}
private struct SellerInvitationRows:View {
    @EnvironmentObject var seller:ShopSellerModel
    @State private var decision:SellerInvitation?
    private var invitations:[SellerInvitation]{seller.invitations.filter{$0.StoreID==seller.selectedStoreID}}
    var body:some View{Group{if invitations.isEmpty{SellerEmpty(symbol:"envelope")}else{SellerLedger{ForEach(invitations){invitation in VStack(alignment:.leading,spacing:12){
        HStack{Text(verbatim:invitation.Account).font(.caption.monospaced()).textSelection(.enabled);Spacer();invitationStatus(invitation.Status)}
        SellerValue(title:"seller_reference",value:invitation.ID)
        SellerValue(title:"seller_role",value:invitation.Role)
        SellerValue(title:"seller_actor",value:invitation.CreatedBy)
        SellerValue(title:"seller_invitation_expires_at",value:invitation.ExpiresAt)
        if !invitation.Reason.isEmpty{Text(verbatim:invitation.Reason).shopFont(13)}
        Text("seller_invitation_note").shopFont(12).foregroundStyle(ShopTheme.secondary)
        if invitation.Status=="pending"{Button("seller_cancel_invitation",role:.destructive){decision=invitation}.disabled(!seller.canManageMembers || seller.busy || seller.invitationPending(invitation))}
    }.padding(16);Divider()}}}}.sheet(item:$decision){SellerInvitationDecisionForm(invitation:$0,accept:false)}}
    @ViewBuilder private func invitationStatus(_ status:String)->some View{switch status{case "pending":Text("seller_invitation_pending").shopFont(12,.semibold).foregroundStyle(ShopTheme.warning);case "accepted":Text("seller_invitation_accepted").shopFont(12,.semibold).foregroundStyle(ShopTheme.success);case "expired":Text("seller_invitation_expired").shopFont(12,.semibold).foregroundStyle(ShopTheme.secondary);default:SellerState(status:status)}}
}

private struct SellerInvitationInbox:View {
    @EnvironmentObject var seller:ShopSellerModel
    @State private var decision:SellerInvitation?
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:16){
        HStack{Text("seller_invitation_inbox").shopFont(22,.bold);Spacer();Button("close"){seller.invitationInboxVisible=false}}
        Text("seller_authority_boundary").shopFont(13).foregroundStyle(ShopTheme.secondary)
        if seller.receivedInvitations.isEmpty{SellerEmpty(symbol:"envelope")}
        ForEach(seller.receivedInvitations){row in SellerLedger{VStack(alignment:.leading,spacing:12){
            SellerValue(title:"seller_reference",value:row.ID);SellerValue(title:"seller_store",value:row.StoreID);SellerValue(title:"seller_member_account",value:row.Account);SellerValue(title:"seller_role",value:row.Role);SellerValue(title:"seller_actor",value:row.CreatedBy);SellerValue(title:"seller_invitation_expires_at",value:row.ExpiresAt);SellerState(status:row.Status)
            if row.Status=="pending"{Button("seller_accept_invitation"){decision=row}.buttonStyle(ShopButtonStyle()).disabled(seller.busy || seller.invitationPending(row))}
        }.padding(16)}}
    }.padding(20)}.sheet(item:$decision){SellerInvitationDecisionForm(invitation:$0,accept:true)}}
}
private struct SellerInvitationDecisionForm:View {
    @EnvironmentObject var seller:ShopSellerModel
    let invitation:SellerInvitation
    let accept:Bool
    @State private var reason=""
    @State private var reviewed=false
    @State private var submitted=false
    var body:some View{SellerPage(accept ? "seller_accept_invitation":"seller_cancel_invitation",desktop:false){
        SellerValue(title:"seller_store",value:invitation.StoreID);SellerValue(title:"seller_reference",value:invitation.ID);SellerValue(title:"seller_member_account",value:invitation.Account);SellerValue(title:"seller_role",value:invitation.Role);SellerValue(title:"seller_actor",value:invitation.CreatedBy);SellerValue(title:"seller_invitation_expires_at",value:invitation.ExpiresAt)
        if !accept{SellerField(title:"seller_revoke_reason",text:$reason)}
        Toggle("seller_review_invitation_decision",isOn:$reviewed)
        Button(accept ? "seller_accept_invitation":"seller_cancel_invitation"){submitted=true;seller.perform(.invitationDecision(invitation,accept:accept,reason:reason))}.buttonStyle(ShopButtonStyle()).disabled(!reviewed || submitted || seller.busy || seller.invitationPending(invitation) || (!accept && (reason.utf8.count<8 || reason.utf8.count>240 || reason.contains("\n") || reason.contains("\r"))))
        SellerFormResult(submitted:submitted)
    }.onChange(of:reason){reviewed=false}.frame(minWidth:320,minHeight:450)}
}

private func sellerValidStoreProfile(name:String,description:String,policy:String,trustURL:String,settlementAccount:String)->Bool {
    guard sellerRequiredText(name,100),description.utf8.count<=3000,sellerRequiredText(policy,5000),trustURL.utf8.count<=500 else{return false}
    if !trustURL.isEmpty {
        guard let url=URLComponents(string:trustURL),url.scheme=="https",let host=url.host,!host.isEmpty,url.user==nil,url.password==nil else{return false}
    }
    return settlementAccount.isEmpty || settlementAccount.range(of:"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$",options:.regularExpression) != nil
}

private struct SellerStoreProfileEditor:View {
    @EnvironmentObject var seller:ShopSellerModel
    // SellerSheet holds this complete value snapshot. A refresh may update the
    // current projection, but never replaces the snapshot or edited fields.
    let snapshot:SellerStore
    @State private var name:String
    @State private var description:String
    @State private var policy:String
    @State private var trustURL:String
    @State private var settlementAccount:String
    @State private var nativeChargesEnabled:Bool
    @State private var nativeGenesis:String
    @State private var nativeChainID:String
    @State private var shippingAtoms:String
    @State private var taxAtoms:String
    @State private var reviewed=false
    @State private var submitted=false
    init(snapshot:SellerStore){
        self.snapshot=snapshot
        _name=State(initialValue:snapshot.Name)
        _description=State(initialValue:snapshot.Description)
        _policy=State(initialValue:snapshot.Policy)
        _trustURL=State(initialValue:snapshot.TrustURL)
        _settlementAccount=State(initialValue:snapshot.SettlementAccount)
        _nativeChargesEnabled=State(initialValue:snapshot.NativeCharges != nil)
        _nativeGenesis=State(initialValue:snapshot.NativeCharges?.Genesis ?? "")
        _nativeChainID=State(initialValue:snapshot.NativeCharges?.NativeChainID ?? "")
        _shippingAtoms=State(initialValue:snapshot.NativeCharges?.ShippingAtoms ?? "")
        _taxAtoms=State(initialValue:snapshot.NativeCharges?.TaxAtoms ?? "")
    }
    private var reviewContent:[String]{[name,description,policy,trustURL,settlementAccount]+sellerNativeChargesFields(nativeCharges)}
    private var originalContent:[String]{[snapshot.Name,snapshot.Description,snapshot.Policy,snapshot.TrustURL,snapshot.SettlementAccount]+sellerNativeChargesFields(snapshot.NativeCharges)}
    private var changed:Bool{reviewContent != originalContent}
    private var snapshotMatches:Bool{
        guard let current=seller.stores.first(where:{$0.ID==snapshot.ID}) else{return false}
        return [current.ID,current.Owner,current.Name,current.Description,current.Policy,current.TrustURL,current.SettlementAccount,current.Status]==[snapshot.ID,snapshot.Owner,snapshot.Name,snapshot.Description,snapshot.Policy,snapshot.TrustURL,snapshot.SettlementAccount,snapshot.Status] && current.CreatedAt==snapshot.CreatedAt && current.UpdatedAt==snapshot.UpdatedAt && sellerNativeChargesFields(current.NativeCharges)==sellerNativeChargesFields(snapshot.NativeCharges) && current.NativeChargesApprovalRef==snapshot.NativeChargesApprovalRef
    }
    private var nativeCharges:SellerNativeCharges? {
        guard nativeChargesEnabled else{return nil}
        return SellerNativeCharges(Genesis:nativeGenesis,NativeChainID:nativeChainID,AssetID:"YNXT",UnitVersion:"1",ShippingAtoms:shippingAtoms,TaxAtoms:taxAtoms)
    }
    private var valid:Bool{sellerValidStoreProfile(name:name,description:description,policy:policy,trustURL:trustURL,settlementAccount:settlementAccount) && (!nativeChargesEnabled || (sellerNativeIdentityValid(genesis:nativeGenesis,chain:nativeChainID) && sellerCanonicalUInt64(shippingAtoms) && sellerCanonicalUInt64(taxAtoms)))}
    var body:some View{SellerOperationSheet("seller_edit_store_profile"){
        SellerValue(title:"seller_store",value:snapshot.ID)
        SellerValue(title:"seller_recorded_at",value:snapshot.UpdatedAt ?? String(localized:"unavailable"))
        SellerState(status:snapshot.Status)
        ShopNotice(title:"seller_store_profile_edit_note")
        SellerField(title:"seller_store_name",text:$name)
        SellerField(title:"seller_description",text:$description,multiline:true)
        SellerField(title:"seller_store_policy",text:$policy,multiline:true)
        SellerField(title:"seller_trust_reference",text:$trustURL)
        SellerField(title:"seller_payout_address",text:$settlementAccount)
        nativeChargeConfiguration
        Text("seller_store_input_note").shopFont(12).foregroundStyle(ShopTheme.secondary)
        if !submitted && !snapshotMatches{ShopNotice(title:"seller_store_profile_changed",warning:true)}
        if changed {
            ShopSectionTitle(title:"seller_review_profile_changes")
            SellerLedger{VStack(alignment:.leading,spacing:18){
                change("seller_store_name",old:snapshot.Name,new:name)
                change("seller_description",old:snapshot.Description,new:description)
                change("seller_store_policy",old:snapshot.Policy,new:policy)
                change("seller_trust_reference",old:snapshot.TrustURL,new:trustURL)
                change("seller_payout_address",old:snapshot.SettlementAccount,new:settlementAccount)
                nativeChargeReview
            }.padding(16)}
        }
        Toggle("seller_confirm_store_profile",isOn:$reviewed).shopFont(13)
        Button("seller_submit_store_profile"){
            submitted=true
            seller.perform(.updateStore(snapshot,name:name,description:description,policy:policy,trustURL:trustURL,settlementAccount:settlementAccount,nativeCharges:nativeCharges))
        }.buttonStyle(ShopButtonStyle()).disabled(!valid || !changed || !reviewed || !snapshotMatches || submitted || !seller.canManageMembers || seller.busy || seller.hasPending(snapshot.ID))
        SellerFormResult(submitted:submitted)
    }.onChange(of:reviewContent){reviewed=false}.disabled(seller.busy)}
    private var nativeChargeConfiguration:some View{VStack(alignment:.leading,spacing:14){
        Toggle("seller_configure_native_charges",isOn:$nativeChargesEnabled).shopFont(14,.semibold)
        if nativeChargesEnabled {
            SellerField(title:"seller_native_genesis_input",text:$nativeGenesis)
            SellerField(title:"seller_native_chain_input",text:$nativeChainID)
            SellerValue(title:"seller_native_asset",value:"YNXT")
            SellerValue(title:"seller_native_unit_version",value:"1")
            SellerField(title:"seller_native_shipping_input",text:$shippingAtoms)
            SellerField(title:"seller_native_tax_input",text:$taxAtoms)
            Text("seller_native_config_no_conversion").shopFont(12).foregroundStyle(ShopTheme.secondary)
        }else{Text("seller_native_charges_not_configured").shopFont(12).foregroundStyle(ShopTheme.secondary)}
    }.padding(16).background(ShopTheme.tertiary).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))}
    @ViewBuilder private var nativeChargeReview:some View {
        if sellerNativeChargesFields(snapshot.NativeCharges) != sellerNativeChargesFields(nativeCharges) {
            VStack(alignment:.leading,spacing:12){
                Text("seller_configure_native_charges").shopFont(14,.semibold)
                Text("seller_original_value").shopFont(12).foregroundStyle(ShopTheme.secondary)
                nativeChargeValues(snapshot.NativeCharges)
                Text("seller_proposed_value").shopFont(12).foregroundStyle(ShopTheme.primary)
                nativeChargeValues(nativeCharges)
            }
        }
    }
    @ViewBuilder private func nativeChargeValues(_ charges:SellerNativeCharges?)->some View {
        if let charges {
            SellerValue(title:"seller_native_genesis_input",value:charges.Genesis)
            SellerValue(title:"seller_native_chain_input",value:charges.NativeChainID)
            SellerValue(title:"seller_native_asset",value:charges.AssetID)
            SellerValue(title:"seller_native_unit_version",value:charges.UnitVersion)
            SellerValue(title:"seller_native_shipping_input",value:charges.ShippingAtoms)
            SellerValue(title:"seller_native_tax_input",value:charges.TaxAtoms)
        }else{Text("seller_native_charges_not_configured").shopFont(13).foregroundStyle(ShopTheme.secondary)}
    }
    @ViewBuilder private func change(_ title:LocalizedStringKey,old:String,new:String)->some View {
        if old != new {VStack(alignment:.leading,spacing:8){
            Text(title).shopFont(14,.semibold)
            Text("seller_original_value").shopFont(12).foregroundStyle(ShopTheme.secondary)
            Text(verbatim:old.isEmpty ? "—":old).shopFont(13).foregroundStyle(ShopTheme.secondary).textSelection(.enabled)
            Text("seller_proposed_value").shopFont(12).foregroundStyle(ShopTheme.primary)
            Text(verbatim:new.isEmpty ? "—":new).shopFont(13).textSelection(.enabled)
        }}
    }
}


private func sellerIsNativePayment(_ order:SellerOrder)->Bool{order.PayIntentID.hasPrefix("npi_")}
private func sellerPaymentNeedsReview(_ order:SellerOrder)->Bool {
    if sellerIsNativePayment(order){return !["native_paid","native_partial_refund","native_refunded"].contains(order.paymentDisplayState)}
    return order.Status=="payment_pending" || order.Settlement==nil
}
private struct SellerPaymentState:View {
    let order:SellerOrder
    private var nativeTitle:LocalizedStringKey{switch order.paymentDisplayState{
    case "native_unpaid":return "seller_native_unpaid"
    case "native_paid":return "seller_native_paid"
    case "native_partial_refund":return "seller_native_partial_refund"
    case "native_refunded":return "seller_native_refunded"
    case "native_reconcile_required":return "seller_native_reconcile_required"
    default:return "seller_native_receipt_unavailable"
    }}
    var body:some View{Group{if sellerIsNativePayment(order){Text(nativeTitle).shopFont(12,.semibold).foregroundStyle(sellerPaymentNeedsReview(order) ? ShopTheme.warning:ShopTheme.secondary).fixedSize(horizontal:false,vertical:true)}else{SellerState(status:order.Settlement?.Status ?? "unavailable")}}}
}
private struct SellerNativePaymentRecord:View {
    @EnvironmentObject var seller:ShopSellerModel
    let order:SellerOrder
    private var accepted:NativePaymentProjection? {
        guard let payment=order.NativePayment else{return nil}
        do{try payment.validate(order.paymentOrder,requirePaid:false);return payment}catch{return nil}
    }
    var body:some View{SellerLedger{VStack(alignment:.leading,spacing:16){
        HStack(alignment:.top){Text(verbatim:order.ID).font(.caption.monospaced()).textSelection(.enabled);Spacer();SellerPaymentState(order:order)}
        SellerValue(title:"shop_invoice_reference",value:order.InvoiceID)
        SellerValue(title:"shop_original_operation",value:order.PayIntentID)
        if let payment=accepted {
            if order.paymentDisplayState=="native_reconcile_required"{ShopNotice(title:"seller_native_reconcile_required",warning:true)}
            Text("native_atoms_unit").shopFont(12,.semibold).foregroundStyle(ShopTheme.secondary)
            NativeOrderAmounts(order:order.paymentOrder)
            SellerValue(title:"seller_native_session",value:payment.SessionID)
            SellerValue(title:"seller_native_terms_hash",value:payment.TermsHash)
            SellerValue(title:"seller_native_settlement_hash",value:payment.SettlementNativeHash)
            if !payment.CompleteKnownOriginals || !(payment.PendingOriginals ?? []).isEmpty{ShopNotice(title:"native_history_pending",warning:true)}
            if !(payment.PendingOriginals ?? []).isEmpty{ShopNotice(title:"shop_explicit_reconcile_note",symbol:"clock.arrow.circlepath",warning:true)}
            ForEach(Array((payment.PendingOriginals ?? []).enumerated()),id:\.offset){_,original in VStack(alignment:.leading,spacing:10){
                SellerValue(title:"shop_original_operation",value:original)
                Button("shop_reconcile_original_transaction"){seller.reconcileOriginalPayment(order,nativeHash:original)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!seller.canReconcileOriginalPayment(order,nativeHash:original) || seller.busy)
            }}
            ShopSectionTitle(title:"seller_native_receipts")
            ForEach(Array(payment.Receipts.enumerated()),id:\.offset){_,claim in DisclosureGroup{
                VStack(alignment:.leading,spacing:12){
                    SellerValue(title:"seller_native_kind",value:claim.kind)
                    SellerValue(title:"seller_native_claim_status",value:claim.status)
                    if let refundID=claim.refundId{SellerValue(title:"seller_refund_record",value:refundID)}
                    if let eventClaim=claim.eventClaim{SellerValue(title:"seller_reference",value:eventClaim)}
                    SellerValue(title:"seller_block",value:claim.executionHeight)
                    SellerValue(title:"seller_transaction_hash",value:claim.nativeHash)
                    SellerValue(title:"seller_native_settlement_hash",value:claim.settlementNativeHash)
                    SellerValue(title:"seller_store",value:claim.storeId)
                    SellerValue(title:"shop_order_details",value:claim.sourceOrder)
                    SellerValue(title:"seller_native_merchant",value:claim.merchant)
                    if let payer=claim.payer{SellerValue(title:"seller_native_payer",value:payer)}
                    if let recipient=claim.recipient{SellerValue(title:"seller_native_recipient",value:recipient)}
                }.padding(.top,12)
            }label:{VStack(alignment:.leading,spacing:6){Text(verbatim:claim.kind).shopFont(13,.semibold);Text(verbatim:claim.nativeHash).font(.caption.monospaced()).lineLimit(1)}}}
        }else{
            ShopNotice(title:order.paymentDisplayState=="native_reconcile_required" ? "seller_native_reconcile_required":"seller_native_receipt_unavailable",symbol:"clock.arrow.circlepath",warning:true)
        }
        ViewThatFits(in:.horizontal){HStack{readActions};VStack(alignment:.leading,spacing:12){readActions}}
        Text("seller_native_amount_boundary").shopFont(12).foregroundStyle(ShopTheme.secondary)
        Text("seller_finance_read_only").shopFont(12).foregroundStyle(ShopTheme.secondary)
    }.padding(20)}}
    @ViewBuilder private var readActions:some View {
        Button("seller_review_original_terms"){seller.reviewOriginalTerms(order)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!seller.canReviewOriginalTerms(order) || seller.busy)
    }
}

private func sellerCanonicalUInt64(_ text:String,positive:Bool=false)->Bool {
    guard let number=UInt64(text),String(number)==text,!positive || number>0 else{return false}
    return true
}
private func sellerNativeIdentityValid(genesis:String,chain:String)->Bool {
    genesis.utf8.count==64 && genesis.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil && sellerCanonicalUInt64(chain)
}
private func sellerNativePriceFields(_ price:SellerNativePriceDraft?)->[String] {
    guard let price else{return ["disabled"]}
    return ["enabled",price.genesis,price.nativeChainID,price.assetID,price.unitVersion,price.amountAtoms]
}
private func sellerNativeChargesFields(_ charges:SellerNativeCharges?)->[String] {
    guard let charges else{return ["disabled"]}
    return ["enabled",charges.Genesis,charges.NativeChainID,charges.AssetID,charges.UnitVersion,charges.ShippingAtoms,charges.TaxAtoms]
}
private struct SellerNativePriceEditor:View {
    @Binding var price:SellerNativePriceDraft?
    private var enabled:Binding<Bool>{Binding(get:{price != nil},set:{value in price=value ? SellerNativePriceDraft(genesis:"",nativeChainID:"",amountAtoms:""):nil})}
    private func field(_ path:WritableKeyPath<SellerNativePriceDraft,String>)->Binding<String>{Binding(get:{price?[keyPath:path] ?? ""},set:{value in guard var updated=price else{return};updated[keyPath:path]=value;price=updated})}
    var body:some View{VStack(alignment:.leading,spacing:14){
        Toggle("seller_configure_native_price",isOn:enabled).shopFont(13,.semibold)
        if price != nil {
            SellerField(title:"seller_native_genesis_input",text:field(\.genesis))
            SellerField(title:"seller_native_chain_input",text:field(\.nativeChainID))
            SellerValue(title:"seller_native_asset",value:"YNXT")
            SellerValue(title:"seller_native_unit_version",value:"1")
            SellerField(title:"seller_native_amount_input",text:field(\.amountAtoms))
            Text("seller_native_config_no_conversion").shopFont(12).foregroundStyle(ShopTheme.secondary)
        }else{Text("seller_native_price_not_configured").shopFont(12).foregroundStyle(ShopTheme.secondary)}
    }.padding(12).background(ShopTheme.tertiary).clipShape(RoundedRectangle(cornerRadius:ShopTheme.radiusSmall))}
}

private struct SellerTargetRecovery:View {
    @EnvironmentObject var seller:ShopSellerModel
    let target:String
    var body:some View{let originals=seller.pendingOperations(for:target)
        if !originals.isEmpty{SellerLedger{VStack(alignment:.leading,spacing:14){
            Text("seller_pending_originals").shopFont(17,.semibold)
            ForEach(originals){original in VStack(alignment:.leading,spacing:6){SellerValue(title:"seller_reference",value:original.id);SellerValue(title:"seller_actions",value:original.kind);Text(original.phase=="prepared" ? "seller_original_prepared":"seller_original_unconfirmed").shopFont(12).foregroundStyle(ShopTheme.warning)}}
            if originals.contains(where:{$0.phase=="unknown"}){Button("seller_recover_originals"){seller.recoverOriginals(for:target)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(seller.busy || !seller.signedIn)}
            if originals.contains(where:{$0.phase=="prepared"}){Button("seller_retry_prepared"){seller.retryPreparedOriginals(for:target)}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(seller.busy || !seller.signedIn)}
        }.padding(20)}}
    }
}

private struct SellerWarehouseView:View {
    @EnvironmentObject var seller:ShopSellerModel
    let order:SellerOrder
    @State private var selectedReturn=""
    @State private var evidence=""
    @State private var quantities:[String:String]=[:]
    @State private var reviewed=false
    @State private var submitted=false
    @State private var restockReceipt:SellerReturnReceipt?
    private func skuKey(_ item:SellerReturnItem)->String{String(item.ProductID.utf8.count)+":"+item.ProductID+item.VariantID}
    private var items:[SellerReturnItem]? {
        guard let available=order.remainingReturnItems else{return nil}
        var result:[SellerReturnItem]=[]
        for item in available {
            let text=quantities[skuKey(item)] ?? ""
            if text.isEmpty{continue}
            guard let number=Int64(text),number>0,String(number)==text,let remaining=Int64(item.Quantity),number<=remaining else{return nil}
            result.append(SellerReturnItem(ProductID:item.ProductID,VariantID:item.VariantID,Quantity:text))
        }
        return result.isEmpty ? nil:result
    }
    private var reviewContent:[String]{[selectedReturn,evidence]+quantities.keys.sorted().flatMap{[$0,quantities[$0] ?? ""]}}
    var body:some View{SellerLedger{VStack(alignment:.leading,spacing:18){
        Text("seller_return_warehouse").shopFont(17,.semibold)
        ShopNotice(title:"seller_warehouse_boundary")
        if let receipts=order.ReturnReceipts,!receipts.isEmpty{ForEach(receipts){receipt in VStack(alignment:.leading,spacing:12){
            SellerValue(title:"seller_reference",value:receipt.ID)
            SellerValue(title:"seller_original_return",value:receipt.ReturnID)
            SellerValue(title:"seller_warehouse_evidence",value:receipt.EvidenceReference)
            SellerValue(title:"seller_recorded_at",value:receipt.ReceivedAt)
            ForEach(Array(receipt.Items.enumerated()),id:\.offset){_,item in SellerValue(title:"seller_sku",value:item.ProductID+" / "+item.VariantID+" × "+item.Quantity)}
            if let restockedAt=receipt.RestockedAt{SellerValue(title:"seller_restocked_at",value:restockedAt)}
            else{Button("seller_restock_return"){restockReceipt=receipt}.buttonStyle(ShopButtonStyle(kind:.secondary)).disabled(!seller.canRestockReturn(order,receipt) || seller.busy || seller.hasPending(order.ID))}
            Divider()
        }}}
        if seller.canReceiveReturn(order),let remaining=order.remainingReturnItems {
            Picker("seller_original_return",selection:$selectedReturn){Text("seller_select_return").tag("");ForEach(order.approvedReturnIDs,id:\.self){Text(verbatim:$0).tag($0)}}
            SellerField(title:"seller_warehouse_evidence",text:$evidence)
            ForEach(Array(remaining.enumerated()),id:\.offset){_,item in VStack(alignment:.leading,spacing:8){
                SellerValue(title:"seller_sku",value:item.ProductID+" / "+item.VariantID)
                SellerValue(title:"seller_return_remaining",value:item.Quantity)
                SellerField(title:"seller_return_receive_quantity",text:Binding(get:{quantities[skuKey(item)] ?? ""},set:{quantities[skuKey(item)]=$0}))
            }}
            Toggle("seller_review_changes",isOn:$reviewed).shopFont(13)
            Button("seller_record_return_received"){guard let items else{return};submitted=true;seller.perform(.receiveReturn(orderID:order.ID,returnID:selectedReturn,evidenceReference:evidence,items:items))}.buttonStyle(ShopButtonStyle()).disabled(!reviewed || submitted || items==nil || !order.approvedReturnIDs.contains(selectedReturn) || !SellerOrder.validWarehouseID(evidence) || seller.busy || seller.hasPending(order.ID))
        }else if order.remainingReturnItems==nil{ShopNotice(title:"seller_warehouse_unavailable",warning:true)}
        SellerFormResult(submitted:submitted)
    }.padding(20)}.onChange(of:reviewContent){reviewed=false}.onChange(of:order.remainingReturnItems){reviewed=false}.onChange(of:order.approvedReturnIDs){reviewed=false}.confirmationDialog("seller_confirm_restock",isPresented:Binding(get:{restockReceipt != nil},set:{if !$0{restockReceipt=nil}}),titleVisibility:.visible){
        if let receipt=restockReceipt{Button("seller_restock_return"){submitted=true;seller.perform(.restockReturn(orderID:order.ID,receiptID:receipt.ID));restockReceipt=nil}.disabled(!seller.canRestockReturn(order,receipt) || seller.busy || seller.hasPending(order.ID))}
        Button("cancel",role:.cancel){restockReceipt=nil}
    }}
}

private func sellerOrderLineAmount(_ line:SellerOrderLine,order:SellerOrder,locale:Locale)->String {
    if let quote=order.NativePrice{guard (try? quote.validate(order.paymentOrder)) != nil,let price=line.NativePrice else{return String(localized:"unavailable")};return ShopMoneyDisplay.atoms(price.AmountAtoms,locale:locale) ?? String(localized:"unavailable")}
    guard !sellerIsNativePayment(order) else{return String(localized:"unavailable")}
    return sellerMoney(line.UnitPriceYNXT,currency:order.Currency,locale:locale)
}
private func sellerOrderComponent(_ order:SellerOrder,kind:String,locale:Locale)->String {
    if let quote=order.NativePrice {
        guard (try? quote.validate(order.paymentOrder)) != nil,let total=UInt64(quote.Price.AmountAtoms),let shipping=UInt64(quote.Charges.ShippingAtoms),let tax=UInt64(quote.Charges.TaxAtoms),shipping<=total,tax<=total-shipping else{return String(localized:"unavailable")}
        let value=kind=="shipping" ? shipping:kind=="tax" ? tax:total-shipping-tax
        return ShopMoneyDisplay.atoms(String(value),locale:locale) ?? String(localized:"unavailable")
    }
    guard !sellerIsNativePayment(order) else{return String(localized:"unavailable")}
    return sellerMoney(kind=="shipping" ? order.ShippingYNXT:kind=="tax" ? order.TaxYNXT:order.SubtotalYNXT,currency:order.Currency,locale:locale)
}

private struct SellerRefundReviewForm:View {
    @EnvironmentObject var seller:ShopSellerModel
    @Environment(\.locale) private var locale
    let order:SellerOrder
    @State private var amountAtoms=""
    @State private var reviewed=false
    @State private var submitted=false
    @State private var refundRequestID:String?
    init(order:SellerOrder){self.order=order;_refundRequestID=State(initialValue:order.originalRefundRequestID)}
    private var availableAtoms:String?{order.validatedNetPaidAtoms}
    private var pendingReview:SellerRefundReview? {
        guard let retained=seller.retainedRefundReviews[order.ID] else{return nil}
        return retained.confirmed(in:order) ? nil:retained
    }
    private var amountValid:Bool {
        guard sellerCanonicalUInt64(amountAtoms,positive:true),let amount=UInt64(amountAtoms),let availableAtoms,let maximum=UInt64(availableAtoms),amount<=maximum else{return false}
        return true
    }
    private var sameRequest:Bool{refundRequestID != nil && refundRequestID==seller.refundableOriginalEvent(order)?.ID}
    var body:some View{if refundRequestID != nil || pendingReview != nil{SellerLedger{VStack(alignment:.leading,spacing:18){
        Text("seller_refund_review_title").shopFont(17,.semibold)
        SellerValue(title:"shop_order_details",value:order.ID)
        SellerValue(title:"shop_invoice_reference",value:order.InvoiceID)
        SellerValue(title:"seller_refund_request_event",value:refundRequestID ?? String(localized:"unavailable"))
        SellerValue(title:"seller_refund_available_atoms",value:availableAtoms.flatMap{ShopMoneyDisplay.atoms($0,locale:locale)} ?? String(localized:"unavailable"))
        ShopNotice(title:"seller_refund_review_boundary")
        if let retained=pendingReview {
            SellerValue(title:"seller_refund_request_event",value:retained.refundID)
            SellerValue(title:"seller_native_amount_input",value:ShopMoneyDisplay.atoms(retained.amountAtoms,locale:locale) ?? String(localized:"unavailable"))
            SellerValue(title:"seller_refund_main_review_id",value:retained.reviewID ?? String(localized:"unavailable"))
            Text(retained.phase=="unknown" ? "seller_refund_review_unknown":"seller_refund_review_retained").shopFont(12).foregroundStyle(ShopTheme.secondary)
        }else{
            if !sameRequest{ShopNotice(title:"seller_refund_request_changed",warning:true)}
            SellerField(title:"seller_refund_amount_input",text:$amountAtoms)
            Text("seller_native_config_no_conversion").shopFont(12).foregroundStyle(ShopTheme.secondary)
            Toggle("seller_confirm_refund_review",isOn:$reviewed).shopFont(13)
            Button("seller_request_refund_review"){
                submitted=true
                guard let refundRequestID else{return}
                seller.reviewOriginalRefund(order,refundID:refundRequestID,amountAtoms:amountAtoms)
            }.buttonStyle(ShopButtonStyle()).disabled(!sameRequest || !amountValid || !reviewed || submitted || !seller.canReviewOriginalRefund(order) || seller.busy)
        }
        if submitted && !seller.state.isEmpty{Text(LocalizedStringKey(seller.state)).shopFont(13).foregroundStyle(ShopTheme.secondary)}
    }.padding(20)}.onChange(of:amountAtoms){reviewed=false}.onChange(of:seller.refundableOriginalEvent(order)?.ID){reviewed=false}.onChange(of:availableAtoms){reviewed=false}}}
}
