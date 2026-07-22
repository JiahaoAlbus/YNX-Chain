package oracle

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type storeState struct {
	Schema           string            `json:"schema"`
	StoreVersion     int               `json:"storeVersion,omitempty"`
	Generation       uint64            `json:"generation"`
	NonceDomain      string            `json:"nonceDomain"`
	LatestSequences  map[string]uint64 `json:"latestSequences"`
	Observations     []Observation     `json:"observations"`
	Corrections      []Correction      `json:"corrections"`
	NormalizedEvents []NormalizedEvent `json:"normalizedEvents,omitempty"`
	AggregateEvents  []AggregateEvent  `json:"aggregateEvents,omitempty"`
	ControlEvents    []ControlEvent    `json:"controlEvents,omitempty"`
	EventChainHash   string            `json:"eventChainHash"`
}

type storeEnvelope struct {
	State     storeState `json:"state"`
	Integrity string     `json:"integrity"`
}

type Store struct {
	mu    sync.RWMutex
	path  string
	key   []byte
	state storeState
}

func OpenStore(path string, key []byte, nonceDomain string) (*Store, error) {
	if path == "" || len(key) < 32 || !reporterPattern.MatchString(nonceDomain) {
		return nil, errors.New("state path, 32-byte integrity key, and nonce domain are required")
	}
	store := &Store{path: path, key: append([]byte(nil), key...)}
	store.state = storeState{Schema: SchemaVersion, StoreVersion: StoreVersion, NonceDomain: nonceDomain, LatestSequences: map[string]uint64{}, Observations: []Observation{}, Corrections: []Correction{}, NormalizedEvents: []NormalizedEvent{}, AggregateEvents: []AggregateEvent{}, ControlEvents: []ControlEvent{}}
	store.state.EventChainHash = eventChain(store.state)
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, err
	}
	var envelope storeEnvelope
	if err := decodeStrict(data, &envelope); err != nil {
		return nil, fmt.Errorf("decode oracle state: %w", err)
	}
	if envelope.State.Schema != SchemaVersion || envelope.State.NonceDomain != nonceDomain || envelope.State.LatestSequences == nil {
		return nil, errors.New("oracle state schema or nonce domain mismatch")
	}
	expected, err := store.integrity(envelope.State)
	if err != nil || !hmac.Equal([]byte(expected), []byte(envelope.Integrity)) {
		return nil, errors.New("oracle state integrity verification failed")
	}
	legacy := envelope.State.StoreVersion == 0
	if legacy && legacyEventChain(envelope.State.Observations, envelope.State.Corrections) != envelope.State.EventChainHash {
		return nil, errors.New("oracle legacy event chain verification failed")
	}
	if !legacy && envelope.State.StoreVersion != 2 && envelope.State.StoreVersion != StoreVersion {
		return nil, errors.New("unsupported oracle store version")
	}
	if !legacy && eventChain(envelope.State) != envelope.State.EventChainHash {
		return nil, errors.New("oracle event chain verification failed")
	}
	store.state = envelope.State
	if legacy {
		if err := store.migrateV1ToV3(data); err != nil {
			return nil, err
		}
	} else if store.state.StoreVersion == 2 {
		if err := store.migrateV2ToV3(data); err != nil {
			return nil, err
		}
	}
	return store, nil
}

