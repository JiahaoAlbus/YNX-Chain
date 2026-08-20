package datafabric

// WalletCanonicalErrorSourceCommit pins the accepted Wallet/Auth error
// descriptor source consumed by this asynchronous adapter.
const WalletCanonicalErrorSourceCommit = "24cc3218c2cdc00c50dc3caa563652083afbd861"

// WalletErrorAggregate is the entire Wallet error representation that may be
// copied into a ConnectionEvent. It deliberately excludes the canonical code,
// messages, provider payload, identity, and correlation data.
type WalletErrorAggregate struct {
	ErrorClass string
	Retryable  bool
}

// AggregateWalletCanonicalError converts one accepted Wallet/Auth canonical
// error code into the already accepted, fixed-cardinality connection-event
// fields. The input is transient: callers must not persist it alongside the
// returned aggregate. Unknown codes fail closed instead of creating a new
// diagnostic dimension or leaking an upstream error value.
func AggregateWalletCanonicalError(code string) (WalletErrorAggregate, error) {
	aggregate, ok := walletCanonicalErrorAggregates[code]
	if !ok {
		return WalletErrorAggregate{}, Reject(CodeSchemaCompatibilityViolation, "wallet canonical error code is not accepted for connection aggregation", nil)
	}
	return aggregate, nil
}

var walletCanonicalErrorAggregates = map[string]WalletErrorAggregate{
	"USER_REJECTED":             {ErrorClass: "user-rejected", Retryable: false},
	"UNAUTHORIZED":              {ErrorClass: "session-binding", Retryable: false},
	"UNSUPPORTED_METHOD":        {ErrorClass: "protocol", Retryable: false},
	"PROVIDER_DISCONNECTED":     {ErrorClass: "relay-unavailable", Retryable: true},
	"CHAIN_DISCONNECTED":        {ErrorClass: "relay-unavailable", Retryable: true},
	"UNKNOWN_CHAIN":             {ErrorClass: "protocol", Retryable: true},
	"GATEWAY_UNAVAILABLE":       {ErrorClass: "gateway-unavailable", Retryable: true},
	"ROUTE_NOT_MOUNTED":         {ErrorClass: "endpoint-schema", Retryable: true},
	"DEVICE_NOT_REGISTERED":     {ErrorClass: "device-proof", Retryable: false},
	"INVALID_DEVICE_PROOF":      {ErrorClass: "device-proof", Retryable: false},
	"DEVICE_KEY_MISMATCH":       {ErrorClass: "device-key", Retryable: false},
	"REGISTRY_VERSION_MISMATCH": {ErrorClass: "registry", Retryable: true},
	"ORIGIN_NOT_REGISTERED":     {ErrorClass: "registry", Retryable: false},
	"ORIGIN_MISMATCH":           {ErrorClass: "session-binding", Retryable: false},
	"CALLBACK_MISMATCH":         {ErrorClass: "callback", Retryable: false},
	"PACKAGE_MISMATCH":          {ErrorClass: "registry", Retryable: false},
	"UNKNOWN_PRODUCT":           {ErrorClass: "registry", Retryable: false},
	"CLIENT_RETIRED":            {ErrorClass: "client-retired", Retryable: false},
	"PRODUCT_SESSION_REQUIRED":  {ErrorClass: "session-binding", Retryable: true},
	"PRODUCT_SESSION_EXPIRED":   {ErrorClass: "expiry-or-clock-skew", Retryable: true},
	"PRODUCT_SESSION_REVOKED":   {ErrorClass: "session-binding", Retryable: false},
	"SCOPE_NOT_ALLOWED":         {ErrorClass: "session-binding", Retryable: false},
	"REPLAY":                    {ErrorClass: "protocol", Retryable: false},
	"CLOCK_SKEW":                {ErrorClass: "expiry-or-clock-skew", Retryable: true},
	"VERSION_INCOMPATIBLE":      {ErrorClass: "protocol", Retryable: false},
	"UPGRADE_REQUIRED":          {ErrorClass: "client-retired", Retryable: false},
}
