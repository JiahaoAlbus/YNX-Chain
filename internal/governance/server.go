package governance

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const apiVersion = "ynx-governance-api/v1"

type Principal struct {
	Account   string
	Product   string
	DeviceID  string
	SessionID string
	Roles     map[string]bool
	Scopes    map[Scope]bool
}

type Authenticator interface {
	Authenticate(*http.Request) (Principal, error)
}

type Server struct {
	service   *Service
	auth      Authenticator
	statePath string
	now       func() time.Time
	mux       *http.ServeMux
}

func NewServer(service *Service, auth Authenticator, statePath string, now func() time.Time) (*Server, error) {
	if service == nil || auth == nil || strings.TrimSpace(statePath) == "" {
		return nil, ErrInvalid
	}
	if now == nil {
		now = time.Now
	}
	s := &Server{service: service, auth: auth, statePath: statePath, now: now, mux: http.NewServeMux()}
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler { return securityHeaders(s.mux) }

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /metrics", s.metrics)
	s.mux.HandleFunc("GET /governance/proposals", s.listProposals)
	s.mux.HandleFunc("GET /governance/proposals/{id}", s.getProposal)
	s.mux.HandleFunc("GET /governance/proposals/{id}/discussion", s.listDiscussion)
	s.mux.HandleFunc("POST /governance/proposals/{id}/discussion", s.protected("participant", s.addDiscussion))
	s.mux.HandleFunc("POST /governance/proposals", s.protected("proposer", s.createProposal))
	s.mux.HandleFunc("POST /governance/proposals/{id}/deposit", s.protected("depositor", s.deposit))
	s.mux.HandleFunc("POST /governance/proposals/{id}/simulation", s.protected("technical_council", s.simulation))
	s.mux.HandleFunc("POST /governance/proposals/{id}/cancel", s.protected("proposer", s.cancelProposal))
	s.mux.HandleFunc("POST /governance/proposals/{id}/conflicts", s.protected("participant", s.conflict))
	s.mux.HandleFunc("POST /governance/proposals/{id}/electorate", s.protected("technical_council", s.submitElectorate))
	s.mux.HandleFunc("POST /governance/proposals/{id}/electorate/approve", s.protected("technical_council", s.approveElectorate))
	s.mux.HandleFunc("POST /governance/proposals/{id}/voting", s.protected("technical_council", s.openVoting))
	s.mux.HandleFunc("POST /governance/proposals/{id}/votes", s.protected("voter", s.vote))
	s.mux.HandleFunc("POST /governance/proposals/{id}/finalize", s.protected("technical_council", s.finalize))
	s.mux.HandleFunc("POST /governance/proposals/{id}/execute", s.protected("executor", s.execute))
	s.mux.HandleFunc("POST /governance/proposals/{id}/verify", s.protected("verifier", s.verify))
	s.mux.HandleFunc("GET /governance/emergencies", s.listEmergencies)
	s.mux.HandleFunc("GET /governance/emergencies/{id}", s.getEmergency)
	s.mux.HandleFunc("POST /governance/emergencies", s.protected("emergency_proposer", s.createEmergency))
	s.mux.HandleFunc("POST /governance/emergencies/{id}/approve", s.protected("emergency_signer", s.approveEmergency))
	s.mux.HandleFunc("POST /governance/emergencies/{id}/close", s.protected("emergency_operator", s.closeEmergency))
	s.mux.HandleFunc("GET /governance/appeals", s.listAppeals)
	s.mux.HandleFunc("GET /governance/appeals/{id}", s.getAppeal)
	s.mux.HandleFunc("POST /governance/appeals", s.protected("participant", s.submitAppeal))
	s.mux.HandleFunc("POST /governance/appeals/{id}/resolve", s.protected("appeal_resolver", s.resolveAppeal))
	s.mux.HandleFunc("GET /governance/roles", s.listRoles)
}

