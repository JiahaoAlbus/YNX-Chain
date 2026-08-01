package payproduct

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
)

const dataOperatorCredentialHeader = "X-YNX-Data-Operator-Credential"

func (s *Server) placeMerchantDataHold(w http.ResponseWriter, r *http.Request) {
	if !s.dataOperatorAuth(w, r) {
		return
	}
	var input MerchantDataHoldInput
	if !decode(w, r, &input) {
		return
	}
	out, err := s.service.PlaceMerchantDataHold(input)
	respond(w, http.StatusCreated, out, err)
}

func (s *Server) releaseMerchantDataHold(w http.ResponseWriter, r *http.Request) {
	if !s.dataOperatorAuth(w, r) {
		return
	}
	var input MerchantDataHoldReleaseInput
	if !decode(w, r, &input) {
		return
	}
	out, err := s.service.ReleaseMerchantDataHold(r.PathValue("id"), input)
	respond(w, http.StatusOK, out, err)
}

func (s *Server) approveMerchantDeletion(w http.ResponseWriter, r *http.Request) {
	if !s.dataOperatorAuth(w, r) {
		return
	}
	var input MerchantDeletionApprovalInput
	if !decode(w, r, &input) {
		return
	}
	out, err := s.service.ApproveMerchantDeletion(r.PathValue("id"), input)
	respond(w, http.StatusOK, out, err)
}

func (s *Server) executeMerchantDeletion(w http.ResponseWriter, r *http.Request) {
	if !s.dataOperatorAuth(w, r) {
		return
	}
	var input MerchantDeletionExecutionInput
	if !decode(w, r, &input) {
		return
	}
	out, err := s.service.ExecuteMerchantDeletion(r.PathValue("id"), input)
	respond(w, http.StatusOK, out, err)
}

func (s *Server) dataOperatorAuth(w http.ResponseWriter, r *http.Request) bool {
	expected := s.service.dataOperatorCredential
	if len(expected) < 24 {
		writeError(w, http.StatusServiceUnavailable, "merchant data operator authority is not configured")
		return false
	}
	providedDigest := sha256.Sum256([]byte(r.Header.Get(dataOperatorCredentialHeader)))
	expectedDigest := sha256.Sum256([]byte(expected))
	if subtle.ConstantTimeCompare(providedDigest[:], expectedDigest[:]) != 1 {
		writeError(w, http.StatusUnauthorized, "valid merchant data operator authority required")
		return false
	}
	return true
}
