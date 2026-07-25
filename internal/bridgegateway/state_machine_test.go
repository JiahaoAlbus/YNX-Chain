package bridgegateway

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func finalizeProofBundle(t *testing.T, b *testBridge, key string) MutationResult {
	t.Helper()
	created, err := b.service.CreateTransfer(validCreate(key + "-create"))
	if err != nil {
		t.Fatal(err)
	}
	block := "0x" + strings.Repeat("c", 64)
	for _, relayer := range []string{"relayer-a", "relayer-b"} {
		if _, err := b.service.AddAttestation(created.Transfer.ID, b.signedAttestation(t, created.Transfer, relayer, block, 12)); err != nil {
			t.Fatal(err)
		}
	}
	result, err := b.service.Finalize(created.Transfer.ID, FinalizeRequest{IdempotencyKey: key + "-finalize"})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestBridgeProofVerificationRejectsTamperAndReplaysExactly(t *testing.T) {
	b := newTestBridge(t)
	proof := finalizeProofBundle(t, b, "proof-contract")
	request := ProofVerificationRequest{
		IdempotencyKey: "proof-contract-verify",
		ProofType:      proof.Transfer.ProofType,
		ProofDigest:    proof.Transfer.ProofDigest,
	}

	tampered := request
	tampered.IdempotencyKey = "proof-contract-tampered"
	tampered.ProofDigest = "sha256:" + strings.Repeat("0", 64)
	if _, err := b.service.VerifyProof(proof.Transfer.ID, tampered); !errors.Is(err, ErrInvalid) {
		t.Fatalf("tampered proof digest accepted: %v", err)
	}
	wrongType := request
	wrongType.IdempotencyKey = "proof-contract-wrong-type"
	wrongType.ProofType = "merkle-proof"
	if _, err := b.service.VerifyProof(proof.Transfer.ID, wrongType); !errors.Is(err, ErrInvalid) {
		t.Fatalf("wrong proof type accepted: %v", err)
	}

	verified, err := b.service.VerifyProof(proof.Transfer.ID, request)
	if err != nil || verified.Replayed || verified.Transfer.Phase != phaseProofVerified || verified.Transfer.ProofVerifiedAt == "" {
		t.Fatalf("valid proof verification failed: %+v %v", verified, err)
	}
	replay, err := b.service.VerifyProof(proof.Transfer.ID, request)
	if err != nil || !replay.Replayed || replay.Transfer.ProofDigest != proof.Transfer.ProofDigest {
		t.Fatalf("exact proof replay failed: %+v %v", replay, err)
	}
	changedReplay := request
	changedReplay.ProofDigest = "sha256:" + strings.Repeat("1", 64)
	if _, err := b.service.VerifyProof(proof.Transfer.ID, changedReplay); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed proof replay was not rejected: %v", err)
	}

	state := cloneState(b.service.state)
	transfer := state.Transfers[proof.Transfer.ID]
	transfer.ProofDigest = "sha256:" + strings.Repeat("2", 64)
	state.Transfers[transfer.ID] = transfer
	if err := saveState(b.state, &state); err != nil {
		t.Fatal(err)
	}
	if _, err := New(b.cfg); err == nil || !strings.Contains(err.Error(), "proof bundle is inconsistent") {
		t.Fatalf("resealed proof tamper survived restart: %v", err)
	}
}

func TestBridgeV6LifecycleMigratesWithoutInventingDestinationAvailability(t *testing.T) {
	b := newTestBridge(t)
	proof := finalizeProofBundle(t, b, "v6-lifecycle")
	state := cloneState(b.service.state)
	transfer := state.Transfers[proof.Transfer.ID]
	for index := range transfer.Lifecycle {
		if transfer.Lifecycle[index].Phase == phaseProofAttestationAvailable {
			transfer.Lifecycle[index].Phase = "proof_attestation"
		}
	}
	appendLifecycle(&transfer, "destination_mint_release", transfer.UpdatedAt, "tx:v6-destination", "operator-observed", "operator-submitted-evidence")
	appendLifecycle(&transfer, "destination_confirmed", transfer.UpdatedAt, "receipt:v6-destination", "finalized-receipt", "operator-submitted-evidence")
	transfer.Phase = "destination_confirmed"
	transfer.ExposureStatus = "destination-confirmed"
	prepareLegacyTransferForStateMachineMigration(&transfer)
	state.Transfers[transfer.ID] = transfer
	state.SchemaVersion = 6
	if err := saveState(b.state, &state); err != nil {
		t.Fatal(err)
	}

	migrated, err := New(b.cfg)
	if err != nil {
		t.Fatalf("v6 lifecycle migration failed: %v", err)
	}
	got := migrated.state.Transfers[transfer.ID]
	if migrated.state.SchemaVersion != SchemaVersion || got.StateMachineVersion != "ynx.bridge.lifecycle.legacy.v0" || got.Phase != phaseDestinationActionConfirmed {
		t.Fatalf("v6 lifecycle identity was not migrated: %+v", got)
	}
	if got.DestinationAssetAvailable || got.DestinationAvailableAt != "" || got.ExposureStatus != "destination-confirmed-legacy" {
		t.Fatalf("v6 confirmation was incorrectly promoted to availability: %+v", got)
	}
	persisted, err := os.ReadFile(b.state)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(persisted), `"schemaVersion": 7`) {
		t.Fatalf("v6 state was not resealed as v7: %s", persisted)
	}
}

