package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
)

func openParticipationConfig(path, pin, governance, chain, dataDir string) (*participation.Service, error) {
	if path == "" && pin == "" {
		return nil, nil
	}
	if !filepath.IsAbs(path) {
		return nil, errors.New("independent absolute participation config required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > 16<<10 || info.Mode().Perm()&0022 != 0 {
		return nil, errors.New("unsafe participation config")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != pin {
		return nil, errors.New("independent participation config pin mismatch")
	}
	var config struct {
		Version string                `json:"version"`
		Network participation.Network `json:"network"`
	}
	if err := nativeDecode(raw, &config); err != nil {
		return nil, err
	}
	if config.Version != "YNX-NETWORK-PARTICIPATION-CONFIG/v1" {
		return nil, errors.New("unsupported independent network config")
	}
	reader, err := participation.NewHTTPReader(governance, chain, config.Network, nil)
	if err != nil {
		return nil, err
	}
	// An authenticated OS peer may prepare local handoff metadata. It is never
	// substituted for the original Wallet publisher or its visible approval.
	return participation.New(filepath.Join(dataDir, "participation.json"), reader, nil)
}
