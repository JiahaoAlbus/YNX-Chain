package consensus

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/pbkdf2"
)

const (
	PQLabNativeChainID      = int64(642399)
	MaxPQLabTransfers       = 1024
	PQLabWorkloadVersion    = "YNX-PQ-LOOPBACK-WORKLOAD/v1"
	MaxPQLabOwners          = 1000
	MaxPQLabOnlineTransfers = 10000
)

type PQLabWorkloadOptions struct {
	Transfers, BatchSize, Owners int
	Online                       bool
}

// Public originals and, only in online mode, transient independent synthetic
// material awaiting encrypted custody. WriteCorpus/Destroy clear those private
// copies. No caller can obtain a raw signing capability from this source.
type PQLabWorkloadSource struct {
	Migration chain.ConsensusMigrationState
	mu        sync.Mutex
	original  []byte
	manifest  PQLabWorkloadManifest
	files     map[string][]byte
	materials []ynxbatch.KeyMaterial
}

type PQLabWorkloadFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  string `json:"bytes"`
}

type PQLabWorkloadTransaction struct {
	OwnerIndex      int               `json:"ownerIndex"`
	Type            string            `json:"type"`
	Wire            PQLabWorkloadFile `json:"wire"`
	Envelope        PQLabWorkloadFile `json:"envelope"`
	NativeHash      string            `json:"nativeHash"`
	ABCIHash        string            `json:"abciHash"`
	FirstNonce      string            `json:"firstNonce"`
	Members         string            `json:"members"`
	AmountPerMember string            `json:"amountPerMember"`
	FeePerMember    string            `json:"feePerMember"`
}

type PQLabWorkloadManifest struct {
	Version                     string                     `json:"version"`
	SyntheticOnly               bool                       `json:"syntheticOnly"`
	NetworkStarted              bool                       `json:"networkStarted"`
	DeployedSourceQualification bool                       `json:"deployedSourceQualification"`
	AuthorityGranted            bool                       `json:"authorityGranted"`
	NativeChainID               string                     `json:"nativeChainId"`
	OriginalGenesisHash         string                     `json:"originalGenesisHash"`
	MigrationStateHash          string                     `json:"migrationStateHash"`
	SourceHeight                string                     `json:"sourceHeight"`
	Owner                       string                     `json:"owner"`
	Recipient                   string                     `json:"recipient"`
	InitialOwnerBalance         string                     `json:"initialOwnerBalance"`
	FinalOwnerBalance           string                     `json:"expectedFinalOwnerBalance"`
	FinalOwnerNonce             string                     `json:"expectedFinalOwnerNonce"`
	RecipientDelta              string                     `json:"expectedRecipientDelta"`
	Registration                PQLabWorkloadFile          `json:"sourceRegistration"`
	Policy                      PQLabWorkloadFile          `json:"sourcePolicy"`
	Transactions                []PQLabWorkloadTransaction `json:"transactions"`
	Mode                        string                     `json:"mode"`
	Owners                      []PQLabWorkloadOwner       `json:"owners"`
	OwnerCapacity               string                     `json:"ownerCapacity"`
	TotalMemberCapacity         string                     `json:"totalMemberCapacity"`
	BatchSize                   string                     `json:"batchSize"`
	OutstandingPerOwner         string                     `json:"outstandingPerOwner"`
	BatchWaitNanoseconds        string                     `json:"batchWaitNanoseconds"`
	// These must be rejected by normal CheckTx; they are never fund transfers.
	InvalidSignatureEnvelopes []PQLabWorkloadFile `json:"invalidSignatureEnvelopes"`
}

type PQLabWorkloadOwner struct {
	Index                int               `json:"index"`
	Owner                string            `json:"owner"`
	Recipient            string            `json:"recipient"`
	InitialBalance       string            `json:"initialBalance"`
	InitialNonce         string            `json:"initialNonce"`
	MemberCapacity       string            `json:"memberCapacity"`
	ExpectedFinalBalance string            `json:"expectedFinalBalance"`
	ExpectedFinalNonce   string            `json:"expectedFinalNonce"`
	Registration         PQLabWorkloadFile `json:"registration"`
}

func validatePQLabWorkloadOptions(o PQLabWorkloadOptions) (PQLabWorkloadOptions, error) {
	if o.Owners == 0 {
		o.Owners = 1
	}
	if o.Owners < 1 || o.Owners > MaxPQLabOwners || o.Transfers < 1 || o.Transfers > MaxPQLabTransfers || o.BatchSize < 1 || o.BatchSize > 1024 || o.BatchSize > o.Transfers || o.BatchSize&(o.BatchSize-1) != 0 {
		return o, errors.New("bounded independent owners/transfers and power-of-two batch size required")
	}
	limit := MaxPQLabTransfers
	if o.Online {
		limit = MaxPQLabOnlineTransfers
	}
	if o.Owners*o.Transfers > limit {
		return o, errors.New("aggregate operation capacity exceeded; no unbounded corpus or signing queue")
	}
	return o, nil
}

func pqLabFile(name string, raw []byte) PQLabWorkloadFile {
	h := sha256.Sum256(raw)
	return PQLabWorkloadFile{name, hex.EncodeToString(h[:]), strconv.Itoa(len(raw))}
}

// NewPQLabWorkloadSource uses the REAL native ledger to create a complete source
// migration. Classic approval and dual new-key possession are admitted at H=2,
// then mined before cutover. They are not claimed to have run on the future BFT
// network. Corpus transfers start at nonce 2 and require that exact source.
func NewPQLabWorkloadSource(o PQLabWorkloadOptions) (*PQLabWorkloadSource, error) {
	var err error
	o, err = validatePQLabWorkloadOptions(o)
	if err != nil {
		return nil, err
	}
	if o.Owners > 1 || o.Online {
		return newPQLabMultiOwnerSource(o)
	}
	if o.Transfers < 1 || o.Transfers > MaxPQLabTransfers || o.BatchSize < 1 || o.BatchSize > 1024 || o.BatchSize > o.Transfers || o.BatchSize&(o.BatchSize-1) != 0 {
		return nil, errors.New("bounded positive lab transfer count and batch size required")
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	config := chain.DefaultNetworkConfig("devnet")
	config.Name, config.Slug, config.ChainID = "Synthetic PQ loopback lab", "pq-lab-"+hex.EncodeToString(id[:]), PQLabNativeChainID
	config.IsPublicNet, config.ChainIDConflictCheck = false, "synthetic isolated loopback only; no public network allocation"
	validators := make([]chain.Validator, 4)
	for i := range validators {
		validators[i] = chain.Validator{Address: fmt.Sprintf("ynx_validator_pq_lab_%d", i), Moniker: fmt.Sprintf("pq-lab-%d", i), Active: true, VotingPower: 1}
	}
	d := chain.NewDevnetWithValidators(config, validators)
	classic, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		return nil, err
	}
	defer classic.Zero()
	receiver, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		return nil, err
	}
	defer receiver.Zero()
	owner, err := NativeAddress(classic.PubKey().SerializeCompressed())
	if err != nil {
		return nil, err
	}
	recipient, err := NativeAddress(receiver.PubKey().SerializeCompressed())
	if err != nil {
		return nil, err
	}
	funds := int64(2*o.Transfers + 2)
	if _, err = d.Faucet(owner, funds); err != nil {
		return nil, err
	}
	d.ProduceBlock()
	if err = d.EnableAccountPQ(2); err != nil {
		return nil, err
	}
	before, err := d.ExportConsensusMigrationState()
	if err != nil {
		return nil, err
	}
	network, err := hex.DecodeString(before.OriginalGenesisHash)
	if err != nil || len(network) != 32 {
		return nil, errors.New("synthetic original genesis unavailable")
	}
	key, pub, err := ynxbatch.KeyGen()
	if err != nil {
		return nil, err
	}
	defer key.Destroy()
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owner, PKA: pub.PKA, PKB: pub.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 3}
	message, err := intent.SigningBytes()
	if err != nil {
		return nil, err
	}
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.MigrationPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, err
	}
	pop, err := batch.WholeWire()
	batch.Discard()
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(message)
	registration := ynxauth.Migration{Intent: intent, NewKeyProof: pop, ClassicPublicKey: classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classic, digest[:]).Serialize()}
	wire, err := registration.Encode()
	if err != nil {
		return nil, err
	}
	if _, replay, err := d.SubmitAccountMigration(wire); err != nil || replay {
		return nil, fmt.Errorf("synthetic original account migration admission: %w", err)
	}
	d.ProduceBlock()
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		return nil, err
	}
	if err = migration.Validate(); err != nil {
		return nil, err
	}
	if err = validateMigrationExecutionClosure(migration); err != nil {
		return nil, err
	}
	original, err := migration.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	s := &PQLabWorkloadSource{Migration: migration, original: original, files: map[string][]byte{}}
	add := func(name string, raw []byte) PQLabWorkloadFile {
		s.files[name] = bytes.Clone(raw)
		return pqLabFile(name, raw)
	}
	policy, err := json.Marshal(migration.AccountPolicy)
	if err != nil {
		return nil, err
	}
	s.manifest = PQLabWorkloadManifest{Version: PQLabWorkloadVersion, SyntheticOnly: true, NativeChainID: strconv.FormatInt(config.ChainID, 10), OriginalGenesisHash: migration.OriginalGenesisHash, SourceHeight: strconv.FormatUint(migration.Height, 10), Owner: owner, Recipient: recipient, InitialOwnerBalance: strconv.FormatInt(funds-1, 10), FinalOwnerBalance: "1", FinalOwnerNonce: strconv.Itoa(o.Transfers + 1), RecipientDelta: strconv.Itoa(o.Transfers), Registration: add("account-migration.wire", wire), Policy: add("account-policy.json", policy)}
	s.manifest.Mode = "pre-signed"
	s.manifest.OwnerCapacity = "1"
	s.manifest.TotalMemberCapacity = strconv.Itoa(o.Transfers)
	s.manifest.BatchSize = strconv.Itoa(o.BatchSize)
	s.manifest.OutstandingPerOwner = "1"
	s.manifest.BatchWaitNanoseconds = "0"
	s.manifest.Owners = []PQLabWorkloadOwner{{Index: 0, Owner: owner, Recipient: recipient, InitialBalance: s.manifest.InitialOwnerBalance, InitialNonce: "1", MemberCapacity: strconv.Itoa(o.Transfers), ExpectedFinalBalance: "1", ExpectedFinalNonce: strconv.Itoa(o.Transfers + 1), Registration: s.manifest.Registration}}
	for first := 0; first < o.Transfers; {
		count := min(o.BatchSize, o.Transfers-first)
		// v0.1 admits only power-of-two N. Split the final remainder into
		// existing legal batches; never pad by inventing another transfer.
		for count&(count-1) != 0 {
			count &= count - 1
		}
		messages := make([][]byte, count)
		for j := range messages {
			messages[j], err = (ynxauth.Transfer{ChainID: network, NativeChainID: uint64(config.ChainID), From: owner, To: recipient, Amount: 1, Fee: 1, Nonce: uint64(first + j + 2)}).SigningBytes()
			if err != nil {
				return nil, err
			}
		}
		b, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
		if err != nil {
			return nil, err
		}
		kind := PQWholeType
		wire, err := b.WholeWire()
		member, extractErr := ynxbatch.Extract(b, 0)
		b.Discard()
		if err != nil {
			return nil, err
		}
		if extractErr != nil {
			return nil, extractErr
		}
		if count == 1 {
			kind = PQTransferType
			wire, err = ynxbatch.EncodeMember(member)
			if err != nil {
				return nil, err
			}
		}
		v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: network, Purpose: ynxauth.TransactionPurpose, Optimized: true, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
			return migration.AccountPolicy.TrustedRegistration(req.Owner, req.Purpose, req.Height)
		}})
		if err != nil {
			return nil, err
		}
		if count == 1 {
			err = v.VerifyOne(wire, migration.Height+1)
		} else {
			err = v.VerifyWhole(wire, migration.Height+1)
		}
		if err != nil {
			return nil, fmt.Errorf("generated original AND verification: %w", err)
		}
		envelope, err := EncodePQTransaction(kind, wire)
		if err != nil {
			return nil, err
		}
		prefix := fmt.Sprintf("transaction-%04d", len(s.manifest.Transactions))
		s.manifest.Transactions = append(s.manifest.Transactions, PQLabWorkloadTransaction{Type: kind, Wire: add(prefix+".wire", wire), Envelope: add(prefix+".abci", envelope), NativeHash: SignedTransactionHash(wire), ABCIHash: SignedTransactionHash(envelope), FirstNonce: strconv.Itoa(first + 2), Members: strconv.Itoa(count), AmountPerMember: "1", FeePerMember: "1"})
		if first == 0 {
			for branch := 0; branch < 2; branch++ {
				bad := member
				bad.Certificate.SigmaA, bad.Certificate.SigmaB = bytes.Clone(member.Certificate.SigmaA), bytes.Clone(member.Certificate.SigmaB)
				if branch == 0 {
					bad.Certificate.SigmaA[0] ^= 1
				} else {
					bad.Certificate.SigmaB[0] ^= 1
				}
				badWire, e := ynxbatch.EncodeMember(bad)
				if e != nil {
					return nil, e
				}
				if e = v.VerifyOne(badWire, migration.Height+1); e == nil {
					return nil, errors.New("corrupt independent signature unexpectedly verified")
				}
				badEnvelope, e := EncodePQTransaction(PQTransferType, badWire)
				if e != nil {
					return nil, e
				}
				s.manifest.InvalidSignatureEnvelopes = append(s.manifest.InvalidSignatureEnvelopes, add(fmt.Sprintf("invalid-signature-%d.abci", branch), badEnvelope))
			}
		}
		first += count
	}
	return s, nil
}

