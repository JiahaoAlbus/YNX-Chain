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
)

var errOfflineConsensusWholeRead = errors.New("whole-root-sized read request refused")

type offlineConsensusReadBound struct {
	input   io.Reader
	limit   int
	largest int
}

func (r *offlineConsensusReadBound) Read(p []byte) (int, error) {
	if len(p) > r.largest {
		r.largest = len(p)
	}
	if len(p) > r.limit {
		return 0, errOfflineConsensusWholeRead
	}
	return r.input.Read(p)
}

func TestOfflineConsensusDecodeStreamsLongHistoryAndPreservesCompleteState(t *testing.T) {
	// Synthetic DATA with normal empty block production. It supplies neither
	// an original public checkpoint nor evidence of a measured RSS ceiling.
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
		t.Fatal("fixture must exceed the whole-root decoder buffer growth boundary")
	}
	oldReader := &offlineConsensusReadBound{input: bytes.NewReader(wire), limit: maximumRead}
	var old devnetSnapshot
	if err := json.NewDecoder(oldReader).Decode(&old); !errors.Is(err, errOfflineConsensusWholeRead) {
		t.Fatalf("old whole-root Decode did not hit the actual read bound: %v", err)
	}
	reader := &offlineConsensusReadBound{input: bytes.NewReader(wire), limit: maximumRead}
	decoded, err := decodeOfflineConsensusSnapshot(reader)
	pqMust(t, err)
	if reader.largest > maximumRead || len(decoded.Blocks) != len(snapshot.Blocks) {
		t.Fatal("streaming decoder buffered the root or truncated retained history")
	}
	decodedJSON, err := json.Marshal(decoded)
	pqMust(t, err)
	if !bytes.Equal(wire, decodedJSON) {
		t.Fatal("streaming decoder changed a complete typed snapshot field")
	}
	pqMust(t, validateReplicationSnapshot(decoded, decoded.Config))

	expected, err := d.ExportConsensusMigrationState()
	pqMust(t, err)
	expectedJSON, err := expected.CanonicalJSON()
	pqMust(t, err)
	directory := t.TempDir()
	path := filepath.Join(directory, "devnet-state.json")
	pqMust(t, os.WriteFile(path, wire, 0o600))
	pqMust(t, os.WriteFile(filepath.Join(directory, "devnet-state.integrity-version"), []byte(fmt.Sprintf("%d\n", snapshot.Version)), 0o600))
	before := captureOfflineConsensusSource(t, directory)
	actual, err := ExportConsensusMigrationCheckpoint(directory)
	pqMust(t, err)
	actualJSON, err := actual.CanonicalJSON()
	pqMust(t, err)
	if !bytes.Equal(actualJSON, expectedJSON) {
		t.Fatal("streamed owned export changed full canonical migration state")
	}
	before.assertUnchanged(t)
}

func TestOfflineConsensusDecodeRetainsTypedJSONSemantics(t *testing.T) {
	for _, wire := range []string{
		`{"VERSION":1,"version":2,"config":{"slug":"testnet"},"CONFIG":{"chainId":6423},"blocks":null}`,
		`{"accounts":{"alice":{"address":"alice","balance":3}},"ACCOUNTS":{"bob":{"address":"bob","nonce":7}},"blocks":[]}`,
		`{"blocks":[{"height":7,"hash":"retained","validator":"a"},{"height":8}],"BLOCKS":[{"height":9}]}`,
		`{"blocks":[{"height":7}],"blocks":[],"blocks":[{"height":2}]}`,
	} {
		var expected devnetSnapshot
		decoder := json.NewDecoder(strings.NewReader(wire))
		decoder.DisallowUnknownFields()
		pqMust(t, decoder.Decode(&expected))
		actual, err := decodeOfflineConsensusSnapshot(strings.NewReader(wire))
		pqMust(t, err)
		if !reflect.DeepEqual(actual, expected) {
			t.Fatalf("typed duplicate/case/null/array semantics changed for %s", wire)
		}
	}
	// The nested caller consumes only the opening token and retains its own
	// remaining fields. Repeated runtime objects merge into the same snapshot.
	decoder := json.NewDecoder(strings.NewReader(`[{"version":2,"blocks":[{"height":7}]},{"config":{"slug":"testnet"}},17]`))
	_, err := decoder.Token()
	pqMust(t, err)
	var combined devnetSnapshot
	for i := 0; i < 2; i++ {
		opening, err := decoder.Token()
		pqMust(t, err)
		if opening != json.Delim('{') {
			t.Fatal("fixture snapshot opening missing")
		}
		pqMust(t, decodeOfflineConsensusSnapshotObjectInto(decoder, &combined))
	}
	var remainder int
	pqMust(t, decoder.Decode(&remainder))
	if remainder != 17 || combined.Version != 2 || len(combined.Blocks) != 1 || combined.Blocks[0].Height != 7 || combined.Config.Slug != "testnet" {
		t.Fatal("nested snapshot parser consumed its caller's remainder or reset existing fields")
	}
}

func TestOfflineConsensusDecodeRejectsMalformedTypedAndTrailingInput(t *testing.T) {
	for _, wire := range []string{
		`null`, `[]`, `{"futureModule":{}}`, `{"config":{"futureField":1}}`,
		`{"blocks":{}}`, `{"blocks":[{"futureField":1}]}`, `{"blocks":[{"height":"wrong"}]}`,
		`{"blocks":[`, `{"version":2`, `{} {}`, `{} trailing`,
	} {
		if _, err := decodeOfflineConsensusSnapshot(strings.NewReader(wire)); err == nil {
			t.Fatalf("invalid checkpoint accepted: %s", wire)
		}
	}
	if _, err := decodeOfflineConsensusSnapshot(io.MultiReader(strings.NewReader(`{"blocks":[`), offlineConsensusReadFailure{})); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("original reader failure was lost: %v", err)
	}
}

type offlineConsensusReadFailure struct{}

func (offlineConsensusReadFailure) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestOfflineConsensusDecodeHeldDescriptorRejectsMetadataAndContentChanges(t *testing.T) {
	for _, kind := range []string{"mode", "link", "same-size-content", "closed-fd"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "source")
			pqMust(t, os.WriteFile(path, []byte("original"), 0o600))
			source, err := readOfflineConsensusFile(path, false)
			pqMust(t, err)
			defer source.close()
			switch kind {
			case "mode":
				pqMust(t, os.Chmod(path, 0o400))
			case "link":
				pqMust(t, os.Link(path, path+".other"))
			case "same-size-content":
				pqMust(t, os.WriteFile(path, []byte("replaced"), 0o600))
				pqMust(t, os.Chtimes(path, source.info.ModTime(), source.info.ModTime()))
				// Inject an equal metadata witness to require the full held-FD
				// content digest independently of the metadata checks.
				source.info, err = os.Lstat(path)
				pqMust(t, err)
			case "closed-fd":
				pqMust(t, source.close())
			}
			if err := source.unchanged(); err == nil {
				t.Fatal("changed original descriptor/identity/content was accepted")
			}
		})
	}
}
