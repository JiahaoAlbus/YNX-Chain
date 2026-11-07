package ynxresourcepolicy

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxresourceconsent"
)

// This is the existing PUBLIC mathematical fixture. It carries no private
// material and is not used to manufacture a registered-policy reader result.
func publicResourceInputs(t *testing.T) (ynxbatch.NetworkResourceConsentBinding, []byte, []byte, int64) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "ynxbatch", "testdata", "network-resource-consent-v1-public.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		SyntheticOnly    bool   `json:"syntheticOnly"`
		AuthorityGranted bool   `json:"authorityGranted"`
		NowMillis        int64  `json:"nowMillis"`
		InputHex         string `json:"inputHex"`
		ScopeOriginal    string `json:"scopeOriginal"`
		PKA              string `json:"pkA"`
		PKB              string `json:"pkB"`
		Binding          struct {
			NetworkID            string `json:"networkId"`
			CanonicalSignerOwner string `json:"canonicalSignerOwner"`
			KeyEpoch             string `json:"keyEpoch"`
			IssuedHeight         string `json:"issuedHeight"`
		} `json:"binding"`
	}
	if json.Unmarshal(raw, &fixture) != nil || !fixture.SyntheticOnly || fixture.AuthorityGranted {
		t.Fatal("invalid original PUBLIC fixture")
	}
	decode := func(value string) []byte {
		out, err := hex.DecodeString(value)
		if err != nil {
			t.Fatal("invalid PUBLIC fixture encoding")
		}
		return out
	}
	binding := ynxbatch.NetworkResourceConsentBinding{NetworkID: decode(fixture.Binding.NetworkID), Owner: fixture.Binding.CanonicalSignerOwner, KeyEpoch: fixture.Binding.KeyEpoch, IssuedHeight: fixture.Binding.IssuedHeight, PKA: decode(fixture.PKA), PKB: decode(fixture.PKB)}
	return binding, []byte(fixture.ScopeOriginal), decode(fixture.InputHex), fixture.NowMillis
}

// Every state below was emitted by the original FinalizeBlock/Commit test,
// with actual classic authorization, dual possession, rotation and revocation.
// This bundle is PUBLIC synthetic evidence, not deployment pins or authority.
// Loading it generates no key and performs no signing or production mutation.
func checkpointRequests(t *testing.T) (map[string]consensus.PQWalletPolicyReadRequest, map[string]ynxbatch.NetworkResourceConsentBinding) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "checkpoint-public.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Version          string
		SyntheticOnly    bool
		AuthorityGranted bool
		Common           map[string]string
		Stages           map[string]map[string]string
	}
	if json.Unmarshal(raw, &fixture) != nil || fixture.Version != "YNX-RESOURCE-POLICY-CONSUMER-PUBLIC/v1" || !fixture.SyntheticOnly || fixture.AuthorityGranted {
		t.Fatal("invalid PUBLIC original-checkpoint fixture")
	}
	var migration chain.ConsensusMigrationState
	if json.Unmarshal([]byte(fixture.Common["migration.json"]), &migration) != nil {
		t.Fatal("invalid PUBLIC migration")
	}
	requests := make(map[string]consensus.PQWalletPolicyReadRequest)
	bindings := make(map[string]ynxbatch.NetworkResourceConsentBinding)
	for _, name := range []string{"registered", "rotated", "revoked"} {
		stage := fixture.Stages[name]
		var metadata struct {
			SyntheticOnly bool
			Pins          consensus.ConsensusBootstrapPins
			ScheduleHash  string
			Checkpoint    consensus.PQWalletPolicyCheckpoint
			Owner         string
		}
		if json.Unmarshal([]byte(stage["inputs.json"]), &metadata) != nil || !metadata.SyntheticOnly {
			t.Fatal("invalid PUBLIC independent test inputs")
		}
		bootstrap, err := consensus.NewConsensusBootstrap([]byte(fixture.Common["genesis.json"]), metadata.Pins, migration)
		if err != nil {
			t.Fatal("original bootstrap rejected PUBLIC fixture", err)
		}
		authorization, err := consensus.NewPQEngineAuthorization([]byte(fixture.Common["schedule.json"]), metadata.ScheduleHash)
		if err != nil {
			t.Fatal("original schedule rejected PUBLIC fixture", err)
		}
		path := filepath.Join(t.TempDir(), "original-state.json")
		if err := os.WriteFile(path, []byte(stage["state.json"]), 0600); err != nil {
			t.Fatal(err)
		}
		requests[name] = consensus.PQWalletPolicyReadRequest{Migration: migration, StatePath: path, Bootstrap: bootstrap, EngineAuthorization: authorization, Checkpoint: metadata.Checkpoint, Owner: metadata.Owner}
		// The fixture's known public registrations supply EXPECTED test values;
		// this extraction is not an alternate production reader or trust source.
		// The actual callee must independently reconstruct and validate all bytes.
		var state struct{ AccountPolicy ynxauth.State }
		if json.Unmarshal([]byte(stage["state.json"]), &state) != nil || len(state.AccountPolicy.Records) == 0 {
			t.Fatal("PUBLIC original lacks test registration")
		}
		var record ynxauth.Record
		for _, candidate := range state.AccountPolicy.Records {
			if candidate.Owner == metadata.Owner {
				record = candidate
			}
		}
		if record.Owner != metadata.Owner {
			t.Fatal("PUBLIC fixture has no expected owner record")
		}
		bindings[name] = ynxbatch.NetworkResourceConsentBinding{NetworkID: bytes.Clone(state.AccountPolicy.NetworkID), Owner: metadata.Owner, PKA: bytes.Clone(record.PKA), PKB: bytes.Clone(record.PKB), KeyEpoch: strconv.FormatUint(record.Revision, 10), IssuedHeight: strconv.FormatUint(record.ActiveFrom, 10)}
	}
	return requests, bindings
}

