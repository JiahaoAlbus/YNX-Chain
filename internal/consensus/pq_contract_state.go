package consensus

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"math/big"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func isPQContractHistory(tx chain.Transaction) bool {
	return strings.HasPrefix(tx.Memo, pqContractHistoryMemo)
}

// Called after the common chronological/native-hash checks in account_policy.
// Devnet system logs and block hashes are deliberately absent: Comet inclusion,
// actual execution receipt and fee event are bound in this ledger's own format.
func validateConsensusPQContractEntry(s CommittedState, m chain.ConsensusMigrationState, entry PQCommittedAuthorization, cache *chain.PQCertificateCache) error {
	tx := entry.Transaction
	if tx.BlockHash != "" || len(tx.Logs) != 0 || tx.Sponsor != "" || tx.SponsorPoolID != "" || tx.ResourceSource != "" || tx.ResourceType != "" || tx.ResourceConsumed != 0 || tx.ActionReference != "" || tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC {
		return errors.New("ABCI contract history contains unexecuted metadata")
	}
	r, wire, action, err := decodePQContractHistory(tx)
	if err != nil {
		return err
	}
	if SignedTransactionHash(r.Transport) != entry.ABCITransactionHash || action.NativeChainID != uint64(s.ChainID) || s.AccountPolicy == nil || !bytes.Equal(action.ChainID, s.AccountPolicy.NetworkID) {
		return errors.New("ABCI contract history transport or network mismatch")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return err
	}
	if err = cache.VerifyDecodedMember(s.AccountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum); err != nil {
		return err
	}
	if _, err = chain.ReplayConsensusPQContract(tx, wire, r.Receipt); err != nil {
		return err
	}
	if action.Kind == ynxauth.ActionContractDeploy {
		envelope, _, _, err := DecodePQContractTransaction(r.Transport)
		if err != nil {
			return err
		}
		expected, err := chain.BuildConsensusPQContractDeployment(action, tx.Hash, tx.Timestamp, envelope.Source, *envelope.Material)
		if err != nil || !reflect.DeepEqual(expected, r.Receipt) {
			return errors.New("ABCI deployment differs from actual deterministic compiler materials")
		}
	}
	feeRecipient := ""
	for _, v := range m.Validators {
		if v.Active {
			feeRecipient = v.Address
			break
		}
	}
	var total int64
	previous := ""
	for _, f := range tx.LotFlows {
		if f.LotID == "" || f.LotID <= previous || f.From != action.Owner || f.To != feeRecipient || f.Amount <= 0 || f.Amount > tx.Fee-total {
			return errors.New("ABCI contract fee flow differs from executed fee")
		}
		lot, exists := s.TraceLots[f.LotID]
		if !exists || lot.LotID != f.LotID {
			return errors.New("ABCI contract fee flow lacks source lineage")
		}
		total += f.Amount
		previous = f.LotID
	}
	if total != tx.Fee {
		return errors.New("ABCI contract fee is not fully traced")
	}
	index, exists := accountIndex(s.Accounts, action.Owner)
	if !exists || s.Accounts[index].Nonce < action.Nonce {
		return errors.New("ABCI contract nonce was not consumed")
	}
	expectedFee := newCurrentFeeEvent(entry.ABCITransactionHash, PQActionType, tx.From, feeRecipient, tx.Fee, int64(tx.BlockNum), tx.Timestamp)
	count := 0
	for _, fee := range s.FeeEvents {
		if fee.TxHash == entry.ABCITransactionHash {
			count++
			if fee != expectedFee {
				return errors.New("ABCI contract fee event mismatch")
			}
		}
	}
	if count != 1 {
		return errors.New("ABCI contract requires one exact fee event")
	}
	return nil
}

