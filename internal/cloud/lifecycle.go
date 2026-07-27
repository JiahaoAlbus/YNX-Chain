package cloud

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

var ErrArchiveRestoreRequired = errors.New("object content unavailable while archive restore is required")

func validStorageClass(class StorageClass) bool {
	return class == StorageClassHot || class == StorageClassCold || class == StorageClassArchive
}

func normalizedVersionStorageClass(version Version) StorageClass {
	if validStorageClass(version.StorageClass) {
		return version.StorageClass
	}
	return StorageClassHot
}

func normalizedVersionStorageClassVersion(version Version) int {
	if version.StorageClassVersion > 0 {
		return version.StorageClassVersion
	}
	return 1
}

func normalizedVersionReadMode(version Version) string {
	if version.StorageReadMode == StorageReadImmediate || version.StorageReadMode == StorageReadRestoreRequired {
		return version.StorageReadMode
	}
	return StorageReadImmediate
}

func normalizedStorageClass(object Object) StorageClass {
	if validStorageClass(object.StorageClass) {
		return object.StorageClass
	}
	return StorageClassHot
}

func currentVersionIndex(state persistentState, object Object) (int, Version, error) {
	for index, version := range state.Versions[object.ID] {
		if version.Number == object.Version {
			return index, version, nil
		}
	}
	return -1, Version{}, ErrNotFound
}

func metadataOnlyWithoutVersion(state persistentState, object Object) bool {
	return object.Kind != KindFolder && object.Version == 0 && object.Hash == "" && object.Size == 0 && len(state.Versions[object.ID]) == 0
}

func physicalReferenceCount(state persistentState, ref, hash string) int {
	count := 0
	for _, versions := range state.Versions {
		for _, version := range versions {
			if version.BlobPath == ref && version.Hash == hash {
				count++
			}
		}
	}
	return count
}

func versionIndex(state persistentState, objectID string, number int) (int, Version, error) {
	for index, version := range state.Versions[objectID] {
		if version.Number == number {
			return index, version, nil
		}
	}
	return -1, Version{}, ErrNotFound
}

func syncObjectStorageSummary(object *Object, version Version) {
	object.StorageClass = normalizedVersionStorageClass(version)
	object.StorageClassVersion = normalizedVersionStorageClassVersion(version)
	object.StorageReadMode = normalizedVersionReadMode(version)
	object.StorageClassUpdatedAt = version.StorageClassUpdatedAt
}

func restorePersistentState(snapshot []byte, state *persistentState) {
	var restored persistentState
	if json.Unmarshal(snapshot, &restored) == nil {
		*state = restored
	}
}

func (s *Service) storageTransitionUnresolvedLocked(objectID string) bool {
	for _, transition := range s.state.StorageTransitions {
		if transition.ObjectID == objectID && (transition.Status == "pending" || transition.Status == "failed") {
			return true
		}
	}
	return false
}

func (s *Service) endLifecycleExecution(transitionID string) {
	s.mu.Lock()
	delete(s.lifecycleActive, transitionID)
	s.mu.Unlock()
}

func (s *Service) TransitionStorageClass(ctx context.Context, actor, product, objectID string, target StorageClass) (StorageTransition, error) {
	if !validAccount(actor) || (product != "cloud" && product != "docs") || !validStorageClass(target) {
		return StorageTransition{}, ErrInvalid
	}
	s.mu.Lock()
	object, err := s.require(actor, objectID, 3)
	if err != nil {
		s.mu.Unlock()
		return StorageTransition{}, err
	}
	if object.Owner != actor || object.Product != product || object.Kind == KindFolder || object.TrashedAt != nil || object.ScanStatus != "accepted" {
		s.mu.Unlock()
		return StorageTransition{}, ErrDenied
	}
	_, version, err := currentVersionIndex(s.state, object)
	if err != nil {
		s.mu.Unlock()
		return StorageTransition{}, err
	}
	from := normalizedVersionStorageClass(version)
	if from == target {
		s.mu.Unlock()
		return StorageTransition{}, ErrInvalid
	}
	for _, existing := range s.state.StorageTransitions {
		if existing.ObjectID == objectID && existing.Version == version.Number && existing.Status == "pending" {
			s.mu.Unlock()
			return StorageTransition{}, errors.New("storage lifecycle transition already pending")
		}
	}
	now := s.cfg.Now()
	transition := StorageTransition{
		ID:           newID("storage-transition"),
		Product:      object.Product,
		Owner:        actor,
		ObjectID:     objectID,
		Version:      version.Number,
		Ref:          version.BlobPath,
		Hash:         version.Hash,
		From:         from,
		To:           target,
		CopyRequired: physicalReferenceCount(s.state, version.BlobPath, version.Hash) > 1,
		Status:       "pending",
		Attempts:     1,
		RequestedAt:  now,
		UpdatedAt:    now,
	}
	before, _ := json.Marshal(s.state)
	s.state.StorageTransitions[transition.ID] = transition
	s.lifecycleActive[transition.ID] = true
	if err := s.persist("storage.transition.requested", actor, objectID, map[string]any{"product": object.Product, "transitionId": transition.ID, "version": version.Number, "from": from, "to": target, "hash": version.Hash}); err != nil {
		restorePersistentState(before, &s.state)
		delete(s.lifecycleActive, transition.ID)
		s.mu.Unlock()
		return StorageTransition{}, err
	}
	s.mu.Unlock()
	return s.executeStorageTransition(ctx, transition)
}

