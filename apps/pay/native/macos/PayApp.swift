import SwiftUI
import AppKit

enum PayBridge {
    static var supportsOriginalOrder: Bool {
        guard let url = Bundle.main.url(forResource: "SOURCE", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let source = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        // This selects the bundled UI only. Connection/permission still comes
        // from the original Main status and its current Source on every call.
        return source["nativeClientGeneration"] as? String == "r6"
    }
    static func invoke(_ request: [String: String]) -> String {
        guard let resources = Bundle.main.resourceURL else { return "{\"phase\":\"unavailable\",\"code\":\"PAY_BUNDLE_UNAVAILABLE\"}" }
        let client = resources.appendingPathComponent("client")
        let process = Process(), output = Pipe(), input = Pipe()
        process.executableURL = client.appendingPathComponent("bin/node")
        process.arguments = [client.appendingPathComponent("lib/desktop-entry.mjs").path]
        process.standardInput = input; process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        // No inherited credential, runtime selector, Node injection or profile.
        process.environment = ["PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"]
        do {
            let bytes = try JSONSerialization.data(withJSONObject: request)
            try process.run()
            try input.fileHandleForWriting.write(contentsOf: bytes)
            try input.fileHandleForWriting.close()
            DispatchQueue.global().asyncAfter(deadline: .now() + 30) { if process.isRunning { process.terminate() } }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard data.count <= 1_048_576, let text = String(data: data, encoding: .utf8), !text.isEmpty else { return "{\"phase\":\"unavailable\",\"code\":\"PAY_MAIN_RESPONSE_UNAVAILABLE\"}" }
            return text
        } catch { return "{\"phase\":\"unavailable\",\"code\":\"PAY_MAIN_ENTRY_UNAVAILABLE\"}" }
    }
}

@MainActor final class PayModel: ObservableObject {
    @Published var merchant = ""
    @Published var invoice = ""
    @Published var intent = ""
    @Published var originalHash = ""
    @Published var nativeHash = ""
    @Published var refund = ""
    @Published var amount = ""
    @Published var sourceOrder = ""
    @Published var kind = "invoice_settle"
    @Published var result = ""
    @Published var busy = false
    @Published var status = "Checking original Wallet / Source…"
    @Published var sourceReady = false
    private var generation = 0
    func invalidate() { generation += 1; result = ""; sourceReady = false; status = "Reconnect original Wallet / Source" }
    func perform(_ action: String) {
        guard !busy else { return }
        var request = ["action": action]
        switch action {
        case "order-invoice", "order-terms-review", "order-pay-review", "order-reconcile", "lookup-intent":
            request.merge(["productId": "shop.order", "sourceOrder": sourceOrder]) { _, new in new }
        case "order-refund-review":
            request.merge(["productId": "shop.order", "sourceOrder": sourceOrder, "refundId": refund, "amountAtoms": amount]) { _, new in new }
        case "order-receipt", "order-reconcile-operation":
            request.merge(["productId": "shop.order", "sourceOrder": sourceOrder, "nativeHash": nativeHash]) { _, new in new }
        case "order-broadcast-review":
            request.merge(["productId": "shop.order", "sourceOrder": sourceOrder, "kind": kind, "originalHash": originalHash]) { _, new in new }
        case "invoice", "pay-review", "events": request.merge(["merchant": merchant, "invoiceId": invoice]) { _, new in new }
        case "intent", "terms-review", "recover-intent": request["intentId"] = intent
        case "refund-review": request.merge(["merchant": merchant, "invoiceId": invoice, "refundId": refund, "amountAtoms": amount]) { _, new in new }
        case "recover": request.merge(["merchant": merchant, "invoiceId": invoice, "nativeHash": nativeHash]) { _, new in new }
        case "broadcast-review": request.merge(["merchant": merchant, "invoiceId": invoice, "intentId": intent, "originalHash": originalHash, "kind": kind]) { _, new in new }
        default: break
        }
        busy = true
        let envelope = request, currentGeneration = generation
        Task {
            let text = await Task.detached { PayBridge.invoke(envelope) }.value
            guard currentGeneration == generation else { busy = false; return }
            result = text
            if let bytes = text.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] {
                if action == "status" {
                    sourceReady = value["available"] as? Bool == true
                    status = sourceReady
                        ? "Wallet Source connected. Pay service availability has not been verified."
                        : "Original Wallet / Source unavailable"
                }
                if let raw = (value["code"] as? String) ?? (value["reason"] as? String) {
                    switch raw {
                    case "NATIVE_PAY_NORMAL_MAIN_SOURCE_NOT_SUPPLIED", "NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE":
                        status = "Pay connection unavailable. Open YNX Wallet and use Pay there."
                    case "NATIVE_PAY_AUTHORITY_UNAVAILABLE", "PAY_ORIGINAL_BUSINESS_SOURCE_COMMISSIONING_NOT_SUPPLIED":
                        status = "Pay service authorization is unavailable. Check the original order again when it is restored."
                    default:
                        status = raw
                    }
                }
            }
            busy = false
        }
    }
    func openWallet() {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.ynxweb4.wallet.macos") else { status = "Original YNX Wallet is not installed."; return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }
}

struct PayHome: View {
    @StateObject private var model = PayModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("YNX Pay").font(.largeTitle.bold())
                    Text("Invoices, payments and original receipts").foregroundStyle(.secondary)
                }
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                Button("Open original Wallet") { model.openWallet() }
            }
            HStack {
                Image(systemName: model.sourceReady ? "link" : "lock.shield")
                Text(model.status).textSelection(.enabled)
                Spacer()
                Button("Reconnect") { model.perform("status") }.disabled(model.busy)
            }.padding().background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
            if !model.sourceReady {
                Text("The client is running. Invoice access and reviews need the original Wallet and Source connection. Existing accounts, keys and unknown transactions remain in Wallet.")
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            TabView {
                if PayBridge.supportsOriginalOrder {
                    ScrollView { Form {
                        TextField("Original Shop order", text: $model.sourceOrder)
                        HStack {
                            Button("Read original invoice") { model.perform("order-invoice") }
                            Button("Find original intent") { model.perform("lookup-intent") }
                            Button("Refresh original status") { model.perform("order-reconcile") }
                        }
                        HStack {
                            Button("Review invoice in Wallet") { model.perform("order-terms-review") }
                            Button("Review payment in Wallet") { model.perform("order-pay-review") }
                        }
                        TextField("Original refund reference", text: $model.refund)
                        TextField("Refund amount (atoms)", text: $model.amount)
                        Button("Review refund in Wallet") { model.perform("order-refund-review") }
                        TextField("Original Native transaction hash", text: $model.nativeHash)
                        HStack {
                            Button("Read original receipt") { model.perform("order-receipt") }
                            Button("Reconcile original transaction") { model.perform("order-reconcile-operation") }
                        }
                        Picker("Original action", selection: $model.kind) {
                            Text("Merchant invoice").tag("invoice_terms")
                            Text("Payment").tag("invoice_settle")
                            Text("Refund").tag("invoice_refund")
                        }
                        TextField("Original Main transaction hash", text: $model.originalHash)
                        Button("Review separate submission in Wallet") { model.perform("order-broadcast-review") }
                        Text("Use the original Shop order to view its invoice and request Wallet reviews.").foregroundStyle(.secondary)
                    }.padding() }.disabled(!model.sourceReady).tabItem { Label("Shop order", systemImage: "bag") }
                }
                Form {
                    TextField("Merchant account", text: $model.merchant)
                    TextField("Invoice ID", text: $model.invoice)
                    HStack {
                        Button("Read invoice") { model.perform("invoice") }
                        Button("Review payment in Wallet") { model.perform("pay-review") }
                        Button("Refresh original notifications") { model.perform("events") }
                    }
                    TextField("Original Native hash (optional)", text: $model.nativeHash)
                    Button("Recover original receipt") { model.perform("recover") }
                }.padding().disabled(!model.sourceReady).tabItem { Label("Invoice", systemImage: "doc.text") }
                Form {
                    TextField("Original merchant intent ID", text: $model.intent)
                    HStack {
                        Button("Read original bill") { model.perform("intent") }
                        Button("Review invoice in Wallet") { model.perform("terms-review") }
                        Button("Recover original invoice") { model.perform("recover-intent") }
                    }
                    Text("The originating Shop or Cloud bill supplies this intent. Opening this view never creates or reprices an order.").foregroundStyle(.secondary)
                }.padding().disabled(!model.sourceReady).tabItem { Label("Merchant", systemImage: "building.2") }
                Form {
                    TextField("Merchant account", text: $model.merchant)
                    TextField("Invoice ID", text: $model.invoice)
                    TextField("Refund reference", text: $model.refund)
                    TextField("Refund amount (atoms)", text: $model.amount)
                    Button("Review original-payer refund in Wallet") { model.perform("refund-review") }
                }.padding().disabled(!model.sourceReady).tabItem { Label("Refund", systemImage: "arrow.uturn.backward") }
                Form {
                    Picker("Original action", selection: $model.kind) {
                        Text("Merchant invoice").tag("invoice_terms")
                        Text("Payment").tag("invoice_settle")
                        Text("Refund").tag("invoice_refund")
                    }
                    TextField("Original Main transaction hash", text: $model.originalHash)
                    Button("Review separate submission in Wallet") { model.perform("broadcast-review") }
                    Text("Wallet shows the exact retained transaction and obtains separate approval. Pay cannot approve or sign here. An unknown outcome is recovered by its original hash.").foregroundStyle(.secondary)
                }.padding().disabled(!model.sourceReady).tabItem { Label("Wallet review", systemImage: "checkmark.shield") }
            }.disabled(model.busy)
            Text("Original response").font(.headline)
            ScrollView { Text(model.result.isEmpty ? "No invoice or transaction is selected." : model.result).font(.system(.body, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                .padding().background(.quaternary, in: RoundedRectangle(cornerRadius: 10)).frame(minHeight: 130, maxHeight: 220)
            Text("Local QA client · approvals stay in original Wallet · no funds sent by client startup").font(.caption).foregroundStyle(.secondary)
        }.padding(24).frame(minWidth: 760, minHeight: 690).task { model.perform("status") }
        .onChange(of: scenePhase) { phase in if phase == .active { model.perform("status") } else { model.invalidate() } }
    }
}

@main struct YNXPayApp: App {
    init() {
        if CommandLine.arguments.contains("--self-check") {
            print(PayBridge.invoke(["action": "status"]))
            exit(0)
        }
    }
    var body: some Scene { WindowGroup { PayHome() }.defaultSize(width: 820, height: 760) }
}
