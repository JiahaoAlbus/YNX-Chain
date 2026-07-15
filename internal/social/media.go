package social

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
)

var allowedMediaMIME = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true, "video/mp4": true, "audio/mp4": true, "application/pdf": true}

func (s *Service) StoreMedia(actor Session, idempotencyKey, purpose, conversationID, mimeType, encoded, claimedHash string) (MediaObject, bool, error) {
	if !identifierPattern.MatchString(idempotencyKey) || !contains([]string{"moment", "message"}, purpose) || !allowedMediaMIME[mimeType] || !evidenceHashPattern.MatchString(claimedHash) {
		return MediaObject{}, false, ErrInvalid
	}
	if purpose == "moment" && !strings.HasPrefix(mimeType, "image/") && mimeType != "video/mp4" {
		return MediaObject{}, false, ErrInvalid
	}
	if purpose == "message" {
		if conversationID == "" {
			return MediaObject{}, false, ErrInvalid
		}
		if _, err := s.ContractConversation(actor, conversationID); err != nil {
			return MediaObject{}, false, err
		}
	} else if conversationID != "" {
		return MediaObject{}, false, ErrInvalid
	}
	data, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil || len(data) == 0 || int64(len(data)) > s.AttachmentPolicy().MaxBytes {
		return MediaObject{}, false, ErrInvalid
	}
	digest := sha256.Sum256(data)
	actualHash := hex.EncodeToString(digest[:])
	if actualHash != claimedHash {
		return MediaObject{}, false, fmt.Errorf("%w: media digest mismatch", ErrInvalid)
	}
	documentDigest := objectDigest(struct{ P, C, M, H, A string }{purpose, conversationID, mimeType, actualHash, actor.Account})
	stateKey := idempotencyStateKey(actor.Account, idempotencyKey)
	s.mu.Lock()
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		record := s.state.Media[previous.ObjectID]
		s.mu.Unlock()
		if previous.Action != "media_store" || previous.Digest != documentDigest {
			return MediaObject{}, false, ErrConflict
		}
		return record, true, nil
	}
	s.mu.Unlock()
	now := s.cfg.Now().UTC()
	record := MediaObject{ID: "media_" + documentDigest[:24], Owner: actor.Account, MIMEType: mimeType, SizeBytes: int64(len(data)), SHA256: actualHash, Purpose: purpose, ConversationID: conversationID, Encrypted: purpose == "message", CreatedAt: now}
	path := s.mediaPath(record.ID)
	if err := writePrivateAtomic(path, data); err != nil {
		return MediaObject{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	before := cloneState(s.state)
	s.state.Media[record.ID] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{Action: "media_store", Digest: documentDigest, ObjectID: record.ID}
	s.appendAuditLocked("media_stored", "media", record.ID, actor.Account, actualHash, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		_ = os.Remove(path)
		return MediaObject{}, false, err
	}
	return record, false, nil
}

func (s *Service) ReadMedia(actor Session, id string) (MediaObject, string, error) {
	s.mu.Lock()
	record, ok := s.state.Media[id]
	allowed := ok && record.Owner == actor.Account
	if ok && record.Purpose == "message" {
		for _, group := range s.state.Groups {
			if group.ID == record.ConversationID && contains(group.Members, actor.Account) {
				allowed = true
			}
		}
	}
	if ok && record.Purpose == "moment" {
		for _, moment := range s.state.Moments {
			if contains(moment.MediaIDs, id) && s.canViewMomentLocked(actor.Account, moment) {
				allowed = true
			}
		}
	}
	s.mu.Unlock()
	if !ok {
		return MediaObject{}, "", ErrNotFound
	}
	if record.Purpose == "message" && !allowed && s.cfg.Chat != nil {
		if _, err := s.cfg.Chat.Conversation(chatDevice(actor), record.ConversationID); err == nil {
			allowed = true
		}
	}
	if !allowed {
		return MediaObject{}, "", ErrUnauthorized
	}
	return record, s.mediaPath(id), nil
}

func (s *Service) mediaPath(id string) string {
	return filepath.Join(s.cfg.StatePath+".media", id+".bin")
}

func writePrivateAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".media-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func (s *Service) verifyMediaFiles() error {
	s.mu.Lock()
	records := make([]MediaObject, 0, len(s.state.Media))
	for _, record := range s.state.Media {
		records = append(records, record)
	}
	s.mu.Unlock()
	for _, record := range records {
		data, err := os.ReadFile(s.mediaPath(record.ID))
		if err != nil {
			return fmt.Errorf("media %s unavailable: %w", record.ID, err)
		}
		digest := sha256.Sum256(data)
		if int64(len(data)) != record.SizeBytes || hex.EncodeToString(digest[:]) != record.SHA256 {
			return errors.New("social media integrity check failed")
		}
	}
	return nil
}

func chatDevice(actor Session) chat.Device {
	return chat.Device{ID: actor.DeviceID, Account: actor.Account}
}
