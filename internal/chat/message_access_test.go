package chat

import "testing"

func TestMessageReadsRequireCurrentDeviceAndAddressedHistory(t *testing.T) {
	actor := Device{ID: "device-a", Account: "alice", Status: "active"}
	s := &Service{state: persistentState{Devices: map[string]Device{actor.ID: actor}, Conversations: map[string]Conversation{"conversation": {ID: "conversation", Members: []string{"alice"}}}, Messages: map[string][]Message{"conversation": {
		{ID: "visible", ProtocolVersion: 2, Envelopes: []MessageEnvelope{{RecipientDeviceID: actor.ID, RecipientAccount: actor.Account}}},
		{ID: "old-device", ProtocolVersion: 2, Envelopes: []MessageEnvelope{{RecipientDeviceID: "other", RecipientAccount: actor.Account}}},
	}}}}
	messages, err := s.Messages(actor, "conversation")
	if err != nil || len(messages) != 1 || messages[0].ID != "visible" {
		t.Fatalf("unexpected history: %+v %v", messages, err)
	}
	revoked := actor
	revoked.Status = "revoked"
	s.state.Devices[actor.ID] = revoked
	if _, err = s.Messages(actor, "conversation"); err != ErrUnauthorized {
		t.Fatalf("revoked device: %v", err)
	}
	s.state.Devices[actor.ID] = actor
	s.state.Conversations["conversation"] = Conversation{Members: []string{"bob"}}
	if _, err = s.Messages(actor, "conversation"); err != ErrUnauthorized {
		t.Fatalf("removed member: %v", err)
	}
}
