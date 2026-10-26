package ynxconsensusauth

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func registrationMathHistory(t *testing.T, anchor RegistryAnchor) *KeyHistory {
	t.Helper()
	h, err := NewKeyHistory(anchor)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func registrationMathCache(t *testing.T, scope []byte) *RegistrationMathCache {
	t.Helper()
	c, err := NewRegistrationMathCache(scope)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestRegistrationMathCacheWarmReplayKeepsDynamicSourceAndErrorOrder(t *testing.T) {
	f := newRegistrationFixture(t)
	wire := f.sign(t, f.first(), 0, 0)
	h := registrationMathHistory(t, f.anchor)
	cache := registrationMathCache(t, f.anchor.GenesisID)
	original, err := h.Append(wire, 10, f.source)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		calls := f.source.calls
		next, err := h.AppendWithMathCache(wire, 10, f.source, cache)
		if err != nil || next.Root() != original.Root() || next.EventCount() != 1 || f.source.calls != calls+1 {
			t.Fatal("warm mathematics replaced original dynamic membership or changed root", err)
		}
		actual, err := next.EventWire(0)
		if err != nil || !bytes.Equal(actual, wire) {
			t.Fatal("cached math changed original event bytes", err)
		}
	}
	warm := cache.Stats()
	if warm.Entries != 1 || warm.Misses != 1 || warm.Hits != 1 || warm.Capacity != 16 {
		t.Fatal("normal repeated replay did not reuse only successful complete mathematics", warm)
	}
	for name, mutate := range map[string]func(*RegistrationState){
		"genesis": func(s *RegistrationState) { s.GenesisID[0] ^= 1 },
		"chain":   func(s *RegistrationState) { s.ChainID += "-different" },
		"owner":   func(s *RegistrationState) { s.ValidatorAddress[0] ^= 1 },
		"height":  func(s *RegistrationState) { s.Height++ },
		"power":   func(s *RegistrationState) { s.VotingPower = 0 },
		"old key": func(s *RegistrationState) { s.LegacyEd25519PublicKey[0] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			f.source.mutate = mutate
			before := cache.Stats()
			_, want := h.Append(wire, 10, f.source)
			_, got := h.AppendWithMathCache(wire, 10, f.source, cache)
			if want == nil || got == nil || got.Error() != want.Error() || cache.Stats() != before {
				t.Fatal("warm cache bypassed dynamic failure or changed its first error", want, got)
			}
			f.source.mutate = nil
		})
	}
	f.source.err = errors.New("original membership observation unavailable")
	_, err = h.AppendWithMathCache(wire, 10, f.source, cache)
	if !errors.Is(err, f.source.err) || cache.Stats() != warm {
		t.Fatal("warm cache bypassed unavailable authoritative source", err)
	}
	f.source.err = nil
	for _, test := range []struct {
		history *KeyHistory
		height  int64
	}{
		{h, 11}, {original, 10},
	} {
		before := cache.Stats()
		_, want := test.history.Append(wire, test.height, f.source)
		_, got := test.history.AppendWithMathCache(wire, test.height, f.source, cache)
		if want == nil || got == nil || got.Error() != want.Error() || cache.Stats() != before {
			t.Fatal("warm math replaced execution height or complete registry history", want, got)
		}
	}
}

