package ynxconsensusauth

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"math"
	"path/filepath"
	"sync"
	"unicode/utf8"

	"golang.org/x/crypto/pbkdf2"
)

const (
	MaxHostKeyEnvelopeBytes = 32 << 10
	hostKeyBindingDomain    = "YNX-CONSENSUS-HOST-KEY-BINDING/v1\x00"
	hostKeyEnvelopeDomain   = "YNX-CONSENSUS-HOST-KEY-ENVELOPE/v1\x00"
	hostKeyPrivateDomain    = "YNX-CONSENSUS-HOST-KEY-PRIVATE/v1\x00"
	hostKeyKDF              = "PBKDF2-HMAC-SHA256"
	hostKeyIterations       = 600000
	hostKeyCipher           = "AES-256-GCM"
)

// HostKeyBinding is independently configured validator identity. It is never
// taken from an untrusted envelope preview. The original absolute HRS path is
// authenticated too: moving a key does not authorize a new or reset history.
type HostKeyBinding struct {
	Policy                                    Policy
	ValidatorAddress                          []byte
	Epoch                                     uint64
	MLDSA87PublicKey, SLHDSASHA2256fPublicKey []byte
	SignerStatePath                           string
}

func (b HostKeyBinding) Validate() error {
	if b.Policy.Version != ConsensusGenesisVersion || b.Policy.ActivationHeight <= 0 || b.Epoch == 0 || len(b.ValidatorAddress) != validatorAddressSize || len(b.MLDSA87PublicKey) != MLDSA87PublicKeySize || len(b.SLHDSASHA2256fPublicKey) != SLHDSASHA2256fPublicKeySize {
		return errors.New("invalid complete host validator binding")
	}
	if err := (RegistryAnchor{GenesisID: b.Policy.GenesisID, ChainID: b.Policy.ChainID}).validate(); err != nil {
		return err
	}
	if len(b.SignerStatePath) == 0 || len(b.SignerStatePath) > 4096 || !utf8.ValidString(b.SignerStatePath) || bytes.IndexByte([]byte(b.SignerStatePath), 0) >= 0 || !filepath.IsAbs(b.SignerStatePath) || filepath.Clean(b.SignerStatePath) != b.SignerStatePath {
		return errors.New("host custody requires original canonical absolute signer state path")
	}
	return nil
}

func (b HostKeyBinding) wire() ([]byte, error) {
	if err := b.Validate(); err != nil {
		return nil, err
	}
	f := [][]byte{[]byte(hostKeyBindingDomain), regU32(1), regU32(b.Policy.Version), b.Policy.GenesisID, []byte(b.Policy.ChainID), b.ValidatorAddress}
	f = append(f, regPair(b.Epoch)...)
	f = append(f, regPair(uint64(b.Policy.ActivationHeight))...)
	f = append(f, b.MLDSA87PublicKey, b.SLHDSASHA2256fPublicKey, []byte(b.SignerStatePath))
	return regEncode(MaxHostKeyEnvelopeBytes, f...)
}

func decodeHostBinding(wire []byte) (HostKeyBinding, error) {
	var b HostKeyBinding
	f, err := regDecode(wire, 13, MaxHostKeyEnvelopeBytes)
	if err != nil {
		return b, err
	}
	if string(f[0]) != hostKeyBindingDomain || !bytes.Equal(f[1], regU32(1)) || !bytes.Equal(f[2], regU32(ConsensusGenesisVersion)) {
		return b, errors.New("unsupported host binding domain/version")
	}
	epoch, err := regReadPair(f[6], f[7])
	if err != nil {
		return b, err
	}
	active, err := regReadPair(f[8], f[9])
	if err != nil || active > math.MaxInt64 {
		return b, errors.New("invalid host binding activation")
	}
	b = HostKeyBinding{Policy: Policy{Version: ConsensusGenesisVersion, GenesisID: f[3], ChainID: string(f[4]), ActivationHeight: int64(active)}, ValidatorAddress: f[5], Epoch: epoch, MLDSA87PublicKey: f[10], SLHDSASHA2256fPublicKey: f[11], SignerStatePath: string(f[12])}
	return b, b.Validate()
}

