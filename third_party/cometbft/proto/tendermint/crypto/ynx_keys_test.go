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
	buffer := proto.NewBuffer(nil)
	buffer.SetDeterministic(true)
	if err = buffer.Marshal(key); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buffer.Bytes(), wire) {
		t.Fatal("deterministic reflection differs from generated marshal")
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
