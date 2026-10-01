package social

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Only encrypted payload metadata is recorded. Names, MIME types and decryption
// material belong inside the E2EE message, not in this registry or Cloud.
type cloudObjectRecord struct {
	ObjectID             string    `json:"objectId"`
	UploadID             string    `json:"uploadId"`
	ConversationID       string    `json:"conversationId"`
	Owner                string    `json:"owner"`
	DeviceID             string    `json:"deviceId"`
	IdempotencyKey       string    `json:"idempotencyKey"`
	TotalCiphertextBytes int64     `json:"totalCiphertextBytes"`
	SHA256               string    `json:"sha256"`
	CreatedAt            time.Time `json:"createdAt"`
}

type cloudRegistry struct {
	Version int                          `json:"version"`
	Objects map[string]cloudObjectRecord `json:"objects"`
}

func (a *CloudObjectAuthority) registryMAC(payload []byte) []byte {
	mac := hmac.New(sha256.New, a.service.cfg.TokenKey)
	mac.Write([]byte("ynx-social-cloud-object-registry-v1\n"))
	mac.Write(payload)
	return mac.Sum(nil)
}

// Caller holds registryMu. This sidecar is separate from the existing state
// schema so enabling Cloud does not invalidate or downgrade Social state.
func (a *CloudObjectAuthority) loadRegistry() (cloudRegistry, error) {
	empty := cloudRegistry{Version: 1, Objects: map[string]cloudObjectRecord{}}
	file, err := os.Open(a.service.cfg.StatePath + ".cloud-objects.json")
	if errors.Is(err, os.ErrNotExist) {
		return empty, nil
	}
	if err != nil {
		return empty, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (8<<20)+1))
	if err != nil {
		return empty, err
	}
	if len(data) > 8<<20 {
		return empty, errors.New("cloud object registry exceeds limit")
	}
	var envelope struct {
		Payload json.RawMessage `json:"payload"`
		MAC     string          `json:"mac"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return empty, err
	}
	digest, err := hex.DecodeString(envelope.MAC)
	if err != nil || !hmac.Equal(digest, a.registryMAC(envelope.Payload)) {
		return empty, errors.New("cloud object registry integrity failure")
	}
	var registry cloudRegistry
	if err := json.Unmarshal(envelope.Payload, &registry); err != nil {
		return empty, err
	}
	if registry.Version != 1 || registry.Objects == nil {
		return empty, errors.New("unsupported cloud object registry")
	}
	return registry, nil
}

func (a *CloudObjectAuthority) saveRegistry(registry cloudRegistry) error {
	payload, err := json.Marshal(registry)
	if err != nil {
		return err
	}
	data, err := json.Marshal(struct {
		Payload json.RawMessage `json:"payload"`
		MAC     string          `json:"mac"`
	}{payload, hex.EncodeToString(a.registryMAC(payload))})
	if err != nil {
		return err
	}
	if len(data) > 8<<20 {
		return ErrRateLimited
	}
	return writePrivateAtomic(a.service.cfg.StatePath+".cloud-objects.json", data)
}

func (a *CloudObjectAuthority) clientActor(w http.ResponseWriter, r *http.Request) (Session, bool) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method not allowed")
		return Session{}, false
	}
	if r.URL.RawQuery != "" {
		writeError(w, 400, "query fields are not accepted")
		return Session{}, false
	}
	actor, err := a.service.Authenticate(r.Header.Get("Authorization"), "social.messaging")
	if err != nil {
		writeServiceError(w, err)
		return Session{}, false
	}
	if !a.service.Allow(r.RemoteAddr, actor.Account, "cloud-object-capability") {
		writeServiceError(w, ErrRateLimited)
		return Session{}, false
	}
	return actor, true
}

func (a *CloudObjectAuthority) registerObject(w http.ResponseWriter, r *http.Request) {
	actor, ok := a.clientActor(w, r)
	if !ok {
		return
	}
	var in struct {
		ConversationID       string `json:"conversationId"`
		IdempotencyKey       string `json:"idempotencyKey"`
		TotalCiphertextBytes int64  `json:"totalCiphertextBytes"`
		SHA256               string `json:"sha256"`
	}
	if !decodeRequest(w, r, &in, 2048) {
		return
	}
	digest, err := hex.DecodeString(in.SHA256)
	if !identifierPattern.MatchString(in.ConversationID) || !identifierPattern.MatchString(in.IdempotencyKey) || in.TotalCiphertextBytes <= 0 || in.TotalCiphertextBytes > 25<<20 || err != nil || len(digest) != 32 || strings.ToLower(in.SHA256) != in.SHA256 {
		writeServiceError(w, ErrInvalid)
		return
	}
	if err := a.currentActor(actor, in.ConversationID); err != nil {
		writeServiceError(w, err)
		return
	}
	a.registryMu.Lock()
	defer a.registryMu.Unlock()
	registry, err := a.loadRegistry()
	if err != nil {
		writeError(w, 503, "object registry unavailable")
		return
	}
	for _, record := range registry.Objects {
		if record.Owner != actor.Account || record.IdempotencyKey != in.IdempotencyKey {
			continue
		}
		if record.DeviceID != actor.DeviceID || record.ConversationID != in.ConversationID || record.TotalCiphertextBytes != in.TotalCiphertextBytes || record.SHA256 != in.SHA256 {
			writeServiceError(w, ErrConflict)
			return
		}
		writeJSON(w, 200, cloudObjectPublicRecord(record))
		return
	}
	if len(registry.Objects) >= 10000 {
		writeServiceError(w, ErrRateLimited)
		return
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		writeError(w, 503, "object registry unavailable")
		return
	}
	record := cloudObjectRecord{ObjectID: "object_" + hex.EncodeToString(random[:16]), UploadID: "upload_" + hex.EncodeToString(random[16:]), ConversationID: in.ConversationID, Owner: actor.Account, DeviceID: actor.DeviceID, IdempotencyKey: in.IdempotencyKey, TotalCiphertextBytes: in.TotalCiphertextBytes, SHA256: in.SHA256, CreatedAt: a.service.cfg.Now().UTC()}
	registry.Objects[record.ObjectID] = record
	if err := a.saveRegistry(registry); err != nil {
		writeError(w, 503, "object registry unavailable")
		return
	}
	writeJSON(w, 201, cloudObjectPublicRecord(record))
}

func cloudObjectPublicRecord(record cloudObjectRecord) map[string]any {
	return map[string]any{"objectId": record.ObjectID, "uploadId": record.UploadID, "conversationId": record.ConversationID, "totalCiphertextBytes": record.TotalCiphertextBytes, "sha256": record.SHA256}
}

func (a *CloudObjectAuthority) objectCapability(w http.ResponseWriter, r *http.Request) {
	actor, ok := a.clientActor(w, r)
	if !ok {
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/social/v1/cloud-objects/"), "/")
	if len(parts) != 2 || !identifierPattern.MatchString(parts[0]) || parts[1] != "capability" {
		writeError(w, 404, "not found")
		return
	}
	var in struct {
		Operation string `json:"operation"`
	}
	if !decodeRequest(w, r, &in, 1024) {
		return
	}
	a.registryMu.Lock()
	registry, err := a.loadRegistry()
	a.registryMu.Unlock()
	if err != nil {
		writeError(w, 503, "object registry unavailable")
		return
	}
	record, ok := registry.Objects[parts[0]]
	if !ok {
		writeServiceError(w, ErrNotFound)
		return
	}
	// Upload mutation belongs to the originating device; deletion belongs to the
	// owner account. A current conversation device can request read only.
	if in.Operation != "object.read" && (record.Owner != actor.Account || (in.Operation != "object.delete" && record.DeviceID != actor.DeviceID)) {
		writeServiceError(w, ErrUnauthorized)
		return
	}
	bound := CloudObjectBinding{ConversationID: record.ConversationID, ObjectID: record.ObjectID, UploadID: record.UploadID, Operation: in.Operation}
	if in.Operation == "object.read" {
		bound.UploadID = ""
	}
	token, grant, err := a.Issue(actor, bound)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"capability": token, "expiresAt": grant.ExpiresAt, "operation": grant.Operation, "objectId": grant.ObjectID, "uploadId": grant.UploadID, "audience": grant.Audience})
}