// GenerateHostRecoveryCredential creates the existing SDK profile's independent
// 256-bit credential. It is not a password/mnemonic and must be stored separately.
func GenerateHostRecoveryCredential() ([]byte, error) {
	out := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, out); err != nil {
		clear(out)
		return nil, err
	}
	return out, nil
}

func hostAEAD(credential, salt []byte) (cipher.AEAD, error) {
	if len(credential) != 32 || len(salt) != 32 {
		return nil, errors.New("host custody requires exact 32-byte credential and salt")
	}
	password := bytes.Clone(credential)
	defer clear(password)
	key := pbkdf2.Key(password, salt, hostKeyIterations, 32, sha256.New)
	defer clear(key)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// SealHostKeyEnvelope encrypts new validator-owned material with the already
// specified SDK KDF/AEAD parameters. The envelope domain/binding is validator
// specific; Wallet backups are not accepted. No file or signing state is written.
func SealHostKeyEnvelope(material CandidateKeyMaterial, binding HostKeyBinding, credential []byte) ([]byte, error) {
	if len(credential) != 32 {
		return nil, errors.New("host recovery credential must be raw 32 bytes")
	}
	bindingWire, err := binding.wire()
	if err != nil {
		return nil, err
	}
	// Copy the protected caller's plaintext once, before derivation or KDF work.
	if material.Format != CandidateKeyMaterialFormat || material.AlgorithmVersion != CandidateKeyMaterialAlgorithm || material.Suite != CandidateKeyMaterialSuite || len(material.PKCS8A) != CandidatePKCS8ASize || len(material.PKCS8B) != CandidatePKCS8BSize || len(material.PublicA) != MLDSA87PublicKeySize || len(material.PublicB) != SLHDSASHA2256fPublicKeySize {
		return nil, errors.New("invalid host key material profile or sizes")
	}
	owned := material
	owned.PKCS8A, owned.PKCS8B = bytes.Clone(material.PKCS8A), bytes.Clone(material.PKCS8B)
	owned.PublicA, owned.PublicB = bytes.Clone(material.PublicA), bytes.Clone(material.PublicB)
	defer owned.Clear()
	fixed, err := decodeHostBinding(bindingWire)
	if err != nil {
		return nil, err
	}
	key, err := ImportCandidateKeyMaterial(owned, fixed.MLDSA87PublicKey, fixed.SLHDSASHA2256fPublicKey)
	if err != nil {
		return nil, err
	}
	key.Destroy()
	plaintext, err := regEncode(MaxHostKeyEnvelopeBytes, []byte(hostKeyPrivateDomain), regU32(1), bindingWire, owned.PKCS8A, owned.PKCS8B)
	if err != nil {
		return nil, err
	}
	defer clear(plaintext)
	salt, nonce := make([]byte, 32), make([]byte, 12)
	if _, err = io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	fields := [][]byte{[]byte(hostKeyEnvelopeDomain), regU32(1), bindingWire, []byte(hostKeyKDF), regU32(hostKeyIterations), salt, []byte(hostKeyCipher), nonce}
	aad, err := regEncode(MaxHostKeyEnvelopeBytes, fields...)
	if err != nil {
		return nil, err
	}
	aead, err := hostAEAD(credential, salt)
	if err != nil {
		return nil, err
	}
	ciphertext := aead.Seal(nil, nonce, plaintext, aad)
	return regEncode(MaxHostKeyEnvelopeBytes, append(fields, ciphertext)...)
}

// OpenHostKeyEnvelope checks the expected complete binding before KDF work,
// authenticates all metadata, and returns only a self-checked opaque key handle.
func OpenHostKeyEnvelope(wire, credential []byte, expected HostKeyBinding) (*CandidateKey, error) {
	if len(credential) != 32 {
		return nil, errors.New("host recovery credential must be raw 32 bytes")
	}
	want, err := expected.wire()
	if err != nil {
		return nil, err
	}
	f, err := regDecode(wire, 9, MaxHostKeyEnvelopeBytes)
	if err != nil {
		return nil, err
	}
	if string(f[0]) != hostKeyEnvelopeDomain || !bytes.Equal(f[1], regU32(1)) || !bytes.Equal(f[2], want) || string(f[3]) != hostKeyKDF || !bytes.Equal(f[4], regU32(hostKeyIterations)) || len(f[5]) != 32 || string(f[6]) != hostKeyCipher || len(f[7]) != 12 || len(f[8]) < 16 {
		return nil, errors.New("host key envelope profile or independently expected binding mismatch")
	}
	fixed, err := decodeHostBinding(want)
	if err != nil {
		return nil, err
	}
	aad, err := regEncode(MaxHostKeyEnvelopeBytes, f[:8]...)
	if err != nil {
		return nil, err
	}
	aead, err := hostAEAD(credential, f[5])
	if err != nil {
		return nil, err
	}
	plaintext, err := aead.Open(nil, f[7], f[8], aad)
	if err != nil {
		return nil, errors.New("host key envelope authentication failed")
	}
	defer clear(plaintext)
	private, err := hostPrivateFields(plaintext)
	if err != nil {
		return nil, err
	}
	if string(private[0]) != hostKeyPrivateDomain || !bytes.Equal(private[1], regU32(1)) || !bytes.Equal(private[2], want) || len(private[3]) != CandidatePKCS8ASize || len(private[4]) != CandidatePKCS8BSize {
		return nil, errors.New("invalid complete host private material")
	}
	material := CandidateKeyMaterial{Format: CandidateKeyMaterialFormat, AlgorithmVersion: CandidateKeyMaterialAlgorithm, Suite: CandidateKeyMaterialSuite, PKCS8A: private[3], PKCS8B: private[4], PublicA: fixed.MLDSA87PublicKey, PublicB: fixed.SLHDSASHA2256fPublicKey}
	return ImportCandidateKeyMaterial(material, fixed.MLDSA87PublicKey, fixed.SLHDSASHA2256fPublicKey)
}

// Views borrow the one decrypted buffer so every error path is covered by its
// caller's clear(plaintext), including malformed later length fields.
func hostPrivateFields(wire []byte) ([5][]byte, error) {
	var fields [5][]byte
	if len(wire) > MaxHostKeyEnvelopeBytes {
		return fields, errors.New("host plaintext exceeds bound")
	}
	for i := range fields {
		if len(wire) < 4 {
			return fields, errors.New("truncated host private frame")
		}
		n := uint64(binary.BigEndian.Uint32(wire[:4]))
		wire = wire[4:]
		if n > uint64(len(wire)) {
			return fields, errors.New("truncated host private field")
		}
		fields[i] = wire[:int(n)]
		wire = wire[int(n):]
	}
	if len(wire) != 0 {
		return fields, errors.New("trailing host private fields")
	}
	return fields, nil
}

// HostSigner owns an imported key and the original resumed signer. Value copies
// share closure; no caller receives a generic/raw signing capability.
type HostSigner struct{ core *hostSignerCore }
type hostSignerCore struct {
	mu     sync.Mutex
	signer *Signer
	key    *CandidateKey
	closed bool
}

func (h *HostSigner) Signer() (*Signer, error) {
	if h == nil || h.core == nil {
		return nil, errors.New("missing host signer")
	}
	c := h.core
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, errors.New("closed host signer")
	}
	if _, err := c.signer.Identity(); err != nil {
		return nil, err
	}
	return c.signer, nil
}

