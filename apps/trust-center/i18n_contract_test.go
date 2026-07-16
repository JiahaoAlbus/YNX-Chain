package main

import (
	"os"
	"strings"
	"testing"
)

func TestTrustI18nStrictBoundaryContract(t *testing.T) {
	raw, err := os.ReadFile("web/i18n.js")
	if err != nil { t.Fatal(err) }
	s := string(raw)
	for _, locale := range []string{`en:`, `"zh-Hans":`, `"zh-Hant":`, `ja:`, `ko:`, `es:`, `fr:`, `de:`, `pt:`, `ru:`, `ar:`, `id:`} {
		if !strings.Contains(s, locale) { t.Errorf("missing locale %s", locale) }
	}
	for _, term := range []string{"YNXT", "boundaryBody", "appeal", "human review", "冻结", "凍結", "凍結", "동결", "congelar", "geler", "einfrieren", "замораживать", "تجميد", "membekukan"} {
		if !strings.Contains(s, term) { t.Errorf("missing reviewed due-process term %q", term) }
	}
	if strings.Contains(s, `boundaryBody:""`) { t.Fatal("blank legal boundary") }
}

func TestTrustLocalizedSecurityPrivacyRecoveryAndAccessibility(t *testing.T) {
	raw, err := os.ReadFile("web/i18n-extra.js")
	if err != nil { t.Fatal(err) }
	s := string(raw)
	for _, key := range []string{"securityNotice", "privacyNotice", "recoveryNotice", "statusAria", "noSubstitute", "challengeReady", "transparencyUnavailable"} {
		if got := strings.Count(s, key+":"); got != 12 { t.Errorf("%s has %d translations, want 12", key, got) }
	}
}
