package privval

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"math"
	"net"
	"testing"
	"time"

	"github.com/cometbft/cometbft/crypto/ed25519"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
)

func TestYNXRemoteFramingRejectsDeclaredOversizeBeforeBody(t *testing.T) {
	left, right := net.Pipe()
	t.Cleanup(func() { _ = left.Close(); _ = right.Close() })
	leftKey, rightKey := ed25519.GenPrivKey(), ed25519.GenPrivKey()
	type handshake struct {
		conn *p2pconn.SecretConnection
		err  error
	}
	ready := make(chan handshake, 1)
	go func() { c, err := p2pconn.MakeSecretConnection(left, leftKey); ready <- handshake{c, err} }()
	server, err := p2pconn.MakeSecretConnection(right, rightKey)
	client := <-ready
	if err != nil || client.err != nil {
		t.Fatal(err, client.err)
	}
	reader, err := pinnedContextConnection(server, leftKey.PubKey(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := pinnedContextConnection(client.conn, rightKey.PubKey(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err = writer.write(make([]byte, maxRemoteSignerMsgSize+1)); err == nil {
		t.Fatal("oversized private frame entered connection")
	}
	written := make(chan error, 1)
	go func() { _, e := client.conn.Write(binary.BigEndian.AppendUint32(nil, math.MaxUint32)); written <- e }()
	if _, err = reader.read(); err == nil {
		t.Fatal("declared oversize was accepted without a body")
	}
	if err = <-written; err != nil {
		t.Fatal(err)
	}
}

func TestYNXRemoteContextCanonicalCoordinatesAndProposerPriority(t *testing.T) {
	set := types.NewValidatorSet([]*types.Validator{types.NewValidator(ed25519.GenPrivKey().PubKey(), 10), types.NewValidator(ed25519.GenPrivKey().PubKey(), 20)})
	set.IncrementProposerPriority(4)
	ctx, err := encodeRemoteContext("independently-pinned-chain", 8, bytes.Repeat([]byte{3}, 32), 9, 3, set)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeRemoteContext(ctx.wire)
	if err != nil || decoded.id != ctx.id || !bytes.Equal(decoded.set.Hash(), set.Hash()) || decoded.set.Proposer.ProposerPriority != set.Proposer.ProposerPriority {
		t.Fatal("actual context did not roundtrip", err)
	}
	for i, member := range set.Validators {
		if decoded.set.Validators[i].ProposerPriority != member.ProposerPriority {
			t.Fatal("priority changed in transport")
		}
	}
	changed := set.Copy()
	changed.IncrementProposerPriority(1)
	other, err := encodeRemoteContext(ctx.chain, ctx.committed, ctx.appHash, ctx.height, ctx.round, changed)
	if err != nil || other.id == ctx.id {
		t.Fatal("context ID omitted actual priorities/proposer", err)
	}
	fields, err := readContextFields(ctx.wire, 8, maxContextBytes)
	if err != nil {
		t.Fatal(err)
	}
	cases := [][]byte{append(bytes.Clone(ctx.wire), 0), ctx.wire[:len(ctx.wire)-1], contextFields(fields[0], contextU32(2), fields[2], fields[3], fields[4], fields[5], fields[6], fields[7]), contextFields(fields[0], fields[1], fields[2], fields[3], fields[4], contextU64(math.MaxUint64), fields[6], fields[7]), contextFields(fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], contextU32(math.MaxUint32), fields[7])}
	// Unknown protobuf fields must not be silently erased before context hashing.
	protoUnknown := append(bytes.Clone(fields[7]), 0x98, 0x06, 0x01)
	cases = append(cases, contextFields(fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], fields[6], protoUnknown))
	for _, wire := range cases {
		if _, err = decodeRemoteContext(wire); err == nil {
			t.Fatal("noncanonical context accepted")
		}
	}
	if _, err = encodeRemoteContext(ctx.chain, 8, ctx.appHash, 10, 3, set); err == nil {
		t.Fatal("non-next height accepted")
	}
	if _, err = encodeRemoteContext(ctx.chain, 8, make([]byte, 32), 9, 3, set); err == nil {
		t.Fatal("zero AppHash accepted")
	}
	detached, err := detachedContextSet(set)
	if err != nil {
		t.Fatal(err)
	}
	set.Validators[0].Address[0] ^= 1
	set.Validators[0].ProposerPriority++
	if !bytes.Equal(detached.Hash(), decoded.set.Hash()) || detached.Validators[0].ProposerPriority != decoded.set.Validators[0].ProposerPriority {
		t.Fatal("captured signing set aliases caller")
	}
}

func TestYNXRemoteResponseBindsOriginalRequestAndUnknownIdentity(t *testing.T) {
	request := encodeContextRequest(contextVote, contextFields(bytes.Repeat([]byte{1}, 32), []byte("exact original vote")))
	response := encodeContextResponse(request, []byte("signed bytes"), 0, "")
	body, code, err := decodeContextResponse(request, response)
	if err != nil || code != 0 || string(body) != "signed bytes" {
		t.Fatal(err)
	}
	changed := bytes.Clone(request)
	changed[len(changed)-1] ^= 1
	if _, _, err = decodeContextResponse(changed, response); err == nil {
		t.Fatal("response rebound to another request")
	}
	if _, code, err = decodeContextResponse(request, encodeContextResponse(request, nil, contextUnknown, "durability uncertain")); err == nil || code != contextUnknown {
		t.Fatal("UNKNOWN projected as success")
	}
	unknown := &RemoteConsensusUnknown{Request: bytes.Clone(request), RequestHash: sha256.Sum256(request)}
	request[len(request)-1] ^= 1
	if unknown.RequestHash != sha256.Sum256(unknown.Request) {
		t.Fatal("UNKNOWN aliases original mutable input")
	}
}

func TestYNXRemoteUnsignedObjectCanonicalFraming(t *testing.T) {
	vote := &cmtproto.Vote{Type: cmtproto.PrevoteType, Height: 9, Round: 2, ValidatorAddress: bytes.Repeat([]byte{4}, 20), ValidatorIndex: 0}
	wire, err := vote.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = canonicalUnsignedVote(wire); err != nil {
		t.Fatal(err)
	}
	if _, err = canonicalUnsignedVote(append(bytes.Clone(wire), 0xf8, 0x07, 0x01)); err == nil {
		t.Fatal("unknown protobuf fields accepted")
	}
	vote.Signature = []byte{1}
	wire, err = vote.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = canonicalUnsignedVote(wire); err == nil {
		t.Fatal("signed object accepted as fresh original request")
	}
	vote.Signature = nil
	vote.ValidatorIndex = -1
	wire, _ = vote.Marshal()
	if _, err = canonicalUnsignedVote(wire); err == nil {
		t.Fatal("negative validator index accepted")
	}
}
