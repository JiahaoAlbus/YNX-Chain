package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
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
	if err := os.WriteFile(path, append(payload, '\n'), 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}
