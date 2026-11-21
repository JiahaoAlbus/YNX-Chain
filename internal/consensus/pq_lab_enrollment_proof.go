package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// PQLabLegacyFundingType names the existing classic transfer wire only for
// proving historical funding, not for admitting or authorizing new transfers.
const PQLabLegacyFundingType = "YNX-LAB-LEGACY-FUNDING/v1"

// PQLabEnrollmentPins must be supplied independently by the holder of the two
// original operations. They are expectations, never evidence or authority.
// The current policy, balance, nonce and signer are intentionally not inferred.
type PQLabEnrollmentPins struct {
	OriginalGenesis      []byte
	NativeChainID        uint64
	FundingSource, Owner string
	FundingAmount        uint64
	PKA, PKB             []byte
	ActivationHeight     uint64
}

type PQLabEnrollmentOriginal struct {
	Expected PQTransactionProofExpectation
	Proof    PQTransactionProofRequest
}

// PQLabEnrollmentProof is historical data only. UNKNOWN remains the result for
// current eligibility even when both original execution results were finalized.
type PQLabEnrollmentProof struct {
	Classification     string                   `json:"classification"`
	Funding            PQTransactionProofResult `json:"funding"`
	Migration          PQTransactionProofResult `json:"migration"`
	CurrentEligibility string                   `json:"currentEligibility"`
	NativeGrant        bool                     `json:"nativeGrant"`
}

// VerifyPQLabEnrollmentOriginals independently verifies inclusion and execution
// against H and H+1 for the exact original PQ funding and initial migration.
// The host must independently authenticate trust and pin BOTH complete original
// operations; inputs obtained from one RPC cannot create trust. A successful
// historical result never grants current account/signing/retry authority. In
// particular activation, later revocation, current nonce and current balance
// require separately authenticated current state.
// This API has no operation ID and cannot join or release a caller's pending
// operation. The caller must use independently held original request/outbox
// identities, including original operation IDs, owner and nonce, and bind each
// to its exact Expected envelope/native wire and both hashes. Owner, amount and
// height alone are never an operation identity or authorization to retry.
func VerifyPQLabEnrollmentOriginals(trust PQLightProofTrust, pins PQLabEnrollmentPins, funding, migration PQLabEnrollmentOriginal) (PQLabEnrollmentProof, error) {
	out := PQLabEnrollmentProof{CurrentEligibility: "UNKNOWN"}
	if trust.Snapshot == nil || trust.Snapshot.bootstrap == nil || len(pins.OriginalGenesis) != 32 || pins.NativeChainID == 0 || pins.FundingAmount == 0 || pins.ActivationHeight == 0 || len(pins.PKA) != ynxbatch.PublicKeyASize || len(pins.PKB) != ynxbatch.PublicKeyBSize {
		return out, errors.New("missing independently pinned enrollment identity")
	}
	if hex.EncodeToString(pins.OriginalGenesis) != trust.Snapshot.bootstrap.record.OriginalGenesisHash {
		return out, errors.New("enrollment native genesis differs from trusted bootstrap")
	}
	if (funding.Expected.TransactionType != PQTransferType && funding.Expected.TransactionType != PQLabLegacyFundingType) || migration.Expected.TransactionType != PQMigrationType {
		return out, errors.New("enrollment requires original native funding and PQ migration")
	}
	if funding.Expected.TransactionType == PQTransferType {
		member, err := ynxbatch.DecodeMember(funding.Expected.NativeWire)
		if err != nil {
			return out, fmt.Errorf("original funding member: %w", err)
		}
		transfer, err := ynxauth.DecodeTransfer(member.Message)
		if err != nil {
			return out, fmt.Errorf("original funding message: %w", err)
		}
		if !bytes.Equal(transfer.ChainID, pins.OriginalGenesis) || transfer.NativeChainID != pins.NativeChainID || transfer.From != pins.FundingSource || transfer.To != pins.Owner || transfer.Amount != pins.FundingAmount {
			return out, errors.New("original PQ funding does not match independent pins")
		}
	} else {
		tx, err := DecodeSignedTransaction(funding.Expected.NativeWire)
		if err != nil {
			return out, fmt.Errorf("original legacy funding: %w", err)
		}
		if err = tx.Verify(tx.ChainID); err != nil {
			return out, fmt.Errorf("original legacy funding signature: %w", err)
		}
		if uint64(tx.ChainID) != pins.NativeChainID || tx.From != pins.FundingSource || tx.To != pins.Owner || uint64(tx.Amount) != pins.FundingAmount {
			return out, errors.New("original legacy funding does not match independent pins")
		}
	}
	m, err := ynxauth.DecodeMigration(migration.Expected.NativeWire)
	if err != nil {
		return out, fmt.Errorf("original migration: %w", err)
	}
	i := m.Intent
	if !bytes.Equal(i.ChainID, pins.OriginalGenesis) || i.Owner != pins.Owner || !bytes.Equal(i.PKA, pins.PKA) || !bytes.Equal(i.PKB, pins.PKB) || i.PriorRevision != 0 || i.NewRevision != 1 || i.LedgerNonce != 1 || i.ActivateAt != pins.ActivationHeight {
		return out, errors.New("original initial migration does not match independent pins")
	}
	f, err := verifyTransactionProof(trust, funding.Expected, funding.Proof, true)
	if err != nil {
		return out, fmt.Errorf("original funding proof: %w", err)
	}
	if !f.Included || !f.Finalized || !f.ExecutionSuccessful || f.Outcome != "succeeded" || f.NativeGrant {
		return out, errors.New("original funding not finalized successfully")
	}
	mResult, err := VerifyPQTransactionProof(trust, migration.Expected, migration.Proof)
	if err != nil {
		return out, fmt.Errorf("original migration proof: %w", err)
	}
	if !mResult.Included || !mResult.Finalized || !mResult.ExecutionSuccessful || mResult.Outcome != "succeeded" || mResult.NativeGrant {
		return out, errors.New("original migration not finalized successfully")
	}
	if f.Block.GenesisSHA256 != mResult.Block.GenesisSHA256 || f.Block.ChainID != mResult.Block.ChainID || f.Height > mResult.Height || i.ActivateAt <= uint64(mResult.Height) {
		return out, errors.New("enrollment operations do not establish ordered same-chain history")
	}
	if f.Height == mResult.Height {
		if err = verifyEnrollmentSameBlock(f, mResult); err != nil {
			return out, err
		}
		return PQLabEnrollmentProof{Classification: "data", Funding: f, Migration: mResult, CurrentEligibility: "UNKNOWN"}, nil
	}
	if err = verifyEnrollmentTransition(trust, funding, migration, f, mResult); err != nil {
		return out, err
	}
	return PQLabEnrollmentProof{Classification: "data", Funding: f, Migration: mResult, CurrentEligibility: "UNKNOWN"}, nil
}

