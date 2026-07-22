package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/governance"
)

func main() {
	action := flag.String("action", "verify", "verify, backup, or restore governance state")
	configPath := flag.String("config", "", "absolute runtime config path")
	backupDir := flag.String("backup-dir", "", "absolute backup output directory")
	backupPath := flag.String("backup", "", "absolute backup artifact path")
	recordPath := flag.String("record", "", "absolute backup record path")
	flag.Parse()
	if *configPath == "" {
		log.Fatal("--config is required")
	}
	cfg, err := governance.LoadRuntimeConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	policy, _, err := governance.ValidateRuntimeConfig(cfg)
	if err != nil {
		log.Fatal(err)
	}
	switch *action {
	case "verify":
		service, err := governance.Load(cfg.StatePath)
		if err != nil {
			log.Fatal(err)
		}
		encoded, _ := json.Marshal(service.Health(time.Now().UTC()))
		fmt.Println(string(encoded))
	case "backup":
		if *backupDir == "" {
			log.Fatal("--backup-dir is required")
		}
		record, err := governance.Backup(cfg.StatePath, *backupDir, time.Now().UTC())
		if err != nil {
			log.Fatal(err)
		}
		encoded, _ := json.Marshal(record)
		fmt.Println(string(encoded))
	case "restore":
		if *backupPath == "" || *recordPath == "" {
			log.Fatal("--backup and --record are required")
		}
		preserved, err := governance.Restore(*backupPath, *recordPath, cfg.StatePath, policy, time.Now().UTC())
		if err != nil {
			log.Fatal(err)
		}
		encoded, _ := json.Marshal(map[string]string{"restored": cfg.StatePath, "preservedPrevious": preserved})
		fmt.Println(string(encoded))
	default:
		log.Printf("unsupported --action %q", *action)
		os.Exit(2)
	}
}
