package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	consent "github.com/JiahaoAlbus/YNX-Chain/internal/ynxresourceconsent"
	"os"
	"testing"
)

func TestNetworkResourceConsentCABIPUBLICActualFixedLifecycle(t *testing.T) {
	raw, err := os.ReadFile("../../internal/ynxbatch/testdata/network-resource-consent-v1-public.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		ScopeOriginal, InputHex string
		NowMillis               int64
		Binding                 struct{ NetworkID, CanonicalSignerOwner string }
	}
	if json.Unmarshal(raw, &f) != nil {
		t.Fatal("public fixture")
	}
	network, _ := hex.DecodeString(f.Binding.NetworkID)
	input, _ := hex.DecodeString(f.InputHex)
	key, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal("synthetic keygen")
	}
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	if err != nil {
		t.Fatal("synthetic export")
	}
	defer material.Clear()
	b := ynxbatch.NetworkResourceConsentBinding{NetworkID: network, Owner: f.Binding.CanonicalSignerOwner, KeyEpoch: "1", IssuedHeight: "20", PKA: pub.PKA, PKB: pub.PKB}
	state := ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: network, EnableAt: 1, Records: []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: b.Owner, PKA: pub.PKA, PKB: pub.PKB, Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 1}}}
	policy, err := ynxauth.EncodeWalletPolicyProjection(state, b.Owner)
	if err != nil {
		t.Fatal(err)
	}
	in := resourceForeignInput{[]byte(f.ScopeOriginal), input, b, consent.CurrentDATA{SubjectOwner: b.Owner, PolicyOriginal: policy, ExecutionHeight: 20, NowMillis: f.NowMillis}, material}
	code, member := resourceForeignControls(in)
	if code != 0 {
		t.Fatalf("actual C fixed lifecycle case %d", code)
	}
	if _, err := ynxbatch.InspectNetworkResourceConsentMember(member, in.scope, in.input, f.NowMillis, b); err != nil {
		t.Fatal("independent original Go AND", err)
	}
	for _, which := range []string{"A", "B", "purpose", "owner", "network", "fullpair", "input", "scope"} {
		t.Run(which, func(t *testing.T) {
			m, e := ynxbatch.DecodeMember(member)
			if e != nil {
				t.Fatal("decode")
			}
			scope, original := in.scope, in.input
			expected := b
			switch which {
			case "A":
				m.Certificate.SigmaA[0] ^= 1
			case "B":
				m.Certificate.SigmaB[0] ^= 1
			case "purpose":
				m.Certificate.Purpose = "TX"
			case "owner":
				m.Certificate.Owner = "0x1111111111111111111111111111111111111111"
			case "network":
				expected.NetworkID = bytes.Repeat([]byte{7}, 32)
			case "fullpair":
				expected.PKB = bytes.Clone(b.PKB)
				expected.PKB[0] ^= 1
			case "input":
				original = append(bytes.Clone(in.input), ' ')
			case "scope":
				scope = append(bytes.Clone(in.scope), ' ')
			}
			wire, e := ynxbatch.EncodeMember(m)
			if e == nil {
				if _, e = ynxbatch.InspectNetworkResourceConsentMember(wire, scope, original, f.NowMillis, expected); e == nil {
					t.Fatal("mutated fixed member accepted")
				}
			}
		})
	}
	resourceOperations.Lock()
	defer resourceOperations.Unlock()
	if len(resourceOperations.entries) != 0 || resourceOperations.owned != 0 {
		t.Fatal("operation registry retained public debt")
	}
}

