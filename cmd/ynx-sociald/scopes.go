package main

// Exact Social registration at shared 45de8d4f11737ccf5ee2a349be6717cb3ce77bbd.
// Publishing/media/follows use social.feed; no new publishing scope exists.
func socialAllowedScopes() []string {
	return []string{"account:read", "profile:link", "social.ai", "social.contacts", "social.feed", "social.messaging", "social.profile"}
}
