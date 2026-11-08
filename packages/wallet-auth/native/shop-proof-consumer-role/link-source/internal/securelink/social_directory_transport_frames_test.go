package securelink

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"testing"
)

// All fixtures are local literal transport bytes. These tests neither read the
// frozen SDK JSON nor construct a Host/Root/Source/Principal or service channel.
func socialDirectoryFrameTestHashes() (request, response [32]byte) {
	for i := range request {
		request[i], response[i] = byte(i), byte(0x80+i)
	}
	return request, response
}

// This fixture is deliberately independent from the production W encoder. R2
// A81 layout: A + BE32(76) + BE32(0) + v1 + hashes + flags + kind + BEi32.
func socialDirectoryFrameTestAck(request, response [32]byte, closed, present, kind byte, code int32) []byte {
	frame := append([]byte{'A', 0, 0, 0, 76, 0, 0, 0, 0, 1}, request[:]...)
	frame = append(frame, response[:]...)
	frame = append(frame, closed, present, kind)
	bits := uint32(code)
	return append(frame, byte(bits>>24), byte(bits>>16), byte(bits>>8), byte(bits))
}

func requireSocialDirectoryFrameTestRejected(t *testing.T, frame []byte, request, response [32]byte) {
	t.Helper()
	before := bytes.Clone(frame)
	ack, err := decodeSocialDirectoryClosedAck(frame, request, response)
	if err == nil || ack != (socialDirectoryAck{}) {
		t.Fatalf("invalid closure frame returned an observation: ack=%+v err=%v", ack, err)
	}
	if !bytes.Equal(frame, before) {
		t.Fatal("decoder changed retained frame bytes")
	}
}

func TestSocialDirectoryTransportFramesReadReleaseR2Golden(t *testing.T) {
	request, response := socialDirectoryFrameTestHashes()
	frame := encodeSocialDirectoryReadRelease(request, response)
	want, err := hex.DecodeString("57000000450000000001" +
		"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
		"808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")
	if err != nil {
		t.Fatal(err)
	}
	if len(frame) != 74 || !bytes.Equal(frame[:], want) {
		t.Fatalf("W74 differs from fixed R2 golden: %x", frame)
	}
	if frame[0] != 'W' || binary.BigEndian.Uint32(frame[1:5]) != 69 || binary.BigEndian.Uint32(frame[5:9]) != 0 || frame[9] != 1 {
		t.Fatal("W framing differs from exact tag/payload/meta/version contract")
	}
	before := frame
	request[0], response[0] = 0xff, 0xff
	if frame != before {
		t.Fatal("encoded W retained an alias of input hashes")
	}
	frame[10] ^= 0xff
	if again := encodeSocialDirectoryReadRelease(socialDirectoryFrameTestHashes()); again != before {
		t.Fatal("encoded W reused an earlier caller-owned output")
	}
}

func TestSocialDirectoryTransportFramesClosedAckR2GoldenSignedCode(t *testing.T) {
	request, response := socialDirectoryFrameTestHashes()
	golden, err := hex.DecodeString("410000004c0000000001" +
		"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
		"808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f" +
		"01010180000000")
	if err != nil {
		t.Fatal(err)
	}
	before := bytes.Clone(golden)
	ack, err := decodeSocialDirectoryClosedAck(golden, request, response)
	if err != nil || ack != (socialDirectoryAck{Closed: true, ErrorPresent: true, ErrorKind: 1, ErrorCode: math.MinInt32}) {
		t.Fatalf("A81 lost physical closure or signed code: ack=%+v err=%v", ack, err)
	}
	if !bytes.Equal(golden, before) {
		t.Fatal("decoder changed retained A81 bytes")
	}
	golden[74], golden[75], golden[76], golden[77] = 0, 0, 0, 0
	if !ack.Closed || !ack.ErrorPresent || ack.ErrorKind != 1 || ack.ErrorCode != math.MinInt32 {
		t.Fatal("decoded observation aliases mutable frame bytes")
	}
}

func TestSocialDirectoryTransportFramesClosedAndErrorIndependentR2(t *testing.T) {
	request, response := socialDirectoryFrameTestHashes()
	for closed := byte(0); closed <= 1; closed++ {
		for present := byte(0); present <= 1; present++ {
			for kind := byte(0); kind <= 2; kind++ {
				for _, code := range []int32{math.MinInt32, -1, 0, 1, math.MaxInt32} {
					t.Run(fmt.Sprintf("closed%d/present%d/kind%d/code%d", closed, present, kind, code), func(t *testing.T) {
						frame := socialDirectoryFrameTestAck(request, response, closed, present, kind, code)
						valid := present == 0 && kind == 0 && code == 0 || present == 1 && (kind == 1 || kind == 2 && code == 0)
						if !valid {
							requireSocialDirectoryFrameTestRejected(t, frame, request, response)
							return
						}
						ack, err := decodeSocialDirectoryClosedAck(frame, request, response)
						want := socialDirectoryAck{Closed: closed == 1, ErrorPresent: present == 1, ErrorKind: kind, ErrorCode: code}
						if err != nil || ack != want {
							t.Fatalf("valid physical/error observation changed: ack=%+v want=%+v err=%v", ack, want, err)
						}
					})
				}
			}
		}
	}
}

