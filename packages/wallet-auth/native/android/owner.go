// Package main is the original Android Native Wallet adapter. The only public
// platform surface is the fixed C ABI. Crypto possession is never permission.
package main

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"strconv"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

var errRetired = errors.New("WALLET_ANDROID_PQ_PAIR_RETIRED")
var errBinding = errors.New("WALLET_ANDROID_PQ_BINDING_MISMATCH")
var errOnce = errors.New("WALLET_ANDROID_PQ_OPERATION_ALREADY_SELECTED")
var errAuth = errors.New("WALLET_ANDROID_PQ_ORIGINAL_AUTHORIZATION_UNAVAILABLE")
var errCancelled = errors.New("WALLET_ANDROID_PQ_USER_CANCELLED")
var errJoin = errors.New("WALLET_ANDROID_PQ_JOIN_PENDING")
var errStorage = errors.New("WALLET_ANDROID_PQ_STORAGE_NOT_READY")

// All values below are Native-local captured DATA, not JS authority.
type pairBinding struct {
	NetworkHash   [32]byte
	NativeChainID uint64
	Owner         string
	PairVersion   uint64
}
type pairOwner struct {
	mu              sync.Mutex
	binding         pairBinding
	key             *ynxbatch.PrivateKey
	public          ynxbatch.PublicKey
	retired         bool
	epoch           uint64
	busy            uint32
	cleanupComplete bool
	storageReady    bool
	storageCause    error
	storageSelected bool
}

func validBinding(b pairBinding) bool {
	return b.NativeChainID > 0 && b.NativeChainID <= 1<<63-1 && accountaddress.IsCanonical(b.Owner) && b.PairVersion > 0
}
func newPair(b pairBinding) (*pairOwner, error) {
	if !validBinding(b) {
		return nil, errBinding
	}
	key, pub, e := ynxbatch.KeyGen()
	if e != nil {
		return nil, e
	}
	return &pairOwner{binding: b, key: key, public: pub, epoch: 1}, nil
}
func (p *pairOwner) capture() (key *ynxbatch.PrivateKey, epoch uint64, e error) {
	if p == nil {
		return nil, 0, errRetired
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.retired || p.key == nil {
		return nil, 0, errRetired
	}
	if p.busy >= 32 {
		return nil, 0, errors.New("WALLET_ANDROID_PQ_PAIR_CAPACITY")
	}
	p.busy++
	return p.key, p.epoch, nil
}
func (p *pairOwner) current(epoch uint64) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.retired || p.key == nil || p.epoch != epoch {
		return errRetired
	}
	return nil
}
func (p *pairOwner) release() {
	p.mu.Lock()
	if p.busy == 0 {
		p.mu.Unlock()
		panic("Native pair borrow underflow")
	}
	p.busy--
	var dead *ynxbatch.PrivateKey
	if p.retired && p.busy == 0 {
		dead = p.key
		p.key = nil
	}
	p.mu.Unlock()
	if dead != nil {
		dead.Destroy()
		p.mu.Lock()
		p.cleanupComplete = true
		p.mu.Unlock()
	}
}
func (p *pairOwner) retire() {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.retired = true
	var dead *ynxbatch.PrivateKey
	if p.busy == 0 {
		dead = p.key
		p.key = nil
	}
	p.mu.Unlock()
	if dead != nil {
		dead.Destroy()
		p.mu.Lock()
		p.cleanupComplete = true
		p.mu.Unlock()
	}
}
func (p *pairOwner) join() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.retired || p.busy != 0 || !p.cleanupComplete {
		return errJoin
	}
	return nil
}
func (p *pairOwner) publicCopy() ynxbatch.PublicKey {
	p.mu.Lock()
	defer p.mu.Unlock()
	return ynxbatch.PublicKey{PKA: bytes.Clone(p.public.PKA), PKB: bytes.Clone(p.public.PKB)}
}

// The original Auth Native factory supplies the sole production implementation.
// No platform ABI accepts this interface or a caller callback/provider/boolean.
// Tests in this same package may use explicitly PUBLIC non-authority controls.
type originalAuthorization interface{ assertOriginalCurrent(transferScope) error }
type transferReview struct {
	RequestID                                    string
	ReviewDigest                                 [32]byte
	PolicyRevision, ExecutionHeight, PairVersion uint64
	Transfer                                     ynxauth.Transfer
}
type transferScope struct {
	Binding                         pairBinding
	Public                          ynxbatch.PublicKey
	RequestID                       string
	ReviewDigest                    [32]byte
	PolicyRevision, ExecutionHeight uint64
	SigningBytes                    []byte
}
type operationOwner struct {
	mu                       sync.Mutex
	pair                     *pairOwner
	scope                    transferScope
	entered, busy, cancelled bool
	result                   []byte
	resultCaptured           bool
	signingComplete          bool
	first                    error
	cleanupCause             error
	authorization            originalAuthorization
}

