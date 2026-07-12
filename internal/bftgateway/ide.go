package bftgateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (g *Gateway) handleIDEMutation(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type application/json is required"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "signed IDE action exceeds maximum size"})
		return
	}
	tx, err := consensus.DecodeSignedApplicationAction(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := tx.Verify(6423); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	expected := consensus.ActionIDEContractDeploy
	if r.URL.Path == "/ide/execute" {
		expected = consensus.ActionIDEContractCall
	}
	if tx.Action != expected {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "signed IDE action does not match requested route"})
		return
	}
	if _, err := g.broadcastApplicationAction(r.Context(), raw, tx); err != nil {
		var txErr *gatewayTransactionError
		if errors.As(err, &txErr) {
			writeJSON(w, txErr.status, map[string]string{"error": txErr.Error()})
		} else {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		}
		return
	}
	hash := consensus.ApplicationActionHash(raw)
	var receipt consensus.BFTEVMReceipt
	if err := g.queryABCIJSON(r.Context(), "/evm/receipts/"+hash, &receipt); err != nil || receipt.TxHash != hash || receipt.From != tx.Signer || receipt.Action != expected {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed IDE receipt evidence mismatch"})
		return
	}
	if expected == consensus.ActionIDEContractDeploy {
		var contract consensus.BFTContract
		if err := g.queryABCIJSON(r.Context(), "/ide/contracts/"+receipt.ContractAddress, &contract); err != nil || contract.Address != receipt.ContractAddress || contract.Deployer != tx.Signer || contract.TxHash != hash {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed IDE deployment evidence mismatch"})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"contract": contract, "receipt": receipt, "truthfulStatus": "committed-bft-contract-state"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"receipt": receipt, "truthfulStatus": "committed-bft-contract-state"})
}

func (g *Gateway) handleIDECall(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Address  string `json:"address"`
		Calldata string `json:"calldata"`
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || decoder.Decode(&struct{}{}) != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "one bounded IDE call JSON object is required"})
		return
	}
	input.Address, input.Calldata = strings.ToLower(strings.TrimSpace(input.Address)), strings.ToLower(strings.TrimSpace(input.Calldata))
	if !consensus.IsNativeAddress(input.Address) || len(input.Calldata) < 10 || len(input.Calldata) > 8194 || len(input.Calldata)%2 != 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical contract address and bounded calldata are required"})
		return
	}
	var result map[string]any
	if err := g.queryABCIJSON(r.Context(), "/ide/call/"+input.Address+"/"+input.Calldata, &result); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (g *Gateway) handleIDEContract(w http.ResponseWriter, r *http.Request) {
	address := strings.ToLower(strings.TrimSpace(r.PathValue("address")))
	if !consensus.IsNativeAddress(address) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical contract address is required"})
		return
	}
	var contract consensus.BFTContract
	if err := g.queryABCIJSON(r.Context(), "/ide/contracts/"+address, &contract); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "IDE contract not found"})
		return
	}
	if contract.Address != address {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ABCI IDE contract address mismatch"})
		return
	}
	writeJSON(w, http.StatusOK, contract)
}

func (g *Gateway) handleIDEVerifier(w http.ResponseWriter, r *http.Request) {
	address := strings.ToLower(strings.TrimSpace(r.PathValue("address")))
	if !consensus.IsNativeAddress(address) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical contract address is required"})
		return
	}
	var evidence map[string]any
	if err := g.queryABCIJSON(r.Context(), "/ide/verifier/"+address, &evidence); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "IDE verifier evidence not found"})
		return
	}
	if evidence["address"] != address || evidence["remotePublicProofStatus"] != "not_claimed" {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ABCI IDE verifier evidence mismatch"})
		return
	}
	writeJSON(w, http.StatusOK, evidence)
}
