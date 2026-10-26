package chain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestConsensusMigrationDecodeStreamsCompleteOriginalHistory(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	for i := 0; i < 1000; i++ {
		d.ProduceBlock()
	}
	state, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if err := d.EnableAccountPQ(state.Height + 2); err != nil {
		t.Fatal(err)
	}
	state, err = d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	wire, err := state.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	// Whole-root Decoder.Decode grows its internal input buffer with history.
	// Reject those large read requests, while retaining every original byte.
	input := &migrationBoundedReadRequests{reader: bytes.NewReader(wire), limit: 8192}
	actual, err := ReadConsensusMigrationState(input)
	if err != nil {
		t.Fatal(err)
	}
	var expected ConsensusMigrationState
	if err := json.Unmarshal(wire, &expected); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) || len(actual.Runtime.Blocks) != len(d.blocks) {
		t.Fatal("streaming decoder changed original history, global account policy or complete typed state")
	}
	encoded, err := actual.CanonicalJSON()
	if err != nil || !bytes.Equal(wire, encoded) {
		t.Fatalf("canonical state identity changed: %v", err)
	}
}

func TestConsensusMigrationDecodePreservesTypedJSONCompatibility(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	state, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	wire, err := state.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	// Repeated object fields merge as they did in encoding/json. In particular
	// a later partial runtime object must not erase its complete history.
	merged := append(append([]byte{}, wire[:len(wire)-1]...), []byte(",\"RUNTIME\":{\"VERSION\":"+fmt.Sprint(state.Runtime.Version)+"},\"HEIGHT\":"+fmt.Sprint(state.Height)+"}")...)
	var expected ConsensusMigrationState
	if err := json.Unmarshal(merged, &expected); err != nil {
		t.Fatal(err)
	}
	actual, err := ReadConsensusMigrationState(bytes.NewReader(merged))
	if err != nil || !reflect.DeepEqual(actual, expected) {
		t.Fatalf("existing folded/repeated object field semantics changed: %v", err)
	}
	legacy := state
	legacy.Version = LegacyConsensusMigrationVersion
	legacy.SourceFormat = "ynx-devnet-state-v1"
	legacy.Runtime, legacy.AccountPolicy, legacy.ContractMaterials = nil, nil, nil
	legacy.OriginalGenesisHash = ""
	legacy.StateHash, err = legacy.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := legacy.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	raw = append(append([]byte{}, raw[:len(raw)-1]...), []byte(",\"runtime\":null}")...)
	if _, err := ReadConsensusMigrationState(bytes.NewReader(raw)); err != nil {
		t.Fatalf("existing legacy runtime:null no longer readable: %v", err)
	}
}

func TestConsensusMigrationDecodeRetainsAllStrictFailures(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	state, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	wire, err := state.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string][]byte{
		"root-unknown":     append(append([]byte{}, wire[:len(wire)-1]...), []byte(",\"unknown\":1}")...),
		"runtime-unknown":  bytes.Replace(wire, []byte("\"runtime\": {"), []byte("\"runtime\": {\"unknown\":1,"), 1),
		"block-unknown":    bytes.Replace(wire, []byte("\"parentHash\":"), []byte("\"unknown\":1,\"parentHash\":"), 1),
		"second-document":  append(append([]byte{}, wire...), []byte("\n{}")...),
		"trailing-junk":    append(append([]byte{}, wire...), 'x'),
		"truncated":        wire[:len(wire)-1],
		"wrong-state-hash": bytes.Replace(wire, []byte(state.StateHash), []byte(strings.Repeat("0", len(state.StateHash))), 1),
		"non-object":       []byte("[]"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ReadConsensusMigrationState(bytes.NewReader(raw)); err == nil {
				t.Fatal("invalid complete migration was accepted")
			}
		})
	}
}

type migrationBoundedReadRequests struct {
	reader *bytes.Reader
	limit  int
}

func (r *migrationBoundedReadRequests) Read(p []byte) (int, error) {
	if len(p) > r.limit {
		return 0, fmt.Errorf("root buffering requested %d bytes, bound %d", len(p), r.limit)
	}
	return r.reader.Read(p)
}
