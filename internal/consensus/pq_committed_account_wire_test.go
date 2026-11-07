//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func accountWireRequest(op uint32, seq uint64, token [32]byte) []byte {
	b := make([]byte, pqAccountWireHeader)
	copy(b, pqAccountWireTag)
	binary.BigEndian.PutUint32(b[33:37], 1)
	binary.BigEndian.PutUint32(b[37:41], op)
	binary.BigEndian.PutUint64(b[45:53], seq)
	copy(b[53:85], token[:])
	return b
}
func accountWireResponse(t *testing.T, c *net.UnixConn) (pqAccountWireFrame, []byte) {
	t.Helper()
	var h [97]byte
	if _, e := io.ReadFull(c, h[:]); e != nil {
		t.Fatal("account response header", e)
	}
	if string(h[:33]) != pqAccountWireTag || binary.BigEndian.Uint32(h[33:37]) != 1 {
		t.Fatal("account header changed")
	}
	f := pqAccountWireFrame{op: binary.BigEndian.Uint32(h[37:41]), status: binary.BigEndian.Uint32(h[41:45]), sequence: binary.BigEndian.Uint64(h[45:53]), failure: binary.BigEndian.Uint32(h[85:89]) == 1, code: int32(binary.BigEndian.Uint32(h[89:93]))}
	copy(f.reader[:], h[53:85])
	if binary.BigEndian.Uint32(h[85:89]) > 1 {
		t.Fatal("malformed paired failure")
	}
	n := binary.BigEndian.Uint32(h[93:97])
	if n > pqAccountWirePayloadMax {
		t.Fatal("unbounded response")
	}
	f.payload = make([]byte, n)
	if _, e := io.ReadFull(c, f.payload); e != nil {
		t.Fatal("account response payload", e)
	}
	if _, e := f.header(); e != nil {
		t.Fatal("invalid response shape", e)
	}
	return f, append(h[:], f.payload...)
}
func accountWireExchange(t *testing.T, c *net.UnixConn, op uint32, seq uint64, token [32]byte) (pqAccountWireFrame, []byte) {
	t.Helper()
	if e := writePQAccountWire(c, accountWireRequest(op, seq, token)); e != nil {
		t.Fatal(e)
	}
	f, b := accountWireResponse(t, c)
	if f.op != op || f.sequence != seq {
		t.Fatal("response sequence changed")
	}
	return f, b
}
func accountWireHandler(t *testing.T, w *pqCommittedAccountWire) *PQCommittedAccountHandler {
	t.Helper()
	w.mu.Lock()
	h := w.handler
	w.mu.Unlock()
	if h == nil {
		t.Fatal("actual account handler was not published")
	}
	return h
}
func accountWireWait(t *testing.T, w *pqCommittedAccountWire) {
	t.Helper()
	select {
	case <-w.done:
	case <-time.After(3 * time.Second):
		t.Fatal("account worker debt did not drain")
	}
}
func accountWireAttach(t *testing.T, f *committedTraceObserver, owner string, ctx context.Context) (*pqCommittedAccountWire, *net.UnixConn) {
	t.Helper()
	fd, c := current4Socketpair(t) // creates a NEW socketpair, never resource channel reuse
	w, e := attachPQCommittedAccountWire(ctx, f.app, owner, fd, pqAccountWirePeer{uid: uint32(os.Getuid()), pid: int32(os.Getpid())})
	if w != nil {
		t.Cleanup(func() { _ = w.closeWalletPolicyAccountProofChild() })
	}
	if e != nil {
		t.Fatal("test-only original App attach", e)
	}
	return w, c
}
func accountWireSDK(t *testing.T, raw []byte, want string) {
	t.Helper()
	driver := os.Getenv("YNX_ACCOUNT_PROOF_SDK_DATA_DRIVER")
	if !filepath.IsAbs(driver) {
		t.Fatal("mandatory sole SDK DATA driver missing")
	}
	p := filepath.Join(t.TempDir(), "PUBLIC-frame.bin")
	if e := os.WriteFile(p, raw, 0600); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, e := exec.CommandContext(ctx, driver, p).CombinedOutput()
	if e != nil || strings.TrimSpace(string(out)) != want {
		t.Fatal("sole SDK DATA exact roundtrip/fields differ", e, string(out))
	}
}

