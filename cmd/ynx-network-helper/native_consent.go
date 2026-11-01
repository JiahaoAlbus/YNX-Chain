package main

import (
	"os"
	"path/filepath"
	"runtime"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/nativeconsent"
)

// Only the QA builder supplies this pin. Neither HTTP, native requests, task
// packets nor runtime flags can choose the native producer executable.
var nativeConsentSHA256 string

func openNativeConsent(locale, theme string) (*nativeconsent.Producer, error) {
	if nativeConsentSHA256 == "" {
		return nil, nil
	}
	if runtime.GOOS != "darwin" {
		return nil, nativeconsent.ErrUnavailable
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return nil, err
	}
	return nativeconsent.New(filepath.Join(filepath.Dir(exe), "ynx-network-native-consent"), nativeConsentSHA256, locale, theme)
}
