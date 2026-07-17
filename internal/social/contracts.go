package social

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

type PersonView struct {
	ID          string `json:"id"`
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
}
type ProfileView struct {
	PersonView
	Bio            string          `json:"bio"`
	FollowerCount  int             `json:"followerCount"`
	FollowingCount int             `json:"followingCount"`
	PostCount      int             `json:"postCount"`
	Privacy        ProfileSettings `json:"privacy"`
}
type ContactRequestView struct {
	ID        string     `json:"id"`
	Person    PersonView `json:"person"`
	Direction string     `json:"direction"`
	Status    string     `json:"status"`
	Source    string     `json:"source"`
}
type ContactsView struct {
	Contacts []PersonView         `json:"contacts"`
	Requests []ContactRequestView `json:"requests"`
}
type ContactMatchView struct {
	Token  string     `json:"token"`
	Person PersonView `json:"person"`
}

func (s *Service) ContractContactMatches(actor Session, resolver DiscoveryResolver, hashes []string) ([]ContactMatchView, error) {
	settings := s.currentSettings(actor.Account)
	if !settings.ContactsMatching {
		return nil, fmt.Errorf("%w: Contacts permission matching is disabled", ErrUnauthorized)
	}
	if resolver == nil || len(hashes) == 0 || len(hashes) > 500 {
		return nil, ErrInvalid
	}
	out := []ContactMatchView{}
	seen := map[string]bool{}
	for _, hash := range hashes {
		if !evidenceHashPattern.MatchString(hash) {
			return nil, ErrInvalid
		}
		account, err := resolver.ResolveDiscovery("contacts", hash)
		if err != nil || account == actor.Account || seen[account] || s.isContact(actor.Account, account) {
			continue
		}
		person, err := s.person(account)
		if err != nil {
			continue
		}
		seen[account] = true
		out = append(out, ContactMatchView{Token: hash, Person: person})
	}
	return out, nil
}

