package commerce

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
)

func validateBusinessEffects(snapshot Snapshot) error {
	validDigest := func(value string) bool {
		raw, err := hex.DecodeString(value)
		return err == nil && len(raw) == sha256.Size && hex.EncodeToString(raw) == value
	}
	for id := range snapshot.RetiredBusinessEffects {
		if !validDigest(id) {
			return ErrInvalidState
		}
	}
	for id, record := range snapshot.BusinessEffects {
		if id != record.ID || !validDigest(id) || !validDigest(record.RequestHash) || !validDigest(record.Admission) || record.Actor == "" || record.Target == "" || !json.Valid(record.Input) {
			return ErrInvalidState
		}
		if record.Role != "buyer" && record.Role != "seller" {
			return ErrInvalidState
		}
		for _, step := range record.Steps {
			if readBusinessEffect(record.Kind) && step.Method != http.MethodGet {
				return ErrInvalidState
			}
			if step.Method == "" || step.Origin == "" || step.Path == "" || !validDigest(step.RequestDigest) || effectDigest(string(step.Request)) != step.RequestDigest || (len(step.Request) > 0 && !json.Valid(step.Request)) {
				return ErrInvalidState
			}
			switch step.Phase {
			case "dispatching", "unknown", "not_sent", "response_unusable":
				if len(step.Response) != 0 {
					return ErrInvalidState
				}
			case "received":
				if step.Status < 100 || step.Status > 599 || !json.Valid(step.Response) {
					return ErrInvalidState
				}
			default:
				return ErrInvalidState
			}
		}
		switch record.Phase {
		case "observed":
			if !readBusinessEffect(record.Kind) {
				return ErrInvalidState
			}
		case "admitted", "dispatching", "unknown", "abandoned":
		case "received", "completed":
			if !json.Valid(record.Result) {
				return ErrInvalidState
			}
		default:
			return ErrInvalidState
		}
		if record.Phase == "completed" && !json.Valid(record.Response) {
			return ErrInvalidState
		}
		if _, retired := snapshot.RetiredBusinessEffects[id]; retired {
			return ErrInvalidState
		}
	}
	return nil
}

// All callbacks are server-owned. prepare/check/finish/view are local Store
// operations; send alone performs external I/O, always outside the Store lock.
type businessEffectPlan struct {
	kind, target, key string
	prepare           func(*Store, string) (json.RawMessage, error)
	check             func(*Store, string, BusinessEffect) error
	send              func(context.Context, BusinessEffect) (json.RawMessage, error)
	finish            func(*Store, string, BusinessEffect) (any, error)
	view              func(*Store, string, BusinessEffect) (any, error)
	status            int
}

// This list is owner-defined, never caller supplied. A fresh signed settlement
// observation may repeat its GET after an unavailable or pending response.
func readBusinessEffect(kind string) bool { return kind == "pay.settlement" }

func effectDigest(parts ...string) string {
	raw, _ := json.Marshal(parts)
	sum := sha256.Sum256(append([]byte("YNX_COMMERCE_EXTERNAL_V2\n"), raw...))
	return hex.EncodeToString(sum[:])
}

func (s *Store) effectReceipt(id string, result json.RawMessage, received bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.s.BusinessEffects[id]
	if !ok || record.Phase != "dispatching" {
		return ErrConflict
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		return err
	}
	if received {
		if !json.Valid(result) {
			return ErrInvalidState
		}
		record.Result = append(json.RawMessage(nil), result...)
		record.Phase = "received"
	} else {
		record.Phase = "unknown"
	}
	if readBusinessEffect(record.Kind) {
		record.Phase = "observed"
	}
	if record.Kind == "ai.generate" {
		if job, ok := s.s.AIJobs[record.Target]; ok && job.Actor == record.Actor {
			if received && job.Cancelled {
				record.Phase = "abandoned"
			} else if !received {
				job.ProviderStatus = "outcome_unconfirmed"
				s.s.AIJobs[job.ID] = job
			}
		}
	}
	record.UpdatedAt = s.now()
	s.s.BusinessEffects[id] = record
	if err := s.persistLocked(); err != nil {
		s.s = before
		return err
	}
	return nil
}

func (s *Store) effectNotSent(id, admission string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.s.BusinessEffects[id]
	if !ok || record.Phase != "dispatching" || record.Admission != admission {
		return ErrConflict
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		return err
	}
	record.Phase = "admitted"
	record.UpdatedAt = s.now()
	s.s.BusinessEffects[id] = record
	if err := s.persistLocked(); err != nil {
		s.s = before
		return err
	}
	return nil
}

