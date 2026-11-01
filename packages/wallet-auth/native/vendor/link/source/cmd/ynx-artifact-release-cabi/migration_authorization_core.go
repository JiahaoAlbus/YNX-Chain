package main

import (
	"bytes"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const migrationAuthorizationCapacity = 98304

type migrationAuthorizationExpected struct {
	NetworkID                                             []byte
	Owner, CurrentRevision, CurrentNonce, ExecutionHeight string
	CurrentPKA, CurrentPKB                                []byte
}

type migrationAuthorizationInputs struct {
	message, policy, signingPKA, signingPKB []byte
	expected                                migrationAuthorizationExpected
}

type migrationAuthorizationPlan struct {
	message       []byte
	intent        ynxauth.RegistrationIntent
	policy        ynxauth.State
	expected      migrationAuthorizationExpected
	height, nonce uint64
}

// Public DATA checks precede every private read. Neither the plan nor the
// returned CURRENT proof supplies the independent proposed-key Whole proof,
// original Main/Auth review, trusted Source, approval, nonce reservation or a
// state transition. There are no classic inputs or a generic purpose selector.
func prepareMigrationAuthorization(in migrationAuthorizationInputs, capacity uint64) (migrationAuthorizationPlan, resultCode) {
	if capacity != migrationAuthorizationCapacity {
		return migrationAuthorizationPlan{}, resultCapacity
	}
	if len(in.message) == 0 || len(in.message) > migrationMessageMaximum || len(in.policy) == 0 || len(in.policy) > txPolicyMaximum {
		return migrationAuthorizationPlan{}, resultBounds
	}
	e := in.expected
	height, hok := txPositiveDecimal(e.ExecutionHeight)
	nonce, nok := migrationNonceDecimal(e.CurrentNonce)
	revision, rok := txPositiveDecimal(e.CurrentRevision)
	if !hok || !nok || !rok || len(e.NetworkID) != 32 || !accountaddress.IsCanonical(e.Owner) || len(e.CurrentPKA) != ynxbatch.PublicKeyASize || len(e.CurrentPKB) != ynxbatch.PublicKeyBSize ||
		!bytes.Equal(in.signingPKA, e.CurrentPKA) || !bytes.Equal(in.signingPKB, e.CurrentPKB) {
		return migrationAuthorizationPlan{}, resultPublicBinding
	}
	state, err := ynxauth.DecodeWalletPolicyProjection(in.policy, e.NetworkID, e.Owner)
	if err != nil {
		return migrationAuthorizationPlan{}, resultPublicBinding
	}
	intent, err := ynxauth.DecodeRegistrationIntent(in.message)
	if err != nil {
		return migrationAuthorizationPlan{}, resultPublicBinding
	}
	canonical, err := intent.SigningBytes()
	if err != nil || !bytes.Equal(canonical, in.message) || intent.Owner != e.Owner || !bytes.Equal(intent.ChainID, e.NetworkID) {
		return migrationAuthorizationPlan{}, resultPublicBinding
	}
	// Uses the original common admission preflight, then its actual current
	// policy resolver. Proposed intent keys cannot impersonate the active pair.
	record, err := state.ValidateCurrentPQMigrationIntent(intent, height, nonce)
	if err != nil || record.Revision != revision || !bytes.Equal(record.PKA, e.CurrentPKA) || !bytes.Equal(record.PKB, e.CurrentPKB) {
		return migrationAuthorizationPlan{}, resultPublicBinding
	}
	e.NetworkID, e.CurrentPKA, e.CurrentPKB = bytes.Clone(e.NetworkID), bytes.Clone(e.CurrentPKA), bytes.Clone(e.CurrentPKB)
	return migrationAuthorizationPlan{message: bytes.Clone(in.message), intent: intent, policy: state.Clone(), expected: e, height: height, nonce: nonce}, resultOK
}

func inspectMigrationAuthorization(plan migrationAuthorizationPlan, wire []byte) error {
	if len(wire) == 0 || len(wire) > migrationAuthorizationCapacity {
		return errors.New("current migration member bound")
	}
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return err
	}
	if m.Certificate.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || m.Certificate.Purpose != ynxauth.MigrationPurpose || m.Certificate.Owner != plan.expected.Owner ||
		!bytes.Equal(m.Certificate.ChainID, plan.expected.NetworkID) || !bytes.Equal(m.Certificate.PKA, plan.expected.CurrentPKA) || !bytes.Equal(m.Certificate.PKB, plan.expected.CurrentPKB) || !bytes.Equal(m.Message, plan.message) {
		return errors.New("current migration member binding")
	}
	// Recheck all original intent and CURRENT full-pair authorization semantics.
	// No new-key Whole proof exists here, so this can never admit the rotation.
	return plan.policy.ValidateMigrationAuthorization(ynxauth.Migration{Intent: plan.intent, CurrentPQProof: wire}, plan.height, plan.nonce)
}

func signMigrationAuthorizationPrepared(plan migrationAuthorizationPlan, borrowed ynxbatch.KeyMaterial) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize || len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize ||
		!bytes.Equal(borrowed.PKA, plan.expected.CurrentPKA) || !bytes.Equal(borrowed.PKB, plan.expected.CurrentPKB) {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var batch *ynxbatch.Batch
	var candidate []byte
	code, cleanup = resultInternal, cleanupUnknown
	defer func() {
		panicked := recover() != nil
		clean := runLogicalCleanup(func() { batch.Discard() }, func() { key.Destroy() }, func() { owned.Clear() })
		output, code, cleanup = finishPublication(candidate, code, panicked, clean)
	}()
	owned.PKCS8A = bytes.Clone(borrowed.PKCS8A)
	owned.PKCS8B = bytes.Clone(borrowed.PKCS8B)
	owned.PKA = bytes.Clone(borrowed.PKA)
	owned.PKB = bytes.Clone(borrowed.PKB)
	var public ynxbatch.PublicKey
	var err error
	key, public, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil || !bytes.Equal(public.PKA, plan.expected.CurrentPKA) || !bytes.Equal(public.PKB, plan.expected.CurrentPKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: plan.expected.NetworkID, Owner: plan.expected.Owner, Purpose: ynxauth.MigrationPurpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || inspectMigrationAuthorization(plan, candidate) != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	return candidate, resultOK, cleanupUnknown
}

func checkMigrationAuthorizationLayout(request memoryRange, public, private, outputs []memoryRange) resultCode {
	inputs := append(append(make([]memoryRange, 0, len(public)+len(private)), public...), private...)
	if code := checkMemoryLayout(request, inputs, outputs); code != resultOK {
		return code
	}
	// Reuse the corrected Core15 boundary: validate all extents/overflow first,
	// reject every public/PKCS8 cross-category overlap before any DATA copy.
	for _, p := range public {
		for _, secret := range private {
			if overlaps(p, secret) {
				return resultOverlap
			}
		}
	}
	return resultOK
}