func newPQLabMultiOwnerSource(o PQLabWorkloadOptions) (*PQLabWorkloadSource, error) {
	var slug [16]byte
	if _, err := rand.Read(slug[:]); err != nil {
		return nil, err
	}
	cfg := chain.DefaultNetworkConfig("devnet")
	cfg.ChainID = PQLabNativeChainID
	cfg.Slug = "pq-lab-" + hex.EncodeToString(slug[:])
	cfg.Name = "Synthetic independent-owner PQ lab"
	cfg.IsPublicNet = false
	cfg.ChainIDConflictCheck = "synthetic loopback only"
	validators := make([]chain.Validator, 4)
	for i := range validators {
		validators[i] = chain.Validator{Address: fmt.Sprintf("ynx_validator_pq_lab_%d", i), Moniker: fmt.Sprintf("pq-lab-%d", i), Active: true, VotingPower: 1}
	}
	d := chain.NewDevnetWithValidators(cfg, validators)
	classics := make([]*secp256k1.PrivateKey, o.Owners)
	keys := make([]*ynxbatch.PrivateKey, o.Owners)
	pubs := make([]ynxbatch.PublicKey, o.Owners)
	owners := make([]PQLabWorkloadOwner, o.Owners)
	defer func() {
		for _, k := range classics {
			if k != nil {
				k.Zero()
			}
		}
		for _, k := range keys {
			if k != nil {
				k.Destroy()
			}
		}
	}()
	for i := range owners {
		classic, err := secp256k1.GeneratePrivateKey()
		if err != nil {
			return nil, err
		}
		classics[i] = classic
		owner, err := NativeAddress(classic.PubKey().SerializeCompressed())
		if err != nil {
			return nil, err
		}
		receiver, err := secp256k1.GeneratePrivateKey()
		if err != nil {
			return nil, err
		}
		recipient, err := NativeAddress(receiver.PubKey().SerializeCompressed())
		receiver.Zero()
		if err != nil {
			return nil, err
		}
		key, pub, err := ynxbatch.KeyGen()
		if err != nil {
			return nil, err
		}
		keys[i], pubs[i] = key, pub
		funds := int64(2*o.Transfers + 2)
		if _, err = d.Faucet(owner, funds); err != nil {
			return nil, err
		}
		owners[i] = PQLabWorkloadOwner{Index: i, Owner: owner, Recipient: recipient, InitialBalance: strconv.FormatInt(funds-1, 10), InitialNonce: "1", MemberCapacity: strconv.Itoa(o.Transfers), ExpectedFinalBalance: "1", ExpectedFinalNonce: strconv.Itoa(o.Transfers + 1)}
	}
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		return nil, err
	}
	before, err := d.ExportConsensusMigrationState()
	if err != nil {
		return nil, err
	}
	network, err := hex.DecodeString(before.OriginalGenesisHash)
	if err != nil {
		return nil, err
	}
	s := &PQLabWorkloadSource{files: map[string][]byte{}}
	complete := false
	defer func() {
		if !complete {
			s.Destroy()
		}
	}()
	add := func(name string, raw []byte) PQLabWorkloadFile {
		s.files[name] = bytes.Clone(raw)
		return pqLabFile(name, raw)
	}
	for i := range owners {
		intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owners[i].Owner, PKA: pubs[i].PKA, PKB: pubs[i].PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 3}
		message, err := intent.SigningBytes()
		if err != nil {
			return nil, err
		}
		b, err := ynxbatch.BatchSign(keys[i], ynxbatch.Metadata{ChainID: network, Owner: owners[i].Owner, Purpose: ynxauth.MigrationPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
		if err != nil {
			return nil, err
		}
		pop, err := b.WholeWire()
		b.Discard()
		if err != nil {
			return nil, err
		}
		h := sha256.Sum256(message)
		registration := ynxauth.Migration{Intent: intent, NewKeyProof: pop, ClassicPublicKey: classics[i].PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classics[i], h[:]).Serialize()}
		wire, err := registration.Encode()
		if err != nil {
			return nil, err
		}
		if _, replay, err := d.SubmitAccountMigration(wire); err != nil || replay {
			return nil, errors.New("fresh independent account migration did not admit")
		}
		owners[i].Registration = add(fmt.Sprintf("account-%04d-migration.wire", i), wire)
	}
	d.ProduceBlock()
	d.ProduceBlock()
	s.Migration, err = d.ExportConsensusMigrationState()
	if err != nil {
		return nil, err
	}
	if err = validateMigrationExecutionClosure(s.Migration); err != nil {
		return nil, err
	}
	s.original, err = s.Migration.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	policy, err := json.Marshal(s.Migration.AccountPolicy)
	if err != nil {
		return nil, err
	}
	mode := "pre-signed"
	if o.Online {
		mode = "online"
	}
	s.manifest = PQLabWorkloadManifest{Version: PQLabWorkloadVersion, SyntheticOnly: true, Mode: mode, NativeChainID: strconv.FormatInt(PQLabNativeChainID, 10), OriginalGenesisHash: s.Migration.OriginalGenesisHash, SourceHeight: strconv.FormatUint(s.Migration.Height, 10), Owner: owners[0].Owner, Recipient: owners[0].Recipient, InitialOwnerBalance: owners[0].InitialBalance, FinalOwnerBalance: "1", FinalOwnerNonce: owners[0].ExpectedFinalNonce, RecipientDelta: strconv.Itoa(o.Transfers), Registration: owners[0].Registration, Policy: add("account-policy.json", policy), Owners: owners, OwnerCapacity: strconv.Itoa(o.Owners), TotalMemberCapacity: strconv.Itoa(o.Owners * o.Transfers), BatchSize: strconv.Itoa(o.BatchSize), OutstandingPerOwner: "1", BatchWaitNanoseconds: "0"}
	for i, owner := range owners {
		if o.Online {
			material, err := ynxbatch.ExportKeyMaterial(keys[i])
			if err != nil {
				return nil, err
			}
			s.materials = append(s.materials, material)
			continue
		}
		for first := 0; first < o.Transfers; {
			count := min(o.BatchSize, o.Transfers-first)
			for count&(count-1) != 0 {
				count &= count - 1
			}
			kind, wire, envelope, err := pqLabSignTransferGroup(keys[i], s.Migration.AccountPolicy, owner, uint64(first+2), count, s.Migration.Height+1)
			if err != nil {
				return nil, err
			}
			prefix := fmt.Sprintf("transaction-%04d", len(s.manifest.Transactions))
			s.manifest.Transactions = append(s.manifest.Transactions, PQLabWorkloadTransaction{OwnerIndex: i, Type: kind, Wire: add(prefix+".wire", wire), Envelope: add(prefix+".abci", envelope), NativeHash: SignedTransactionHash(wire), ABCIHash: SignedTransactionHash(envelope), FirstNonce: strconv.Itoa(first + 2), Members: strconv.Itoa(count), AmountPerMember: "1", FeePerMember: "1"})
			first += count
		}
	}
	complete = true
	return s, nil
}

