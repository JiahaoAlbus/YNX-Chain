package aigateway

import (
	"regexp"
	"strings"
	"unicode"
)

type generationContentFinding struct {
	Code string
}

var (
	credentialLabelPattern = regexp.MustCompile(`(?i)\b(?:api[_ -]?key|access[_ -]?token|bearer|password|passphrase|private[_ -]?key)\b\s*[:=]\s*[^\s]{16,}`)
	providerTokenPattern   = regexp.MustCompile(`\b(?:` + "sk" + `-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{16,}\b`)
	cloudAccessPattern     = regexp.MustCompile(`\bA` + `KIA[A-Z0-9]{16}\b`)
	privateHexPattern      = regexp.MustCompile(`(?i)\b(?:0x)?[0-9a-f]{64}\b`)
	cvvLabelPattern        = regexp.MustCompile(`(?i)\b(?:cvv|cvc|security code)\b\s*[:=]?\s*\d{3,4}\b`)
)

func guardGenerationContent(input generationInput) generationContentFinding {
	if containsRestrictedCredential(input.Prompt) {
		return generationContentFinding{Code: "restricted_context"}
	}
	for _, attachment := range input.Attachments {
		if containsRestrictedCredential(attachment.Text) || containsIndirectPromptInjection(attachment.Text) {
			return generationContentFinding{Code: "restricted_context"}
		}
	}
	return generationContentFinding{}
}

func containsRestrictedCredential(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	lower := strings.ToLower(value)
	if strings.Contains(lower, "-----begin "+"private key-----") || strings.Contains(lower, "-----begin rsa "+"private key-----") || strings.Contains(lower, "-----begin ec "+"private key-----") {
		return true
	}
	if credentialLabelPattern.MatchString(value) || providerTokenPattern.MatchString(value) || cloudAccessPattern.MatchString(value) || cvvLabelPattern.MatchString(value) {
		return true
	}
	if (strings.Contains(lower, "private key") || strings.Contains(lower, "signing key")) && privateHexPattern.MatchString(value) {
		return true
	}
	if strings.Contains(lower, "seed phrase") || strings.Contains(lower, "recovery phrase") || strings.Contains(lower, "mnemonic") {
		if countWordsAfterCredentialLabel(value) >= 12 {
			return true
		}
	}
	return containsPaymentCardNumber(value)
}

func containsIndirectPromptInjection(value string) bool {
	lower := strings.ToLower(strings.Join(strings.Fields(value), " "))
	if lower == "" {
		return false
	}
	patterns := []string{
		"ignore previous instructions",
		"ignore all previous instructions",
		"ignore the system message",
		"override system policy",
		"reveal the system prompt",
		"reveal hidden prompt",
		"bypass safety policy",
		"execute the tool",
		"call the tool without approval",
		"sign the transaction",
		"transfer the funds",
	}
	for _, pattern := range patterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}
	return false
}

func countWordsAfterCredentialLabel(value string) int {
	index := strings.IndexAny(value, ":=")
	if index >= 0 && index+1 < len(value) {
		value = value[index+1:]
	}
	count := 0
	for _, field := range strings.Fields(value) {
		trimmed := strings.TrimFunc(field, func(r rune) bool { return !unicode.IsLetter(r) })
		if len(trimmed) >= 2 {
			count++
		}
	}
	return count
}

func containsPaymentCardNumber(value string) bool {
	digits := make([]byte, 0, 19)
	flush := func() bool {
		if len(digits) < 13 || len(digits) > 19 {
			digits = digits[:0]
			return false
		}
		valid := luhnValid(digits)
		digits = digits[:0]
		return valid
	}
	for index := 0; index < len(value); index++ {
		char := value[index]
		switch {
		case char >= '0' && char <= '9':
			digits = append(digits, char)
			if len(digits) > 19 {
				digits = digits[:0]
			}
		case char == ' ' || char == '-':
			if len(digits) == 0 {
				continue
			}
		default:
			if flush() {
				return true
			}
		}
	}
	return flush()
}

func luhnValid(digits []byte) bool {
	sum := 0
	parity := len(digits) % 2
	for index, digit := range digits {
		value := int(digit - '0')
		if index%2 == parity {
			value *= 2
			if value > 9 {
				value -= 9
			}
		}
		sum += value
	}
	return sum > 0 && sum%10 == 0
}
