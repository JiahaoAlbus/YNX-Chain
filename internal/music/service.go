package music

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

var safeText = regexp.MustCompile(`^[\pL\pN][\pL\pN .,'&()_\-]{0,119}$`)

type Service struct {
	cfg   Config
	mu    sync.RWMutex
	state persistentState
}

type Upload struct {
	Reader   io.Reader
	MIME     string
	Filename string
}
type TrackUpload struct {
	Title, ArtistName, Album, Description string
	Explicit                              bool
	Audio                                 Upload
	Artwork                               *Upload
	AudioProvenance, ArtworkProvenance    string
	RightsBasis                           string
	Territories                           []string
	Licensor, EvidenceRef                 string
}

func New(cfg Config) (*Service, error) {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.MaxUploadBytes < 1024 || cfg.MaxUploadBytes > 200<<20 {
		return nil, fmt.Errorf("%w: max upload must be 1 KiB to 200 MiB", ErrInvalid)
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 45 * time.Second}
	}
	if !filepath.IsAbs(cfg.StatePath) || !filepath.IsAbs(cfg.MediaDir) {
		return nil, fmt.Errorf("%w: absolute state and media paths required", ErrInvalid)
	}
	if err := os.MkdirAll(cfg.MediaDir, 0o700); err != nil {
		return nil, err
	}
	state, exists, err := loadState(cfg.StatePath)
	if err != nil {
		return nil, err
	}
	s := &Service{cfg: cfg, state: state}
	if !exists {
		if err := saveState(cfg.StatePath, &s.state); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func normalizeActor(actor string) (string, error) {
	v, err := nativewallet.NormalizeNativeAddress(actor)
	if err != nil {
		return "", ErrUnauthorized
	}
	return v, nil
}
func validText(value string, required bool) bool {
	value = strings.TrimSpace(value)
	return (!required && value == "") || safeText.MatchString(value)
}
func newID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}
func hashJSON(v any) string {
	data, _ := json.Marshal(v)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (s *Service) mutate(actor, event, objectID string, payload any, fn func(*persistentState) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	before := s.state
	if err := fn(&s.state); err != nil {
		return err
	}
	now := s.cfg.Now().UTC()
	prev := ""
	if n := len(s.state.Audit); n > 0 {
		prev = s.state.Audit[n-1].Hash
	}
	a := AuditEvent{Sequence: uint64(len(s.state.Audit) + 1), Type: event, ObjectID: objectID, Actor: actor, At: now, PayloadHash: hashJSON(payload), PreviousHash: prev}
	a.Hash = hashJSON(a)
	s.state.Audit = append(s.state.Audit, a)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return err
	}
	return nil
}

