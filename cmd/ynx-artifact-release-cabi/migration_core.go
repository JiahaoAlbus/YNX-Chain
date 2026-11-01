package main

import (
	"bytes"
	"errors"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	migrationABIVersion     = 1
	migrationWholeCapacity  = 98304
	migrationMessageMaximum = 4096 // existing RegistrationIntent E15 decoder
	migrationProofMaximum   = 128 << 10
)

type migrationExpected struct {
	NetworkID                                  []byte
	Owner                                      string
	NewRevision, CurrentNonce, ExecutionHeight string
	PKA, PKB                                   []byte
}

type migrationInputs struct {
	message, policy, classicPublicKey, classicSignature, currentPQProof []byte
	signingPKA, signingPKB                                              []byte
	expected                                                            migrationExpected
}

// This public plan is not account/Source approval, a trusted policy root, nonce
// reservation or broadcast permission. Main/Auth must select authentic current
// observations and approve the exact complete intent before its custody borrow.
type migrationPlan struct {
	message       []byte
	policy        ynxauth.State
	migration     ynxauth.Migration
	expected      migrationExpected
	height, nonce uint64
}

func migrationNonceDecimal(s string) (uint64, bool) {
	n, err := strconv.ParseUint(s, 10, 64)
	return n, err == nil && strconv.FormatUint(n, 10) == s
}

func prepareMigration(in migrationInputs, capacity uint64) (migrationPlan, resultCode) {
	if capacity != migrationWholeCapacity {
		return migrationPlan{}, resultCapacity
	}
	if len(in.message) == 0 || len(in.message) > migrationMessageMaximum || len(in.policy) == 0 || len(in.policy) > txPolicyMaximum ||
		len(in.classicPublicKey) > 33 || len(in.classicSignature) > 72 || len(in.currentPQProof) > migrationProofMaximum {
		return migrationPlan{}, resultBounds
	}
	e := in.expected
	height, heightOK := txPositiveDecimal(e.ExecutionHeight)
	nonce, nonceOK := migrationNonceDecimal(e.CurrentNonce)
	revision, revisionOK := txPositiveDecimal(e.NewRevision)
	if !heightOK || !nonceOK || !revisionOK || len(e.NetworkID) != 32 || !accountaddress.IsCanonical(e.Owner) ||
		len(e.PKA) != ynxbatch.PublicKeyASize || len(e.PKB) != ynxbatch.PublicKeyBSize ||
		!bytes.Equal(in.signingPKA, e.PKA) || !bytes.Equal(in.signingPKB, e.PKB) {
		return migrationPlan{}, resultPublicBinding
	}
	state, err := ynxauth.DecodeWalletPolicyProjection(in.policy, e.NetworkID, e.Owner)
	if err != nil {
		return migrationPlan{}, resultPublicBinding
	}
	intent, err := ynxauth.DecodeRegistrationIntent(in.message)
	if err != nil {
		return migrationPlan{}, resultPublicBinding
	}
	canonical, err := intent.SigningBytes()
	if err != nil || !bytes.Equal(canonical, in.message) || intent.Owner != e.Owner || !bytes.Equal(intent.ChainID, e.NetworkID) ||
		intent.NewRevision != revision || !bytes.Equal(intent.PKA, e.PKA) || !bytes.Equal(intent.PKB, e.PKB) {
		return migrationPlan{}, resultPublicBinding
	}
	m := ynxauth.Migration{Intent: intent, ClassicPublicKey: bytes.Clone(in.classicPublicKey),
		ClassicSignature: bytes.Clone(in.classicSignature), CurrentPQProof: bytes.Clone(in.currentPQProof)}
	// This original Core guard verifies the lawful old authority BEFORE the
	// proposed private pair is imported. It does not verify or install that pair.
	if state.ValidateMigrationAuthorization(m, height, nonce) != nil {
		return migrationPlan{}, resultPublicBinding
	}
	e.NetworkID, e.PKA, e.PKB = bytes.Clone(e.NetworkID), bytes.Clone(e.PKA), bytes.Clone(e.PKB)
	return migrationPlan{message: bytes.Clone(in.message), policy: state.Clone(), migration: m, expected: e, height: height, nonce: nonce}, resultOK
}

func inspectMigrationPossession(plan migrationPlan, wire []byte) error {
	if len(wire) == 0 || len(wire) > migrationWholeCapacity || len(wire) > migrationProofMaximum {
		return errors.New("migration possession bound")
	}
	whole, err := ynxbatch.DecodeWhole(wire)
	if err != nil || whole.Certificate.N != 1 || len(whole.Messages) != 1 ||
		whole.Certificate.Purpose != ynxauth.MigrationPurpose || !bytes.Equal(whole.Messages[0], plan.message) {
		return errors.New("migration fixed N1 Whole possession binding")
	}
	m := plan.migration
	m.NewKeyProof = wire
	// Original admission verifies CURRENT account authority and BOTH full new
	// signatures. The detached returned state is discarded; nothing is committed.
	_, err = plan.policy.AdmitMigration(m, plan.height, plan.nonce)
	return err
}

func signMigrationPrepared(plan migrationPlan, borrowed ynxbatch.KeyMaterial) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize ||
		len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	// Reject an exposed public-pair mismatch before reading either private span.
	if !bytes.Equal(borrowed.PKA, plan.expected.PKA) || !bytes.Equal(borrowed.PKB, plan.expected.PKB) {
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
	if !bytes.Equal(owned.PKA, plan.expected.PKA) || !bytes.Equal(owned.PKB, plan.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	var public ynxbatch.PublicKey
	var err error
	key, public, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil || !bytes.Equal(public.PKA, plan.expected.PKA) || !bytes.Equal(public.PKB, plan.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: plan.expected.NetworkID, Owner: plan.expected.Owner,
		Purpose: ynxauth.MigrationPurpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	candidate, err = batch.WholeWire()
	if err != nil || inspectMigrationPossession(plan, candidate) != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	// Only fixed ACCOUNT-MIGRATION N1 Whole possession DATA is released after
	// logical cleanup. Existing Main/Auth assembles and journals original E6.
	// No raw-purpose callback, secret, handle or detached next state exits.

	return candidate, resultOK, cleanupUnknown
}