func TestSocialDirectoryTransportFramesRejectOldShortTrailingAndWrongTypeR2(t *testing.T) {
	request, response := socialDirectoryFrameTestHashes()
	valid := socialDirectoryFrameTestAck(request, response, 1, 0, 0, 0)
	for length := 0; length < 81; length++ {
		t.Run(fmt.Sprintf("length%d", length), func(t *testing.T) {
			requireSocialDirectoryFrameTestRejected(t, valid[:length], request, response)
		})
	}
	// Old A80 omitted errorKind and is rejected regardless of its old payload
	// declaration; it cannot silently turn numeric zero into absent failure.
	oldA80 := append(bytes.Clone(valid[:76]), valid[77:81]...)
	binary.BigEndian.PutUint32(oldA80[1:5], 75)
	requireSocialDirectoryFrameTestRejected(t, oldA80, request, response)
	for _, frame := range [][]byte{
		append(bytes.Clone(valid), 0),
		append(bytes.Clone(valid), valid...),
		append([]byte{0}, valid...),
	} {
		requireSocialDirectoryFrameTestRejected(t, frame, request, response)
	}
	w := encodeSocialDirectoryReadRelease(request, response)
	requireSocialDirectoryFrameTestRejected(t, w[:], request, response)
	for _, tag := range []byte{0, 'W', 'L', 'C', 'a', 0xff} {
		frame := bytes.Clone(valid)
		frame[0] = tag
		requireSocialDirectoryFrameTestRejected(t, frame, request, response)
	}
}

func TestSocialDirectoryTransportFramesRejectHeaderAndVersionR2(t *testing.T) {
	request, response := socialDirectoryFrameTestHashes()
	valid := socialDirectoryFrameTestAck(request, response, 1, 0, 0, 0)
	for _, length := range []uint32{0, 4, 72, 75, 77, 81, math.MaxUint32} {
		frame := bytes.Clone(valid)
		binary.BigEndian.PutUint32(frame[1:5], length)
		requireSocialDirectoryFrameTestRejected(t, frame, request, response)
	}
	for _, metadata := range []uint32{1, 4, 72, 76, math.MaxUint32} {
		frame := bytes.Clone(valid)
		binary.BigEndian.PutUint32(frame[5:9], metadata)
		requireSocialDirectoryFrameTestRejected(t, frame, request, response)
	}
	for version := 0; version <= math.MaxUint8; version++ {
		if version == 1 {
			continue
		}
		frame := bytes.Clone(valid)
		frame[9] = byte(version)
		requireSocialDirectoryFrameTestRejected(t, frame, request, response)
	}
}

func TestSocialDirectoryTransportFramesRejectForeignOriginalHashesR2(t *testing.T) {
	request, response := socialDirectoryFrameTestHashes()
	valid := socialDirectoryFrameTestAck(request, response, 1, 0, 0, 0)
	for i := 10; i < 74; i++ {
		frame := bytes.Clone(valid)
		frame[i] ^= 1
		requireSocialDirectoryFrameTestRejected(t, frame, request, response)
	}
	requireSocialDirectoryFrameTestRejected(t, valid, response, request)
	foreign := request
	foreign[31] ^= 1
	requireSocialDirectoryFrameTestRejected(t, valid, foreign, response)
	foreign = response
	foreign[31] ^= 1
	requireSocialDirectoryFrameTestRejected(t, valid, request, foreign)
}

func TestSocialDirectoryTransportFramesRejectAllInvalidFlagAndKindValuesR2(t *testing.T) {
	request, response := socialDirectoryFrameTestHashes()
	valid := socialDirectoryFrameTestAck(request, response, 1, 1, 1, 0)
	for _, offset := range []int{74, 75} {
		for value := 2; value <= math.MaxUint8; value++ {
			frame := bytes.Clone(valid)
			frame[offset] = byte(value)
			requireSocialDirectoryFrameTestRejected(t, frame, request, response)
		}
	}
	for value := 3; value <= math.MaxUint8; value++ {
		frame := bytes.Clone(valid)
		frame[76] = byte(value)
		requireSocialDirectoryFrameTestRejected(t, frame, request, response)
	}
}

func TestSocialDirectoryTransportFramesHashBytesAreBindingMetadataOnlyR2(t *testing.T) {
	// The contract does not give a digest a validity bit or ban particular byte
	// values. The caller establishes SAME outstanding channel/request separately.
	// This codec must therefore bind exactly, not invent a nonzero-hash grant.
	for _, fill := range []byte{0, 0xff} {
		var request, response [32]byte
		for i := range request {
			request[i], response[i] = fill, fill
		}
		frame := socialDirectoryFrameTestAck(request, response, 0, 1, 2, 0)
		ack, err := decodeSocialDirectoryClosedAck(frame, request, response)
		if err != nil || ack.Closed || !ack.ErrorPresent || ack.ErrorKind != 2 || ack.ErrorCode != 0 {
			t.Fatalf("codec altered exact metadata or fabricated closure: ack=%+v err=%v", ack, err)
		}
	}
}
