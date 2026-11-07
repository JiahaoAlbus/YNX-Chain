package commerce

import (
	"net/http"
	"sort"
)

func (s *Store) recentAIJobs(actor string) []AIJob {
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs := []AIJob{}
	for _, job := range s.s.AIJobs {
		if job.Actor == actor {
			jobs = append(jobs, detachedAIJob(job))
		}
	}
	sort.Slice(jobs, func(i, j int) bool {
		if jobs[i].CreatedAt.Equal(jobs[j].CreatedAt) {
			return jobs[i].ID < jobs[j].ID
		}
		return jobs[i].CreatedAt.After(jobs[j].CreatedAt)
	})
	if len(jobs) > 50 {
		jobs = jobs[:50]
	}
	return jobs
}

func (s *Server) listAIJobs(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	verified, _ := r.Context().Value(businessRequestContextKey{}).(*verifiedBusinessRequest)
	jobs := []any{}
	for _, job := range s.store.recentAIJobs(actor.Account) {
		jobs = append(jobs, buyerWalletWire(job, verified))
	}
	write(w, http.StatusOK, map[string]any{"jobs": jobs, "Limit": 50})
}

// Look up the exact original comparison creation. This does not create a job,
// contact the model provider, run a draft, or replace an uncertain operation.
func (s *Store) LookupAIJobIntent(actor string, in AIInput) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, found, err := s.idempotencyLocked(actor, "ai.create", in.IdempotencyKey, in)
	if err != nil {
		return AIJob{}, err
	}
	if !found {
		return AIJob{}, ErrNotFound
	}
	j, ok := s.s.AIJobs[id]
	if !ok || j.Actor != actor {
		return AIJob{}, ErrNotFound
	}
	return detachedAIJob(j), nil
}

func detachedAIJob(job AIJob) AIJob {
	job.ContextClasses = append([]string(nil), job.ContextClasses...)
	job.AllowedActions = append([]string(nil), job.AllowedActions...)
	return job
}

func (s *Server) writeAIJob(w http.ResponseWriter, r *http.Request, code int, job AIJob) {
	verified, _ := r.Context().Value(businessRequestContextKey{}).(*verifiedBusinessRequest)
	writeBuyerBusiness(w, code, job, verified)
}

func (s *Server) readAIJob(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	job, err := s.store.AIJob(actor.Account, r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	s.writeAIJob(w, r, http.StatusOK, job)
}

func (s *Server) lookupAIJobIntent(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	var in AIInput
	if !decode(w, r, &in) {
		return
	}
	job, err := s.store.LookupAIJobIntent(actor.Account, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	verified, _ := r.Context().Value(businessRequestContextKey{}).(*verifiedBusinessRequest)
	wallet := actor.Account
	if verified != nil && verified.walletAccount != "" {
		wallet = verified.walletAccount
	}
	write(w, http.StatusOK, map[string]any{"Actor": wallet, "IdempotencyKey": in.IdempotencyKey, "QueryOnly": true, "Job": buyerWalletWire(job, verified)})
}
