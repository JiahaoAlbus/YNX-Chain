//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cometbft/cometbft/crypto"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type pqRemoteFailWrite struct {
	net.Conn
	fail atomic.Bool
}

func (c *pqRemoteFailWrite) Write(p []byte) (int, error) {
	if c.fail.Load() {
		_ = c.Conn.Close()
		return 0, io.ErrClosedPipe
	}
	return c.Conn.Write(p)
}

type pqRemoteCountPV struct {
	*PQPrivValidator
	votes     atomic.Int32
	proposals atomic.Int32
}

func (p *pqRemoteCountPV) SignVote(chain string, v *cmtproto.Vote) error {
	p.votes.Add(1)
	return p.PQPrivValidator.SignVote(chain, v)
}
func (p *pqRemoteCountPV) SignProposal(chain string, v *cmtproto.Proposal) error {
	p.proposals.Add(1)
	return p.PQPrivValidator.SignProposal(chain, v)
}

func pqRemotePair(t *testing.T) (*p2pconn.SecretConnection, *p2pconn.SecretConnection, crypto.PubKey, crypto.PubKey, *pqRemoteFailWrite) {
	t.Helper()
	left, right := net.Pipe()
	fault := &pqRemoteFailWrite{Conn: right}
	clientKey, serverKey := cmted.GenPrivKey(), cmted.GenPrivKey()
	type result struct {
		conn *p2pconn.SecretConnection
		err  error
	}
	ch := make(chan result, 1)
	go func() { c, e := p2pconn.MakeSecretConnection(left, clientKey); ch <- result{c, e} }()
	server, err := p2pconn.MakeSecretConnection(fault, serverKey)
	client := <-ch
	if err != nil || client.err != nil {
		t.Fatal(err, client.err)
	}
	t.Cleanup(func() { _ = left.Close(); _ = right.Close() })
	return client.conn, server, clientKey.PubKey(), serverKey.PubKey(), fault
}

func pqRemoteStart(t *testing.T, q *pqPVFixture, owner int, source *PQEngineFileSource, pv cmttypes.PrivValidator) (*privval.ContextSignerClient, *pqRemoteFailWrite) {
	t.Helper()
	clientConn, serverConn, clientPin, serverPin, fault := pqRemotePair(t)
	server, err := privval.NewContextSignerServer(serverConn, clientPin, 5*time.Second, q.f.doc.ChainID, source, pv)
	if err != nil {
		t.Fatal(err)
	}
	original := cmted.PubKey(bytes.Clone(q.f.bootstrap.record.Members[owner].Ed25519))
	client, err := privval.NewContextSignerClient(clientConn, serverPin, 5*time.Second, q.f.doc.ChainID, original, q.app)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if err := server.ServeNext(); err != nil {
				return
			}
		}
	}()
	t.Cleanup(func() {
		_ = client.Close()
		_ = server.Close()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("remote fixture did not stop")
		}
	})
	return client, fault
}