func TestRegistrationMathCacheEverySignatureAndRotationRemainBound(t *testing.T) {
	f := newRegistrationFixture(t)
	first := f.sign(t, f.first(), 0, 0)
	rotation := f.sign(t, f.successor(t, first, RotateValidator, 2, 1, 2, 15, 20, 0, 1), 0, 1)
	revocation := f.sign(t, f.successor(t, rotation, RevokeValidator, 3, 1, 2, 16, 18, 0, 0), 0, 0)
	cache := registrationMathCache(t, f.anchor.GenesisID)
	prefixes := []*KeyHistory{registrationMathHistory(t, f.anchor)}
	wires := [][]byte{first, rotation, revocation}
	for _, wire := range wires {
		r, err := DecodeRegistration(wire)
		if err != nil {
			t.Fatal(err)
		}
		next, err := prefixes[len(prefixes)-1].AppendWithMathCache(wire, r.Intent.ApprovedAt, f.source, cache)
		if err != nil {
			t.Fatal(err)
		}
		warm, err := prefixes[len(prefixes)-1].AppendWithMathCache(wire, r.Intent.ApprovedAt, f.source, cache)
		if err != nil || warm.Root() != next.Root() {
			t.Fatal("warm complete operation mathematics changed the original successor", err)
		}
		prefixes = append(prefixes, next)
	}
	if stats := cache.Stats(); stats.Entries != 3 || stats.Misses != 3 || stats.Hits != 3 {
		t.Fatal("real registration/rotation/revocation did not authenticate separately", stats)
	}
	for i, wire := range wires {
		for _, branch := range []string{"legacy", "authorityA", "authorityB", "possessionA", "possessionB"} {
			r, err := DecodeRegistration(wire)
			if err != nil {
				t.Fatal(err)
			}
			var proof []byte
			switch branch {
			case "legacy":
				proof = r.LegacyApproval
			case "authorityA":
				proof = r.AuthorityMLDSA87
			case "authorityB":
				proof = r.AuthoritySLHDSASHA2256f
			case "possessionA":
				proof = r.PossessionMLDSA87
			case "possessionB":
				proof = r.PossessionSLHDSASHA2256f
			}
			if len(proof) == 0 {
				continue // That exact operation has no such signature slot.
			}
			proof[0] ^= 1
			bad, err := r.MarshalBinary()
			if err != nil {
				t.Fatal(err)
			}
			before := cache.Stats()
			root := prefixes[i].Root()
			_, want := prefixes[i].Append(bad, r.Intent.ApprovedAt, f.source)
			for attempt := 0; attempt < 2; attempt++ {
				_, got := prefixes[i].AppendWithMathCache(bad, r.Intent.ApprovedAt, f.source, cache)
				if want == nil || got == nil || got.Error() != want.Error() || !strings.Contains(got.Error(), "validator-key proof rejected") || cache.Stats().Entries != before.Entries || cache.Stats().Misses != before.Misses+uint64(attempt+1) || prefixes[i].Root() != root {
					t.Fatal("cached good wire authorized a changed signature, memoized failure or altered root", i, branch, want, got)
				}
			}
		}
	}
	// Valid cached operations still cannot operate without the exact original
	// prior events, sequence and previous-event hash.
	for _, test := range []struct {
		history *KeyHistory
		wire    []byte
		height  int64
	}{
		{prefixes[0], rotation, 15}, {prefixes[1], revocation, 16},
	} {
		before := cache.Stats()
		_, want := test.history.Append(test.wire, test.height, f.source)
		_, got := test.history.AppendWithMathCache(test.wire, test.height, f.source, cache)
		if want == nil || got == nil || got.Error() != want.Error() || cache.Stats() != before {
			t.Fatal("warm proof bypassed current epoch/history rules", want, got)
		}
	}
}

