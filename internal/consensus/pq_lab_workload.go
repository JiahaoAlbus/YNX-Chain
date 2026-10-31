package consensus

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
)

const (
	PQLabNativeChainID   = int64(642399)
	MaxPQLabTransfers    = 1024
	PQLabWorkloadVersion = "YNX-PQ-LOOPBACK-WORKLOAD/v1"
)

type PQLabWorkloadOptions struct{ Transfers, BatchSize int }

// This source contains PUBLIC originals only. Fresh synthetic account keys are
// destroyed before it is returned. It cannot sign on behalf of any caller.
type PQLabWorkloadSource struct {
	Migration chain.ConsensusMigrationState
	mu        sync.Mutex
	original  []byte
	manifest  PQLabWorkloadManifest
	files     map[string][]byte
}

type PQLabWorkloadFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  string `json:"bytes"`
}

type PQLabWorkloadTransaction struct {
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
	// These must be rejected by normal CheckTx; they are never fund transfers.
	InvalidSignatureEnvelopes []PQLabWorkloadFile `json:"invalidSignatureEnvelopes"`
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

// WriteCorpus accepts only validator-key binding of this exact original source.
// It never regenerates a transaction into an existing/UNKNOWN directory.
func (s *PQLabWorkloadSource) WriteCorpus(directory string, bound chain.ConsensusMigrationState) (PQLabWorkloadManifest, error) {
	if s == nil {
		return PQLabWorkloadManifest{}, errors.New("missing synthetic workload source")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
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
	authorization, err := NewPQEngineAuthorization(m.Schedule, m.ScheduleHash)
	if err != nil {
		return empty, err
	}
	trusted, err := DecodePQTrustedLightBlock(m.TrustedLightBlock)
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
		if err = pqLabWriteExclusive(filepath.Join(directory, name), raw); err != nil {
			return empty, err
		}
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return empty, err
	}
	if err = pqLabWriteExclusive(filepath.Join(directory, "PUBLIC-PROOF-INPUTS.json"), raw); err != nil {
		return empty, err
	}
	return out, nil
}
