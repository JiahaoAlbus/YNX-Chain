package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// Only the configured Comet HTTP/index transport is substituted. Original
// classic signatures, current dual signatures, CheckTx, FinalizeBlock, Commit,
// complete history validation and cold loading use the real Application.
// This fixture proves neither Node.Start, a validator quorum nor finality.
func TestGatewayPQStakingClassicOriginalWitnessHTTPAndColdRecovery(t *testing.T) {
	f, statePath, classic := newGatewayMigrationFixture(t)
	validator := f.migration.Validators[0].Address
	feeRecipient := ""
	for _, v := range f.migration.Validators {
		if v.Active {
			feeRecipient = v.Address
			break
		}
	}
	if feeRecipient == "" {
		t.Fatal("fixture lacks its original active fee recipient")
	}
	readState := func() ([]byte, os.FileInfo) {
		t.Helper()
		raw, err := os.ReadFile(statePath)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(statePath)
		if err != nil {
			t.Fatal(err)
		}
		return raw, info
	}
	readFees := func() []consensus.BFTFeeEvent {
		t.Helper()
		out, err := f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: "/economics/fees"})
		var fees []consensus.BFTFeeEvent
		if err != nil || out.Code != 0 || json.Unmarshal(out.Value, &fees) != nil {
			t.Fatalf("actual original fee query failed: %+v %v", out, err)
		}
		return fees
	}
	checkAccepted := func(raw []byte) {
		t.Helper()
		out, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
		if err != nil || out.Code != 0 {
			t.Fatalf("real original transaction rejected before its commit: %+v %v", out, err)
		}
	}

	// Commit the real old account's classic delegation before its PQ migration.
	delegation, err := consensus.NewSignedApplicationAction(classic, f.migration.Network.ChainID, consensus.ActionStakeDelegate, consensus.StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 1)
	if err != nil {
		t.Fatal(err)
	}
	classicRaw, err := consensus.EncodeSignedApplicationAction(delegation)
	if err != nil {
		t.Fatal(err)
	}
	checkAccepted(classicRaw)
	commitGatewayRevocationBlock(t, f, 2, classicRaw)
	classicFees := readFees()
	if len(classicFees) != 1 || classicFees[0].TxHash != consensus.ApplicationActionHash(classicRaw) || classicFees[0].TransactionType != consensus.ActionStakeDelegate || classicFees[0].Payer != f.owner || classicFees[0].Recipient != feeRecipient || classicFees[0].BlockHeight != 2 || !classicFees[0].RecordedAt.Equal(time.Unix(2, 0).UTC()) {
		t.Fatal("classic witness does not have its original successful H2 fee")
	}

	// Reuse the original complete public pair, but sign a fresh intent that
	// consumes nonce 2 at H3 and becomes active only at H4.
	migration, err := ynxauth.DecodeMigration(f.wire)
	if err != nil {
		t.Fatal(err)
	}
	migration.Intent.LedgerNonce, migration.Intent.ActivateAt = 2, 4
	message, err := migration.Intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(message)
	migration.ClassicSignature = ecdsa.Sign(classic, digest[:]).Serialize()
	migration.NewKeyProof = signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.MigrationPurpose, [][]byte{message})
	f.wire, err = migration.Encode()
	if err != nil {
		t.Fatal(err)
	}
	f.payload, err = consensus.EncodePQTransaction(consensus.PQMigrationType, f.wire)
	if err != nil {
		t.Fatal(err)
	}
	checkAccepted(f.payload)
	commitGatewayRevocationBlock(t, f, 3, f.payload)
	before, feeBefore := queryPQGatewayAccount(t, f.a, f.owner), queryPQGatewayAccount(t, f.a, feeRecipient)
	oldFees, oldPolicy := readFees(), gatewayRevocationPolicy(t, f, f.owner)
	if before.Balance != 78 || before.Staked != 20 || before.Nonce != 2 || len(oldFees) != 2 || !reflect.DeepEqual(oldFees[:1], classicFees) || oldPolicy.CommittedHeight != 3 || oldPolicy.ExecutionHeight != 4 || oldPolicy.AuthorizationStatus != "active" {
		t.Fatal("classic execution or pending-to-active migration boundary differs")
	}
	beforeBad, beforeBadInfo := readState()

	// These are known local CheckTx rejections, never HTTP submissions or
	// UNKNOWN outcomes. Use N1 here and a newly signed N2 Member for the one
	// later HTTP write, so no rejected proof is automatically resent.
	id := consensus.StakingDelegationID(f.owner, validator)
	badMember := gatewayActionWire(t, f, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 3, 1, 1)
	missing, err := consensus.EncodePQStakingActionTransaction(badMember, nil)
	if err != nil {
		t.Fatal(err)
	}
	malformed, err := consensus.EncodePQStakingActionTransaction(badMember, [][]byte{classicRaw})
	if err != nil {
		t.Fatal(err)
	}
	var malformedEnvelope consensus.PQStakingActionTransaction
	if err = json.Unmarshal(malformed, &malformedEnvelope); err != nil {
		t.Fatal(err)
	}
	malformedEnvelope.Originals = [][]byte{append(bytes.Clone(classicRaw), '\n')}
	malformed, err = json.Marshal(malformedEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	wrong, err := consensus.NewSignedApplicationAction(classic, f.migration.Network.ChainID, consensus.ActionStakeDelegate, consensus.StakeDelegatePayload{Validator: validator, AmountYNXT: 21}, 1)
	if err != nil {
		t.Fatal(err)
	}
	wrongRaw, err := consensus.EncodeSignedApplicationAction(wrong)
	if err != nil {
		t.Fatal(err)
	}
	wrongOriginal, err := consensus.EncodePQStakingActionTransaction(badMember, [][]byte{wrongRaw})
	if err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string][]byte{"missing": missing, "malformed": malformed, "valid-signature-wrong-original": wrongOriginal} {
		t.Run(name, func(t *testing.T) {
			out, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
			if err != nil || out.Code == 0 {
				t.Fatalf("invalid classic staking witness was admitted: %+v %v", out, err)
			}
			disk, info := readState()
			if !bytes.Equal(beforeBad, disk) || !os.SameFile(beforeBadInfo, info) || !beforeBadInfo.ModTime().Equal(info.ModTime()) || !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.owner)) || !reflect.DeepEqual(feeBefore, queryPQGatewayAccount(t, f.a, feeRecipient)) || !reflect.DeepEqual(oldFees, readFees()) || !reflect.DeepEqual(oldPolicy, gatewayRevocationPolicy(t, f, f.owner)) {
				t.Fatal("known rejected witness changed disk, funds, nonce, fees or policy")
			}
		})
	}

	wire := gatewayActionWire(t, f, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 3, 1, 2)
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil || member.Certificate.N != 2 || member.Index != 1 || bytes.Equal(wire, badMember) {
		t.Fatal("successful request is not its own full N2/index1 Member")
	}
	raw, err := consensus.EncodePQStakingActionTransaction(wire, [][]byte{classicRaw})
	if err != nil {
		t.Fatal(err)
	}
	m := newPQMock(t, f)
	setGatewayAction(t, m, wire, raw, 4)
	server := gatewayPQServer(t, m)
	code, view := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/json", raw)
	if code != http.StatusOK || !view.Committed || view.Status != "committed" || view.Source != "comet-rpc" || view.Type != ynxauth.ActionStakeUnbond || view.From != f.owner || view.To != id || view.Amount != 7 || view.Fee != 1 || view.Nonce != 3 || view.ExecutionHeight != 4 || view.CometIndex == nil || *view.CometIndex != 0 || view.NativeTransactionHash != consensus.SignedTransactionHash(wire) || view.ABCITransactionHash != consensus.SignedTransactionHash(raw) || view.NativeTransactionHash == view.ABCITransactionHash || !bytes.Equal(view.Wire, wire) || !bytes.Equal(view.Transport, raw) {
		t.Fatalf("normal HTTP original-backed staking failed: %d %+v", code, view)
	}
	assertGatewayPQPolicyFee(t, f.a, before, feeBefore, consensus.PQActionType, view.ABCITransactionHash, 4, 3)
	after := queryPQGatewayAccount(t, f.a, f.owner)
	if after.Balance != 77 || after.Staked != 13 || after.Nonce != 3 {
		t.Fatal("classic staking principal or new unbond was duplicated/lost")
	}
	history, tx := actionQuery(t, f, view.NativeTransactionHash)
	policy := gatewayRevocationPolicy(t, f, f.owner)
	if !bytes.Equal(history.Transport, raw) || history.ABCITransactionHash != view.ABCITransactionHash || tx.Hash != view.NativeTransactionHash || tx.Nonce != 3 || tx.Fee != 1 || tx.BlockNum != 4 || !tx.Timestamp.Equal(time.Unix(4, 0).UTC()) || !reflect.DeepEqual(history.Authorization, policy) || policy.LedgerNonce != 3 || policy.CommittedHeight != 4 || policy.ExecutionHeight != 5 || policy.Policy == nil || len(policy.Policy.Records) != 1 {
		t.Fatal("original history lost its exact raw transaction or complete policy")
	}
	record := policy.Policy.Records[0]
	if record.Owner != f.owner || record.Revision != 1 || record.RegisteredAt != 3 || record.ActiveFrom != 4 || record.LedgerNonce != 2 || !bytes.Equal(record.PKA, migration.Intent.PKA) || !bytes.Equal(record.PKB, migration.Intent.PKB) {
		t.Fatal("history substituted the registered full public pair or activation coordinates")
	}
	var effects struct {
		Fee     *consensus.BFTFeeEvent `json:"fee"`
		Staking *struct {
			Delegation consensus.BFTStakeDelegation  `json:"delegation"`
			Unbondings []consensus.BFTUnbondingEntry `json:"unbondings"`
			LegacyFees []consensus.BFTFeeEvent       `json:"legacyFees"`
		} `json:"staking"`
	}
	if err = json.Unmarshal(history.Effects, &effects); err != nil {
		t.Fatal(err)
	}
	fees := readFees()
	if len(fees) != 3 || !reflect.DeepEqual(fees[:2], oldFees) || effects.Fee == nil || *effects.Fee != fees[2] || effects.Staking == nil || !reflect.DeepEqual(effects.Staking.LegacyFees, classicFees) || effects.Staking.Delegation.ID != id || effects.Staking.Delegation.Delegator != f.owner || effects.Staking.Delegation.AmountYNXT != 13 || effects.Staking.Delegation.BlockHeight != 4 || effects.Staking.Delegation.TxHash != view.ABCITransactionHash || len(effects.Staking.Unbondings) != 1 {
		t.Fatal("staking effects do not retain the exact successful classic fees and current delegation")
	}
	unbond := effects.Staking.Unbondings[0]
	if unbond.ID != consensus.ApplicationActionRecordID("stake-unbonding", view.ABCITransactionHash) || unbond.DelegationID != id || unbond.Delegator != f.owner || unbond.Validator != validator || unbond.AmountYNXT != 7 || unbond.Status != "queued" || unbond.BlockHeight != 4 || unbond.TxHash != view.ABCITransactionHash || !unbond.RequestedAt.Equal(tx.Timestamp) || !unbond.AvailableAt.Equal(tx.Timestamp.Add(time.Duration(consensus.StakingUnbondingSeconds)*time.Second)) {
		t.Fatal("queued original funds or seven-day boundary differs")
	}
	projected, err := decimalPQActionEffects(history.Effects)
	if err != nil || !bytes.Equal(view.Effects, projected) {
		t.Fatal("HTTP omitted or altered the complete staking/legacy-fee effects")
	}
	var publicEffects struct {
		Staking *struct {
			LegacyFees []struct {
				TxHash       string `json:"txHash"`
				BlockHeight  string `json:"blockHeight"`
				GrossFeeYNXT string `json:"grossFeeYnxt"`
			} `json:"legacyFees"`
		} `json:"staking"`
	}
	if err = json.Unmarshal(view.Effects, &publicEffects); err != nil || publicEffects.Staking == nil || len(publicEffects.Staking.LegacyFees) != 1 {
		t.Fatal("public legacy fee evidence is absent or exposes imprecise JSON numbers")
	}
	publicFee := publicEffects.Staking.LegacyFees[0]
	if publicFee.TxHash != classicFees[0].TxHash || publicFee.BlockHeight != "2" || publicFee.GrossFeeYNXT != "1" {
		t.Fatal("public legacy fee identity or decimal-string execution coordinates differ")
	}
	readHTTPPolicy := func() (consensus.PQWalletAccountView, []byte) {
		t.Helper()
		response, err := http.Get(server.URL + "/accounts/" + f.owner + "/authorization")
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, consensus.MaxPQWalletQueryBytes+1))
		var public consensus.PQWalletAccountView
		if err != nil || len(body) > consensus.MaxPQWalletQueryBytes || response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != "no-store" || json.Unmarshal(body, &public) != nil || !reflect.DeepEqual(public, policy) {
			t.Fatal("normal HTTP account policy did not retain its complete registered history")
		}
		return public, body
	}
	_, publicPolicy := readHTTPPolicy()
	for _, route := range []string{view.ReadbackURL, view.ABCIReadbackURL} {
		code, got := actionHTTP(t, server.URL+route, "", nil)
		if code != http.StatusOK || !reflect.DeepEqual(got, view) {
			t.Fatal("native or ABCI HTTP original lookup changed the committed result")
		}
	}

	beforeCold, beforeColdInfo := readState()
	feeAfter := queryPQGatewayAccount(t, f.a, feeRecipient)
	cold, err := consensus.NewPersistentApplication(f.migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	f.a = cold
	m.mu.Unlock()
	coldHistory, _ := actionQuery(t, f, view.NativeTransactionHash)
	if !reflect.DeepEqual(coldHistory, history) || !reflect.DeepEqual(after, queryPQGatewayAccount(t, cold, f.owner)) || !reflect.DeepEqual(feeAfter, queryPQGatewayAccount(t, cold, feeRecipient)) || !reflect.DeepEqual(fees, readFees()) {
		t.Fatal("cold recovery changed original bytes, policy, fee history or staking funds")
	}
	_, coldPolicy := readHTTPPolicy()
	if !bytes.Equal(publicPolicy, coldPolicy) {
		t.Fatal("cold HTTP policy differs from the same committed original")
	}
	for _, route := range []string{view.ReadbackURL, view.ABCIReadbackURL} {
		code, got := actionHTTP(t, server.URL+route, "", nil)
		if code != http.StatusOK || !reflect.DeepEqual(got, view) {
			t.Fatal("cold native or ABCI HTTP lookup lost its original witness")
		}
	}
	disk, info := readState()
	m.mu.Lock()
	posts := m.posts
	m.mu.Unlock()
	if posts != 1 || !bytes.Equal(beforeCold, disk) || !os.SameFile(beforeColdInfo, info) || !beforeColdInfo.ModTime().Equal(info.ModTime()) {
		t.Fatal("cold/readback rewrote original disk or repeated the one authorized HTTP POST")
	}
}
