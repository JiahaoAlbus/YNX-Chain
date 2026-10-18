package chain

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"reflect"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func pqContractPostState(tx Transaction, a ynxauth.Action, payload any, r *pqContractReceipt) (ContractArtifact, error) {
	if r == nil {
		return ContractArtifact{}, errors.New("missing contract execution receipt")
	}
	if err := validatePQContractReceiptShape(*r); err != nil {
		return ContractArtifact{}, err
	}
	before := r.Artifact
	if tx.To != before.Address || tx.Amount != 0 || tx.From != a.Owner || tx.Fee != int64(a.Fee) || !pqContractWord(tx.Hash) {
		return ContractArtifact{}, errors.New("contract receipt execution fields differ from signed action")
	}
	if (before.PQAnchorTransactionHash == "") != (len(r.ArtifactFile) > 0) {
		return ContractArtifact{}, errors.New("contract first anchor and retained material disagree")
	}
	switch p := payload.(type) {
	case ynxauth.ContractDeployPayload:
		if tx.Type != "contract_deploy" || a.Fee != ynxauth.ContractDeployFee || r.Transition != nil || before.PQAnchorTransactionHash != "" || before.Address != pqContractAddress(tx.Hash) || before.Deployer != a.Owner || !before.DeployedAt.Equal(tx.Timestamp) || before.Name != p.Name || before.SourceHash != p.SourceHash || before.DeployedBytecodeHash != p.DeployedBytecodeHash || before.CompilerConfigHash != p.CompilerConfigHash || len(before.ConstructorArgs) != 1 || before.ConstructorArgs[0] != fmt.Sprint(p.ConstructorArgs[0]) {
			return ContractArtifact{}, errors.New("deployment receipt differs from signed identity or constructor")
		}
		if err := validatePQContractArtifact(*r); err != nil {
			return ContractArtifact{}, err
		}
		if !reflect.DeepEqual(before.RuntimeStorage, BoundedContractInitialStorage(r.Source, a.Owner, before.ConstructorArgs)) {
			return ContractArtifact{}, errors.New("deployment storage differs from actual constructor seed")
		}
		before.PQAnchorTransactionHash = tx.Hash
		return before, nil
	case ynxauth.ContractExecutePayload:
		commitment, err := ContractExecutionStateCommitment(before)
		if err != nil || commitment != p.ExpectedStorageCommitment || tx.Type != "contract_call" || a.Fee != ynxauth.ContractExecuteFee || r.Transition == nil || before.Address != p.Target || before.Name != p.Name || before.SourceHash != p.SourceHash || before.DeployedBytecodeHash != p.DeployedBytecodeHash || before.CompilerConfigHash != p.CompilerConfigHash || before.DeployedAt.IsZero() || before.DeployedAt.After(tx.Timestamp) {
			return ContractArtifact{}, errors.New("contract receipt differs from signed complete execution prestate")
		}
		if len(r.ArtifactFile) > 0 {
			if err := validatePQContractArtifact(*r); err != nil {
				return ContractArtifact{}, err
			}
		}
		transition, err := ExecuteConsensusSourceContract(before, r.Bytecode, p.Calldata, a.Owner, before.RuntimeStorage)
		if err != nil {
			return ContractArtifact{}, err
		}
		if !reflect.DeepEqual(transition, *r.Transition) {
			return ContractArtifact{}, errors.New("contract receipt differs from actual bytecode storage/log/result transition")
		}
		before.RuntimeStorage = transition.Storage
		if before.PQAnchorTransactionHash == "" {
			before.PQAnchorTransactionHash = tx.Hash
		}
		return before, nil
	default:
		return ContractArtifact{}, ynxauth.ErrAction
	}
}

func validateHistoricalPQContractAction(tx Transaction, h pqActionHistory, payload any, state *ynxauth.State, height uint64) error {
	if _, err := pqContractPostState(tx, h.Action, payload, h.Contract); err != nil {
		return err
	}
	if err := validatePQUnsignedExecutionMetadata(tx); err != nil {
		return err
	}
	var total int64
	var recipient, previous string
	for _, flow := range tx.LotFlows {
		if recipient == "" {
			recipient = flow.To
		}
		if flow.From != h.Action.Owner || flow.To == "" || flow.To != recipient || flow.LotID == "" || flow.LotID <= previous || flow.Amount <= 0 || flow.Amount > tx.Fee-total {
			return errors.New("contract fee provenance differs from executed fee")
		}
		total += flow.Amount
		previous = flow.LotID
	}
	if total != tx.Fee {
		return errors.New("contract fee lacks complete traceable flow")
	}
	var index, first uint64
	if tx.BlockNum > 0 && len(tx.Logs) > 0 {
		index, first = tx.Logs[0].TransactionIndex, tx.Logs[0].LogIndex
	}
	if err := validatePQContractLogs(tx, h.Contract, index, first); err != nil {
		return err
	}
	return state.VerifyMember(h.Action.Owner, ynxauth.TransactionPurpose, h.Message, h.Wire, height)
}