type ConversationView struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Handle      string    `json:"handle,omitempty"`
	Unread      int       `json:"unread"`
	LastMessage string    `json:"lastMessage"`
	E2EE        string    `json:"e2ee"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type ConversationDetailView struct {
	ConversationView
	Members []PersonView `json:"members"`
}
type FeedPostView struct {
	ID             string        `json:"id"`
	Author         PersonView    `json:"author"`
	Text           string        `json:"text"`
	Visibility     string        `json:"visibility"`
	Reactions      int           `json:"reactions"`
	Comments       int           `json:"comments"`
	Media          []MediaObject `json:"media"`
	ViewerReaction string        `json:"viewerReaction,omitempty"`
	Status         string        `json:"status"`
	CreatedAt      time.Time     `json:"createdAt"`
}
type MomentCommentView struct {
	ID        string     `json:"id"`
	Author    PersonView `json:"author"`
	Text      string     `json:"text"`
	CreatedAt time.Time  `json:"createdAt"`
}
type AlertView struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"`
	Actor     PersonView `json:"actor"`
	Summary   string     `json:"summary"`
	ReadAt    *time.Time `json:"readAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

func (s *Service) ContractContacts(actor Session) (ContactsView, error) {
	if s.cfg.Square == nil {
		return ContactsView{}, fmt.Errorf("%w: Square contract unavailable", ErrConflict)
	}
	contacts := s.Contacts(actor)
	requests := s.Requests(actor)
	out := ContactsView{Contacts: []PersonView{}, Requests: []ContactRequestView{}}
	for _, contact := range contacts {
		account := contact.Left
		if account == actor.Account {
			account = contact.Right
		}
		person, err := s.person(account)
		if err != nil {
			return ContactsView{}, err
		}
		out.Contacts = append(out.Contacts, person)
	}
	for _, request := range requests {
		account, direction := request.To, "outgoing"
		if request.To == actor.Account {
			account = request.From
			direction = "incoming"
		}
		person, err := s.person(account)
		if err != nil {
			return ContactsView{}, err
		}
		out.Requests = append(out.Requests, ContactRequestView{ID: request.ID, Person: person, Direction: direction, Status: request.Status, Source: request.Source})
	}
	sort.Slice(out.Contacts, func(i, j int) bool { return out.Contacts[i].Handle < out.Contacts[j].Handle })
	return out, nil
}

func (s *Service) ContractProfile(actor Session) (ProfileView, error) {
	if s.cfg.Square == nil {
		return ProfileView{}, fmt.Errorf("%w: Square contract unavailable", ErrConflict)
	}
	profile, err := s.cfg.Square.Profile(actor.Account)
	if err != nil {
		return ProfileView{}, socialSquareError(err)
	}
	settings := s.currentSettings(actor.Account)
	return ProfileView{PersonView: PersonView{ID: actor.Account, Handle: profile.Handle, DisplayName: profile.DisplayName, AvatarURL: settings.AvatarURL}, Bio: profile.Bio, FollowerCount: profile.FollowerCount, FollowingCount: profile.FollowingCount, PostCount: profile.PostCount, Privacy: settings}, nil
}

func (s *Service) UpdateContractProfile(actor Session, idempotencyKey, handle, displayName, bio, avatarURL string) (ProfileView, bool, error) {
	if s.cfg.Square == nil {
		return ProfileView{}, false, fmt.Errorf("%w: Square contract unavailable", ErrConflict)
	}
	result, err := s.cfg.Square.SetProfile(square.Device{ID: actor.DeviceID, Account: actor.Account}, square.SetProfileRequest{IdempotencyKey: idempotencyKey, Handle: handle, DisplayName: displayName, Bio: bio})
	if err != nil {
		return ProfileView{}, false, socialSquareError(err)
	}
	current := s.currentSettings(actor.Account)
	settingsKey := idempotencyKey + "-privacy"
	if len(settingsKey) > 95 {
		settingsKey = "profile-settings-" + objectDigest(idempotencyKey)[:24]
	}
	_, _, err = s.SetSettings(actor, ProfileSettingsInput{IdempotencyKey: settingsKey, DiscoverableByHandle: current.DiscoverableByHandle, ContactsMatching: current.ContactsMatching, AllowRecommendations: current.AllowRecommendations, AllowRequestsFrom: defaultRequestPrivacy(current.AllowRequestsFrom), AvatarURL: avatarURL})
	if err != nil {
		return ProfileView{}, false, err
	}
	view, err := s.ContractProfile(actor)
	return view, result.Replayed, err
}

func (s *Service) currentSettings(account string) ProfileSettings {
	s.mu.Lock()
	defer s.mu.Unlock()
	settings, ok := s.state.Settings[account]
	if !ok {
		return ProfileSettings{Account: account, DiscoverableByHandle: true, AllowRecommendations: true, AllowRequestsFrom: "everyone"}
	}
	return settings
}

func defaultRequestPrivacy(value string) string {
	if value == "" {
		return "everyone"
	}
	return value
}

func (s *Service) ContractConversations(actor Session, query string) ([]ConversationView, error) {
	if s.cfg.Chat == nil || s.cfg.Square == nil {
		return nil, fmt.Errorf("%w: Chat or Square contract unavailable", ErrConflict)
	}
	chatActor := chat.Device{ID: actor.DeviceID, Account: actor.Account}
	records := s.cfg.Chat.Conversations(chatActor)
	out := make([]ConversationView, 0, len(records))
	query = strings.ToLower(strings.TrimSpace(query))
	for _, record := range records {
		names := []string{}
		handle := ""
		verified := true
		for _, member := range record.Members {
			if member == actor.Account {
				continue
			}
			person, err := s.person(member)
			if err != nil {
				return nil, err
			}
			names = append(names, person.DisplayName)
			if len(record.Members) == 2 {
				handle = person.Handle
			}
			devices, err := s.cfg.Chat.Devices(chatActor, member)
			if err != nil || len(devices) == 0 {
				verified = false
			}
		}
		title := strings.Join(names, ", ")
		if title == "" {
			title = "Private conversation"
		}
		if query != "" && !strings.Contains(strings.ToLower(title+" "+handle), query) {
			continue
		}
		messages, err := s.cfg.Chat.Messages(chatActor, record.ID)
		if err != nil {
			return nil, err
		}
		unread := 0
		last := "No messages yet"
		if len(messages) > 0 {
			last = "Encrypted message"
			for _, message := range messages {
				if message.Sender != actor.Account {
					if _, ok := message.ReadAt[actor.DeviceID]; !ok {
						unread++
					}
				}
			}
		}
		state := "verified"
		if !verified {
			state = "recovery-required"
		}
		out = append(out, ConversationView{ID: record.ID, Title: title, Handle: handle, Unread: unread, LastMessage: last, E2EE: state, UpdatedAt: record.UpdatedAt})
	}
	for _, group := range s.GroupConversations(actor) {
		if query != "" && !strings.Contains(strings.ToLower(group.Title), query) {
			continue
		}
		messages, err := s.GroupMessages(actor, group.ID)
		if err != nil {
			return nil, err
		}
		unread := 0
		for _, message := range messages {
			if message.Sender != actor.Account {
				if _, ok := message.ReadAt[actor.DeviceID]; !ok {
					unread++
				}
			}
		}
		last := "No messages yet"
		if len(messages) > 0 {
			last = "Encrypted message"
		}
		out = append(out, ConversationView{ID: group.ID, Title: group.Title, Unread: unread, LastMessage: last, E2EE: "verified", UpdatedAt: group.UpdatedAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

func (s *Service) CreateDirectConversation(actor Session, target, idempotencyKey string) (chat.Result[chat.Conversation], error) {
	if s.cfg.Chat == nil {
		return chat.Result[chat.Conversation]{}, fmt.Errorf("%w: Chat contract unavailable", ErrConflict)
	}
	if target == actor.Account || !s.isContact(actor.Account, target) {
		return chat.Result[chat.Conversation]{}, fmt.Errorf("%w: direct messages require an accepted Social contact", ErrUnauthorized)
	}
	result, err := s.cfg.Chat.CreateConversation(chat.Device{ID: actor.DeviceID, Account: actor.Account}, chat.CreateConversationRequest{IdempotencyKey: idempotencyKey, Members: []string{actor.Account, target}})
	return result, socialChatError(err)
}

func (s *Service) ContractConversation(actor Session, id string) (ConversationDetailView, error) {
	if strings.HasPrefix(id, "group_") {
		group, err := s.GroupConversation(actor, id)
		if err != nil {
			return ConversationDetailView{}, err
		}
		members := make([]PersonView, 0, len(group.Members))
		for _, account := range group.Members {
			person, err := s.person(account)
			if err != nil {
				return ConversationDetailView{}, err
			}
			members = append(members, person)
		}
		messages, _ := s.GroupMessages(actor, id)
		return ConversationDetailView{ConversationView: ConversationView{ID: id, Title: group.Title, LastMessage: map[bool]string{true: "Encrypted message", false: "No messages yet"}[len(messages) > 0], E2EE: "verified", UpdatedAt: group.UpdatedAt}, Members: members}, nil
	}
	if s.cfg.Chat == nil {
		return ConversationDetailView{}, fmt.Errorf("%w: Chat contract unavailable", ErrConflict)
	}
	chatActor := chat.Device{ID: actor.DeviceID, Account: actor.Account}
	record, err := s.cfg.Chat.Conversation(chatActor, id)
	if err != nil {
		return ConversationDetailView{}, socialChatError(err)
	}
	views, err := s.ContractConversations(actor, "")
	if err != nil {
		return ConversationDetailView{}, err
	}
	var summary ConversationView
	found := false
	for _, view := range views {
		if view.ID == id {
			summary, found = view, true
			break
		}
	}
	if !found {
		return ConversationDetailView{}, ErrNotFound
	}
	members := make([]PersonView, 0, len(record.Members))
	for _, account := range record.Members {
		person, err := s.person(account)
		if err != nil {
			return ConversationDetailView{}, err
		}
		members = append(members, person)
	}
	return ConversationDetailView{ConversationView: summary, Members: members}, nil
}

func (s *Service) ConversationDevices(actor Session, id string) ([]chat.Device, error) {
	if strings.HasPrefix(id, "group_") {
		devices, err := s.GroupDevices(actor, id)
		if err != nil {
			return nil, err
		}
		out := make([]chat.Device, 0, len(devices))
		for _, device := range devices {
			out = append(out, chat.Device{ID: device.ID, Account: device.Account, SigningPublicKey: device.SigningPublicKey, EncryptionPublicKey: device.EncryptionPublicKey, Status: device.Status, CreatedAt: device.CreatedAt, UpdatedAt: device.UpdatedAt})
		}
		return out, nil
	}
	if s.cfg.Chat == nil {
		return nil, fmt.Errorf("%w: Chat contract unavailable", ErrConflict)
	}
	chatActor := chat.Device{ID: actor.DeviceID, Account: actor.Account}
	record, err := s.cfg.Chat.Conversation(chatActor, id)
	if err != nil {
		return nil, socialChatError(err)
	}
	devices := []chat.Device{}
	for _, account := range record.Members {
		memberDevices, err := s.cfg.Chat.Devices(chatActor, account)
		if err != nil {
			return nil, socialChatError(err)
		}
		devices = append(devices, memberDevices...)
	}
	return devices, nil
}

func (s *Service) ConversationMessages(actor Session, id string) ([]chat.Message, error) {
	if strings.HasPrefix(id, "group_") {
		return s.GroupMessages(actor, id)
	}
	if s.cfg.Chat == nil {
		return nil, fmt.Errorf("%w: Chat contract unavailable", ErrConflict)
	}
	record, err := s.cfg.Chat.Messages(chat.Device{ID: actor.DeviceID, Account: actor.Account}, id)
	return record, socialChatError(err)
}

func (s *Service) SendConversationMessage(actor Session, id string, in chat.SendMessageRequest) (chat.Result[chat.Message], error) {
	if strings.HasPrefix(id, "group_") {
		return s.SendGroupMessage(actor, id, in)
	}
	if s.cfg.Chat == nil {
		return chat.Result[chat.Message]{}, fmt.Errorf("%w: Chat contract unavailable", ErrConflict)
	}
	chatActor, err := s.boundChatDevice(actor)
	if err != nil {
		return chat.Result[chat.Message]{}, err
	}
	record, err := s.cfg.Chat.SendMessage(chatActor, id, in)
	if err != nil {
		return record, socialChatError(err)
	}
	conversation, conversationErr := s.cfg.Chat.Conversation(chatActor, id)
	if conversationErr == nil {
		if notifyErr := s.persistMessageNotifications(actor, conversation.Members, "message_received", record.Record.ID); notifyErr != nil {
			return chat.Result[chat.Message]{}, notifyErr
		}
	}
	return record, nil
}

func (s *Service) boundChatDevice(actor Session) (chat.Device, error) {
	minimal := chat.Device{ID: actor.DeviceID, Account: actor.Account}
	devices, err := s.cfg.Chat.Devices(minimal, actor.Account)
	if err != nil {
		return chat.Device{}, socialChatError(err)
	}
	for _, device := range devices {
		if device.ID == actor.DeviceID && device.Status == "active" {
			return device, nil
		}
	}
	return chat.Device{}, fmt.Errorf("%w: bound Chat device is unavailable", ErrUnauthorized)
}

func (s *Service) RotateConversationDevice(actor Session, replacedDeviceID string, in chat.RotateDeviceRequest) (chat.Result[chat.DeviceRotation], Session, error) {
	if s.cfg.Chat == nil {
		return chat.Result[chat.DeviceRotation]{}, Session{}, fmt.Errorf("%w: Chat contract unavailable", ErrConflict)
	}
	s.mu.Lock()
	old, oldOK := s.state.Devices[replacedDeviceID]
	newDevice, newOK := s.state.Devices[in.NewDeviceID]
	_, storedSession, sessionOK := s.sessionByIDLocked(actor.ID)
	firstAttempt := sessionOK && storedSession.DeviceID == replacedDeviceID && actor.DeviceID == replacedDeviceID && oldOK && old.Status == "active"
	retry := sessionOK && storedSession.DeviceID == in.NewDeviceID && actor.DeviceID == in.NewDeviceID && oldOK && old.Status == "revoked" && newOK && newDevice.Status == "active" && newDevice.Account == actor.Account && newDevice.SigningPublicKey == in.SigningPublicKey && newDevice.EncryptionPublicKey == in.EncryptionPublicKey
	s.mu.Unlock()
	if (!firstAttempt && !retry) || old.Account != actor.Account {
		return chat.Result[chat.DeviceRotation]{}, Session{}, fmt.Errorf("%w: rotation is not bound to the current product session", ErrUnauthorized)
	}
	chatActor := chat.Device{ID: old.ID, Account: old.Account, SigningPublicKey: old.SigningPublicKey, EncryptionPublicKey: old.EncryptionPublicKey, Status: old.Status, CreatedAt: old.CreatedAt, UpdatedAt: old.UpdatedAt}
	result, err := s.cfg.Chat.RotateDevice(chatActor, replacedDeviceID, in)
	if err != nil {
		return chat.Result[chat.DeviceRotation]{}, Session{}, socialChatError(err)
	}
	if retry {
		return result, storedSession, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	old, oldOK = s.state.Devices[replacedDeviceID]
	if !oldOK || old.Account != actor.Account || old.Status != "active" {
		return chat.Result[chat.DeviceRotation]{}, Session{}, ErrUnauthorized
	}
	if existing, ok := s.state.Devices[in.NewDeviceID]; ok && (existing.Account != actor.Account || existing.SigningPublicKey != in.SigningPublicKey || existing.EncryptionPublicKey != in.EncryptionPublicKey) {
		return chat.Result[chat.DeviceRotation]{}, Session{}, ErrConflict
	}
	key, session, ok := s.sessionByIDLocked(actor.ID)
	if !ok || session.DeviceID != replacedDeviceID {
		return chat.Result[chat.DeviceRotation]{}, Session{}, ErrUnauthorized
	}
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	old.Status, old.UpdatedAt = "revoked", now
	s.state.Devices[old.ID] = old
	s.state.Devices[in.NewDeviceID] = ProductDevice{ID: in.NewDeviceID, Account: actor.Account, SigningPublicKey: in.SigningPublicKey, EncryptionPublicKey: in.EncryptionPublicKey, Status: "active", CreatedAt: now, UpdatedAt: now}
	session.DeviceID = in.NewDeviceID
	s.state.Sessions[key] = session
	s.appendAuditLocked("product_device_rotated", "device", in.NewDeviceID, actor.Account, objectDigest(result.Record), now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return chat.Result[chat.DeviceRotation]{}, Session{}, err
	}
	return result, session, nil
}

func (s *Service) AcknowledgeConversationMessage(actor Session, conversationID, messageID, state string) (chat.Message, error) {
	if strings.HasPrefix(conversationID, "group_") {
		return s.AcknowledgeGroupMessage(actor, conversationID, messageID, state)
	}
	if s.cfg.Chat == nil {
		return chat.Message{}, fmt.Errorf("%w: Chat contract unavailable", ErrConflict)
	}
	record, err := s.cfg.Chat.Acknowledge(chat.Device{ID: actor.DeviceID, Account: actor.Account}, conversationID, messageID, state)
	if err != nil {
		return record, socialChatError(err)
	}
	if record.Sender != actor.Account {
		if notifyErr := s.persistMessageNotifications(actor, []string{record.Sender}, "message_"+state, messageID); notifyErr != nil {
			return chat.Message{}, notifyErr
		}
	}
	return record, nil
}

func (s *Service) persistMessageNotifications(actor Session, recipients []string, kind, objectID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	before := cloneState(s.state)
	now := s.cfg.Now().UTC()
	changed := false
	for _, recipient := range recipients {
		if recipient != actor.Account {
			id := "notification_" + objectDigest(struct{ A, B, K, O string }{recipient, actor.Account, kind, objectID})[:24]
			if _, exists := s.state.Notifications[id]; !exists {
				s.notifyLocked(recipient, actor.Account, kind, objectID, now)
				changed = true
			}
		}
	}
	if !changed {
		return nil
	}
	s.appendAuditLocked(kind, "message", objectID, actor.Account, objectDigest(recipients), now)
	return s.saveOrRollbackLocked(before)
}

func (s *Service) isContact(left, right string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.state.Contacts[pairKey(left, right)]
	return ok
}

func socialChatError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, chat.ErrInvalid):
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	case errors.Is(err, chat.ErrUnauthorized):
		return fmt.Errorf("%w: %v", ErrUnauthorized, err)
	case errors.Is(err, chat.ErrNotFound):
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, chat.ErrConflict):
		return fmt.Errorf("%w: %v", ErrConflict, err)
	default:
		return err
	}
}

func socialSquareError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, square.ErrInvalid):
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	case errors.Is(err, square.ErrUnauthorized):
		return fmt.Errorf("%w: %v", ErrUnauthorized, err)
	case errors.Is(err, square.ErrNotFound):
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, square.ErrConflict):
		return fmt.Errorf("%w: %v", ErrConflict, err)
	default:
		return err
	}
}

func (s *Service) ContractFeed(actor Session) ([]FeedPostView, error) {
	if s.cfg.Square == nil {
		return nil, fmt.Errorf("%w: Square contract unavailable", ErrConflict)
	}
	moments := s.VisibleMoments(actor)
	out := make([]FeedPostView, 0, len(moments))
	for _, moment := range moments {
		person, err := s.person(moment.Author)
		if err != nil {
			return nil, err
		}
		s.mu.Lock()
		media := make([]MediaObject, 0, len(moment.MediaIDs))
		for _, mediaID := range moment.MediaIDs {
			if item, ok := s.state.Media[mediaID]; ok {
				media = append(media, item)
			}
		}
		reaction := s.state.MomentReactions[moment.ID+"|"+actor.Account]
		reactions := activeReactionCount(s.state.MomentReactions, moment.ID)
		comments := activeCommentCount(s.state.MomentComments[moment.ID])
		s.mu.Unlock()
		viewerReaction := ""
		if reaction.Active {
			viewerReaction = reaction.Kind
		}
		out = append(out, FeedPostView{ID: moment.ID, Author: person, Text: moment.Text, Visibility: moment.Visibility, Reactions: reactions, Comments: comments, Media: media, ViewerReaction: viewerReaction, Status: moment.Status, CreatedAt: moment.CreatedAt})
	}
	return out, nil
}

func (s *Service) ContractMomentComments(actor Session, momentID string) ([]MomentCommentView, error) {
	comments, err := s.MomentComments(actor, momentID)
	if err != nil {
		return nil, err
	}
	out := make([]MomentCommentView, 0, len(comments))
	for _, comment := range comments {
		person, err := s.person(comment.Author)
		if err != nil {
			return nil, err
		}
		out = append(out, MomentCommentView{ID: comment.ID, Author: person, Text: comment.Text, CreatedAt: comment.CreatedAt})
	}
	return out, nil
}

func (s *Service) CreatePublicPost(actor Session, idempotencyKey, text string) (FeedPostView, bool, error) {
	if s.cfg.Square == nil {
		return FeedPostView{}, false, fmt.Errorf("%w: Square contract unavailable", ErrConflict)
	}
	result, err := s.cfg.Square.CreatePost(square.Device{ID: actor.DeviceID, Account: actor.Account}, square.CreatePostRequest{IdempotencyKey: idempotencyKey, Content: text})
	if err != nil {
		return FeedPostView{}, false, err
	}
	person, err := s.person(actor.Account)
	if err != nil {
		return FeedPostView{}, false, err
	}
	post := result.Record
	return FeedPostView{ID: post.ID, Author: person, Text: post.Content, Visibility: "public", Reactions: post.ReactionCount, Comments: post.CommentCount, CreatedAt: post.CreatedAt}, result.Replayed, nil
}

func (s *Service) FollowTarget(actor Session, target, idempotencyKey string, active bool) (square.Result[square.Follow], error) {
	if s.cfg.Square == nil {
		return square.Result[square.Follow]{}, fmt.Errorf("%w: Square contract unavailable", ErrConflict)
	}
	s.mu.Lock()
	blocked := s.blockedLocked(actor.Account, target)
	s.mu.Unlock()
	if blocked || target == actor.Account {
		return square.Result[square.Follow]{}, ErrUnauthorized
	}
	result, err := s.cfg.Square.SetFollow(square.Device{ID: actor.DeviceID, Account: actor.Account}, square.SetFollowRequest{IdempotencyKey: idempotencyKey, Account: target, Active: active})
	if err != nil {
		return square.Result[square.Follow]{}, socialSquareError(err)
	}
	if active && !result.Replayed {
		s.mu.Lock()
		before := cloneState(s.state)
		now := s.cfg.Now().UTC()
		s.notifyLocked(target, actor.Account, "follow", target, now)
		s.appendAuditLocked("profile_followed", "profile", target, actor.Account, objectDigest(result.Record), now)
		err = s.saveOrRollbackLocked(before)
		s.mu.Unlock()
	}
	return result, err
}

func (s *Service) ContractAlerts(actor Session) ([]AlertView, int, error) {
	if s.cfg.Square == nil {
		return nil, 0, fmt.Errorf("%w: Square contract unavailable", ErrConflict)
	}
	squareFeed, err := s.cfg.Square.Notifications(square.Device{ID: actor.DeviceID, Account: actor.Account}, 100, "")
	if err != nil {
		return nil, 0, err
	}
	socialAlerts, socialUnread := s.Notifications(actor)
	out := make([]AlertView, 0, len(squareFeed.Notifications)+len(socialAlerts))
	for _, notification := range squareFeed.Notifications {
		person, err := s.person(notification.Actor)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, AlertView{ID: "square:" + notification.ID, Kind: notification.Kind, Actor: person, Summary: alertSummary(notification.Kind), ReadAt: notification.ReadAt, CreatedAt: notification.CreatedAt})
	}
	for _, notification := range socialAlerts {
		person, err := s.person(notification.Actor)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, AlertView{ID: "social:" + notification.ID, Kind: notification.Kind, Actor: person, Summary: alertSummary(notification.Kind), ReadAt: notification.ReadAt, CreatedAt: notification.CreatedAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, squareFeed.UnreadCount + socialUnread, nil
}

// MarkContractNotificationRead preserves the source prefix returned by
// ContractAlerts so an alert can never be marked read in the wrong account or
// backing service.
func (s *Service) MarkContractNotificationRead(actor Session, prefixedID string) (any, error) {
	switch {
	case strings.HasPrefix(prefixedID, "social:"):
		return s.MarkNotificationRead(actor, strings.TrimPrefix(prefixedID, "social:"))
	case strings.HasPrefix(prefixedID, "square:"):
		if s.cfg.Square == nil {
			return nil, fmt.Errorf("%w: Square contract unavailable", ErrConflict)
		}
		id := strings.TrimPrefix(prefixedID, "square:")
		if !identifierPattern.MatchString(id) {
			return nil, ErrInvalid
		}
		result, err := s.cfg.Square.ReadNotification(square.Device{ID: actor.DeviceID, Account: actor.Account}, id, square.ReadNotificationRequest{IdempotencyKey: "social-read-" + id})
		if err != nil {
			return nil, socialSquareError(err)
		}
		return result.Record, nil
	default:
		return nil, ErrInvalid
	}
}

func (s *Service) person(account string) (PersonView, error) {
	profile, err := s.cfg.Square.Profile(account)
	if err != nil {
		return PersonView{}, fmt.Errorf("%w: Social profile required", ErrNotFound)
	}
	s.mu.Lock()
	settings := s.state.Settings[account]
	s.mu.Unlock()
	return PersonView{ID: account, Handle: profile.Handle, DisplayName: profile.DisplayName, AvatarURL: settings.AvatarURL}, nil
}
func alertSummary(kind string) string {
	switch {
	case kind == "contact_request":
		return "New contact request"
	case kind == "contact_accepted":
		return "Contact request accepted"
	case kind == "comment":
		return "New comment on your moment"
	case strings.HasPrefix(kind, "reaction_"):
		return "New reaction to your moment"
	case kind == "group_member_added":
		return "Group member added"
	case kind == "group_member_removed":
		return "Group member removed"
	case kind == "follow":
		return "New follower"
	case kind == "mention":
		return "You were mentioned"
	case kind == "message_received":
		return "New encrypted message"
	case kind == "message_delivered":
		return "Message delivered"
	case kind == "message_read":
		return "Message read"
	default:
		return "New Social activity"
	}
}