// Destroy clears only still-owned plaintext copies. Already-created vaults,
// credentials, original operations and UNKNOWN results are never removed.
func (s *PQLabWorkloadSource) Destroy() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.materials {
		s.materials[i].Clear()
	}
	s.materials = nil
}

func pqLabSignTransferGroup(key *ynxbatch.PrivateKey, policy *ynxauth.State, owner PQLabWorkloadOwner, first uint64, count int, height uint64) (string, []byte, []byte, error) {
	if policy == nil || count < 1 || count > 1024 || count&(count-1) != 0 || first == 0 || first > ^uint64(0)-uint64(count) {
		return "", nil, nil, errors.New("invalid original lab transfer group")
	}
	messages := make([][]byte, count)
	for j := range messages {
		var err error
		messages[j], err = (ynxauth.Transfer{ChainID: policy.NetworkID, NativeChainID: uint64(PQLabNativeChainID), From: owner.Owner, To: owner.Recipient, Amount: 1, Fee: 1, Nonce: first + uint64(j)}).SigningBytes()
		if err != nil {
			return "", nil, nil, err
		}
	}
	b, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: policy.NetworkID, Owner: owner.Owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return "", nil, nil, err
	}
	defer b.Discard()
	kind := PQWholeType
	wire, err := b.WholeWire()
	if err != nil {
		return "", nil, nil, err
	}
	if count == 1 {
		kind = PQTransferType
		member, e := ynxbatch.Extract(b, 0)
		if e != nil {
			return "", nil, nil, e
		}
		wire, err = ynxbatch.EncodeMember(member)
		if err != nil {
			return "", nil, nil, err
		}
	}
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: policy.NetworkID, Purpose: ynxauth.TransactionPurpose, Optimized: true, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		return policy.TrustedRegistration(req.Owner, req.Purpose, req.Height)
	}})
	if err != nil {
		return "", nil, nil, err
	}
	if count == 1 {
		err = v.VerifyOne(wire, height)
	} else {
		err = v.VerifyWhole(wire, height)
	}
	if err != nil {
		return "", nil, nil, err
	}
	envelope, err := EncodePQTransaction(kind, wire)
	return kind, wire, envelope, err
}

// WriteCorpus accepts only validator-key binding of this exact original source.
// It never regenerates a transaction into an existing/UNKNOWN directory.
func (s *PQLabWorkloadSource) WriteCorpus(directory string, bound chain.ConsensusMigrationState) (PQLabWorkloadManifest, error) {
	if s == nil {
		return PQLabWorkloadManifest{}, errors.New("missing synthetic workload source")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	defer func() {
		for i := range s.materials {
			s.materials[i].Clear()
		}
		s.materials = nil
	}()
	if len(s.original) == 0 || len(s.files) == 0 {
		return PQLabWorkloadManifest{}, errors.New("unknown workload source")
	}
	if err := bound.Validate(); err != nil {
		return PQLabWorkloadManifest{}, err
	}
	if err := bound.ValidateConsensusValidatorKeys(); err != nil {
		return PQLabWorkloadManifest{}, err
	}
	var original chain.ConsensusMigrationState
	if err := json.Unmarshal(s.original, &original); err != nil {
		return PQLabWorkloadManifest{}, err
	}
	bindings := make([]chain.ConsensusValidatorKeyBinding, len(bound.Validators))
	for i, v := range bound.Validators {
		bindings[i] = chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: v.ConsensusKeyType, PublicKey: v.ConsensusPubKey, ConsensusAddress: v.ConsensusAddress}
	}
	expected, err := original.BindConsensusValidatorKeys(bindings)
	if err != nil {
		return PQLabWorkloadManifest{}, err
	}
	a, err := expected.CanonicalJSON()
	if err != nil {
		return PQLabWorkloadManifest{}, err
	}
	b, err := bound.CanonicalJSON()
	if err != nil || !bytes.Equal(a, b) {
		return PQLabWorkloadManifest{}, errors.New("workload bound migration changed original accounts, authority or history")
	}
	if err = pqLabFreshDirectory(directory); err != nil {
		return PQLabWorkloadManifest{}, err
	}
	for name, raw := range s.files {
		if err = pqLabWriteExclusive(filepath.Join(directory, name), raw); err != nil {
			return PQLabWorkloadManifest{}, err
		}
	}
	manifest := s.manifest
	manifest.MigrationStateHash = bound.StateHash
	raw, err := json.Marshal(manifest)
	if err != nil {
		return PQLabWorkloadManifest{}, err
	}
	if manifest.Mode == "online" {
		if err = writePQLabSenderVault(directory, manifest, raw, s.materials); err != nil {
			return PQLabWorkloadManifest{}, err
		}
	}
	if err = pqLabWriteExclusive(filepath.Join(directory, "PUBLIC-WORKLOAD.json"), raw); err != nil {
		return PQLabWorkloadManifest{}, err
	}
	// Return a detached public view, including every slice.
	var detached PQLabWorkloadManifest
	err = json.Unmarshal(raw, &detached)
	return detached, err
}

func pqLabFreshDirectory(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("canonical absolute fresh lab directory required")
	}
	parent := filepath.Dir(path)
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil || resolved != parent {
		return errors.New("lab parent aliases or missing parent refused")
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 {
		return errors.New("lab parent must not be writable by others")
	}
	return os.Mkdir(path, 0700)
}

func pqLabWriteExclusive(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = errors.New("incomplete lab original write")
	}
	if writeErr == nil {
		writeErr = f.Sync()
	}
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	return errors.Join(d.Sync(), d.Close())
}

const pqLabSenderVaultDomain = "YNX-SYNTHETIC-LAB-TX-CUSTODY/v1"
const pqLabSenderKDF = "PBKDF2-HMAC-SHA256/600000/AES-256-GCM"

