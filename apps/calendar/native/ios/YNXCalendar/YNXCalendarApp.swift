import SwiftUI
import CryptoKit
import Security
import UIKit

private let kleinBlue = Color(red: 0, green: 47 / 255, blue: 167 / 255)
private let ink = Color(red: 16 / 255, green: 24 / 255, blue: 40 / 255)
private let muted = Color(red: 102 / 255, green: 112 / 255, blue: 133 / 255)
private let wash = Color(red: 247 / 255, green: 248 / 255, blue: 252 / 255)

@main
struct YNXCalendarApp: App {
  @AppStorage("locale") private var locale = "system"
  private var isRTL: Bool {
    locale == "ar" || (locale == "system" && Locale.autoupdatingCurrent.language.languageCode?.identifier == "ar")
  }
  var body: some Scene {
    WindowGroup {
      CalendarView()
        .environment(\.locale, locale == "system" ? .autoupdatingCurrent : Locale(identifier: locale))
        .environment(\.layoutDirection, isRTL ? .rightToLeft : .leftToRight)
        .onOpenURL(perform: CalendarWallet.accept)
    }
  }
}

enum CalendarDeviceKey {
  static let account = "ynx.calendar.product-device.v1"
  static func key() -> P256.Signing.PrivateKey {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
    ]
    var item: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
       let data = item as? Data,
       let key = try? P256.Signing.PrivateKey(rawRepresentation: data) { return key }
    let key = P256.Signing.PrivateKey()
    SecItemAdd([
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      kSecValueData as String: key.rawRepresentation,
    ] as CFDictionary, nil)
    return key
  }
}

enum CalendarWallet {
  static let callback = "ynxcalendar://wallet-auth/callback"

  static func request(_ recovery: Bool) -> URL? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let now = Date()
    let nonce = Data((0..<32).map { _ in UInt8.random(in: 0...255) }).base64URL
    let productKey = CalendarDeviceKey.key().publicKey.compressedRepresentation.base64URL
    let request: [String: Any] = [
      "version": "1", "nonce": nonce, "chainId": "ynx_6423-1",
      "requestingProduct": "calendar", "productClientId": "ynx-calendar-v1",
      "bundleId": "com.ynxweb4.calendar", "productDeviceAlgorithm": "p256-sha256",
      "productDeviceKey": productKey, "callback": callback,
      "scopes": [recovery ? "calendar:recover" : "calendar:account"],
      "purpose": recovery ? "Recover YNX Calendar on this device" : "Sign in to YNX Calendar on this device",
      "issuedAt": formatter.string(from: now), "expiresAt": formatter.string(from: now.addingTimeInterval(300)),
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: request, options: .sortedKeys) else { return nil }
    UserDefaults.standard.set(String(data: data, encoding: .utf8), forKey: "pending_request")
    return URL(string: "ynxwallet://authorize?request=\(data.base64URL)")
  }

  static func accept(_ url: URL) {
    let defaults = UserDefaults.standard
    guard url.scheme == "ynxcalendar", url.host == "wallet-auth", url.path == "/callback", url.fragment == nil,
          let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
          items.count == 1, items[0].name == "response", let encoded = items[0].value,
          let data = Data(base64URL: encoded),
          let response = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let pending = defaults.string(forKey: "pending_request"), let pendingData = pending.data(using: .utf8),
          let request = try? JSONSerialization.jsonObject(with: pendingData) as? [String: Any],
          let nonce = response["nonce"] as? String, !defaults.bool(forKey: "consumed.\(nonce)")
    else { defaults.set("rejected", forKey: "wallet_state"); return }
    for key in ["version", "nonce", "chainId", "requestingProduct", "productClientId", "bundleId", "productDeviceAlgorithm", "productDeviceKey", "callback", "purpose"] {
      guard String(describing: request[key] ?? "") == String(describing: response[key] ?? "") else {
        defaults.set("rejected", forKey: "wallet_state"); return
      }
    }
    let expected = SHA256.hash(data: Data(("YNX_WALLET_AUTH_REQUEST_V1\n" + pending).utf8)).map { String(format: "%02x", $0) }.joined()
    guard (request["scopes"] as? [String]) == (response["scopes"] as? [String]), response["requestDigest"] as? String == expected else {
      defaults.set("rejected", forKey: "wallet_state"); return
    }
    defaults.set(true, forKey: "consumed.\(nonce)")
    defaults.set(encoded, forKey: "wallet_response")
    defaults.set("gateway_required", forKey: "wallet_state")
  }
}

private extension Data {
  var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
  init?(base64URL: String) {
    var value = base64URL.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    value += String(repeating: "=", count: (4 - value.count % 4) % 4)
    self.init(base64Encoded: value)
  }
}

private enum CalendarMode: String, CaseIterable, Identifiable {
  case day = "Day", week = "Week", month = "Month", agenda = "Agenda"
  var id: String { rawValue }
}