// The existing IDE validator uses this narrow exception for a new native PQ
// deployment address. Full signature, compiler, execution and final-state replay
// remain required by validateConsensusPQContracts; a string marker is not proof.
func pqContractDeploymentMatches(s CommittedState, c BFTContract) bool {
	for _, entry := range s.PQHistory {
		tx := entry.Transaction
		if !isPQContractHistory(tx) || tx.Type != "contract_deploy" || tx.To != c.Address || entry.ABCITransactionHash != c.TxHash {
			continue
		}
		r, wire, action, err := decodePQContractHistory(tx)
		if err != nil || action.Kind != ynxauth.ActionContractDeploy {
			return false
		}
		post, err := chain.ReplayConsensusPQContract(tx, wire, r.Receipt)
		return err == nil && post.Address == c.Address && post.Deployer == c.Deployer && int64(tx.BlockNum) == c.BlockHeight
	}
	return false
}

type pqBFTContractProgress struct {
	artifact    chain.ContractArtifact
	contract    BFTContract
	code        string
	deployOrder int
}

// Actual EVMLogs preserve call order whereas EVMReceipts are hash-sorted. All
// calls to a PQ target are replayed from its source checkpoint or PQ deployment,
// including lawful classic callers. Classic receipt calldata is reconstructed
// semantically for the two pinned programs; this does not recover omitted legacy
// signed bytes or prove an arbitrary cold snapshot against an external root.
func validateConsensusPQContracts(s CommittedState, m chain.ConsensusMigrationState) error {
	cache := chain.NewPQCertificateCache()
	entries := map[string]PQCommittedAuthorization{}
	orders := map[string]int{}
	progress := map[string]*pqBFTContractProgress{}
	usage := map[string][2]int64{}
	firstUse := map[string]uint64{}
	for i, entry := range s.PQHistory {
		if !isPQContractHistory(entry.Transaction) {
			continue
		}
		if err := validateConsensusPQContractEntry(s, m, entry, cache); err != nil {
			return err
		}
		if _, dup := entries[entry.ABCITransactionHash]; dup {
			return errors.New("duplicate ABCI contract receipt")
		}
		entries[entry.ABCITransactionHash], orders[entry.ABCITransactionHash] = entry, i
		tx := entry.Transaction
		if firstUse[tx.From] == 0 {
			firstUse[tx.From] = tx.BlockNum
		}
		u := usage[tx.From]
		compute := int64(1)
		if tx.Type == "contract_deploy" {
			compute = 5
		}
		if u[0] == math.MaxInt64 || u[1] > math.MaxInt64-compute {
			return errors.New("PQ contract resource history overflows")
		}
		u[0]++
		u[1] += compute
		usage[tx.From] = u
		if _, exists := progress[tx.To]; exists {
			continue
		}
		if s.LegacyContracts != nil {
			if original, ok := s.LegacyContracts.Contracts[tx.To]; ok {
				contract, err := migrationContract(m, tx.To, original)
				if err != nil {
					return err
				}
				progress[tx.To] = &pqBFTContractProgress{artifact: original, contract: contract, code: contract.DeployedBytecode, deployOrder: -1}
				continue
			}
		}
		if tx.Type != "contract_deploy" {
			return errors.New("PQ call lacks original full contract identity")
		}
		r, wire, _, err := decodePQContractHistory(tx)
		if err != nil {
			return err
		}
		post, err := chain.ReplayConsensusPQContract(tx, wire, r.Receipt)
		if err != nil {
			return err
		}
		contract := BFTContract{Address: post.Address, Name: post.Name, Deployer: post.Deployer, SourceHash: post.SourceHash, DeployedBytecodeHash: post.DeployedBytecodeHash, DeployedBytecode: r.Receipt.Bytecode, ConstructorArgs: append([]string(nil), post.ConstructorArgs...), RuntimeStorage: cloneStringMap(post.RuntimeStorage), RuntimeMode: chain.BoundedContractRuntimeMode, BlockHeight: int64(tx.BlockNum), TxHash: entry.ABCITransactionHash, LastUpdatedHeight: int64(tx.BlockNum)}
		contract.AuditHash = bftContractAuditHash(contract)
		progress[tx.To] = &pqBFTContractProgress{artifact: post, contract: contract, code: r.Receipt.Bytecode, deployOrder: i}
	}
	if len(entries) == 0 {
		for _, fee := range s.FeeEvents {
			if fee.TransactionType == PQActionType && !pqDexFeeHash(s, fee.TxHash) {
				return errors.New("ABCI contract fee has no proof")
			}
		}
		return nil
	}
	receipts := map[string]BFTEVMReceipt{}
	for _, receipt := range s.EVMReceipts {
		receipts[receipt.TxHash] = receipt
	}
	seen := map[string]bool{}
	lastPQOrder := -1
	var lastHeight int64
	for _, log := range s.EVMLogs {
		p, tracked := progress[log.Address]
		if !tracked {
			continue
		}
		if seen[log.TxHash] || log.BlockHeight < lastHeight {
			return errors.New("ABCI contract call logs repeat or change execution order")
		}
		r, exists := receipts[log.TxHash]
		if !exists || r.Action != ActionIDEContractCall || len(r.Logs) != 1 || !reflect.DeepEqual(r.Logs[0], log) || r.BlockHeight <= int64(m.Height) || r.BlockHeight > s.Height || r.BlockHeight < p.contract.BlockHeight {
			return errors.New("ABCI contract call lacks its exact ordered EVM receipt")
		}
		seen[log.TxHash], lastHeight = true, r.BlockHeight
		var transition chain.BoundedContractTransition
		if entry, pq := entries[log.TxHash]; pq {
			if entry.Transaction.Type != "contract_call" || int64(entry.Transaction.BlockNum) != r.BlockHeight || orders[log.TxHash] <= p.deployOrder || orders[log.TxHash] <= lastPQOrder {
				return errors.New("ABCI PQ history disagrees with actual call ordering")
			}
			lastPQOrder = orders[log.TxHash]
			h, wire, _, err := decodePQContractHistory(entry.Transaction)
			if err != nil {
				return err
			}
			if h.Receipt.Bytecode != p.code || !chain.SameConsensusContractPrestate(p.artifact, h.Receipt.Artifact) {
				return errors.New("ABCI PQ call does not extend actual complete contract prestate")
			}
			post, err := chain.ReplayConsensusPQContract(entry.Transaction, wire, h.Receipt)
			if err != nil {
				return err
			}
			p.artifact = post
			transition = *h.Receipt.Transition
		} else {
			if err := requireConsensusLegacy(s.AccountPolicy, r.From, r.BlockHeight); err != nil {
				return err
			}
			calldata, err := pqClassicCalldata(p.artifact, r)
			if err != nil {
				return err
			}
			transition, err = chain.ExecuteConsensusSourceContract(p.artifact, p.code, calldata, r.From, p.artifact.RuntimeStorage)
			if err != nil {
				return err
			}
			p.artifact.RuntimeStorage = transition.Storage
		}
		if err := pqContractReceiptMatchesTransition(r, p.artifact.Address, transition); err != nil {
			return err
		}
		p.contract.RuntimeStorage = cloneStringMap(transition.Storage)
		p.contract.LastUpdatedHeight, p.contract.LastCallTxHash = r.BlockHeight, r.TxHash
		p.contract.AuditHash = bftContractAuditHash(p.contract)
	}
	for hash, entry := range entries {
		r, exists := receipts[hash]
		if !exists || r.From != entry.Transaction.From || r.BlockHeight != int64(entry.Transaction.BlockNum) {
			return errors.New("ABCI PQ contract proof lacks its actual EVM receipt")
		}
		if entry.Transaction.Type == "contract_call" {
			if !seen[hash] {
				return errors.New("ABCI PQ contract call was not replayed")
			}
		} else {
			expected := BFTEVMReceipt{TxHash: hash, From: entry.Transaction.From, ContractAddress: entry.Transaction.To, Action: ActionIDEContractDeploy, Status: "success", Logs: []BFTEVMLog{}, BlockHeight: r.BlockHeight}
			expected.AuditHash = bftEVMReceiptAuditHash(expected)
			if !reflect.DeepEqual(r, expected) {
				return errors.New("ABCI PQ deployment receipt differs from exact effect")
			}
			seen[hash] = true
		}
	}
	for _, r := range s.EVMReceipts {
		address := r.To
		if r.Action == ActionIDEContractDeploy {
			address = r.ContractAddress
		}
		if _, tracked := progress[address]; tracked && !seen[r.TxHash] {
			return errors.New("ABCI anchored contract has an omitted execution receipt")
		}
	}
	for address, p := range progress {
		i, exists := bftContractIndex(s.Contracts, address)
		if !exists || !reflect.DeepEqual(s.Contracts[i], p.contract) {
			return errors.New("ABCI final contract differs from complete ordered bytecode replay")
		}
	}
	for _, fee := range s.FeeEvents {
		if fee.TransactionType == PQActionType && !pqDexFeeHash(s, fee.TxHash) {
			if _, exists := entries[fee.TxHash]; !exists {
				return errors.New("ABCI contract fee has no original proof")
			}
		}
	}
	return nil
}

