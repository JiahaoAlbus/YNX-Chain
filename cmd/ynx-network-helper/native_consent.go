package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/nativeconsent"
)

// Only the QA builder supplies this pin. Neither HTTP, native requests, task
// packets nor runtime flags can choose the native producer executable.
var nativeConsentSHA256 string
var nativeConsentInfoSHA256 string

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
	producer, err := nativeconsent.NewBundled(filepath.Join(filepath.Dir(exe), nativeconsent.BundleName, "Contents", "MacOS", "ynx-network-native-consent"), nativeConsentSHA256, nativeConsentInfoSHA256, locale, theme)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err = producer.ReadIdentity(ctx); err != nil {
		_ = producer.Close()
		return nil, err
	}
	return producer, nil
}
