package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	pqContractReceiptVersion   = "YNX-PQ-CONTRACT-RECEIPT/v1"
	pqContractStateDomain      = "YNX-CONTRACT-EXECUTION-STATE/v1"
	maxPQContractReceiptBytes  = 512 << 10
	maxPQContractArtifactBytes = 128 << 10
	maxPQContractSourceBytes   = 64 << 10
)

// Artifact is the complete execution prestate for a call, or the actual initial
// artifact for a deployment. First anchors retain the original artifact file
// and source once. Bytecode is always checked against the one bounded registry.
// Build-info is checked at fresh admission, not fabricated or claimed to be
// independently reconstructible from this compact historical receipt.
type pqContractReceipt struct {
	Version      string                     `json:"version"`
	Artifact     ContractArtifact           `json:"artifact"`
	Source       string                     `json:"source,omitempty"`
	ArtifactFile []byte                     `json:"artifactFile,omitempty"`
	Bytecode     string                     `json:"bytecode"`
	Transition   *BoundedContractTransition `json:"transition,omitempty"`
}

func pqContractKind(kind string) bool {
	return kind == ynxauth.ActionContractDeploy || kind == ynxauth.ActionContractExecute
}

// The six public verification metadata fields are the only excluded fields.
// Compiler identity, ABI, constructor, owner, deployment time and slot metadata
// remain in this projection. Runtime storage is encoded separately below.
func pqContractImmutableProjection(a ContractArtifact) ContractArtifact {
	a.Verified, a.VerifiedAt, a.VerifierStatus = false, nil, ""
	a.ReproducibleBuild, a.ReproducibilityStatus, a.DeployedBytecodeComparisonStatus = false, "", ""
	a.RuntimeStorage = nil
	return a
}