// Resource validators run before this check. Their actual policy-recomputed
// rentals and reconciled pool records may legitimately release source usage.
// PQ-marked rentals are verified bidirectionally before this helper and are
// folded at their original history positions by validatePQOrderedResourceUsage.
// Only pre-PQ classic effects are considered here: an earlier oversized rental
// must never cancel later PQ execution. Unknown classic usage increases remain
// outside this lower bound; this is not a reconstruction of omitted old bodies.
func pqContractRemainingSourceUsage(s CommittedState, m chain.ConsensusMigrationState, owner string, firstPQ uint64) (int64, int64, error) {
	var base, released [2]int64
	if i, ok := accountIndex(m.Accounts, owner); ok {
		base = [2]int64{m.Accounts[i].ResourceUsage.BandwidthUsed, m.Accounts[i].ResourceUsage.ComputeUsed}
	}
	add := func(height int64, bandwidth, compute int64) error {
		if height <= int64(m.Height) || height >= int64(firstPQ) || bandwidth < 0 || compute < 0 || released[0] > math.MaxInt64-bandwidth || released[1] > math.MaxInt64-compute {
			return errors.New("PQ contract resource release has invalid height, quantity or overflow")
		}
		if err := requireConsensusLegacy(s.AccountPolicy, owner, height); err != nil {
			return err
		}
		released[0] += bandwidth
		released[1] += compute
		return nil
	}
	for _, rental := range s.ResourceRentals {
		if rental.Address == owner && rental.PQTransactionHash == "" {
			if err := add(rental.BlockHeight, rental.Bandwidth, rental.Compute); err != nil {
				return 0, 0, err
			}
		}
	}
	if s.LegacyResourceSponsor != nil {
		for _, pool := range s.ResourcePools {
			original, imported := s.LegacyResourceSponsor.Pools[pool.ID]
			if !imported || pool.Owner != owner || original.Status == "revoked" || pool.Status != "revoked" {
				continue
			}
			if pool.SourceAnchor != m.StateHash || pool.LastAction != ActionResourcePoolStatus || pool.LastSigner != owner || pool.AuditHash != resourcePoolAuditHash(pool) {
				return 0, 0, errors.New("PQ contract source resource refund lacks its exact owner update")
			}
			matchedAudit, matchedSnapshot := 0, 0
			for _, audit := range s.ResourceSponsorAudit {
				if audit.TxHash == pool.TxHash && audit.Action == pool.LastAction && audit.Signer == owner && audit.PoolID == pool.ID && audit.ObjectID == pool.ID && audit.BlockHeight == pool.BlockHeight && audit.CreatedAt.Equal(pool.UpdatedAt) && audit.AuditHash == resourceSponsorAuditHash(audit) {
					matchedAudit++
					for _, idem := range s.ResourceSponsorIdempotency {
						if idem.TxHash == audit.TxHash && idem.Action == audit.Action && idem.Signer == owner && idem.RequestHash == audit.RequestHash && idem.ObjectType == "pool" && idem.ObjectID == pool.ID && idem.PoolSnapshot != nil && reflect.DeepEqual(*idem.PoolSnapshot, pool) {
							matchedSnapshot++
						}
					}
				}
			}
			if matchedAudit != 1 || matchedSnapshot != 1 {
				return 0, 0, errors.New("PQ contract source resource refund lacks one exact audit and replay snapshot")
			}
			// New funding first increased usage. Remove only the net release of
			// the original allowance, never that newly added funding again.
			bandwidth := maxZero(original.CumulativeAllowance.Bandwidth - pool.Consumed.Bandwidth)
			compute := maxZero(original.CumulativeAllowance.Compute - pool.Consumed.Compute)
			if err := add(pool.BlockHeight, bandwidth, compute); err != nil {
				return 0, 0, err
			}
		}
	}
	return maxZero(base[0] - released[0]), maxZero(base[1] - released[1]), nil
}