func (store *Store) Ingest(observation Observation, provider Provider) (bool, error) {
	if err := provider.Validate(); err != nil {
		return false, err
	}
	if err := observation.Verify(provider, store.state.NonceDomain); err != nil {
		return false, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	for _, existing := range store.state.Observations {
		if existing.ID == observation.ID {
			if existing.Hash == observation.Hash {
				return false, nil
			}
			return false, errors.New("observation ID conflicts with immutable event")
		}
	}
	if observation.Sequence <= store.state.LatestSequences[observation.ReporterID] {
		return false, errors.New("reporter sequence replay rejected")
	}
	if observation.Type == DEXPoolState {
		for index := len(store.state.Observations) - 1; index >= 0; index-- {
			previous := store.state.Observations[index]
			if previous.ProviderID == observation.ProviderID && previous.Market == observation.Market && previous.Type == DEXPoolState {
				if previous.PoolState == nil || observation.PoolState == nil || observation.PoolState.BlockNumber <= previous.PoolState.BlockNumber {
					return false, errors.New("DEX pool block regression or replacement requires audited correction")
				}
				break
			}
		}
	}
	next := cloneState(store.state)
	next.Observations = append(next.Observations, observation)
	next.NormalizedEvents = append(next.NormalizedEvents, normalizeObservation(observation, "", observation.ObservedAt))
	next.LatestSequences[observation.ReporterID] = observation.Sequence
	next.Generation++
	next.EventChainHash = eventChain(next)
	if err := store.persist(next); err != nil {
		return false, err
	}
	store.state = next
	return true, nil
}

func (store *Store) Correct(correction Correction, provider Provider) error {
	if correction.Schema != SchemaVersion || correction.ID == "" || correction.OriginalID == "" ||
		correction.Reason == "" || correction.EffectiveAt.IsZero() || correction.Actor == "" ||
		correction.AuditID == "" || correction.CreatedAt.IsZero() {
		return errInvalid
	}
	if err := correction.Corrected.Verify(provider, store.state.NonceDomain); err != nil {
		return err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	var original *Observation
	for index := range store.state.Observations {
		if store.state.Observations[index].ID == correction.OriginalID {
			original = &store.state.Observations[index]
			break
		}
	}
	if original == nil {
		return errors.New("correction original observation not found")
	}
	if correction.Corrected.Market != original.Market || correction.Corrected.Type != original.Type || correction.Corrected.ProviderID != original.ProviderID {
		return errors.New("correction cannot change market, type, or provider")
	}
	for _, existing := range store.state.Corrections {
		if existing.ID == correction.ID {
			return errors.New("correction ID replay rejected")
		}
	}
	if correction.Corrected.Sequence <= store.state.LatestSequences[correction.Corrected.ReporterID] {
		return errors.New("correction reporter sequence replay rejected")
	}
	next := cloneState(store.state)
	next.Corrections = append(next.Corrections, correction)
	next.NormalizedEvents = append(next.NormalizedEvents, normalizeObservation(correction.Corrected, correction.ID, correction.EffectiveAt))
	next.LatestSequences[correction.Corrected.ReporterID] = correction.Corrected.Sequence
	next.Generation++
	next.EventChainHash = eventChain(next)
	if err := store.persist(next); err != nil {
		return err
	}
	store.state = next
	return nil
}

func (store *Store) AppendAggregate(price Price) (bool, error) {
	if price.Schema != SchemaVersion || price.Market == "" || !price.Type.Valid() || price.Version == "" || price.ProducedAt.IsZero() {
		return false, errInvalid
	}
	lineageBytes, lineageErr := hex.DecodeString(price.LineageHash)
	if lineageErr != nil || len(lineageBytes) != sha256.Size || len(price.ObservationIDs) == 0 || len(price.ObservationIDs) != len(price.ObservationHash) {
		return false, errInvalid
	}
	event := newAggregateEvent(price)
	store.mu.Lock()
	defer store.mu.Unlock()
	for _, existing := range store.state.AggregateEvents {
		if existing.ID == event.ID {
			if existing.Hash == event.Hash {
				return false, nil
			}
			return false, errors.New("aggregate lineage conflicts with persisted event")
		}
	}
	next := cloneState(store.state)
	next.AggregateEvents = append(next.AggregateEvents, event)
	next.Generation++
	next.EventChainHash = eventChain(next)
	if err := store.persist(next); err != nil {
		return false, err
	}
	store.state = next
	return true, nil
}

func (store *Store) LatestGood(market string, kind DataType) (Price, bool) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	for index := len(store.state.AggregateEvents) - 1; index >= 0; index-- {
		price := store.state.AggregateEvents[index].Price
		if price.Market == market && price.Type == kind && price.Quality.Status == "good" && !price.Quality.Stale && !price.Quality.CircuitBreaker {
			return price, true
		}
	}
	return Price{}, false
}

func (store *Store) ApplyControl(event ControlEvent) error {
	if event.Schema != SchemaVersion || event.ID == "" || (event.Action != "pause" && event.Action != "resume") ||
		strings.TrimSpace(event.Reason) == "" || strings.TrimSpace(event.Actor) == "" || event.AuditID == "" ||
		event.EffectiveAt.IsZero() || event.CreatedAt.IsZero() || event.EffectiveAt.Before(event.CreatedAt) || event.Hash != event.calculatedHash() {
		return errInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	for _, existing := range store.state.ControlEvents {
		if existing.ID == event.ID {
			return errors.New("control event replay rejected")
		}
	}
	next := cloneState(store.state)
	next.ControlEvents = append(next.ControlEvents, event)
	next.Generation++
	next.EventChainHash = eventChain(next)
	if err := store.persist(next); err != nil {
		return err
	}
	store.state = next
	return nil
}

func (store *Store) ControlState(asOf time.Time) (paused bool, reason, auditID string) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	for _, event := range store.state.ControlEvents {
		if event.EffectiveAt.After(asOf) {
			continue
		}
		paused = event.Action == "pause"
		reason, auditID = event.Reason, event.AuditID
	}
	return paused, reason, auditID
}

func (store *Store) Replay(market string, kind DataType, asOf time.Time) []Observation {
	store.mu.RLock()
	defer store.mu.RUnlock()
	byID := map[string]Observation{}
	for _, observation := range store.state.Observations {
		if observation.Market == market && observation.Type == kind && !observation.ObservedAt.After(asOf) {
			byID[observation.ID] = observation
		}
	}
	for _, correction := range store.state.Corrections {
		if !correction.EffectiveAt.After(asOf) {
			if _, exists := byID[correction.OriginalID]; exists {
				byID[correction.OriginalID] = correction.Corrected
			}
		}
	}
	result := make([]Observation, 0, len(byID))
	for _, observation := range byID {
		result = append(result, observation)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ObservedAt.Equal(result[j].ObservedAt) {
			return result[i].ID < result[j].ID
		}
		return result[i].ObservedAt.Before(result[j].ObservedAt)
	})
	return result
}