func (h *HostSigner) Close() error {
	if h == nil || h.core == nil {
		return nil
	}
	c := h.core
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	err := c.signer.Close()
	c.key.Destroy()
	return err
}

func hostIdentityMatches(st signerState, b HostKeyBinding) bool {
	return st.Version == signerStateVersion && st.Policy.Version == b.Policy.Version && st.Policy.ChainID == b.Policy.ChainID && st.Policy.ActivationHeight == b.Policy.ActivationHeight && bytes.Equal(st.Policy.GenesisID, b.Policy.GenesisID) && bytes.Equal(st.Address, b.ValidatorAddress) && st.Epoch == b.Epoch && bytes.Equal(st.PublicA, b.MLDSA87PublicKey) && bytes.Equal(st.PublicB, b.SLHDSASHA2256fPublicKey)
}

// preflightHostHistory is read-only. Wrong expected policy/epoch/path/key must
// fail before the shared signer recovery can reconfirm a file's durability. The
// same expectation and canonical encoding are rechecked under the original OS
// lock before any write; this early check is only a bounded rejection shortcut.
func preflightHostHistory(expected HostKeyBinding) error {
	f, err := openSignerState(expected.SignerStatePath)
	if err != nil {
		return err
	}
	wire, readErr := io.ReadAll(io.LimitReader(f, maxSignerStateBytes+1))
	err = errors.Join(readErr, f.Close())
	if err != nil {
		return err
	}
	if len(wire) > maxSignerStateBytes {
		return errors.New("original signer history exceeds limit")
	}
	var st signerState
	d := json.NewDecoder(bytes.NewReader(wire))
	d.DisallowUnknownFields()
	if err = d.Decode(&st); err != nil {
		return errors.New("invalid original signer history encoding")
	}
	var tail any
	if d.Decode(&tail) != io.EOF || !hostIdentityMatches(st, expected) {
		return errors.New("original signer history differs from expected complete host identity")
	}
	canonical, err := json.Marshal(st)
	if err != nil || !bytes.Equal(canonical, wire) {
		return errors.New("original signer history is not its exact canonical encoding")
	}
	return nil
}

