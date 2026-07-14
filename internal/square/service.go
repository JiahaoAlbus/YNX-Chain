package square

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

var (
	identifierPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$`)
	tagPattern        = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)
	hashPattern       = regexp.MustCompile(`^(sha256:)?[0-9a-f]{64}$`)
)

type Service struct {
	mu    sync.Mutex
	cfg   Config
	state persistentState
	seen  map[string][]time.Time
}

func New(cfg Config) (*Service, error) {
	cfg.StatePath = strings.TrimSpace(cfg.StatePath)
	cfg.APIKey = strings.TrimSpace(cfg.APIKey)
	if cfg.MaxBodyBytes == 0 {
		cfg.MaxBodyBytes = 16 * 1024
	}
	if cfg.RateLimitWindow <= 0 {
		cfg.RateLimitWindow = time.Minute
	}
	if cfg.RateLimitMax <= 0 {
		cfg.RateLimitMax = 120
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	if err := ValidateConfig(cfg); err != nil {
		return nil, err
	}
	state, existed, err := loadState(cfg.StatePath)
	if err != nil {
		return nil, err
	}
	service := &Service{cfg: cfg, state: state, seen: map[string][]time.Time{}}
	if err := service.validateLocked(); err != nil {
		return nil, err
	}
	if !existed {
		if err := saveState(cfg.StatePath, &service.state); err != nil {
			return nil, err
		}
	}
	return service, nil
}

func ValidateConfig(cfg Config) error {
	if strings.TrimSpace(cfg.StatePath) == "" || len(strings.TrimSpace(cfg.APIKey)) < 16 {
		return errors.New("square state path and API key of at least 16 characters are required")
	}
	if cfg.MaxBodyBytes < 1024 || cfg.MaxBodyBytes > 1024*1024 {
		return errors.New("square body limit must be between 1024 and 1048576 bytes")
	}
	if cfg.RateLimitWindow <= 0 || cfg.RateLimitMax <= 0 || cfg.RateLimitMax > 10000 {
		return errors.New("square rate limit must use a positive window and max at most 10000")
	}
	return nil
}

func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	return len(value) == len(s.cfg.APIKey) && subtle.ConstantTimeCompare([]byte(value), []byte(s.cfg.APIKey)) == 1
}

func (s *Service) Allow(remoteAddress, deviceID string) bool {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err != nil {
		host = remoteAddress
	}
	key := strings.TrimSpace(deviceID) + "|" + strings.TrimSpace(host)
	now := s.cfg.Now().UTC()
	cutoff := now.Add(-s.cfg.RateLimitWindow)
	s.mu.Lock()
	defer s.mu.Unlock()
	recent := s.seen[key][:0]
	for _, at := range s.seen[key] {
		if at.After(cutoff) {
			recent = append(recent, at)
		}
	}
	if len(recent) >= s.cfg.RateLimitMax {
		s.seen[key] = recent
		return false
	}
	s.seen[key] = append(recent, now)
	return true
}

func DeviceRegistrationPayload(req RegisterDeviceRequest) []byte {
	return []byte(strings.Join([]string{"ynx-square-device-register-v1", req.Account, req.DeviceID, req.SigningPublicKey, req.IdempotencyKey}, "\n"))
}

func RequestSignaturePayload(method, path, timestamp string, body []byte) []byte {
	digest := sha256.Sum256(body)
	return []byte(strings.Join([]string{"ynx-square-http-v1", strings.ToUpper(method), path, timestamp, hex.EncodeToString(digest[:])}, "\n"))
}

func (s *Service) RegisterDevice(req RegisterDeviceRequest) (Result[Device], error) {
	account, err := nativewallet.NormalizeNativeAddress(req.Account)
	if err != nil || !identifierPattern.MatchString(req.DeviceID) || !identifierPattern.MatchString(req.IdempotencyKey) {
		return Result[Device]{}, fmt.Errorf("%w: native account, device id, or idempotency key", ErrInvalid)
	}
	req.Account = account
	if _, err := nativewallet.DecodePublicKey(req.SigningPublicKey, ed25519.PublicKeySize); err != nil {
		return Result[Device]{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if !nativewallet.Verify(req.SigningPublicKey, DeviceRegistrationPayload(req), req.ProofSignature) {
		return Result[Device]{}, fmt.Errorf("%w: device private-key proof failed", ErrUnauthorized)
	}
	digest := objectDigest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "device_register" || previous.Digest != digest {
			return Result[Device]{}, ErrConflict
		}
		return Result[Device]{Record: s.state.Devices[previous.ObjectID], Replayed: true}, nil
	}
	if _, exists := s.state.Devices[req.DeviceID]; exists {
		return Result[Device]{}, ErrConflict
	}
	now := s.cfg.Now().UTC()
	device := Device{ID: req.DeviceID, Account: account, SigningPublicKey: req.SigningPublicKey, Status: "active", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Devices[device.ID] = device
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "device_register", Digest: digest, ObjectID: device.ID}
	s.appendAuditLocked("device_registered", "device", device.ID, account, digest, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[Device]{}, err
	}
	return Result[Device]{Record: device}, nil
}

func (s *Service) AuthenticateDevice(deviceID, method, path, timestamp, signature string, body []byte) (Device, error) {
	parsed, err := time.Parse(time.RFC3339, timestamp)
	if err != nil || absDuration(s.cfg.Now().Sub(parsed)) > 5*time.Minute {
		return Device{}, fmt.Errorf("%w: request timestamp invalid or stale", ErrUnauthorized)
	}
	s.mu.Lock()
	device, ok := s.state.Devices[deviceID]
	s.mu.Unlock()
	if !ok || device.Status != "active" || !nativewallet.Verify(device.SigningPublicKey, RequestSignaturePayload(method, path, timestamp, body), signature) {
		return Device{}, fmt.Errorf("%w: device signature failed", ErrUnauthorized)
	}
	return device, nil
}

func (s *Service) RevokeDevice(actor Device, deviceID string) (Device, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	device, ok := s.state.Devices[deviceID]
	if !ok {
		return Device{}, ErrNotFound
	}
	if actor.Account != device.Account || device.Status != "active" {
		return Device{}, ErrUnauthorized
	}
	before := cloneState(s.state)
	device.Status = "revoked"
	device.UpdatedAt = s.cfg.Now().UTC()
	s.state.Devices[deviceID] = device
	s.appendAuditLocked("device_revoked", "device", device.ID, actor.Account, objectDigest(device), device.UpdatedAt)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Device{}, err
	}
	return device, nil
}

func (s *Service) CreatePost(actor Device, req CreatePostRequest) (Result[Post], error) {
	req.Content = strings.TrimSpace(req.Content)
	if !identifierPattern.MatchString(req.IdempotencyKey) || len(req.Content) == 0 || len(req.Content) > 4000 || len(req.Tags) > 8 {
		return Result[Post]{}, fmt.Errorf("%w: post content, tags, or idempotency", ErrInvalid)
	}
	seenTags := map[string]bool{}
	for index, tag := range req.Tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if !tagPattern.MatchString(tag) || seenTags[tag] {
			return Result[Post]{}, fmt.Errorf("%w: invalid or duplicate tag", ErrInvalid)
		}
		seenTags[tag] = true
		req.Tags[index] = tag
	}
	sort.Strings(req.Tags)
	digest := objectDigest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if replay, record, err := replayPost(s.state, req.IdempotencyKey, "post_create", digest); replay || err != nil {
		return Result[Post]{Record: record, Replayed: replay}, err
	}
	now := s.cfg.Now().UTC()
	id := "post_" + digest[:24]
	post := Post{ID: id, Author: actor.Account, AuthorDevice: actor.ID, Content: req.Content, Tags: append([]string(nil), req.Tags...), Status: "active", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Posts[id] = post
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "post_create", Digest: digest, ObjectID: id}
	s.appendAuditLocked("post_created", "post", id, actor.Account, digest, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[Post]{}, err
	}
	return Result[Post]{Record: post}, nil
}

func replayPost(state persistentState, key, action, digest string) (bool, Post, error) {
	previous, ok := state.Idempotency[key]
	if !ok {
		return false, Post{}, nil
	}
	if previous.Action != action || previous.Digest != digest {
		return false, Post{}, ErrConflict
	}
	return true, state.Posts[previous.ObjectID], nil
}

func (s *Service) Post(id string) (Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.state.Posts[id]
	if !ok || record.Status != "active" {
		return Post{}, ErrNotFound
	}
	return record, nil
}

func (s *Service) Feed(limit int, cursor string) (Feed, error) {
	if limit == 0 {
		limit = 20
	}
	if limit < 1 || limit > 100 {
		return Feed{}, ErrInvalid
	}
	s.mu.Lock()
	posts := make([]Post, 0, len(s.state.Posts))
	for _, post := range s.state.Posts {
		if post.Status == "active" {
			posts = append(posts, post)
		}
	}
	s.mu.Unlock()
	sort.Slice(posts, func(i, j int) bool {
		if posts[i].CreatedAt.Equal(posts[j].CreatedAt) {
			return posts[i].ID > posts[j].ID
		}
		return posts[i].CreatedAt.After(posts[j].CreatedAt)
	})
	start := 0
	if cursor != "" {
		start = -1
		for index, post := range posts {
			if post.ID == cursor {
				start = index + 1
				break
			}
		}
		if start < 0 {
			return Feed{}, fmt.Errorf("%w: cursor", ErrInvalid)
		}
	}
	end := start + limit
	if end > len(posts) {
		end = len(posts)
	}
	feed := Feed{Posts: append([]Post{}, posts[start:end]...)}
	if end < len(posts) && end > start {
		feed.NextCursor = posts[end-1].ID
	}
	return feed, nil
}

func (s *Service) CreateComment(actor Device, postID string, req CreateCommentRequest) (Result[Comment], error) {
	req.Content = strings.TrimSpace(req.Content)
	if !identifierPattern.MatchString(req.IdempotencyKey) || len(req.Content) == 0 || len(req.Content) > 2000 {
		return Result[Comment]{}, ErrInvalid
	}
	digest := objectDigest(struct {
		PostID  string
		Request CreateCommentRequest
	}{postID, req})
	s.mu.Lock()
	defer s.mu.Unlock()
	post, ok := s.state.Posts[postID]
	if !ok || post.Status != "active" {
		return Result[Comment]{}, ErrNotFound
	}
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "comment_create" || previous.Digest != digest {
			return Result[Comment]{}, ErrConflict
		}
		for _, comment := range s.state.Comments[postID] {
			if comment.ID == previous.ObjectID {
				return Result[Comment]{Record: comment, Replayed: true}, nil
			}
		}
		return Result[Comment]{}, errors.New("square idempotency comment reference is missing")
	}
	now := s.cfg.Now().UTC()
	id := "comment_" + digest[:24]
	comment := Comment{ID: id, PostID: postID, Author: actor.Account, AuthorDevice: actor.ID, Content: req.Content, Status: "active", CreatedAt: now}
	before := cloneState(s.state)
	s.state.Comments[postID] = append(s.state.Comments[postID], comment)
	post.CommentCount++
	post.UpdatedAt = now
	s.state.Posts[postID] = post
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "comment_create", Digest: digest, ObjectID: id}
	s.appendAuditLocked("comment_created", "comment", id, actor.Account, digest, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[Comment]{}, err
	}
	return Result[Comment]{Record: comment}, nil
}

func (s *Service) Comments(postID string) ([]Comment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if post, ok := s.state.Posts[postID]; !ok || post.Status != "active" {
		return nil, ErrNotFound
	}
	return append([]Comment(nil), s.state.Comments[postID]...), nil
}

func (s *Service) SetReaction(actor Device, postID string, req SetReactionRequest) (Result[Reaction], error) {
	req.Kind = strings.ToLower(strings.TrimSpace(req.Kind))
	if !identifierPattern.MatchString(req.IdempotencyKey) || (req.Kind != "like" && req.Kind != "insight" && req.Kind != "support") {
		return Result[Reaction]{}, ErrInvalid
	}
	digest := objectDigest(struct {
		PostID  string
		Account string
		Request SetReactionRequest
	}{postID, actor.Account, req})
	s.mu.Lock()
	defer s.mu.Unlock()
	post, ok := s.state.Posts[postID]
	if !ok || post.Status != "active" {
		return Result[Reaction]{}, ErrNotFound
	}
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "reaction_set" || previous.Digest != digest {
			return Result[Reaction]{}, ErrConflict
		}
		return Result[Reaction]{Record: s.state.Reactions[previous.ObjectID], Replayed: true}, nil
	}
	key := postID + "|" + actor.Account
	prior := s.state.Reactions[key]
	now := s.cfg.Now().UTC()
	reaction := Reaction{PostID: postID, Account: actor.Account, Kind: req.Kind, Active: req.Active, UpdatedAt: now}
	before := cloneState(s.state)
	if !prior.Active && reaction.Active {
		post.ReactionCount++
	}
	if prior.Active && !reaction.Active {
		post.ReactionCount--
	}
	post.UpdatedAt = now
	s.state.Posts[postID] = post
	s.state.Reactions[key] = reaction
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "reaction_set", Digest: digest, ObjectID: key}
	s.appendAuditLocked("reaction_set", "post", postID, actor.Account, digest, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[Reaction]{}, err
	}
	return Result[Reaction]{Record: reaction}, nil
}

func (s *Service) SetFollow(actor Device, req SetFollowRequest) (Result[Follow], error) {
	target, err := nativewallet.NormalizeNativeAddress(req.Account)
	if err != nil || target == actor.Account || !identifierPattern.MatchString(req.IdempotencyKey) {
		return Result[Follow]{}, ErrInvalid
	}
	req.Account = target
	digest := objectDigest(struct {
		Follower string
		Request  SetFollowRequest
	}{actor.Account, req})
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "follow_set" || previous.Digest != digest {
			return Result[Follow]{}, ErrConflict
		}
		return Result[Follow]{Record: s.state.Follows[previous.ObjectID], Replayed: true}, nil
	}
	key := actor.Account + "|" + target
	now := s.cfg.Now().UTC()
	follow := Follow{Follower: actor.Account, Following: target, Active: req.Active, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Follows[key] = follow
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "follow_set", Digest: digest, ObjectID: key}
	s.appendAuditLocked("follow_set", "account", target, actor.Account, digest, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[Follow]{}, err
	}
	return Result[Follow]{Record: follow}, nil
}

func (s *Service) Following(account string) ([]string, error) {
	normalized, err := nativewallet.NormalizeNativeAddress(account)
	if err != nil {
		return nil, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	result := []string{}
	for _, follow := range s.state.Follows {
		if follow.Active && follow.Follower == normalized {
			result = append(result, follow.Following)
		}
	}
	sort.Strings(result)
	return result, nil
}

func (s *Service) CreateReport(actor Device, req CreateReportRequest) (Result[Report], error) {
	req.TargetType = strings.ToLower(strings.TrimSpace(req.TargetType))
	req.TargetID = strings.TrimSpace(req.TargetID)
	req.Category = strings.ToLower(strings.TrimSpace(req.Category))
	req.Detail = strings.TrimSpace(req.Detail)
	if !identifierPattern.MatchString(req.IdempotencyKey) || (req.TargetType != "post" && req.TargetType != "comment" && req.TargetType != "account") || req.TargetID == "" || len(req.TargetID) > 128 || !identifierPattern.MatchString(req.Category) || len(req.Detail) > 2000 || len(req.EvidenceHashes) > 8 {
		return Result[Report]{}, ErrInvalid
	}
	if req.TargetType == "account" {
		normalized, err := nativewallet.NormalizeNativeAddress(req.TargetID)
		if err != nil {
			return Result[Report]{}, ErrInvalid
		}
		req.TargetID = normalized
	}
	for index, hash := range req.EvidenceHashes {
		hash = strings.ToLower(strings.TrimSpace(hash))
		if !hashPattern.MatchString(hash) {
			return Result[Report]{}, ErrInvalid
		}
		req.EvidenceHashes[index] = hash
	}
	digest := objectDigest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.targetExistsLocked(req.TargetType, req.TargetID) {
		return Result[Report]{}, ErrNotFound
	}
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "report_create" || previous.Digest != digest {
			return Result[Report]{}, ErrConflict
		}
		return Result[Report]{Record: s.state.Reports[previous.ObjectID], Replayed: true}, nil
	}
	now := s.cfg.Now().UTC()
	id := "report_" + digest[:24]
	report := Report{ID: id, Reporter: actor.Account, TargetType: req.TargetType, TargetID: req.TargetID, Category: req.Category, Detail: req.Detail, EvidenceHashes: append([]string(nil), req.EvidenceHashes...), Status: "pending_review", AppealRoute: "/trust/appeals", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Reports[id] = report
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "report_create", Digest: digest, ObjectID: id}
	s.appendAuditLocked("report_created", "report", id, actor.Account, digest, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[Report]{}, err
	}
	return Result[Report]{Record: report}, nil
}

func (s *Service) Report(actor Device, id string) (Report, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	report, ok := s.state.Reports[id]
	if !ok {
		return Report{}, ErrNotFound
	}
	if report.Reporter != actor.Account {
		return Report{}, ErrUnauthorized
	}
	return report, nil
}

func (s *Service) targetExistsLocked(kind, id string) bool {
	switch kind {
	case "post":
		_, ok := s.state.Posts[id]
		return ok
	case "comment":
		for _, comments := range s.state.Comments {
			for _, comment := range comments {
				if comment.ID == id {
					return true
				}
			}
		}
		return false
	case "account":
		return true
	default:
		return false
	}
}

func (s *Service) Health() Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	comments, reactions, follows := 0, 0, 0
	for _, records := range s.state.Comments {
		comments += len(records)
	}
	for _, record := range s.state.Reactions {
		if record.Active {
			reactions++
		}
	}
	for _, record := range s.state.Follows {
		if record.Active {
			follows++
		}
	}
	status := "local-bounded-square-core-not-remote-deployed"
	if s.cfg.RemoteDeployed {
		status = "remote-bounded-square-core-no-public-ingress-claim"
	}
	return Health{OK: true, Service: "ynx-squared", Persistence: "atomic-json-mode-0600", StateIntegrity: "sha256-and-hash-chained-audit", NativeIdentity: "ynx1", RemoteDeployed: s.cfg.RemoteDeployed, PostCount: len(s.state.Posts), CommentCount: comments, ActiveReactions: reactions, ActiveFollows: follows, ReportCount: len(s.state.Reports), RateLimit: fmt.Sprintf("%d per %s per device/ip", s.cfg.RateLimitMax, s.cfg.RateLimitWindow), TruthfulStatus: status}
}

func (s *Service) appendAuditLocked(eventType, objectType, objectID, actor, payloadHash string, at time.Time) {
	previous := ""
	if len(s.state.Audit) > 0 {
		previous = s.state.Audit[len(s.state.Audit)-1].Hash
	}
	event := AuditEvent{Sequence: uint64(len(s.state.Audit) + 1), Type: eventType, ObjectType: objectType, ObjectID: objectID, Actor: actor, At: at, PayloadHash: payloadHash, PreviousHash: previous}
	event.Hash = auditHash(event)
	s.state.Audit = append(s.state.Audit, event)
}

func (s *Service) validateLocked() error {
	previous := ""
	for index, event := range s.state.Audit {
		if event.Sequence != uint64(index+1) || event.PreviousHash != previous || event.Hash != auditHash(event) {
			return errors.New("square audit chain verification failed")
		}
		previous = event.Hash
	}
	return nil
}

func auditHash(event AuditEvent) string {
	payload := strings.Join([]string{strconv.FormatUint(event.Sequence, 10), event.Type, event.ObjectType, event.ObjectID, event.Actor, event.At.UTC().Format(time.RFC3339Nano), event.PayloadHash, event.PreviousHash}, "\n")
	digest := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(digest[:])
}

func objectDigest(value any) string {
	data, _ := json.Marshal(value)
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func cloneState(state persistentState) persistentState {
	data, _ := json.Marshal(state)
	var cloned persistentState
	_ = json.Unmarshal(data, &cloned)
	return cloned
}

func (s *Service) saveOrRollbackLocked(before persistentState) error {
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return err
	}
	return nil
}

func absDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}
