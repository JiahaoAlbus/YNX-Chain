import SwiftUI

@main struct YNXResourceApp: App {
  var body: some Scene { WindowGroup { ResourceView() } }
}

struct ResourceView: View {
  @AppStorage("locale") private var locale = Locale.current.identifier
  @AppStorage("aiLocale") private var aiLocale = Locale.current.identifier
  @State private var account = ""
  @State private var device = ""
  @State private var deviceKey = ""
  @State private var kind = "rental"
  @State private var idempotencyKey = ""
  @State private var payload = "{}"
  @State private var status = "No quote, capacity or settlement result loaded."
  let locales = ["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"]
  let boundary = [
    "Sponsorship transfers only limited resource capacity; it never transfers YNXT or any user asset. A fee quote is not settlement; settled status requires authoritative chain or service evidence.",
    "资源赞助只转移受限的资源能力，绝不转移 YNXT 或任何用户资产。费用报价不等于结算；已结算状态必须有权威链上或服务证据。",
    "資源贊助只轉移受限的資源能力，絕不轉移 YNXT 或任何使用者資產。費用報價不等於結算；已結算狀態必須有權威鏈上或服務證據。",
    "スポンサーシップが移すのは制限されたリソース容量だけで、YNXT や利用者資産は移転しません。料金見積りは決済ではなく、決済済み表示には権威ある証拠が必要です。",
    "후원은 제한된 리소스 용량만 이동하며 YNXT 또는 사용자 자산을 이전하지 않습니다. 수수료 견적은 결제가 아니며 완료 상태에는 권위 있는 증거가 필요합니다.",
    "El patrocinio solo transfiere capacidad limitada; nunca transfiere YNXT ni activos. Una cotización no es liquidación; el estado liquidado exige pruebas autoritativas.",
    "Le parrainage ne transfère qu’une capacité limitée, jamais de YNXT ni d’actif. Un devis n’est pas un règlement ; l’état réglé exige une preuve faisant autorité.",
    "Sponsoring überträgt nur begrenzte Kapazität, niemals YNXT oder Nutzervermögen. Ein Angebot ist keine Abrechnung; abgerechnet erfordert verbindliche Nachweise.",
    "O patrocínio transfere apenas capacidade limitada, nunca YNXT nem ativos. Uma cotação não é liquidação; o status liquidado exige evidência autoritativa.",
    "Спонсирование передаёт только ограниченную ёмкость, но не YNXT или активы. Расчёт комиссии не является окончательным расчётом; статус требует авторитетного доказательства.",
    "تنقل الرعاية سعة موارد محدودة فقط، ولا تنقل YNXT أو أصول المستخدم. عرض الرسوم ليس تسوية؛ وتتطلب حالة التسوية دليلاً موثوقاً.",
    "Sponsor hanya memindahkan kapasitas terbatas, bukan YNXT atau aset. Kutipan biaya bukan penyelesaian; status selesai memerlukan bukti otoritatif."
  ]
  private var localeIndex: Int { locales.firstIndex(where: { locale.hasPrefix($0) }) ?? 0 }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Language", selection: $locale) { ForEach(locales, id: \.self) { Text($0) } }
          Picker("AI output language", selection: $aiLocale) { ForEach(locales, id: \.self) { Text($0) } }
          Text(boundary[localeIndex]).font(.headline).foregroundStyle(Color(red: 0, green: 47.0/255.0, blue: 167.0/255.0))
        }
        Section("Sign in with YNX Wallet") {
          TextField("YNX account", text: $account).textInputAutocapitalization(.never)
          TextField("Device ID", text: $device)
          TextField("Ed25519 device public key", text: $deviceKey)
          Button("Create central signing challenge") { Task { await post("/api/auth/challenges", ["account":account,"deviceId":device,"deviceSigningPublicKey":deviceKey]) } }
          Text("Resource Market never requests a seed phrase or private key.").font(.caption)
        }
        Section("Authoritative market") {
          Button("Load price quote") { Task { await get("/api/authority/quote") } }
          Button("Load balances") { Task { await get("/api/authority/balances/" + account) } }
          Picker("Intent", selection: $kind) { Text("Rental").tag("rental"); Text("Delegation").tag("delegation"); Text("Sponsorship").tag("sponsorship") }
          TextField("Idempotency key", text: $idempotencyKey)
          TextField("Exact Wallet-reviewed signed payload JSON", text: $payload, axis: .vertical)
          Button("Submit signed purchase intent") { Task { await submitIntent() } }
        }
        Section("Audit status") {
          Text(status).textSelection(.enabled).accessibilityLabel("Resource Market status")
          Text("A quote is not settlement. No automatic rental, staking, sponsorship or asset transfer is performed.").font(.caption)
        }
      }
      .navigationTitle("YNX Resource Market")
      .environment(\.layoutDirection, locale == "ar" ? .rightToLeft : .leftToRight)
    }
  }

  private func submitIntent() async {
    guard let data = payload.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) else {
      status = "Signed payload must be valid JSON. No transaction submitted."
      return
    }
    await post("/api/authority/intents", ["kind":kind,"idempotencyKey":idempotencyKey,"payload":object])
  }
  private func get(_ path: String) async {
    do { let (data,response) = try await URLSession.shared.data(from: URL(string:"http://127.0.0.1:8092" + path)!); await MainActor.run { status = "HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)\n" + String(decoding:data,as:UTF8.self) } }
    catch { await MainActor.run { status = "Unavailable: \(error.localizedDescription). No quote, capacity or settlement result was substituted." } }
  }
  private func post(_ path: String, _ json: [String:Any]) async {
    do { var request = URLRequest(url:URL(string:"http://127.0.0.1:8092" + path)!); request.httpMethod = "POST"; request.setValue("application/json",forHTTPHeaderField:"Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject:json); let (data,response) = try await URLSession.shared.data(for:request); await MainActor.run { status = "HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)\n" + String(decoding:data,as:UTF8.self) + "\nSettlement is not asserted without authority evidence." } }
    catch { await MainActor.run { status = "Unavailable: \(error.localizedDescription). No quote, capacity, settlement or asset action was substituted." } }
  }
}
