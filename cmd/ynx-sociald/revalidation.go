package main

import (
	"errors"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/JiahaoAlbus/YNX-Chain/internal/social"
)

const socialRevalidationConfigMessage = "Social revalidation configuration invalid; require paired YNX_SOCIAL_REVALIDATION_KEY_ID and YNX_SOCIAL_REVALIDATION_PRIVATE_KEY_FILE"

// Only the approved shared loader opens/validates protected key files. This
// adapter does not generate credentials or disclose key/path/upstream errors.
func loadSocialRevalidator(web *productsessionv2.Client, keyID, keyFile string) (social.MatrixAudienceSessionRevalidator, error) {
	if keyID == "" && keyFile == "" {
		return nil, nil
	}
	invalid := func() (social.MatrixAudienceSessionRevalidator, error) {
		return nil, errors.New(socialRevalidationConfigMessage)
	}
	if keyID == "" || keyFile == "" || strings.TrimSpace(keyID) != keyID || strings.TrimSpace(keyFile) != keyFile {
		return invalid()
	}
	key, err := productsessionv2.LoadBackendEd25519PrivateKey(keyFile)
	if err != nil {
		return invalid()
	}
	defer clear(key)
	reader, err := productsessionv2.NewRevalidator(web, keyID, key)
	if err != nil || reader == nil {
		return invalid()
	}
	return reader, nil
}
