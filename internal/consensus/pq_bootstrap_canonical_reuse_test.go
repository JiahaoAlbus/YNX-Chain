package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestColdReferenceCanonicalFastPathMatchesOriginalFailures(t *testing.T) {
	_, original, _, _, _ := bootstrapPreparationPUBLIC(t)
	owner, err := newValidatedMigrationWithConsensusValidatorKeys(original)
	if err != nil {
		t.Fatal(err)
	}
	originalReference := newCometMigrationReferenceDigest(original, owner.canonicalHash, owner.canonicalBytes)
	raw, err := json.Marshal(originalReference)
	if err != nil {
		t.Fatal(err)
	}
	before := func(input []byte, source chain.ConsensusMigrationState) ([]byte, *cometMigrationReference, error) {
		normalized, ref, err := validateBootstrapMigrationAppState(input, source)
		if err != nil {
			return nil, nil, err
		}
		if ref == nil || *ref != newCometMigrationReferenceDigest(source, owner.canonicalHash, owner.canonicalBytes) {
			return nil, nil, errors.New("original validated canonical migration changed")
		}
		return normalized, ref, nil
	}
	for _, kind := range []string{"valid", "whitespace", "reordered", "unknown", "missing", "duplicate", "null-version", "bad-digest", "changed-original", "changed-original-and-bad-ref", "bad-source-and-bad-ref", "noncanonical-number"} {
		t.Run(kind, func(t *testing.T) {
			encoded, _ := json.Marshal(original)
			var source chain.ConsensusMigrationState
			if err := json.Unmarshal(encoded, &source); err != nil {
				t.Fatal(err)
			}
			in := bytes.Clone(raw)
			switch kind {
			case "whitespace":
				in = append([]byte(" \n"), in...)
			case "reordered":
				var obj map[string]any
				if err := json.Unmarshal(in, &obj); err != nil {
					t.Fatal(err)
				}
				in, _ = json.Marshal(obj)
			case "unknown":
				in = append(bytes.TrimSuffix(in, []byte("}")), []byte(",\"unexpected\":1}")...)
			case "missing":
				var obj map[string]any
				_ = json.Unmarshal(in, &obj)
				delete(obj, "migrationHeight")
				in, _ = json.Marshal(obj)
			case "duplicate":
				in = append(bytes.TrimSuffix(in, []byte("}")), []byte(",\"version\":\"YNX-COMET-MIGRATION-REFERENCE/v1\"}")...)
			case "null-version":
				in = bytes.Replace(in, []byte("\"version\":\"YNX-COMET-MIGRATION-REFERENCE/v1\""), []byte("\"version\":null"), 1)
			case "bad-digest":
				ref := originalReference
				ref.MigrationCanonicalSHA256 = strings.Repeat("1", 64)
				in, _ = json.Marshal(ref)
			case "changed-original":
				source.Accounts[0].Balance++
			case "changed-original-and-bad-ref":
				source.Accounts[0].Balance++
				in = []byte("{\"version\":\"YNX-COMET-MIGRATION-REFERENCE/v1\",\"unexpected\":1}")
			case "bad-source-and-bad-ref":
				source.StateHash = "invalid"
				in = []byte("{\"version\":\"YNX-COMET-MIGRATION-REFERENCE/v1\",\"unexpected\":1}")
			case "noncanonical-number":
				in = bytes.Replace(in, []byte("\"migrationHeight\":\""), []byte("\"migrationHeight\":1,\"x\":\""), 1)
			}
			want, wref, we := before(in, source)
			got, gref, ge := validateBootstrapMigrationAppStateColdOwned(in, source, owner)
			if (we == nil) != (ge == nil) || we != nil && we.Error() != ge.Error() || !bytes.Equal(want, got) || !reflect.DeepEqual(wref, gref) {
				t.Fatalf("case %s before=%v after=%v", kind, we, ge)
			}
		})
	}
}