func requestID(s string) bool {
	if !utf8.ValidString(s) || len(s) < 1 || len(s) > 128 || s != strings.TrimSpace(s) {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func prepareTransfer(p *pairOwner, r transferReview) (*operationOwner, error) {
	if p == nil || !requestID(r.RequestID) || r.PolicyRevision == 0 || r.ExecutionHeight == 0 {
		return nil, errBinding
	}
	p.mu.Lock()
	b := p.binding
	live := !p.retired && p.key != nil
	stored := p.storageReady
	p.mu.Unlock()
	if !live {
		return nil, errRetired
	}
	if !stored {
		return nil, errStorage
	}
	t := r.Transfer
	if !bytes.Equal(t.ChainID, b.NetworkHash[:]) || t.NativeChainID != b.NativeChainID || t.From != b.Owner || r.PairVersion != b.PairVersion || t.Fee != 1 {
		return nil, errBinding
	}
	raw, e := t.SigningBytes()
	if e != nil {
		return nil, e
	}
	return &operationOwner{pair: p, scope: transferScope{Binding: b, Public: p.publicCopy(), RequestID: r.RequestID, ReviewDigest: r.ReviewDigest, PolicyRevision: r.PolicyRevision, ExecutionHeight: r.ExecutionHeight, SigningBytes: raw}}, nil
}
func (o *operationOwner) scopeCopy() transferScope {
	s := o.scope
	s.SigningBytes = bytes.Clone(s.SigningBytes)
	s.Public = ynxbatch.PublicKey{PKA: bytes.Clone(s.Public.PKA), PKB: bytes.Clone(s.Public.PKB)}
	return s
}
func (o *operationOwner) fail(e error) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.first == nil {
		o.first = e
	}
	return o.first
}
func (o *operationOwner) cancel() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.cancelled = true
	o.signingComplete = false
	if o.first == nil {
		o.first = errCancelled
	}
}
func (o *operationOwner) checkCancelled() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.cancelled {
		return errCancelled
	}
	return nil
}
func (o *operationOwner) sign(auth originalAuthorization) (result error) {
	o.mu.Lock()
	if o.entered {
		o.mu.Unlock()
		return errOnce
	}
	o.entered = true
	o.busy = true
	o.authorization = auth
	o.mu.Unlock()
	defer func() { o.mu.Lock(); o.busy = false; o.mu.Unlock() }()
	key, epoch, e := o.pair.capture()
	if e != nil {
		return o.fail(e)
	}
	defer o.pair.release()
	if auth == nil {
		return o.fail(errAuth)
	}
	if e = o.checkCancelled(); e != nil {
		return o.fail(e)
	}
	if e = auth.assertOriginalCurrent(o.scopeCopy()); e != nil {
		return o.fail(e)
	}
	// Once phase1 selected its original loan, phase2 MUST run on every exit,
	// including pre-math lock/cancel or actual math failure. Keep business first
	// error distinct from a later current/cleanup failure, never retry either.
	defer func() {
		if post := auth.assertOriginalCurrent(o.scopeCopy()); post != nil {
			o.mu.Lock()
			if o.cleanupCause == nil {
				o.cleanupCause = post
			}
			o.mu.Unlock()
			result = o.fail(post)
		}
		if result == nil {
			if post := o.pair.current(epoch); post != nil {
				result = o.fail(post)
			}
		}
		if result == nil {
			if post := o.checkCancelled(); post != nil {
				result = o.fail(post)
			}
		}
		o.mu.Lock()
		if result == nil && !o.cancelled && len(o.result) > 0 {
			o.signingComplete = true
		}
		o.mu.Unlock()
	}()
	if e = o.pair.current(epoch); e != nil {
		return o.fail(e)
	}
	if e = o.checkCancelled(); e != nil {
		return o.fail(e)
	}
	batch, e := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: bytes.Clone(o.scope.Binding.NetworkHash[:]), Owner: o.scope.Binding.Owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{bytes.Clone(o.scope.SigningBytes)}, ynxbatch.SignOptions{Optimized: true})
	if batch != nil {
		defer batch.Discard()
	}
	if e != nil {
		return o.fail(e)
	}
	member, e := ynxbatch.Extract(batch, 0)
	if e != nil {
		return o.fail(e)
	}
	wire, e := ynxbatch.EncodeMember(member)
	if e != nil {
		return o.fail(e)
	}
	// Capture complete signed bytes before shared self-verification or any
	// foreign post-current; failed/late results stay Native journal DATA only.
	o.mu.Lock()
	o.result = bytes.Clone(wire)
	o.mu.Unlock()
	if e = selfVerifyTransfer(o.scope, wire); e != nil {
		return o.fail(e)
	}
	return nil
}
func selfVerifyTransfer(s transferScope, wire []byte) error {
	m, e := ynxbatch.DecodeMember(wire)
	if e != nil {
		return e
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || c.Purpose != ynxauth.TransactionPurpose || c.Owner != s.Binding.Owner || !bytes.Equal(c.ChainID, s.Binding.NetworkHash[:]) || !bytes.Equal(c.PKA, s.Public.PKA) || !bytes.Equal(c.PKB, s.Public.PKB) || !bytes.Equal(m.Message, s.SigningBytes) {
		return errBinding
	}
	// Pure math check against this already-held pair, NOT a Source/current or
	// registration claim. Actual independent authority is checked by Auth.
	v, e := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: bytes.Clone(s.Binding.NetworkHash[:]), Purpose: ynxauth.TransactionPurpose, Optimized: true, CacheEntries: 0, ResolveTrustedOwner: func(ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: s.Binding.Owner, Purpose: ynxauth.TransactionPurpose, PolicyRevision: strconv.FormatUint(s.PolicyRevision, 10), ChainID: bytes.Clone(s.Binding.NetworkHash[:]), PKA: bytes.Clone(s.Public.PKA), PKB: bytes.Clone(s.Public.PKB), Enabled: true, ActiveFrom: 0}, nil
	}})
	if e != nil {
		return e
	}
	defer v.Clear()
	return v.VerifyOne(wire, s.ExecutionHeight)
}