func TestPQRemoteTransitionPreservesOriginalLegacyHRSAndActivatesOnlyPinnedPQ(t *testing.T) {
	q := newPQPVFixture(t, false)
	address := q.f.bootstrap.record.Members[0].Address
	legacyPath := filepath.Join(t.TempDir(), "original-legacy-state.json")
	legacy := privval.NewFilePV(cmted.PrivKey(bytes.Clone(q.f.legacy[string(address)])), filepath.Join(t.TempDir(), "original-legacy-key.json"), legacyPath)
	legacy.Save()
	source, err := NewPQEngineFileSource(q.f.migration, q.path, q.f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	pq, err := NewPQPrivValidator(q.signers[0], source)
	if err != nil {
		t.Fatal(err)
	}
	routed, err := NewPQTransitionPrivValidator(legacy, pq, q.f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := pqRemoteStart(t, q, 0, source, routed)
	snapshot, err := q.app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	set, err := snapshot.expectedMembersAt(q.app.committed.Height + 1)
	if err != nil {
		t.Fatal(err)
	}
	set.IncrementProposerPriority(1)
	pqRemoteBind(t, q, client, set, 0)
	beforePQ, err := os.ReadFile(q.signerPaths[0])
	if err != nil {
		t.Fatal(err)
	}
	vote := pqPVVote(q, set, 0, 0)
	if err = client.SignVote(q.f.doc.ChainID, vote); err != nil {
		t.Fatal(err)
	}
	key, err := client.GetPubKeyForHeight(q.f.doc.ChainID, vote.Height)
	if err != nil || key.Type() != cmted.KeyType || len(vote.Signature) != cmted.SignatureSize || len(vote.ExtensionSignature) != 0 || !key.VerifySignature(cmttypes.VoteSignBytes(q.f.doc.ChainID, vote), vote.Signature) {
		t.Fatal("historical Ed signing changed", err)
	}
	afterPQ, err := os.ReadFile(q.signerPaths[0])
	if err != nil || !bytes.Equal(beforePQ, afterPQ) {
		t.Fatal("preactivation touched PQ HRS", err)
	}
	legacySigned, err := os.ReadFile(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	// The opt-in private ABI retains the original body on ambiguous results.
	// Stock FilePV may restore a prior timestamp at the same H/R/S, but this
	// changed request must not be silently returned as the original request.
	changedTime := clonePQPVVote(vote)
	changedTime.Signature, changedTime.ExtensionSignature = nil, nil
	changedTime.Timestamp = changedTime.Timestamp.Add(time.Nanosecond)
	changedWire, err := changedTime.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	err = client.SignVote(q.f.doc.ChainID, changedTime)
	var legacyUnknown *privval.RemoteConsensusUnknown
	if !errors.As(err, &legacyUnknown) {
		t.Fatal("changed legacy timestamp silently rebound to old request", err)
	}
	changedAfter, _ := changedTime.Marshal()
	legacyRetained, e := os.ReadFile(legacyPath)
	if e != nil || !bytes.Equal(changedWire, changedAfter) || !bytes.Equal(legacySigned, legacyRetained) {
		t.Fatal("legacy ambiguous retry changed original request/HRS", e)
	}
	client, _ = pqRemoteStart(t, q, 0, source, routed)
	q.advance(t, q.schedule.ActivationHeight-1)
	snapshot, err = q.app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	set, err = snapshot.expectedMembersAt(q.app.committed.Height + 1)
	if err != nil {
		t.Fatal(err)
	}
	set.IncrementProposerPriority(1)
	pqRemoteBind(t, q, client, set, 0)
	vote = pqPVVote(q, set, 0, 0)
	if err = client.SignVote(q.f.doc.ChainID, vote); err != nil {
		t.Fatal(err)
	}
	key, err = client.GetPubKeyForHeight(q.f.doc.ChainID, vote.Height)
	if err != nil {
		t.Fatal(err)
	}
	pqKey, ok := key.(ynxpq.PubKey)
	if !ok || !pqKey.VerifyVote(q.f.doc.ChainID, vote) {
		t.Fatal("activation did not use pinned full PQ key")
	}
	legacyAfter, err := os.ReadFile(legacyPath)
	if err != nil || !bytes.Equal(legacySigned, legacyAfter) {
		t.Fatal("PQ activation rewrote original legacy HRS", err)
	}
}
func pqRemoteBind(t *testing.T, q *pqPVFixture, client *privval.ContextSignerClient, set *cmttypes.ValidatorSet, round int32) {
	t.Helper()
	hash, err := hex.DecodeString(q.app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	if err = client.SetConsensusCheckpointSigningContext(q.f.doc.ChainID, q.app.committed.Height, hash, q.app.committed.Height+1, round, set); err != nil {
		t.Fatal(err)
	}
}

func TestPQRemoteActualPinnedConnectionDurableDualObjectsAndFreshCheckpoint(t *testing.T) {
	q := newPQPVFixture(t, true)
	q.advance(t, q.schedule.ActivationHeight-1)
	set, owner := q.context(t, 2)
	source, err := NewPQEngineFileSource(q.f.migration, q.path, q.f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	pv, err := NewPQPrivValidator(q.signers[owner], source)
	if err != nil {
		t.Fatal(err)
	}
	count := &pqRemoteCountPV{PQPrivValidator: pv}
	client, _ := pqRemoteStart(t, q, owner, source, count)
	startup, err := client.GetPubKey()
	if err != nil || startup.Type() != cmted.KeyType {
		t.Fatal("independent original startup identity missing", err)
	}
	pqRemoteBind(t, q, client, set, 2)
	key, err := client.GetPubKeyForHeight(q.f.doc.ChainID, q.app.committed.Height+1)
	if err != nil {
		t.Fatal(err)
	}
	actual, ok := key.(ynxpq.PubKey)
	if !ok {
		t.Fatal("remote activation returned classic key")
	}
	vote := pqPVVote(q, set, owner, 2)
	vote.Extension = bytes.Repeat([]byte{0x5a}, cmttypes.MaxVoteExtensionSize)
	proposal := &cmtproto.Proposal{Type: cmtproto.ProposalType, Height: vote.Height, Round: vote.Round, PolRound: -1, BlockID: copyPQSigningBlock(vote.BlockID), Timestamp: vote.Timestamp}
	if err = client.SignProposal(q.f.doc.ChainID, proposal); err != nil || !actual.VerifyProposal(q.f.doc.ChainID, proposal) {
		t.Fatal("remote durable proposal failed", err)
	}
	if err = client.SignVote(q.f.doc.ChainID, vote); err != nil || !actual.VerifyVote(q.f.doc.ChainID, vote) || !actual.VerifyVoteExtension(q.f.doc.ChainID, vote) {
		t.Fatal("remote durable vote/extension failed", err)
	}
	for _, index := range []int{100, len(vote.Signature) - 1} {
		bad := clonePQPVVote(vote)
		bad.Signature[index] ^= 1
		if actual.VerifyVote(q.f.doc.ChainID, bad) {
			t.Fatal("remote signature accepted damaged AND branch")
		}
	}
	before, err := os.ReadFile(q.signerPaths[owner])
	if err != nil {
		t.Fatal(err)
	}
	badSet := set.Copy()
	badSet.Validators[0].VotingPower++
	hash, _ := hex.DecodeString(q.app.committed.AppHash)
	if err = client.SetConsensusCheckpointSigningContext(q.f.doc.ChainID, q.app.committed.Height, hash, vote.Height, 2, badSet); err == nil {
		t.Fatal("remote peer-supplied power granted authority")
	}
	if _, err = client.GetPubKey(); err == nil {
		t.Fatal("failed context reopened startup classic identity")
	}
	pqRemoteBind(t, q, client, set, 2)
	q.advance(t, q.app.committed.Height+1)
	original := clonePQPVVote(vote)
	original.Signature = nil
	original.ExtensionSignature = nil
	wire, _ := original.Marshal()
	if err = client.SignVote(q.f.doc.ChainID, original); err == nil {
		t.Fatal("historical cache granted current signing authority")
	}
	afterWire, _ := original.Marshal()
	after, err := os.ReadFile(q.signerPaths[owner])
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(wire, afterWire) || !bytes.Equal(before, after) || count.votes.Load() != 1 || count.proposals.Load() != 1 {
		t.Fatal("fresh-checkpoint refusal mutated caller or durable HRS")
	}
}

func TestPQRemoteLostResponsePreservesOriginalUnknownAndExplicitReadback(t *testing.T) {
	q := newPQPVFixture(t, false)
	q.advance(t, q.schedule.ActivationHeight-1)
	set, owner := q.context(t, 0)
	source, err := NewPQEngineFileSource(q.f.migration, q.path, q.f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	pv, err := NewPQPrivValidator(q.signers[owner], source)
	if err != nil {
		t.Fatal(err)
	}
	count := &pqRemoteCountPV{PQPrivValidator: pv}
	client, fault := pqRemoteStart(t, q, owner, source, count)
	pqRemoteBind(t, q, client, set, 0)
	vote := pqPVVote(q, set, owner, 0)
	original, _ := vote.Marshal()
	before, err := os.ReadFile(q.signerPaths[owner])
	if err != nil {
		t.Fatal(err)
	}
	fault.fail.Store(true) // fail the encrypted reply, after durable SignVote
	err = client.SignVote(q.f.doc.ChainID, vote)
	var unknown *privval.RemoteConsensusUnknown
	if !errors.As(err, &unknown) || unknown.RequestHash != sha256.Sum256(unknown.Request) || !bytes.Contains(unknown.Request, original) {
		t.Fatal("lost result did not preserve original UNKNOWN", err)
	}
	after, err := os.ReadFile(q.signerPaths[owner])
	if err != nil {
		t.Fatal(err)
	}
	stillOriginal, _ := vote.Marshal()
	if !bytes.Equal(original, stillOriginal) || bytes.Equal(before, after) || count.votes.Load() != 1 {
		t.Fatal("lost response mutated caller, missed durable signing or automatically retried")
	}
	if err = client.SignVote(q.f.doc.ChainID, vote); err == nil || count.votes.Load() != 1 {
		t.Fatal("ambiguous connection automatically executed again")
	}
	// Explicit recovery uses the exact original body and original durable signer.
	recovered, _ := pqRemoteStart(t, q, owner, source, count)
	pqRemoteBind(t, q, recovered, set, 0)
	if err = recovered.SignVote(q.f.doc.ChainID, vote); err != nil {
		t.Fatal("original durable result could not be read back", err)
	}
	key, err := recovered.GetPubKeyForHeight(q.f.doc.ChainID, vote.Height)
	if err != nil || !key.(ynxpq.PubKey).VerifyVote(q.f.doc.ChainID, vote) {
		t.Fatal("original recovered signature invalid", err)
	}
	readback, err := os.ReadFile(q.signerPaths[owner])
	if err != nil || !bytes.Equal(after, readback) {
		t.Fatal("exact readback changed original HRS", err)
	}
	conflicting := clonePQPVVote(vote)
	conflicting.Signature = nil
	conflicting.ExtensionSignature = nil
	conflicting.BlockID.Hash[0] ^= 1
	conflictWire, _ := conflicting.Marshal()
	if err = recovered.SignVote(q.f.doc.ChainID, conflicting); err == nil {
		t.Fatal("remote signer signed conflicting durable H/R/S")
	}
	conflictAfter, _ := conflicting.Marshal()
	history, err := os.ReadFile(q.signerPaths[owner])
	if err != nil || !bytes.Equal(conflictWire, conflictAfter) || !bytes.Equal(readback, history) {
		t.Fatal("conflict overwrote caller or original durable HRS", err)
	}
}

func TestPQRemoteSecretConnectionRequiresIndependentFullPeerPin(t *testing.T) {
	client, server, clientPin, serverPin, _ := pqRemotePair(t)
	wrong := cmted.GenPrivKey().PubKey()
	original := cmted.GenPrivKey().PubKey().(cmted.PubKey)
	if _, err := privval.NewContextSignerClient(client, wrong, time.Second, "pinned-chain", original, nil); err == nil {
		t.Fatal("wrong peer identity accepted")
	}
	if _, err := privval.NewContextSignerClient(client, nil, time.Second, "pinned-chain", original, nil); err == nil {
		t.Fatal("missing independent pin accepted")
	}
	if _, err := privval.NewContextSignerClient(nil, serverPin, time.Second, "pinned-chain", original, nil); err == nil {
		t.Fatal("unauthenticated transport accepted")
	}
	if _, err := privval.NewContextSignerServer(server, wrong, time.Second, "pinned-chain", nil, nil); err == nil {
		t.Fatal("server accepted wrong engine peer")
	}
	if !bytes.Equal(server.RemotePubKey().Bytes(), clientPin.Bytes()) {
		t.Fatal("fixture did not establish real authenticated transport")
	}
}

// This adversarial, authenticated peer emits the private ABI directly so the
// client's check is independent of ContextSignerServer's own output checks.
// The ordinary and extension signatures originate from the actual durable PQ
// signer; only the required empty-extension signature is removed in transit.
func TestPQRemoteClientRejectsMissingEnabledEmptyExtension(t *testing.T) {
	q := newPQPVFixture(t, true)
	q.advance(t, q.schedule.ActivationHeight-1)
	set, owner := q.context(t, 0)
	vote := pqPVVote(q, set, owner, 0)
	original, err := vote.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	complete := clonePQPVVote(vote)
	if err = q.pvs[owner].SignVote(q.f.doc.ChainID, complete); err != nil {
		t.Fatal(err)
	}
	key, err := q.pvs[owner].GetPubKeyForHeight(q.f.doc.ChainID, vote.Height)
	if err != nil || !key.(ynxpq.PubKey).VerifyVoteExtension(q.f.doc.ChainID, complete) || len(complete.Extension) != 0 {
		t.Fatal("fixture lacks a real required empty-extension signature", err)
	}
	complete.ExtensionSignature = nil
	partial, err := complete.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	clientConn, serverConn, _, serverPin, _ := pqRemotePair(t)
	client, err := privval.NewContextSignerClient(clientConn, serverPin, 5*time.Second, q.f.doc.ChainID, cmted.PubKey(q.f.bootstrap.record.Members[owner].Ed25519), q.app)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	done := make(chan error, 1)
	go func() {
		contextRequest, e := pqRemoteReadTestFrame(serverConn)
		if e != nil {
			done <- e
			return
		}
		fields, e := pqRemoteTestFields(contextRequest)
		if e != nil || len(fields) != 4 {
			done <- fmt.Errorf("context frame: %v", e)
			return
		}
		id := sha256.Sum256(fields[3])
		if e = pqRemoteWriteTestResponse(serverConn, contextRequest, id[:]); e != nil {
			done <- e
			return
		}
		signRequest, e := pqRemoteReadTestFrame(serverConn)
		if e != nil {
			done <- e
			return
		}
		fields, e = pqRemoteTestFields(signRequest)
		if e != nil || len(fields) != 4 {
			done <- fmt.Errorf("sign frame: %v", e)
			return
		}
		object, e := pqRemoteTestFields(fields[3])
		if e != nil || len(object) != 2 || !bytes.Equal(object[1], original) {
			done <- errors.New("peer did not receive exact original object")
			return
		}
		done <- pqRemoteWriteTestResponse(serverConn, signRequest, partial)
	}()
	pqRemoteBind(t, q, client, set, 0)
	err = client.SignVote(q.f.doc.ChainID, vote)
	var unknown *privval.RemoteConsensusUnknown
	if !errors.As(err, &unknown) || unknown.Cause == nil || unknown.Cause.Error() != "expected vote extension signature" {
		t.Fatal("partial empty-extension result accepted or negative missed exact verification", err)
	}
	if e := <-done; e != nil {
		t.Fatal("negative did not reach signed-response verification", e)
	}
	after, err := vote.Marshal()
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("partial response mutated original vote", err)
	}
}

func pqRemoteTestFields(wire []byte) ([][]byte, error) {
	var out [][]byte
	for len(wire) != 0 {
		if len(wire) < 4 {
			return nil, io.ErrUnexpectedEOF
		}
		n := binary.BigEndian.Uint32(wire[:4])
		wire = wire[4:]
		if uint64(n) > uint64(len(wire)) {
			return nil, io.ErrUnexpectedEOF
		}
		out = append(out, wire[:int(n)])
		wire = wire[int(n):]
	}
	return out, nil
}
func pqRemoteReadTestFrame(conn *p2pconn.SecretConnection) ([]byte, error) {
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return nil, err
	}
	var prefix [4]byte
	if _, err := io.ReadFull(conn, prefix[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(prefix[:])
	if n > 2<<20 {
		return nil, errors.New("test private frame exceeds bound")
	}
	wire := make([]byte, int(n))
	_, err := io.ReadFull(conn, wire)
	return wire, err
}
func pqRemoteWriteTestResponse(conn *p2pconn.SecretConnection, request, payload []byte) error {
	hash := sha256.Sum256(request)
	var wire []byte
	for _, field := range [][]byte{[]byte("YNX-REMOTE-CONSENSUS-RESPONSE/v1\x00"), {0, 0, 0, 1}, hash[:], {0, 0, 0, 0}, payload, nil} {
		wire = binary.BigEndian.AppendUint32(wire, uint32(len(field)))
		wire = append(wire, field...)
	}
	frame := binary.BigEndian.AppendUint32(nil, uint32(len(wire)))
	frame = append(frame, wire...)
	if err := conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	n, err := conn.Write(frame)
	if err == nil && n != len(frame) {
		err = io.ErrShortWrite
	}
	return err
}
