package main

import (
	"os"
	"strings"
	"testing"
)

func TestResourceI18nStrictSettlementContract(t *testing.T) {
	raw, err := os.ReadFile("web/i18n.js")
	if err != nil { t.Fatal(err) }
	s := string(raw)
	for _, locale := range []string{`en:`, `"zh-Hans":`, `"zh-Hant":`, `ja:`, `ko:`, `es:`, `fr:`, `de:`, `pt:`, `ru:`, `ar:`, `id:`} {
		if !strings.Contains(s, locale) { t.Errorf("missing locale %s", locale) }
	}
	for _, term := range []string{"YNXT", "not settlement", "不等于结算", "不等於結算", "決済ではなく", "결제가 아니며", "no es una liquidación", "n’est pas un règlement", "keine Abrechnung", "não é liquidação", "не является", "ليس تسوية", "bukan penyelesaian"} {
		if !strings.Contains(s, term) { t.Errorf("missing reviewed payment-boundary term %q", term) }
	}
	if strings.Contains(s, `boundary:""`) { t.Fatal("blank settlement boundary") }
}

func TestResourceLocalizedSecurityPrivacyRecoveryAndAccessibility(t *testing.T) {
	raw, err := os.ReadFile("web/i18n-extra.js")
	if err != nil { t.Fatal(err) }
	s := string(raw)
	for _, key := range []string{"securityNotice", "privacyNotice", "recoveryNotice", "statusAria", "settlementBlocked", "challengeReady", "quoteBlocked"} {
		if got := strings.Count(s, key+":"); got != 12 { t.Errorf("%s has %d translations, want 12", key, got) }
	}
}