// ResumeHostSigner reads an existing 0600 single-link regular encrypted file and
// ONLY resumes the original existing HRS. It never calls CreateSigner, generates
// replacement keys, retries UNKNOWN under new bytes, or writes a vault file.
func ResumeHostSigner(vaultPath string, credential []byte, expected HostKeyBinding, registry Registry) (*HostSigner, error) {
	if len(credential) != 32 {
		return nil, errors.New("host recovery credential must be raw 32 bytes")
	}
	bindingWire, err := expected.wire()
	if err != nil {
		return nil, err
	}
	// Keep a detached expectation throughout slow key derivation and recovery.
	expected, err = decodeHostBinding(bindingWire)
	if err != nil {
		return nil, err
	}
	if registry == nil {
		return nil, errors.New("host signer requires independent committed registry")
	}
	if err := validatePolicyAnchor(expected.Policy, registry.Anchor()); err != nil {
		return nil, err
	}
	if err := preflightHostHistory(expected); err != nil {
		return nil, err
	}
	f, err := openSignerState(vaultPath)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || info.Mode().Perm() != 0600 || info.Size() > MaxHostKeyEnvelopeBytes {
		f.Close()
		return nil, errors.New("host key envelope requires bounded 0600 regular file")
	}
	wire, readErr := io.ReadAll(io.LimitReader(f, MaxHostKeyEnvelopeBytes+1))
	err = errors.Join(readErr, f.Close())
	if err != nil {
		return nil, err
	}
	key, err := OpenHostKeyEnvelope(wire, credential, expected)
	if err != nil {
		return nil, err
	}
	identityExpectation := SignerIdentity{Policy: expected.Policy, ValidatorAddress: expected.ValidatorAddress, Epoch: expected.Epoch, MLDSA87PublicKey: expected.MLDSA87PublicKey, SLHDSASHA2256fPublicKey: expected.SLHDSASHA2256fPublicKey}
	signer, err := resumeSigner(expected.SignerStatePath, key, registry, &identityExpectation)
	if err != nil {
		key.Destroy()
		return nil, err
	}
	identity, err := signer.Identity()
	if err != nil || identity.Policy.Version != expected.Policy.Version || identity.Policy.ActivationHeight != expected.Policy.ActivationHeight || identity.Policy.ChainID != expected.Policy.ChainID || !bytes.Equal(identity.Policy.GenesisID, expected.Policy.GenesisID) || identity.Epoch != expected.Epoch || !bytes.Equal(identity.ValidatorAddress, expected.ValidatorAddress) || !bytes.Equal(identity.MLDSA87PublicKey, expected.MLDSA87PublicKey) || !bytes.Equal(identity.SLHDSASHA2256fPublicKey, expected.SLHDSASHA2256fPublicKey) {
		signer.Close()
		key.Destroy()
		return nil, errors.New("resumed host signer identity changed")
	}
	return &HostSigner{core: &hostSignerCore{signer: signer, key: key}}, nil
}
