package music

import "sort"

// Callers hold the state lock (or operate on mutate's transaction snapshot).
// Use the same rule for lookup, library writes and playlist reads: a private
// release is accessible only to its owner, and the listener's explicit-content
// preference applies to playback/library access for every release.
func visibleTrack(st *persistentState, actor, id string) (Track, error) {
	track, exists := st.Tracks[id]
	if !exists || (track.ReleaseState != "published" && track.Owner != actor) {
		return Track{}, ErrNotFound
	}
	if track.Explicit && !st.Profiles[actor].ExplicitAllowed {
		return Track{}, ErrUnauthorized
	}
	return track, nil
}

func visibleTrackIDs(st *persistentState, actor string, ids []string) []string {
	out := []string{}
	for _, id := range ids {
		if _, err := visibleTrack(st, actor, id); err == nil {
			out = append(out, id)
		}
	}
	return out
}

func validateVisibleTrackIDs(st *persistentState, actor string, ids []string) error {
	for _, id := range ids {
		if _, err := visibleTrack(st, actor, id); err != nil {
			return err
		}
	}
	return nil
}

// A read projection hides unavailable references. Editing that projection must
// not silently erase old references the user could not see or explicitly edit.
// They remain private in the same record and reappear if access is restored.
func retainUnavailableTrackIDs(st *persistentState, actor string, old, requested []string) []string {
	result := append([]string{}, requested...)
	for _, id := range old {
		if _, err := visibleTrack(st, actor, id); err != nil {
			result = append(result, id)
		}
	}
	return unique(result)
}

func visibleListener(st *persistentState, actor string, source ListenerState) ListenerState {
	out := source
	out.Favorites = visibleTrackIDs(st, actor, source.Favorites)
	out.Queue = visibleTrackIDs(st, actor, source.Queue)
	out.Downloads = map[string]string{}
	out.Positions = map[string]int64{}
	out.History = []HistoryEntry{}
	for id, status := range source.Downloads {
		if _, err := visibleTrack(st, actor, id); err == nil {
			out.Downloads[id] = status
		}
	}
	for id, position := range source.Positions {
		if _, err := visibleTrack(st, actor, id); err == nil {
			out.Positions[id] = position
		}
	}
	for _, item := range source.History {
		if _, err := visibleTrack(st, actor, item.TrackID); err == nil {
			out.History = append(out.History, item)
		}
	}
	return out
}

func visiblePlaylist(st *persistentState, actor string, source Playlist) Playlist {
	out := source
	out.TrackIDs = visibleTrackIDs(st, actor, source.TrackIDs)
	return out
}

func sortPlaylists(playlists []Playlist) {
	sort.Slice(playlists, func(i, j int) bool {
		if playlists[i].CreatedAt.Equal(playlists[j].CreatedAt) {
			return playlists[i].ID < playlists[j].ID
		}
		return playlists[i].CreatedAt.Before(playlists[j].CreatedAt)
	})
}
