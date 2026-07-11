package chain

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func TestConsensusMigrationStateIsDeterministicAndTamperEvident(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet("ynx_consensus_alice", 10_000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Transfer("ynx_consensus_alice", "ynx_consensus_bob", 250); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()

	first, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	second, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if first.StateHash != second.StateHash {
		t.Fatalf("deterministic export hashes differ: %s != %s", first.StateHash, second.StateHash)
	}
	firstJSON, err := first.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	secondJSON, err := second.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if string(firstJSON) != string(secondJSON) {
		t.Fatal("deterministic consensus exports differ")
	}
	if first.Network.ChainID != 6423 || first.Network.NativeCurrencySymbol != "YNXT" {
		t.Fatalf("unexpected network identity: %+v", first.Network)
	}
	if first.Height != devnet.LatestBlock().Height || first.LastBlockHash != devnet.LatestBlock().Hash {
		t.Fatal("migration commit point does not match latest block")
	}
	if first.LiquidSupplyYNXT <= 0 || first.StakedSupplyYNXT <= 0 {
		t.Fatalf("migration supply totals are not populated: %+v", first)
	}

	var decoded ConsensusMigrationState
	if err := json.Unmarshal(firstJSON, &decoded); err != nil {
		t.Fatal(err)
	}
	if err := decoded.Validate(); err != nil {
		t.Fatalf("round-tripped migration state failed validation: %v", err)
	}

	decoded.Accounts[0].Balance++
	decoded.LiquidSupplyYNXT++
	if err := decoded.Validate(); err == nil {
		t.Fatal("tampered account balance passed consensus migration validation")
	}
}

func TestConsensusMigrationExcludesOperationalValidatorEvidence(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	before, err := devnet.ExportConsensusMigrationState()
	if err == nil {
		t.Fatal("genesis-only state should not be accepted as a migration commit point")
	}

	devnet.ProduceBlock()
	before, err = devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	ready := true
	if _, err := devnet.UpdateValidatorPeerState(ValidatorPeerHeartbeatInput{Address: ValidatorAddress, Ready: &ready, Status: "ready", LatestHeight: 1, Evidence: "operational-only"}); err != nil {
		t.Fatal(err)
	}
	after, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if before.StateHash != after.StateHash {
		t.Fatalf("operational heartbeat changed consensus state hash: %s != %s", before.StateHash, after.StateHash)
	}
}

func TestConsensusMigrationBindsValidatorIdentityToCometBFTKeys(t *testing.T) {
	validators := []Validator{
		{Address: "ynx_validator_primary", Moniker: "ynx-primary", VotingPower: 1, Active: true},
		{Address: "ynx_validator_seoul", Moniker: "ynx-seoul", VotingPower: 1, Active: true},
		{Address: "ynx_validator_silicon_valley", Moniker: "ynx-silicon-valley", VotingPower: 1, Active: true},
		{Address: "ynx_validator_singapore", Moniker: "ynx-singapore", VotingPower: 1, Active: true},
	}
	devnet := NewDevnetWithValidators(DefaultNetworkConfig("testnet"), validators)
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if err := migration.ValidateConsensusValidatorKeys(); err == nil {
		t.Fatal("unbound migration unexpectedly passed consensus key validation")
	}
	bindings := make([]ConsensusValidatorKeyBinding, len(migration.Validators))
	for index, validator := range migration.Validators {
		seed := make([]byte, ed25519.SeedSize)
		seed[len(seed)-1] = byte(index + 1)
		publicKey := ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
		hash := sha256.Sum256(publicKey)
		bindings[index] = ConsensusValidatorKeyBinding{
			ValidatorAddress: validator.Address,
			KeyType:          ConsensusPubKeyTypeEd25519,
			PublicKey:        base64.StdEncoding.EncodeToString(publicKey),
			ConsensusAddress: strings.ToUpper(hex.EncodeToString(hash[:20])),
		}
	}
	bound, err := migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	if err := bound.ValidateConsensusValidatorKeys(); err != nil {
		t.Fatal(err)
	}
	if bound.StateHash == migration.StateHash {
		t.Fatal("validator consensus key binding did not change migration hash")
	}
	reversed := append([]ConsensusValidatorKeyBinding(nil), bindings...)
	for left, right := 0, len(reversed)-1; left < right; left, right = left+1, right-1 {
		reversed[left], reversed[right] = reversed[right], reversed[left]
	}
	boundReversed, err := migration.BindConsensusValidatorKeys(reversed)
	if err != nil || boundReversed.StateHash != bound.StateHash {
		t.Fatalf("consensus key binding depends on manifest order: hash=%s err=%v", boundReversed.StateHash, err)
	}
	if _, err := migration.BindConsensusValidatorKeys(bindings[:3]); err == nil {
		t.Fatal("incomplete validator consensus key binding was accepted")
	}
	tampered := bound
	tampered.Validators[0].ConsensusAddress = strings.Repeat("0", 40)
	if err := tampered.Validate(); err == nil {
		t.Fatal("tampered validator consensus address was accepted")
	}
}
