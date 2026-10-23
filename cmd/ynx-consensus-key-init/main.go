package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func main() {
	mode := flag.String("mode", "create", "create new host-local keys or inspect existing keys")
	role := flag.String("role", "", "approved production validator role")
	keyDir := flag.String("key-dir", "", "host-local private key directory")
	publicRecord := flag.String("public-record", "", "non-secret public ceremony record output")
	acknowledge := flag.Bool("owner-controlled", false, "required acknowledgement that private keys remain on the owner-controlled host")
	flag.Parse()
	if !*acknowledge {
		fmt.Fprintln(os.Stderr, "-owner-controlled acknowledgement is required")
		os.Exit(1)
	}
	for label, value := range map[string]string{"-role": *role, "-key-dir": *keyDir, "-public-record": *publicRecord} {
		if strings.TrimSpace(value) == "" {
			fmt.Fprintf(os.Stderr, "%s is required\n", label)
			os.Exit(1)
		}
	}
	var record consensus.ProductionKeyCeremonyRecord
	var err error
	switch *mode {
	case "create":
		record, err = consensus.InitializeProductionKeyFiles(*role, *keyDir, *publicRecord)
	case "inspect":
		record, err = consensus.ReadProductionKeyRecord(*role, *keyDir)
		if err == nil {
			err = writePublicRecord(*publicRecord, record)
		}
	default:
		err = fmt.Errorf("unsupported key ceremony mode %q", *mode)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("production key ceremony public record ready: role=%s validator=%s consensusAddress=%s nodeId=%s privateKeysRemainOnHost=true\n", record.Role, record.ValidatorAddress, record.ConsensusAddress, record.NodeID)
}

func writePublicRecord(path string, record consensus.ProductionKeyCeremonyRecord) error {
	payload, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	// Inspection is read-only custody recovery, not permission to replace an
	// existing public record, private key, H/R/S file or symlink target. Only
	// this successful O_EXCL create gives us ownership of the new output.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	writeErr := persistPublicRecordFile(f, append(payload, '\n'))
	// Even a failed/partial write must retain its original directory entry when
	// possible. Never remove it or retry by truncating the same output.
	directoryErr := syncPublicRecordDirectory(filepath.Dir(path))
	if err := errors.Join(writeErr, directoryErr); err != nil {
		return fmt.Errorf("new public ceremony record retained; inspect the original output and do not overwrite or automatically retry: %w", err)
	}
	return nil
}

// This narrow I/O boundary lets focused tests exercise actual partial public
// file writes. It cannot select a key, create a record, grant authority or retry.
type publicRecordFile interface {
	Write([]byte) (int, error)
	Sync() error
	Close() error
}

func persistPublicRecordFile(f publicRecordFile, payload []byte) error {
	n, writeErr := f.Write(payload)
	if writeErr == nil && n != len(payload) {
		writeErr = io.ErrShortWrite
	}
	return errors.Join(writeErr, f.Sync(), f.Close())
}

func syncPublicRecordDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(directory.Sync(), directory.Close())
}