func TestNetworkResourceConsentCABIPUBLICRegistryCapacityAndDebt(t *testing.T) {
	if !t.Run("panic-recovery", func(t *testing.T) {
		resourceOperations.Lock()
		baselineBytes, baselineCount := resourceOperations.owned, len(resourceOperations.entries)
		resourceOperations.Unlock()
		id, e, code := resourceReserve(ynxbatch.MaxNetworkResourceScopeBytes, ynxbatch.MaxNetworkResourceInputBytes)
		if code != resultOK {
			t.Fatal("PUBLIC reservation")
		}
		// Only this synthetic uninstalled reservation is cleaned after a RED. No
		// real operation, key, Source or UNKNOWN history is discarded by this test.
		t.Cleanup(func() {
			resourceOperations.Lock()
			defer resourceOperations.Unlock()
			if resourceOperations.entries[id] == e {
				delete(resourceOperations.entries, id)
				resourceOperations.owned -= e.owned
			}
		})
		var retained bool
		func() {
			defer func() {
				if recover() != nil {
					_, retained = resourcePanicOutcome(id, e)
				}
				resourceDone(e)
			}()
			panic("PUBLIC PREPARE before resourceInstall")
		}()
		resourceOperations.Lock()
		kept := resourceOperations.entries[id] == e
		owned, count, active := resourceOperations.owned, len(resourceOperations.entries), e.active
		resourceOperations.Unlock()
		if retained || kept || owned != baselineBytes || count != baselineCount || active != 0 {
			t.Fatalf("uninstalled PREPARE panic lost handle but retained public reservation: retained=%v kept=%v bytes=%d active=%d", retained, kept, owned-baselineBytes, active)
		}
		if _, code = resourceAcquire(id); code != resourceUnknownHandle {
			t.Fatal("reclaimed operation became usable")
		}
		// A nil owner is harmless; a public entry with another active debt is NOT
		// removed, and repeated cleanup cannot decrement the reservation twice.
		if _, retained = resourcePanicOutcome(0, nil); retained {
			t.Fatal("nil retained")
		}
		id2, e2, code := resourceReserve(1, 1)
		if code != resultOK {
			t.Fatal("debt reservation")
		}
		resourceOperations.Lock()
		e2.active++
		resourceOperations.Unlock()
		if _, retained = resourcePanicOutcome(id2, e2); retained {
			t.Fatal("uninstalled exposed")
		}
		resourceOperations.Lock()
		kept = resourceOperations.entries[id2] == e2
		resourceOperations.Unlock()
		if !kept {
			t.Fatal("other active debt removed")
		}
		resourceDone(e2)
		resourcePanicOutcome(id2, e2)
		resourcePanicOutcome(id2, e2)
		resourceDone(e2)
		resourceOperations.Lock()
		owned, count = resourceOperations.owned, len(resourceOperations.entries)
		resourceOperations.Unlock()
		if owned != baselineBytes || count != baselineCount {
			t.Fatal("recovery accounting")
		}
		// Actual PUBLIC Prepare supplies an installed attempt without any key or
		// signature. An existing terminal first cause survives recovery under the
		// same handle, including when another C call retains active debt.
		raw, err := os.ReadFile("../../internal/ynxbatch/testdata/network-resource-consent-v1-public.json")
		if err != nil {
			t.Fatal(err)
		}
		var f struct {
			ScopeOriginal, InputHex, PKA, PKB string
			NowMillis                         int64
			Binding                           struct{ NetworkID, CanonicalSignerOwner, KeyEpoch, IssuedHeight string }
		}
		if json.Unmarshal(raw, &f) != nil {
			t.Fatal("public vector")
		}
		network, _ := hex.DecodeString(f.Binding.NetworkID)
		input, _ := hex.DecodeString(f.InputHex)
		pkA, _ := hex.DecodeString(f.PKA)
		pkB, _ := hex.DecodeString(f.PKB)
		b := ynxbatch.NetworkResourceConsentBinding{NetworkID: network, Owner: f.Binding.CanonicalSignerOwner, KeyEpoch: f.Binding.KeyEpoch, IssuedHeight: f.Binding.IssuedHeight, PKA: pkA, PKB: pkB}
		policy, err := ynxauth.EncodeWalletPolicyProjection(ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: network, EnableAt: 1, Records: []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: b.Owner, PKA: pkA, PKB: pkB, Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 1}}}, b.Owner)
		if err != nil {
			t.Fatal("public policy")
		}
		c := consent.CurrentDATA{SubjectOwner: b.Owner, PolicyOriginal: policy, ExecutionHeight: 20, NowMillis: f.NowMillis}
		a, err := consent.PrepareMaterial([]byte(f.ScopeOriginal), input, b, c)
		if err != nil {
			t.Fatal("public prepare", err)
		}
		c.SubjectOwner = "foreign"
		if err = a.Current(c); err != consent.ErrCurrent {
			t.Fatal("terminal current test")
		}
		before := a.OriginalOutcome()
		id3, e3, code := resourceReserve(len(f.ScopeOriginal), len(input))
		if code != resultOK {
			t.Fatal("installed reservation")
		}
		resourceInstall(e3, a)
		other, code := resourceAcquire(id3)
		if code != resultOK || other != e3 {
			t.Fatal("same installed handle")
		}
		out, retained := resourcePanicOutcome(id3, e3)
		if !retained || out.FirstCause != before.FirstCause || !bytes.Equal(out.MemberOriginal, before.MemberOriginal) || !out.Retired || out.AttemptSelected || out.SignatureVerified {
			t.Fatal("installed original lost or authority invented")
		}
		resourceOperations.Lock()
		kept = resourceOperations.entries[id3] == e3
		resourceOperations.Unlock()
		if !kept || resourceRemove(id3, e3) {
			t.Fatal("installed active parent removed")
		}
		resourceDone(other)
		a.Close()
		if !resourceRemove(id3, e3) {
			t.Fatal("original explicit close release")
		}
		resourceDone(e3)
	}) {
		return
	}
	resourceOperations.Lock()
	empty := len(resourceOperations.entries) == 0 && resourceOperations.owned == 0
	resourceOperations.Unlock()
	if !empty {
		t.Fatal("prior operation debt cannot be discarded")
	}
	// Direct reservation control; no key, signature, fake authority or provider.
	var ids []uint64
	var entries []*resourceEntry
	for {
		id, e, code := resourceReserve(1, 1)
		if code == resourceResourceLimit {
			break
		}
		if code != resultOK {
			t.Fatal("reserve")
		}
		ids = append(ids, id)
		entries = append(entries, e)
		if len(ids) > resourceOperationLimit {
			t.Fatal("unbounded")
		}
	}
	if len(ids) == 0 || len(ids) >= resourceOperationLimit {
		t.Fatal("total public bytes not bounded before live count")
	}
	for i, e := range entries {
		if !resourceRemove(ids[i], e) {
			t.Fatal("release reservation")
		}
		resourceDone(e)
	}
	// An in-flight C call retains its registry debt even when the math method
	// has returned: result marshalling must complete before release can succeed.
	id, e, code := resourceReserve(1, 1)
	if code != resultOK {
		t.Fatal("debt reserve")
	}
	resourceOperations.Lock()
	e.active++
	resourceOperations.Unlock()
	if resourceAlone(e) || resourceRemove(id, e) {
		t.Fatal("concurrent return debt released")
	}
	resourceDone(e)
	if !resourceAlone(e) || !resourceRemove(id, e) {
		t.Fatal("completed call debt not released")
	}
	resourceDone(e)
	// Exhaust the separate live-count guard without allocating public buffers.
	resourceOperations.Lock()
	for i := 0; i < resourceOperationLimit; i++ {
		resourceOperations.next++
		resourceOperations.entries[resourceOperations.next] = &resourceEntry{}
	}
	resourceOperations.Unlock()
	if _, _, code := resourceReserve(0, 0); code != resourceResourceLimit {
		t.Fatal("live count limit")
	}
	resourceOperations.Lock()
	clear(resourceOperations.entries)
	resourceOperations.Unlock()
}
