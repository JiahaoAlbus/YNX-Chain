package social

import (
	"unicode"
	"unicode/utf8"
)

func validContactMessage(message string) bool {
	if !utf8.ValidString(message) || utf8.RuneCountInString(message) > 200 {
		return false
	}
	for _, character := range message {
		if unicode.IsControl(character) && character != '\n' && character != '\t' {
			return false
		}
	}
	return true
}