func (s *Service) Idempotency(namespace, key string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.state.Idempotency[namespace+":"+key]
	return v, ok
}
func (s *Service) ClaimIdempotency(actor, namespace, key, id string) error {
	return s.mutate(actor, namespace+"_idempotency_claimed", id, map[string]string{"key": key}, func(st *persistentState) error {
		k := namespace + ":" + key
		if old := st.Idempotency[k]; old != "" && old != id {
			return ErrConflict
		}
		st.Idempotency[k] = id
		return nil
	})
}
func (s *Service) CaseByID(actor, id string) (Case, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return Case{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.state.Cases[id]
	if !ok {
		return Case{}, ErrNotFound
	}
	if v.OpenedBy != actor {
		return Case{}, ErrUnauthorized
	}
	return v, nil
}
func (s *Service) SettlementByID(actor, id string) (SettlementIntent, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return SettlementIntent{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.state.Settlements[id]
	if !ok {
		return SettlementIntent{}, ErrNotFound
	}
	if v.Creator != actor {
		return SettlementIntent{}, ErrUnauthorized
	}
	return v, nil
}

func (s *Service) UpsertProfile(actor string, req Profile) (Profile, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return Profile{}, err
	}
	if !validText(req.DisplayName, true) || len(req.Bio) > 500 {
		return Profile{}, ErrInvalid
	}
	now := s.cfg.Now().UTC()
	current := Profile{Account: actor, CreatedAt: now, CreatorStatus: "listener"}
	s.mu.RLock()
	if p, ok := s.state.Profiles[actor]; ok {
		current = p
	}
	s.mu.RUnlock()
	current.DisplayName = strings.TrimSpace(req.DisplayName)
	current.Bio = strings.TrimSpace(req.Bio)
	current.ExplicitAllowed = req.ExplicitAllowed
	current.PrivateHistory = req.PrivateHistory
	current.UpdatedAt = now
	err = s.mutate(actor, "profile_updated", actor, current, func(st *persistentState) error {
		st.Profiles[actor] = current
		if _, ok := st.Listeners[actor]; !ok {
			st.Listeners[actor] = ListenerState{Account: actor, Downloads: map[string]string{}, Positions: map[string]int64{}, UpdatedAt: now}
		}
		return nil
	})
	return current, err
}

func (s *Service) Profile(actor string) (Profile, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return Profile{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.state.Profiles[actor]
	if !ok {
		return Profile{}, ErrNotFound
	}
	return p, nil
}
func (s *Service) OnboardCreator(actor string, displayName, bio string) (Profile, error) {
	p, err := s.Profile(actor)
	if err != nil {
		p, err = s.UpsertProfile(actor, Profile{DisplayName: displayName, Bio: bio})
		if err != nil {
			return Profile{}, err
		}
	}
	p.CreatorStatus = "active"
	p.UpdatedAt = s.cfg.Now().UTC()
	err = s.mutate(p.Account, "creator_onboarded", p.Account, p, func(st *persistentState) error { st.Profiles[p.Account] = p; return nil })
	return p, err
}

func (s *Service) UploadTrack(actor string, req TrackUpload) (Track, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return Track{}, err
	}
	p, err := s.Profile(actor)
	if err != nil || p.CreatorStatus != "active" {
		return Track{}, ErrUnauthorized
	}
	if !validText(req.Title, true) || !validText(req.ArtistName, true) || !validText(req.Album, false) || len(req.Description) > 1000 || req.Audio.Reader == nil {
		return Track{}, ErrInvalid
	}
	if req.RightsBasis != "owned" && req.RightsBasis != "licensed" {
		return Track{}, fmt.Errorf("%w: rights basis must be owned or licensed", ErrInvalid)
	}
	if req.RightsBasis == "licensed" && strings.TrimSpace(req.Licensor) == "" {
		return Track{}, fmt.Errorf("%w: licensor required", ErrInvalid)
	}
	if len(req.Territories) == 0 || strings.TrimSpace(req.EvidenceRef) == "" || strings.TrimSpace(req.AudioProvenance) == "" {
		return Track{}, fmt.Errorf("%w: territories, rights evidence, and audio provenance required", ErrInvalid)
	}
	id := newID("trk")
	audioPath := filepath.Join(s.cfg.MediaDir, id+".wav")
	audioHash, duration, err := writeWAV(audioPath, req.Audio.Reader, s.cfg.MaxUploadBytes)
	if err != nil {
		return Track{}, err
	}
	cleanup := []string{audioPath}
	track := Track{ID: id, Owner: actor, Title: strings.TrimSpace(req.Title), ArtistName: strings.TrimSpace(req.ArtistName), Album: strings.TrimSpace(req.Album), Description: strings.TrimSpace(req.Description), Explicit: req.Explicit, DurationMillis: duration, AudioFile: audioPath, AudioMIME: "audio/wav", AudioSHA256: audioHash, Provenance: map[string]string{"audio": strings.TrimSpace(req.AudioProvenance)}, ReleaseState: "draft", CreatedAt: s.cfg.Now().UTC(), UpdatedAt: s.cfg.Now().UTC()}
	if req.Artwork != nil && req.Artwork.Reader != nil {
		path := filepath.Join(s.cfg.MediaDir, id+".art")
		h, mime, e := writeArtwork(path, *req.Artwork, s.cfg.MaxUploadBytes/4)
		if e != nil {
			os.Remove(audioPath)
			return Track{}, e
		}
		cleanup = append(cleanup, path)
		track.ArtworkFile = path
		track.ArtworkMIME = mime
		track.ArtworkSHA256 = h
		track.Provenance["artwork"] = strings.TrimSpace(req.ArtworkProvenance)
		if track.Provenance["artwork"] == "" {
			for _, p := range cleanup {
				os.Remove(p)
			}
			return Track{}, fmt.Errorf("%w: artwork provenance required", ErrInvalid)
		}
	}
	rights := RightsDeclaration{Basis: req.RightsBasis, Territories: req.Territories, Licensor: strings.TrimSpace(req.Licensor), EvidenceRef: strings.TrimSpace(req.EvidenceRef), AcceptedAt: s.cfg.Now().UTC()}
	rights.DeclarationHash = hashJSON(rights)
	track.Rights = rights
	err = s.mutate(actor, "track_uploaded", id, track, func(st *persistentState) error { st.Tracks[id] = track; return nil })
	if err != nil {
		for _, p := range cleanup {
			os.Remove(p)
		}
		return Track{}, err
	}
	return track, nil
}

func writeWAV(path string, r io.Reader, limit int64) (string, int64, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil || int64(len(data)) > limit {
		return "", 0, fmt.Errorf("%w: audio exceeds upload policy", ErrInvalid)
	}
	if len(data) < 44 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" || binary.LittleEndian.Uint16(data[20:22]) != 1 {
		return "", 0, fmt.Errorf("%w: only PCM WAV is accepted", ErrInvalid)
	}
	rate := binary.LittleEndian.Uint32(data[28:32])
	dataSize := binary.LittleEndian.Uint32(data[40:44])
	if rate == 0 || dataSize == 0 || int(dataSize) > len(data)-44 {
		return "", 0, fmt.Errorf("%w: invalid WAV header", ErrInvalid)
	}
	duration := int64(dataSize) * 1000 / int64(rate)
	if duration < 250 || duration > 2*60*60*1000 {
		return "", 0, fmt.Errorf("%w: audio duration outside policy", ErrInvalid)
	}
	if err = os.WriteFile(path, data, 0o600); err != nil {
		return "", 0, err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), duration, nil
}
func writeArtwork(path string, u Upload, limit int64) (string, string, error) {
	data, err := io.ReadAll(io.LimitReader(u.Reader, limit+1))
	if err != nil || int64(len(data)) > limit {
		return "", "", ErrInvalid
	}
	mime := ""
	if len(data) > 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n" {
		mime = "image/png"
	} else if len(data) > 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		mime = "image/jpeg"
	} else {
		return "", "", fmt.Errorf("%w: artwork must be PNG or JPEG", ErrInvalid)
	}
	if err = os.WriteFile(path, data, 0o600); err != nil {
		return "", "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), mime, nil
}