// The KDF/AEAD parameters are exactly the existing host_key_vault.go profile.
// This distinct LOCAL synthetic custody binding is not a new TX signature domain
// or a Wallet backup. The adjacent test credential is not real Keychain custody.
func pqLabSenderAEAD(credential, salt []byte) (cipher.AEAD, error) {
	if len(credential) != 32 || len(salt) != 32 {
		return nil, errors.New("exact inherited lab credential and salt required")
	}
	derived := pbkdf2.Key(credential, salt, 600000, 32, sha256.New)
	defer clear(derived)
	block, err := aes.NewCipher(derived)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func writePQLabSenderVault(directory string, m PQLabWorkloadManifest, manifestRaw []byte, materials []ynxbatch.KeyMaterial) error {
	if len(materials) != len(m.Owners) || len(materials) == 0 || len(materials) > MaxPQLabOwners {
		return errors.New("complete fresh online owner materials required")
	}
	private := filepath.Join(directory, "private-senders")
	public := filepath.Join(directory, "sender-public")
	if err := pqLabFreshDirectory(private); err != nil {
		return err
	}
	if err := pqLabFreshDirectory(public); err != nil {
		return err
	}
	credential, salt, nonce := make([]byte, 32), make([]byte, 32), make([]byte, 12)
	defer clear(credential)
	for _, target := range [][]byte{credential, salt, nonce} {
		if _, err := rand.Read(target); err != nil {
			return err
		}
	}
	fields := [][]byte{[]byte(ynxbatch.KeyMaterialFormat)}
	defer func() {
		for _, field := range fields {
			clear(field)
		}
	}()
	for _, material := range materials {
		raw, err := ynxbatch.EncodeFields(material.PKCS8A, material.PKCS8B, material.PKA, material.PKB)
		if err != nil {
			return err
		}
		fields = append(fields, raw)
	}
	plain, err := ynxbatch.EncodeFields(fields...)
	if err != nil {
		return err
	}
	defer clear(plain)
	h := sha256.Sum256(manifestRaw)
	head := [][]byte{[]byte(pqLabSenderVaultDomain), ynxbatch.U32(1), h[:], []byte(directory), []byte(pqLabSenderKDF), salt, nonce}
	aad, err := ynxbatch.EncodeFields(head...)
	if err != nil {
		return err
	}
	aead, err := pqLabSenderAEAD(credential, salt)
	if err != nil {
		return err
	}
	ciphertext := aead.Seal(nil, nonce, plain, aad)
	vault, err := ynxbatch.EncodeFields(append(head, ciphertext)...)
	if err != nil {
		return err
	}
	if err = pqLabWriteExclusive(filepath.Join(private, "recovery.raw"), credential); err != nil {
		return err
	}
	if err = pqLabWriteExclusive(filepath.Join(private, "keys.vault"), vault); err != nil {
		return err
	}
	for i := range m.Owners {
		dir := filepath.Join(public, fmt.Sprintf("%04d", i))
		if err = pqLabFreshDirectory(dir); err != nil {
			return err
		}
		if err = pqLabWriteExclusive(filepath.Join(private, fmt.Sprintf("owner-%04d.writer.lock", i)), nil); err != nil {
			return err
		}
	}
	return nil
}

var ErrPQLabSenderUnknown = errors.New("lab signing result UNKNOWN; reconcile the original operation, never re-sign")

type PQLabSenderRequest struct {
	Version     string `json:"version"`
	OperationID string `json:"operationId"`
	OwnerIndex  int    `json:"ownerIndex"`
	FirstNonce  uint64 `json:"firstNonce,string"`
	Members     int    `json:"members"`
}
type PQLabSenderResult struct {
	Version           string                   `json:"version"`
	Status            string                   `json:"status"`
	SyntheticOnly     bool                     `json:"syntheticOnly"`
	AuthorityGranted  bool                     `json:"authorityGranted"`
	OperationID       string                   `json:"operationId"`
	OwnerIndex        int                      `json:"ownerIndex"`
	CheckpointHeight  int64                    `json:"checkpointHeight,string"`
	CheckpointAppHash string                   `json:"checkpointAppHash"`
	Transaction       PQLabWorkloadTransaction `json:"transaction"`
}

// PQLabSender is one independently leased owner, no raw signer escape hatch.
// There is no background queue or batch assembly: callers supply a complete
// legal count and receive its original immediately after durable publication.
type PQLabSender struct {
	mu         sync.Mutex
	directory  string
	manifest   PQLabWorkloadManifest
	owner      PQLabWorkloadOwner
	key        *ynxbatch.PrivateKey
	public     ynxbatch.PublicKey
	lease      *ApplicationStateWriterLease
	historyKey []byte
}

func OpenPQLabSender(directory, pin string, index int, credential []byte) (*PQLabSender, error) {
	if err := requireInspectionPath(directory); err != nil {
		return nil, err
	}
	raw, err := pqLabRead(filepath.Join(directory, "PUBLIC-WORKLOAD.json"), 8<<20)
	if err != nil || pqLabFile("", raw).SHA256 != pin {
		return nil, errors.New("original independently pinned online workload required")
	}
	var m PQLabWorkloadManifest
	if err = pqLabDecode(raw, &m); err != nil {
		return nil, err
	}
	if m.Version != PQLabWorkloadVersion || m.Mode != "online" || !m.SyntheticOnly || m.AuthorityGranted || m.NativeChainID != "642399" || len(m.Owners) < 1 || len(m.Owners) > MaxPQLabOwners || index < 0 || index >= len(m.Owners) || m.Owners[index].Index != index {
		return nil, errors.New("bounded original synthetic online owner required")
	}
	if filepath.Base(m.Policy.Path) != m.Policy.Path {
		return nil, errors.New("original policy must remain inside the workload")
	}
	private := filepath.Join(directory, "private-senders")
	if err = requireInspectionPath(private); err != nil {
		return nil, err
	}
	vault, err := pqLabRead(filepath.Join(private, "keys.vault"), 8<<20)
	if err != nil {
		return nil, err
	}
	f, err := ynxbatch.DecodeFields(vault, 8, 8<<20)
	if err != nil {
		return nil, errors.New("invalid encrypted synthetic sender material")
	}
	h := sha256.Sum256(raw)
	if string(f[0]) != pqLabSenderVaultDomain || !bytes.Equal(f[1], ynxbatch.U32(1)) || !bytes.Equal(f[2], h[:]) || string(f[3]) != directory || string(f[4]) != pqLabSenderKDF || len(f[5]) != 32 || len(f[6]) != 12 {
		return nil, errors.New("sender vault binding differs from original workload")
	}
	aad, err := ynxbatch.EncodeFields(f[:7]...)
	if err != nil {
		return nil, err
	}
	aead, err := pqLabSenderAEAD(credential, f[5])
	if err != nil {
		return nil, err
	}
	plain, err := aead.Open(nil, f[6], f[7], aad)
	if err != nil {
		return nil, errors.New("synthetic sender credential or custody binding invalid")
	}
	defer clear(plain)
	items, err := ynxbatch.DecodeFields(plain, len(m.Owners)+1, 8<<20)
	defer func() {
		for _, item := range items {
			clear(item)
		}
	}()
	if err != nil || string(items[0]) != ynxbatch.KeyMaterialFormat {
		return nil, errors.New("synthetic key material profile invalid")
	}
	material, err := ynxbatch.DecodeFields(items[index+1], 4, 4096)
	defer func() {
		for _, v := range material {
			clear(v)
		}
	}()
	if err != nil {
		return nil, errors.New("synthetic owner material malformed")
	}
	key, pub, err := ynxbatch.ImportKeyMaterial(ynxbatch.KeyMaterial{PKCS8A: material[0], PKCS8B: material[1], PKA: material[2], PKB: material[3]})
	if err != nil {
		return nil, errors.New("synthetic independent private/full-public pair invalid")
	}
	complete := false
	defer func() {
		if !complete {
			key.Destroy()
		}
	}()
	policyRaw, err := pqLabRead(filepath.Join(directory, m.Policy.Path), 8<<20)
	if err != nil || pqLabFile(m.Policy.Path, policyRaw) != m.Policy {
		return nil, errors.New("original synthetic policy changed")
	}
	var policy ynxauth.State
	if err = pqLabDecode(policyRaw, &policy); err != nil {
		return nil, err
	}
	height, err := strconv.ParseUint(m.SourceHeight, 10, 64)
	if err != nil {
		return nil, err
	}
	r, err := policy.TrustedRegistration(m.Owners[index].Owner, ynxauth.TransactionPurpose, height+1)
	if err != nil || !bytes.Equal(pub.PKA, r.PKA) || !bytes.Equal(pub.PKB, r.PKB) {
		return nil, errors.New("synthetic sender pair differs from registered owner")
	}
	leasePath := filepath.Join(private, fmt.Sprintf("owner-%04d", index))
	lockInfo, err := os.Lstat(leasePath + ".writer.lock")
	if err != nil || !lockInfo.Mode().IsRegular() || lockInfo.Mode().Perm() != 0600 || lockInfo.Size() != 0 {
		return nil, errors.New("original private owner lease required; never recreate missing custody")
	}
	lease, err := AcquireApplicationStateWriterLease(leasePath)
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, credential)
	mac.Write([]byte("YNX-SYNTHETIC-LAB-TX-HISTORY/v1"))
	mac.Write(h[:])
	mac.Write(ynxbatch.U32(uint32(index)))
	complete = true
	return &PQLabSender{directory: directory, manifest: m, owner: m.Owners[index], key: key, public: pub, lease: lease, historyKey: mac.Sum(nil)}, nil
}

func (s *PQLabSender) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key != nil {
		s.key.Destroy()
		s.key = nil
	}
	clear(s.historyKey)
	s.historyKey = nil
	if s.lease != nil {
		err := s.lease.Close()
		s.lease = nil
		return err
	}
	return nil
}

type pqLabSenderRecord struct {
	Body []byte `json:"body"`
	MAC  []byte `json:"mac"`
}

type pqLabSenderIntent struct {
	Version           string                `json:"version"`
	Request           PQLabSenderRequest    `json:"request"`
	CheckpointHeight  int64                 `json:"checkpointHeight,string"`
	CheckpointAppHash string                `json:"checkpointAppHash"`
	Registration      ynxbatch.Registration `json:"registration"`
}

func (s *PQLabSender) recordMAC(path string, body []byte) []byte {
	h := hmac.New(sha256.New, s.historyKey)
	h.Write([]byte(filepath.Base(filepath.Dir(path))))
	h.Write([]byte(filepath.Base(path)))
	h.Write(body)
	return h.Sum(nil)
}
func (s *PQLabSender) writeRecord(path string, body []byte) error {
	raw, err := json.Marshal(pqLabSenderRecord{Body: body, MAC: s.recordMAC(path, body)})
	if err != nil {
		return err
	}
	return pqLabWriteExclusive(path, raw)
}
func (s *PQLabSender) readRecord(path string) ([]byte, error) {
	raw, err := pqLabRead(path, 2<<20)
	if err != nil {
		return nil, err
	}
	var record pqLabSenderRecord
	if err = pqLabDecode(raw, &record); err != nil || !hmac.Equal(record.MAC, s.recordMAC(path, record.Body)) {
		return nil, ErrPQLabSenderUnknown
	}
	return record.Body, nil
}

// The checkpoint fields are private: only normal full state decoding and its
// independent H/AppHash check can construct this authorization input.
type PQLabSenderCheckpoint struct {
	state         CommittedState
	network       []byte
	migrationHash string
	current       func() error
}

