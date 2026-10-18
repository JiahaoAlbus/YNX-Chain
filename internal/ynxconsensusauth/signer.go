package ynxconsensusauth

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

const signerStateVersion = "YNX-CONSENSUS-SIGNER/v2"
const maxSignerStateBytes = 2 << 20

// ErrSignerDurabilityUncertain means a replacement may be visible but was not
// confirmed durable. The signer returns no signature and remains fenced until
// the exact original state is successfully checkpointed. It never rolls back.
var ErrSignerDurabilityUncertain = errors.New("consensus signer durability is uncertain")

type signerState struct {
	Version            string `json:"version"`
	Policy             Policy `json:"policy"`
	Address            []byte `json:"address"`
	PublicA            []byte `json:"publicA"`
	PublicB            []byte `json:"publicB"`
	Epoch              uint64 `json:"epoch"`
	Height             int64  `json:"height"`
	Round              int32  `json:"round"`
	Kind               Kind   `json:"kind"`
	Message            []byte `json:"message,omitempty"`
	Signature          []byte `json:"signature,omitempty"`
	PrecommitMessage   []byte `json:"precommitMessage,omitempty"`
	PrecommitSignature []byte `json:"precommitSignature,omitempty"`
}

// Signer is a candidate durable signing component, not a Comet PrivValidator
// adapter. It holds an OS lock and never resets an existing file. Key custody,
// authenticated registry delivery, and engine/remote-signer wiring are separate.
// The state file is trusted anti-rollback storage; restoring an older copy is
// unsafe, just as restoring an old upstream FilePV last-sign state is unsafe.
type Signer struct{ *signerCore }

// All value copies share one reservation history, mutex and lock lifetime.
// Copying the exported handle must never create another live signing state.
type signerCore struct {
	mu        sync.Mutex
	key       *CandidateKey
	registry  Registry
	state     signerState
	path      string
	lock      *os.File
	closed    bool
	uncertain bool
	write     func(string, signerState, bool) error
}

// CreateSigner creates new, exclusive anti-equivocation state. This operation
// must only be used for a genuinely new validator key epoch, never as recovery
// for lost state. ResumeSigner requires the existing durable file instead.
func CreateSigner(path string, key *CandidateKey, policy Policy, registry Registry, address []byte, epoch uint64) (*Signer, error) {
	s, err := openSigner(path, key, registry)
	if err != nil {
		return nil, err
	}
	pa, pb, err := key.publicMaterial()
	if err == nil {
		_, err = NewCIRCLVerifier(policy, registry, nil)
	}
	if err == nil {
		err = validateCoordinates(policy.ChainID, address, policy.ActivationHeight, 0)
	}
	if err == nil && (epoch == 0 || registry == nil) {
		err = errors.New("signer requires trusted registry and positive epoch")
	}
	if err == nil {
		policy.GenesisID = bytes.Clone(policy.GenesisID)
		s.state = signerState{Version: signerStateVersion, Policy: policy, Address: bytes.Clone(address), PublicA: pa, PublicB: pb, Epoch: epoch}
		err = s.write(s.path, s.state, true)
	}
	if err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

// ResumeSigner rejects v1/unbound files before reconfirming their durability.
// It never upgrades, resets or replaces incompatible anti-equivocation history.
func ResumeSigner(path string, key *CandidateKey, registry Registry) (*Signer, error) {
	return resumeSigner(path, key, registry, nil)
}

// The custody path supplies a detached complete expected identity. Check it
// under the same original OS lock as load and durability reconfirmation; a
// read-only preflight alone cannot close a check-before-lock window.
func resumeSigner(path string, key *CandidateKey, registry Registry, expected *SignerIdentity) (*Signer, error) {
	s, err := openSigner(path, key, registry)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			s.Close()
		}
	}()
	f, err := openSignerState(s.path)
	if err != nil {
		return nil, err
	}
	b, readErr := io.ReadAll(io.LimitReader(f, maxSignerStateBytes+1))
	closeErr := f.Close()
	if err = errors.Join(readErr, closeErr); err != nil {
		return nil, err
	}
	if len(b) > maxSignerStateBytes {
		err = errors.New("consensus signer state exceeds bound")
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&s.state); err != nil {
		return nil, err
	}
	var tail any
	if decoder.Decode(&tail) != io.EOF {
		err = errors.New("consensus signer state has trailing content")
		return nil, err
	}
	if err = s.validateState(); err != nil {
		return nil, err
	}
	if expected != nil {
		st := s.state
		if st.Policy.Version != expected.Policy.Version || st.Policy.ChainID != expected.Policy.ChainID || st.Policy.ActivationHeight != expected.Policy.ActivationHeight || !bytes.Equal(st.Policy.GenesisID, expected.Policy.GenesisID) || st.Epoch != expected.Epoch || !bytes.Equal(st.Address, expected.ValidatorAddress) || !bytes.Equal(st.PublicA, expected.MLDSA87PublicKey) || !bytes.Equal(st.PublicB, expected.SLHDSASHA2256fPublicKey) {
			err = errors.New("locked signer history differs from expected complete custody identity")
			return nil, err
		}
		var canonical []byte
		canonical, err = json.Marshal(st)
		if err != nil {
			return nil, err
		}
		if !bytes.Equal(canonical, b) {
			err = errors.New("locked custody signer history is not its exact canonical encoding")
			return nil, err
		}
	}
	// Reconfirm a file left visible by a previous uncertain directory fsync.
	if err = s.write(s.path, s.state, false); err != nil {
		return nil, err
	}
	return s, nil
}