// Derive logs from the verified transition, never from the log being checked.
// Existing contract_call production carries raw execution logs while pending;
// the producer later prefixes its system log and assigns actual block indices.
func validatePQContractLogs(tx Transaction, r *pqContractReceipt, txIndex, firstLog uint64) error {
	if r == nil {
		return errors.New("missing contract log receipt")
	}
	projection := tx
	projection.Logs = nil
	if r.Transition != nil {
		projection.Logs = evmLogsFromExecutionLogs(contractExecutionLogs(tx.To, r.Transition.Logs))
	}
	if tx.BlockNum == 0 {
		if tx.BlockHash != "" || !reflect.DeepEqual(tx.Logs, projection.Logs) {
			return errors.New("pending contract logs differ from raw verified execution")
		}
		return nil
	}
	if tx.BlockHash == "" {
		return errors.New("mined contract lacks block identity")
	}
	d := Devnet{contracts: map[string]ContractArtifact{tx.To: r.Artifact}}
	expected := d.evmLogsForTransactionLocked(projection, txIndex, firstLog)
	if !reflect.DeepEqual(tx.Logs, expected) {
		return errors.New("contract logs differ from verified execution and actual block positions")
	}
	return nil
}

type pqContractReplay struct {
	artifact  ContractArtifact
	bytecode  string
	firstHash string
}

