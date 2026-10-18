package types

import (
	"bytes"
	"compress/gzip"
	"io"
	"strings"
	"testing"

	"github.com/cosmos/gogoproto/jsonpb"
	"github.com/cosmos/gogoproto/proto"
	"github.com/cosmos/gogoproto/protoc-gen-gogo/descriptor"
)

func TestYNXProfileWireDescriptorJSONAndLegacyOmission(t *testing.T) {
	p := &ConsensusParams{YnxProfile: []byte{1, 2, 3}}
	want := []byte{0x32, 3, 1, 2, 3}
	wire, err := proto.Marshal(p)
	if err != nil || !bytes.Equal(wire, want) || p.Size() != len(want) {
		t.Fatalf("field 6 encoding differs: %x %v", wire, err)
	}
	deterministic, err := p.XXX_Marshal(nil, true)
	if err != nil || !bytes.Equal(deterministic, want) {
		t.Fatal("generated deterministic path differs", err)
	}
	var decoded ConsensusParams
	if err := proto.Unmarshal(wire, &decoded); err != nil || !decoded.Equal(p) || !bytes.Equal(decoded.GetYnxProfile(), p.YnxProfile) {
		t.Fatal("profile transport lost bytes:", err)
	}
	decoded.YnxProfile[0] ^= 1
	if decoded.Equal(p) {
		t.Fatal("generated equality omitted profile")
	}
	marshaler := jsonpb.Marshaler{}
	j, err := marshaler.MarshalToString(p)
	if err != nil || !strings.Contains(j, "ynxProfile") {
		t.Fatal("reflection omitted profile", err)
	}
	if err := jsonpb.UnmarshalString(j, &decoded); err != nil || !decoded.Equal(p) {
		t.Fatal("profile JSON roundtrip failed", err)
	}
	for _, bad := range [][]byte{{0x30, 1}, {0x32, 3, 1, 2}, {0x32, 0xff}} {
		var invalid ConsensusParams
		if err := proto.Unmarshal(bad, &invalid); err == nil {
			t.Fatal("malformed profile protobuf admitted")
		}
	}
	legacy := &ConsensusParams{Block: &BlockParams{MaxBytes: 1}}
	legacyWire, err := legacy.Marshal()
	if err != nil || !bytes.Equal(legacyWire, []byte{0x0a, 2, 0x08, 1}) {
		t.Fatal("nil-profile legacy proto bytes changed", err)
	}
	compressed, _ := p.Descriptor()
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	var d descriptor.FileDescriptorProto
	if err := proto.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	fields := d.GetMessageType()[0].GetField()
	if len(fields) != 6 || fields[5].GetNumber() != 6 || fields[5].GetName() != "ynx_profile" || fields[5].GetJsonName() != "ynxProfile" || fields[5].GetType() != descriptor.FieldDescriptorProto_TYPE_BYTES {
		t.Fatal("registered descriptor differs from actual profile schema")
	}
}