func openSigner(path string, key *CandidateKey, registry Registry) (*Signer, error) {
	if path == "" || key == nil || registry == nil {
		return nil, errors.New("signer requires state path, key and trusted registry")
	}
	p, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(p))
	if err != nil {
		return nil, err
	}
	p = filepath.Join(parent, filepath.Base(p))
	lock, err := acquireSignerLock(p + ".lock")
	if err != nil {
		return nil, err
	}
	return &Signer{signerCore: &signerCore{key: key, registry: registry, path: p, lock: lock, write: writeSignerState}}, nil
}

func (k *CandidateKey) publicMaterial() ([]byte, []byte, error) {
	if k == nil || k.state == nil {
		return nil, nil, errors.New("missing consensus private key")
	}
	s := k.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.a == nil || s.b == nil {
		return nil, nil, errors.New("destroyed consensus private key")
	}
	return bytes.Clone(s.pa), bytes.Clone(s.pb), nil
}

func (s *Signer) validateState() error {
	st := s.state
	pa, pb, err := s.key.publicMaterial()
	if err != nil {
		return err
	}
	if st.Version != signerStateVersion || st.Epoch == 0 || !bytes.Equal(st.PublicA, pa) || !bytes.Equal(st.PublicB, pb) {
		return errors.New("signer state version or key mismatch")
	}
	if _, err := NewCIRCLVerifier(st.Policy, s.registry, nil); err != nil {
		return err
	}
	if err := validateCoordinates(st.Policy.ChainID, st.Address, st.Policy.ActivationHeight, 0); err != nil {
		return err
	}
	if st.Height == 0 {
		if st.Round != 0 || st.Kind != 0 || len(st.Message) != 0 || len(st.Signature) != 0 || len(st.PrecommitMessage) != 0 || len(st.PrecommitSignature) != 0 {
			return errors.New("invalid initial signer state")
		}
		return nil
	}
	if st.Height < st.Policy.ActivationHeight || st.Round < 0 || st.Kind < Proposal || st.Kind > VoteExtension || len(st.Message) == 0 || len(st.Message) > MaxCanonicalBytes+256 {
		return errors.New("invalid reserved signer coordinates or message")
	}
	request, err := decodeSignerMessage(st.Message, st.Epoch)
	if err != nil || request.chainID != st.Policy.ChainID || !bytes.Equal(request.genesisID, st.Policy.GenesisID) || !bytes.Equal(request.address, st.Address) || request.height != st.Height || request.round != st.Round || request.kind != st.Kind {
		return errors.New("persisted signer coordinates differ from reserved full message")
	}
	if st.Kind == VoteExtension {
		if len(st.PrecommitMessage) == 0 || len(st.PrecommitMessage) > MaxCanonicalBytes+256 {
			return errors.New("extension state is missing ordinary precommit bytes")
		}
		if err := verifySavedSignature(st, st.PrecommitMessage, st.PrecommitSignature); err != nil {
			return err
		}
		base, err := extensionPrecommitMessage(request, st.Epoch)
		if err != nil || !bytes.Equal(base, st.PrecommitMessage) {
			return errors.New("persisted extension differs from its signed precommit")
		}
	} else if len(st.PrecommitMessage) != 0 || len(st.PrecommitSignature) != 0 {
		return errors.New("unexpected stored precommit companion")
	}
	if len(st.Signature) != 0 {
		return verifySavedSignature(st, st.Message, st.Signature)
	}
	return nil
}