func TestResourcePolicyPUBLICOriginalLedgerConsumer(t *testing.T) {
	requests, bindings := checkpointRequests(t)
	request, binding := requests["registered"], bindings["registered"]
	binding.NetworkID, binding.PKA, binding.PKB = bytes.Clone(binding.NetworkID), bytes.Clone(binding.PKA), bytes.Clone(binding.PKB)
	_, scope, input, now := publicResourceInputs(t)
	beforeInfo, err := os.Stat(request.StatePath)
	if err != nil || beforeInfo.Mode().Perm() != 0600 {
		t.Fatal("PUBLIC copy did not preserve the original ledger mode")
	}
	before, err := os.ReadFile(request.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	current, err := ReadAtCheckpoint(context.Background(), request, binding)
	if err != nil {
		t.Fatal("actual original registered ledger rejected", err)
	}
	qualified, err := QualifyAtCheckpoint(context.Background(), current.state.read, binding)
	if err != nil {
		t.Fatal("actual sealed backend result rejected by fixed consumer", err)
	}
	origin, err := qualified.Origin()
	if err != nil || origin != consensus.PQWalletPolicyIndependentCheckpointInput {
		t.Fatal("input checkpoint was relabelled independent finality or local engine")
	}
	checkpoint, err := current.Checkpoint()
	if err != nil || checkpoint != request.Checkpoint {
		t.Fatal("original checkpoint identity lost")
	}
	view, err := current.OwnerPolicy()
	if err != nil || view.CommittedHeight != 2 || view.ExecutionHeight != 3 || view.LedgerNonce != 1 || view.CommittedRegistration != nil || view.ExecutionRegistration == nil || view.ExecutionRegistration.Revision != 1 || view.CommittedPQSigningEnabled || !view.PQSigningEnabled {
		t.Fatal("committed versus next execution registration boundary lost")
	}
	networkBefore := view.NetworkID
	data, err := current.DataAtCheckpoint(now)
	if err != nil || data.SubjectOwner != binding.Owner || data.ExecutionHeight != 3 || data.NowMillis != now {
		t.Fatal("actual checkpoint did not supply the existing CurrentDATA contract")
	}
	// Existing math is the sole scope/purpose/window validator. No key is
	// imported or selected: this tests the original Auth Current consumer shape.
	attempt, err := ynxresourceconsent.PrepareMaterial(scope, input, binding, data)
	if err != nil {
		t.Fatal("original fixed resource backend rejected actual registered CurrentDATA", err)
	}
	defer attempt.Close()
	if err := attempt.Current(data); err != nil {
		t.Fatal("original fixed Current rejected checkpoint DATA", err)
	}
	if out := attempt.OriginalOutcome(); out.AttemptSelected || out.SignatureVerified || len(out.MemberOriginal) != 0 {
		t.Fatal("readonly reader or Prepare selected signing")
	}
	if out, err := attempt.ConfirmCurrent(data); err == nil || out.CurrentDataMatched || out.SignatureVerified {
		t.Fatal("readonly policy read became signed consent")
	}
	for _, clock := range []int64{-1, 9007199254740992} {
		if _, err := current.DataAtCheckpoint(clock); !errors.Is(err, ErrCurrent) {
			t.Fatal("non-exact independent clock accepted")
		}
	}
	expired, err := current.DataAtCheckpoint(now + 25*60*60*1000)
	if err != nil {
		t.Fatal(err)
	}
	if renewed, err := ynxresourceconsent.PrepareMaterial(scope, input, binding, expired); err == nil || renewed != nil {
		t.Fatal("checkpoint or later caller clock renewed original scope window")
	}
	copyOfCurrent := *current
	data.PolicyOriginal[0] ^= 1
	view.PolicyOriginal[0] ^= 1
	view.ExecutionRegistration.PKA[0] ^= 1
	view.NetworkID[0] ^= 1
	binding.PKB[0] ^= 1
	again, err := copyOfCurrent.DataAtCheckpoint(now + 1)
	freshView, viewErr := copyOfCurrent.OwnerPolicy()
	if err != nil || viewErr != nil || again.PolicyOriginal[0] != '{' || freshView.PolicyOriginal[0] != '{' || !bytes.Equal(freshView.ExecutionRegistration.PKA, bindings["registered"].PKA) || freshView.NetworkID != networkBefore || again.NowMillis != now+1 {
		t.Fatal("caller-owned copies changed immutable reader/current contents")
	}
	after, err := os.ReadFile(request.StatePath)
	afterInfo, statErr := os.Stat(request.StatePath)
	if err != nil || statErr != nil || !bytes.Equal(before, after) || afterInfo.Mode() != beforeInfo.Mode() || !os.SameFile(beforeInfo, afterInfo) {
		t.Fatal("readonly consumer changed original ledger bytes")
	}

	t.Run("sealed-public-substitution", func(t *testing.T) {
		original := bindings["registered"]
		original.PKB = bytes.Clone(freshView.ExecutionRegistration.PKB)
		for name, alter := range map[string]func(*ynxbatch.NetworkResourceConsentBinding, *consensus.PQWalletPolicyCheckpoint, *uint64, *uint64){
			"network": func(b *ynxbatch.NetworkResourceConsentBinding, _ *consensus.PQWalletPolicyCheckpoint, _, _ *uint64) {
				b.NetworkID[0] ^= 1
			},
			"owner": func(b *ynxbatch.NetworkResourceConsentBinding, _ *consensus.PQWalletPolicyCheckpoint, _, _ *uint64) {
				b.Owner = "0x" + string(bytes.Repeat([]byte{'2'}, 40))
			},
			"pka": func(b *ynxbatch.NetworkResourceConsentBinding, _ *consensus.PQWalletPolicyCheckpoint, _, _ *uint64) {
				b.PKA[0] ^= 1
			},
			"pkb": func(b *ynxbatch.NetworkResourceConsentBinding, _ *consensus.PQWalletPolicyCheckpoint, _, _ *uint64) {
				b.PKB[0] ^= 1
			},
			"epoch": func(b *ynxbatch.NetworkResourceConsentBinding, _ *consensus.PQWalletPolicyCheckpoint, epoch, _ *uint64) {
				b.KeyEpoch, *epoch = "2", 2
			},
			"issued-before-active": func(b *ynxbatch.NetworkResourceConsentBinding, _ *consensus.PQWalletPolicyCheckpoint, _, issued *uint64) {
				b.IssuedHeight, *issued = "2", 2
			},
			"issued-after-execution": func(b *ynxbatch.NetworkResourceConsentBinding, _ *consensus.PQWalletPolicyCheckpoint, _, issued *uint64) {
				b.IssuedHeight, *issued = "4", 4
			},
			"checkpoint-height": func(_ *ynxbatch.NetworkResourceConsentBinding, c *consensus.PQWalletPolicyCheckpoint, _, _ *uint64) {
				c.Height++
			},
			"checkpoint-hash": func(_ *ynxbatch.NetworkResourceConsentBinding, c *consensus.PQWalletPolicyCheckpoint, _, _ *uint64) {
				c.AppHash[0] ^= 1
			},
		} {
			t.Run(name, func(t *testing.T) {
				bad := original
				bad.NetworkID, bad.PKA, bad.PKB = bytes.Clone(original.NetworkID), bytes.Clone(original.PKA), bytes.Clone(original.PKB)
				selected, epoch, issued := checkpoint, uint64(1), uint64(3)
				alter(&bad, &selected, &epoch, &issued)
				if result, err := bindRead(current.state.read, selected, bad, epoch, issued); !errors.Is(err, ErrCurrent) || result != nil {
					t.Fatal("sealed original reader accepted substituted binding")
				}
			})
		}
		if result, err := bindRead(new(consensus.PQWalletPolicyAtCheckpoint), checkpoint, original, 1, 3); !errors.Is(err, ErrCurrent) || result != nil {
			t.Fatal("public view or zero reader became a sealed original")
		}
	})

	rotated, err := ReadAtCheckpoint(context.Background(), requests["rotated"], bindings["rotated"])
	if err != nil {
		t.Fatal("actual dual-authorized rotated ledger rejected", err)
	}
	rotatedData, err := rotated.DataAtCheckpoint(now + 1)
	rotatedView, viewErr := rotated.OwnerPolicy()
	if err != nil || viewErr != nil || rotatedView.ExecutionRegistration == nil || rotatedView.ExecutionRegistration.Revision != 2 || rotatedData.ExecutionHeight != 6 || rotatedView.LedgerNonce != 2 {
		t.Fatal("actual rotation policy/height/nonce lost")
	}
	if err := attempt.Current(rotatedData); err == nil {
		t.Fatal("old resource attempt accepted a replacement registered pair")
	}
	if err := attempt.Current(again); err == nil {
		t.Fatal("failed current recovered by replaying older checkpoint")
	}
	if result, err := ReadAtCheckpoint(context.Background(), requests["revoked"], bindings["revoked"]); !errors.Is(err, ErrCurrent) || result != nil {
		t.Fatal("actual full-history tombstone granted resource CurrentDATA")
	}
	badCheckpoint := request
	badCheckpoint.Checkpoint.AppHash[0] ^= 1
	if result, err := ReadAtCheckpoint(context.Background(), badCheckpoint, bindings["registered"]); err == nil || result != nil {
		t.Fatal("self-reported or mismatched checkpoint accepted")
	}
	attempt.Retire()
	if !attempt.Drain() || !attempt.Close() {
		t.Fatal("readonly consumer acquired unexplained math debt")
	}
}

func TestResourcePolicyPUBLICReaderRejectionAndNoAuthority(t *testing.T) {
	binding, _, _, now := publicResourceInputs(t)
	missing := filepath.Join(t.TempDir(), "not-created")
	request := consensus.PQWalletPolicyReadRequest{Owner: binding.Owner, StatePath: missing}
	if result, err := ReadAtCheckpoint(context.Background(), request, binding); err == nil || result != nil {
		t.Fatal("PUBLIC expected tuple substituted for independent backend authority")
	}
	if _, err := os.Stat(missing); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("readonly policy rejection created or changed a state path")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if result, err := ReadAtCheckpoint(ctx, request, binding); !errors.Is(err, context.Canceled) || result != nil {
		t.Fatal("cancelled caller entered a readonly loan")
	}
	if result, err := ReadAtCheckpoint(nil, request, binding); !errors.Is(err, ErrCurrent) || result != nil {
		t.Fatal("missing caller context accepted")
	}
	for _, zero := range []*consensus.PQWalletPolicyAtCheckpoint{nil, new(consensus.PQWalletPolicyAtCheckpoint)} {
		if result, err := QualifyAtCheckpoint(context.Background(), zero, binding); !errors.Is(err, ErrCurrent) || result != nil {
			t.Fatal("PUBLIC view or unconstructed reader qualified as original ledger")
		}
	}
	for name, alter := range map[string]func(*ynxbatch.NetworkResourceConsentBinding){
		"owner": func(b *ynxbatch.NetworkResourceConsentBinding) {
			b.Owner = "0x" + string(bytes.Repeat([]byte{'0'}, 40))
		},
		"network":     func(b *ynxbatch.NetworkResourceConsentBinding) { b.NetworkID = b.NetworkID[:31] },
		"full-pka":    func(b *ynxbatch.NetworkResourceConsentBinding) { b.PKA = b.PKA[:len(b.PKA)-1] },
		"full-pkb":    func(b *ynxbatch.NetworkResourceConsentBinding) { b.PKB = nil },
		"epoch-zero":  func(b *ynxbatch.NetworkResourceConsentBinding) { b.KeyEpoch = "0" },
		"epoch-text":  func(b *ynxbatch.NetworkResourceConsentBinding) { b.KeyEpoch = "01" },
		"issued-text": func(b *ynxbatch.NetworkResourceConsentBinding) { b.IssuedHeight = "01" },
		"issued-u64":  func(b *ynxbatch.NetworkResourceConsentBinding) { b.IssuedHeight = "18446744073709551616" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := binding
			alter(&bad)
			if result, err := ReadAtCheckpoint(context.Background(), request, bad); !errors.Is(err, ErrCurrent) || result != nil {
				t.Fatal("invalid independent binding reached backend reader")
			}
		})
	}
	for _, zero := range []*CurrentAtCheckpoint{nil, new(CurrentAtCheckpoint)} {
		if _, err := zero.DataAtCheckpoint(now); err == nil {
			t.Fatal("zero consumer produced current DATA")
		}
		if _, err := zero.Checkpoint(); err == nil {
			t.Fatal("zero consumer produced checkpoint")
		}
		if _, err := zero.Origin(); err == nil {
			t.Fatal("zero consumer produced checkpoint origin")
		}
		if _, err := zero.OwnerPolicy(); err == nil {
			t.Fatal("zero consumer produced owner policy")
		}
	}
}
