package consensus

import (
	"encoding/hex"
	"errors"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	abci "github.com/cometbft/cometbft/abci/types"
)

const PQInitialRegistrationType = "account_initial"
const pqInitialRegistrationMemo = "ynx-pq-account-initial-v1:"

// EncodePQInitialRegistrationTransaction uses the normal three-field canonical
// ABCI transport. The wire is the original TX-BATCH Member, not a JSON key grant.
func EncodePQInitialRegistrationTransaction(wire []byte) ([]byte, error) {
	if _, _, err := ynxauth.DecodePQInitialRegistrationMember(wire); err != nil {
		return nil, err
	}
	return EncodePQTransaction(PQInitialRegistrationType, wire)
}

func DecodePQInitialRegistrationTransaction(payload []byte) ([]byte, ynxauth.RegistrationIntent, error) {
	var zero ynxauth.RegistrationIntent
	envelope, wire, err := DecodePQTransaction(payload)
	if err != nil {
		return nil, zero, err
	}
	if envelope.Type != PQInitialRegistrationType {
		return nil, zero, errors.New("not an initial account registration transport")
	}
	intent, _, err := ynxauth.DecodePQInitialRegistrationMember(wire)
	return wire, intent, err
}

func initialOwnerOccupied(state executionState, owner string) bool {
	if _, exists := nativeAccountAt(state, owner); exists {
		return true
	}
	for _, contract := range state.contracts {
		if contract.Address == owner {
			return true
		}
	}
	for _, account := range state.smartAccounts {
		if account.Address == owner {
			return true
		}
	}
	return false
}

// The caller is Application's normal locked/isolated transaction executor.
// Only the immutable independent bootstrap supplies the authoritative full pair.
func (a *Application) applyPQInitialRegistration(state executionState, payload []byte, height int64, at time.Time) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if height <= 0 || state.hashVersion != 0 || state.accountPolicy == nil || state.bootstrap == nil || state.bootstrap != a.bootstrap {
		return fail(errors.New("initial registration requires the actual pinned bootstrap, policy and execution height"))
	}
	wire, intent, err := DecodePQInitialRegistrationTransaction(payload)
	if err != nil {
		return fail(err)
	}
	trusted, err := state.bootstrap.initialAccountRegistration(intent.Owner, uint64(height))
	if err != nil {
		return fail(err)
	}
	occupied, err := a.initialOwnerRequiresVacancy(state, intent.Owner)
	if err != nil {
		return fail(err)
	}
	next, err := state.accountPolicy.AdmitPQInitialRegistration(wire, trusted, uint64(height), occupied)
	if err != nil {
		return fail(err)
	}
	nativeHash, abciHash := SignedTransactionHash(wire), SignedTransactionHash(payload)
	for _, previous := range state.pqHistory {
		if previous.Transaction.Hash == nativeHash {
			return fail(errors.New("initial registration original wire was already consumed"))
		}
	}
	state.accounts = cloneExecutionAccounts(state)
	state.nativeAccounts = nil
	state.accounts, _ = ensureAccount(state.accounts, intent.Owner)
	index, _ := accountIndex(state.accounts, intent.Owner)
	// No faucet, lots, allocation, sponsorship or global fee policy is changed.
	// Bandwidth records one actual admitted operation; no resource is granted.
	state.accounts[index].Nonce = 1
	state.accounts[index].ResourceUsage.BandwidthUsed = 1
	state.accountPolicy = &next
	tx := chain.Transaction{Hash: nativeHash, Type: PQInitialRegistrationType, From: intent.Owner, To: intent.Owner, Nonce: 1, BlockNum: uint64(height), Timestamp: at.UTC(), Memo: pqInitialRegistrationMemo + hex.EncodeToString(wire)}
	state.pqHistory = append(clonePQHistory(state.pqHistory), PQCommittedAuthorization{ABCITransactionHash: abciHash, Transaction: tx})
	return state, transactionExecution{typeName: PQInitialRegistrationType, hash: abciHash, event: abci.Event{Type: "ynx.account_initial", Attributes: []abci.EventAttribute{{Key: "owner", Value: intent.Owner, Index: true}, {Key: "revision", Value: "1"}, {Key: "birth_fee", Value: "0"}}}}, nil
}

func (b *ConsensusBootstrap) refusesInitialLegacyOwner(owner string) bool {
	if b == nil || b.record.PQInitialAccounts == nil {
		return false
	}
	for _, binding := range b.record.PQInitialAccounts.Accounts {
		if binding.Owner == owner {
			return true
		}
	}
	return false
}

// Do not let an unsolicited transfer occupy a reserved fresh address before
// its owner's explicit birth. Funding is ordinary execution after registration.
func (b *ConsensusBootstrap) refusesUnregisteredInitialRecipient(policy *ynxauth.State, owner string) bool {
	if !b.refusesInitialLegacyOwner(owner) {
		return false
	}
	if policy != nil {
		for _, record := range policy.Records {
			if record.Owner == owner && record.Revision == 1 {
				return false
			}
		}
	}
	return true
}