// No-anchor contracts retain the old snapshot validation boundary. The first
// PQ execute anchors its complete, signed current prestate; it does not claim
// to reconstruct forgotten legacy calldata or historical VerifyContract resets.
// Thereafter every call to that target, including lawful classic callers, is
// replayed in containing-block order followed by pending order. Verification
// metadata can change publicly, but all execution identity and storage must
// match the final snapshot. This performs no filesystem access or compilation.
func validatePQContractSnapshot(s devnetSnapshot) error {
	if len(s.Blocks) == 0 {
		return nil
	}
	progress := map[string]pqContractReplay{}
	origins := map[string]pqSourceLotOrigin{}
	var ordinal uint64
	rememberOrigin := func(tx Transaction) {
		ordinal++
		if tx.Type == "faucet" {
			for _, f := range tx.LotFlows {
				_, duplicate := origins[f.LotID]
				valid := !duplicate && len(tx.LotFlows) == 1 && tx.From == FaucetAddress && tx.Amount > 0 && tx.Fee == 0 && f.LotID != "" && f.From == FaucetAddress && f.To == tx.To && f.To != "" && f.Amount == tx.Amount
				origins[f.LotID] = pqSourceLotOrigin{amount: tx.Amount, ordinal: ordinal, valid: valid}
			}
		}
	}
	// Collect the complete catalog first: even a later duplicate issuance must
	// invalidate the purported unique origin of an earlier fee flow.
	for _, block := range s.Blocks {
		for _, tx := range block.Transactions {
			rememberOrigin(tx)
		}
	}
	for _, tx := range s.Pending {
		rememberOrigin(tx)
	}
	ordinal = 0
	visit := func(tx Transaction, height, txIndex, firstLog uint64, mined bool, blockHash string) error {
		ordinal++
		var h pqActionHistory
		if strings.HasPrefix(tx.Memo, pqActionMemo) {
			var err error
			h, err = decodePQActionMemo(tx.Memo)
			if err != nil {
				return err
			}
		}
		prior, anchored := progress[tx.To]
		if mined && (h.Contract != nil || anchored && tx.Type == "contract_call") && (tx.BlockNum != height || tx.BlockHash != blockHash) {
			return errors.New("contract execution differs from its actual containing block")
		}
		if h.Contract != nil {
			p, err := ynxauth.DecodeActionPayload(h.Action.Kind, h.Action.Payload)
			if err != nil {
				return err
			}
			next, err := pqContractPostState(tx, h.Action, p, h.Contract)
			if err != nil {
				return err
			}
			if anchored {
				if h.Action.Kind == ynxauth.ActionContractDeploy || h.Contract.Source != "" || len(h.Contract.ArtifactFile) != 0 || h.Contract.Bytecode != prior.bytecode {
					return errors.New("contract history rewrites or repeats its original anchor")
				}
				want, err := ContractExecutionStateCommitment(prior.artifact)
				if err != nil {
					return err
				}
				got, err := ContractExecutionStateCommitment(h.Contract.Artifact)
				if err != nil || got != want {
					return errors.New("contract prestate is not the preceding actual transaction state")
				}
			} else {
				if h.Contract.Artifact.PQAnchorTransactionHash != "" {
					return errors.New("contract history omits its first PQ receipt")
				}
				if err := validatePQContractArtifact(*h.Contract); err != nil {
					return err
				}
				prior.firstHash = tx.Hash
			}
			if !mined && (tx.BlockNum != 0 || tx.BlockHash != "") {
				return errors.New("pending contract claims block inclusion")
			}
			if err := validatePQContractLogs(tx, h.Contract, txIndex, firstLog); err != nil {
				return err
			}
			// Account-policy and contract fees share the same native fee-flow
			// representation. This local projection reuses its lineage validator;
			// the original transaction type and signature are never rewritten.
			feeProjection := tx
			feeProjection.Type = "account_revocation"
			if err := validatePQSourceLotFlows(feeProjection, s, origins, ordinal); err != nil {
				return err
			}
			progress[tx.To] = pqContractReplay{next, h.Contract.Bytecode, prior.firstHash}
			return nil
		}
		if !anchored {
			return nil
		}
		if tx.Type == "contract_deploy" {
			return errors.New("legacy deployment rewrites an anchored contract")
		}
		if tx.Type != "contract_call" {
			return nil
		}
		if s.AccountPolicy == nil {
			return errors.New("anchored legacy call lacks original account policy")
		}
		if err := s.AccountPolicy.RequireLegacy(tx.From, height); err != nil {
			return err
		}
		data, err := pqLegacyContractCalldata(tx, prior.artifact, mined)
		if err != nil {
			return err
		}
		transition, err := ExecuteConsensusSourceContract(prior.artifact, prior.bytecode, data, tx.From, prior.artifact.RuntimeStorage)
		if err != nil {
			return err
		}
		if err := validatePQContractLegacyLogs(tx, transition, mined, txIndex, firstLog); err != nil {
			return err
		}
		prior.artifact.RuntimeStorage = transition.Storage
		progress[tx.To] = prior
		return nil
	}
	for _, block := range s.Blocks {
		var first uint64
		for i, tx := range block.Transactions {
			if err := visit(tx, block.Height, uint64(i), first, true, block.Hash); err != nil {
				return fmt.Errorf("contract history at %d: %w", block.Height, err)
			}
			first += uint64(len(tx.Logs))
		}
	}
	height := s.Blocks[len(s.Blocks)-1].Height
	if height < math.MaxUint64 {
		height++
	}
	for _, tx := range s.Pending {
		if err := visit(tx, height, 0, 0, false, ""); err != nil {
			return err
		}
	}
	for address, replay := range progress {
		actual, ok := s.Contracts[address]
		if !ok || actual.PQAnchorTransactionHash != replay.firstHash {
			return errors.New("snapshot contract omits or replaces its original PQ anchor")
		}
		want, err := ContractExecutionStateCommitment(replay.artifact)
		if err != nil {
			return err
		}
		got, err := ContractExecutionStateCommitment(actual)
		if err != nil || got != want {
			return errors.New("snapshot contract differs from complete replayed execution state")
		}
	}
	for address, actual := range s.Contracts {
		if actual.PQAnchorTransactionHash != "" {
			replay, ok := progress[address]
			if !ok || replay.firstHash != actual.PQAnchorTransactionHash {
				return errors.New("snapshot PQ contract marker has no matching first receipt")
			}
		}
	}
	return nil
}

// A locally known anchor cannot be removed by a later full/final-batch import.
// Incoming state has already passed complete history replay. Pending execution
// can become mined (its materialized log positions change), but its original
// receipt and execution fields cannot be replaced. This continuity check does
// not authenticate an arbitrary cold snapshot: deletion of ALL evidence and
// state still requires an independent trusted checkpoint to detect rollback.
func validatePQContractContinuation(previous, next devnetSnapshot) error {
	known := make(map[string]struct{})
	for address, before := range previous.Contracts {
		if before.PQAnchorTransactionHash == "" {
			continue
		}
		after, exists := next.Contracts[address]
		if !exists || after.PQAnchorTransactionHash != before.PQAnchorTransactionHash {
			return errors.New("replication removes or replaces a known contract PQ anchor")
		}
		known[address] = struct{}{}
	}
	if len(known) == 0 {
		return nil
	}
	visit := func(s devnetSnapshot, fn func(Transaction) error) error {
		for _, block := range s.Blocks {
			for _, tx := range block.Transactions {
				if err := fn(tx); err != nil {
					return err
				}
			}
		}
		for _, tx := range s.Pending {
			if err := fn(tx); err != nil {
				return err
			}
		}
		return nil
	}
	retained := make(map[string]Transaction)
	if err := visit(next, func(tx Transaction) error {
		if _, tracked := known[tx.To]; tracked && (tx.Type == "contract_call" || tx.Type == "contract_deploy") {
			if _, duplicate := retained[tx.Hash]; duplicate {
				return errors.New("replication duplicates known contract execution")
			}
			retained[tx.Hash] = tx
		}
		return nil
	}); err != nil {
		return err
	}
	return visit(previous, func(before Transaction) error {
		if _, tracked := known[before.To]; !tracked || before.Type != "contract_call" && before.Type != "contract_deploy" {
			return nil
		}
		after, exists := retained[before.Hash]
		if !exists {
			return errors.New("replication removes known contract execution history")
		}
		if before.BlockNum == 0 {
			// Complete incoming replay binds the newly materialized logs to the
			// verified transition and actual containing block/index.
			after.BlockNum, after.BlockHash, after.Logs = 0, "", nil
			before.Logs = nil
		}
		if !reflect.DeepEqual(before, after) {
			return errors.New("replication replaces known contract execution history")
		}
		return nil
	})
}