func pqContractWord(s string) bool {
	if len(s) != 66 || s[:2] != "0x" {
		return false
	}
	for _, c := range s[2:] {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// ContractExecutionStateCommitment is the signed ExpectedStorageCommitment.
// It commits the entire execution prestate, not merely the storage map. It is
// SHA256(E(domain, target, immutable-artifact JSON, storage)), where immutable
// JSON is json.Marshal of the declared ContractArtifact projection and storage
// is U32(count), then sorted entries U32(66)||key||U32(66)||value. Missing and
// explicitly present zero slots differ. No normalization or alias is accepted.
// This spelling is part of the new contract action protocol, not legacy wire.
func ContractExecutionStateCommitment(a ContractArtifact) (string, error) {
	if a.Address != evmAddressForLog(a.Address) || len(a.Address) != 42 || a.Address == "0x"+strings.Repeat("0", 40) {
		return "", errors.New("contract execution state has a noncanonical address")
	}
	if a.PQAnchorTransactionHash != "" && !pqContractWord(a.PQAnchorTransactionHash) {
		return "", errors.New("contract execution state has a noncanonical PQ anchor")
	}
	projection, err := json.Marshal(pqContractImmutableProjection(a))
	if err != nil {
		return "", err
	}
	keys := make([]string, 0, len(a.RuntimeStorage))
	for key, value := range a.RuntimeStorage {
		if !pqContractWord(key) || !pqContractWord(value) {
			return "", errors.New("contract storage is not exact canonical uint256 words")
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if uint64(len(keys)) > (math.MaxUint32-4)/140 || uint64(len(projection)) > math.MaxUint32 {
		return "", errors.New("contract state commitment exceeds framing range")
	}
	h := sha256.New()
	writeU32 := func(n uint32) { var b [4]byte; binary.BigEndian.PutUint32(b[:], n); _, _ = h.Write(b[:]) }
	writeField := func(b []byte) { writeU32(uint32(len(b))); _, _ = h.Write(b) }
	writeU32(4)
	writeField([]byte(pqContractStateDomain))
	writeField([]byte(a.Address))
	writeField(projection)
	writeU32(uint32(4 + 140*len(keys)))
	writeU32(uint32(len(keys)))
	for _, key := range keys {
		writeField([]byte(key))
		writeField([]byte(a.RuntimeStorage[key]))
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func encodePQContractActionMemo(wire []byte, r pqContractReceipt) (string, error) {
	if err := validatePQContractReceiptShape(r); err != nil {
		return "", err
	}
	if len(r.ArtifactFile) > 0 {
		if err := validatePQContractArtifact(r); err != nil {
			return "", err
		}
	}
	raw, err := json.Marshal(r)
	if err != nil || len(raw) > maxPQContractReceiptBytes {
		return "", errors.New("contract receipt exceeds bound")
	}
	framed, err := ynxbatch.EncodeFields(wire, raw)
	if err != nil {
		return "", err
	}
	return pqActionMemo + hex.EncodeToString(framed), nil
}

func decodePQContractReceipt(raw []byte) (*pqContractReceipt, error) {
	if len(raw) == 0 || len(raw) > maxPQContractReceiptBytes {
		return nil, errors.New("missing or oversized contract receipt")
	}
	var r pqContractReceipt
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(r)
	if err != nil || !bytes.Equal(raw, canonical) {
		return nil, errors.New("noncanonical contract receipt")
	}
	if err := validatePQContractReceiptShape(r); err != nil {
		return nil, err
	}
	return &r, nil
}

func validatePQContractReceiptShape(r pqContractReceipt) error {
	if r.Version != pqContractReceiptVersion || len(r.Source) > maxPQContractSourceBytes || r.Source != strings.TrimSpace(r.Source) || len(r.ArtifactFile) > maxPQContractArtifactBytes || (r.Source == "") != (len(r.ArtifactFile) == 0) || len(r.Bytecode) > 12*1024 || r.Bytecode != normalizeHex(r.Bytecode) {
		return errors.New("invalid bounded contract receipt")
	}
	if _, err := ContractExecutionStateCommitment(r.Artifact); err != nil {
		return err
	}
	hash, err := ValidateBoundedPinnedIdentity(r.Artifact.Name, r.Artifact.SourceHash, r.Bytecode)
	if err != nil || hash != r.Artifact.DeployedBytecodeHash {
		return errors.New("contract receipt code differs from pinned identity")
	}
	config := SolidityCompilerConfig()
	if r.Artifact.CompilerConfigHash != config.ConfigHash || !reflect.DeepEqual(r.Artifact.Compiler, config) {
		return errors.New("contract receipt compiler config differs from static pinned config")
	}
	if r.Transition != nil {
		after := r.Artifact
		after.RuntimeStorage = r.Transition.Storage
		if _, err := ContractExecutionStateCommitment(after); err != nil {
			return err
		}
		if len(r.Transition.StorageWrites) > 16 || len(r.Transition.Logs) > 4 || r.Transition.StepCount <= 0 || r.Transition.StepCount > maxEVMSubsetSteps || len(r.Transition.EncodedResult) > 66 {
			return errors.New("contract transition exceeds bounded runtime shape")
		}
	}
	return nil
}

// Compact historical evidence rechecks the actual retained artifact's hashes,
// ABI, source and executable code against the existing pinned registry. It does
// not replace fresh admission's complete build-info validation.
func validatePQContractArtifact(r pqContractReceipt) error {
	if r.Source == "" || len(r.ArtifactFile) == 0 {
		return errors.New("first contract anchor lacks actual code material")
	}
	a := r.Artifact
	if _, _, err := ValidateBoundedPinnedContract(a.Name, r.Source, r.Bytecode); err != nil {
		return err
	}
	var actual hardhatArtifactFile
	if err := json.Unmarshal(r.ArtifactFile, &actual); err != nil {
		return err
	}
	source, ok := consensusContractSources[a.Name]
	meta := a.CompilerArtifact
	if !ok || meta == nil || a.ArtifactKind != contractPinnedArtifactKind || actual.ContractName != a.Name || actual.SourceName != source || !consensusBuildID.MatchString(actual.BuildInfoID) || meta.ContractName != a.Name || meta.SourceName != source || meta.BuildInfoID != actual.BuildInfoID || meta.ArtifactPath != "artifacts/"+source+"/"+a.Name+".json" {
		return errors.New("retained contract artifact identity mismatch")
	}
	if actual.DeployedBytecode != r.Bytecode || actual.Bytecode == "0x" || actual.Bytecode != normalizeHex(actual.Bytecode) || a.BytecodeHash != hashParts("solc-bytecode", actual.Bytecode) || meta.BytecodeHash != a.BytecodeHash || meta.DeployedBytecodeHash != a.DeployedBytecodeHash || meta.ABIHash != hashParts("solc-abi", string(actual.ABI)) || a.ArtifactHash != hashParts("artifact", a.CompilerConfigHash, a.ArtifactKind, a.Name, a.SourceHash, a.BytecodeHash, a.DeployedBytecodeHash, fmt.Sprint(len(a.ABI))) {
		return errors.New("retained creation/runtime/ABI hashes differ from original artifact")
	}
	if err := validateConsensusContractFunctions(a, actual); err != nil {
		return err
	}
	if !reflect.DeepEqual(a.RuntimeStorageSlots, extractRuntimeStorageSlots(r.Source)) {
		return errors.New("contract storage slots differ from pinned source")
	}
	return nil
}

func pqContractFreshMaterial(a ContractArtifact) (string, string, []byte, error) {
	if err := ValidatePQContractPinnedArtifact(a); err != nil {
		return "", "", nil, err
	}
	root, ok := repoRoot()
	if !ok {
		return "", "", nil, errors.New("fixed compiler material root is unavailable")
	}
	material, err := readConsensusContractMaterial(root, a.Name)
	if err != nil {
		return "", "", nil, err
	}
	code, err := ValidateConsensusContractMaterial(a, material)
	if err != nil {
		return "", "", nil, err
	}
	sourcePath, ok := consensusContractSources[a.Name]
	if !ok {
		return "", "", nil, errors.New("contract name is outside pinned source registry")
	}
	source, err := os.ReadFile(filepath.Join(root, sourcePath))
	if err != nil || len(source) > maxPQContractSourceBytes {
		return "", "", nil, errors.New("actual contract source is missing or oversized")
	}
	return code, strings.TrimSpace(string(source)), bytes.Clone(material.ArtifactFile), nil
}

func (d *Devnet) pqContractAnchorLocked(address string) (string, error) {
	check := func(tx Transaction) (string, error) {
		if tx.To != address || !strings.HasPrefix(tx.Memo, pqActionMemo) {
			return "", nil
		}
		h, err := decodePQActionMemo(tx.Memo)
		if err != nil || h.Contract == nil {
			return "", err
		}
		return tx.Hash, nil
	}
	for _, block := range d.blocks {
		for _, tx := range block.Transactions {
			if hash, err := check(tx); err != nil || hash != "" {
				return hash, err
			}
		}
	}
	for _, tx := range d.pending {
		if hash, err := check(tx); err != nil || hash != "" {
			return hash, err
		}
	}
	return "", nil
}

func pqContractAddress(hash string) string {
	return "0x" + hashParts("ynx-pq-contract-deployment-v1", hash)[:40]
}

func (d *Devnet) submitPQContractActionLocked(a ynxauth.Action, payload any, hash string, wire []byte) (Transaction, error) {
	now := time.Now().UTC()
	r := pqContractReceipt{Version: pqContractReceiptVersion}
	var next ContractArtifact
	var existing bool
	compute := int64(1)
	typeName := "contract_call"
	switch p := payload.(type) {
	case ynxauth.ContractDeployPayload:
		compute, typeName = 5, "contract_deploy"
		root, ok := repoRoot()
		if !ok {
			return Transaction{}, errors.New("fixed source root unavailable")
		}
		path, ok := consensusContractSources[p.Name]
		if !ok {
			return Transaction{}, ynxauth.ErrAction
		}
		source, err := os.ReadFile(filepath.Join(root, path))
		if err != nil || len(source) > maxPQContractSourceBytes {
			return Transaction{}, errors.New("fixed contract source unavailable")
		}
		address := pqContractAddress(hash)
		if _, exists := d.contracts[address]; exists {
			return Transaction{}, errors.New("contract deployment address already exists")
		}
		next = buildContractArtifactWithArgs(address, a.Owner, p.Name, strings.TrimSpace(string(source)), false, nil, []string{strconv.FormatUint(p.ConstructorArgs[0], 10)})
		next.DeployedAt = now
		if next.SourceHash != p.SourceHash || next.DeployedBytecodeHash != p.DeployedBytecodeHash || next.CompilerConfigHash != p.CompilerConfigHash {
			return Transaction{}, errors.New("signed deployment identity differs from actual pinned compiler output")
		}
		// The compiler builder uses empty non-nil ABI input/output slices. Their
		// omitempty fields decode as nil on snapshot/receipt roundtrip. Store the
		// complete canonical artifact now so copying it preserves exact in-memory
		// identity too; no field is scrubbed and its JSON spelling is unchanged.
		canonical, err := json.Marshal(next)
		if err != nil {
			return Transaction{}, err
		}
		var normalized ContractArtifact
		if err := json.Unmarshal(canonical, &normalized); err != nil {
			return Transaction{}, err
		}
		next = normalized
		r.Artifact = next
	case ynxauth.ContractExecutePayload:
		before, ok := d.contracts[p.Target]
		if !ok {
			return Transaction{}, errors.New("contract target does not exist")
		}
		if before.DeployedAt.IsZero() || before.DeployedAt.After(now) {
			return Transaction{}, errors.New("contract deployment time is unavailable or ahead of execution")
		}
		if before.Address != p.Target || before.Name != p.Name || before.SourceHash != p.SourceHash || before.DeployedBytecodeHash != p.DeployedBytecodeHash || before.CompilerConfigHash != p.CompilerConfigHash {
			return Transaction{}, errors.New("signed contract target or code identity mismatch")
		}
		commitment, err := ContractExecutionStateCommitment(before)
		if err != nil || commitment != p.ExpectedStorageCommitment {
			return Transaction{}, errors.New("signed complete execution prestate is stale or differs from actual contract")
		}
		r.Artifact, next, existing = before, before, true
	default:
		return Transaction{}, ynxauth.ErrAction
	}
	code, source, artifactFile, err := pqContractFreshMaterial(r.Artifact)
	if err != nil {
		return Transaction{}, err
	}
	r.Bytecode = code
	anchor, err := d.pqContractAnchorLocked(next.Address)
	if err != nil {
		return Transaction{}, err
	}
	if anchor != next.PQAnchorTransactionHash {
		return Transaction{}, errors.New("contract anchor differs from retained original PQ history")
	}
	if anchor == "" {
		r.Source, r.ArtifactFile = source, artifactFile
		// The first signed prestate has no marker. Its deterministic poststate
		// records this original Member hash; every later prestate includes it.
		next.PQAnchorTransactionHash = hash
	}
	if p, ok := payload.(ynxauth.ContractExecutePayload); ok {
		transition, err := ExecuteConsensusSourceContract(r.Artifact, code, p.Calldata, a.Owner, r.Artifact.RuntimeStorage)
		if err != nil {
			return Transaction{}, err
		}
		r.Transition, next.RuntimeStorage = &transition, transition.Storage
	}
	memo, err := encodePQContractActionMemo(wire, r)
	if err != nil {
		return Transaction{}, err
	}
	// Unlike legacy receipts, these fees actually transfer value and provenance.
	fee := int64(a.Fee)
	sender := d.accounts[a.Owner]
	if sender == nil || sender.Balance < fee || sender.ResourceUsage.BandwidthUsed < 0 || sender.ResourceUsage.BandwidthUsed == math.MaxInt64 || sender.ResourceUsage.ComputeUsed < 0 || sender.ResourceUsage.ComputeUsed > math.MaxInt64-compute {
		return Transaction{}, errors.New("contract fee or resource capacity is insufficient")
	}
	feeAddress := d.nextValidatorAddressLocked()
	recipient := d.accountReadOnly(feeAddress)
	if feeAddress == a.Owner {
		recipient = sender
	}
	if recipient.Balance < 0 || feeAddress != a.Owner && recipient.Balance > math.MaxInt64-fee {
		return Transaction{}, errors.New("contract fee recipient balance would overflow")
	}
	flows, err := d.planLotMovementLocked(sender, recipient, fee)
	if err != nil {
		return Transaction{}, err
	}
	undo := d.transferUndoLocked(a.Owner, feeAddress, feeAddress, flows)
	before := d.contracts[next.Address]
	recipient = d.account(feeAddress)
	d.applyLotFlowsLocked(sender, recipient, flows)
	sender.Balance -= fee
	recipient.Balance += fee
	sender.Nonce = a.Nonce
	sender.ResourceUsage.BandwidthUsed++
	sender.ResourceUsage.ComputeUsed += compute
	d.contracts[next.Address] = next
	tx := Transaction{Hash: hash, Type: typeName, From: a.Owner, To: next.Address, Fee: fee, Nonce: a.Nonce, Timestamp: now, LotFlows: flows, Memo: memo}
	if r.Transition != nil {
		tx.Logs = evmLogsFromExecutionLogs(contractExecutionLogs(next.Address, r.Transition.Logs))
	}
	d.pending = append(d.pending, tx)
	return d.persistMutationLocked(tx, func() {
		d.rollbackTransferLocked(undo)
		if existing {
			d.contracts[next.Address] = before
		} else {
			delete(d.contracts, next.Address)
		}
	})
}