// The callers already validated both full proofs and matched their heights.
func verifyEnrollmentSameBlock(f, m PQTransactionProofResult) error {
	if f.Index >= m.Index || f.Total != m.Total || f.Block.BlockHash != m.Block.BlockHash || f.Successor.BlockHash != m.Successor.BlockHash {
		return errors.New("same-block enrollment originals differ or funding does not precede migration")
	}
	return nil
}

// Only called after independently verifying both complete transaction proofs.
func verifyEnrollmentTransition(trust PQLightProofTrust, funding, migration PQLabEnrollmentOriginal, f, mResult PQTransactionProofResult) error {
	if f.Successor.HeaderHeight == mResult.Block.HeaderHeight {
		if f.Successor.BlockHash != mResult.Block.BlockHash {
			return errors.New("funding successor differs from migration block")
		}
	} else {
		// Re-use only the successor that the funding proof already authenticated.
		// A normal light transition from it binds the later migration to that
		// history; two proofs under the same genesis alone do not do so.
		var commit coretypes.ResultCommit
		var validators coretypes.ResultValidators
		if err := pqLightDecodeComet(funding.Proof.Successor.CommitResult, "commit-result", &commit, maxPQLightCommitBytes); err != nil {
			return err
		}
		if err := pqLightDecodeComet(funding.Proof.Successor.ValidatorsResult, "validators-result", &validators, maxPQLightValidatorsBytes); err != nil {
			return err
		}
		set := &cmttypes.ValidatorSet{Validators: validators.Validators}
		for _, v := range set.Validators {
			if bytes.Equal(v.Address, commit.ProposerAddress) {
				set.Proposer = v
			}
		}
		nextTrust := trust
		nextTrust.TrustedLightBlock = &cmttypes.LightBlock{SignedHeader: &commit.SignedHeader, ValidatorSet: set}
		if _, err := VerifyPQLightProof(nextTrust, migration.Expected.Block, migration.Proof.Block); err != nil {
			return fmt.Errorf("funding-to-migration light transition: %w", err)
		}
	}
	return nil
}
