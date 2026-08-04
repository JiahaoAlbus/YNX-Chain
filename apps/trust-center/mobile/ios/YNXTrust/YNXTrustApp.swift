import SwiftUI

@main struct YNXTrustApp: App { var body: some Scene { WindowGroup { TrustView() } } }

struct TrustView: View {
    @AppStorage("locale") private var locale = Locale.current.identifier
    @AppStorage("aiLocale") private var aiLocale = Locale.current.identifier
    @State private var account = ""; @State private var device = ""; @State private var deviceKey = ""
    @State private var subject = ""; @State private var source = ""; @State private var digest = ""; @State private var summary = ""; @State private var status = "No authoritative result loaded."
    private let locales = ["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"]
    private let boundaries = [
      "en":"Trust Center cannot freeze, seize, blacklist, confiscate or transfer native YNXT. Every conclusion requires evidence and independent human review; appeal always remains available.",
      "zh-Hans":"信任中心不得冻结、扣押、拉黑、没收或转移原生 YNXT。每项结论都必须基于证据并经独立人工复核，申诉渠道始终保留。",
      "zh-Hant":"信任中心不得凍結、扣押、列入黑名單、沒收或轉移原生 YNXT。每項結論都必須基於證據並經獨立人工覆核，申訴管道始終保留。",
      "ja":"トラストセンターはネイティブ YNXT を凍結、差押え、ブラックリスト登録、没収、移転できません。結論には証拠と独立した人の審査が必要で、不服申立ては常に可能です。",
      "ko":"신뢰 센터는 네이티브 YNXT를 동결, 압류, 블랙리스트 등록, 몰수 또는 이전할 수 없습니다. 결론에는 증거와 독립적인 검토가 필요하며 이의 제기는 항상 가능합니다.",
      "es":"El Centro no puede congelar, embargar, incluir en listas negras, confiscar ni transferir YNXT nativo. Toda conclusión exige pruebas y revisión humana independiente; la apelación siempre está disponible.",
      "fr":"Le Centre ne peut ni geler, saisir, inscrire sur liste noire, confisquer ni transférer le YNXT natif. Toute conclusion exige des preuves et un examen humain indépendant ; le recours reste disponible.",
      "de":"Das Trust Center kann natives YNXT weder einfrieren, beschlagnahmen, sperren, einziehen noch übertragen. Jede Schlussfolgerung braucht Beweise und unabhängige menschliche Prüfung; Beschwerden bleiben möglich.",
      "pt":"A Central não pode congelar, apreender, bloquear, confiscar nem transferir YNXT nativo. Toda conclusão exige evidências e revisão humana independente; o recurso permanece disponível.",
      "ru":"Центр не может замораживать, арестовывать, вносить в чёрный список, конфисковывать или переводить нативный YNXT. Каждый вывод требует доказательств и независимой проверки человеком; апелляция всегда доступна.",
      "ar":"لا يستطيع مركز الثقة تجميد YNXT الأصلي أو حجزه أو إدراجه في قائمة سوداء أو مصادرته أو نقله. يتطلب كل استنتاج دليلاً ومراجعة بشرية مستقلة، ويبقى الاستئناف متاحاً دائماً.",
      "id":"Pusat Kepercayaan tidak dapat membekukan, menyita, memasukkan daftar hitam, merampas, atau memindahkan YNXT asli. Setiap kesimpulan memerlukan bukti dan tinjauan manusia independen; banding selalu tersedia."]
    var body: some View { NavigationStack { Form {
      Section { Picker("Language",selection:$locale){ForEach(locales,id:\.self){Text($0)}}; Picker("AI output language",selection:$aiLocale){ForEach(locales,id:\.self){Text($0)}}; Text(boundaries[locale] ?? boundaries["en"]!).font(.headline).foregroundStyle(Color(red:0,green:47/255,blue:167/255)) }
      Section("Sign in with YNX Wallet") { TextField("YNX account",text:$account).textInputAutocapitalization(.never);TextField("Device ID",text:$device);TextField("Ed25519 device public key",text:$deviceKey);Button("Create central signing challenge"){ Task { await send("/api/auth/challenges",["account":account,"deviceId":device,"deviceSigningPublicKey":deviceKey]) } };Text("Trust Center never requests a seed phrase or private key.").font(.caption) }
      Section("Submit evidence") { TextField("Subject",text:$subject);TextField("Evidence source",text:$source);TextField("Evidence digest",text:$digest);TextField("Summary",text:$summary,axis:.vertical);Button("Submit to authoritative Trust API"){ Task { await send("/api/authority/evidence",["idempotencyKey":UUID().uuidString,"subject":subject,"evidence":[["source":source,"digest":digest,"summary":summary]]]) } } }
      Section("Appeal and transparency") { Button("Open authoritative transparency"){ Task { await get("/api/authority/transparency") } };Text(status).textSelection(.enabled).accessibilityLabel("Trust Center status") }
    }.navigationTitle("YNX Trust Center").environment(\.layoutDirection,locale == "ar" ? .rightToLeft : .leftToRight) } }
    private func send(_ path:String,_ json:[String:Any]) async { do { var r=URLRequest(url:URL(string:"http://127.0.0.1:8091"+path)!);r.httpMethod="POST";r.setValue("application/json",forHTTPHeaderField:"Content-Type");r.httpBody=try JSONSerialization.data(withJSONObject:json);let(d,res)=try await URLSession.shared.data(for:r);await MainActor.run{status="HTTP \((res as? HTTPURLResponse)?.statusCode ?? 0)\n"+String(decoding:d,as:UTF8.self)}}catch{await MainActor.run{status="Unavailable: \(error.localizedDescription). No local conclusion or asset action was substituted."}} }
    private func get(_ path:String) async { do { let(d,res)=try await URLSession.shared.data(from:URL(string:"http://127.0.0.1:8091"+path)!);await MainActor.run{status="HTTP \((res as? HTTPURLResponse)?.statusCode ?? 0)\n"+String(decoding:d,as:UTF8.self)}}catch{await MainActor.run{status="Unavailable: \(error.localizedDescription). No synthetic transparency report was inserted."}} }
}
