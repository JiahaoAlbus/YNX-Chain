// Actual Native collector/parser DATA only. No SDK/process/socket/authority.
import Foundation
@main struct NymPublicBootstrapControls {
    static let gateway = "fixture-gateway", provider = "fixture-provider"
    static let base = "2026-11-08T00:00:00Z INFO common/socks5-client-core/src/lib.rs:130: "
    static let consumed = base + "YNX_CONSUMED_CONFIG anon=true credentials_enabled=false dkg_client_created=false bind=127.0.0.1:63780 packet=Mix poisson_disabled=false loop_cover_disabled=false per_hop_ms=15 send_ms=20 cover_ms=200\n"
    static let listener = base + "YNX_LISTENER_CONFIG anon=true bind=127.0.0.1:63780 connection_start_surbs=20 per_request_surbs=3 packet=Mix provider_interface={\"type\":\"Versioned\",\"version\":3} socks_protocol={\"type\":\"Versioned\",\"version\":3}\n"
    static let applied = "2026-11-08T00:00:00Z INFO clients/socks5/src/commands/run.rs:111: YNX runtime contract ynx-mixnet-v1 applied; provider=" + provider + "\n"
    static let marker = base + "The address of this client is: fixture@" + gateway + "\n" + base + "Client startup finished!\n"
    static func make() -> NymPublicProcessOutput { .init(limit: 131072, gateway: gateway, provider: provider) }
    static func add(_ text: String, to out: NymPublicProcessOutput, stdout: Bool = false) { out.append(Data(text.utf8), stdout: stdout) }
    static func main() {
        let valid = make(); add(marker, to: valid); precondition(!valid.bootstrapObserved)
        add(consumed + listener, to: valid); precondition(!valid.bootstrapObserved)
        let split = applied.index(applied.startIndex, offsetBy: applied.count / 2)
        add(String(applied[..<split]), to: valid); precondition(!valid.bootstrapObserved)
        add(String(applied[split...]), to: valid); precondition(valid.bootstrapObserved)
        for bad in [consumed.replacingOccurrences(of: "anon=true", with: "anon=false"), consumed.replacingOccurrences(of: "credentials_enabled=false", with: "credentials_enabled=true"), consumed.replacingOccurrences(of: "send_ms=20", with: "send_ms=0"), listener.replacingOccurrences(of: "version\":3", with: "version\":2"), listener.replacingOccurrences(of: "per_request_surbs=3", with: "per_request_surbs=4"), applied.replacingOccurrences(of: provider, with: "wrong-provider")] {
            let out = make(); add(marker + consumed + listener + applied + bad, to: out)
            precondition(out.configurationRejected && !out.bootstrapObserved)
            add(consumed + listener + applied, to: out); precondition(!out.bootstrapObserved)
        }
        let cross = make(), position = consumed.index(consumed.startIndex, offsetBy: consumed.count / 2)
        add(String(consumed[..<position]), to: cross, stdout: true); add(String(consumed[position...]), to: cross)
        add(listener + applied + marker, to: cross); precondition(!cross.bootstrapObserved)
        let markerCross = make(); add(consumed + listener + applied, to: markerCross)
        let cut = marker.index(marker.startIndex, offsetBy: marker.count - 10)
        add(String(marker[..<cut]), to: markerCross, stdout: true); add(String(marker[cut...]), to: markerCross)
        precondition(!markerCross.bootstrapObserved)
        let wrongGateway = make(); add(consumed + listener + applied + marker.replacingOccurrences(of: gateway, with: "other-gateway"), to: wrongGateway); precondition(!wrongGateway.bootstrapObserved)
        let wrongSource = make(); add(consumed.replacingOccurrences(of: "common/socks5-client-core", with: "common/other") + listener + applied + marker, to: wrongSource); precondition(!wrongSource.bootstrapObserved)
        let overlong = make(); add(String(repeating: "x", count: 4097) + "\n" + consumed + listener + applied + marker, to: overlong); precondition(overlong.configurationRejected && !overlong.bootstrapObserved)
        let budget = make(); add(String(repeating: "x\n", count: 65537), to: budget); precondition(budget.exceeded && !budget.bootstrapObserved)
        print("PASS NativePublicBootstrap final-config+v3+20/3+provider+gateway; missing/cross-stream/wrong/sticky/line-total-cap negatives; bootstrap only")
    }
}
