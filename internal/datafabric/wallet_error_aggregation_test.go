package datafabric

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAggregateWalletCanonicalErrorVectors(t *testing.T) {
	vectors := []struct {
		code       string
		errorClass string
		retryable  bool
	}{
		{"USER_REJECTED", "user-rejected", false},
		{"UNAUTHORIZED", "session-binding", false},
		{"UNSUPPORTED_METHOD", "protocol", false},
		{"PROVIDER_DISCONNECTED", "relay-unavailable", true},
		{"CHAIN_DISCONNECTED", "relay-unavailable", true},
		{"UNKNOWN_CHAIN", "protocol", true},
		{"GATEWAY_UNAVAILABLE", "gateway-unavailable", true},
		{"ROUTE_NOT_MOUNTED", "endpoint-schema", true},
		{"DEVICE_NOT_REGISTERED", "device-proof", false},
		{"INVALID_DEVICE_PROOF", "device-proof", false},
		{"DEVICE_KEY_MISMATCH", "device-key", false},
		{"REGISTRY_VERSION_MISMATCH", "registry", true},
		{"ORIGIN_NOT_REGISTERED", "registry", false},
		{"ORIGIN_MISMATCH", "session-binding", false},
		{"CALLBACK_MISMATCH", "callback", false},
		{"PACKAGE_MISMATCH", "registry", false},
		{"UNKNOWN_PRODUCT", "registry", false},
		{"CLIENT_RETIRED", "client-retired", false},
		{"PRODUCT_SESSION_REQUIRED", "session-binding", true},
		{"PRODUCT_SESSION_EXPIRED", "expiry-or-clock-skew", true},
		{"PRODUCT_SESSION_REVOKED", "session-binding", false},
		{"SCOPE_NOT_ALLOWED", "session-binding", false},
		{"REPLAY", "protocol", false},
		{"CLOCK_SKEW", "expiry-or-clock-skew", true},
		{"VERSION_INCOMPATIBLE", "protocol", false},
		{"UPGRADE_REQUIRED", "client-retired", false},
	}

	if got := len(walletCanonicalErrorAggregates); got != len(vectors) {
		t.Fatalf("mapping size changed without a vector: got=%d want=%d", got, len(vectors))
	}
	for _, vector := range vectors {
		t.Run(vector.code, func(t *testing.T) {
			aggregate, err := AggregateWalletCanonicalError(vector.code)
			if err != nil {
				t.Fatal(err)
			}
			if aggregate.ErrorClass != vector.errorClass || aggregate.Retryable != vector.retryable {
				t.Fatalf("aggregate=%+v want errorClass=%q retryable=%t", aggregate, vector.errorClass, vector.retryable)
			}
		})
	}
}

func TestAggregateWalletCanonicalErrorRejectsUnknownAndCannotPersistSourceDetails(t *testing.T) {
	const unknown = "UNRECOGNIZED_UPSTREAM_ERROR"
	if _, err := AggregateWalletCanonicalError(unknown); ErrorCodeOf(err) != CodeSchemaCompatibilityViolation {
		t.Fatalf("unknown canonical code was not rejected: %v", err)
	} else if strings.Contains(err.Error(), unknown) || len(ErrorEvidenceOf(err)) != 0 {
		t.Fatalf("rejection retained the upstream code: %v", err)
	}

	aggregate, err := AggregateWalletCanonicalError("GATEWAY_UNAVAILABLE")
	if err != nil {
		t.Fatal(err)
	}
	event := connectionEventFixture("event.connection.aggregate.0001", "wallet.connection.rejected", 1)
	event.ErrorClass, event.Retryable = aggregate.ErrorClass, aggregate.Retryable
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	for _, prohibited := range []string{"GATEWAY_UNAVAILABLE", "Product Session Gateway could not be reached", "developerMessage", "walletAddress", "accountId"} {
		if strings.Contains(string(encoded), prohibited) {
			t.Fatalf("connection event retained prohibited source detail %q: %s", prohibited, encoded)
		}
	}
	if err := event.Validate(); err != nil {
		t.Fatalf("aggregate did not remain within the accepted event schema: %v", err)
	}

	event.ErrorClass = "GATEWAY_UNAVAILABLE"
	if err := event.Validate(); ErrorCodeOf(err) != CodeSchemaCompatibilityViolation {
		t.Fatalf("raw canonical error code was accepted into an event: %v", err)
	}
}

func TestAggregateWalletConnectivityOnlyAccepts6423AndNeverReturnsRawInputs(t *testing.T) {
	for _, chainID := range []string{"6423", "0x1917"} {
		t.Run(chainID, func(t *testing.T) {
			aggregate, err := AggregateWalletConnectivity(chainID, "GATEWAY_UNAVAILABLE")
			if err != nil {
				t.Fatal(err)
			}
			if aggregate.ChainID != "0x1917" || aggregate.ErrorClass != "gateway-unavailable" || !aggregate.Retryable {
				t.Fatalf("unexpected bounded aggregate: %+v", aggregate)
			}
			encoded, err := json.Marshal(aggregate)
			if err != nil {
				t.Fatal(err)
			}
			for _, prohibited := range []string{"6423", "GATEWAY_UNAVAILABLE", "developerMessage", "accountId", "walletAddress"} {
				if strings.Contains(string(encoded), prohibited) {
					t.Fatalf("aggregate retained raw input %q: %s", prohibited, encoded)
				}
			}
		})
	}
	for _, chainID := range []string{"9102", "0x238e", "0x1", "unknown"} {
		t.Run("reject_"+chainID, func(t *testing.T) {
			if _, err := AggregateWalletConnectivity(chainID, "GATEWAY_UNAVAILABLE"); ErrorCodeOf(err) != CodeSchemaCompatibilityViolation || strings.Contains(err.Error(), chainID) || len(ErrorEvidenceOf(err)) != 0 {
				t.Fatalf("unsupported chain did not fail closed without retention: %v", err)
			}
		})
	}
}