func TestPQCommittedAccountWirePUBLICStrictDATA(t *testing.T) {
	good := accountWireRequest(pqAccountWireOpen, 1, [32]byte{})
	if len(good) != 97 || len(pqAccountWireTag) != 33 || pqAccountWirePayloadMax != 37814272 {
		t.Fatal("SDK contract constants drifted")
	}
	if _, e := readPQAccountWireRequest(bytes.NewReader(good)); e != nil {
		t.Fatal(e)
	}
	cases := map[string]func([]byte){
		"tag": func(b []byte) { b[0] ^= 1 }, "version": func(b []byte) { b[36] = 2 }, "unknown_op": func(b []byte) { b[40] = 7 }, "response_request": func(b []byte) { b[44] = 1 }, "zero_seq": func(b []byte) { b[52] = 0 }, "seq_exhausted": func(b []byte) { binary.BigEndian.PutUint64(b[45:53], math.MaxUint64) }, "open_token": func(b []byte) { b[53] = 1 }, "read_zero_token": func(b []byte) { b[40] = 2 }, "failure_code0_present": func(b []byte) { b[88] = 1 }, "failure_invalid_presence": func(b []byte) { b[88] = 2 }, "absent_nonzero_code": func(b []byte) { b[92] = 1 }, "nonempty_request": func(b []byte) { b[96] = 1 }, "max_request": func(b []byte) { binary.BigEndian.PutUint32(b[93:97], pqAccountWirePayloadMax) }, "oversize": func(b []byte) { binary.BigEndian.PutUint32(b[93:97], math.MaxUint32) },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			b := append([]byte(nil), good...)
			change(b)
			if _, e := readPQAccountWireRequest(bytes.NewReader(b)); e == nil {
				t.Fatal("invalid request admitted")
			}
		})
	}
	t.Run("truncated", func(t *testing.T) {
		if _, e := readPQAccountWireRequest(bytes.NewReader(good[:96])); e == nil {
			t.Fatal("short header")
		}
	})
	t.Run("ViewBoundsAndIndependentFields", func(t *testing.T) {
		owner := "0x1111111111111111111111111111111111111111"
		valid := PQCommittedAccountProofView{Proof: PQWalletPolicyCheckpoint{ChainID: "public-data", Height: 10}, CurrentCheckpoint: PQWalletPolicyCheckpoint{ChainID: "public-data", Height: 11}, HistoricalAccount: PQWalletPolicyAtCheckpointView{Owner: owner, NativeChainID: 1, CommittedHeight: 10, ExecutionHeight: 11, LedgerNonce: 3, PolicyOriginal: []byte("original"), CommittedAuthorizationStatus: "classic", AuthorizationStatus: "classic"}, CurrentAccount: PQWalletPolicyAtCheckpointView{Owner: owner, NativeChainID: 1, CommittedHeight: 11, ExecutionHeight: 12, LedgerNonce: 4, PolicyOriginal: []byte("original"), CommittedAuthorizationStatus: "classic", AuthorizationStatus: "classic"}, BlockOriginal: []byte("public-data-only"), SuccessorOriginal: []byte("public-data-only-successor")}
		if _, e := encodePQAccountWireView(valid); e != nil {
			t.Fatal("DATA shape positive", e)
		}
		mutations := map[string]func(*PQCommittedAccountProofView){
			"owner": func(v *PQCommittedAccountProofView) {
				v.CurrentAccount.Owner = "0x2222222222222222222222222222222222222222"
			},
			"network":                func(v *PQCommittedAccountProofView) { v.CurrentAccount.NetworkID[0] = 1 },
			"chain":                  func(v *PQCommittedAccountProofView) { v.CurrentCheckpoint.ChainID = "different" },
			"height":                 func(v *PQCommittedAccountProofView) { v.CurrentCheckpoint.Height = 10 },
			"execution":              func(v *PQCommittedAccountProofView) { v.HistoricalAccount.ExecutionHeight = 10 },
			"ascii":                  func(v *PQCommittedAccountProofView) { v.HistoricalAccount.AuthorizationStatus = "x\x00y" },
			"policy_empty":           func(v *PQCommittedAccountProofView) { v.CurrentAccount.PolicyOriginal = nil },
			"policy_bound":           func(v *PQCommittedAccountProofView) { v.CurrentAccount.PolicyOriginal = make([]byte, (8<<20)+1) },
			"block_bound":            func(v *PQCommittedAccountProofView) { v.SuccessorOriginal = make([]byte, (10<<20)+1) },
			"signed_height_overflow": func(v *PQCommittedAccountProofView) { v.CurrentCheckpoint.Height = math.MaxInt64 },
		}
		for name, mutate := range mutations {
			t.Run(name, func(t *testing.T) {
				v := valid
				mutate(&v)
				if b, e := encodePQAccountWireView(v); b != nil || e == nil {
					t.Fatal("invalid DATA emitted")
				}
			})
		}
	})
	token := [32]byte{1}
	for _, f := range []pqAccountWireFrame{{op: 1, status: 2, sequence: 1, reader: token, failure: true}, {op: 2, status: 2, sequence: 2, reader: token}, {op: 2, status: 3, sequence: 2, reader: token}, {op: 2, status: 4, sequence: 2, reader: token}, {op: 4, status: 1, sequence: 2, reader: token, code: 1}} {
		if _, e := f.header(); e == nil {
			t.Fatal("malformed response accepted")
		}
	}
	if _, e := (pqAccountWireFrame{op: 2, status: 2, sequence: 2, reader: token, failure: true, code: 0}).header(); e != nil {
		t.Fatal("paired NotReady code0 lost")
	}
	if _, e := (pqAccountWireFrame{op: 6, status: 4, sequence: 2, reader: token, failure: true, code: 0}).header(); e != nil {
		t.Fatal("failure conflated with physical close")
	}
}

