package video

import (
	"errors"
	"fmt"
)

// EnsureSubscription expresses a desired state, so concurrent tabs cannot
// undo each other. The original POST toggle remains available to older clients.
func (s *Service) EnsureSubscription(actor, channelID string) error {
	if actor == "" {
		return ErrUnauthorized
	}
	return s.store.update(func(st *State) error {
		if st.Channels[channelID] == nil {
			return ErrNotFound
		}
		key := actor + ":" + channelID
		if _, exists := st.Subscriptions[key]; exists {
			return nil
		}
		st.Subscriptions[key] = Subscription{Account: actor, ChannelID: channelID, CreatedAt: s.cfg.Now().UTC()}
		s.audit(st, actor, "subscription.add", "channel", channelID, "")
		return nil
	})
}

func validPlaybackID(value string) bool {
	if len(value) != 36 || value[14] != '4' || (value[19] != '8' && value[19] != '9' && value[19] != 'a' && value[19] != 'b') {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// RecordPlaybackProgress updates the existing event for one observed playback.
// HTTP idempotency identifies each immutable batch; playbackID groups accepted
// batches without turning periodic flushes or a completion marker into views.
// All joins are account and video scoped inside the existing state transaction.
func (s *Service) RecordPlaybackProgress(actor, videoID, playbackID string, seconds int64, completed bool) error {
	if actor == "" {
		return ErrUnauthorized
	}
	if !validPlaybackID(playbackID) {
		return errors.New("invalid playback ID")
	}
	if seconds < 0 || seconds > 86400 {
		return errors.New("invalid watch duration")
	}
	return s.store.update(func(st *State) error {
		if !audienceAvailable(*st, st.Videos[videoID], s.cfg.Now().UTC()) {
			return ErrNotFound
		}
		var event WatchEvent
		for _, saved := range st.WatchEvents {
			if saved.Account == actor && saved.VideoID == videoID && saved.PlaybackID == playbackID {
				event = saved
				break
			}
		}
		if event.ID == "" {
			if seconds == 0 {
				return nil
			}
			event = WatchEvent{ID: id("watch"), VideoID: videoID, Account: actor, PlaybackID: playbackID, CreatedAt: s.cfg.Now().UTC()}
		}
		if event.Seconds > 86400-seconds {
			return errors.New("playback duration exceeds one day")
		}
		if seconds == 0 && (!completed || event.Completed) {
			return nil
		}
		event.Seconds += seconds
		event.Completed = event.Completed || completed
		st.WatchEvents[event.ID] = event
		s.audit(st, actor, "watch.progress", "video", videoID, fmt.Sprintf("%s seconds=%d completed=%t", event.ID, seconds, completed))
		return nil
	})
}
