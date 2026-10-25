package api

import (
	"net/http"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func revocationDecimalFields(intent ynxauth.RevocationIntent) map[string]string {
	return map[string]string{"amount": "0", "fee": "1", "nonce": strconv.FormatUint(intent.LedgerNonce, 10),
		"executionHeight": strconv.FormatUint(intent.ExecuteAt, 10), "revokedFrom": strconv.FormatUint(intent.RevokeAt, 10),
		"authorizingRevision": strconv.FormatUint(intent.AuthorizingRevision, 10), "throughRevision": strconv.FormatUint(intent.ThroughRevision, 10)}
}

func (s *Server) handleAccountRevocation(w http.ResponseWriter, r *http.Request) {
	wire, ok := readPQBody(w, r, ynxauth.MaxRevocationBytes)
	if !ok {
		return
	}
	revocation, err := ynxauth.DecodeRevocation(wire)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	owner, err := normalizeAccountInput(r.PathValue("address"))
	if err != nil || owner != revocation.Intent.Owner {
		writeError(w, http.StatusBadRequest, "revocation owner does not match route")
		return
	}
	tx, replayed, err := s.devnet.SubmitAccountRevocation(wire)
	decimal := revocationDecimalFields(revocation.Intent)
	if err != nil {
		if writePQUncertainMutation(w, tx, err, decimal) {
			return
		}
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	view := s.devnet.AccountAuthorizationDetails(owner)
	status, _ := accountPolicyStatus(view.State, owner, view.ExecutionHeight, false)
	writeJSON(w, http.StatusOK, map[string]any{"transaction": tx, "wireHash": tx.Hash, "decimalFields": decimal, "replayed": replayed,
		"status": status, "policyView": "next_execution", "consensusFinality": false})
}

func accountPolicyStatus(state *ynxauth.State, owner string, height uint64, committed bool) (string, bool) {
	if state == nil {
		return "legacy", false
	}
	status, signing := "legacy", false
	if current, active := state.PolicyAt(owner, height); active && (!committed || current.RegisteredAt <= height) {
		status, signing = "active", true
	} else {
		for _, record := range state.Records {
			if record.Owner == owner && (!committed || record.RegisteredAt <= height) {
				status = "pending_activation"
			}
		}
	}
	for _, revoked := range state.Revocations {
		if revoked.Owner != owner || (committed && revoked.RegisteredAt > height) {
			continue
		}
		if height >= revoked.RevokedFrom {
			return "revoked", false
		}
		return "revocation_pending", signing
	}
	return status, signing
}

func addAccountRevocationView(result map[string]any, owner string, view chain.AccountAuthorizationDetail) {
	status, signing := accountPolicyStatus(view.State, owner, view.ExecutionHeight, false)
	committedStatus, committedSigning := accountPolicyStatus(view.State, owner, view.CommittedHeight, true)
	result["authorizationStatus"], result["pqSigningEnabled"] = status, signing
	result["committedAuthorizationStatus"], result["committedPQSigningEnabled"] = committedStatus, committedSigning
	result["globalPolicyVersion"] = view.GlobalPolicyVersion
	revocations := make([]map[string]string, 0)
	if view.State != nil {
		for _, revoked := range view.State.Revocations {
			if revoked.Owner == owner {
				revocations = append(revocations, map[string]string{"owner": owner,
					"authorizingRevision": strconv.FormatUint(revoked.AuthorizingRevision, 10), "throughRevision": strconv.FormatUint(revoked.ThroughRevision, 10),
					"registeredAt": strconv.FormatUint(revoked.RegisteredAt, 10), "revokedFrom": strconv.FormatUint(revoked.RevokedFrom, 10), "ledgerNonce": strconv.FormatUint(revoked.LedgerNonce, 10)})
			}
		}
	}
	result["revocations"] = revocations
}
