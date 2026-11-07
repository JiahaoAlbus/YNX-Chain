package chain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"
)

func combinedDetachedBoundFixture(t *testing.T, pq bool) ConsensusMigrationState {
	t.Helper()
	s := migrationDetachedFixture(t, pq)
	bindings := make([]ConsensusValidatorKeyBinding, len(s.Validators))
	for i, v := range s.Validators {
		seed := make([]byte, ed25519.SeedSize)
		seed[len(seed)-1] = byte(i + 1)
		pub := ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
		h := sha256.Sum256(pub)
		bindings[i] = ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(pub), ConsensusAddress: strings.ToUpper(hex.EncodeToString(h[:20]))}
	}
	bound, err := s.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	return bound
}

// The reference is the exact pre-change sequence at the cold sender boundary.
func beforeCombinedDetachedKeys(s ConsensusMigrationState, w io.Writer) (ConsensusMigrationState, error) {
	if err := s.ValidateConsensusValidatorKeys(); err != nil {
		return ConsensusMigrationState{}, err
	}
	return s.WriteDetachedCanonicalJSON(w)
}

func TestCombinedDetachedValidatorKeysSameOriginalBytesAndNormalization(t *testing.T) {
	for _, normalize := range []bool{false, true} {
		s := combinedDetachedBoundFixture(t, false)
		s.Runtime.Pending = []Transaction{}
		s.Runtime.Blocks[len(s.Runtime.Blocks)-1].Transactions = []Transaction{}
		if normalize {
			s.Network.Name = "source <&> invalid \xff"
			s.Runtime.Config = s.Network
			s.Runtime.Blocks[1].Validator = "validator-\xff\xfe"
			s.Runtime.Blocks[1].Time = time.Now()
			s.Runtime.Blocks[2].Time = time.Date(2026, 10, 25, 4, 5, 6, 123, time.FixedZone("source-zone", 19800))
		}
		var err error
		s.StateHash, err = s.calculateHash()
		if err != nil {
			t.Fatal(err)
		}
		var left, right bytes.Buffer
		want, oldErr := beforeCombinedDetachedKeys(s, &left)
		got, newErr := s.WriteDetachedCanonicalJSONWithConsensusValidatorKeys(&right)
		if oldErr != nil || newErr != nil || !bytes.Equal(left.Bytes(), right.Bytes()) || !reflect.DeepEqual(want, got) {
			t.Fatal("combined boundary changed full canonical bytes/decoded values", normalize, oldErr, newErr)
		}
		if normalize {
			decodedRaw, err := json.MarshalIndent(got, "", "  ")
			if err != nil || bytes.Equal(decodedRaw, right.Bytes()) {
				t.Fatal("normalization fixture lost original-vs-decoded byte distinction", err)
			}
		}
	}
}

func TestCombinedDetachedValidatorKeysFirstFailureAndNoCandidate(t *testing.T) {
	for _, kind := range []string{"unbound", "bad-key", "bad-history", "bad-hash-and-unbound"} {
		s := combinedDetachedBoundFixture(t, true)
		switch kind {
		case "unbound", "bad-hash-and-unbound":
			for i := range s.Validators {
				s.Validators[i].ConsensusKeyType = ""
				s.Validators[i].ConsensusPubKey = ""
				s.Validators[i].ConsensusAddress = ""
			}
			var err error
			s.StateHash, err = s.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if kind == "bad-hash-and-unbound" {
				s.StateHash = "invalid"
			} else if err := s.Validate(); err != nil {
				t.Fatal("fixture must pass generic Validate but fail bound-key API", err)
			}
		case "bad-key":
			s.Validators[0].ConsensusPubKey = "invalid"
		case "bad-history":
			s.Runtime.Blocks[1].Hash += "changed"
		}
		var left, right bytes.Buffer
		_, want := beforeCombinedDetachedKeys(s, &left)
		got, err := s.WriteDetachedCanonicalJSONWithConsensusValidatorKeys(&right)
		if want == nil || err == nil || want.Error() != err.Error() || left.Len() != 0 || right.Len() != 0 || !reflect.DeepEqual(got, ConsensusMigrationState{}) {
			t.Fatal("combined path changed first failure or published partial authority", kind, want, err)
		}
	}
	s := combinedDetachedBoundFixture(t, false)
	cause := errors.New("original combined canonical writer failure")
	for _, w := range []io.Writer{nil, canonicalStateShortWriter{}, canonicalStateErrorWriter{cause}, &migrationDetachedPartialWriter{limit: 128, err: cause}} {
		got, err := s.WriteDetachedCanonicalJSONWithConsensusValidatorKeys(w)
		if err == nil || !reflect.DeepEqual(got, ConsensusMigrationState{}) {
			t.Fatal("writer failure returned an owning state", err)
		}
	}
	if _, err := s.WriteDetachedCanonicalJSONWithConsensusValidatorKeys(canonicalStateShortWriter{}); !errors.Is(err, io.ErrShortWrite) {
		t.Fatal("short-write cause changed", err)
	}
	if _, err := s.WriteDetachedCanonicalJSONWithConsensusValidatorKeys(canonicalStateErrorWriter{cause}); !errors.Is(err, cause) {
		t.Fatal("original writer cause changed", err)
	}
}

func TestCombinedDetachedValidatorKeysKeepsNestedOwnership(t *testing.T) {
	s := combinedDetachedBoundFixture(t, true)
	got, err := s.WriteDetachedCanonicalJSONWithConsensusValidatorKeys(io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	before, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	s.Accounts[0].Lots["source-only"] = 1
	s.AccountPolicy.NetworkID[0] ^= 1
	s.Runtime.AccountPolicy.NetworkID[0] ^= 1
	s.Runtime.Blocks[1].Transactions[0].Logs[0].Topics[0] = "source-only"
	s.Runtime.Blocks[2].Hash = "changed"
	after, err := json.Marshal(got)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("combined constructor retained a caller-owned nested alias", err)
	}
}