func LoadPQLabSenderCheckpoint(root, planPin, activationPin string, height int64, appHash string) (*PQLabSenderCheckpoint, error) {
	p, m, b, err := loadPQLab(root, planPin)
	if err != nil {
		return nil, err
	}
	var engine *PQEngineAuthorization
	if activationPin != "" {
		raw, err := pqLabRead(filepath.Join(root, "activation", "activation.json"), 1<<20)
		if err != nil || pqLabFile("", raw).SHA256 != activationPin {
			return nil, errors.New("independent activation pin required")
		}
		var activation PQLabActivation
		if err = pqLabDecode(raw, &activation); err != nil {
			return nil, err
		}
		if activation.ScheduleFile != filepath.Join(root, "activation", "schedule.json") {
			return nil, errors.New("schedule escaped original lab")
		}
		schedule, err := pqLabRead(activation.ScheduleFile, 32<<10)
		if err != nil {
			return nil, err
		}
		engine, err = NewPQEngineAuthorization(schedule, activation.ScheduleHash)
		if err != nil {
			return nil, err
		}
	}
	read := func() (CommittedState, error) {
		var first CommittedState
		for i, n := range p.Nodes {
			state, e := readPQEngineCommittedState(n.StatePath, m, b, engine, nil)
			if e != nil {
				return CommittedState{}, e
			}
			if !state.Initialized || state.Height != height || state.AppHash != appHash || state.AccountPolicy == nil {
				return CommittedState{}, errors.New("actual four-node checkpoint differs from independently supplied H/AppHash")
			}
			if i == 0 {
				first = state
			}
		}
		return first, nil
	}
	state, err := read()
	if err != nil {
		return nil, err
	}
	network, err := hex.DecodeString(m.OriginalGenesisHash)
	if err != nil {
		return nil, err
	}
	return &PQLabSenderCheckpoint{state: state, network: network, migrationHash: m.StateHash, current: func() error { _, err := read(); return err }}, nil
}

func (s *PQLabSender) operation(id string) (string, error) {
	raw, err := hex.DecodeString(id)
	if err != nil || len(raw) != 32 || hex.EncodeToString(raw) != id {
		return "", errors.New("canonical 32-byte operation id required")
	}
	return filepath.Join(s.directory, "sender-public", fmt.Sprintf("%04d", s.owner.Index), id), nil
}

func (s *PQLabSender) recoverLocked(r PQLabSenderRequest) (PQLabSenderResult, error) {
	var out PQLabSenderResult
	directory, err := s.operation(r.OperationID)
	if err != nil {
		return out, err
	}
	raw, err := pqLabRead(filepath.Join(directory, "request.json"), 4096)
	if err != nil {
		return out, ErrPQLabSenderUnknown
	}
	want, err := json.Marshal(r)
	if err != nil || !bytes.Equal(raw, want) {
		return out, errors.New("operation id already belongs to different exact request")
	}
	result, err := s.readRecord(filepath.Join(directory, "RESULT.json"))
	if err != nil {
		// A complete original can be re-confirmed without signing again. A
		// damaged existing result must never be replaced by reconstruction.
		if _, e := os.Lstat(filepath.Join(directory, "RESULT.json")); os.IsNotExist(e) {
			return s.reconfirmOriginal(r, directory)
		}
		return out, ErrPQLabSenderUnknown
	}
	if err = pqLabDecode(result, &out); err != nil {
		return PQLabSenderResult{}, ErrPQLabSenderUnknown
	}
	for _, file := range []PQLabWorkloadFile{out.Transaction.Wire, out.Transaction.Envelope} {
		if filepath.Base(file.Path) != file.Path {
			return PQLabSenderResult{}, ErrPQLabSenderUnknown
		}
		raw, e := pqLabRead(filepath.Join(directory, file.Path), MaxPQWholeTransactionBytes)
		if e != nil || pqLabFile(file.Path, raw) != file {
			return PQLabSenderResult{}, ErrPQLabSenderUnknown
		}
	}
	if out.OperationID != r.OperationID || out.OwnerIndex != r.OwnerIndex || out.Status != "signed-original" || out.AuthorityGranted || !out.SyntheticOnly {
		return PQLabSenderResult{}, ErrPQLabSenderUnknown
	}
	return out, nil
}

func (s *PQLabSender) reconfirmOriginal(r PQLabSenderRequest, directory string) (PQLabSenderResult, error) {
	var empty PQLabSenderResult
	raw, err := s.readRecord(filepath.Join(directory, "INTENT.json"))
	if err != nil {
		return empty, ErrPQLabSenderUnknown
	}
	var intent pqLabSenderIntent
	if pqLabDecode(raw, &intent) != nil || intent.Version != "YNX-PQ-LAB-SENDER-INTENT/v1" || intent.Request != r || intent.CheckpointHeight < 1 || intent.CheckpointHeight == math.MaxInt64 || !bytes.Equal(intent.Registration.PKA, s.public.PKA) || !bytes.Equal(intent.Registration.PKB, s.public.PKB) || intent.Registration.Owner != s.owner.Owner || hex.EncodeToString(intent.Registration.ChainID) != s.manifest.OriginalGenesisHash {
		return empty, ErrPQLabSenderUnknown
	}
	wire, err := pqLabRead(filepath.Join(directory, "transaction.wire"), MaxPQWholeTransactionBytes)
	if err != nil {
		return empty, ErrPQLabSenderUnknown
	}
	envelope, err := pqLabRead(filepath.Join(directory, "transaction.abci"), MaxPQWholeTransactionBytes)
	if err != nil {
		return empty, ErrPQLabSenderUnknown
	}
	kind := PQWholeType
	var messages [][]byte
	if r.Members == 1 {
		kind = PQTransferType
		member, e := ynxbatch.DecodeMember(wire)
		if e != nil || member.Certificate.N != 1 || member.Proof.Index != 0 {
			return empty, ErrPQLabSenderUnknown
		}
		messages = [][]byte{member.Message}
	} else {
		whole, e := ynxbatch.DecodeWhole(wire)
		if e != nil {
			return empty, ErrPQLabSenderUnknown
		}
		messages = whole.Messages
	}
	if len(messages) != r.Members {
		return empty, ErrPQLabSenderUnknown
	}
	for i, message := range messages {
		value, e := ynxauth.DecodeTransfer(message)
		if e != nil || value.From != s.owner.Owner || value.To != s.owner.Recipient || value.Amount != 1 || value.Fee != 1 || value.Nonce != r.FirstNonce+uint64(i) || value.NativeChainID != uint64(PQLabNativeChainID) || !bytes.Equal(value.ChainID, intent.Registration.ChainID) {
			return empty, ErrPQLabSenderUnknown
		}
	}
	exact, err := EncodePQTransaction(kind, wire)
	if err != nil || !bytes.Equal(envelope, exact) {
		return empty, ErrPQLabSenderUnknown
	}
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: intent.Registration.ChainID, Purpose: ynxauth.TransactionPurpose, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		if req.Owner != s.owner.Owner || req.Height != uint64(intent.CheckpointHeight+1) {
			return ynxbatch.Registration{}, ErrPQLabSenderUnknown
		}
		return intent.Registration, nil
	}})
	if err != nil {
		return empty, ErrPQLabSenderUnknown
	}
	if kind == PQTransferType {
		err = v.VerifyOne(wire, uint64(intent.CheckpointHeight+1))
	} else {
		err = v.VerifyWhole(wire, uint64(intent.CheckpointHeight+1))
	}
	if err != nil {
		return empty, ErrPQLabSenderUnknown
	}
	out := pqLabSenderResult(r, intent.CheckpointHeight, intent.CheckpointAppHash, kind, wire, envelope)
	raw, err = json.Marshal(out)
	if err != nil {
		return empty, ErrPQLabSenderUnknown
	}
	if err = s.writeRecord(filepath.Join(directory, "RESULT.json"), raw); err != nil {
		return empty, ErrPQLabSenderUnknown
	}
	return out, nil
}

func pqLabSenderResult(r PQLabSenderRequest, height int64, hash, kind string, wire, envelope []byte) PQLabSenderResult {
	return PQLabSenderResult{Version: "YNX-PQ-LAB-SENDER-RESULT/v1", Status: "signed-original", SyntheticOnly: true, OperationID: r.OperationID, OwnerIndex: r.OwnerIndex, CheckpointHeight: height, CheckpointAppHash: hash, Transaction: PQLabWorkloadTransaction{OwnerIndex: r.OwnerIndex, Type: kind, Wire: pqLabFile("transaction.wire", wire), Envelope: pqLabFile("transaction.abci", envelope), NativeHash: SignedTransactionHash(wire), ABCIHash: SignedTransactionHash(envelope), FirstNonce: strconv.FormatUint(r.FirstNonce, 10), Members: strconv.Itoa(r.Members), AmountPerMember: "1", FeePerMember: "1"}}
}

