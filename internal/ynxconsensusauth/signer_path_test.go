//go:build unix

package ynxconsensusauth

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSignerParentDirectoryAliasSharesLock(t *testing.T) {
	key, registry, policy := realKeyFixture(t)
	dir := t.TempDir()
	actual := filepath.Join(dir, "actual")
	if err := os.Mkdir(actual, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(dir, "alias")
	if err := os.Symlink(actual, alias); err != nil {
		t.Fatal(err)
	}
	signer, err := CreateSigner(filepath.Join(actual, "state.json"), key, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer signer.Close()
	if other, err := ResumeSigner(filepath.Join(alias, "state.json"), key, registry); err == nil {
		other.Close()
		t.Fatal("parent alias obtained a second signer lock")
	}
	if _, err := signer.Sign(fixtureRequest(t, 100)); err != nil {
		t.Fatal(err)
	}
}

func TestSignerHardLinkedStateRejected(t *testing.T) {
	key, registry, policy := realKeyFixture(t)
	dir := t.TempDir()
	path, alias := filepath.Join(dir, "state.json"), filepath.Join(dir, "alias.json")
	signer, err := CreateSigner(path, key, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer signer.Close()
	if err := os.Link(path, alias); err != nil {
		t.Fatal(err)
	}
	if other, err := ResumeSigner(alias, key, registry); err == nil {
		other.Close()
		t.Fatal("hard link forked live signer history")
	}
	if _, err := signer.Sign(fixtureRequest(t, 100)); err != nil {
		t.Fatal(err)
	}
}