func TestRegistrationMathCacheCapacityColdScopeAndOwnedInputs(t *testing.T) {
	f := newRegistrationFixture(t)
	h := registrationMathHistory(t, f.anchor)
	scope := bytes.Clone(f.anchor.GenesisID)
	cache := registrationMathCache(t, scope)
	clear(scope) // Constructor must retain its own original public scope.
	wires := make([][]byte, 17)
	// These are independently signed candidate attempts against the same
	// unchanged empty history, not seventeen committed registrations. A warm
	// mathematical fact never overrides the live no-second-registration rule.
	for i := range wires {
		intent := f.first()
		intent.ApprovedAt, intent.EffectiveAt = int64(10+i), int64(12+i)
		wires[i] = f.sign(t, intent, 0, 0)
		if _, err := h.AppendWithMathCache(wires[i], intent.ApprovedAt, f.source, cache); err != nil {
			t.Fatal(err)
		}
	}
	stats := cache.Stats()
	if stats.Capacity != 16 || stats.Entries != 16 || stats.Misses != 17 || stats.Hits != 0 || stats.RetainedKeyBytes <= 0 || stats.RetainedKeyBytes > 16*(MaxRegistrationBytes+4096) {
		t.Fatal("fixed 16-entry exact-key retention bound differs", stats)
	}
	if _, err := h.AppendWithMathCache(wires[16], 26, f.source, cache); err != nil || cache.Stats().Hits != 1 {
		t.Fatal("most recent original wire was not retained", err)
	}
	if _, err := h.AppendWithMathCache(wires[0], 10, f.source, cache); err != nil || cache.Stats().Misses != 18 || cache.Stats().Entries != 16 {
		t.Fatal("seventeenth exact wire did not evict and independently reverify the oldest", err)
	}
	cold := registrationMathCache(t, f.anchor.GenesisID)
	if _, err := h.AppendWithMathCache(wires[0], 10, f.source, cold); err != nil || cold.Stats().Hits != 0 || cold.Stats().Misses != 1 {
		t.Fatal("cold cache inherited another owner's successes", err)
	}
	borrowedScope := bytes.Clone(f.anchor.GenesisID)
	scoped := registrationMathCache(t, borrowedScope)
	if _, err := h.AppendWithMathCache(wires[0], 10, f.source, scoped); err != nil {
		t.Fatal(err)
	}
	clear(borrowedScope)
	if _, err := h.AppendWithMathCache(wires[0], 10, f.source, scoped); err != nil || scoped.Stats().Misses != 1 || scoped.Stats().Hits != 1 {
		t.Fatal("caller mutation changed the cache's owned bootstrap namespace", err)
	}
	original := bytes.Clone(wires[0])
	borrowed := bytes.Clone(original)
	aliasCache := registrationMathCache(t, f.anchor.GenesisID)
	f.source.mutate = func(*RegistrationState) { clear(borrowed) }
	next, err := h.AppendWithMathCache(borrowed, 10, f.source, aliasCache)
	f.source.mutate = nil
	if err != nil || aliasCache.Stats().Misses != 1 || aliasCache.Stats().Entries != 1 {
		t.Fatal("caller mutation changed the owned original verification snapshot", err)
	}
	actual, err := next.EventWire(0)
	if err != nil || !bytes.Equal(actual, original) || bytes.Equal(borrowed, original) {
		t.Fatal("cached verification/event retained mutable caller bytes", err)
	}
	clear(actual)
	again, _ := next.EventWire(0)
	if !bytes.Equal(again, original) {
		t.Fatal("returned event alias changed the authenticated history")
	}
	cold.Clear()
	if cold.Stats().Entries != 0 || cold.Stats().RetainedKeyBytes != 0 {
		t.Fatal("clear retained exact public proof keys")
	}
	before := cold.Stats()
	if _, err := h.AppendWithMathCache(original, 10, f.source, cold); err != nil || cold.Stats().Misses != before.Misses+1 {
		t.Fatal("clear did not require original mathematics again", err)
	}
}

func TestRegistrationMathCacheNilZeroAndInvalidScope(t *testing.T) {
	for _, scope := range [][]byte{nil, make([]byte, 32), bytes.Repeat([]byte{1}, 31), bytes.Repeat([]byte{1}, 33)} {
		if cache, err := NewRegistrationMathCache(scope); err == nil || cache != nil {
			t.Fatal("invalid bootstrap scope constructed a usable cache")
		}
	}
	f := newRegistrationFixture(t)
	wire := f.sign(t, f.first(), 0, 0)
	h := registrationMathHistory(t, f.anchor)
	want, err := h.Append(wire, 10, f.source)
	if err != nil {
		t.Fatal(err)
	}
	for _, cache := range []*RegistrationMathCache{nil, {}} {
		got, err := h.AppendWithMathCache(wire, 10, f.source, cache)
		if err != nil || got.Root() != want.Root() || cache.Stats() != (RegistrationMathCacheStats{}) {
			t.Fatal("nil or zero cache changed original complete verification", err)
		}
		bad, _ := DecodeRegistration(wire)
		bad.PossessionSLHDSASHA2256f[0] ^= 1
		raw, _ := bad.MarshalBinary()
		if _, err := h.AppendWithMathCache(raw, 10, f.source, cache); err == nil {
			t.Fatal("disabled cache accepted a corrupt AND branch")
		}
	}
}
