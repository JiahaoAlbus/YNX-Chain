//go:build linux || darwin

package consensus

import (
	"encoding/binary"
	"errors"
	"io"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// Sole SDK private DATA contract, MobileAccountProofWireDATA.hpp 786c9b56.
// This transport tag is NOT a signature domain. The two verified LightBlock
// originals and original Wallet policy bytes pass through unchanged.
const (
	pqAccountWirePurpose           = "wallet-mobile-committed-account-proof-v1"
	pqAccountWireTag               = "YNX-MOBILE-ACCOUNT-PROOF-HOST/V1\x00"
	pqAccountWireHeader            = 97
	pqAccountWirePayloadMax        = (36 << 20) + (64 << 10)
	pqAccountWirePolicyMax         = 8 << 20
	pqAccountWireBlockMax          = 10 << 20
	pqAccountWireOpen       uint32 = 1
	pqAccountWireRead       uint32 = 2
	pqAccountWireCurrent    uint32 = 3
	pqAccountWireRetire     uint32 = 4
	pqAccountWireJoin       uint32 = 5
	pqAccountWireClose      uint32 = 6
	pqAccountWireRequest    uint32 = 0
	pqAccountWireOK         uint32 = 1
	pqAccountWireNotReady   uint32 = 2
	pqAccountWireFailed     uint32 = 3
	pqAccountWireClosed     uint32 = 4
)

var errPQAccountWireFrame = errors.New("original account proof wire DATA or sequence is invalid")
var errPQAccountWireCapacity = errors.New("original account proof wire capacity exhausted")

type pqAccountWireFrame struct {
	op, status uint32
	sequence   uint64
	reader     [32]byte
	failure    bool
	code       int32
	payload    []byte
}

// Requests have no payload, including OPEN. Reject advertised sizes before
// allocation/reading; owner, App, checkpoint and engine identity are out of band.
func readPQAccountWireRequest(r io.Reader) (pqAccountWireFrame, error) {
	var h [pqAccountWireHeader]byte
	var f pqAccountWireFrame
	if _, err := io.ReadFull(r, h[:]); err != nil {
		return f, err
	}
	if string(h[:33]) != pqAccountWireTag || binary.BigEndian.Uint32(h[33:37]) != 1 {
		return f, errPQAccountWireFrame
	}
	f.op = binary.BigEndian.Uint32(h[37:41])
	f.status = binary.BigEndian.Uint32(h[41:45])
	f.sequence = binary.BigEndian.Uint64(h[45:53])
	copy(f.reader[:], h[53:85])
	if f.op < 1 || f.op > 6 || f.status != pqAccountWireRequest || f.sequence == 0 || f.sequence == math.MaxUint64 || binary.BigEndian.Uint32(h[85:89]) != 0 || binary.BigEndian.Uint32(h[89:93]) != 0 || binary.BigEndian.Uint32(h[93:97]) != 0 {
		return f, errPQAccountWireFrame
	}
	if (f.op == pqAccountWireOpen) != (f.reader == [32]byte{}) {
		return f, errPQAccountWireFrame
	}
	return f, nil
}

func (f pqAccountWireFrame) header() ([pqAccountWireHeader]byte, error) {
	var h [pqAccountWireHeader]byte
	if f.op < 1 || f.op > 6 || f.sequence == 0 || f.status < 1 || f.status > 4 || len(f.payload) > pqAccountWirePayloadMax || (!f.failure && f.code != 0) {
		return h, errPQAccountWireFrame
	}
	switch f.status {
	case pqAccountWireOK:
		if f.failure || f.reader == [32]byte{} || ((f.op == pqAccountWireRead || f.op == pqAccountWireCurrent) != (len(f.payload) > 0)) {
			return h, errPQAccountWireFrame
		}
	case pqAccountWireNotReady:
		if (f.op != pqAccountWireRead && f.op != pqAccountWireCurrent) || f.reader == [32]byte{} || !f.failure || len(f.payload) != 0 {
			return h, errPQAccountWireFrame
		}
	case pqAccountWireFailed:
		if !f.failure || len(f.payload) != 0 || (f.reader == [32]byte{} && f.op != pqAccountWireOpen) {
			return h, errPQAccountWireFrame
		}
	case pqAccountWireClosed:
		if f.op != pqAccountWireClose || f.reader == [32]byte{} || len(f.payload) != 0 {
			return h, errPQAccountWireFrame
		}
	}
	copy(h[:33], pqAccountWireTag)
	binary.BigEndian.PutUint32(h[33:37], 1)
	binary.BigEndian.PutUint32(h[37:41], f.op)
	binary.BigEndian.PutUint32(h[41:45], f.status)
	binary.BigEndian.PutUint64(h[45:53], f.sequence)
	copy(h[53:85], f.reader[:])
	if f.failure {
		binary.BigEndian.PutUint32(h[85:89], 1)
	}
	binary.BigEndian.PutUint32(h[89:93], uint32(f.code))
	binary.BigEndian.PutUint32(h[93:97], uint32(len(f.payload)))
	return h, nil
}

// Bounded writer. Public bytes only; an invalid field discards the entire DATA
// output. No caller-provided parser/callback or policy JSON re-serialization.
type pqAccountWireWriter struct {
	b   []byte
	err error
}

func (w *pqAccountWireWriter) raw(b []byte) {
	if w.err != nil {
		return
	}
	if len(b) > pqAccountWirePayloadMax-len(w.b) {
		w.err = errPQAccountWireCapacity
		return
	}
	w.b = append(w.b, b...)
}
func (w *pqAccountWireWriter) u32(n uint32) {
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], n)
	w.raw(b[:])
}
func (w *pqAccountWireWriter) u64(n uint64) {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], n)
	w.raw(b[:])
}
func (w *pqAccountWireWriter) flag(v bool) {
	b := byte(0)
	if v {
		b = 1
	}
	w.raw([]byte{b})
}
func (w *pqAccountWireWriter) bytes(b []byte, cap int) {
	if len(b) > cap {
		w.err = errPQAccountWireCapacity
		return
	}
	w.u32(uint32(len(b)))
	w.raw(b)
}
func (w *pqAccountWireWriter) text(s string, cap int) {
	if len(s) == 0 || len(s) > cap {
		w.err = errPQAccountWireFrame
		return
	}
	for _, b := range []byte(s) {
		if b < 33 || b > 126 {
			w.err = errPQAccountWireFrame
			return
		}
	}
	w.bytes([]byte(s), cap)
}
func (w *pqAccountWireWriter) checkpoint(c PQWalletPolicyCheckpoint) {
	if c.Height < 0 {
		w.err = errPQAccountWireFrame
		return
	}
	w.text(c.ChainID, 128)
	w.u64(uint64(c.Height))
	w.raw(c.AppHash[:])
}
func (w *pqAccountWireWriter) registration(r *ynxauth.Record, owner string) {
	w.flag(r != nil)
	if r == nil {
		return
	}
	if !accountaddress.IsCanonical(r.Owner) || r.Owner != owner || len(r.PKA) != 2592 || len(r.PKB) != 64 {
		w.err = errPQAccountWireFrame
		return
	}
	w.text(r.AlgorithmVersion, 128)
	w.text(r.Owner, 42)
	w.bytes(r.PKA, 2592)
	w.bytes(r.PKB, 64)
	w.u64(r.Revision)
	w.u64(r.RegisteredAt)
	w.u64(r.ActiveFrom)
	w.u64(r.LedgerNonce)
}
func (w *pqAccountWireWriter) account(a PQWalletPolicyAtCheckpointView) {
	if !accountaddress.IsCanonical(a.Owner) || a.NativeChainID <= 0 || a.CommittedHeight < 0 || len(a.PolicyOriginal) == 0 {
		w.err = errPQAccountWireFrame
		return
	}
	w.text(a.Owner, 42)
	w.raw(a.NetworkID[:])
	w.u64(uint64(a.NativeChainID))
	w.u64(uint64(a.CommittedHeight))
	w.u64(a.ExecutionHeight)
	w.u64(a.LedgerNonce)
	w.bytes(a.PolicyOriginal, pqAccountWirePolicyMax)
	w.text(a.CommittedAuthorizationStatus, 128)
	w.flag(a.CommittedPQSigningEnabled)
	w.text(a.AuthorizationStatus, 128)
	w.flag(a.PQSigningEnabled)
	w.registration(a.CommittedRegistration, a.Owner)
	w.registration(a.ExecutionRegistration, a.Owner)
}

func encodePQAccountWireView(v PQCommittedAccountProofView) ([]byte, error) {
	h, c := v.Proof, v.CurrentCheckpoint
	a, b := v.HistoricalAccount, v.CurrentAccount
	if h.Height < 0 || h.Height >= math.MaxInt64-1 || c.Height <= h.Height || c.Height >= math.MaxInt64-1 || h.ChainID != c.ChainID || a.Owner != b.Owner || a.NetworkID != b.NetworkID || a.NativeChainID != b.NativeChainID || a.CommittedHeight != h.Height || a.ExecutionHeight != uint64(h.Height)+1 || b.CommittedHeight != c.Height || b.ExecutionHeight != uint64(c.Height)+1 || len(v.BlockOriginal) == 0 || len(v.SuccessorOriginal) == 0 {
		return nil, errPQAccountWireFrame
	}
	w := pqAccountWireWriter{}
	w.checkpoint(h)
	w.account(a)
	w.checkpoint(c)
	w.account(b)
	w.bytes(v.BlockOriginal, pqAccountWireBlockMax)
	w.bytes(v.SuccessorOriginal, pqAccountWireBlockMax)
	if w.err != nil {
		return nil, w.err
	}
	return w.b, nil
}
