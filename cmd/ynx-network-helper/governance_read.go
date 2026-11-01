package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/governanceview"
)

// Called only during normal host assembly. An optional public read dependency
// must not stop unrelated receipt/node service or silently select another URL.
func (h *helper) configureGovernanceRead(source string) {
	reader, err := governanceview.New(source, nil)
	if err != nil {
		h.governance = nil
		log.Print("Public governance reads disabled: fixed source configuration invalid; other helper capabilities retained")
		return
	}
	h.governance = reader
}

// These routes are public registry reads behind the original local read ticket.
// They cannot initialize governance, approve, vote, sign or select an upstream.
func (h *helper) governanceProposals(w http.ResponseWriter, r *http.Request) {
	if !governanceReadInput(w, r, nil) {
		return
	}
	report := h.governance.ListProposals(r.Context())
	h.sendAuthorizedJSON(w, r, report)
}
func (h *helper) governanceProposal(w http.ResponseWriter, r *http.Request) {
	var id string
	if !governanceReadInput(w, r, &id) {
		return
	}
	report := h.governance.Proposal(r.Context(), id)
	h.sendAuthorizedJSON(w, r, report)
}

func governanceReadInput(w http.ResponseWriter, r *http.Request, id *string) bool {
	if r.Header.Get("Content-Type") != "application/json" {
		denied(w, 415, "JSON_REQUIRED")
		return false
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024))
	if err != nil {
		denied(w, 400, "INVALID_JSON")
		return false
	}
	// Exact structured requests keep duplicate keys, null and URL/path/provider
	// selectors out, rather than relying on Go's last-duplicate-wins decoder.
	var input map[string]json.RawMessage
	if json.Unmarshal(raw, &input) != nil || input == nil {
		denied(w, 400, "INVALID_JSON")
		return false
	}
	var canonical []byte
	if id == nil {
		if len(input) != 0 {
			denied(w, 400, "INVALID_JSON")
			return false
		}
		canonical = []byte("{}")
	} else {
		if len(input) != 1 || json.Unmarshal(input["id"], id) != nil || !governanceview.ValidID(*id) {
			denied(w, 400, "INVALID_PROPOSAL_ID")
			return false
		}
		canonical, _ = json.Marshal(map[string]string{"id": *id})
	}
	var compact bytes.Buffer
	if json.Compact(&compact, raw) != nil || !bytes.Equal(compact.Bytes(), canonical) {
		denied(w, 400, "INVALID_JSON")
		return false
	}
	return true
}
