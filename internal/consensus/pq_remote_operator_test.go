//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
)

func TestPQRemoteOperatorInputsPinOriginalGenesisMigrationScheduleAndFullBinding(t *testing.T) {
	q := newPQPVFixture(t, false)
	dir := t.TempDir()
	write := func(name string, value []byte) string {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, value, 0600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	migration, err := q.f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	schedule, err := json.Marshal(q.schedule)
	if err != nil {
		t.Fatal(err)
	}
	pin, err := q.schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	binding, err := json.Marshal(remoteRuntimeBinding(t, q, 0))
	if err != nil {
		t.Fatal(err)
	}
	files := PQOperatorFiles{Migration: write("migration.json", migration), Genesis: write("genesis.json", q.f.raw), State: q.path, Schedule: write("schedule.json", schedule), ScheduleHash: pin, Binding: write("binding.json", binding), Pins: q.f.pins}
	before, err := os.ReadFile(q.path)
	if err != nil {
		t.Fatal(err)
	}
	inputs, err := LoadPQOperatorInputs(files)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(inputs.Bootstrap.genesisID, q.f.bootstrap.genesisID) || inputs.Binding.SignerStatePath != q.signerPaths[0] {
		t.Fatal("operator inputs changed original identity/history binding")
	}
	for _, mutate := range []func(*PQOperatorFiles){func(f *PQOperatorFiles) { f.Pins.CometGenesisSHA256 = string(bytes.Repeat([]byte{'0'}, 64)) }, func(f *PQOperatorFiles) { f.Pins.OriginalGenesisHash = "foreign" }, func(f *PQOperatorFiles) { f.Pins.MigrationStateHash = "foreign" }, func(f *PQOperatorFiles) { f.ScheduleHash = string(bytes.Repeat([]byte{'0'}, 64)) }} {
		bad := files
		mutate(&bad)
		if _, err = LoadPQOperatorInputs(bad); err == nil {
			t.Fatal("self-reported or incorrect independent pin accepted")
		}
	}
	foreign := remoteRuntimeBinding(t, q, 0)
	foreign.Policy.GenesisID = bytes.Repeat([]byte{0x51}, 32)
	raw, err := json.Marshal(foreign)
	if err != nil {
		t.Fatal(err)
	}
	bad := files
	bad.Binding = write("foreign-binding.json", raw)
	if _, err = LoadPQOperatorInputs(bad); err == nil {
		t.Fatal("foreign custody genesis accepted")
	}
	bad = files
	bad.Binding = write("ambiguous.json", append(bytes.Clone(binding), []byte(` {}`)...))
	if _, err = LoadPQOperatorInputs(bad); err == nil {
		t.Fatal("trailing public binding accepted")
	}
	// Loading all operator material never normalizes or persists the current
	// application file; exact H/AppHash authority remains a separate live call.
	after, err := os.ReadFile(q.path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("remote operator loading rewrote application state", err)
	}
}

func TestPQRemoteOperatorIdentityAndCredentialRejectSubstitution(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "original.json")
	key := cmted.GenPrivKey()
	nodeKey := &p2p.NodeKey{PrivKey: key}
	if err := nodeKey.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPQExistingNodeKey(path); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(dir, "alias.json")
	if err := os.Symlink(path, alias); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPQExistingNodeKey(alias); err == nil {
		t.Fatal("symlink private identity accepted")
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPQExistingNodeKey(path); err == nil {
		t.Fatal("public-readable identity accepted")
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	key[len(key)-1] ^= 1
	raw, err := cmtjson.Marshal(nodeKey)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadPQExistingNodeKey(path); err == nil {
		t.Fatal("mismatched Ed seed/public identity accepted")
	}
	if _, err = ReadPQRecoveryCredential(0); err == nil {
		t.Fatal("implicit stdin credential accepted")
	}
	for _, size := range []int{0, 31, 32, 33} {
		reader, writer, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		input := bytes.Repeat([]byte{0x63}, size)
		if _, err = writer.Write(input); err != nil {
			t.Fatal(err)
		}
		_ = writer.Close()
		fd, err := syscall.Dup(int(reader.Fd()))
		_ = reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		credential, err := ReadPQRecoveryCredential(fd)
		if size == 32 {
			if err != nil || !bytes.Equal(credential, input) {
				t.Fatal("exact private inherited credential rejected", err)
			}
			clear(credential)
		} else if err == nil || credential != nil {
			t.Fatal("invalid credential retained or accepted")
		}
	}
}