func decodeSignerMessage(message []byte, epoch uint64) (Request, error) {
	fail := func() (Request, error) { return Request{}, errors.New("invalid persisted consensus message") }
	if len(message) < len(messageTag)+16 || !bytes.Equal(message[:len(messageTag)], []byte(messageTag)) {
		return fail()
	}
	p := len(messageTag)
	if binary.BigEndian.Uint32(message[p:]) != ConsensusGenesisVersion {
		return fail()
	}
	p += 4
	kind := Kind(binary.BigEndian.Uint32(message[p:]))
	p += 4
	if binary.BigEndian.Uint64(message[p:]) != epoch {
		return fail()
	}
	p += 8
	field := func() ([]byte, bool) {
		if len(message)-p < 4 {
			return nil, false
		}
		n := uint64(binary.BigEndian.Uint32(message[p:]))
		p += 4
		if n > uint64(len(message)-p) {
			return nil, false
		}
		v := message[p : p+int(n)]
		p += int(n)
		return v, true
	}
	genesis, ok := field()
	if !ok || len(genesis) != 32 {
		return fail()
	}
	chain, ok := field()
	if !ok {
		return fail()
	}
	address, ok := field()
	if !ok || len(message)-p < 12 {
		return fail()
	}
	height := int64(binary.BigEndian.Uint64(message[p:]))
	p += 8
	round := int32(binary.BigEndian.Uint32(message[p:]))
	p += 4
	canonical, ok := field()
	if !ok || p != len(message) {
		return fail()
	}
	r, err := newRequest(genesis, string(chain), address, height, round, kind, canonical, canonical)
	if err != nil {
		return Request{}, err
	}
	return r, r.validate()
}

func verifySavedSignature(st signerState, message, signature []byte) error {
	e, err := ParseEnvelope(signature)
	if err != nil || e.KeyEpoch != st.Epoch {
		return errors.New("invalid persisted consensus signature")
	}
	p := CIRCLProvider{}
	return errors.Join(p.VerifyMLDSA87(st.PublicA, message, e.MLDSA87), p.VerifySLHDSASHA2256f(st.PublicB, message, e.SLHDSASHA2256f))
}

func extensionPrecommitMessage(request Request, epoch uint64) ([]byte, error) {
	if request.kind != VoteExtension || len(request.canonical) < 8 {
		return nil, errors.New("invalid extension request")
	}
	n := uint64(binary.BigEndian.Uint32(request.canonical))
	if n == 0 || n > uint64(len(request.canonical)-8) {
		return nil, errors.New("invalid extension ordinary vote binding")
	}
	base := request
	base.kind, base.canonical = Precommit, request.canonical[4:4+int(n)]
	return base.SigningBytes(epoch)
}