func (s *Service) SetRelease(actor, id, state, reason string) (Track, error) {
	actor, _ = normalizeActor(actor)
	if state != "published" && state != "withdrawn" && state != "takedown_pending" {
		return Track{}, ErrInvalid
	}
	var out Track
	err := s.mutate(actor, "release_state_changed", id, map[string]string{"state": state, "reason": reason}, func(st *persistentState) error {
		t, ok := st.Tracks[id]
		if !ok {
			return ErrNotFound
		}
		if t.Owner != actor {
			return ErrUnauthorized
		}
		if state == "takedown_pending" && strings.TrimSpace(reason) == "" {
			return ErrInvalid
		}
		t.ReleaseState = state
		t.TakedownReason = strings.TrimSpace(reason)
		t.UpdatedAt = s.cfg.Now().UTC()
		st.Tracks[id] = t
		out = t
		return nil
	})
	return out, err
}
func (s *Service) Catalog(actor, query string) ([]Track, error) {
	actor, _ = normalizeActor(actor)
	s.mu.RLock()
	defer s.mu.RUnlock()
	p := s.state.Profiles[actor]
	q := strings.ToLower(strings.TrimSpace(query))
	out := []Track{}
	for _, t := range s.state.Tracks {
		if t.ReleaseState != "published" && t.Owner != actor {
			continue
		}
		if t.Explicit && !p.ExplicitAllowed {
			continue
		}
		hay := strings.ToLower(t.Title + " " + t.ArtistName + " " + t.Album)
		if q != "" && !strings.Contains(hay, q) {
			continue
		}
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}
func (s *Service) Track(actor, id string) (Track, error) {
	actor, _ = normalizeActor(actor)
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.state.Tracks[id]
	if !ok || (t.ReleaseState != "published" && t.Owner != actor) {
		return Track{}, ErrNotFound
	}
	if t.Explicit && !s.state.Profiles[actor].ExplicitAllowed {
		return Track{}, ErrUnauthorized
	}
	return t, nil
}
func (s *Service) Media(actor, id, kind string) (string, string, error) {
	t, err := s.Track(actor, id)
	if err != nil {
		return "", "", err
	}
	if kind == "artwork" {
		if t.ArtworkFile == "" {
			return "", "", ErrNotFound
		}
		return t.ArtworkFile, t.ArtworkMIME, nil
	}
	return t.AudioFile, t.AudioMIME, nil
}

func unique(list []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range list {
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
func (s *Service) UpdateLibrary(actor string, favorites, queue []string, downloads map[string]string) (ListenerState, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return ListenerState{}, err
	}
	var out ListenerState
	err = s.mutate(actor, "library_updated", actor, map[string]any{"favorites": favorites, "queue": queue, "downloads": downloads}, func(st *persistentState) error {
		l := st.Listeners[actor]
		l.Account = actor
		l.Favorites = unique(favorites)
		l.Queue = unique(queue)
		if downloads != nil {
			l.Downloads = downloads
		}
		if l.Downloads == nil {
			l.Downloads = map[string]string{}
		}
		if l.Positions == nil {
			l.Positions = map[string]int64{}
		}
		for _, id := range append(append([]string{}, l.Favorites...), l.Queue...) {
			if _, ok := st.Tracks[id]; !ok {
				return ErrNotFound
			}
		}
		for id, status := range l.Downloads {
			if _, ok := st.Tracks[id]; !ok || !(status == "requested" || status == "available" || status == "removed") {
				return ErrInvalid
			}
		}
		l.UpdatedAt = s.cfg.Now().UTC()
		st.Listeners[actor] = l
		out = l
		return nil
	})
	return out, err
}
func (s *Service) Listener(actor string) (ListenerState, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return ListenerState{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	l, ok := s.state.Listeners[actor]
	if !ok {
		return ListenerState{Account: actor, Downloads: map[string]string{}, Positions: map[string]int64{}}, nil
	}
	return l, nil
}
func (s *Service) SavePosition(actor, trackID, sessionRef string, position int64, completed bool) (ListenerState, *UsageRecord, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return ListenerState{}, nil, err
	}
	var out ListenerState
	var usage *UsageRecord
	err = s.mutate(actor, "playback_position_saved", trackID, map[string]any{"position": position, "completed": completed}, func(st *persistentState) error {
		t, ok := st.Tracks[trackID]
		if !ok || t.ReleaseState != "published" {
			return ErrNotFound
		}
		if position < 0 || position > t.DurationMillis+2000 {
			return ErrInvalid
		}
		l := st.Listeners[actor]
		l.Account = actor
		if l.Positions == nil {
			l.Positions = map[string]int64{}
		}
		l.Positions[trackID] = position
		l.History = append([]HistoryEntry{{TrackID: trackID, PositionMillis: position, Completed: completed, At: s.cfg.Now().UTC()}}, l.History...)
		if len(l.History) > 100 {
			l.History = l.History[:100]
		}
		l.UpdatedAt = s.cfg.Now().UTC()
		st.Listeners[actor] = l
		out = l
		if completed && position >= t.DurationMillis*80/100 {
			key := actor + ":" + sessionRef
			if sessionRef == "" {
				return ErrInvalid
			}
			if existing := st.Idempotency[key]; existing != "" {
				u := st.Usage[existing]
				usage = &u
				return nil
			}
			u := UsageRecord{ID: newID("use"), TrackID: trackID, Listener: actor, ListenedMillis: min(position, t.DurationMillis), Completed: true, SessionRef: sessionRef, RecordedAt: s.cfg.Now().UTC()}
			st.Usage[u.ID] = u
			st.Idempotency[key] = u.ID
			usage = &u
		}
		return nil
	})
	return out, usage, err
}

func (s *Service) CreatePlaylist(actor, name, desc string, trackIDs []string) (Playlist, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return Playlist{}, err
	}
	if !validText(name, true) || len(desc) > 500 {
		return Playlist{}, ErrInvalid
	}
	p := Playlist{ID: newID("pl"), Owner: actor, Name: strings.TrimSpace(name), Description: strings.TrimSpace(desc), TrackIDs: unique(trackIDs), CreatedAt: s.cfg.Now().UTC(), UpdatedAt: s.cfg.Now().UTC()}
	err = s.mutate(actor, "playlist_created", p.ID, p, func(st *persistentState) error {
		for _, id := range p.TrackIDs {
			if _, ok := st.Tracks[id]; !ok {
				return ErrNotFound
			}
		}
		st.Playlists[p.ID] = p
		return nil
	})
	return p, err
}
func (s *Service) Playlists(actor string) []Playlist {
	actor, _ = normalizeActor(actor)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Playlist{}
	for _, p := range s.state.Playlists {
		if p.Owner == actor {
			out = append(out, p)
		}
	}
	return out
}
func (s *Service) Usage(actor string) []UsageRecord {
	actor, _ = normalizeActor(actor)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []UsageRecord{}
	for _, u := range s.state.Usage {
		if t := s.state.Tracks[u.TrackID]; t.Owner == actor {
			u.Listener = "private"
			out = append(out, u)
		}
	}
	return out
}

func (s *Service) Allocate(actor, source string, amount int64, usageIDs []string) (RevenueAllocation, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return RevenueAllocation{}, err
	}
	if strings.TrimSpace(source) == "" || amount <= 0 || len(usageIDs) == 0 {
		return RevenueAllocation{}, ErrInvalid
	}
	a := RevenueAllocation{ID: newID("alloc"), Creator: actor, UsageRecordIDs: unique(usageIDs), SourceRecord: strings.TrimSpace(source), Currency: "YNXT-micros", AmountMicros: amount, CalculationNote: "User-supplied revenue pool allocated only against selected completed usage records; no public royalty rate is claimed.", CreatedAt: s.cfg.Now().UTC()}
	err = s.mutate(actor, "revenue_allocated", a.ID, a, func(st *persistentState) error {
		for _, id := range a.UsageRecordIDs {
			u, ok := st.Usage[id]
			if !ok || st.Tracks[u.TrackID].Owner != actor {
				return ErrUnauthorized
			}
		}
		st.Allocations[a.ID] = a
		return nil
	})
	return a, err
}
func (s *Service) Settlement(actor, allocationID, payTo string) (SettlementIntent, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return SettlementIntent{}, err
	}
	if _, err = normalizeActor(payTo); err != nil {
		return SettlementIntent{}, ErrInvalid
	}
	var out SettlementIntent
	err = s.mutate(actor, "settlement_intent_created", allocationID, payTo, func(st *persistentState) error {
		a, ok := st.Allocations[allocationID]
		if !ok {
			return ErrNotFound
		}
		if a.Creator != actor {
			return ErrUnauthorized
		}
		for _, v := range st.Settlements {
			if v.AllocationID == allocationID {
				return ErrConflict
			}
		}
		out = SettlementIntent{ID: newID("pay"), Creator: actor, AllocationID: allocationID, AmountMicros: a.AmountMicros, Currency: a.Currency, PayTo: payTo, Status: "requires_wallet_review", ReviewURI: "ynx-pay://settlement/review", CreatedAt: s.cfg.Now().UTC()}
		st.Settlements[out.ID] = out
		return nil
	})
	return out, err
}