func TestPQCommittedAccountWirePUBLICContinuousProof(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	node := f.node
	w, c := accountWireAttach(t, f, f.expected.Owner, context.Background())
	opened, _ := accountWireExchange(t, c, 1, 1, [32]byte{})
	token := opened.reader
	if opened.status != 1 || opened.failure || token == [32]byte{} || len(opened.payload) != 0 {
		t.Fatal("OPEN capture contract")
	}
	nr, _ := accountWireExchange(t, c, 2, 2, token)
	if nr.status != 2 || !nr.failure || nr.code != 0 || nr.reader != token || w.cause() != nil {
		t.Fatal("NotReady changed capture/first cause")
	}
	f.advance(t, 11)
	read, raw := accountWireExchange(t, c, 2, 3, token)
	if read.status != 1 || read.reader != token {
		t.Fatal("same capture not ready at real successor")
	}
	accountWireSDK(t, raw, "10 11 3 4 "+f.expected.Owner)
	f.advance(t, 12)
	cur, raw := accountWireExchange(t, c, 3, 4, token)
	if cur.status != 1 || cur.reader != token || f.node != node {
		t.Fatal("current changed engine or token")
	}
	accountWireSDK(t, raw, "10 12 3 4 "+f.expected.Owner)
	if bytes.Equal(read.payload, cur.payload) {
		t.Fatal("current checkpoint hidden by stable policy")
	}
	for i, op := range []uint32{4, 5, 6} {
		r, _ := accountWireExchange(t, c, op, uint64(5+i), token)
		if r.failure || r.reader != token || len(r.payload) != 0 || (op == 6 && r.status != 4) || (op != 6 && r.status != 1) {
			t.Fatal("cleanup response", op)
		}
	}
	// Closed is a retained reader tombstone, not a new OPEN or Root capability.
	if e := writePQAccountWire(c, accountWireRequest(3, 8, token)); e != nil {
		t.Fatal(e)
	}
	accountWireWait(t, w)
	if !accountWireHandler(t, w).IsClosed() || w.cause() == nil {
		t.Fatal("closed reader resumed producing")
	}
	if _, e := f.app.WalletPolicyLiveSource(); e != nil {
		t.Fatal("channel closed sibling engine", e)
	}

	t.Run("PartialFailureAdoptAndClose", func(t *testing.T) {
		q, d := accountWireAttach(t, f, "0x1111111111111111111111111111111111111111", context.Background())
		r, _ := accountWireExchange(t, d, 1, 1, [32]byte{})
		if r.status != 3 || !r.failure || r.code != 0 || r.reader == [32]byte{} {
			t.Fatal("failed capture partial discarded")
		}
		first := q.cause()
		end, _ := accountWireExchange(t, d, 6, 2, r.reader)
		if end.status != 4 || !end.failure || end.code != 0 {
			t.Fatal("physical close/failure conflated")
		}
		_ = d.Close()
		accountWireWait(t, q)
		if q.cause() != first || !accountWireHandler(t, q).IsClosed() {
			t.Fatal("partial first cause/drain lost")
		}
	})
	t.Run("CrossChannelTokenDoesNotSelectOwner", func(t *testing.T) {
		a, ca := accountWireAttach(t, f, f.expected.Owner, context.Background())
		b, cb := accountWireAttach(t, f, f.expected.Owner, context.Background())
		ra, _ := accountWireExchange(t, ca, 1, 1, [32]byte{})
		rb, _ := accountWireExchange(t, cb, 1, 1, [32]byte{})
		if ra.reader == rb.reader {
			t.Fatal("reader token reused")
		}
		if e := writePQAccountWire(cb, accountWireRequest(2, 2, ra.reader)); e != nil {
			t.Fatal(e)
		}
		accountWireWait(t, b)
		if !accountWireHandler(t, b).IsClosed() || b.cause() == nil {
			t.Fatal("cross-channel token admitted")
		}
		end, _ := accountWireExchange(t, ca, 6, 2, ra.reader)
		if end.status != 4 || end.failure {
			t.Fatal("sibling reader closed by invalid token")
		}
		_ = ca.Close()
		accountWireWait(t, a)
	})
	t.Run("BadSequenceTokenOwnerAndReopen", func(t *testing.T) {
		for _, kind := range []string{"sequence", "token", "cross-owner-payload", "reopen"} {
			t.Run(kind, func(t *testing.T) {
				q, d := accountWireAttach(t, f, f.expected.Owner, context.Background())
				r, _ := accountWireExchange(t, d, 1, 1, [32]byte{})
				b := accountWireRequest(2, 2, r.reader)
				switch kind {
				case "sequence":
					b[52] = 1
				case "token":
					b[53] ^= 1
				case "cross-owner-payload":
					binary.BigEndian.PutUint32(b[93:97], 42)
				case "reopen":
					b = accountWireRequest(1, 2, [32]byte{})
				}
				if e := writePQAccountWire(d, b); e != nil {
					t.Fatal(e)
				}
				accountWireWait(t, q)
				if q.cause() == nil || !accountWireHandler(t, q).IsClosed() {
					t.Fatal("invalid request admitted or partial leaked")
				}
			})
		}
	})
}

