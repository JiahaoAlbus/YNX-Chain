import ExpoModulesCore

/** iOS HTTP is deliberately unavailable until the dedicated streamed-upload
 * delegate passes native iOS cancellation/replay/response-budget acceptance.
 * This module creates no URLSession and has no Fetch fallback. */
public class YnxFaucetTransportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("YnxFaucetTransport")

    Function("reserveTask") { (_: String) throws -> String in
      throw FaucetTransportUnavailable()
    }
    AsyncFunction("request") { (_: [String: Any]) throws -> [String: Any] in
      throw FaucetTransportUnavailable()
    }
    Function("cancel") { (_: String) in
      // No tasks can be created on this platform. Cancellation is idempotent.
    }
  }
}

private final class FaucetTransportUnavailable: Exception, @unchecked Sendable {
  override var code: String { "YNX_HTTP_UNAVAILABLE" }
  override var reason: String { "Faucet transport is not enabled." }
}