func (s *Server) protected(role string, next func(http.ResponseWriter, *http.Request, Principal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, err := s.auth.Authenticate(r)
		if err != nil || p.Account == "" || p.Product != "governance" || p.DeviceID == "" || p.SessionID == "" || !p.Roles[role] {
			writeError(w, http.StatusUnauthorized, "valid governance product session and scoped role required")
			return
		}
		next(w, r, p)
	}
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeSource(w, http.StatusOK, s.service.Health(s.now()), s.now())
}

func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	h := s.service.Health(s.now())
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	labels := `service="ynx-governanced",external_execution="false"`
	_, _ = fmt.Fprintf(w, "ynx_governance_proposals_total{%s} %d\n", labels, h.ProposalCount)
	_, _ = fmt.Fprintf(w, "ynx_governance_active_proposals{%s} %d\n", labels, h.ActiveProposalCount)
	_, _ = fmt.Fprintf(w, "ynx_governance_executed_proposals_total{%s} %d\n", labels, h.ExecutedProposalCount)
	_, _ = fmt.Fprintf(w, "ynx_governance_roles_total{%s} %d\n", labels, h.RoleCount)
	_, _ = fmt.Fprintf(w, "ynx_governance_active_emergencies{%s} %d\n", labels, h.ActiveEmergencyCount)
	_, _ = fmt.Fprintf(w, "ynx_governance_external_execution_enabled{%s} 0\n", labels)
	_, _ = fmt.Fprintf(w, "ynx_governance_appeals_total{%s} %d\n", labels, h.AppealCount)
	_, _ = fmt.Fprintf(w, "ynx_governance_pending_appeals{%s} %d\n", labels, h.PendingAppealCount)
	_, _ = fmt.Fprintf(w, "ynx_governance_discussion_entries_total{%s} %d\n", labels, h.DiscussionCount)
}
func (s *Server) listProposals(w http.ResponseWriter, _ *http.Request) {
	writeSource(w, http.StatusOK, map[string]any{"proposals": s.service.ListProposals()}, s.now())
}
func (s *Server) getProposal(w http.ResponseWriter, r *http.Request) {
	p, err := s.service.Get(r.PathValue("id"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeSource(w, http.StatusOK, p, s.now())
}
func (s *Server) listDiscussion(w http.ResponseWriter, r *http.Request) {
	if _, err := s.service.Get(r.PathValue("id")); err != nil {
		writeServiceError(w, err)
		return
	}
	writeSource(w, http.StatusOK, map[string]any{"discussion": s.service.ListDiscussion(r.PathValue("id"))}, s.now())
}
func (s *Server) addDiscussion(w http.ResponseWriter, r *http.Request, p Principal) {
	proposal, err := s.service.Get(r.PathValue("id"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if !p.Scopes[proposal.Input.Scope] {
		writeError(w, http.StatusUnauthorized, "governance role is not authorized for discussion scope")
		return
	}
	var in DiscussionInput
	if !decode(w, r, &in) {
		return
	}
	in.ProposalID = proposal.ID
	in.Author = p.Account
	out, err := s.service.AddDiscussion(in, s.now())
	s.mutation(w, http.StatusCreated, out, err)
}
func (s *Server) listRoles(w http.ResponseWriter, _ *http.Request) {
	writeSource(w, http.StatusOK, map[string]any{"roles": s.service.ListRoles()}, s.now())
}
func (s *Server) listEmergencies(w http.ResponseWriter, _ *http.Request) {
	writeSource(w, http.StatusOK, map[string]any{"emergencies": s.service.ListEmergencies(s.now())}, s.now())
}
func (s *Server) getEmergency(w http.ResponseWriter, r *http.Request) {
	a, err := s.service.Emergency(r.PathValue("id"), s.now())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeSource(w, http.StatusOK, a, s.now())
}

func (s *Server) listAppeals(w http.ResponseWriter, _ *http.Request) {
	writeSource(w, http.StatusOK, map[string]any{"appeals": s.service.ListAppeals()}, s.now())
}
func (s *Server) getAppeal(w http.ResponseWriter, r *http.Request) {
	a, err := s.service.Appeal(r.PathValue("id"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeSource(w, http.StatusOK, a, s.now())
}
func (s *Server) submitAppeal(w http.ResponseWriter, r *http.Request, p Principal) {
	var in AppealInput
	if !decode(w, r, &in) {
		return
	}
	proposal, err := s.service.Get(in.ProposalID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if !p.Scopes[proposal.Input.Scope] {
		writeError(w, http.StatusUnauthorized, "governance role is not authorized for appeal scope")
		return
	}
	in.Submitter = p.Account
	out, err := s.service.SubmitAppeal(in, s.now())
	s.mutation(w, http.StatusCreated, out, err)
}
func (s *Server) resolveAppeal(w http.ResponseWriter, r *http.Request, p Principal) {
	appeal, err := s.service.Appeal(r.PathValue("id"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	proposal, err := s.service.Get(appeal.Input.ProposalID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if !p.Scopes[proposal.Input.Scope] {
		writeError(w, http.StatusUnauthorized, "governance role is not authorized for appeal scope")
		return
	}
	var in struct {
		ResolutionProposalID string   `json:"resolutionProposalId"`
		Outcome              string   `json:"outcome"`
		Explanation          string   `json:"explanation"`
		Evidence             []string `json:"evidence"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.ResolveAppeal(appeal.ID, in.ResolutionProposalID, p.Account, in.Outcome, in.Explanation, in.Evidence, s.now())
	s.mutation(w, http.StatusOK, out, err)
}

func (s *Server) createProposal(w http.ResponseWriter, r *http.Request, p Principal) {
	var in ProposalInput
	if !decode(w, r, &in) {
		return
	}
	in.Proposer = p.Account
	if !p.Scopes[in.Scope] {
		writeError(w, http.StatusUnauthorized, "governance role is not authorized for proposal scope")
		return
	}
	out, err := s.service.Create(in, s.now())
	s.mutation(w, http.StatusCreated, out, err)
}
func (s *Server) deposit(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	var in struct {
		Amount uint64 `json:"amount"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.Deposit(r.PathValue("id"), in.Amount, s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) simulation(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	var in Simulation
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.RecordSimulation(r.PathValue("id"), in, s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) cancelProposal(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	var in struct {
		Reason   string   `json:"reason"`
		Evidence []string `json:"evidence"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.CancelProposal(r.PathValue("id"), p.Account, in.Reason, in.Evidence, s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) conflict(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	var in ConflictDisclosure
	if !decode(w, r, &in) {
		return
	}
	in.Actor = p.Account
	out, err := s.service.DiscloseConflict(r.PathValue("id"), in, s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) openVoting(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	out, err := s.service.OpenVoting(r.PathValue("id"), s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) submitElectorate(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	var in struct {
		Snapshot      VotingSnapshot `json:"snapshot"`
		EvidenceHash  string         `json:"evidenceHash"`
		SourceVersion string         `json:"sourceVersion"`
		SnapshotAsOf  time.Time      `json:"snapshotAsOf"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.SubmitElectorate(r.PathValue("id"), in.Snapshot, in.EvidenceHash, in.SourceVersion, p.Account, in.SnapshotAsOf, s.now())
	s.mutation(w, http.StatusCreated, out, err)
}
func (s *Server) approveElectorate(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	out, err := s.service.ApproveElectorate(r.PathValue("id"), p.Account, s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) vote(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	var in struct {
		Choice string `json:"choice"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.Vote(r.PathValue("id"), p.Account, in.Choice, s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) finalize(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	out, err := s.service.Finalize(r.PathValue("id"), s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) execute(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	var in struct {
		ManifestHash string `json:"manifestHash"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.BeginExecution(r.PathValue("id"), in.ManifestHash, s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) verify(w http.ResponseWriter, r *http.Request, p Principal) {
	if !s.authorizedProposal(w, r.PathValue("id"), p) {
		return
	}
	var in struct {
		Receipt         ExecutionReceipt  `json:"receipt"`
		RollbackReceipt *ExecutionReceipt `json:"rollbackReceipt"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.VerifyExecution(r.PathValue("id"), in.Receipt, in.RollbackReceipt, s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) createEmergency(w http.ResponseWriter, r *http.Request, p Principal) {
	var in EmergencyInput
	if !decode(w, r, &in) {
		return
	}
	if !p.Scopes[scopeForEmergency(in.Scope)] {
		writeError(w, http.StatusUnauthorized, "governance role is not authorized for emergency scope")
		return
	}
	out, err := s.service.CreateEmergency(in, p.Account, s.now())
	s.mutation(w, http.StatusCreated, out, err)
}
func (s *Server) approveEmergency(w http.ResponseWriter, r *http.Request, p Principal) {
	a, err := s.service.Emergency(r.PathValue("id"), s.now())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if !p.Scopes[scopeForEmergency(a.Input.Scope)] {
		writeError(w, http.StatusUnauthorized, "governance role is not authorized for emergency scope")
		return
	}
	role := ""
	if p.Roles["security_council"] {
		role = "security_council"
	} else if p.Roles["technical_council"] {
		role = "technical_council"
	}
	if role == "" {
		writeError(w, http.StatusUnauthorized, "council role required")
		return
	}
	out, err := s.service.ApproveEmergency(r.PathValue("id"), p.Account, role, s.now())
	s.mutation(w, http.StatusOK, out, err)
}
func (s *Server) closeEmergency(w http.ResponseWriter, r *http.Request, p Principal) {
	a, err := s.service.Emergency(r.PathValue("id"), s.now())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if !p.Scopes[scopeForEmergency(a.Input.Scope)] {
		writeError(w, http.StatusUnauthorized, "governance role is not authorized for emergency scope")
		return
	}
	var in struct {
		FollowUpProposalID string `json:"followUpProposalId"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.CloseEmergency(r.PathValue("id"), in.FollowUpProposalID, s.now())
	s.mutation(w, http.StatusOK, out, err)
}

func (s *Server) authorizedProposal(w http.ResponseWriter, id string, p Principal) bool {
	proposal, err := s.service.Get(id)
	if err != nil {
		writeServiceError(w, err)
		return false
	}
	if !p.Scopes[proposal.Input.Scope] {
		writeError(w, http.StatusUnauthorized, "governance role is not authorized for proposal scope")
		return false
	}
	return true
}
func scopeForEmergency(scope EmergencyScope) Scope {
	switch scope {
	case EmergencyBridge:
		return ScopeBridge
	case EmergencyOracle:
		return ScopeOracle
	case EmergencyMarket:
		return ScopeExchange
	case EmergencyVault:
		return ScopeVault
	case EmergencyProvider:
		return ScopeResource
	case EmergencyUpgrade:
		return ScopeProtocolUpgrade
	default:
		return ""
	}
}

func (s *Server) mutation(w http.ResponseWriter, code int, value any, err error) {
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if err = s.service.Save(s.statePath, s.now()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "governance state persistence failed")
		return
	}
	writeSource(w, code, value, s.now())
}
func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return false
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		writeError(w, http.StatusBadRequest, "request must contain one JSON value")
		return false
	}
	return true
}
func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "governance record not found")
	case errors.Is(err, ErrReplay), errors.Is(err, ErrConflict):
		writeError(w, http.StatusConflict, "governance replay or conflict rejected")
	case errors.Is(err, ErrForbidden):
		writeError(w, http.StatusForbidden, "governance policy rejected request")
	case errors.Is(err, ErrNotReady):
		writeError(w, http.StatusUnprocessableEntity, "governance stage is not ready")
	default:
		writeError(w, http.StatusBadRequest, "invalid governance request")
	}
}
func writeSource(w http.ResponseWriter, code int, data any, now time.Time) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data, "source": "ynx-governance-authoritative-state", "asOf": now.UTC(), "version": apiVersion})
}
func writeError(w http.ResponseWriter, code int, message string) {
	id := randomID()
	w.Header().Set("X-YNX-Error-ID", id)
	writeSource(w, code, map[string]any{"error": message, "errorId": id, "status": "failed"}, time.Now().UTC())
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := randomID()
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
func randomID() string {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "unavailable"
	}
	return hex.EncodeToString(raw)
}
