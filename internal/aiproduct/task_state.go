package aiproduct

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// TaskRecord is orchestration metadata, never an authorization or a grant.
type TaskRecord struct {
	ID                         string    `json:"id"`
	Account                    string    `json:"account"`
	ConversationID             string    `json:"conversationId"`
	Holder                     string    `json:"holder"`
	Revision                   uint64    `json:"revision"`
	Generation                 uint64    `json:"generation"`
	Status                     string    `json:"status"`
	CreatedAt                  time.Time `json:"createdAt"`
	UpdatedAt                  time.Time `json:"updatedAt"`
	CancelledAt                time.Time `json:"cancelledAt,omitempty"`
	AgentConfigurationID       string    `json:"agentConfigurationId,omitempty"`
	AgentConfigurationRevision uint64    `json:"agentConfigurationRevision,omitempty"`
}

// TaskProjection is a bounded metadata snapshot. Cursor is the task revision,
// not the global audit sequence; no other tenant's activity is disclosed.
type TaskProjection struct {
	TaskRecord
	Cursor       uint64         `json:"cursor"`
	Changed      bool           `json:"changed"`
	LatestCursor uint64         `json:"latestCursor"`
	HasMore      bool           `json:"hasMore"`
	RecoveryOnly bool           `json:"recoveryOnly,omitempty"`
	Events       []TaskEvent    `json:"events"`
	Steps        []ActionRecord `json:"steps"`
}

var (
	ErrTaskConflict = errors.New("task revision, generation or holder conflict")
	ErrTaskState    = errors.New("task state does not permit this operation")
	ErrTaskCursor   = errors.New("task cursor is ahead of current revision")
)

func (s *Store) CreateTask(account, conversationID, holder string) (TaskRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createTaskLocked(account, conversationID, holder)
}

func (s *Store) createTaskLocked(account, conversationID, holder string) (TaskRecord, error) {
	if strings.TrimSpace(account) == "" || strings.TrimSpace(conversationID) == "" {
		return TaskRecord{}, os.ErrNotExist
	}
	c, ok := s.state.Conversations[conversationID]
	if !ok || c.Account != account {
		return TaskRecord{}, os.ErrNotExist
	}
	if strings.TrimSpace(holder) == "" {
		return TaskRecord{}, errors.New("explicit task holder is required")
	}
	now := s.now().UTC()
	task := TaskRecord{ID: randomID("task"), Account: account, ConversationID: conversationID,
		Holder: holder, Revision: 1, Generation: 1, Status: "DRAFT", CreatedAt: now, UpdatedAt: now}
	// Do not overwrite even an extraordinarily unlikely random ID collision.
	if _, exists := s.state.Tasks[task.ID]; exists {
		return TaskRecord{}, ErrTaskConflict
	}
	if err := s.saveTaskLocked(task, "task_created"); err != nil {
		return TaskRecord{}, err
	}
	return task, nil
}

func (s *Store) ReadTaskProjection(account, id string, afterCursor uint64) (TaskProjection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(account, id)
	if err != nil {
		return TaskProjection{}, err
	}
	return s.taskEventProjectionLocked(task, afterCursor)
}

// HandoffTask requires the HTTP boundary to authenticate the owner and verify
// its external approval proof first. This CAS never mints or transfers grants.
func (s *Store) HandoffTask(account, id string, expectedRev, expectedGen uint64, currentHolder, newHolder string) (TaskRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.handoffTaskLocked(account, id, expectedRev, expectedGen, currentHolder, newHolder)
}