func TestPQCommittedAccountWirePUBLICCloseDebt(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	t.Run("OSPeerPartial", func(t *testing.T) {
		fd, _ := current4Socketpair(t)
		q, e := attachPQCommittedAccountWire(context.Background(), f.app, f.expected.Owner, fd, pqAccountWirePeer{uid: uint32(os.Getuid()), pid: int32(os.Getpid() + 1)})
		if q == nil || e == nil {
			t.Fatal("partial peer refusal")
		}
		accountWireWait(t, q)
		if q.cause() != e {
			t.Fatal("peer first cause")
		}
	})
	t.Run("CapacityCountsTombstonesUntilWorkerDone", func(t *testing.T) {
		a, c := accountWireAttach(t, f, f.expected.Owner, context.Background())
		b, d := accountWireAttach(t, f, f.expected.Owner, context.Background())
		fd, _ := current4Socketpair(t)
		if q, e := attachPQCommittedAccountWire(context.Background(), f.app, f.expected.Owner, fd, pqAccountWirePeer{uid: uint32(os.Getuid()), pid: int32(os.Getpid())}); q != nil || !errors.Is(e, errPQAccountWireCapacity) {
			t.Fatal("unbounded channels", e)
		}
		_ = c.Close()
		_ = d.Close()
		accountWireWait(t, a)
		accountWireWait(t, b)
	})
	t.Run("OriginalCancellationDrainsNoReplacement", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		q, d := accountWireAttach(t, f, f.expected.Owner, ctx)
		r, _ := accountWireExchange(t, d, 1, 1, [32]byte{})
		if r.status != 1 {
			t.Fatal("capture")
		}
		cancel()
		accountWireWait(t, q)
		if !accountWireHandler(t, q).IsClosed() {
			t.Fatal("cancel lost reader debt")
		}
	})
	q, d := accountWireAttach(t, f, f.expected.Owner, context.Background())
	r, _ := accountWireExchange(t, d, 1, 1, [32]byte{})
	f.app.mu.Lock()
	locked := true
	defer func() {
		if locked {
			f.app.mu.Unlock()
		}
	}()
	if e := writePQAccountWire(d, accountWireRequest(2, 2, r.reader)); e != nil {
		t.Fatal(e)
	}
	deadline := time.Now().Add(time.Second)
	for {
		accountWireHandler(t, q).core.mu.Lock()
		running := accountWireHandler(t, q).core.running
		accountWireHandler(t, q).core.mu.Unlock()
		if running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("real read did not enter handler")
		}
		time.Sleep(time.Millisecond)
	}
	source := q.source
	closed := make(chan error, 1)
	go func() { closed <- source.Close() }()
	select {
	case <-closed:
		t.Fatal("Source close skipped blocked actual read")
	case <-time.After(20 * time.Millisecond):
	}
	source.mu.Lock()
	retired := source.retired
	count := len(source.accountProof)
	source.mu.Unlock()
	if !retired || count != 1 {
		t.Fatal("Source retired/inflight accounting")
	}
	select {
	case <-q.done:
		t.Fatal("worker done before actual handler")
	default:
	}
	f.app.mu.Unlock()
	locked = false
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("Source close did not join")
	}
	accountWireWait(t, q)
	if !accountWireHandler(t, q).IsClosed() {
		t.Fatal("Source close lost actual reader")
	}
	source.mu.Lock()
	count = len(source.accountProof)
	source.mu.Unlock()
	if count != 0 {
		t.Fatal("completed worker retained")
	}
	fd, _ := current4Socketpair(t)
	if n, e := attachPQCommittedAccountWire(context.Background(), f.app, f.expected.Owner, fd, pqAccountWirePeer{uid: uint32(os.Getuid()), pid: int32(os.Getpid())}); n != nil || e == nil {
		t.Fatal("late attach after Source retirement")
	}
}