// Counter history lacks its original calldata. Its sole checked addition can
// be replayed with the unique equivalent increment(postCount-preCount), but
// original text/case/trailing bytes cannot be recovered. ERC20 receipts retain
// their semantic arguments. Neither reconstruction creates a legacy signature.
func pqLegacyContractCalldata(tx Transaction, a ContractArtifact, mined bool) (string, error) {
	if tx.Amount != 0 || tx.Fee != 2 || len(tx.LotFlows) != 0 || tx.Timestamp.IsZero() {
		return "", errors.New("legacy contract receipt shape mismatch")
	}
	if err := validatePQUnsignedExecutionMetadata(tx); err != nil {
		return "", err
	}
	switch a.Name {
	case ynxauth.ContractCounterName:
		if tx.Memo != boundedContractCallMemo("increment(uint256)") {
			return "", errors.New("counter calldata cannot be reconstructed from legacy memo")
		}
		index, count := 0, 1
		if mined {
			index, count = 1, 2
		}
		if len(tx.Logs) != count || !pqContractWord(tx.Logs[index].Data) {
			return "", errors.New("counter history lacks its unique post-count execution log")
		}
		post, ok := new(big.Int).SetString(tx.Logs[index].Data[2:], 16)
		if !ok {
			return "", errors.New("invalid legacy counter value")
		}
		slot, exists := a.RuntimeStorageSlots["count"]
		if !exists {
			return "", errors.New("counter slot missing")
		}
		before := storageValue(a.RuntimeStorage, big.NewInt(int64(slot)))
		by := new(big.Int).Sub(post, before)
		if by.Sign() < 0 || by.BitLen() > 256 {
			return "", errors.New("counter history contains a non-replayable reset or overflow")
		}
		return "0x7cf5dab0" + fmt.Sprintf("%064x", by), nil
	case ynxauth.ContractERC20Name:
		parts := strings.Split(tx.Memo, ":")
		if len(parts) != 6 || parts[0] != "erc20-transfer" || parts[1] != "v1" || parts[2] != evmAddressForLog(tx.From) || parts[3] != evmAddressForLog(parts[3]) || len(parts[3]) != 42 || parts[5] != transferEventTopic(a) {
			return "", errors.New("ERC20 history lacks exact original transfer arguments")
		}
		amount, ok := new(big.Int).SetString(parts[4], 10)
		if !ok || amount.Sign() < 0 || amount.BitLen() > 256 || amount.Text(10) != parts[4] {
			return "", errors.New("invalid legacy ERC20 amount")
		}
		return "0xa9059cbb" + strings.Repeat("0", 24) + parts[3][2:] + fmt.Sprintf("%064x", amount), nil
	default:
		return "", errors.New("legacy call is outside anchored contract subset")
	}
}

func validatePQContractLegacyLogs(tx Transaction, transition BoundedContractTransition, mined bool, txIndex, firstLog uint64) error {
	raw := evmLogsFromExecutionLogs(contractExecutionLogs(tx.To, transition.Logs))
	if !mined {
		if tx.BlockNum != 0 || tx.BlockHash != "" {
			return errors.New("pending legacy call claims inclusion")
		}
		if strings.HasPrefix(tx.Memo, "erc20-transfer:") {
			raw = nil
		}
		if !reflect.DeepEqual(tx.Logs, raw) {
			return errors.New("pending legacy call does not preserve its actual log representation")
		}
		return nil
	}
	if tx.BlockNum == 0 || tx.BlockHash == "" {
		return errors.New("legacy contract lacks mined identity")
	}
	projection := tx
	projection.Memo = ""
	projection.Logs = raw
	expected := (&Devnet{}).evmLogsForTransactionLocked(projection, txIndex, firstLog)
	if !reflect.DeepEqual(tx.Logs, expected) {
		return errors.New("legacy contract logs do not match replayed bytecode and actual positions")
	}
	return nil
}