func (s *PQLabSender) Recover(r PQLabSenderRequest) (PQLabSenderResult, error) {
	if s == nil {
		return PQLabSenderResult{}, errors.New("missing sender")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key == nil {
		return PQLabSenderResult{}, errors.New("closed sender")
	}
	return s.recoverLocked(r)
}

func (s *PQLabSender) Sign(r PQLabSenderRequest, checkpoint *PQLabSenderCheckpoint) (PQLabSenderResult, error) {
	var out PQLabSenderResult
	if s == nil {
		return out, errors.New("missing sender")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key == nil || r.Version != "YNX-PQ-LAB-SENDER-REQUEST/v1" || r.OwnerIndex != s.owner.Index {
		return out, errors.New("closed or different owner sender")
	}
	directory, err := s.operation(r.OperationID)
	if err != nil {
		return out, err
	}
	if _, err = os.Lstat(directory); err == nil {
		return s.recoverLocked(r)
	} else if !os.IsNotExist(err) {
		return out, err
	}
	capacity, err := strconv.Atoi(s.owner.MemberCapacity)
	if err != nil || capacity < 1 || capacity > MaxPQLabTransfers {
		return out, errors.New("invalid original bounded owner capacity")
	}
	batch, err := strconv.Atoi(s.manifest.BatchSize)
	if err != nil || batch < 1 || batch > capacity || batch&(batch-1) != 0 {
		return out, errors.New("invalid original bounded batch size")
	}
	if r.Members < 1 || r.Members > batch || r.Members&(r.Members-1) != 0 || r.FirstNonce < 2 || r.FirstNonce > uint64(capacity)+2-uint64(r.Members) {
		return out, errors.New("bounded exact per-owner nonce/member capacity required")
	}
	if checkpoint == nil || checkpoint.current == nil || checkpoint.state.AccountPolicy == nil || checkpoint.state.Height < 1 || checkpoint.state.Height == math.MaxInt64 || checkpoint.migrationHash != s.manifest.MigrationStateHash || hex.EncodeToString(checkpoint.network) != s.manifest.OriginalGenesisHash {
		return out, errors.New("independent original current checkpoint required")
	}
	if err = checkpoint.current(); err != nil {
		return out, err
	}
	index, exists := accountIndex(checkpoint.state.Accounts, s.owner.Owner)
	if !exists || checkpoint.state.Accounts[index].Nonce+1 != r.FirstNonce || checkpoint.state.Accounts[index].Balance < int64(2*r.Members) {
		return out, errors.New("actual owner nonce or balance differs from original request")
	}
	registration, err := checkpoint.state.AccountPolicy.TrustedRegistration(s.owner.Owner, ynxauth.TransactionPurpose, uint64(checkpoint.state.Height+1))
	if err != nil || !bytes.Equal(registration.PKA, s.public.PKA) || !bytes.Equal(registration.PKB, s.public.PKB) {
		if err == nil {
			err = errors.New("current actual full pair differs from original online sender")
		}
		return out, err
	}
	dir, err := os.Open(filepath.Dir(directory))
	if err != nil {
		return out, err
	}
	entries, err := dir.ReadDir(2*capacity + 1)
	closeErr := dir.Close()
	if err != nil && err != io.EOF {
		return out, err
	}
	if closeErr != nil {
		return out, closeErr
	}
	if len(entries) >= 2*capacity {
		return out, errors.New("bounded operation history full; no pruning or replacement")
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return out, errors.New("unexpected original sender history")
		}
		raw, e := s.readRecord(filepath.Join(filepath.Dir(directory), entry.Name(), "CONFIRMED.json"))
		if e != nil {
			return out, ErrPQLabSenderUnknown
		}
		var confirmed PQLabProofExport
		if e = pqLabDecode(raw, &confirmed); e != nil || !confirmed.Result.Finalized || confirmed.Result.NativeGrant || checkpoint.state.Height < confirmed.Result.Successor.HeaderHeight {
			return out, errors.New("actual checkpoint regressed behind original confirmed operation")
		}
	}
	if err = pqLabFreshDirectory(directory); err != nil {
		return out, err
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return out, err
	}
	if err = pqLabWriteExclusive(filepath.Join(directory, "request.json"), raw); err != nil {
		return out, ErrPQLabSenderUnknown
	}
	intentRaw, err := json.Marshal(pqLabSenderIntent{Version: "YNX-PQ-LAB-SENDER-INTENT/v1", Request: r, CheckpointHeight: checkpoint.state.Height, CheckpointAppHash: checkpoint.state.AppHash, Registration: registration})
	if err != nil {
		return out, ErrPQLabSenderUnknown
	}
	if err = s.writeRecord(filepath.Join(directory, "INTENT.json"), intentRaw); err != nil {
		return out, ErrPQLabSenderUnknown
	}
	kind, wire, envelope, err := pqLabSignTransferGroup(s.key, checkpoint.state.AccountPolicy, s.owner, r.FirstNonce, r.Members, uint64(checkpoint.state.Height+1))
	if err != nil {
		return out, ErrPQLabSenderUnknown
	}
	if err = pqLabWriteExclusive(filepath.Join(directory, "transaction.wire"), wire); err != nil {
		return out, ErrPQLabSenderUnknown
	}
	if err = pqLabWriteExclusive(filepath.Join(directory, "transaction.abci"), envelope); err != nil {
		return out, ErrPQLabSenderUnknown
	}
	if err = checkpoint.current(); err != nil {
		return out, ErrPQLabSenderUnknown
	}
	out = pqLabSenderResult(r, checkpoint.state.Height, checkpoint.state.AppHash, kind, wire, envelope)
	raw, err = json.Marshal(out)
	if err != nil {
		return PQLabSenderResult{}, ErrPQLabSenderUnknown
	}
	if err = s.writeRecord(filepath.Join(directory, "RESULT.json"), raw); err != nil {
		return PQLabSenderResult{}, ErrPQLabSenderUnknown
	}
	return out, nil
}

// Confirm requires the full normal H/H+1 proof under independent trust. A
// rejected or partial execution stays explicitly rejected/partial; it never
// increments an invented nonce. The next Sign reads actual account state again.
func (s *PQLabSender) Confirm(r PQLabSenderRequest, m PQLabProofMaterials, proof PQTransactionProofRequest, now time.Time) (PQLabProofExport, error) {
	if s == nil {
		return PQLabProofExport{}, errors.New("missing sender")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key == nil {
		return PQLabProofExport{}, errors.New("closed sender")
	}
	original, err := s.recoverLocked(r)
	if err != nil {
		return PQLabProofExport{}, err
	}
	directory, err := s.operation(r.OperationID)
	if err != nil {
		return PQLabProofExport{}, err
	}
	wire, err := pqLabRead(filepath.Join(directory, "transaction.wire"), MaxPQWholeTransactionBytes)
	if err != nil {
		return PQLabProofExport{}, err
	}
	envelope, err := pqLabRead(filepath.Join(directory, "transaction.abci"), MaxPQWholeTransactionBytes)
	if err != nil {
		return PQLabProofExport{}, err
	}
	if !bytes.Equal(m.Expected.NativeWire, wire) || !bytes.Equal(m.Expected.Envelope, envelope) || m.Expected.TransactionType != original.Transaction.Type || m.Pins.OriginalGenesisHash != s.manifest.OriginalGenesisHash || m.Pins.MigrationStateHash != s.manifest.MigrationStateHash {
		return PQLabProofExport{}, errors.New("confirmation proof differs from exact original operation")
	}
	confirmedPath := filepath.Join(directory, "CONFIRMED.json")
	if _, e := os.Lstat(confirmedPath); e == nil {
		saved, e := s.readRecord(confirmedPath)
		if e != nil {
			return PQLabProofExport{}, ErrPQLabSenderUnknown
		}
		var prior PQLabProofExport
		if pqLabDecode(saved, &prior) != nil || prior.Result.TransactionHash != hex.EncodeToString(m.Expected.TransactionHash) || prior.Result.Block.BlockHash != hex.EncodeToString(m.Expected.Block.BlockHash) || prior.Result.Successor.BlockHash != hex.EncodeToString(m.Expected.Successor.BlockHash) {
			return PQLabProofExport{}, ErrPQLabSenderUnknown
		}
		return prior, nil
	} else if !os.IsNotExist(e) {
		return PQLabProofExport{}, ErrPQLabSenderUnknown
	}
	proofDirectory := filepath.Join(directory, "confirmation-proof")
	var result PQLabProofExport
	if _, e := os.Lstat(proofDirectory); e == nil {
		result, err = recheckPQLabProofInputs(proofDirectory, m, proof, now)
	} else if os.IsNotExist(e) {
		result, err = WritePQLabProofInputs(proofDirectory, m, proof, now)
	} else {
		err = e
	}
	if err != nil {
		return PQLabProofExport{}, err
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return PQLabProofExport{}, err
	}
	if err = s.writeRecord(filepath.Join(directory, "CONFIRMED.json"), raw); err != nil {
		return PQLabProofExport{}, ErrPQLabSenderUnknown
	}
	return result, nil
}

func recheckPQLabProofInputs(directory string, m PQLabProofMaterials, proof PQTransactionProofRequest, now time.Time) (PQLabProofExport, error) {
	var out PQLabProofExport
	for name, want := range map[string][]byte{"migration.json": m.Migration, "genesis.json": m.Genesis, "committed-state.json": m.CommittedState, "schedule.json": m.Schedule, "trusted-light-block.json": m.TrustedLightBlock} {
		actual, err := pqLabRead(filepath.Join(directory, name), int64(len(want))+1)
		if err != nil || !bytes.Equal(actual, want) {
			return out, ErrPQLabSenderUnknown
		}
	}
	if _, err := os.Lstat(filepath.Join(directory, "PUBLIC-PROOF-INPUTS.json")); os.IsNotExist(err) {
		return finishPQLabProofInputs(directory, m, proof, now)
	} else if err != nil {
		return out, ErrPQLabSenderUnknown
	}
	raw, err := pqLabRead(filepath.Join(directory, "PUBLIC-PROOF-INPUTS.json"), 2<<20)
	if err != nil || pqLabDecode(raw, &out) != nil {
		return out, ErrPQLabSenderUnknown
	}
	if out.Version != "YNX-PQ-LOOPBACK-PROOF-EXPORT/v1" || !out.SyntheticOnly || out.AuthorityGranted || out.ActualNetworkExecutionClaim || out.Context.Path != "trust-context.json" || out.Request.Path != "request.json" {
		return PQLabProofExport{}, ErrPQLabSenderUnknown
	}
	for _, file := range []PQLabWorkloadFile{out.Context, out.Request} {
		raw, e := pqLabRead(filepath.Join(directory, file.Path), MaxPQTransactionProofRequestBytes)
		if e != nil || pqLabFile(file.Path, raw) != file {
			return PQLabProofExport{}, ErrPQLabSenderUnknown
		}
	}
	requestRaw, err := pqLabRead(filepath.Join(directory, out.Request.Path), MaxPQTransactionProofRequestBytes)
	if err != nil {
		return PQLabProofExport{}, err
	}
	var request struct {
		Proof PQTransactionProofRequest `json:"proof"`
	}
	if json.Unmarshal(requestRaw, &request) != nil {
		return PQLabProofExport{}, ErrPQLabSenderUnknown
	}
	expectedProof, _ := json.Marshal(proof)
	originalProof, _ := json.Marshal(request.Proof)
	if !bytes.Equal(expectedProof, originalProof) {
		return PQLabProofExport{}, errors.New("different proof cannot replace original pending confirmation")
	}
	var migration chain.ConsensusMigrationState
	if json.Unmarshal(m.Migration, &migration) != nil {
		return PQLabProofExport{}, ErrPQLabSenderUnknown
	}
	b, err := NewConsensusBootstrap(m.Genesis, m.Pins, migration)
	if err != nil {
		return PQLabProofExport{}, err
	}
	auth, err := NewPQEngineAuthorization(m.Schedule, m.ScheduleHash)
	if err != nil {
		return PQLabProofExport{}, err
	}
	source, err := NewPQEngineFileSource(migration, filepath.Join(directory, "committed-state.json"), b, auth)
	if err != nil {
		return PQLabProofExport{}, err
	}
	a, err := source.ConsensusAuthorityForState(b.record.ChainID, m.EngineHeight, m.EngineAppHash)
	if err != nil {
		return PQLabProofExport{}, err
	}
	snapshot, ok := a.(*PQEngineSnapshot)
	if !ok {
		return PQLabProofExport{}, ErrPQLabSenderUnknown
	}
	trusted, err := DecodePQTrustedLightBlock(m.TrustedLightBlock)
	if err != nil {
		return PQLabProofExport{}, err
	}
	verified, err := VerifyPQTransactionProof(PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: trusted, TrustingPeriod: m.TrustingPeriod, MaxClockDrift: m.MaxClockDrift, TrustLevel: cmtmath.Fraction{Numerator: m.TrustNumerator, Denominator: m.TrustDenominator}, Now: now}, m.Expected, proof)
	if err != nil {
		return PQLabProofExport{}, err
	}
	want, _ := json.Marshal(verified)
	actual, _ := json.Marshal(out.Result)
	if !bytes.Equal(want, actual) {
		return PQLabProofExport{}, ErrPQLabSenderUnknown
	}
	return out, nil
}

// Pre-signed original readback does not import any key or regenerate a batch.
// Both branches and the actual independent account checkpoint are rechecked.
func ReadPQLabPreSigned(directory, pin string, index int, checkpoint *PQLabSenderCheckpoint) (PQLabSenderResult, error) {
	var out PQLabSenderResult
	raw, err := pqLabRead(filepath.Join(directory, "PUBLIC-WORKLOAD.json"), 8<<20)
	if err != nil || pqLabFile("", raw).SHA256 != pin {
		return out, errors.New("independent original workload pin required")
	}
	var m PQLabWorkloadManifest
	if err = pqLabDecode(raw, &m); err != nil {
		return out, err
	}
	if m.Version != PQLabWorkloadVersion || m.Mode != "pre-signed" || !m.SyntheticOnly || m.AuthorityGranted || index < 0 || index >= len(m.Transactions) || checkpoint == nil || checkpoint.current == nil || checkpoint.state.AccountPolicy == nil || checkpoint.state.Height < 1 || checkpoint.state.Height == math.MaxInt64 || checkpoint.migrationHash != m.MigrationStateHash || hex.EncodeToString(checkpoint.network) != m.OriginalGenesisHash {
		return out, errors.New("original pre-signed workload/current checkpoint mismatch")
	}
	tx := m.Transactions[index]
	if tx.OwnerIndex < 0 || tx.OwnerIndex >= len(m.Owners) {
		return out, errors.New("invalid original owner index")
	}
	owner := m.Owners[tx.OwnerIndex]
	if filepath.Base(tx.Wire.Path) != tx.Wire.Path || filepath.Base(tx.Envelope.Path) != tx.Envelope.Path {
		return out, errors.New("original corpus path escaped workload")
	}
	wire, err := pqLabRead(filepath.Join(directory, tx.Wire.Path), MaxPQWholeTransactionBytes)
	if err != nil || pqLabFile(tx.Wire.Path, wire) != tx.Wire || SignedTransactionHash(wire) != tx.NativeHash {
		return out, errors.New("original wire changed")
	}
	envelope, err := pqLabRead(filepath.Join(directory, tx.Envelope.Path), MaxPQWholeTransactionBytes)
	if err != nil || pqLabFile(tx.Envelope.Path, envelope) != tx.Envelope || SignedTransactionHash(envelope) != tx.ABCIHash {
		return out, errors.New("original envelope changed")
	}
	exact, err := EncodePQTransaction(tx.Type, wire)
	if err != nil || !bytes.Equal(exact, envelope) {
		return out, errors.New("original wire/envelope mismatch")
	}
	if err = checkpoint.current(); err != nil {
		return out, err
	}
	nonce, err := strconv.ParseUint(tx.FirstNonce, 10, 64)
	if err != nil {
		return out, err
	}
	members, err := strconv.Atoi(tx.Members)
	if err != nil || members < 1 || members > 1024 {
		return out, errors.New("invalid original member count")
	}
	var messages [][]byte
	var certificate ynxbatch.Certificate
	if tx.Type == PQTransferType {
		member, e := ynxbatch.DecodeMember(wire)
		if e != nil {
			return out, e
		}
		messages = [][]byte{member.Message}
		certificate = member.Certificate
		if member.Proof.Index != 0 || certificate.N != 1 {
			return out, errors.New("original N1 corpus shape changed")
		}
	} else if tx.Type == PQWholeType {
		whole, e := ynxbatch.DecodeWhole(wire)
		if e != nil {
			return out, e
		}
		messages = whole.Messages
		certificate = whole.Certificate
	} else {
		return out, errors.New("unexpected corpus transaction kind")
	}
	if len(messages) != members || certificate.Owner != owner.Owner || tx.AmountPerMember != "1" || tx.FeePerMember != "1" {
		return out, errors.New("original corpus owner/count mismatch")
	}
	for i, message := range messages {
		intent, e := ynxauth.DecodeTransfer(message)
		if e != nil || intent.From != owner.Owner || intent.To != owner.Recipient || intent.Nonce != nonce+uint64(i) || intent.Amount != 1 || intent.Fee != 1 || intent.NativeChainID != uint64(PQLabNativeChainID) || !bytes.Equal(intent.ChainID, checkpoint.network) {
			return out, errors.New("original corpus execution fields changed")
		}
	}
	at, exists := accountIndex(checkpoint.state.Accounts, owner.Owner)
	if !exists || checkpoint.state.Accounts[at].Nonce+1 != nonce || checkpoint.state.Accounts[at].Balance < int64(2*members) {
		return out, errors.New("actual account state does not admit original next nonce")
	}
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: checkpoint.network, Purpose: ynxauth.TransactionPurpose, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		return checkpoint.state.AccountPolicy.TrustedRegistration(req.Owner, req.Purpose, req.Height)
	}})
	if err != nil {
		return out, err
	}
	if tx.Type == PQTransferType {
		err = v.VerifyOne(wire, uint64(checkpoint.state.Height+1))
	} else if tx.Type == PQWholeType {
		err = v.VerifyWhole(wire, uint64(checkpoint.state.Height+1))
	} else {
		err = errors.New("unexpected corpus transaction kind")
	}
	if err != nil {
		return out, err
	}
	if err = checkpoint.current(); err != nil {
		return out, err
	}
	return PQLabSenderResult{Version: "YNX-PQ-LAB-SENDER-RESULT/v1", Status: "pre-signed-original", SyntheticOnly: true, OperationID: tx.Envelope.SHA256, OwnerIndex: tx.OwnerIndex, CheckpointHeight: checkpoint.state.Height, CheckpointAppHash: checkpoint.state.AppHash, Transaction: tx}, nil
}