func pqContractReceiptMatchesTransition(r BFTEVMReceipt, address string, t chain.BoundedContractTransition) error {
	expected := BFTEVMReceipt{TxHash: r.TxHash, From: r.From, To: address, Action: ActionIDEContractCall, Status: "success", EncodedResult: t.EncodedResult, OpcodeStepCount: t.StepCount, StorageWrites: t.StorageWrites, Logs: []BFTEVMLog{}, BlockHeight: r.BlockHeight}
	for _, event := range t.Logs {
		log := BFTEVMLog{Address: address, Topics: append([]string(nil), event.Topics...), Data: event.Data, BlockHeight: r.BlockHeight, TxHash: r.TxHash}
		log.AuditHash = bftEVMLogAuditHash(log)
		expected.Logs = append(expected.Logs, log)
	}
	expected.AuditHash = bftEVMReceiptAuditHash(expected)
	if !reflect.DeepEqual(r, expected) {
		return errors.New("ABCI contract receipt differs from real runtime result, writes or logs")
	}
	return nil
}

func pqClassicCalldata(a chain.ContractArtifact, r BFTEVMReceipt) (string, error) {
	if len(r.Logs) != 1 || !ideWordPattern.MatchString(r.Logs[0].Data) {
		return "", errors.New("classic contract call lacks reconstructible semantic arguments")
	}
	log := r.Logs[0]
	switch a.Name {
	case ynxauth.ContractCounterName:
		slot, ok := a.RuntimeStorageSlots["count"]
		if !ok {
			return "", errors.New("counter slot missing")
		}
		key := fmt.Sprintf("0x%064x", slot)
		before := new(big.Int)
		if value, ok := a.RuntimeStorage[key]; ok {
			if _, ok = before.SetString(strings.TrimPrefix(value, "0x"), 16); !ok {
				return "", errors.New("invalid counter prestate")
			}
		}
		after, _ := new(big.Int).SetString(log.Data[2:], 16)
		by := new(big.Int).Sub(after, before)
		if by.Sign() < 0 || by.BitLen() > 256 {
			return "", errors.New("classic counter reset is not replayable")
		}
		return "0x7cf5dab0" + fmt.Sprintf("%064x", by), nil
	case ynxauth.ContractERC20Name:
		if len(log.Topics) != 3 || !ideWordPattern.MatchString(log.Topics[2]) || log.Topics[2][2:26] != strings.Repeat("0", 24) {
			return "", errors.New("classic ERC20 lacks canonical recipient")
		}
		return "0xa9059cbb" + log.Topics[2][2:] + log.Data[2:], nil
	default:
		return "", errors.New("classic call is outside bounded PQ contract history")
	}
}