func (s *Service) LinkCentralSettlement(actor, id, centralID, reviewURI string) (SettlementIntent, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return SettlementIntent{}, err
	}
	if strings.TrimSpace(centralID) == "" || !strings.HasPrefix(reviewURI, "ynxpay://settlement/review") {
		return SettlementIntent{}, ErrInvalid
	}
	var out SettlementIntent
	err = s.mutate(actor, "settlement_central_intent_linked", id, map[string]string{"centralIntentId": centralID, "reviewUri": reviewURI}, func(st *persistentState) error {
		v, ok := st.Settlements[id]
		if !ok {
			return ErrNotFound
		}
		if v.Creator != actor {
			return ErrUnauthorized
		}
		if v.CentralIntentID != "" && v.CentralIntentID != centralID {
			return ErrConflict
		}
		v.CentralIntentID = centralID
		v.ReviewURI = reviewURI
		st.Settlements[id] = v
		out = v
		return nil
	})
	return out, err
}
func (s *Service) OpenCase(actor, kind, trackID, reason, evidence string) (Case, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return Case{}, err
	}
	if kind != "report" && kind != "takedown" && kind != "dispute" || len(strings.TrimSpace(reason)) < 5 {
		return Case{}, ErrInvalid
	}
	if trackID != "" {
		s.mu.RLock()
		_, ok := s.state.Tracks[trackID]
		s.mu.RUnlock()
		if !ok {
			return Case{}, ErrNotFound
		}
	}
	c := Case{ID: newID("case"), Kind: kind, TrackID: trackID, OpenedBy: actor, Reason: strings.TrimSpace(reason), EvidenceRef: strings.TrimSpace(evidence), Status: "open", CreatedAt: s.cfg.Now().UTC()}
	err = s.mutate(actor, "case_opened", c.ID, c, func(st *persistentState) error { st.Cases[c.ID] = c; return nil })
	return c, err
}

