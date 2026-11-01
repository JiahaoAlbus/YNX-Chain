package aiproduct

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// Materialization only stores the exact original model report locally. It
// neither approves this report nor authorizes external delivery. The WebDAV
// Source must independently approve the returned immutable attachment digest,
// original task revision/generation and fixed destination before any PUT.
func (s *Store) AddTaskModelReportAttachment(session ProductSession, conversationID, taskID, runID string) (Attachment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(session.Account, taskID)
	if err != nil {
		return Attachment{}, err
	}
	if task.ConversationID != conversationID || task.Holder != session.DeviceID || !task.CancelledAt.IsZero() || task.Status != "READY" && task.Status != "WORKING" {
		return Attachment{}, errToolConflict
	}
	run, ok := s.state.TaskRuns[runID]
	if !ok {
		run, ok = s.state.TaskRuns[modelRunKey(session.Account, taskID, runID)]
	}
	if !ok || run.Account != session.Account || run.TaskID != taskID || run.Holder != task.Holder || run.SessionID != session.ID || run.TaskRevision != task.Revision || run.Generation != task.Generation || run.Active || run.Cancelled || run.Status != "COMPLETED" || run.ReturnState != taskModelReturnVerified {
		return Attachment{}, errToolConflict
	}
	report, err := s.taskRunViewLocked(run)
	if err != nil {
		return Attachment{}, err
	}
	if report.Content == "" {
		return Attachment{}, errToolConflict
	}
	raw, err := json.Marshal(report)
	if err != nil {
		return Attachment{}, err
	}
	digest := sha256.Sum256(raw)
	hash := hex.EncodeToString(digest[:])
	name := run.ID + ".json"
	for _, a := range s.state.Attachments[conversationID] {
		if a.Name == name && a.SHA256 == hash {
			// Return only after authenticating the existing original bytes.
			plaintext, e := s.decrypt(session.Account, storedMessage{Message: Message{ID: a.ID, ConversationID: conversationID}, Nonce: a.Nonce, Cipher: a.Cipher})
			if e != nil {
				return Attachment{}, e
			}
			if plaintext != string(raw) {
				return Attachment{}, errToolConflict
			}
			return a.Attachment, nil
		}
	}
	return s.addAttachmentLocked(session.Account, conversationID, name, "application/json", raw)
}