func TestBridgeStateMachineAndVersionEndpointsExposeRuntimeTruth(t *testing.T) {
	b := newTestBridge(t)
	server := NewServer(b.service).Handler()

	versionRequest := httptest.NewRequest(http.MethodGet, "/version", nil)
	versionRequest.RemoteAddr = "192.0.2.10:1010"
	versionResponse := httptest.NewRecorder()
	server.ServeHTTP(versionResponse, versionRequest)
	if versionResponse.Code != http.StatusOK {
		t.Fatalf("version endpoint status: %d %s", versionResponse.Code, versionResponse.Body.String())
	}
	var version map[string]any
	if err := json.Unmarshal(versionResponse.Body.Bytes(), &version); err != nil {
		t.Fatal(err)
	}
	if version["service"] != "ynx-bridged" || int(version["schemaVersion"].(float64)) != SchemaVersion || version["stateMachineVersion"] != StateMachineVersion || version["startedAt"] == "" || version["degraded"] != true || version["providerStatus"] != "unavailable-no-verified-provider-connection" || version["contractStatus"] != "unavailable-no-verified-contract-deployment" || version["liveBridge"] != false || version["externalSubmissionEnabled"] != false {
		t.Fatalf("version endpoint overstated runtime status: %+v", version)
	}

	machineRequest := httptest.NewRequest(http.MethodGet, "/bridge/state-machine", nil)
	machineRequest.RemoteAddr = "192.0.2.11:1011"
	machineResponse := httptest.NewRecorder()
	server.ServeHTTP(machineResponse, machineRequest)
	if machineResponse.Code != http.StatusOK {
		t.Fatalf("state machine endpoint status: %d %s", machineResponse.Code, machineResponse.Body.String())
	}
	var descriptor StateMachineDescriptor
	if err := json.Unmarshal(machineResponse.Body.Bytes(), &descriptor); err != nil {
		t.Fatal(err)
	}
	if descriptor.Version != StateMachineVersion || len(descriptor.States) != 19 || len(descriptor.Transitions) == 0 {
		t.Fatalf("state machine descriptor is incomplete: %+v", descriptor)
	}
	foundAvailabilityBoundary := false
	for _, state := range descriptor.States {
		if state.ID == phaseDestinationAvailable && state.DestinationAssetAvailable && state.Terminal {
			foundAvailabilityBoundary = true
		}
		if state.ID == phaseDestinationActionConfirmed && state.DestinationAssetAvailable {
			t.Fatalf("destination confirmation incorrectly advertises asset availability: %+v", state)
		}
	}
	if !foundAvailabilityBoundary {
		t.Fatal("destination availability boundary is missing")
	}
	if descriptor.LegacyAliases["refund_recovery"] != phaseRefunded || descriptor.LegacyAliases["destination_confirmed"] != phaseDestinationActionConfirmed {
		t.Fatalf("legacy aliases do not match runtime behavior: %+v", descriptor.LegacyAliases)
	}
}

func TestBridgeProofVerificationEndpointUsesAuthenticatedRuntimeVerifier(t *testing.T) {
	b := newTestBridge(t)
	proof := finalizeProofBundle(t, b, "proof-http")
	requestBody, err := json.Marshal(ProofVerificationRequest{
		IdempotencyKey: "proof-http-verify",
		ProofType:      proof.Transfer.ProofType,
		ProofDigest:    proof.Transfer.ProofDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/bridge/transfers/"+proof.Transfer.ID+"/proof-verification", strings.NewReader(string(requestBody)))
	request.RemoteAddr = "192.0.2.12:1012"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-Bridge-Key", testAPIKey)
	response := httptest.NewRecorder()
	NewServer(b.service).Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("proof endpoint status: %d %s", response.Code, response.Body.String())
	}
	var result MutationResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Replayed || result.Transfer.Phase != phaseProofVerified || result.Transfer.ProofVerificationStatus != "verified-threshold-relayer-attestation" {
		t.Fatalf("proof endpoint returned an invalid result: %+v", result)
	}
}