func (s *Store) handoffTaskLocked(account, id string, expectedRev, expectedGen uint64, currentHolder, newHolder string) (TaskRecord, error) {
	task, err := s.ownedTaskLocked(account, id)
	if err != nil {
		return TaskRecord{}, err
	}
	if strings.TrimSpace(currentHolder) == "" || strings.TrimSpace(newHolder) == "" {
		return TaskRecord{}, errors.New("explicit current and new task holders are required")
	}
	if currentHolder == newHolder || len(newHolder) > 256 || !task.CancelledAt.IsZero() {
		return TaskRecord{}, ErrTaskConflict
	}
	switch task.Status {
	case "DRAFT", "READY", "WORKING", "NEEDS_APPROVAL", "RECONCILING":
	default:
		return TaskRecord{}, ErrTaskState
	}
	if task.Revision != expectedRev || task.Generation != expectedGen || task.Holder != currentHolder {
		return TaskRecord{}, ErrTaskConflict
	}
	if task.Revision == ^uint64(0) || task.Generation == ^uint64(0) {
		return TaskRecord{}, ErrTaskConflict
	}
	// Close the old queue in the same durable commit as the holder CAS. Sent
	// effects keep their original IDs, status, evidence and first cause.
	previousActions := map[string]ActionRecord{}
	for id, record := range s.state.Actions {
		if record.Account == account && record.ToolStep != nil && record.ToolStep.TaskID == task.ID && (record.Status == "NEEDS_APPROVAL" || record.Status == "approved_not_executed") {
			previousActions[id] = record
			record.Status = "CANCELLED"
			s.state.Actions[id] = record
		}
	}
	previousRuns := map[string]taskModelRun{}
	for id, run := range s.state.TaskRuns {
		if run.Account != account || run.TaskID != task.ID || run.Holder != currentHolder || run.Status == "COMPLETED" {
			continue
		}
		previousRuns[id] = run
		run.Cancelled = true
		run.Status = "STOPPED"
		if s.taskHasUnresolvedEffectLocked(task.ID) {
			run.Status = "UNKNOWN"
		}
		s.state.TaskRuns[id] = run
	}
	if task.Status != "DRAFT" {
		task.Status = "READY"
	}
	task.Holder = newHolder
	task.Revision++
	task.Generation++
	task.UpdatedAt = s.now().UTC()
	if err := s.saveTaskLocked(task, "task_handed_off"); err != nil {
		for id, record := range previousActions {
			s.state.Actions[id] = record
		}
		for id, run := range previousRuns {
			s.state.TaskRuns[id] = run
		}
		return TaskRecord{}, err
	}
	return task, nil
}

// ownedTaskLocked rechecks the live conversation ACL on every access, including
// after deletion or ownership changes. Unknown and foreign IDs look identical.
func (s *Store) ownedTaskLocked(account, id string) (TaskRecord, error) {
	if strings.TrimSpace(account) == "" || strings.TrimSpace(id) == "" {
		return TaskRecord{}, os.ErrNotExist
	}
	task, ok := s.state.Tasks[id]
	if !ok || task.Account != account {
		return TaskRecord{}, os.ErrNotExist
	}
	c, ok := s.state.Conversations[task.ConversationID]
	if !ok || c.Account != account {
		return TaskRecord{}, os.ErrNotExist
	}
	if task.ID != id || task.Revision == 0 || task.Generation == 0 || strings.TrimSpace(task.Holder) == "" {
		return TaskRecord{}, ErrTaskState
	}
	switch task.Status {
	case "DRAFT", "READY", "WORKING", "NEEDS_APPROVAL", "RECONCILING", "COMPLETED", "FAILED", "CANCELLED":
		return task, nil
	default:
		return TaskRecord{}, ErrTaskState
	}
}

// saveTaskLocked commits only task metadata plus its audit entry. On failure it
// restores both, including a trimmed audit window and a formerly nil task map.
// Actions and their original remote outcomes are deliberately never rewritten.
func (s *Store) saveTaskLocked(task TaskRecord, event string) error {
	wasNil := s.state.Tasks == nil
	previous, existed := s.state.Tasks[task.ID]
	audits, sequence := s.state.Audits, s.state.AuditSequence
	previousEvents, eventsExisted := s.state.TaskEvents[task.ID]
	eventsWereNil := s.state.TaskEvents == nil
	if err := s.appendTaskEventLocked(task.ID, task.Revision, event, task.ID); err != nil {
		return err
	}
	if wasNil {
		s.state.Tasks = make(map[string]TaskRecord)
	}
	s.state.Tasks[task.ID] = task
	s.auditLocked(task.Account, event, task.ID, "task metadata updated; no authority granted")
	if err := s.saveLocked(); err != nil {
		if wasNil {
			s.state.Tasks = nil
		} else if existed {
			s.state.Tasks[task.ID] = previous
		} else {
			delete(s.state.Tasks, task.ID)
		}
		s.state.Audits, s.state.AuditSequence = audits, sequence
		s.restoreTaskEventsLocked(task.ID, previousEvents, eventsExisted, eventsWereNil)
		return fmt.Errorf("persist task state: %w", err)
	}
	return nil
}
