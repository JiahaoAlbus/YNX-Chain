package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func ethereumUnitCandidateBytes(t *testing.T, p ethereumUnitCandidatePlan) ([]byte, string) {
	t.Helper()
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	return raw, hex.EncodeToString(hash[:])
}

func TestEthereumUnitCandidatePinsTrustedCheckpointAndHeight(t *testing.T) {
	f := newRuntimeUpgradeFixture(t, 13)
	baseHash, err := f.plan.Hash()
	if err != nil {
		t.Fatal(err)
	}
	p := ethereumUnitCandidatePlan{Format: ethereumUnitCandidateFormat, RuntimePlanSHA256: baseHash, CheckpointHeight: f.next.Height, CheckpointAppHash: f.next.AppHash, CheckpointAppVersion: f.plan.NewApplicationVersion, ActivationHeight: f.next.Height + 1, Before: ethereumUnitBefore, After: ethereumUnitAfter}
	raw, pin := ethereumUnitCandidateBytes(t, p)
	trusted := runtimeTrustedCheckpoint(f.plan, f.next)
	beforeState, err := json.Marshal(f.next)
	if err != nil {
		t.Fatal(err)
	}
	beforeMigration, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	build := func(input []byte, expected string, checkpoint runtimeUpgradeCheckpoint) (*ethereumUnitCandidate, error) {
		return newEthereumUnitCandidate(input, expected, f.authorization, f.migration, f.bootstrap, f.next, checkpoint)
	}
	candidate, err := build(raw, pin, trusted)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		height int64
		want   string
	}{{p.CheckpointHeight, ethereumUnitBefore}, {p.ActivationHeight, ethereumUnitAfter}, {p.ActivationHeight + 1, ethereumUnitAfter}} {
		if got, err := candidate.candidateRuleAt(tc.height); err != nil || got != tc.want {
			t.Fatalf("height %d: %q %v", tc.height, got, err)
		}
	}
	if _, err := candidate.candidateRuleAt(0); err == nil {
		t.Fatal("zero height accepted")
	}
	if _, err := (*ethereumUnitCandidate)(nil).candidateRuleAt(1); err == nil {
		t.Fatal("absent candidate selected a rule")
	}
	if _, err := build(raw, strings.Repeat("a", 64), trusted); err == nil {
		t.Fatal("wrong independent pin accepted")
	}
	if _, err := newEthereumUnitCandidate(raw, pin, nil, f.migration, f.bootstrap, f.next, trusted); err == nil {
		t.Fatal("missing runtime authorization accepted")
	}
	if _, err := newEthereumUnitCandidate(raw, pin, f.authorization, f.migration, nil, f.next, trusted); err == nil {
		t.Fatal("missing bootstrap accepted")
	}
	badAuthority := *f.authorization
	badAuthority.hash = strings.Repeat("a", 64)
	if _, err := newEthereumUnitCandidate(raw, pin, &badAuthority, f.migration, f.bootstrap, f.next, trusted); err == nil {
		t.Fatal("changed runtime authority accepted")
	}
	badMigration := f.migration
	badMigration.StateHash = strings.Repeat("a", 64)
	if _, err := newEthereumUnitCandidate(raw, pin, f.authorization, badMigration, f.bootstrap, f.next, trusted); err == nil {
		t.Fatal("changed migration accepted")
	}
	changedState := f.next
	changedState.AppHash = strings.Repeat("a", 64)
	if _, err := newEthereumUnitCandidate(raw, pin, f.authorization, f.migration, f.bootstrap, changedState, trusted); err == nil {
		t.Fatal("self-reported different state accepted")
	}
	for _, mutate := range []func(*ethereumUnitCandidatePlan){
		func(p *ethereumUnitCandidatePlan) { p.Format += "-unknown" },
		func(p *ethereumUnitCandidatePlan) { p.RuntimePlanSHA256 = strings.Repeat("a", 64) },
		func(p *ethereumUnitCandidatePlan) { p.CheckpointHeight-- },
		func(p *ethereumUnitCandidatePlan) { p.CheckpointHeight = -1 },
		func(p *ethereumUnitCandidatePlan) { p.CheckpointHeight = math.MaxInt64 },
		func(p *ethereumUnitCandidatePlan) { p.CheckpointAppHash = strings.Repeat("a", 64) },
		func(p *ethereumUnitCandidatePlan) { p.CheckpointAppVersion++ },
		func(p *ethereumUnitCandidatePlan) { p.ActivationHeight++ },
		func(p *ethereumUnitCandidatePlan) { p.Before = ethereumUnitAfter },
		func(p *ethereumUnitCandidatePlan) { p.After = ethereumUnitBefore },
	} {
		bad := p
		mutate(&bad)
		badRaw, badPin := ethereumUnitCandidateBytes(t, bad)
		if _, err := build(badRaw, badPin, trusted); err == nil {
			t.Fatalf("invalid candidate accepted: %s", badRaw)
		}
	}
	for _, mutate := range []func(*runtimeUpgradeCheckpoint){
		func(c *runtimeUpgradeCheckpoint) { c.height++ },
		func(c *runtimeUpgradeCheckpoint) { c.appHash = strings.Repeat("a", 64) },
		func(c *runtimeUpgradeCheckpoint) { c.chainID = "ynx_1-1" },
		func(c *runtimeUpgradeCheckpoint) { c.cometGenesisSHA256 = strings.Repeat("a", 64) },
		func(c *runtimeUpgradeCheckpoint) { c.appVersion++ },
	} {
		bad := trusted
		mutate(&bad)
		if _, err := build(raw, pin, bad); err == nil {
			t.Fatal("mismatched engine checkpoint accepted")
		}
	}
	duplicate := append([]byte(`{"format":"duplicate",`), raw[1:]...)
	unknown := append([]byte(`{"unknown":"x",`), raw[1:]...)
	for _, bad := range [][]byte{append(bytes.Clone(raw), '\n'), append(bytes.Clone(raw), []byte(`{}`)...), duplicate, unknown, bytes.Repeat([]byte(" "), ethereumUnitCandidateMaximumBytes+1)} {
		sum := sha256.Sum256(bad)
		if _, err := build(bad, hex.EncodeToString(sum[:]), trusted); err == nil {
			t.Fatal("noncanonical candidate accepted")
		}
	}
	candidate.plan.After = ethereumUnitBefore
	if _, err := candidate.candidateRuleAt(p.ActivationHeight); err == nil {
		t.Fatal("mutated candidate selected a rule")
	}
	afterState, err := json.Marshal(f.next)
	if err != nil || !bytes.Equal(beforeState, afterState) {
		t.Fatal("candidate check changed original committed state", err)
	}
	afterMigration, err := f.migration.CanonicalJSON()
	if err != nil || !bytes.Equal(beforeMigration, afterMigration) {
		t.Fatal("candidate check changed original migration", err)
	}
}