// Sign reserves complete bytes durably BEFORE computing a signature. A failed
// request can only be retried with exactly those bytes; timestamp-only changes
// are also conflicts. A completed exact retry returns the original signature.
// Consensus still decides proposer selection, voting power, quorum and liveness.
func (s *Signer) Sign(request Request) ([]byte, error) {
	if s == nil || s.signerCore == nil {
		return nil, errors.New("missing consensus signer")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.lock == nil {
		return nil, errors.New("closed consensus signer")
	}
	if err := request.validate(); err != nil {
		return nil, err
	}
	st := s.state
	if request.chainID != st.Policy.ChainID || !bytes.Equal(request.genesisID, st.Policy.GenesisID) || !bytes.Equal(request.address, st.Address) || request.height < st.Policy.ActivationHeight {
		return nil, errors.New("request outside consensus signer authority")
	}
	if err := validatePolicyAnchor(st.Policy, s.registry.Anchor()); err != nil {
		return nil, err
	}
	record, err := s.registry.ConsensusKeysAt(request.chainID, bytes.Clone(request.address), request.height)
	if err != nil {
		return nil, err
	}
	if record.Version != Version || record.ChainID != request.chainID || !bytes.Equal(record.ValidatorAddress, request.address) || record.Epoch != st.Epoch || record.ValidFromHeight <= 0 || record.ValidFromHeight > request.height || (record.ValidUntilHeight != 0 && request.height >= record.ValidUntilHeight) || !bytes.Equal(record.MLDSA87PublicKey, st.PublicA) || !bytes.Equal(record.SLHDSASHA2256fPublicKey, st.PublicB) {
		return nil, errors.New("consensus key is not currently authorized")
	}
	message, err := request.SigningBytes(st.Epoch)
	if err != nil {
		return nil, err
	}
	// An extension is a companion to the exact precommit already persisted.
	// Preserve the ordinary signature so Comet's whole SignVote retry can reuse
	// it after the extension moved the durable step forward.
	precommitReplay := request.kind == Precommit && st.Kind == VoteExtension && request.height == st.Height && request.round == st.Round && bytes.Equal(message, st.PrecommitMessage)
	if precommitReplay {
		if s.uncertain {
			if err := s.write(s.path, s.state, false); err != nil {
				return nil, err
			}
			s.uncertain = false
		}
		return bytes.Clone(st.PrecommitSignature), nil
	}
	if request.kind == VoteExtension {
		base, err := extensionPrecommitMessage(request, st.Epoch)
		if err != nil {
			return nil, err
		}
		priorMessage, priorSignature := st.Message, st.Signature
		if st.Kind == VoteExtension {
			priorMessage, priorSignature = st.PrecommitMessage, st.PrecommitSignature
		}
		if (st.Kind != Precommit && st.Kind != VoteExtension) || request.height != st.Height || request.round != st.Round || len(priorSignature) == 0 || !bytes.Equal(base, priorMessage) {
			return nil, errors.New("extension does not match a durably signed precommit")
		}
	}
	if request.height < st.Height || (request.height == st.Height && (request.round < st.Round || (request.round == st.Round && request.kind < st.Kind))) {
		return nil, errors.New("consensus signing height/round/step regression")
	}
	same := request.height == st.Height && request.round == st.Round && request.kind == st.Kind
	if same && !bytes.Equal(st.Message, message) {
		return nil, errors.New("conflicting consensus bytes at reserved height/round/step")
	}
	if s.uncertain {
		if err := s.write(s.path, s.state, false); err != nil {
			return nil, err
		}
		s.uncertain = false
	}
	if same && len(st.Signature) != 0 {
		return bytes.Clone(st.Signature), nil
	}
	if !same {
		next := st
		next.PrecommitMessage, next.PrecommitSignature = nil, nil
		if request.kind == VoteExtension {
			next.PrecommitMessage, next.PrecommitSignature = bytes.Clone(st.Message), bytes.Clone(st.Signature)
		}
		next.Height, next.Round, next.Kind = request.height, request.round, request.kind
		next.Message, next.Signature = bytes.Clone(message), nil
		err = s.write(s.path, next, false)
		if err != nil {
			if errors.Is(err, ErrSignerDurabilityUncertain) {
				s.state, s.uncertain = next, true
			}
			return nil, err
		}
		s.state = next
	}
	signature, err := s.key.signRequest(request, record)
	if err != nil {
		return nil, err
	}
	next := s.state
	next.Signature = bytes.Clone(signature)
	if err := s.write(s.path, next, false); err != nil {
		if errors.Is(err, ErrSignerDurabilityUncertain) {
			s.state, s.uncertain = next, true
		}
		return nil, err
	}
	s.state = next
	return bytes.Clone(signature), nil
}

func (s *Signer) Close() error {
	if s == nil || s.signerCore == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	if s.lock != nil {
		err := s.lock.Close() // Closing releases the OS advisory lock, including on crash.
		s.lock = nil
		return err
	}
	return nil
}

func writeSignerState(path string, state signerState, create bool) error {
	b, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if len(b) > maxSignerStateBytes {
		return errors.New("consensus signer state exceeds bound")
	}
	var f *os.File
	if create {
		f, err = os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	} else {
		f, err = os.CreateTemp(filepath.Dir(path), ".ynx-consensus-sign-*")
	}
	if err != nil {
		return err
	}
	tmp := f.Name()
	if !create {
		defer os.Remove(tmp)
	}
	_, writeErr := f.Write(b)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		if create {
			return fmt.Errorf("%w: %v", ErrSignerDurabilityUncertain, err)
		}
		return err
	}
	if !create {
		if err := os.Rename(tmp, path); err != nil {
			return err
		}
	}
	dir, err := os.Open(filepath.Dir(path))
	if err == nil {
		err = errors.Join(dir.Sync(), dir.Close())
	}
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSignerDurabilityUncertain, err)
	}
	return nil
}
