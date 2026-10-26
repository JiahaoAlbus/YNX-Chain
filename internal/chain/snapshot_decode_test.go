package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/iotest"
)

// This is the original normal loader's Decode/EOF oracle, without its state
// validation. The offline decoder intentionally has a different unknown-field
// contract and cannot be substituted for this oracle.
func normalSnapshotDecodeOracle(input io.Reader) (devnetSnapshot, error) {
	var snapshot devnetSnapshot
	decoder := json.NewDecoder(input)
	if err := decoder.Decode(&snapshot); err != nil {
		return snapshot, fmt.Errorf("decode devnet snapshot: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return snapshot, errors.New("decode devnet snapshot: multiple JSON values")
		}
		return snapshot, fmt.Errorf("decode devnet snapshot trailing data: %w", err)
	}
	return snapshot, nil
}

func TestNormalSnapshotDecodeRetainsStdlibCompatibility(t *testing.T) {
	for _, wire := range []string{
		`null`, `{}`, " \n {\"blocks\":[]} \r\n\t",
		`{"VERSION":1,"version":2,"config":{"slug":"testnet","future":true},"CONFIG":{"chainId":6423},"blocks":null}`,
		`{"version":3,"version":null,"config":null,"unknown":{"nested":[{},null,[1,"{[\\\"}"]]},"blocks":[]}`,
		`{"accounts":{"alice":{"address":"alice","balance":3,"nonce":9007199254740993,"future":17}},"ACCOUNTS":{"bob":{"address":"bob","nonce":7}},"blocks":[]}`,
		`{"accounts":{"alice":{"balance":3}},"accounts":null,"accounts":{"bob":{"balance":4}}}`,
		`{"blocks":[{"height":7,"hash":"retained","validator":"a","future":{"nested":[1,2]}},{"height":8}],"BLOCKS":[{"height":9}]}`,
		`{"blocks":[{"height":7}],"blocks":[],"blocks":[{"height":2}]}`,
		`{"blocks":[{"height":7}],"blocks":null,"blocks":[null,{"height":2}]}`,
		`{"future":null,"future":[{"unknown":true}],"future":"brackets { [ ] } and \\\" quotes","version":2}`,
		`{"future":1e10000,"anotherFuture":[-1e10000,{"large":1e10000}],"version":2}`,
		`[]`, `42`, `"snapshot"`, `true`, ``, `{"version":"wrong"}`,
		`{"blocks":{}}`, `{"blocks":[{"height":"wrong"}]}`, `{"blocks":[`,
		`{"future":[1,]}`, `{"future":{"bad":}}`, `{"version":2`,
		`{} {}`, `null null`, `{} [`, `{} trailing`,
	} {
		expected, expectedErr := normalSnapshotDecodeOracle(strings.NewReader(wire))
		for _, input := range []io.Reader{strings.NewReader(wire), iotest.OneByteReader(strings.NewReader(wire))} {
			actual, err := decodeNormalSnapshot(input)
			if (err == nil) != (expectedErr == nil) {
				t.Fatalf("normal JSON acceptance changed for %q: got %v want %v", wire, err, expectedErr)
			}
			if err == nil && !reflect.DeepEqual(actual, expected) {
				t.Fatalf("normal typed duplicate/case/null/unknown semantics changed for %q", wire)
			}
		}
	}
	for _, prefix := range []string{`{"blocks":[`, `{"future":[`, `{}`} {
		_, err := decodeNormalSnapshot(io.MultiReader(strings.NewReader(prefix), offlineConsensusReadFailure{}))
		if !errors.Is(err, io.ErrUnexpectedEOF) {
			t.Fatalf("normal reader lost original I/O failure after %q: %v", prefix, err)
		}
	}
}

func TestNormalSnapshotDecodeRetainsWholeDocumentDepthBound(t *testing.T) {
	for _, field := range []string{"unknown", "config", "blocks"} {
		for _, depth := range []int{10000, 10001} {
			prefix, suffix, enclosing := `{"future":`, `}`, 1
			switch field {
			case "config":
				prefix, suffix, enclosing = `{"config":{"future":`, `}}`, 2
			case "blocks":
				prefix, suffix, enclosing = `{"blocks":[{"future":`, `}]}`, 3
			}
			wire := prefix + strings.Repeat("[", depth-enclosing) + `"escaped \\\" delimiters { [ ] }"` + strings.Repeat("]", depth-enclosing) + suffix
			expected, expectedErr := normalSnapshotDecodeOracle(strings.NewReader(wire))
			actual, err := decodeNormalSnapshot(strings.NewReader(wire))
			if (err == nil) != (expectedErr == nil) || (err == nil && !reflect.DeepEqual(actual, expected)) {
				t.Fatalf("normal whole-document nesting bound changed: field=%s depth=%d got=%v want=%v", field, depth, err, expectedErr)
			}
			if (depth == 10000) != (err == nil) {
				t.Fatalf("depth oracle did not exercise stdlib's actual boundary: %d %v", depth, err)
			}
		}
	}
}

