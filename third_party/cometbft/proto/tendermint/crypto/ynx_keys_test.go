package crypto

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

func TestYNXFullKeyOneofWireDescriptorAndReflection(t *testing.T) {
	key := &PublicKey{Sum: &PublicKey_YnxDualPq{YnxDualPq: []byte{1, 2, 3}}}
	wire, err := key.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(wire, []byte{0x1a, 3, 1, 2, 3}) || key.Size() != 5 {
		t.Fatalf("unexpected oneof wire %x", wire)
	}
	// gogo Buffer.SetDeterministic rejects every generated Marshaler before
	// dispatch. Exercise the supported generated deterministic entry directly,
	// then independently check the normal proto and sized-buffer entry points.
	for i := 0; i < 3; i++ {
		deterministic, err := key.XXX_Marshal(nil, true)
		if err != nil || !bytes.Equal(deterministic, wire) {
			t.Fatalf("generated deterministic marshal differs: %x, %v", deterministic, err)
		}
	}
	encoded, err := proto.Marshal(key)
	if err != nil || !bytes.Equal(encoded, wire) {
		t.Fatalf("normal proto marshal differs: %x, %v", encoded, err)
	}
	sized := make([]byte, key.Size())
	n, err := key.MarshalToSizedBuffer(sized)
	if err != nil || n != len(wire) || !bytes.Equal(sized, wire) {
		t.Fatalf("sized buffer marshal differs: %x, %v", sized, err)
	}
	for _, malformed := range [][]byte{{0x1a, 3, 1, 2}, {0x18, 1}, {0x1a, 0xff}} {
		var invalid PublicKey
		if err := proto.Unmarshal(malformed, &invalid); err == nil {
			t.Fatalf("malformed new oneof wire accepted: %x", malformed)
		}
	}
	var decoded PublicKey
	if err = proto.Unmarshal(wire, &decoded); err != nil {
		t.Fatal(err)
	}
	if !key.Equal(&decoded) || key.Compare(&decoded) != 0 || !bytes.Equal(decoded.GetYnxDualPq(), []byte{1, 2, 3}) {
		t.Fatal("oneof equality/compare/getter mismatch")
	}
	marshaler := jsonpb.Marshaler{}
	j, err := marshaler.MarshalToString(key)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(j, "ynxDualPq") {
		t.Fatalf("reflection JSON lost new key: %s", j)
	}
	if err = jsonpb.UnmarshalString(j, &decoded); err != nil || !decoded.Equal(key) {
		t.Fatalf("reflection JSON mismatch: %v", err)
	}

	compressed, _ := key.Descriptor()
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if err = reader.Close(); err != nil {
		t.Fatal(err)
	}
	var desc descriptor.FileDescriptorProto
	if err = proto.Unmarshal(raw, &desc); err != nil {
		t.Fatal(err)
	}
	fields := desc.GetMessageType()[0].GetField()
	if len(fields) != 3 || fields[2].GetNumber() != 3 || fields[2].GetName() != "ynx_dual_pq" || fields[2].GetJsonName() != "ynxDualPq" || fields[2].GetType() != descriptor.FieldDescriptorProto_TYPE_BYTES || fields[2].GetOneofIndex() != 0 {
		t.Fatal("registered file descriptor missing full key schema")
	}
	for _, legacy := range []*PublicKey{{Sum: &PublicKey_Ed25519{Ed25519: []byte{1}}}, {Sum: &PublicKey_Secp256K1{Secp256K1: []byte{1}}}} {
		encoded, err := legacy.Marshal()
		if err != nil {
			t.Fatal(err)
		}
		want := byte(0x0a)
		if legacy.GetSecp256K1() != nil {
			want = 0x12
		}
		if !bytes.Equal(encoded, []byte{want, 1, 1}) {
			t.Fatal("legacy protobuf bytes changed")
		}
	}
}