type operationStatus struct {
	Entered, Busy, Cancelled, ResultRetained, ResultCaptured, SigningComplete, Unknown bool
	ResultDigest                                                                       [32]byte
	First, CleanupCause                                                                error
}

func (o *operationOwner) status() operationStatus {
	o.mu.Lock()
	defer o.mu.Unlock()
	s := operationStatus{Entered: o.entered, Busy: o.busy, Cancelled: o.cancelled, ResultRetained: len(o.result) > 0, ResultCaptured: o.resultCaptured, SigningComplete: o.signingComplete, Unknown: len(o.result) > 0 && !o.signingComplete, First: o.first, CleanupCause: o.cleanupCause}
	if len(o.result) > 0 {
		s.ResultDigest = sha256.Sum256(o.result)
	}
	return s
}

// Native Main-only result retention for the original durable journal; no network
// dispatch, approval or permission is returned, including after late failure.
func (o *operationOwner) copyResultData() ([]byte, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.busy {
		return nil, errJoin
	}
	if len(o.result) == 0 {
		return nil, errors.New("WALLET_ANDROID_PQ_RESULT_UNAVAILABLE")
	}
	o.resultCaptured = true
	return bytes.Clone(o.result), nil
}
func (o *operationOwner) close() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.busy || len(o.result) > 0 && !o.resultCaptured {
		return errJoin
	}
	o.cancelled = true
	o.signingComplete = false
	return nil
}

// Native-only sealed material import. The expected pair must come from original
// Main protected storage/backup binding; it is still NOT chain registration.
func restorePair(b pairBinding, material ynxbatch.KeyMaterial, expected ynxbatch.PublicKey) (*pairOwner, error) {
	if !validBinding(b) || len(expected.PKA) != ynxbatch.PublicKeyASize || len(expected.PKB) != ynxbatch.PublicKeyBSize {
		return nil, errBinding
	}
	key, pub, e := ynxbatch.ImportKeyMaterial(material)
	if e != nil {
		return nil, e
	}
	if !bytes.Equal(pub.PKA, expected.PKA) || !bytes.Equal(pub.PKB, expected.PKB) {
		key.Destroy()
		return nil, errBinding
	}
	return &pairOwner{binding: b, key: key, public: pub, epoch: 1, storageReady: true, storageSelected: true}, nil
}

// Initial private Keystore write only, never a general pair-export interface.
// Caller is the fixed Native Main storage bridge; no JS/ordinary-login path.
func (p *pairOwner) exportNewMaterialForStorage() (ynxbatch.KeyMaterial, error) {
	p.mu.Lock()
	if p.storageSelected || p.storageReady {
		p.mu.Unlock()
		return ynxbatch.KeyMaterial{}, errOnce
	}
	p.storageSelected = true
	p.mu.Unlock()
	key, epoch, e := p.capture()
	if e != nil {
		return ynxbatch.KeyMaterial{}, e
	}
	defer p.release()
	material, e := ynxbatch.ExportKeyMaterial(key)
	if e != nil {
		return material, e
	}
	if e = p.current(epoch); e != nil {
		material.Clear()
		return ynxbatch.KeyMaterial{}, e
	}
	return material, nil
}
