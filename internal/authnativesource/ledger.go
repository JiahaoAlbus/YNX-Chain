//go:build pay_pq

package paynativesource

import (
	"bytes"
	"context"
	"errors"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

var errLedgerUnavailable = errors.New("PAY_ORIGINAL_LEDGER_REGISTRATION_NOT_SUPPLIED")

// Concrete original ledger, never RPC-decoded Registration/Enabled:true.
// Only the private commissioning composition can attach its actual Devnet.
type originalLedger struct {
	node     *chain.Devnet
	genesis  []byte
	nativeID uint64
	engine   *originalPayEngineResources
}
type ledgerView struct {
	registration         ynxbatch.Registration
	height, epoch, nonce uint64
	committedHeight      int64
	committedHash        []byte
}

func (l *originalLedger) read(owner string) (ledgerView, error) {
	if l == nil || l.engine == nil {
		return ledgerView{}, errLedgerUnavailable
	}
	if l.engine.engine == OriginalPayBFTEngine {
		return l.readBFT(owner)
	}
	if l.engine.engine != OriginalPayNativeEngine || l.node != l.engine.native {
		return ledgerView{}, ErrPayEngineResources
	}
	if l.node == nil || len(l.genesis) != 32 || !accountaddress.IsCanonical(owner) {
		return ledgerView{}, errLedgerUnavailable
	}
	d := l.node.AccountAuthorizationDetails(owner)
	return resolveOriginalLedgerDetails(l.genesis, owner, d)
}

// DATA projection helper; not an authority constructor. The normal caller
// above always obtains the details from the actual retained ledger instance.
func resolveOriginalLedgerDetails(genesis []byte, owner string, d chain.AccountAuthorizationDetail) (ledgerView, error) {
	if d.State == nil || !accountaddress.IsCanonical(owner) || len(genesis) != 32 || !bytes.Equal(d.State.NetworkID, genesis) || d.ExecutionHeight == 0 {
		return ledgerView{}, errLedgerUnavailable
	}
	r, e := d.State.TrustedRegistration(owner, "TX-BATCH", d.ExecutionHeight)
	if e != nil {
		return ledgerView{}, e
	}
	record, active := d.State.PolicyAt(owner, d.ExecutionHeight)
	if !active || record.Revision == 0 {
		return ledgerView{}, errLedgerUnavailable
	}
	// Original resolver validates complete history/revocation/full pair. The
	// node's producer tip/nonce is NOT promoted to BFT finality here.
	return ledgerView{registration: r, height: d.ExecutionHeight, epoch: record.Revision, nonce: d.LedgerNonce}, nil
}

// Original App typed committed read detaches the complete global account
// policy under one RLock. Wallet query owner projections are never authority.
func (l *originalLedger) readBFT(owner string) (ledgerView, error) {
	if l.engine == nil || l.engine.view == nil || l.engine.application == nil || len(l.genesis) != 32 || !accountaddress.IsCanonical(owner) {
		return ledgerView{}, errLedgerUnavailable
	}
	state, e := l.engine.view.LoadState()
	if e != nil {
		return ledgerView{}, e
	}
	view, e := readOriginalBFTAccountDATA(context.Background(), l.engine.application, state.ChainID, state.LastBlockHeight, state.AppHash, l.genesis, l.nativeID, owner)
	if e != nil {
		return ledgerView{}, e
	}
	after, e := l.engine.view.LoadState()
	if e != nil {
		return ledgerView{}, e
	}
	if after.ChainID != state.ChainID || after.LastBlockHeight != state.LastBlockHeight || !bytes.Equal(after.AppHash, state.AppHash) || !after.LastBlockID.Equals(state.LastBlockID) {
		return ledgerView{}, ErrDenied
	}
	if _, e = l.engine.application.ConsensusAuthorityForState(after.ChainID, after.LastBlockHeight, after.AppHash); e != nil {
		return ledgerView{}, e
	}
	return view, nil
}
func (l *originalLedger) current(owner string, expected ledgerView, spend bool) error {
	actual, e := l.read(owner)
	if e != nil {
		return e
	}
	if actual.epoch != expected.epoch || actual.registration.PolicyRevision != expected.registration.PolicyRevision || !bytes.Equal(actual.registration.PKA, expected.registration.PKA) || !bytes.Equal(actual.registration.PKB, expected.registration.PKB) {
		return errLedgerUnavailable
	}
	if spend && (expected.nonce == math.MaxUint64 || actual.nonce != expected.nonce || actual.height != expected.height) {
		return errors.New("PAY_ORIGINAL_NONCE_HEIGHT_CHANGED")
	}
	return nil
}

// Same real typed App/checkpoint-bound callee used above, factored only for
// targeted original-engine controls. No account DTO/callback can supply it.
func readOriginalBFTAccountDATA(ctx context.Context, app *consensus.Application, chainID string, committed int64, appHash, genesis []byte, nativeID uint64, owner string) (ledgerView, error) {
	if ctx == nil || app == nil || len(appHash) != 32 || len(genesis) != 32 || !accountaddress.IsCanonical(owner) {
		return ledgerView{}, errLedgerUnavailable
	}
	if e := ctx.Err(); e != nil {
		return ledgerView{}, e
	}
	if _, e := app.ConsensusAuthorityForState(chainID, committed, appHash); e != nil {
		return ledgerView{}, e
	}
	view, e := app.CommittedAccountAuthorizationForState(chainID, committed, appHash, owner)
	if e != nil {
		return ledgerView{}, e
	}
	if view.Owner != owner || view.Policy == nil || view.CommittedHeight != committed || !bytes.Equal(view.CommittedAppHash[:], appHash) || !bytes.Equal(view.Policy.NetworkID, genesis) || nativeID == 0 || view.NativeChainID <= 0 || uint64(view.NativeChainID) != nativeID || committed <= 0 || committed == math.MaxInt64 || view.ExecutionHeight != uint64(committed)+1 {
		return ledgerView{}, errLedgerUnavailable
	}
	registration, e := view.Policy.TrustedRegistration(owner, ynxauth.TransactionPurpose, view.ExecutionHeight)
	if e != nil {
		return ledgerView{}, e
	}
	record, active := view.Policy.PolicyAt(owner, view.ExecutionHeight)
	if !active || record.Revision == 0 {
		return ledgerView{}, errLedgerUnavailable
	}
	if _, e = app.ConsensusAuthorityForState(chainID, committed, appHash); e != nil {
		return ledgerView{}, e
	}
	if e = ctx.Err(); e != nil {
		return ledgerView{}, e
	}
	return ledgerView{registration: registration, height: view.ExecutionHeight, epoch: record.Revision, nonce: view.LedgerNonce, committedHeight: committed, committedHash: bytes.Clone(appHash)}, nil
}
