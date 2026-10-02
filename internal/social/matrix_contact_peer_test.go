package social

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

// Software-only contract regression; this is not an installed Matrix session,
// real contact approval, public deployment or federation acceptance receipt.
func TestMatrixContactSelectionPreservesExistingIdentity(t *testing.T) {
	f, peer := newFixture(t, 91), newFixture(t, 92)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.contacts")
	s := bridgeService(t, a, nil)
	s.cfg.MatrixDirectory = matrixDirectoryFixture(t,
		MatrixIdentity{peer.account, "https://two.example.test/", "two.example.test", "@historical-peer:two.example.test"})
	id, err := s.publicIdentity(peer.account)
	if err != nil {
		t.Fatal(err)
	}
	self, err := s.publicIdentity(f.account)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(s, s).Handler()
	call := func(person string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, bridgeRequest("android", "/social/v3/matrix/peer?person="+person, "GET", nil))
		return w
	}
	roomPeer := func(userID string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, bridgeRequest("android", "/social/v3/matrix/peer?userId="+url.QueryEscape(userID), "GET", nil))
		return w
	}
	if call(id).Code != 401 || call(self).Code != 401 || call("sp_"+strings.Repeat("z", 32)).Code != 401 {
		t.Fatal("unknown, self or unaccepted identity was exposed")
	}
	if roomPeer("@historical-peer:two.example.test").Code != 401 || roomPeer("@unknown:two.example.test").Code != 401 {
		t.Fatal("old Matrix identity bypassed accepted-contact permission")
	}
	s.mu.Lock()
	s.state.Contacts[pairKey(f.account, peer.account)] = Contact{Left: f.account, Right: peer.account, CreatedAt: time.Now()}
	s.mu.Unlock()
	before, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	w := call(id)
	var result map[string]any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result) != 6 || result["person"] != id || result["protocol"] != matrixPeerProtocol || result["account"] != peer.account || result["userId"] != "@historical-peer:two.example.test" {
		t.Fatalf("selected contact lost its original Matrix binding: %d", w.Code)
	}
	w = roomPeer("@historical-peer:two.example.test")
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result["person"] != id || result["account"] != peer.account {
		t.Fatal("original room lookup derived a different Social identity")
	}
	after, err := os.ReadFile(s.cfg.StatePath)
	if err != nil || !bytes.Equal(before, after) || len(s.state.PublicIdentities) != 2 || len(s.state.Devices) != 0 {
		t.Fatal("read-only contact selection changed original identity/device state")
	}
	s.mu.Lock()
	delete(s.state.Contacts, pairKey(f.account, peer.account))
	s.mu.Unlock()
	if call(id).Code != 401 || roomPeer("@historical-peer:two.example.test").Code != 401 {
		t.Fatal("removed contact retained Matrix peer access")
	}
	s.mu.Lock()
	s.state.Contacts[pairKey(f.account, peer.account)] = Contact{Left: f.account, Right: peer.account, CreatedAt: time.Now()}
	s.mu.Unlock()
	if err := s.Block(Session{Account: f.account}, peer.account); err != nil || call(id).Code != 401 || roomPeer("@historical-peer:two.example.test").Code != 401 {
		t.Fatal("blocked contact retained Matrix peer access")
	}
}

func TestMatrixContactSelectionRejectsAmbiguousQueryBeforeAuthority(t *testing.T) {
	f := newFixture(t, 93)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	handler := NewServer(s, s).Handler()
	id := "sp_" + strings.Repeat("a", 32)
	for _, query := range []string{
		"person=", "person=sp_bad", "person=" + id + "&person=" + id,
		"person=" + id + "&account=" + f.account, "person=" + id + "&token=fixture",
		"person=" + id + "%2F", "person=%", "other=" + id,
		"userId=invalid", "userId=%40old%3Aone.test&person=" + id, "userId=%40old%3Aone.test&userId=%40new%3Atwo.test",
	} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, bridgeRequest("android", "/social/v3/matrix/peer?"+query, "GET", nil))
		if w.Code != 400 {
			t.Fatalf("ambiguous contact query accepted: %d", w.Code)
		}
	}
	if a.calls != 0 {
		t.Fatal("malformed selection reached session authority")
	}
}

func TestRelationshipControlsUseExistingOpaqueIdentity(t *testing.T) {
	f, peer := newFixture(t, 94), newFixture(t, 95)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	id, err := s.publicIdentity(peer.account)
	if err != nil {
		t.Fatal(err)
	}
	actor := Session{Account: f.account}
	s.state.Contacts[pairKey(f.account, peer.account)] = Contact{Left: f.account, Right: peer.account, CreatedAt: time.Now()}
	if err := s.Mute(actor, id, true); err != nil || len(s.state.Mutes) != 1 || !s.contactLocked(f.account, peer.account) {
		t.Fatal("opaque mute altered the contact relationship")
	}
	if err := s.Mute(actor, id, false); err != nil || len(s.state.Mutes) != 0 {
		t.Fatal("opaque unmute changed identity or failed")
	}
	if err := s.DeleteContact(actor, id); err != nil || s.contactLocked(f.account, peer.account) {
		t.Fatal("opaque removal did not remove the bilateral relationship")
	}
	s.state.Contacts[pairKey(f.account, peer.account)] = Contact{Left: f.account, Right: peer.account, CreatedAt: time.Now()}
	if err := s.Block(actor, id); err != nil || !s.blockedLocked(f.account, peer.account) || s.contactLocked(f.account, peer.account) {
		t.Fatal("opaque block did not preserve original privacy semantics")
	}
	if err := s.Block(actor, "sp_"+strings.Repeat("z", 32)); err == nil || len(s.state.PublicIdentities) != 1 || s.state.PublicIdentities[peer.account] != id {
		t.Fatal("unknown privacy target created or replaced an identity")
	}
}