func (s *Service) RetryStorageTransition(ctx context.Context, actor, product, transitionID string) (StorageTransition, error) {
	if !validAccount(actor) || (product != "cloud" && product != "docs") {
		return StorageTransition{}, ErrInvalid
	}
	s.mu.Lock()
	transition, ok := s.state.StorageTransitions[transitionID]
	if !ok {
		s.mu.Unlock()
		return StorageTransition{}, ErrNotFound
	}
	if transition.Owner != actor || transition.Product != product || (transition.Status != "failed" && transition.Status != "pending") {
		s.mu.Unlock()
		return StorageTransition{}, ErrDenied
	}
	if s.lifecycleActive[transitionID] {
		s.mu.Unlock()
		return StorageTransition{}, errors.New("storage lifecycle transition is already executing")
	}
	object, ok := s.state.Objects[transition.ObjectID]
	if !ok || object.Owner != actor || object.Product != transition.Product {
		s.mu.Unlock()
		return StorageTransition{}, errors.New("storage lifecycle retry no longer matches object state")
	}
	_, version, err := versionIndex(s.state, transition.ObjectID, transition.Version)
	if err != nil || version.Hash != transition.Hash || version.BlobPath != transition.Ref || normalizedVersionStorageClass(version) != transition.From {
		s.mu.Unlock()
		return StorageTransition{}, errors.New("storage lifecycle retry no longer matches version state")
	}
	before, _ := json.Marshal(s.state)
	transition.Status = "pending"
	transition.LastError = ""
	transition.Attempts++
	transition.UpdatedAt = s.cfg.Now()
	s.state.StorageTransitions[transition.ID] = transition
	s.lifecycleActive[transition.ID] = true
	if err := s.persist("storage.transition.retry", actor, transition.ObjectID, map[string]any{"product": transition.Product, "transitionId": transition.ID, "version": transition.Version, "attempt": transition.Attempts}); err != nil {
		restorePersistentState(before, &s.state)
		delete(s.lifecycleActive, transition.ID)
		s.mu.Unlock()
		return StorageTransition{}, err
	}
	s.mu.Unlock()
	return s.executeStorageTransition(ctx, transition)
}