// PQLabProofMaterials must be captured and pinned by the lab operator from the
// actual stopped node and authenticated Comet checkpoint. An RPC response is
// NOT its authority source. Bytes are public, including the full signed history.
// The separate untrusted proof is never allowed to choose these inputs or time.
type PQLabProofMaterials struct {
	Version           string                        `json:"version"`
	Migration         []byte                        `json:"migration"`
	Genesis           []byte                        `json:"genesis"`
	CommittedState    []byte                        `json:"committedState"`
	Schedule          []byte                        `json:"schedule"`
	TrustedLightBlock []byte                        `json:"trustedLightBlock"`
	Pins              ConsensusBootstrapPins        `json:"pins"`
	ScheduleHash      string                        `json:"scheduleHash"`
	EngineHeight      int64                         `json:"engineHeight,string"`
	EngineAppHash     []byte                        `json:"engineAppHash"`
	TrustingPeriod    time.Duration                 `json:"trustingPeriodNanoseconds,string"`
	MaxClockDrift     time.Duration                 `json:"maxClockDriftNanoseconds,string"`
	TrustNumerator    uint64                        `json:"trustNumerator,string"`
	TrustDenominator  uint64                        `json:"trustDenominator,string"`
	Expected          PQTransactionProofExpectation `json:"expected"`
}

const PQLabProofMaterialsVersion = "YNX-PQ-LOOPBACK-PROOF-MATERIALS/v1"
const MaxPQLabProofMaterialsBytes = 256 << 20