struct CalendarView: View {
  @Environment(\.openURL) private var openURL
  @AppStorage("locale") private var locale = "system"
  @AppStorage("aiLanguage") private var aiLanguage = "en"
  @AppStorage("eventTitle") private var eventTitle = ""
  @AppStorage("eventLocation") private var eventLocation = ""
  @AppStorage("eventNotes") private var eventNotes = ""
  @AppStorage("inviteHandle") private var inviteHandle = ""
  @AppStorage("recurrence") private var recurrence = "none"
  @AppStorage("reminder") private var reminder = "15 minutes"
  @AppStorage("eventTime") private var storedTime = Date().timeIntervalSince1970
  @State private var focusDate = Date()
  @State private var mode: CalendarMode = .week
  @State private var create = false
  @State private var walletMissing = false
  @State private var assistant = false
  @State private var eventActions = false
  private let languages = ["system", "en", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"]

  var body: some View {
    NavigationStack {
      ZStack(alignment: .bottomTrailing) {
        wash.ignoresSafeArea()
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            header
            hero
            modeCard
            weekStrip
            scheduleCard
            assistantCard
          }
          .padding(.horizontal, 18)
          .padding(.bottom, 34)
        }
        Button { create = true } label: { Label(String(localized: "create"), systemImage: "plus") }
          .buttonStyle(.borderedProminent).tint(kleinBlue).fontWeight(.semibold).padding(22)
          .accessibilityIdentifier("calendar.create")
      }
      .toolbar(.hidden, for: .navigationBar)
    }
    .sheet(isPresented: $create) { EventEditor(title: $eventTitle, location: $eventLocation, notes: $eventNotes, invite: $inviteHandle, recurrence: $recurrence, reminder: $reminder, storedTime: $storedTime) }
    .confirmationDialog(eventTitle, isPresented: $eventActions, titleVisibility: .visible) {
      Button(String(localized: "update")) { create = true }
      Button(String(localized: "rsvp")) { }
      Button(String(localized: "share")) { }
      Button(String(localized: "cancel_event"), role: .destructive) { eventTitle = "" }
    }
    .alert("YNX Wallet required", isPresented: $walletMissing) {
      Button("Continue as guest", role: .cancel) { }
      Button("Open YNX ecosystem") { openURL(URL(string: "https://ynxweb4.com/ecosystem")!) }
    } message: { Text("Install YNX Wallet to approve sign-in. Device-only guest scheduling remains available without an account.") }
    .alert(String(localized: "ai"), isPresented: $assistant) {
      Button(String(localized: "approve"), role: .cancel) { }
    } message: { Text(String(localized: "privacy") + " The hosted AI gateway is not enabled in this native preview.") }
  }

  private var header: some View {
    HStack(spacing: 10) {
      if let image = UIImage(named: "ynx-logo.png") { Image(uiImage: image).resizable().scaledToFit().frame(width: 72, height: 38).accessibilityLabel("YNX") }
      Text("Calendar").font(.title3.bold()).foregroundStyle(ink)
      Spacer()
      Picker("Language", selection: $locale) { ForEach(languages, id: \.self) { Text($0).tag($0) } }
        .labelsHidden().frame(maxWidth: 105)
    }
    .padding(.vertical, 10)
  }

  private var hero: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Network available · Testnet session not signed in", systemImage: "circle.fill").font(.caption.bold()).foregroundStyle(Color.green)
      Text("Your time, clearly coordinated").font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(ink)
      Text("Plan across time zones, review every change, and keep guest drafts private on this device.").font(.subheadline).foregroundStyle(muted)
    }
  }

  private var modeCard: some View {
    VStack(spacing: 12) {
      Picker("Calendar view", selection: $mode) { ForEach(CalendarMode.allCases) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented)
      HStack {
        Button { focusDate = Calendar.current.date(byAdding: mode == .month ? .month : mode == .day ? .day : .weekOfYear, value: -1, to: focusDate)! } label: { Image(systemName: "chevron.left") }
        Button(String(localized: "today")) { focusDate = Date() }
        Button { focusDate = Calendar.current.date(byAdding: mode == .month ? .month : mode == .day ? .day : .weekOfYear, value: 1, to: focusDate)! } label: { Image(systemName: "chevron.right") }
        Spacer()
        Text(rangeTitle).font(.subheadline.bold())
      }.buttonStyle(.bordered).tint(kleinBlue)
    }.cardStyle()
  }

  private var weekStrip: some View {
    HStack(spacing: 6) {
      ForEach(weekDates, id: \.self) { date in
        Button { focusDate = date } label: {
          VStack(spacing: 6) { Text(date.formatted(.dateTime.weekday(.narrow))).font(.caption.bold()); Text(date.formatted(.dateTime.day())).font(.headline) }
            .frame(maxWidth: .infinity).padding(.vertical, 10)
            .background(Calendar.current.isDate(date, inSameDayAs: focusDate) ? kleinBlue.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain).foregroundStyle(Calendar.current.isDate(date, inSameDayAs: focusDate) ? kleinBlue : ink)
      }
    }.accessibilityElement(children: .contain).accessibilityLabel(String(localized: "a11y_timeline"))
  }

  private var scheduleCard: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack { Text("\(mode.rawValue) schedule").font(.title2.bold()); Spacer(); Text(TimeZone.current.identifier).font(.caption).foregroundStyle(muted) }
      if eventTitle.isEmpty {
        ContentUnavailableView(String(localized: "empty"), systemImage: "calendar", description: Text("Create an event or continue in guest mode without an account."))
          .frame(maxWidth: .infinity, minHeight: 220)
      } else {
        Button { eventActions = true } label: {
          HStack(alignment: .top, spacing: 12) {
            Capsule().fill(kleinBlue).frame(width: 4, height: 76)
            VStack(alignment: .leading, spacing: 5) {
              Text(eventTitle).font(.headline).foregroundStyle(ink)
              Text(Date(timeIntervalSince1970: storedTime).formatted(date: .abbreviated, time: .shortened)).foregroundStyle(muted)
              Text("\(String(localized: "repeat")): \(recurrence) · \(String(localized: "reminder")): \(reminder)").font(.caption).foregroundStyle(muted)
            }
            Spacer(); Image(systemName: "chevron.right").foregroundStyle(muted)
          }.padding(14).background(wash, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain).accessibilityHint("Open event actions")
      }
    }.cardStyle()
  }

  private var assistantCard: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(String(localized: "ai")).font(.title3.bold()).foregroundStyle(kleinBlue)
      Text(String(localized: "privacy")).font(.subheadline).foregroundStyle(muted)
      HStack {
        Button(String(localized: "review")) { assistant = true }.buttonStyle(.bordered)
        Button(String(localized: "recover")) { launchWallet(recovery: true) }.buttonStyle(.bordered)
      }.tint(kleinBlue)
      Text(String(localized: "security")).font(.caption).foregroundStyle(muted)
    }.padding(18).background(kleinBlue.opacity(0.07), in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(kleinBlue.opacity(0.2)))
  }

  private func launchWallet(recovery: Bool) {
    guard let url = CalendarWallet.request(recovery) else { return }
    UIApplication.shared.open(url, options: [:]) { success in if !success { walletMissing = true } }
  }

  private var weekDates: [Date] {
    let calendar = Calendar.current
    let start = calendar.dateInterval(of: .weekOfYear, for: focusDate)?.start ?? focusDate
    return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
  }
  private var rangeTitle: String {
    if mode == .day { return focusDate.formatted(date: .abbreviated, time: .omitted) }
    if mode == .month { return focusDate.formatted(.dateTime.month(.wide).year()) }
    guard let first = weekDates.first, let last = weekDates.last else { return "" }
    return "\(first.formatted(.dateTime.month(.abbreviated).day())) – \(last.formatted(.dateTime.month(.abbreviated).day()))"
  }
}

