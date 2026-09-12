package social

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"strings"
	"sync"
	"time"
)

const cloudObjectAudience = "ynx-cloud-social-attachments-v1"
const cloudCapabilityPrefix = "ynx-social-object-v1."

// CloudObjectBinding must come from a server-owned object record, never directly
// from client input. Object ownership and upload identity are the issuer's duty.
type CloudObjectBinding struct {
	ConversationID string `json:"conversationId"`
	ObjectID       string `json:"objectId"`
	UploadID       string `json:"uploadId"`
	Operation      string `json:"operation"`
}

type CloudObjectGrant struct {
	Version  int    `json:"version"`
	Product  string `json:"product"`
	Audience string `json:"audience"`
	Subject  string `json:"subject"`
	DeviceID string `json:"deviceId"`
	CloudObjectBinding
	ExpiresAt time.Time `json:"expiresAt"`
}

type cloudCapability struct {
	actor Session
	grant CloudObjectGrant
}

// Capabilities deliberately fail closed after restart. This component does not
// expose a client mint endpoint or accept Social bearer tokens from Cloud.
type CloudObjectAuthority struct {
	registryMu    sync.Mutex
	service       *Service
	machineDigest [32]byte
	mu            sync.Mutex
	grants        map[[32]byte]cloudCapability
}

func NewCloudObjectAuthority(service *Service, machineToken string) (*CloudObjectAuthority, error) {
	if service == nil || len(machineToken) < 32 || strings.TrimSpace(machineToken) != machineToken {
		return nil, ErrInvalid
	}
	return &CloudObjectAuthority{service: service, machineDigest: sha256.Sum256([]byte("Bearer " + machineToken)), grants: make(map[[32]byte]cloudCapability)}, nil
}

func validCloudBinding(b CloudObjectBinding) bool {
	if !identifierPattern.MatchString(b.ConversationID) || !identifierPattern.MatchString(b.ObjectID) {
		return false
	}
	switch b.Operation {
	case "object.read":
		return b.UploadID == ""
	case "upload.create", "upload.status", "upload.part", "upload.complete", "upload.cancel", "object.delete":
		return identifierPattern.MatchString(b.UploadID)
	default:
		return false
	}
}

func (a *CloudObjectAuthority) currentActor(actor Session, conversation string) error {
	s := a.service
	check := func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		_, current, ok := s.sessionByIDLocked(actor.ID)
		device, deviceOK := s.state.Devices[actor.DeviceID]
		return ok && current.Account == actor.Account && current.DeviceID == actor.DeviceID && current.RevokedAt == nil && current.ExpiresAt.After(s.cfg.Now()) && contains(current.Scopes, "social.messaging") && deviceOK && device.Account == actor.Account && device.Status == "active"
	}
	if !check() {
		return ErrUnauthorized
	}
	devices, err := s.ConversationDevices(actor, conversation)
	if err != nil {
		return ErrUnauthorized
	}
	addressed := false
	for _, device := range devices {
		if device.ID == actor.DeviceID && device.Account == actor.Account && device.Status == "active" {
			addressed = true
		}
	}
	if !addressed || !check() {
		return ErrUnauthorized
	}
	return nil
}

// Issue is for trusted server callers after resolving an authorized object
// record. Every subsequent redemption also checks live session/device/access.
func (a *CloudObjectAuthority) Issue(actor Session, binding CloudObjectBinding) (string, CloudObjectGrant, error) {
	if !validCloudBinding(binding) {
		return "", CloudObjectGrant{}, ErrInvalid
	}
	if err := a.currentActor(actor, binding.ConversationID); err != nil {
		return "", CloudObjectGrant{}, err
	}
	now := a.service.cfg.Now().UTC()
	expires := now.Add(90 * time.Second)
	if actor.ExpiresAt.Before(expires) {
		expires = actor.ExpiresAt
	}
	var entropy [32]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", CloudObjectGrant{}, err
	}
	token := cloudCapabilityPrefix + base64.RawURLEncoding.EncodeToString(entropy[:])
	grant := CloudObjectGrant{Version: 1, Product: "social", Audience: cloudObjectAudience, Subject: actor.Account, DeviceID: actor.DeviceID, CloudObjectBinding: binding, ExpiresAt: expires}
	a.mu.Lock()
	defer a.mu.Unlock()
	for key, entry := range a.grants {
		if !entry.grant.ExpiresAt.After(now) {
			delete(a.grants, key)
		}
	}
	if len(a.grants) >= 4096 {
		return "", CloudObjectGrant{}, ErrRateLimited
	}
	a.grants[sha256.Sum256([]byte(token))] = cloudCapability{actor: actor, grant: grant}
	return token, grant, nil
}

func matchesCloudRequest(grant CloudObjectGrant, operation, objectID, uploadID string) bool {
	if operation != grant.Operation || (objectID != "" && objectID != grant.ObjectID) || (uploadID != "" && uploadID != grant.UploadID) {
		return false
	}
	switch operation {
	case "upload.create":
		return objectID != "" && uploadID != ""
	case "upload.status", "upload.part", "upload.complete", "upload.cancel":
		return uploadID != ""
	case "object.read", "object.delete":
		return objectID != ""
	default:
		return false
	}
}

func (a *CloudObjectAuthority) authorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method not allowed")
		return
	}
	if r.URL.RawQuery != "" {
		writeError(w, 400, "query fields are not accepted")
		return
	}
	digest := sha256.Sum256([]byte(r.Header.Get("Authorization")))
	if subtle.ConstantTimeCompare(digest[:], a.machineDigest[:]) != 1 {
		writeError(w, 401, "cloud authority access denied")
		return
	}
	var in struct {
		Version    int    `json:"version"`
		Capability string `json:"capability"`
		Operation  string `json:"operation"`
		ObjectID   string `json:"objectId"`
		UploadID   string `json:"uploadId"`
	}
	if !decodeRequest(w, r, &in, 4096) {
		return
	}
	if in.Version != 1 || !strings.HasPrefix(in.Capability, cloudCapabilityPrefix) {
		writeError(w, 403, "invalid cloud capability")
		return
	}
	a.mu.Lock()
	entry, ok := a.grants[sha256.Sum256([]byte(in.Capability))]
	a.mu.Unlock()
	if !ok || !entry.grant.ExpiresAt.After(a.service.cfg.Now()) || !matchesCloudRequest(entry.grant, in.Operation, in.ObjectID, in.UploadID) {
		writeError(w, 403, "invalid cloud capability")
		return
	}
	if err := a.currentActor(entry.actor, entry.grant.ConversationID); err != nil {
		writeError(w, 403, "cloud capability access revoked")
		return
	}
	writeJSON(w, 200, entry.grant)
}