func TestNormalSnapshotDecodeStreamsRetainedHistory(t *testing.T) {
	// Synthetic normal producer history, not a public-chain RSS or TPS result.
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	for i := 0; i < 4096; i++ {
		d.ProduceBlock()
	}
	snapshot, err := sealDevnetSnapshot(d.snapshotLocked())
	pqMust(t, err)
	wire, err := json.Marshal(snapshot)
	pqMust(t, err)
	const maximumRead = 32 << 10
	if len(wire) < 4*maximumRead {
		t.Fatal("normal history fixture does not reach the old root-buffer boundary")
	}
	oldReader := &offlineConsensusReadBound{input: bytes.NewReader(wire), limit: maximumRead}
	if _, err := normalSnapshotDecodeOracle(oldReader); !errors.Is(err, errOfflineConsensusWholeRead) {
		t.Fatalf("original normal Decode did not reproduce the root-buffer read failure: %v", err)
	}
	reader := &offlineConsensusReadBound{input: bytes.NewReader(wire), limit: maximumRead}
	decoded, err := decodeNormalSnapshot(reader)
	pqMust(t, err)
	if reader.largest > maximumRead || len(decoded.Blocks) != len(snapshot.Blocks) {
		t.Fatal("normal streaming decoder buffered or truncated the retained history")
	}
	actual, err := json.Marshal(decoded)
	pqMust(t, err)
	if !bytes.Equal(actual, wire) {
		t.Fatal("normal streaming decode changed complete typed snapshot bytes")
	}
	pqMust(t, validateReplicationSnapshot(decoded, decoded.Config))
}

func normalSnapshotRestoreFixture(t *testing.T, version int) (*Devnet, devnetSnapshot) {
	t.Helper()
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	_, err := d.Faucet("ynx_normal_snapshot_owner", 23)
	pqMust(t, err)
	d.ProduceBlock()
	if version == pqDevnetSnapshotVersion {
		pqMust(t, d.EnableAccountPQ(2))
	}
	snapshot, err := sealDevnetSnapshot(d.snapshotLocked())
	pqMust(t, err)
	if version == legacyDevnetSnapshotVersion {
		snapshot.Version, snapshot.StateIntegrity = version, ""
	}
	return d, snapshot
}

func TestNormalSnapshotRestoreRetainsV1V2V3State(t *testing.T) {
	for _, version := range []int{legacyDevnetSnapshotVersion, devnetSnapshotVersion, pqDevnetSnapshotVersion} {
		t.Run(fmt.Sprintf("v%d", version), func(t *testing.T) {
			d, snapshot := normalSnapshotRestoreFixture(t, version)
			dir := t.TempDir()
			writeOfflineConsensusFixture(t, filepath.Join(dir, "devnet-state.json"), snapshot, false)
			if version >= devnetSnapshotVersion {
				pqMust(t, os.WriteFile(filepath.Join(dir, "devnet-state.integrity-version"), []byte(fmt.Sprintf("%d\n", version)), 0o600))
			}
			expected := moduleBusinessState(t, d)
			for i := 0; i < 2; i++ {
				restored, err := NewPersistentDevnet(d.cfg, dir)
				pqMust(t, err)
				assertModuleState(t, restored, expected)
				if restored.blocks[0].Hash != d.blocks[0].Hash || restored.blocks[len(restored.blocks)-1].Hash != d.blocks[len(d.blocks)-1].Hash {
					t.Fatal("normal persistent restore changed original chain identity or tip")
				}
			}
			marker, err := os.ReadFile(filepath.Join(dir, "devnet-state.integrity-version"))
			pqMust(t, err)
			wantMarker := "2\n"
			if version == pqDevnetSnapshotVersion {
				wantMarker = "3\n"
			}
			if string(marker) != wantMarker {
				t.Fatal("normal restore changed durable marker upgrade/downgrade semantics")
			}
		})
	}
}

func TestNormalSnapshotRestoreRejectsCorruptionAndDowngrade(t *testing.T) {
	for _, name := range []string{"integrity", "history", "resource", "policy", "chain-id", "legacy-marker", "pq-marker", "invalid-marker", "trailing"} {
		t.Run(name, func(t *testing.T) {
			_, snapshot := normalSnapshotRestoreFixture(t, devnetSnapshotVersion)
			marker := "2\n"
			switch name {
			case "integrity":
				snapshot.StateIntegrity = strings.Repeat("0", 64)
			case "history":
				snapshot.Blocks[1].ParentHash = strings.Repeat("1", 64)
			case "resource":
				snapshot.SponsorIntegrity = strings.Repeat("0", 64)
			case "policy":
				_, snapshot = normalSnapshotRestoreFixture(t, pqDevnetSnapshotVersion)
				snapshot.AccountPolicy.NetworkID[0] ^= 1
				marker = "3\n"
			case "chain-id":
				snapshot.Config.ChainID++
			case "legacy-marker":
				snapshot.Version, snapshot.StateIntegrity = legacyDevnetSnapshotVersion, ""
			case "pq-marker":
				marker = "3\n"
			case "invalid-marker":
				marker = "unknown\n"
			}
			if name == "history" || name == "resource" || name == "policy" || name == "chain-id" {
				var err error
				snapshot, err = sealDevnetSnapshot(snapshot)
				pqMust(t, err)
			}
			dir := t.TempDir()
			path := filepath.Join(dir, "devnet-state.json")
			writeOfflineConsensusFixture(t, path, snapshot, false)
			if name == "trailing" {
				f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0)
				pqMust(t, err)
				_, err = f.WriteString(" {}")
				pqMust(t, err)
				pqMust(t, f.Close())
			}
			pqMust(t, os.WriteFile(filepath.Join(dir, "devnet-state.integrity-version"), []byte(marker), 0o600))
			before := captureOfflineConsensusSource(t, dir)
			if _, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir); err == nil {
				t.Fatal("normal restore admitted corrupt state or a marker downgrade")
			}
			before.assertUnchanged(t)
		})
	}
}