func (s *Service) LinkCentralCase(actor, id, centralID string) (Case, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return Case{}, err
	}
	if strings.TrimSpace(centralID) == "" {
		return Case{}, ErrInvalid
	}
	var out Case
	err = s.mutate(actor, "case_central_linked", id, map[string]string{"centralCaseId": centralID}, func(st *persistentState) error {
		v, ok := st.Cases[id]
		if !ok {
			return ErrNotFound
		}
		if v.OpenedBy != actor {
			return ErrUnauthorized
		}
		if v.CentralCaseID != "" && v.CentralCaseID != centralID {
			return ErrConflict
		}
		v.CentralCaseID = centralID
		v.Status = "submitted_to_trust"
		st.Cases[id] = v
		out = v
		return nil
	})
	return out, err
}

func (s *Service) CreateAIProposal(actor, kind, intent, provider, model string, trackIDs []string, permission bool) (AIProposal, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return AIProposal{}, err
	}
	allowed := kind == "playlist" || kind == "metadata" || kind == "discovery" || kind == "creator_description" || kind == "royalty_explanation"
	if !allowed || !permission || strings.TrimSpace(intent) == "" || provider == "" || model == "" {
		return AIProposal{}, ErrInvalid
	}
	s.mu.RLock()
	for _, id := range trackIDs {
		t, ok := s.state.Tracks[id]
		if !ok || (t.Owner != actor && !contains(s.state.Listeners[actor].Favorites, id)) {
			s.mu.RUnlock()
			return AIProposal{}, ErrUnauthorized
		}
	}
	s.mu.RUnlock()
	p := AIProposal{ID: newID("ai"), Owner: actor, Kind: kind, Intent: strings.TrimSpace(intent), ContextTrackIDs: unique(trackIDs), Provider: provider, Model: model, EstimatedUnits: int64(200 + len(trackIDs)*80), Permission: true, Status: "awaiting_gateway", CreatedAt: s.cfg.Now().UTC(), UpdatedAt: s.cfg.Now().UTC()}
	err = s.mutate(actor, "ai_proposal_created", p.ID, p, func(st *persistentState) error { st.AIProposals[p.ID] = p; return nil })
	return p, err
}
func (s *Service) AIProposal(actor, id string) (AIProposal, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return AIProposal{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.state.AIProposals[id]
	if !ok {
		return AIProposal{}, ErrNotFound
	}
	if p.Owner != actor {
		return AIProposal{}, ErrUnauthorized
	}
	return p, nil
}
func (s *Service) SetAIStatus(actor, id, status, result string) (AIProposal, error) {
	actor, err := normalizeActor(actor)
	if err != nil {
		return AIProposal{}, err
	}
	allowed := status == "streaming" || status == "completed" || status == "cancelled" || status == "provider_failed" || status == "rejected" || status == "applied"
	if !allowed || len(result) > 12000 {
		return AIProposal{}, ErrInvalid
	}
	var out AIProposal
	err = s.mutate(actor, "ai_status_changed", id, map[string]string{"status": status}, func(st *persistentState) error {
		p, ok := st.AIProposals[id]
		if !ok {
			return ErrNotFound
		}
		if p.Owner != actor {
			return ErrUnauthorized
		}
		if status == "streaming" && p.Status != "awaiting_gateway" && p.Status != "provider_failed" {
			return ErrConflict
		}
		if (status == "applied" || status == "rejected") && p.Status != "completed" {
			return ErrConflict
		}
		p.Status = status
		p.Result = strings.TrimSpace(result)
		p.UpdatedAt = s.cfg.Now().UTC()
		st.AIProposals[id] = p
		out = p
		return nil
	})
	return out, err
}
func (s *Service) ApplyAIPlaylist(actor, id, name string) (AIProposal, Playlist, error) {
	p, err := s.AIProposal(actor, id)
	if err != nil {
		return AIProposal{}, Playlist{}, err
	}
	if p.Kind != "playlist" || p.Status != "completed" {
		return AIProposal{}, Playlist{}, ErrConflict
	}
	if !validText(name, true) {
		name = "AI library proposal"
	}
	playlist, err := s.CreatePlaylist(actor, name, "Applied after review from YNX AI Gateway proposal "+id, p.ContextTrackIDs)
	if err != nil {
		return AIProposal{}, Playlist{}, err
	}
	updated, err := s.SetAIStatus(actor, id, "applied", p.Result)
	if err != nil {
		return AIProposal{}, Playlist{}, err
	}
	updated.AppliedObject = playlist.ID
	_ = s.mutate(actor, "ai_result_applied", id, playlist.ID, func(st *persistentState) error {
		v := st.AIProposals[id]
		v.AppliedObject = playlist.ID
		st.AIProposals[id] = v
		updated = v
		return nil
	})
	return updated, playlist, nil
}
func (s *Service) ApplyAIResult(actor, id, name string) (AIProposal, any, error) {
	p, err := s.AIProposal(actor, id)
	if err != nil {
		return AIProposal{}, nil, err
	}
	if p.Kind == "playlist" {
		updated, playlist, e := s.ApplyAIPlaylist(actor, id, name)
		return updated, playlist, e
	}
	if p.Status != "completed" {
		return AIProposal{}, nil, ErrConflict
	}
	object := "saved_review"
	if p.Kind == "metadata" || p.Kind == "creator_description" {
		if len(p.ContextTrackIDs) == 0 {
			return AIProposal{}, nil, ErrInvalid
		}
		trackID := p.ContextTrackIDs[0]
		description := strings.TrimSpace(p.Result)
		if len(description) > 1000 {
			description = description[:1000]
		}
		err = s.mutate(actor, "ai_metadata_applied", id, trackID, func(st *persistentState) error {
			t, ok := st.Tracks[trackID]
			if !ok {
				return ErrNotFound
			}
			if t.Owner != actor {
				return ErrUnauthorized
			}
			t.Description = description
			t.UpdatedAt = s.cfg.Now().UTC()
			st.Tracks[trackID] = t
			return nil
		})
		if err != nil {
			return AIProposal{}, nil, err
		}
		object = trackID
	}
	updated, err := s.SetAIStatus(actor, id, "applied", p.Result)
	if err != nil {
		return AIProposal{}, nil, err
	}
	_ = s.mutate(actor, "ai_result_applied", id, object, func(st *persistentState) error {
		v := st.AIProposals[id]
		v.AppliedObject = object
		st.AIProposals[id] = v
		updated = v
		return nil
	})
	return updated, map[string]string{"savedObject": object}, nil
}
func contains(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}
func min(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func (s *Service) Snapshot(actor string) map[string]any {
	p, _ := s.Profile(actor)
	l, _ := s.Listener(actor)
	catalog, _ := s.Catalog(actor, "")
	s.mu.RLock()
	allocations := []RevenueAllocation{}
	settlements := []SettlementIntent{}
	cases := []Case{}
	ai := []AIProposal{}
	for _, v := range s.state.Allocations {
		if v.Creator == actor {
			allocations = append(allocations, v)
		}
	}
	for _, v := range s.state.Settlements {
		if v.Creator == actor {
			settlements = append(settlements, v)
		}
	}
	for _, v := range s.state.Cases {
		if v.OpenedBy == actor {
			cases = append(cases, v)
		}
	}
	for _, v := range s.state.AIProposals {
		if v.Owner == actor {
			ai = append(ai, v)
		}
	}
	s.mu.RUnlock()
	return map[string]any{"profile": p, "listener": l, "catalog": catalog, "playlists": s.Playlists(actor), "usage": s.Usage(actor), "allocations": allocations, "settlements": settlements, "cases": cases, "aiProposals": ai, "truth": map[string]any{"licensedPublicCatalog": false, "productionStreaming": false, "settlementFinality": "Pay intent requires Wallet review and authoritative Pay receipt"}}
}
func (s *Service) VerifyIntegrity() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	expected, err := stateIntegrity(s.state)
	if err != nil {
		return err
	}
	if expected != s.state.IntegrityHash {
		return fmt.Errorf("state integrity mismatch")
	}
	for _, t := range s.state.Tracks {
		if _, err := os.Stat(t.AudioFile); err != nil {
			return fmt.Errorf("track %s media missing: %w", t.ID, err)
		}
	}
	return nil
}