func TestColdReferenceCanonicalInvalidUTF8SemanticDifference(t *testing.T) {
	_, m, _, _, _ := bootstrapPreparationPUBLIC(t)
	m.Network.Name = "\xff"
	m.Runtime.Config.Name = "\xff"
	m.StateHash = ""
	b, e := json.Marshal(m)
	if e != nil {
		t.Fatal(e)
	}
	h := sha256.Sum256(b)
	m.StateHash = hex.EncodeToString(h[:])
	if e = m.ValidateConsensusValidatorKeys(); e != nil {
		t.Fatalf("original: %v", e)
	}
	owner, e := newValidatedMigrationWithConsensusValidatorKeys(m)
	if e != nil {
		t.Fatalf("owner: %v", e)
	}
	ref, e := json.Marshal(newCometMigrationReferenceDigest(m, owner.canonicalHash, owner.canonicalBytes))
	if e != nil {
		t.Fatal(e)
	}
	if reflect.DeepEqual(m, owner.migration) || owner.bootstrapSourceExact {
		t.Fatal("normalized owner must not carry an exact original typed witness")
	}
	// Even if the caller later presents the detached normalized value, it
	// never acquires original validation: the sealed bit remains false and
	// the original reference validator decides its result.
	want, wantRef, wantErr := validateBootstrapMigrationAppState(ref, owner.migration)
	got, gotRef, gotErr := validateBootstrapMigrationAppStateColdOwned(ref, owner.migration, owner)
	if (wantErr == nil) != (gotErr == nil) || wantErr != nil && wantErr.Error() != gotErr.Error() || !bytes.Equal(want, got) || !reflect.DeepEqual(wantRef, gotRef) {
		t.Fatalf("normalized detached source changed original behavior: before=%v after=%v", wantErr, gotErr)
	}
	if _, _, e = validateBootstrapMigrationAppStateColdOwned(ref, m, owner); e != nil {
		t.Fatal("originally valid non-UTF-8 source must remain accepted", e)
	}
	m.Network.Name = "\xfe"
	same, e := m.MatchesCanonicalJSON(owner.canonicalHash, owner.canonicalBytes)
	if e != nil || !same {
		t.Fatalf("canonical differs %v %v", same, e)
	}
	if e = m.Validate(); e == nil {
		t.Fatal("mutated source unexpectedly valid")
	} else {
		t.Logf("source validation: %v", e)
	}
	_, _, e = validateBootstrapMigrationAppStateColdOwned(ref, m, owner)
	if e == nil {
		t.Fatal("fast path accepted invalid source")
	}
}
func TestColdReferenceCanonicalNilEmptyDifference(t *testing.T) {
	_, m, _, _, _ := bootstrapPreparationPUBLIC(t)
	if len(m.DexEvents) != 0 || len(m.Runtime.DexEvents) != 0 {
		t.Fatal("fixture has DEX events")
	}
	m.DexEvents = nil
	m.Runtime.DexEvents = nil
	m.StateHash = ""
	b, e := json.Marshal(m)
	if e != nil {
		t.Fatal(e)
	}
	h := sha256.Sum256(b)
	m.StateHash = hex.EncodeToString(h[:])
	if e = m.ValidateConsensusValidatorKeys(); e != nil {
		t.Fatalf("original: %v", e)
	}
	owner, e := newValidatedMigrationWithConsensusValidatorKeys(m)
	if e != nil {
		t.Fatal(e)
	}
	ref, e := json.Marshal(newCometMigrationReferenceDigest(m, owner.canonicalHash, owner.canonicalBytes))
	if e != nil {
		t.Fatal(e)
	}
	m.DexEvents = make([]chain.NativeDexEvent, 0)
	same, e := m.MatchesCanonicalJSON(owner.canonicalHash, owner.canonicalBytes)
	if e != nil || !same {
		t.Fatalf("canonical differs %v %v", same, e)
	}
	if e = m.Validate(); e == nil {
		t.Fatal("mutated source unexpectedly valid")
	} else {
		t.Logf("source validation: %v", e)
	}
	_, _, e = validateBootstrapMigrationAppStateColdOwned(ref, m, owner)
	if e == nil {
		t.Fatal("fast path accepted invalid source")
	}
	// Both representations are empty and the complete original validator
	// accepts their matching typed values. A false fast guard must not change
	// this otherwise lawful input into a rejection.
	m.Runtime.DexEvents = make([]chain.NativeDexEvent, 0)
	if e = m.Validate(); e != nil {
		t.Fatal("equal empty source must remain valid", e)
	}
	if reflect.DeepEqual(m, owner.migration) {
		t.Fatal("fixture must exercise nil versus empty normalization")
	}
	if _, _, e = validateBootstrapMigrationAppStateColdOwned(ref, m, owner); e != nil {
		t.Fatal("valid normalized source must follow original full validator", e)
	}
}

func TestColdReferenceCanonicalExactOwnerAndForgedOwner(t *testing.T) {
	_, m, _, _, _ := bootstrapPreparationPUBLIC(t)
	owner, err := newValidatedMigrationWithConsensusValidatorKeys(m)
	if err != nil {
		t.Fatal(err)
	}
	if !owner.bootstrapSourceExact || !reflect.DeepEqual(m, owner.migration) {
		t.Fatal("positive control requires exact typed original")
	}
	matches, err := m.MatchesCanonicalJSON(owner.canonicalHash, owner.canonicalBytes)
	if err != nil || !matches {
		t.Fatal("positive control requires complete original canonical match", err)
	}
	ref, err := json.Marshal(newCometMigrationReferenceDigest(m, owner.canonicalHash, owner.canonicalBytes))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = validateBootstrapMigrationAppStateColdOwned(ref, m, owner); err != nil {
		t.Fatal("exact owner failed", err)
	}
	generic, err := newValidatedMigration(m, nil)
	if err != nil {
		t.Fatal(err)
	}
	copied := *owner
	for _, bad := range []*validatedMigration{nil, {}, generic, &copied} {
		if _, _, err := validateBootstrapMigrationAppStateColdOwned(ref, m, bad); err == nil {
			t.Fatal("unsealed, generic or copied owner gained authority")
		}
	}
}
