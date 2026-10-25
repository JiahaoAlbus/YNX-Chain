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
	txABIVersion     = 1
	txMemberCapacity = 98304
	txMessageMaximum = ynxauth.MaxActionBytes
	// The existing HTTP owner-policy parser owns these limits and schema.
	txPolicyMaximum = ynxauth.MaxWalletPolicyProjectionBytes
	txMemberMaximum = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + txMessageMaximum + 28
)

type txExpected struct {
	NetworkID                   []byte
	Owner                       string
	NativeChainID               uint64
	KeyVersion, ExecutionHeight string
	PKA, PKB                    []byte
}

type txInputs struct {
	message, policy []byte
	expected        txExpected
}

// A detached public DATA plan is not permission, a trusted RPC root, a nonce
// reservation or finality. Main/Auth supplies the original authenticated policy
// and retains current/review/custody/once checks before and after this call.
type txPlan struct {
	message  []byte
	policy   ynxauth.State
	expected txExpected
	height   uint64
}

func txPositiveDecimal(s string) (uint64, bool) {
	n, err := strconv.ParseUint(s, 10, 64)
	return n, err == nil && n != 0 && strconv.FormatUint(n, 10) == s
}

func transactionMessageBinding(message []byte) (network []byte, owner string, nativeChainID uint64, err error) {
	// Only the three existing canonical execution messages are signable. There
	// is no raw-purpose callback or domain replacement, including migration,
	// revocation, ARTIFACT-RELEASE and IDE-PROJECT-CONTROL.
	if transfer, e := ynxauth.DecodeTransfer(message); e == nil {
		canonical, e := transfer.SigningBytes()
		if e == nil && bytes.Equal(canonical, message) {
			return transfer.ChainID, transfer.From, transfer.NativeChainID, nil
		}
	}
	if action, e := ynxauth.DecodeAction(message); e == nil {
		canonical, e := action.SigningBytes()
		if e == nil && bytes.Equal(canonical, message) {
			return action.ChainID, action.Owner, action.NativeChainID, nil
		}
	}
	if value, e := ynxauth.DecodeEthereumValueIntent(message); e == nil {
		canonical, e := value.SigningBytes()
		if e == nil && bytes.Equal(canonical, message) {
			return value.ChainID, value.Owner, value.NativeChainID, nil
		}
	}
	return nil, "", 0, errors.New("unsupported canonical transaction message")
}

func prepareTransaction(in txInputs, capacity uint64) (txPlan, resultCode) {
	if capacity != txMemberCapacity {
		return txPlan{}, resultCapacity
	}
	if len(in.message) == 0 || len(in.message) > txMessageMaximum || len(in.policy) == 0 || len(in.policy) > txPolicyMaximum {
		return txPlan{}, resultBounds
	}
	e := in.expected
	height, heightOK := txPositiveDecimal(e.ExecutionHeight)
	_, versionOK := txPositiveDecimal(e.KeyVersion)
	if !heightOK || !versionOK || len(e.NetworkID) != 32 || !accountaddress.IsCanonical(e.Owner) ||
		e.NativeChainID == 0 || len(e.PKA) != ynxbatch.PublicKeyASize || len(e.PKB) != ynxbatch.PublicKeyBSize {
		return txPlan{}, resultPublicBinding
	}
	state, err := ynxauth.DecodeWalletPolicyProjection(in.policy, e.NetworkID, e.Owner)
	if err != nil {
		return txPlan{}, resultPublicBinding
	}
	// Use the complete validated owner projection; PolicyAt alone is not an
	// enabled resolver and cannot bypass terminal revocation or a live rotation.
	registered, err := state.TrustedRegistration(e.Owner, ynxauth.TransactionPurpose, height)
	if err != nil || registered.PolicyRevision != e.KeyVersion || !bytes.Equal(registered.PKA, e.PKA) || !bytes.Equal(registered.PKB, e.PKB) {
		return txPlan{}, resultPublicBinding
	}
	network, owner, nativeChainID, err := transactionMessageBinding(in.message)
	if err != nil || !bytes.Equal(network, e.NetworkID) || owner != e.Owner || nativeChainID != e.NativeChainID || txMemberMaximum > txMemberCapacity {
		return txPlan{}, resultPublicBinding
	}
	e.NetworkID, e.PKA, e.PKB = bytes.Clone(e.NetworkID), bytes.Clone(e.PKA), bytes.Clone(e.PKB)
	return txPlan{message: bytes.Clone(in.message), policy: state.Clone(), expected: e, height: height}, resultOK
}

func inspectTransactionMember(plan txPlan, wire []byte) error {
	if len(wire) == 0 || len(wire) > txMemberMaximum {
		return errors.New("transaction member bound")
	}
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return err
	}
	if m.Certificate.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 ||
		m.Certificate.Purpose != ynxauth.TransactionPurpose || m.Certificate.Owner != plan.expected.Owner ||
		!bytes.Equal(m.Certificate.ChainID, plan.expected.NetworkID) || !bytes.Equal(m.Certificate.PKA, plan.expected.PKA) ||
		!bytes.Equal(m.Certificate.PKB, plan.expected.PKB) || !bytes.Equal(m.Message, plan.message) {
		return errors.New("transaction member binding")
	}
	return plan.policy.VerifyMember(plan.expected.Owner, ynxauth.TransactionPurpose, plan.message, wire, plan.height)
}

func finishTransaction(candidate []byte, code resultCode, panicked, clean bool) ([]byte, resultCode, cleanupCode) {
	return finishPublication(candidate, code, panicked, clean)
}

func signTransactionPrepared(plan txPlan, borrowed ynxbatch.KeyMaterial) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize ||
		len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
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
		output, code, cleanup = finishTransaction(candidate, code, panicked, clean)
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
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: plan.expected.NetworkID,
		Owner: plan.expected.Owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || inspectTransactionMember(plan, candidate) != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	// Only fixed TX-BATCH Member DATA is released after logical cleanup. No
	// key handle survives, and no physical Go/CIRCL heap-erasure is claimed.
	return candidate, resultOK, cleanupUnknown
}
