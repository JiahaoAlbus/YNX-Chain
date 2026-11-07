package privval

import (
	"bytes"
	"encoding/binary"
	"net"
	"testing"
	"time"

	"github.com/cometbft/cometbft/crypto/ynxpq"
	"github.com/cometbft/cometbft/libs/log"
	privproto "github.com/cometbft/cometbft/proto/tendermint/privval"
	"github.com/cometbft/cometbft/types"
	"github.com/cosmos/gogoproto/proto"
)

func ynxTransportEndpoint(conn net.Conn) *signerEndpoint {
	se := &signerEndpoint{conn: conn, timeoutReadWrite: time.Second}
	se.Logger = log.NewNopLogger()
	return se
}

// These are opaque full-sized transport payloads, not cryptographic success
// fixtures. The real object/signature authorizers remain responsible for them.
func TestYNXRemoteSignerTransportFullSizeAndOriginalLegacyMessages(t *testing.T) {
	vote := exampleVote().ToProto()
	vote.Signature = bytes.Repeat([]byte{0xa1}, ynxpq.EnvelopeSize)
	vote.ExtensionSignature = bytes.Repeat([]byte{0xb2}, ynxpq.EnvelopeSize)
	vote.Extension = bytes.Repeat([]byte{0xc3}, types.MaxVoteExtensionSize)
	proposal := exampleProposal().ToProto()
	proposal.Signature = bytes.Repeat([]byte{0xd4}, ynxpq.EnvelopeSize)
	for _, msg := range []privproto.Message{
		mustWrapMsg(&privproto.PingRequest{}),
		mustWrapMsg(&privproto.SignedVoteResponse{Vote: *vote}),
		mustWrapMsg(&privproto.SignedProposalResponse{Proposal: *proposal}),
	} {
		left, right := net.Pipe()
		sender, receiver := ynxTransportEndpoint(left), ynxTransportEndpoint(right)
		done := make(chan error, 1)
		go func() { done <- sender.WriteMessage(msg) }()
		got, err := receiver.ReadMessage()
		left.Close()
		right.Close()
		writeErr := <-done
		if err != nil || writeErr != nil || !proto.Equal(&got, &msg) {
			t.Fatalf("bounded remote payload changed or rejected: read=%v write=%v", err, writeErr)
		}
	}
}

func TestYNXRemoteSignerTransportRejectsOversizedPrefixAndWrite(t *testing.T) {
	left, right := net.Pipe()
	defer left.Close()
	defer right.Close()
	receiver := ynxTransportEndpoint(left)
	done := make(chan error, 1)
	go func() {
		var prefix [binary.MaxVarintLen64]byte
		n := binary.PutUvarint(prefix[:], uint64(maxRemoteSignerMsgSize+1))
		_, err := right.Write(prefix[:n])
		done <- err
	}()
	got, err := receiver.ReadMessage()
	if err == nil || got.Sum != nil {
		t.Fatal("oversized declared payload accepted or partially published")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	vote := exampleVote().ToProto()
	vote.Extension = make([]byte, maxRemoteSignerMsgSize+1)
	msg := mustWrapMsg(&privproto.SignedVoteResponse{Vote: *vote})
	if err := receiver.WriteMessage(msg); err == nil {
		t.Fatal("oversized write entered the transport")
	}
}
