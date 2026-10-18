package bftgateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const accountAbstractionAPIVersion = "abci-state-v11"

func (g *Gateway) handleAccountAbstractionMutation(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, aaFailure("Content-Type application/json is required"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, aaFailure("signed account abstraction action exceeds maximum size"))
		return
	}
	tx, err := consensus.DecodeSignedApplicationAction(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, aaFailure(err.Error()))
		return
	}
	if err := tx.Verify(6423); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, aaFailure(err.Error()))
		return
	}
	expected := map[string]string{"/aa/accounts": consensus.ActionSmartAccountCreate, "/aa/paymasters": consensus.ActionPaymasterCreate, "/aa/user-operations": consensus.ActionUserOperationExecute}[r.URL.Path]
	if tx.Action != expected {
		writeJSON(w, http.StatusBadRequest, aaFailure("signed account abstraction action does not match requested route"))
		return
	}
	if _, err := g.broadcastApplicationAction(r.Context(), raw, tx); err != nil {
		var txErr *gatewayTransactionError
		if errors.As(err, &txErr) {
			writeJSON(w, txErr.status, aaFailure(txErr.Error()))
		} else {
			writeJSON(w, http.StatusBadGateway, aaFailure(err.Error()))
		}
		return
	}
	txHash := consensus.ApplicationActionHash(raw)
	switch tx.Action {
	case consensus.ActionSmartAccountCreate:
		var record assetauth.SmartAccount
		if err := g.queryABCIJSON(r.Context(), "/aa/accounts/"+tx.Signer, &record); err != nil || record.Address != tx.Signer {
			writeJSON(w, http.StatusBadGateway, aaFailure("committed smart account evidence mismatch"))
			return
		}
		response := aaBase(record.CreatedAt, "exact")
		response["account"] = record
		writeJSON(w, http.StatusCreated, response)
	case consensus.ActionPaymasterCreate:
		var input consensus.PaymasterCreatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		var record consensus.BFTPaymaster
		if err := g.queryABCIJSON(r.Context(), "/aa/paymasters/"+input.ID, &record); err != nil || record.Policy.ID != input.ID || record.Policy.Sponsor != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, aaFailure("committed paymaster evidence mismatch"))
			return
		}
		response := aaBase(record.CreatedAt, "exact")
		response["paymaster"] = record
		writeJSON(w, http.StatusCreated, response)
	case consensus.ActionUserOperationExecute:
		id := consensus.ApplicationActionRecordID("user-operation", txHash)
		var record consensus.BFTUserOperationEvent
		if err := g.queryABCIJSON(r.Context(), "/aa/user-operations/"+id, &record); err != nil || record.ID != id || record.Bundler != tx.Signer || record.TransactionHash != txHash {
			writeJSON(w, http.StatusBadGateway, aaFailure("committed user operation evidence mismatch"))
			return
		}
		response := aaBase(record.ExecutedAt, "exact")
		response["userOperation"] = record
		writeJSON(w, http.StatusCreated, response)
	}
}

func (g *Gateway) handleSmartAccounts(w http.ResponseWriter, r *http.Request) {
	var records []assetauth.SmartAccount
	if err := g.queryABCIJSON(r.Context(), "/aa/accounts", &records); err != nil {
		writeJSON(w, http.StatusBadGateway, aaFailure(err.Error()))
		return
	}
	response := aaBase(nil, map[string]any{"returned": len(records), "complete": true})
	response["accounts"] = records
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleSmartAccount(w http.ResponseWriter, r *http.Request) {
	address := strings.TrimSpace(r.PathValue("address"))
	if !consensus.IsNativeAddress(address) {
		writeJSON(w, http.StatusBadRequest, aaFailure("canonical smart account address is required"))
		return
	}
	var record assetauth.SmartAccount
	if err := g.queryABCIJSON(r.Context(), "/aa/accounts/"+address, &record); err != nil || record.Address != address {
		writeJSON(w, http.StatusNotFound, aaFailure("smart account not found"))
		return
	}
	response := aaBase(record.CreatedAt, "exact")
	response["account"] = record
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handlePaymasters(w http.ResponseWriter, r *http.Request) {
	var records []consensus.BFTPaymaster
	if err := g.queryABCIJSON(r.Context(), "/aa/paymasters", &records); err != nil {
		writeJSON(w, http.StatusBadGateway, aaFailure(err.Error()))
		return
	}
	response := aaBase(nil, map[string]any{"returned": len(records), "complete": true})
	response["paymasters"] = records
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handlePaymaster(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if !quantRecordIDPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, aaFailure("canonical paymaster ID is required"))
		return
	}
	var record consensus.BFTPaymaster
	if err := g.queryABCIJSON(r.Context(), "/aa/paymasters/"+id, &record); err != nil || record.Policy.ID != id {
		writeJSON(w, http.StatusNotFound, aaFailure("paymaster not found"))
		return
	}
	response := aaBase(record.CreatedAt, "exact")
	response["paymaster"] = record
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleUserOperations(w http.ResponseWriter, r *http.Request) {
	var records []consensus.BFTUserOperationEvent
	if err := g.queryABCIJSON(r.Context(), "/aa/user-operations", &records); err != nil {
		writeJSON(w, http.StatusBadGateway, aaFailure(err.Error()))
		return
	}
	response := aaBase(nil, map[string]any{"returned": len(records), "complete": true})
	response["userOperations"] = records
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleUserOperation(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if !aiRecordIDPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, aaFailure("canonical user operation ID is required"))
		return
	}
	var record consensus.BFTUserOperationEvent
	if err := g.queryABCIJSON(r.Context(), "/aa/user-operations/"+id, &record); err != nil || record.ID != id {
		writeJSON(w, http.StatusNotFound, aaFailure("user operation not found"))
		return
	}
	response := aaBase(record.ExecutedAt, "exact")
	response["userOperation"] = record
	writeJSON(w, http.StatusOK, response)
}

func aaBase(asOf, coverage any) map[string]any {
	return map[string]any{"schemaVersion": 1, "source": "ynx-consensus-abci", "asOf": asOf, "version": accountAbstractionAPIVersion, "coverage": coverage, "failure": false}
}

func aaFailure(message string) map[string]any {
	return map[string]any{"error": message, "source": "ynx-consensus-abci", "version": accountAbstractionAPIVersion, "coverage": "none", "failure": true}
}