// DecodePQLabProofMaterials requires a distinct exact operator pin. Canonical
// typed JSON rejects aliases, missing/extra fields, duplicates and trailing data.
func DecodePQLabProofMaterials(raw []byte, pin string) (PQLabProofMaterials, error) {
	var value PQLabProofMaterials
	if len(raw) == 0 || len(raw) > MaxPQLabProofMaterialsBytes || pqLabFile("", raw).SHA256 != pin || pqLightUniqueJSON(raw) != nil {
		return value, errors.New("independently pinned bounded lab proof materials required")
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return value, errors.New("invalid lab material encoding")
	}
	canonical, err := json.Marshal(value)
	if err != nil || !bytes.Equal(raw, canonical) || value.Version != PQLabProofMaterialsVersion {
		return PQLabProofMaterials{}, errors.New("noncanonical lab proof materials")
	}
	return value, nil
}

type PQLabProofExport struct {
	Version                     string                   `json:"version"`
	SyntheticOnly               bool                     `json:"syntheticOnly"`
	AuthorityGranted            bool                     `json:"authorityGranted"`
	ActualNetworkExecutionClaim bool                     `json:"actualNetworkExecutionClaim"`
	Context                     PQLabWorkloadFile        `json:"context"`
	Request                     PQLabWorkloadFile        `json:"request"`
	Result                      PQTransactionProofResult `json:"result"`
	VerifierArguments           []string                 `json:"verifierArguments"`
}

// WritePQLabProofInputs reconstructs the NORMAL engine FileSource and uses the
// unchanged dual-PQ light/transaction verifier before emitting the normal CLI
// contract. Success is conditional mathematical DATA, not operator provenance,
// a public deployment, native authority, or permission to replace a checkpoint.
// Failures retain the exclusive output directory and original public materials.
func WritePQLabProofInputs(directory string, m PQLabProofMaterials, proof PQTransactionProofRequest, now time.Time) (PQLabProofExport, error) {
	var empty PQLabProofExport
	if m.Version != PQLabProofMaterialsVersion || len(m.Migration) == 0 || len(m.Migration) > 64<<20 || len(m.Genesis) == 0 || len(m.Genesis) > 64<<20 || len(m.CommittedState) == 0 || len(m.CommittedState) > 128<<20 || len(m.Schedule) == 0 || len(m.Schedule) > 1<<20 || len(m.TrustedLightBlock) == 0 || len(m.TrustedLightBlock) > MaxPQTrustedLightBlockBytes || m.EngineHeight < 1 || len(m.EngineAppHash) != 32 || now.IsZero() {
		return empty, errors.New("bounded actual lab checkpoint material required")
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(m.Migration, &migration); err != nil {
		return empty, err
	}
	if migration.Network.ChainID != PQLabNativeChainID || migration.Network.IsPublicNet {
		return empty, errors.New("proof export is restricted to independent synthetic lab identity")
	}
	canonical, err := migration.CanonicalJSON()
	if err != nil || !bytes.Equal(canonical, m.Migration) {
		return empty, errors.New("noncanonical original migration")
	}
	bootstrap, err := NewConsensusBootstrap(m.Genesis, m.Pins, migration)
	if err != nil {
		return empty, err
	}
	_, err = NewPQEngineAuthorization(m.Schedule, m.ScheduleHash)
	if err != nil {
		return empty, err
	}
	_, err = DecodePQTrustedLightBlock(m.TrustedLightBlock)
	if err != nil {
		return empty, err
	}
	if m.Expected.Block.ChainID != bootstrap.record.ChainID {
		return empty, errors.New("expected chain differs from original lab bootstrap")
	}
	if err = pqLabFreshDirectory(directory); err != nil {
		return empty, err
	}
	files := map[string][]byte{"migration.json": m.Migration, "genesis.json": m.Genesis, "committed-state.json": m.CommittedState, "schedule.json": m.Schedule, "trusted-light-block.json": m.TrustedLightBlock}
	for name, raw := range files {
		if err = pqLabWriteExclusive(filepath.Join(directory, name), raw); err != nil {
			return empty, err
		}
	}
	return finishPQLabProofInputs(directory, m, proof, now)
}

// Exact continuation only: originals written before a crash/invalid proof are
// retained. Any different existing context/result refuses instead of replacing.
func finishPQLabProofInputs(directory string, m PQLabProofMaterials, proof PQTransactionProofRequest, now time.Time) (PQLabProofExport, error) {
	var empty PQLabProofExport
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(m.Migration, &migration); err != nil {
		return empty, err
	}
	bootstrap, err := NewConsensusBootstrap(m.Genesis, m.Pins, migration)
	if err != nil {
		return empty, err
	}
	authorization, err := NewPQEngineAuthorization(m.Schedule, m.ScheduleHash)
	if err != nil {
		return empty, err
	}
	trusted, err := DecodePQTrustedLightBlock(m.TrustedLightBlock)
	if err != nil {
		return empty, err
	}
	source, err := NewPQEngineFileSource(migration, filepath.Join(directory, "committed-state.json"), bootstrap, authorization)
	if err != nil {
		return empty, err
	}
	authority, err := source.ConsensusAuthorityForState(bootstrap.record.ChainID, m.EngineHeight, m.EngineAppHash)
	if err != nil {
		return empty, err
	}
	snapshot, ok := authority.(*PQEngineSnapshot)
	if !ok {
		return empty, errors.New("normal file source returned unexpected authority")
	}
	trust := PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: trusted, TrustingPeriod: m.TrustingPeriod, MaxClockDrift: m.MaxClockDrift, TrustLevel: cmtmath.Fraction{Numerator: m.TrustNumerator, Denominator: m.TrustDenominator}, Now: now}
	result, err := VerifyPQTransactionProof(trust, m.Expected, proof)
	if err != nil {
		return empty, err
	}
	e := m.Expected
	statement := func(e PQLightProofExpectation) map[string]string {
		return map[string]string{"chainId": e.ChainID, "headerHeight": strconv.FormatInt(e.HeaderHeight, 10), "blockHash": hex.EncodeToString(e.BlockHash), "stateHeight": strconv.FormatInt(e.StateHeight, 10), "stateAppHash": hex.EncodeToString(e.StateAppHash)}
	}
	expected := map[string]any{"block": statement(e.Block), "successor": statement(e.Successor), "transactionType": e.TransactionType, "envelope": e.Envelope, "nativeWire": e.NativeWire, "transactionHash": hex.EncodeToString(e.TransactionHash), "nativeWireHash": hex.EncodeToString(e.NativeWireHash), "index": strconv.FormatInt(e.Index, 10)}
	light := map[string]string{"version": "YNX-CONSENSUS-PROOF-TRUST/v1", "chainId": bootstrap.record.ChainID, "migrationFile": filepath.Join(directory, "migration.json"), "genesisFile": filepath.Join(directory, "genesis.json"), "stateFile": filepath.Join(directory, "committed-state.json"), "scheduleFile": filepath.Join(directory, "schedule.json"), "scheduleHash": m.ScheduleHash, "consensusGenesisSHA256": m.Pins.CometGenesisSHA256, "originalGenesisHash": m.Pins.OriginalGenesisHash, "migrationStateHash": m.Pins.MigrationStateHash, "runtimePlanFile": "", "runtimePlanHash": "", "engineHeight": strconv.FormatInt(m.EngineHeight, 10), "engineAppHash": hex.EncodeToString(m.EngineAppHash), "expectedHeaderHeight": strconv.FormatInt(e.Block.HeaderHeight, 10), "expectedBlockHash": hex.EncodeToString(e.Block.BlockHash), "expectedStateHeight": strconv.FormatInt(e.Block.StateHeight, 10), "expectedStateAppHash": hex.EncodeToString(e.Block.StateAppHash), "trustedLightBlockFile": filepath.Join(directory, "trusted-light-block.json"), "trustedLightBlockSHA256": pqLabFile("", m.TrustedLightBlock).SHA256, "trustingPeriodNanoseconds": strconv.FormatInt(int64(m.TrustingPeriod), 10), "maxClockDriftNanoseconds": strconv.FormatInt(int64(m.MaxClockDrift), 10), "trustLevelNumerator": strconv.FormatUint(m.TrustNumerator, 10), "trustLevelDenominator": strconv.FormatUint(m.TrustDenominator, 10)}
	contextRaw, err := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1", "lightTrust": light, "expectedTransaction": expected})
	if err != nil {
		return empty, err
	}
	requestRaw, err := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1", "expected": expected, "proof": proof})
	if err != nil {
		return empty, err
	}
	out := PQLabProofExport{Version: "YNX-PQ-LOOPBACK-PROOF-EXPORT/v1", SyntheticOnly: true, Context: pqLabFile("trust-context.json", contextRaw), Request: pqLabFile("request.json", requestRaw), Result: result}
	out.VerifierArguments = []string{"--trust-context", filepath.Join(directory, out.Context.Path), "--trust-context-sha256", out.Context.SHA256}
	for name, raw := range map[string][]byte{out.Context.Path: contextRaw, out.Request.Path: requestRaw} {
		if err = pqLabWriteOrExact(filepath.Join(directory, name), raw); err != nil {
			return empty, err
		}
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return empty, err
	}
	if err = pqLabWriteOrExact(filepath.Join(directory, "PUBLIC-PROOF-INPUTS.json"), raw); err != nil {
		return empty, err
	}
	return out, nil
}

func pqLabWriteOrExact(path string, raw []byte) error {
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		return pqLabWriteExclusive(path, raw)
	} else if err != nil {
		return err
	}
	original, err := pqLabRead(path, int64(len(raw))+1)
	if err != nil || !bytes.Equal(original, raw) {
		return ErrPQLabSenderUnknown
	}
	return nil
}