func (s *Service) executeStorageTransition(ctx context.Context, transition StorageTransition) (StorageTransition, error) {
	defer s.endLifecycleExecution(transition.ID)
	provider, ok := s.cfg.ObjectStore.(LifecycleObjectStore)
	if !ok {
		return s.failStorageTransition(transition.ID, errors.New("storage lifecycle provider unavailable"))
	}
	result, err := provider.Transition(ctx, StorageTransitionRequest{
		TransitionID: transition.ID,
		Scope:        objectStorageScope(transition.Owner, transition.Product),
		Ref:          transition.Ref,
		Hash:         transition.Hash,
		From:         transition.From,
		To:           transition.To,
		CopyRequired: transition.CopyRequired,
	})
	if err != nil {
		return s.failStorageTransition(transition.ID, err)
	}
	if result.TransitionID != transition.ID || result.Ref == "" || result.Hash != transition.Hash || result.From != transition.From || result.To != transition.To || result.Status != "completed" || result.ProviderEvidence == "" || result.AsOf.IsZero() {
		return s.failStorageTransition(transition.ID, errors.New("storage lifecycle provider result binding mismatch"))
	}
	if transition.CopyRequired && result.Ref == transition.Ref {
		return s.failStorageTransition(transition.ID, errors.New("storage lifecycle provider failed to isolate a shared blob"))
	}
	if result.ReadMode != StorageReadImmediate && result.ReadMode != StorageReadRestoreRequired {
		return s.failStorageTransition(transition.ID, errors.New("storage lifecycle provider read mode invalid"))
	}
	if result.To != StorageClassArchive && result.ReadMode != StorageReadImmediate {
		return s.failStorageTransition(transition.ID, errors.New("non-archive lifecycle result cannot require restore"))
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.state.StorageTransitions[transition.ID]
	object, objectOK := s.state.Objects[transition.ObjectID]
	versionPosition, version, versionErr := versionIndex(s.state, transition.ObjectID, transition.Version)
	if !ok || !objectOK || versionErr != nil || current.Status != "pending" || version.Hash != transition.Hash || version.BlobPath != transition.Ref || normalizedVersionStorageClass(version) != transition.From {
		return StorageTransition{}, errors.New("storage lifecycle completion no longer matches authoritative version state")
	}
	before, _ := json.Marshal(s.state)
	now := s.cfg.Now()
	current.Status = "completed"
	current.ResultRef = result.Ref
	current.ReadMode = result.ReadMode
	current.ProviderEvidence = result.ProviderEvidence
	current.LastError = ""
	current.UpdatedAt = now
	version.BlobPath = result.Ref
	version.StorageClass = transition.To
	version.StorageClassVersion = normalizedVersionStorageClassVersion(version) + 1
	version.StorageReadMode = result.ReadMode
	version.StorageClassUpdatedAt = &result.AsOf
	s.state.Versions[object.ID][versionPosition] = version
	if object.Version == version.Number {
		syncObjectStorageSummary(&object, version)
		object.UpdatedAt = now
		s.state.Objects[object.ID] = object
	}
	s.state.StorageTransitions[current.ID] = current
	if err := s.persist("storage.transition.completed", transition.Owner, transition.ObjectID, map[string]any{"product": transition.Product, "transitionId": transition.ID, "version": transition.Version, "from": transition.From, "to": transition.To, "readMode": result.ReadMode, "providerEvidence": result.ProviderEvidence}); err != nil {
		restorePersistentState(before, &s.state)
		return StorageTransition{}, err
	}
	return current, nil
}

func (s *Service) failStorageTransition(transitionID string, cause error) (StorageTransition, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	transition, ok := s.state.StorageTransitions[transitionID]
	if !ok {
		return StorageTransition{}, ErrNotFound
	}
	before, _ := json.Marshal(s.state)
	transition.Status = "failed"
	transition.LastError = "provider lifecycle transition failed; retry required"
	transition.UpdatedAt = s.cfg.Now()
	s.state.StorageTransitions[transition.ID] = transition
	if err := s.persist("storage.transition.failed", transition.Owner, transition.ObjectID, map[string]any{"product": transition.Product, "transitionId": transition.ID, "version": transition.Version, "from": transition.From, "to": transition.To, "failure": "provider lifecycle transition failed"}); err != nil {
		restorePersistentState(before, &s.state)
		return StorageTransition{}, err
	}
	return transition, cause
}

func (s *Service) StorageTransitions(actor, product, objectID string) ([]StorageTransition, error) {
	if !validAccount(actor) || (product != "cloud" && product != "docs") {
		return nil, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]StorageTransition, 0)
	for _, transition := range s.state.StorageTransitions {
		if transition.Owner == actor && transition.Product == product && (objectID == "" || transition.ObjectID == objectID) {
			out = append(out, transition)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].RequestedAt.Equal(out[j].RequestedAt) {
			return out[i].RequestedAt.After(out[j].RequestedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func initialStorageState(kind ObjectKind) (StorageClass, int, string) {
	if kind == KindFolder {
		return "", 0, ""
	}
	return StorageClassHot, 1, StorageReadImmediate
}

func validateLifecycleState(state persistentState) error {
	for objectID, versions := range state.Versions {
		object, ok := state.Objects[objectID]
		if !ok {
			return fmt.Errorf("storage lifecycle versions reference missing object %s", objectID)
		}
		if len(versions) == 0 && metadataOnlyWithoutVersion(state, object) {
			continue
		}
		seen := map[int]bool{}
		currentFound := false
		for _, version := range versions {
			if version.ObjectID != objectID || version.Number < 1 || seen[version.Number] {
				return fmt.Errorf("storage lifecycle version identity invalid for object %s", objectID)
			}
			seen[version.Number] = true
			if object.Kind == KindFolder || !validStorageClass(version.StorageClass) || version.StorageClassVersion < 1 {
				return fmt.Errorf("storage lifecycle version class invalid for object %s", objectID)
			}
			if version.StorageReadMode != StorageReadImmediate && version.StorageReadMode != StorageReadRestoreRequired {
				return fmt.Errorf("storage lifecycle version read mode invalid for object %s", objectID)
			}
			if version.StorageClass != StorageClassArchive && version.StorageReadMode != StorageReadImmediate {
				return fmt.Errorf("non-archive version requires restore for object %s", objectID)
			}
			if version.Number == object.Version {
				currentFound = true
				if object.StorageClass != version.StorageClass || object.StorageClassVersion != version.StorageClassVersion || object.StorageReadMode != version.StorageReadMode {
					return fmt.Errorf("object storage summary diverges from current version %s", objectID)
				}
			}
		}
		if object.Kind != KindFolder && !currentFound {
			return fmt.Errorf("current storage version missing for object %s", objectID)
		}
	}
	for objectID, object := range state.Objects {
		if object.Kind == KindFolder {
			if object.StorageClass != "" || object.StorageClassVersion != 0 || object.StorageReadMode != "" || object.StorageClassUpdatedAt != nil {
				return fmt.Errorf("folder %s carries storage lifecycle state", objectID)
			}
			continue
		}
		if metadataOnlyWithoutVersion(state, object) {
			if object.StorageClass != "" || object.StorageClassVersion != 0 || object.StorageReadMode != "" || object.StorageClassUpdatedAt != nil {
				return fmt.Errorf("metadata-only object %s carries invented storage lifecycle state", objectID)
			}
			continue
		}
		if _, _, err := currentVersionIndex(state, object); err != nil {
			return fmt.Errorf("current storage version missing for object %s", objectID)
		}
	}
	for id, transition := range state.StorageTransitions {
		_, hashErr := hex.DecodeString(transition.Hash)
		if transition.ID != id || transition.Version < 1 || !validAccount(transition.Owner) || (transition.Product != "cloud" && transition.Product != "docs") || transition.ObjectID == "" || transition.Ref == "" || len(transition.Hash) != 64 || transition.Hash != strings.ToLower(transition.Hash) || hashErr != nil || !validStorageClass(transition.From) || !validStorageClass(transition.To) || transition.From == transition.To || transition.Attempts < 1 || transition.RequestedAt.IsZero() || transition.UpdatedAt.IsZero() {
			return fmt.Errorf("storage lifecycle transition %s is invalid", id)
		}
		object, ok := state.Objects[transition.ObjectID]
		if !ok || object.Owner != transition.Owner || object.Product != transition.Product {
			return fmt.Errorf("storage lifecycle transition %s crosses object boundary", id)
		}
		_, version, err := versionIndex(state, transition.ObjectID, transition.Version)
		if err != nil || version.Hash != transition.Hash {
			return fmt.Errorf("storage lifecycle transition %s does not bind an immutable version", id)
		}
		switch transition.Status {
		case "pending":
			if transition.ProviderEvidence != "" || transition.ResultRef != "" || version.BlobPath != transition.Ref {
				return fmt.Errorf("pending storage lifecycle transition %s has invalid pending truth", id)
			}
		case "failed":
			if transition.LastError == "" || transition.ProviderEvidence != "" || transition.ResultRef != "" || version.BlobPath != transition.Ref {
				return fmt.Errorf("failed storage lifecycle transition %s has invalid failure truth", id)
			}
		case "completed":
			if transition.ResultRef == "" || transition.ProviderEvidence == "" || (transition.ReadMode != StorageReadImmediate && transition.ReadMode != StorageReadRestoreRequired) {
				return fmt.Errorf("completed storage lifecycle transition %s lacks provider evidence", id)
			}
			if transition.CopyRequired && transition.ResultRef == transition.Ref {
				return fmt.Errorf("completed storage lifecycle transition %s did not isolate a shared blob", id)
			}
			if transition.To != StorageClassArchive && transition.ReadMode != StorageReadImmediate {
				return fmt.Errorf("completed non-archive transition %s requires restore", id)
			}
		default:
			return fmt.Errorf("storage lifecycle transition %s has unknown status", id)
		}
	}
	return nil
}