private struct EventEditor: View {
  @Environment(\.dismiss) private var dismiss
  @Binding var title: String
  @Binding var location: String
  @Binding var notes: String
  @Binding var invite: String
  @Binding var recurrence: String
  @Binding var reminder: String
  @Binding var storedTime: Double
  @State private var date = Date()
  @State private var allDay = false
  private let recurrences = ["none", "daily", "weekly", "monthly", "yearly"]

  var body: some View {
    NavigationStack {
      Form {
        Section("Event details") {
          TextField("Event title", text: $title).accessibilityIdentifier("calendar.editor.title")
          TextField("Location", text: $location)
          TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...6)
        }
        Section("Date and time") {
          Toggle("All-day event", isOn: $allDay)
          DatePicker("Start", selection: $date, displayedComponents: allDay ? .date : [.date, .hourAndMinute])
          LabeledContent(String(localized: "timezone"), value: TimeZone.current.identifier)
        }
        Section("Repeat and reminders") {
          Picker(String(localized: "repeat"), selection: $recurrence) { ForEach(recurrences, id: \.self) { Text($0).tag($0) } }
          Picker(String(localized: "reminder"), selection: $reminder) { ForEach(["10 minutes", "15 minutes", "30 minutes", "1 hour", "1 day"], id: \.self) { Text($0).tag($0) } }
        }
        Section("People and review") {
          TextField(String(localized: "invite"), text: $invite)
          Label(String(localized: "conflict") + " · pending explicit approval", systemImage: "checkmark.shield")
        }
      }
      .navigationTitle(String(localized: "create"))
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button(String(localized: "review")) { if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { title = "Untitled event" }; storedTime = date.timeIntervalSince1970; dismiss() }.fontWeight(.semibold).accessibilityIdentifier("calendar.editor.review") }
      }
    }
  }
}

private extension View {
  func cardStyle() -> some View { padding(16).background(Color.white, in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.black.opacity(0.08))).shadow(color: .black.opacity(0.03), radius: 5, y: 2) }
}
