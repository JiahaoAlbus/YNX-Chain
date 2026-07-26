package explorer

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
	"github.com/JiahaoAlbus/YNX-Chain/internal/stablereserve"
)

func LoadStableReserveIntegration(path, publicKeyValue, keyID, asset, network, sourceCommit string, maxAge time.Duration) (*economics.StableReserveIntegration, error) {
	path = strings.TrimSpace(path)
	publicKeyValue = strings.TrimSpace(publicKeyValue)
	keyID = strings.TrimSpace(keyID)
	if path == "" || publicKeyValue == "" || keyID == "" {
		return nil, errors.New("reserve attestation path, public key and key ID are required together")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read stable reserve attestation: %w", err)
	}
	var attestation stablereserve.Attestation
	if err := json.Unmarshal(raw, &attestation); err != nil {
		return nil, fmt.Errorf("decode stable reserve attestation: %w", err)
	}
	publicKey, err := base64.RawStdEncoding.DecodeString(publicKeyValue)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return nil, errors.New("reserve public key must be a base64 raw Ed25519 public key")
	}
	integration, err := economics.BuildStableReserveIntegration(sourceCommit, stablereserve.Verifier{
		Keys: map[string]ed25519.PublicKey{keyID: publicKey}, MaxAge: maxAge,
		Asset: strings.TrimSpace(asset), Network: strings.TrimSpace(network),
	}, attestation)
	if err != nil {
		return nil, fmt.Errorf("verify stable reserve attestation: %w", err)
	}
	return &integration, nil
}

func (s *Server) handleStableReserve(w http.ResponseWriter, r *http.Request) {
	requestID := economicsRequestID(r)
	traceID := economicsTraceID(r)
	w.Header().Set("X-Request-ID", requestID)
	w.Header().Set("X-Trace-ID", traceID)
	integration, event, available := s.currentStableReserve(time.Now().UTC())
	if !available {
		writeJSON(w, 503, map[string]any{
			"schemaVersion": 1, "source": "stable-reserve-provider-ingress", "asOf": nil,
			"version": 1, "coverage": "unavailable", "confidence": "unavailable",
			"failure": true, "failureCodes": []string{"YNX_STABLE_RESERVE_UNAVAILABLE"},
			"requestId": requestID, "traceId": traceID,
			"release": economics.IntegrationReleaseStates{},
		})
		return
	}
	writeJSON(w, 200, map[string]any{
		"schemaVersion": 1, "source": event.Snapshot.Source, "asOf": event.Snapshot.AsOf,
		"version": event.Snapshot.Version, "coverage": "provider-signed-reserve-supply-and-pending-redemption",
		"confidence": "cryptographically-verified-provider-assertion-not-independent-audit",
		"failure":    event.Snapshot.Failure, "failureCodes": event.Snapshot.FailureCodes,
		"requestId": requestID, "traceId": traceID, "sourceCommit": integration.SourceCommit,
		"eventId": event.ID, "eventType": event.Type, "integrationHash": integration.IntegrationHash,
		"reserve": event.Snapshot, "explorer": integration.Explorer, "monitor": integration.Monitor,
		"release": integration.ReleaseStates,
	})
}

func (s *Server) currentStableReserve(now time.Time) (economics.StableReserveIntegration, economics.StableReserveEvent, bool) {
	s.stableReserveMu.RLock()
	defer s.stableReserveMu.RUnlock()
	if s.stableReserveIntegration == nil {
		return economics.StableReserveIntegration{}, economics.StableReserveEvent{}, false
	}
	integration := *s.stableReserveIntegration
	if economics.ValidateStableReserveIntegration(integration) != nil {
		return economics.StableReserveIntegration{}, economics.StableReserveEvent{}, false
	}
	var event economics.StableReserveEvent
	if json.Unmarshal(integration.Envelope.Payload, &event) != nil {
		return economics.StableReserveIntegration{}, economics.StableReserveEvent{}, false
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, event.Snapshot.ExpiresAt)
	if err != nil || now.After(expiresAt) {
		return economics.StableReserveIntegration{}, economics.StableReserveEvent{}, false
	}
	return integration, event, true
}

func (s *Server) stableReserveMetricsPrometheus(now time.Time) string {
	_, event, available := s.currentStableReserve(now)
	availableValue := 0
	solventValue := 0
	coverage := uint64(0)
	shortfall := uint64(0)
	expiry := int64(0)
	labels := `asset="unavailable",network="unavailable",provider="unavailable"`
	if available {
		availableValue = 1
		if event.Snapshot.Solvent {
			solventValue = 1
		}
		coverage = event.Snapshot.CoverageBPS
		shortfall = event.Snapshot.ShortfallUnits
		expiresAt, _ := time.Parse(time.RFC3339Nano, event.Snapshot.ExpiresAt)
		expiry = expiresAt.Unix()
		labels = fmt.Sprintf(`asset="%s",network="%s",provider="%s"`,
			prometheusLabel(event.Snapshot.Asset), prometheusLabel(event.Snapshot.Network), prometheusLabel(event.Snapshot.Provider))
	}
	if coverage > math.MaxInt64 {
		coverage = math.MaxInt64
	}
	var output strings.Builder
	output.WriteString("# HELP ynx_explorer_stable_reserve_attestation_available Whether a fresh verified reserve attestation is available.\n# TYPE ynx_explorer_stable_reserve_attestation_available gauge\n")
	output.WriteString("ynx_explorer_stable_reserve_attestation_available{" + labels + "} " + strconv.Itoa(availableValue) + "\n")
	output.WriteString("# HELP ynx_explorer_stable_reserve_solvent Whether reserve covers supply plus pending redemptions.\n# TYPE ynx_explorer_stable_reserve_solvent gauge\n")
	output.WriteString("ynx_explorer_stable_reserve_solvent{" + labels + "} " + strconv.Itoa(solventValue) + "\n")
	output.WriteString("# HELP ynx_explorer_stable_reserve_coverage_bps Reserve coverage in basis points.\n# TYPE ynx_explorer_stable_reserve_coverage_bps gauge\n")
	output.WriteString("ynx_explorer_stable_reserve_coverage_bps{" + labels + "} " + strconv.FormatUint(coverage, 10) + "\n")
	output.WriteString("# HELP ynx_explorer_stable_reserve_shortfall_units Reserve shortfall in smallest asset units.\n# TYPE ynx_explorer_stable_reserve_shortfall_units gauge\n")
	output.WriteString("ynx_explorer_stable_reserve_shortfall_units{" + labels + "} " + strconv.FormatUint(shortfall, 10) + "\n")
	output.WriteString("# HELP ynx_explorer_stable_reserve_attestation_expiry_timestamp_seconds Attestation expiry time.\n# TYPE ynx_explorer_stable_reserve_attestation_expiry_timestamp_seconds gauge\n")
	output.WriteString("ynx_explorer_stable_reserve_attestation_expiry_timestamp_seconds{" + labels + "} " + strconv.FormatInt(expiry, 10) + "\n")
	return output.String()
}