func (s *Server) runBusinessEffect(ctx context.Context, verified *verifiedBusinessRequest, body []byte, plan businessEffectPlan) (any, int, error) {
	if plan.prepare == nil || plan.check == nil || plan.send == nil || plan.finish == nil || plan.view == nil || plan.key == "" {
		return nil, 0, ErrInvalidState
	}
	ctx = context.WithValue(ctx, businessRequestContextKey{}, verified)
	var record BusinessEffect
	actor := verified.principal.Account
	admission := businessNonceDigest(verified.proof.SessionBinding, verified.proof.Nonce)
	requestHash := effectDigest(string(body))
	fence := func() error { return verified.current(ctx) }
	err := s.store.withBusinessAction(ctx, verified.proof, fence, func(tx *Store) error {
		if verified.walletAccount != "" {
			var err error
			actor, err = tx.resolveBusinessActor(verified.walletAccount)
			if err != nil {
				return err
			}
		}
		id := effectDigest(actor, verified.principal.Role, plan.kind, plan.target, plan.key)
		for _, alias := range businessActorAliases(actor) {
			if _, retired := tx.s.RetiredBusinessEffects[effectDigest(alias, verified.principal.Role, plan.kind, plan.target, plan.key)]; retired {
				return ErrConflict
			}
		}
		if existing, ok := tx.s.BusinessEffects[id]; ok {
			if existing.Actor != actor || existing.Role != verified.principal.Role || existing.RequestHash != requestHash {
				return ErrConflict
			}
			if existing.Phase == "unknown" || existing.Phase == "dispatching" {
				return &businessHTTPError{"BUSINESS_OUTCOME_UNCONFIRMED", http.StatusConflict}
			}
			record = existing
		} else {
			// An alternative client key cannot escape an unresolved operation.
			for _, other := range tx.s.BusinessEffects {
				if !readBusinessEffect(plan.kind) && other.Actor == actor && other.Kind == plan.kind && other.Target == plan.target && other.Phase != "completed" {
					return &businessHTTPError{"BUSINESS_OUTCOME_UNCONFIRMED", http.StatusConflict}
				}
			}
			input, err := plan.prepare(tx, actor)
			if err != nil {
				return err
			}
			if !json.Valid(input) {
				return ErrInvalidState
			}
			record = BusinessEffect{ID: id, Actor: actor, Role: verified.principal.Role, Kind: plan.kind, Target: plan.target, RequestHash: requestHash, Input: input, Phase: "admitted", CreatedAt: tx.now()}
		}
		if record.Phase != "completed" {
			if err := plan.check(tx, actor, record); err != nil {
				return err
			}
		}
		record.Admission = admission
		record.UpdatedAt = tx.now()
		if tx.s.BusinessEffects == nil {
			tx.s.BusinessEffects = map[string]BusinessEffect{}
		}
		tx.s.BusinessEffects[id] = record
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	if record.Phase == "admitted" {
		if err := verified.revalidate(ctx); err != nil {
			return nil, 0, err
		}
		err = s.store.withBusinessContinuation(ctx, verified.proof, fence, func(tx *Store) error {
			current, ok := tx.s.BusinessEffects[record.ID]
			if !ok || current.Admission != admission || current.Phase != "admitted" {
				return ErrConflict
			}
			if err := plan.check(tx, actor, current); err != nil {
				return err
			}
			current.Phase = "dispatching"
			current.UpdatedAt = tx.now()
			tx.s.BusinessEffects[record.ID] = current
			record = current
			return nil
		})
		if err != nil {
			return nil, 0, err
		}
		// This check occurs before send is called, so it proves no send occurred.
		if err := fence(); err != nil {
			if recordErr := s.store.effectNotSent(record.ID, admission); recordErr != nil {
				return nil, 0, recordErr
			}
			return nil, 0, err
		}
		result, sendErr := plan.send(effectSendContext(ctx, s.store, record.ID, verified, actor, plan.check), record)
		if err := s.store.effectReceipt(record.ID, result, sendErr == nil); err != nil {
			return nil, 0, err
		}
		if sendErr != nil {
			if readBusinessEffect(plan.kind) {
				return nil, 0, sendErr
			}
			return nil, 0, &businessHTTPError{"BUSINESS_OUTCOME_UNCONFIRMED", http.StatusConflict}
		}
		record.Phase = "received"
		record.Result = append(json.RawMessage(nil), result...)
	}
	// Record the actual provider receipt before suppressing a late/private reply.
	// A new explicit signed retry may finish a received receipt without resending.
	if err := verified.revalidate(ctx); err != nil {
		return nil, 0, err
	}
	var response any
	err = s.store.withBusinessContinuation(ctx, verified.proof, fence, func(tx *Store) error {
		current, ok := tx.s.BusinessEffects[record.ID]
		if !ok || current.Admission != admission {
			return ErrConflict
		}
		if current.Phase == "completed" {
			var err error
			response, err = plan.view(tx, actor, current)
			return err
		}
		if current.Phase != "received" && !(readBusinessEffect(current.Kind) && current.Phase == "observed" && json.Valid(current.Result)) {
			return ErrConflict
		}
		if err := plan.check(tx, actor, current); err != nil {
			return err
		}
		var err error
		response, err = plan.finish(tx, actor, current)
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(response)
		if err != nil {
			return err
		}
		current.Response = encoded
		current.Phase = "completed"
		current.UpdatedAt = tx.now()
		tx.s.BusinessEffects[current.ID] = current
		return nil
	})
	return response, plan.status, err
}

func encodeEffect(value any) (json.RawMessage, error) {
	data, err := json.Marshal(value)
	return data, err
}
func decodeEffect(raw json.RawMessage, out any) error {
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%w: invalid saved provider receipt", ErrInvalidState)
	}
	return nil
}