func (store *Store) Normalized(market string, kind DataType, asOf time.Time, limit int) []NormalizedEvent {
	store.mu.RLock()
	defer store.mu.RUnlock()
	result := make([]NormalizedEvent, 0)
	for _, event := range store.state.NormalizedEvents {
		if event.Market == market && event.Type == kind && !event.EffectiveAt.After(asOf) {
			result = append(result, event)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].EffectiveAt.Equal(result[j].EffectiveAt) {
			return result[i].ID < result[j].ID
		}
		return result[i].EffectiveAt.Before(result[j].EffectiveAt)
	})
	if len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result
}

func (store *Store) Snapshot() storeState {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return cloneState(store.state)
}

func (store *Store) Export() ([]byte, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return json.MarshalIndent(store.state, "", "  ")
}

func (store *Store) Backup(destination string) error {
	store.mu.RLock()
	defer store.mu.RUnlock()
	if destination == "" || filepath.Clean(destination) == filepath.Clean(store.path) {
		return errors.New("distinct backup destination required")
	}
	data, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		envelope, marshalErr := store.envelope(store.state)
		if marshalErr != nil {
			return marshalErr
		}
		data = envelope
	} else if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o750); err != nil {
		return err
	}
	temporary := destination + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, destination)
}

func (store *Store) persist(state storeState) error {
	data, err := store.envelope(state)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(store.path), 0o750); err != nil {
		return err
	}
	temporary := store.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, store.path); err != nil {
		return err
	}
	return nil
}

func (store *Store) envelope(state storeState) ([]byte, error) {
	integrity, err := store.integrity(state)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(storeEnvelope{State: state, Integrity: integrity}, "", "  ")
}

