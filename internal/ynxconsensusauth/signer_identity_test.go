//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSignerIdentityDetachedPublicAuthorityAndLifecycle(t *testing.T) {
	k, registry, policy := realKeyFixture(t)
	signer, err := CreateSigner(filepath.Join(t.TempDir(), "state.json"), k, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer signer.Close()
	identity, err := signer.Identity()
	if err != nil {
		t.Fatal(err)
	}
	if identity.Epoch != registry.record.Epoch || !reflect.DeepEqual(identity.Policy, policy) || !bytes.Equal(identity.ValidatorAddress, registry.record.ValidatorAddress) || !bytes.Equal(identity.MLDSA87PublicKey, registry.record.MLDSA87PublicKey) || !bytes.Equal(identity.SLHDSASHA2256fPublicKey, registry.record.SLHDSASHA2256fPublicKey) {
		t.Fatal("identity differs from complete durable authority")
	}
	identity.Policy.GenesisID[0] ^= 1
	identity.ValidatorAddress[0] ^= 1
	identity.MLDSA87PublicKey[0] ^= 1
	identity.SLHDSASHA2256fPublicKey[0] ^= 1
	again, err := signer.Identity()
	if err != nil || !bytes.Equal(again.Policy.GenesisID, policy.GenesisID) || !bytes.Equal(again.MLDSA87PublicKey, registry.record.MLDSA87PublicKey) || !bytes.Equal(again.SLHDSASHA2256fPublicKey, registry.record.SLHDSASHA2256fPublicKey) || !bytes.Equal(again.ValidatorAddress, registry.record.ValidatorAddress) {
		t.Fatal("identity leaked signer-owned storage", err)
	}
	k.Destroy()
	if _, err = signer.Identity(); err == nil {
		t.Fatal("destroyed key identity treated as usable")
	}
	signer.Close()
	for _, s := range []*Signer{nil, {}, signer} {
		if _, err = s.Identity(); err == nil {
			t.Fatal("missing or closed signer identity accepted")
		}
	}
}
