//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Populate the original ledger through its normal faucet, then use the same
// four-store registration/activation fixture as the normal synthetic lab. This
// covers the 504-account JSON shape without manufacturing 504 PQ registrations,
// replacing source validators, starting nodes, or replaying the 33 MiB test.
func TestPQLabLiveMaterialsCompleteStateOriginalRSetupAndColdRead(t *testing.T) {
	root := filepath.Join(pqLabWorkloadTemp(t), "lab")
	cfg := chain.DefaultNetworkConfig("devnet")
	cfg.Name, cfg.Slug, cfg.ChainID = "Synthetic complete R state", "pq-lab-complete-r-state", PQLabNativeChainID
	cfg.IsPublicNet, cfg.ChainIDConflictCheck = false, "synthetic isolated source only"
	validators := make([]chain.Validator, 4)
	for i := range validators {
		validators[i] = chain.Validator{Address: fmt.Sprintf("ynx_validator_complete_state_%d", i), Moniker: fmt.Sprintf("complete-state-%d", i), VotingPower: 1, Active: true}
	}
	d := chain.NewDevnetWithValidators(cfg, validators)
	for i := 0; i < 504; i++ {
		if _, err := d.Faucet(fmt.Sprintf("0x%040x", i+1), 1); err != nil {
			t.Fatal("normal synthetic account creation", err)
		}
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	p, err := GeneratePQLabNetwork(migration, PQLabNetworkOptions{RootDir: root, BaseP2P: 31656, BaseRPC: 31757})
	if err != nil {
		t.Fatal(err)
	}
	planRaw, err := os.ReadFile(filepath.Join(root, "network-plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	pin := pqLabSHA(planRaw)
	persistPQLabTestCheckpoint(t, p, pin, nil)
	var registrations cmttypes.Txs
	for i := 0; i < 4; i++ {
		r, err := PreparePQLabValidatorRegistration(root, pin, i, p.InitialHeight+1)
		if err != nil {
			t.Fatal(err)
		}
		registrations = append(registrations, r.Transaction)
	}
	persistPQLabTestCheckpoint(t, p, pin, registrations)
	activation, err := ActivatePQLabNetwork(root, pin)
	if err != nil {
		t.Fatal(err)
	}
	activationRaw, err := os.ReadFile(filepath.Join(root, "activation", "activation.json"))
	if err != nil {
		t.Fatal(err)
	}
	originals := make([][]byte, len(p.Nodes))
	for i, node := range p.Nodes {
		originals[i], err = os.ReadFile(node.StatePath)
		if err != nil {
			t.Fatal(err)
		}
	}
	var original CommittedState
	if err = decodeStrictJSON(originals[0], &original); err != nil || len(original.Accounts) < 504 || original.ValidatorRegistry == nil || original.Height != activation.RegistryHeight {
		t.Fatal("normal full state fixture lost original records", err)
	}
	if err = pqLightUniqueJSON(originals[0]); err == nil {
		t.Fatal("fixture no longer demonstrates proof-only JSON limits")
	}
	setup, err := PreparePQLabLiveMaterials(PQLabLiveMaterialsPolicy{
		Version: PQLabLiveMaterialsPolicyVersion, RootDir: root, PlanSHA256: pin,
		ActivationSHA256: pqLabSHA(activationRaw), NodeIndex: 0, MaxOperations: 1,
		CaptureTimeout: 30 * time.Second, TrustingPeriod: time.Hour, MaxClockDrift: time.Minute,
		TrustNumerator: 1, TrustDenominator: 3,
	})
	if err != nil {
		t.Fatal("complete original R state was rejected by proof-only JSON bounds", err)
	}
	in, err := loadPQLabLiveMaterialsPolicy(setup.Policy.Path, setup.Policy.SHA256)
	if err != nil {
		t.Fatal("cold full-state policy/anchor read", err)
	}
	defer func() {
		if err := in.close(); err != nil {
			t.Error(err)
		}
	}()
	if in.anchor.Height != activation.RegistryHeight || in.anchor.AppHash != original.AppHash || in.anchor.RegistryRoot != original.ValidatorRegistry.Root {
		t.Fatal("cold full-state reader changed the original independent R anchor")
	}
	if err := in.current(); err != nil {
		t.Fatal("cold original held-source identity", err)
	}
	for i, node := range p.Nodes {
		after, err := os.ReadFile(node.StatePath)
		if err != nil || !bytes.Equal(after, originals[i]) {
			t.Fatal("read-only setup/cold validation changed an original checkpoint", i, err)
		}
	}
	// Full mathematical validation remains downstream of structural decoding.
	// Changing a balance while preserving all original pins must still fail.
	var changed CommittedState
	if err := json.Unmarshal(in.anchor.CommittedState, &changed); err != nil {
		t.Fatal(err)
	}
	changed.Accounts[len(changed.Accounts)-1].Balance++
	raw, err := json.Marshal(changed)
	if err != nil {
		t.Fatal(err)
	}
	bad := *in
	bad.anchor = in.anchor
	bad.anchor.CommittedState = raw
	if err := bad.validateAnchor(); err == nil {
		t.Fatal("full state parser bypassed original account/hash validation")
	}
	block, err := DecodePQTrustedLightBlock(in.anchor.LightBlock)
	if err != nil {
		t.Fatal(err)
	}
	block.Commit.Signatures[0].Signature[0] ^= 1
	// Keep the original complete state; only the actual Ed25519 R commit is
	// corrupted. Future PQ continuation retains the existing AND tests.
	bad.anchor = in.anchor
	bad.anchor.LightBlock, err = cmtjson.Marshal(block)
	if err != nil {
		t.Fatal(err)
	}
	if err := bad.validateAnchor(); err == nil {
		t.Fatal("full state parser bypassed original R commit signature")
	}
}

func TestPQLabLiveMaterialsCompleteStateJSONSchemaAndDuplicates(t *testing.T) {
	// This is a syntax/schema differential, not an authorized ledger fixture.
	// The separate normal-R test exercises all mathematical state validators.
	state := CommittedState{Version: 18, Height: 1, Accounts: make([]chain.ConsensusAccount, 1001), TraceLots: make(map[string]chain.TrustTraceLot)}
	for i := range state.Accounts {
		state.Accounts[i] = chain.ConsensusAccount{Address: fmt.Sprintf("0x%040x", i+1), Nonce: math.MaxUint64, Lots: map[string]int64{"original": 1}}
	}
	for i := 0; i < 1025; i++ {
		key := fmt.Sprintf("original-%d", i)
		state.TraceLots[key] = chain.TrustTraceLot{LotID: key, Amount: 1}
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if pqLightUniqueJSON(raw) == nil {
		t.Fatal("wide complete-state shape unexpectedly fits the original light proof budget")
	}
	var reference CommittedState
	if err := decodeStrictJSON(raw, &reference); err != nil {
		t.Fatal(err)
	}
	got, err := decodePQLabAnchorCommittedState(append([]byte(" \n\t"), raw...))
	if err != nil || !reflect.DeepEqual(got, reference) || got.Accounts[0].Nonce != math.MaxUint64 {
		t.Fatal("complete-state schema/integer preservation differs from normal state decoder", err)
	}
	for name, input := range map[string][]byte{
		"empty":             nil,
		"null":              []byte(`null`),
		"array-root":        []byte(`[]`),
		"unknown-root":      []byte(`{"unknownState":1}`),
		"unknown-nested":    []byte(`{"accounts":[{"unknownAccount":1}]}`),
		"duplicate-root":    []byte(`{"height":1,"height":2}`),
		"escaped-duplicate": []byte(`{"height":1,"\u0068eight":2}`),
		"duplicate-nested":  []byte(`{"accounts":[{"lots":{"original":1,"original":2}}]}`),
		"trailing-object":   []byte(`{} {}`),
		"trailing-junk":     []byte(`{} !`),
		"missing-value":     []byte(`{"height":}`),
		"wrong-delimiter":   []byte(`{"accounts":[}`),
		"signed-overflow":   []byte(`{"height":9223372036854775808}`),
		"unsigned-overflow": []byte(`{"accounts":[{"nonce":18446744073709551616}]}`),
		"negative-nonce":    []byte(`{"accounts":[{"nonce":-1}]}`),
		"fractional-nonce":  []byte(`{"accounts":[{"nonce":1.5}]}`),
		"invalid-utf8":      append([]byte(`{"appHash":"`), 0xff, '"', '}'),
	} {
		t.Run(name, func(t *testing.T) {
			before := bytes.Clone(input)
			got, err := decodePQLabAnchorCommittedState(input)
			if err == nil || !reflect.DeepEqual(got, CommittedState{}) || !bytes.Equal(input, before) {
				t.Fatal("invalid complete-state input returned usable/changed state", err)
			}
		})
	}
}

func TestPQLabLiveMaterialsCompleteStateJSONOriginalResourceBounds(t *testing.T) {
	// Original 96 MiB body limit is unchanged, including legally insignificant
	// whitespace. No state authority follows from this schema-only empty object.
	raw := bytes.Repeat([]byte{' '}, pqLabAnchorStateMaxBytes+1)
	copy(raw, "{}")
	if _, err := decodePQLabAnchorCommittedState(raw[:pqLabAnchorStateMaxBytes]); err != nil {
		t.Fatal("original exact complete-state byte limit changed", err)
	}
	if _, err := decodePQLabAnchorCommittedState(raw); err == nil {
		t.Fatal("complete-state byte bound was raised")
	}
	raw = nil
	for _, depth := range []int{pqLabAnchorStateMaxDepth, pqLabAnchorStateMaxDepth + 1} {
		raw := []byte(`{"original":` + strings.Repeat("[", depth-1) + "0" + strings.Repeat("]", depth-1) + "}")
		wantValid := json.Valid(raw)
		err := pqLabAnchorStateUniqueJSON(raw)
		if (err == nil) != wantValid || wantValid != (depth == pqLabAnchorStateMaxDepth) {
			t.Fatal("full-state nesting diverged from original encoding/json bound", depth, err)
		}
	}
	// The smaller proof parser remains unchanged and must still reject a
	// 101-element array even though complete states can contain more accounts.
	proofSized := []byte(`{"accounts":[` + strings.Repeat("0,", maxPQLightValidators) + "0]}")
	if pqLightUniqueJSON(proofSized) == nil || pqLabAnchorStateUniqueJSON(proofSized) != nil {
		t.Fatal("complete-state fix leaked into light-proof limits")
	}
}