func (store *Store) integrity(state storeState) (string, error) {
	data, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	digest := hmac.New(sha256.New, store.key)
	_, _ = digest.Write(data)
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func cloneState(state storeState) storeState {
	copyState := state
	copyState.LatestSequences = make(map[string]uint64, len(state.LatestSequences))
	for key, value := range state.LatestSequences {
		copyState.LatestSequences[key] = value
	}
	copyState.Observations = append([]Observation(nil), state.Observations...)
	copyState.Corrections = append([]Correction(nil), state.Corrections...)
	copyState.NormalizedEvents = append([]NormalizedEvent(nil), state.NormalizedEvents...)
	copyState.AggregateEvents = append([]AggregateEvent(nil), state.AggregateEvents...)
	copyState.ControlEvents = append([]ControlEvent(nil), state.ControlEvents...)
	return copyState
}

func legacyEventChain(observations []Observation, corrections []Correction) string {
	current := make([]byte, sha256.Size)
	for _, observation := range observations {
		digest := sha256.Sum256(append(append([]byte(nil), current...), []byte("observation:"+observation.Hash)...))
		current = digest[:]
	}
	for _, correction := range corrections {
		data, _ := json.Marshal(correction)
		digest := sha256.Sum256(append(append([]byte(nil), current...), data...))
		current = digest[:]
	}
	return hex.EncodeToString(current)
}

func eventChain(state storeState) string {
	current := make([]byte, sha256.Size)
	normalized := state.NormalizedEvents
	if normalized == nil {
		normalized = []NormalizedEvent{}
	}
	aggregates := state.AggregateEvents
	if aggregates == nil {
		aggregates = []AggregateEvent{}
	}
	controls := state.ControlEvents
	if controls == nil {
		controls = []ControlEvent{}
	}
	sections := []any{state.Observations, normalized, state.Corrections, controls, aggregates}
	for _, section := range sections {
		data, _ := json.Marshal(section)
		digest := sha256.Sum256(append(append([]byte(nil), current...), data...))
		current = digest[:]
	}
	return hex.EncodeToString(current)
}

func (store *Store) migrateV1ToV3(original []byte) error {
	if err := store.writeMigrationBackup(original, ".v1.backup"); err != nil {
		return err
	}
	next := cloneState(store.state)
	next.StoreVersion = StoreVersion
	next.NormalizedEvents = make([]NormalizedEvent, 0, len(next.Observations)+len(next.Corrections))
	for _, observation := range next.Observations {
		next.NormalizedEvents = append(next.NormalizedEvents, normalizeObservation(observation, "", observation.ObservedAt))
	}
	for _, correction := range next.Corrections {
		next.NormalizedEvents = append(next.NormalizedEvents, normalizeObservation(correction.Corrected, correction.ID, correction.EffectiveAt))
	}
	next.AggregateEvents = []AggregateEvent{}
	next.ControlEvents = []ControlEvent{}
	next.Generation++
	next.EventChainHash = eventChain(next)
	if err := store.persist(next); err != nil {
		return fmt.Errorf("persist v2 migration: %w", err)
	}
	store.state = next
	return nil
}

func (store *Store) migrateV2ToV3(original []byte) error {
	if err := store.writeMigrationBackup(original, ".v2.backup"); err != nil {
		return err
	}
	next := cloneState(store.state)
	next.StoreVersion = StoreVersion
	for index := range next.NormalizedEvents {
		event := next.NormalizedEvents[index]
		effectiveAt := event.ObservedAt
		if event.CorrectionID != "" {
			for _, correction := range next.Corrections {
				if correction.ID == event.CorrectionID {
					effectiveAt = correction.EffectiveAt
					break
				}
			}
		}
		event.EffectiveAt = effectiveAt.UTC()
		dataEvent := event
		dataEvent.Hash = ""
		data, _ := json.Marshal(dataEvent)
		digest := sha256.Sum256(data)
		event.Hash = hex.EncodeToString(digest[:])
		next.NormalizedEvents[index] = event
	}
	next.Generation++
	next.EventChainHash = eventChain(next)
	if err := store.persist(next); err != nil {
		return fmt.Errorf("persist v3 migration: %w", err)
	}
	store.state = next
	return nil
}

func (store *Store) writeMigrationBackup(original []byte, suffix string) error {
	file, err := os.OpenFile(store.path+suffix, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create pre-migration backup: %w", err)
	}
	if _, err := file.Write(original); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func decodeStrict(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("multiple JSON values")
	}
	return nil
}
