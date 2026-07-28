package dex

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const RecoveryBundleSchemaVersion = 1

type RecoveryBindings struct {
	Factory       string `json:"factory"`
	StableFactory string `json:"stableFactory,omitempty"`
	StrategyVault string `json:"strategyVault,omitempty"`
	FairFlow      string `json:"fairFlow,omitempty"`
	LPProtection  string `json:"lpProtection,omitempty"`
	StartBlock    uint64 `json:"startBlock"`
}

type RecoveryArtifact struct {
	File   string `json:"file"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
	Mode   string `json:"mode"`
}

type RecoverySnapshot struct {
	StateSchemaVersion       int    `json:"stateSchemaVersion"`
	CursorSchemaVersion      int    `json:"cursorSchemaVersion"`
	Sequence                 uint64 `json:"sequence"`
	Events                   int    `json:"events"`
	FairFlowEvents           int    `json:"fairFlowEvents"`
	LPProtectionEvents       int    `json:"lpProtectionEvents"`
	LatestStateBlock         uint64 `json:"latestStateBlock"`
	RecoveryPointNextBlock   uint64 `json:"recoveryPointNextBlock"`
	RecoveryPointBlockHash   string `json:"recoveryPointBlockHash,omitempty"`
	ReplayRequired           bool   `json:"replayRequired"`
	ReplayFromBlock          uint64 `json:"replayFromBlock,omitempty"`
	PointInTimeRPOEvents     uint64 `json:"pointInTimeRpoEvents"`
	PointInTimeRPOBlocks     uint64 `json:"pointInTimeRpoBlocks"`
	OperationalRPOProven     bool   `json:"operationalRpoProven"`
	QuiescedSnapshotRequired bool   `json:"quiescedSnapshotRequired"`
}

type RecoveryManifest struct {
	SchemaVersion  int              `json:"schemaVersion"`
	ProductID      string           `json:"productId"`
	ChainID        uint64           `json:"chainId"`
	BundleID       string           `json:"bundleId"`
	SourceCommit   string           `json:"sourceCommit"`
	CreatedAt      time.Time        `json:"createdAt"`
	Bindings       RecoveryBindings `json:"bindings"`
	State          RecoveryArtifact `json:"state"`
	Cursor         RecoveryArtifact `json:"cursor"`
	Snapshot       RecoverySnapshot `json:"snapshot"`
	Classification string           `json:"classification"`
}

type recoveryManifestEnvelope struct {
	Manifest  RecoveryManifest `json:"manifest"`
	Integrity string           `json:"integrity"`
}

type RecoveryBundleConfig struct {
	StatePath    string
	CursorPath   string
	BundleDir    string
	StateSecret  []byte
	CursorSecret []byte
	BundleSecret []byte
	SourceCommit string
	Bindings     RecoveryBindings
	CreatedAt    time.Time
}

type RecoveryRestoreConfig struct {
	BundleDir    string
	StatePath    string
	CursorPath   string
	StateSecret  []byte
	CursorSecret []byte
	BundleSecret []byte
	SourceCommit string
	Bindings     RecoveryBindings
}

type RecoveryDrillConfig struct {
	Bundle  RecoveryBundleConfig
	Restore RecoveryRestoreConfig
}

type RecoveryDrillReport struct {
	SchemaVersion              int       `json:"schemaVersion"`
	ProductID                  string    `json:"productId"`
	SourceCommit               string    `json:"sourceCommit"`
	BundleID                   string    `json:"bundleId"`
	StartedAt                  time.Time `json:"startedAt"`
	CompletedAt                time.Time `json:"completedAt"`
	BackupDurationMillis       int64     `json:"backupDurationMillis"`
	RestoreDurationMillis      int64     `json:"restoreDurationMillis"`
	VerificationDurationMillis int64     `json:"verificationDurationMillis"`
	ObservedRTOMillis          int64     `json:"observedRtoMillis"`
	PointInTimeRPOEvents       uint64    `json:"pointInTimeRpoEvents"`
	PointInTimeRPOBlocks       uint64    `json:"pointInTimeRpoBlocks"`
	OperationalRPOProven       bool      `json:"operationalRpoProven"`
	RecoveryPointNextBlock     uint64    `json:"recoveryPointNextBlock"`
	StateSHA256                string    `json:"stateSha256"`
	CursorSHA256               string    `json:"cursorSha256"`
	StateBytes                 int64     `json:"stateBytes"`
	CursorBytes                int64     `json:"cursorBytes"`
	IntegrityVerified          bool      `json:"integrityVerified"`
	SemanticEqualityVerified   bool      `json:"semanticEqualityVerified"`
	Status                     string    `json:"status"`
	Classification             string    `json:"classification"`
}

type recoveryFileSnapshot struct {
	path string
	data []byte
	info os.FileInfo
	hash string
}

func CreateRecoveryBundle(config RecoveryBundleConfig) (RecoveryManifest, error) {
	config.Bindings = normalizeRecoveryBindings(config.Bindings)
	if err := validateRecoveryInputs(config); err != nil {
		return RecoveryManifest{}, err
	}
	createdAt := config.CreatedAt.UTC()
	if config.CreatedAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	stateFile, err := readStableRecoveryFile(config.StatePath)
	if err != nil {
		return RecoveryManifest{}, fmt.Errorf("read DEX state snapshot: %w", err)
	}
	cursorFile, err := readStableRecoveryFile(config.CursorPath)
	if err != nil {
		return RecoveryManifest{}, fmt.Errorf("read EVM cursor snapshot: %w", err)
	}
	state, err := validateStoreRecoverySnapshot(stateFile.data, config.StateSecret)
	if err != nil {
		return RecoveryManifest{}, err
	}
	cursor, err := validateCursorRecoverySnapshot(cursorFile.data, config.CursorSecret, config.Bindings)
	if err != nil {
		return RecoveryManifest{}, err
	}
	if err := ensureRecoveryFilesUnchanged(stateFile, cursorFile); err != nil {
		return RecoveryManifest{}, err
	}
	latestBlock := latestStoreBlock(state)
	replayRequired := latestBlock >= cursor.NextBlock
	if replayRequired && cursor.LastBlockHash != "" {
		return RecoveryManifest{}, errors.New("DEX state is not consistent with the durable EVM cursor")
	}
	snapshot := RecoverySnapshot{
		StateSchemaVersion:       state.SchemaVersion,
		CursorSchemaVersion:      cursor.SchemaVersion,
		Sequence:                 state.Sequence,
		Events:                   len(state.Events),
		FairFlowEvents:           len(state.FairFlowEvents),
		LPProtectionEvents:       len(state.LPProtectionEvents),
		LatestStateBlock:         latestBlock,
		RecoveryPointNextBlock:   cursor.NextBlock,
		RecoveryPointBlockHash:   strings.ToLower(cursor.LastBlockHash),
		ReplayRequired:           replayRequired,
		PointInTimeRPOEvents:     0,
		PointInTimeRPOBlocks:     0,
		OperationalRPOProven:     false,
		QuiescedSnapshotRequired: true,
	}
	if replayRequired {
		snapshot.ReplayFromBlock = cursor.NextBlock
	}
	manifest := RecoveryManifest{
		SchemaVersion:  RecoveryBundleSchemaVersion,
		ProductID:      "ynx-dex-indexer",
		ChainID:        ChainID,
		SourceCommit:   config.SourceCommit,
		CreatedAt:      createdAt,
		Bindings:       config.Bindings,
		State:          recoveryArtifact("state.json", stateFile),
		Cursor:         recoveryArtifact("cursor.json", cursorFile),
		Snapshot:       snapshot,
		Classification: "offline-point-in-time-hmac-authenticated-recovery-bundle",
	}
	manifest.BundleID = recoveryBundleID(manifest)
	if err := os.MkdirAll(filepath.Dir(config.BundleDir), 0o700); err != nil {
		return RecoveryManifest{}, fmt.Errorf("create recovery bundle parent: %w", err)
	}
	if err := os.Mkdir(config.BundleDir, 0o700); err != nil {
		return RecoveryManifest{}, fmt.Errorf("create immutable recovery bundle directory: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(config.BundleDir)
		}
	}()
	if err := writeExclusiveSynced(filepath.Join(config.BundleDir, manifest.State.File), stateFile.data); err != nil {
		return RecoveryManifest{}, fmt.Errorf("write recovery state: %w", err)
	}
	if err := writeExclusiveSynced(filepath.Join(config.BundleDir, manifest.Cursor.File), cursorFile.data); err != nil {
		return RecoveryManifest{}, fmt.Errorf("write recovery cursor: %w", err)
	}
	envelope := recoveryManifestEnvelope{Manifest: manifest, Integrity: recoveryManifestIntegrity(manifest, config.BundleSecret)}
	manifestData, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return RecoveryManifest{}, err
	}
	if err := writeExclusiveSynced(filepath.Join(config.BundleDir, "manifest.json"), manifestData); err != nil {
		return RecoveryManifest{}, fmt.Errorf("write recovery manifest: %w", err)
	}
	if err := syncDirectory(config.BundleDir); err != nil {
		return RecoveryManifest{}, fmt.Errorf("sync recovery bundle directory: %w", err)
	}
	verified, err := VerifyRecoveryBundle(RecoveryRestoreConfig{
		BundleDir:    config.BundleDir,
		StateSecret:  config.StateSecret,
		CursorSecret: config.CursorSecret,
		BundleSecret: config.BundleSecret,
		SourceCommit: config.SourceCommit,
		Bindings:     config.Bindings,
	})
	if err != nil {
		return RecoveryManifest{}, fmt.Errorf("verify created recovery bundle: %w", err)
	}
	if verified.BundleID != manifest.BundleID {
		return RecoveryManifest{}, errors.New("created recovery bundle identity changed during verification")
	}
	cleanup = false
	return manifest, nil
}

func VerifyRecoveryBundle(config RecoveryRestoreConfig) (RecoveryManifest, error) {
	config.Bindings = normalizeRecoveryBindings(config.Bindings)
	if err := validateRecoverySecrets(config.StateSecret, config.CursorSecret, config.BundleSecret); err != nil {
		return RecoveryManifest{}, err
	}
	if strings.TrimSpace(config.BundleDir) == "" {
		return RecoveryManifest{}, errors.New("recovery bundle directory is required")
	}
	bundleInfo, err := os.Lstat(config.BundleDir)
	if err != nil {
		return RecoveryManifest{}, err
	}
	if !bundleInfo.IsDir() || bundleInfo.Mode()&os.ModeSymlink != 0 || bundleInfo.Mode().Perm() != 0o700 {
		return RecoveryManifest{}, errors.New("recovery bundle must be a private non-symlink directory")
	}
	manifestData, err := readRecoveryBundleFile(config.BundleDir, "manifest.json")
	if err != nil {
		return RecoveryManifest{}, err
	}
	var envelope recoveryManifestEnvelope
	if err := decodeExact(manifestData, &envelope); err != nil {
		return RecoveryManifest{}, fmt.Errorf("decode recovery manifest: %w", err)
	}
	manifest := envelope.Manifest
	if manifest.SchemaVersion != RecoveryBundleSchemaVersion || manifest.ProductID != "ynx-dex-indexer" || manifest.ChainID != ChainID || !validLowerHex(manifest.SourceCommit, 20) || !validPrefixedHex(manifest.BundleID, 32) {
		return RecoveryManifest{}, errors.New("recovery manifest identity is invalid")
	}
	if !hmac.Equal([]byte(envelope.Integrity), []byte(recoveryManifestIntegrity(manifest, config.BundleSecret))) {
		return RecoveryManifest{}, errors.New("recovery manifest integrity verification failed")
	}
	if config.SourceCommit != "" && manifest.SourceCommit != config.SourceCommit {
		return RecoveryManifest{}, errors.New("recovery source commit mismatch")
	}
	if config.Bindings.StartBlock != 0 && !recoveryBindingsEqual(manifest.Bindings, config.Bindings) {
		return RecoveryManifest{}, errors.New("recovery manifest deployment binding mismatch")
	}
	if manifest.BundleID != recoveryBundleID(manifest) {
		return RecoveryManifest{}, errors.New("recovery bundle identifier mismatch")
	}
	stateData, err := readRecoveryBundleFile(config.BundleDir, manifest.State.File)
	if err != nil {
		return RecoveryManifest{}, err
	}
	cursorData, err := readRecoveryBundleFile(config.BundleDir, manifest.Cursor.File)
	if err != nil {
		return RecoveryManifest{}, err
	}
	if err := validateRecoveryArtifact(manifest.State, stateData, "state.json"); err != nil {
		return RecoveryManifest{}, err
	}
	if err := validateRecoveryArtifact(manifest.Cursor, cursorData, "cursor.json"); err != nil {
		return RecoveryManifest{}, err
	}
	state, err := validateStoreRecoverySnapshot(stateData, config.StateSecret)
	if err != nil {
		return RecoveryManifest{}, err
	}
	cursor, err := validateCursorRecoverySnapshot(cursorData, config.CursorSecret, manifest.Bindings)
	if err != nil {
		return RecoveryManifest{}, err
	}
	if err := validateRecoverySnapshotMetadata(manifest.Snapshot, state, cursor); err != nil {
		return RecoveryManifest{}, err
	}
	return manifest, nil
}

func RestoreRecoveryBundle(config RecoveryRestoreConfig) (RecoveryManifest, error) {
	if strings.TrimSpace(config.StatePath) == "" || strings.TrimSpace(config.CursorPath) == "" {
		return RecoveryManifest{}, errors.New("restored state and cursor paths are required")
	}
	if samePath(config.StatePath, config.CursorPath) {
		return RecoveryManifest{}, errors.New("restored state and cursor paths must be distinct")
	}
	manifest, err := VerifyRecoveryBundle(config)
	if err != nil {
		return RecoveryManifest{}, err
	}
	stateData, err := readRecoveryBundleFile(config.BundleDir, manifest.State.File)
	if err != nil {
		return RecoveryManifest{}, err
	}
	cursorData, err := readRecoveryBundleFile(config.BundleDir, manifest.Cursor.File)
	if err != nil {
		return RecoveryManifest{}, err
	}
	if err := restoreRecoveryPair(config.StatePath, stateData, config.CursorPath, cursorData); err != nil {
		return RecoveryManifest{}, err
	}
	restoredState, err := readStableRecoveryFile(config.StatePath)
	if err != nil {
		return RecoveryManifest{}, fmt.Errorf("read restored state: %w", err)
	}
	restoredCursor, err := readStableRecoveryFile(config.CursorPath)
	if err != nil {
		return RecoveryManifest{}, fmt.Errorf("read restored cursor: %w", err)
	}
	if restoredState.hash != manifest.State.SHA256 || restoredCursor.hash != manifest.Cursor.SHA256 {
		return RecoveryManifest{}, errors.New("restored recovery artifact hash mismatch")
	}
	if _, err := validateStoreRecoverySnapshot(restoredState.data, config.StateSecret); err != nil {
		return RecoveryManifest{}, err
	}
	if _, err := validateCursorRecoverySnapshot(restoredCursor.data, config.CursorSecret, manifest.Bindings); err != nil {
		return RecoveryManifest{}, err
	}
	return manifest, nil
}

func RunRecoveryDrill(config RecoveryDrillConfig) (RecoveryDrillReport, error) {
	if strings.TrimSpace(config.Restore.StatePath) == "" || strings.TrimSpace(config.Restore.CursorPath) == "" {
		return RecoveryDrillReport{}, errors.New("recovery drill destination paths are required")
	}
	started := time.Now().UTC()
	backupStart := time.Now()
	manifest, err := CreateRecoveryBundle(config.Bundle)
	if err != nil {
		return RecoveryDrillReport{}, err
	}
	backupDuration := time.Since(backupStart)
	restoreStart := time.Now()
	restoredManifest, err := RestoreRecoveryBundle(config.Restore)
	if err != nil {
		return RecoveryDrillReport{}, err
	}
	restoreDuration := time.Since(restoreStart)
	verifyStart := time.Now()
	store, err := OpenStore(config.Restore.StatePath, config.Restore.StateSecret)
	if err != nil {
		return RecoveryDrillReport{}, fmt.Errorf("open restored DEX state: %w", err)
	}
	cursorFile, err := readStableRecoveryFile(config.Restore.CursorPath)
	if err != nil {
		return RecoveryDrillReport{}, err
	}
	cursor, err := validateCursorRecoverySnapshot(cursorFile.data, config.Restore.CursorSecret, manifest.Bindings)
	if err != nil {
		return RecoveryDrillReport{}, err
	}
	semanticEqual := uint64(len(store.Events())+len(store.FairFlowEvents(""))+len(store.LPProtectionEvents("", ""))) == manifest.Snapshot.Sequence && cursor.NextBlock == manifest.Snapshot.RecoveryPointNextBlock
	if !semanticEqual || restoredManifest.BundleID != manifest.BundleID {
		return RecoveryDrillReport{}, errors.New("restored DEX state and cursor are not semantically equal to the recovery snapshot")
	}
	verificationDuration := time.Since(verifyStart)
	completed := time.Now().UTC()
	report := RecoveryDrillReport{}
	report.SchemaVersion = RecoveryBundleSchemaVersion
	report.ProductID = "ynx-dex-indexer"
	report.SourceCommit = manifest.SourceCommit
	report.BundleID = manifest.BundleID
	report.StartedAt = started
	report.CompletedAt = completed
	report.BackupDurationMillis = durationMillis(backupDuration)
	report.RestoreDurationMillis = durationMillis(restoreDuration)
	report.VerificationDurationMillis = durationMillis(verificationDuration)
	report.ObservedRTOMillis = durationMillis(restoreDuration + verificationDuration)
	report.PointInTimeRPOEvents = manifest.Snapshot.PointInTimeRPOEvents
	report.PointInTimeRPOBlocks = manifest.Snapshot.PointInTimeRPOBlocks
	report.OperationalRPOProven = false
	report.RecoveryPointNextBlock = manifest.Snapshot.RecoveryPointNextBlock
	report.StateSHA256 = manifest.State.SHA256
	report.CursorSHA256 = manifest.Cursor.SHA256
	report.StateBytes = manifest.State.Bytes
	report.CursorBytes = manifest.Cursor.Bytes
	report.IntegrityVerified = true
	report.SemanticEqualityVerified = true
	report.Status = "pass"
	report.Classification = "local-offline-point-in-time-recovery-drill; observed timing is not a production SLO"
	return report, nil
}

func validateRecoveryInputs(config RecoveryBundleConfig) error {
	if strings.TrimSpace(config.StatePath) == "" || strings.TrimSpace(config.CursorPath) == "" || strings.TrimSpace(config.BundleDir) == "" {
		return errors.New("state, cursor and recovery bundle paths are required")
	}
	if samePath(config.StatePath, config.CursorPath) || samePath(config.StatePath, config.BundleDir) || samePath(config.CursorPath, config.BundleDir) {
		return errors.New("state, cursor and recovery bundle paths must be distinct")
	}
	if err := validateRecoverySecrets(config.StateSecret, config.CursorSecret, config.BundleSecret); err != nil {
		return err
	}
	if !validLowerHex(config.SourceCommit, 20) {
		return errors.New("recovery source commit must be an exact lowercase Git SHA")
	}
	return validateRecoveryBindings(config.Bindings)
}

func validateRecoverySecrets(stateSecret, cursorSecret, bundleSecret []byte) error {
	if len(stateSecret) < 32 || len(cursorSecret) < 32 || len(bundleSecret) < 32 {
		return errors.New("state, cursor and recovery bundle HMAC secrets must each contain at least 32 bytes")
	}
	return nil
}

func validateRecoveryBindings(bindings RecoveryBindings) error {
	if bindings.StartBlock == 0 || !validRecoveryAddress(bindings.Factory) {
		return errors.New("recovery binding requires a valid Factory and positive start block")
	}
	values := []string{bindings.Factory, bindings.StableFactory, bindings.StrategyVault, bindings.FairFlow, bindings.LPProtection}
	seen := map[string]struct{}{}
	for _, value := range values {
		if value == "" {
			continue
		}
		if !validRecoveryAddress(value) {
			return errors.New("recovery binding contains an invalid address")
		}
		if _, exists := seen[value]; exists {
			return errors.New("recovery binding addresses must be distinct")
		}
		seen[value] = struct{}{}
	}
	return nil
}

func normalizeRecoveryBindings(bindings RecoveryBindings) RecoveryBindings {
	bindings.Factory = strings.ToLower(strings.TrimSpace(bindings.Factory))
	bindings.StableFactory = strings.ToLower(strings.TrimSpace(bindings.StableFactory))
	bindings.StrategyVault = strings.ToLower(strings.TrimSpace(bindings.StrategyVault))
	bindings.FairFlow = strings.ToLower(strings.TrimSpace(bindings.FairFlow))
	bindings.LPProtection = strings.ToLower(strings.TrimSpace(bindings.LPProtection))
	return bindings
}

func recoveryBindingsEqual(left, right RecoveryBindings) bool {
	return normalizeRecoveryBindings(left) == normalizeRecoveryBindings(right)
}

func validRecoveryAddress(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return addressPattern.MatchString(value) && strings.Trim(value[2:], "0") != ""
}

func validLowerHex(value string, bytesLength int) bool {
	if len(value) != bytesLength*2 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == bytesLength
}

func validPrefixedHex(value string, bytesLength int) bool {
	if !strings.HasPrefix(value, "0x") {
		return false
	}
	return validLowerHex(value[2:], bytesLength)
}

func validateStoreRecoverySnapshot(data, secret []byte) (storePayload, error) {
	var envelope storeEnvelope
	if err := decodeExact(data, &envelope); err != nil {
		return storePayload{}, fmt.Errorf("decode recovery DEX state: %w", err)
	}
	checker := &Store{secret: append([]byte(nil), secret...)}
	if envelope.Payload.SchemaVersion != 5 || !hmac.Equal([]byte(envelope.Integrity), []byte(checker.integrity(envelope.Payload))) {
		return storePayload{}, errors.New("recovery DEX state integrity verification failed")
	}
	for _, event := range envelope.Payload.Events {
		if err := event.Validate(); err != nil {
			return storePayload{}, fmt.Errorf("invalid recovery event: %w", err)
		}
	}
	for _, event := range envelope.Payload.FairFlowEvents {
		if err := event.Validate(); err != nil {
			return storePayload{}, fmt.Errorf("invalid recovery FairFlow event: %w", err)
		}
	}
	for _, event := range envelope.Payload.LPProtectionEvents {
		if err := event.Validate(); err != nil {
			return storePayload{}, fmt.Errorf("invalid recovery LP protection event: %w", err)
		}
	}
	total := len(envelope.Payload.Events) + len(envelope.Payload.FairFlowEvents) + len(envelope.Payload.LPProtectionEvents)
	if envelope.Payload.Sequence != uint64(total) {
		return storePayload{}, errors.New("recovery DEX state sequence mismatch")
	}
	return envelope.Payload, nil
}

func validateCursorRecoverySnapshot(data, secret []byte, bindings RecoveryBindings) (pollCursor, error) {
	var envelope cursorEnvelope
	if err := decodeExact(data, &envelope); err != nil {
		return pollCursor{}, fmt.Errorf("decode recovery EVM cursor: %w", err)
	}
	payload, _ := json.Marshal(envelope.Cursor)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(payload)
	if envelope.Cursor.SchemaVersion != 6 || envelope.Cursor.NextBlock < bindings.StartBlock || !strings.EqualFold(envelope.Cursor.Factory, bindings.Factory) || !hmac.Equal([]byte(envelope.Integrity), []byte(hex.EncodeToString(mac.Sum(nil)))) {
		return pollCursor{}, errors.New("recovery EVM cursor integrity verification failed")
	}
	if !strings.EqualFold(envelope.Cursor.StrategyVault, bindings.StrategyVault) || !strings.EqualFold(envelope.Cursor.FairFlow, bindings.FairFlow) || !strings.EqualFold(envelope.Cursor.LPProtection, bindings.LPProtection) || !strings.EqualFold(envelope.Cursor.StableFactory, bindings.StableFactory) {
		return pollCursor{}, errors.New("recovery EVM cursor deployment binding mismatch")
	}
	if envelope.Cursor.LastBlockHash != "" && !hashPattern.MatchString(envelope.Cursor.LastBlockHash) {
		return pollCursor{}, errors.New("recovery EVM cursor block hash is invalid")
	}
	for _, pool := range envelope.Cursor.Pools {
		if !validRecoveryAddress(pool.Address) || !validRecoveryAddress(pool.Token0) || !validRecoveryAddress(pool.Token1) || pool.CreatedBlock < bindings.StartBlock || !isPoolContractVersion(pool.ContractVersion) || pool.SwapFeeBps == 0 || pool.SwapFeeBps > 100 {
			return pollCursor{}, errors.New("recovery EVM cursor contains an invalid typed pool")
		}
	}
	return envelope.Cursor, nil
}

func validateRecoverySnapshotMetadata(snapshot RecoverySnapshot, state storePayload, cursor pollCursor) error {
	latestBlock := latestStoreBlock(state)
	replayRequired := latestBlock >= cursor.NextBlock
	if snapshot.StateSchemaVersion != state.SchemaVersion || snapshot.CursorSchemaVersion != cursor.SchemaVersion || snapshot.Sequence != state.Sequence || snapshot.Events != len(state.Events) || snapshot.FairFlowEvents != len(state.FairFlowEvents) || snapshot.LPProtectionEvents != len(state.LPProtectionEvents) || snapshot.LatestStateBlock != latestBlock || snapshot.RecoveryPointNextBlock != cursor.NextBlock || !strings.EqualFold(snapshot.RecoveryPointBlockHash, cursor.LastBlockHash) || snapshot.ReplayRequired != replayRequired || snapshot.PointInTimeRPOEvents != 0 || snapshot.PointInTimeRPOBlocks != 0 || snapshot.OperationalRPOProven || !snapshot.QuiescedSnapshotRequired {
		return errors.New("recovery manifest snapshot metadata mismatch")
	}
	if replayRequired {
		if snapshot.ReplayFromBlock != cursor.NextBlock || cursor.LastBlockHash != "" {
			return errors.New("recovery replay boundary is invalid")
		}
	} else if snapshot.ReplayFromBlock != 0 {
		return errors.New("recovery replay boundary is unexpectedly set")
	}
	return nil
}

func latestStoreBlock(state storePayload) uint64 {
	var latest uint64
	for _, event := range state.Events {
		if event.BlockNumber > latest {
			latest = event.BlockNumber
		}
	}
	for _, event := range state.FairFlowEvents {
		if event.BlockNumber > latest {
			latest = event.BlockNumber
		}
	}
	for _, event := range state.LPProtectionEvents {
		if event.BlockNumber > latest {
			latest = event.BlockNumber
		}
	}
	return latest
}

func readStableRecoveryFile(path string) (recoveryFileSnapshot, error) {
	before, err := os.Lstat(path)
	if err != nil {
		return recoveryFileSnapshot{}, err
	}
	if !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 || before.Mode().Perm()&0o077 != 0 {
		return recoveryFileSnapshot{}, errors.New("recovery source must be a private regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return recoveryFileSnapshot{}, err
	}
	after, err := os.Lstat(path)
	if err != nil {
		return recoveryFileSnapshot{}, err
	}
	if !os.SameFile(before, after) || before.Size() != int64(len(data)) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return recoveryFileSnapshot{}, errors.New("recovery source changed while it was read; stop the Indexer and retry")
	}
	digest := sha256.Sum256(data)
	return recoveryFileSnapshot{path: path, data: data, info: after, hash: hex.EncodeToString(digest[:])}, nil
}

func ensureRecoveryFilesUnchanged(files ...recoveryFileSnapshot) error {
	for _, file := range files {
		current, err := os.Lstat(file.path)
		if err != nil {
			return err
		}
		if !os.SameFile(file.info, current) || file.info.Size() != current.Size() || !file.info.ModTime().Equal(current.ModTime()) {
			return errors.New("recovery source changed during the snapshot window; stop the Indexer and retry")
		}
	}
	return nil
}

func recoveryArtifact(file string, snapshot recoveryFileSnapshot) RecoveryArtifact {
	return RecoveryArtifact{File: file, SHA256: snapshot.hash, Bytes: int64(len(snapshot.data)), Mode: "0600"}
}

func validateRecoveryArtifact(artifact RecoveryArtifact, data []byte, expectedFile string) error {
	if artifact.File != expectedFile || !validLowerHex(artifact.SHA256, 32) || artifact.Bytes != int64(len(data)) || artifact.Mode != "0600" {
		return errors.New("recovery artifact metadata is invalid")
	}
	digest := sha256.Sum256(data)
	if artifact.SHA256 != hex.EncodeToString(digest[:]) {
		return errors.New("recovery artifact hash mismatch")
	}
	return nil
}

func recoveryBundleID(manifest RecoveryManifest) string {
	payload := strings.Join([]string{
		manifest.SourceCommit,
		manifest.State.SHA256,
		manifest.Cursor.SHA256,
		manifest.CreatedAt.UTC().Format(time.RFC3339Nano),
		fmt.Sprintf("%d", manifest.Snapshot.RecoveryPointNextBlock),
	}, "|")
	digest := sha256.Sum256([]byte(payload))
	return "0x" + hex.EncodeToString(digest[:])
}

func recoveryManifestIntegrity(manifest RecoveryManifest, secret []byte) string {
	payload, _ := json.Marshal(manifest)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

func readRecoveryBundleFile(bundleDir, file string) ([]byte, error) {
	if file != "manifest.json" && file != "state.json" && file != "cursor.json" {
		return nil, errors.New("recovery bundle contains an unexpected file name")
	}
	path := filepath.Join(bundleDir, file)
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o600 {
		return nil, errors.New("recovery bundle files must be private regular files")
	}
	return os.ReadFile(path)
}

func writeExclusiveSynced(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		_ = file.Close()
		if remove {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(data); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	remove = false
	return nil
}

func restoreRecoveryPair(statePath string, stateData []byte, cursorPath string, cursorData []byte) error {
	stateExact, stateExists, err := exactExistingRecoveryFile(statePath, stateData)
	if err != nil {
		return err
	}
	cursorExact, cursorExists, err := exactExistingRecoveryFile(cursorPath, cursorData)
	if err != nil {
		return err
	}
	if stateExists || cursorExists {
		if stateExists && cursorExists && stateExact && cursorExact {
			return nil
		}
		return errors.New("restore destinations must both be absent or both contain the exact bundle artifacts")
	}
	if err := os.MkdirAll(filepath.Dir(statePath), 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(cursorPath), 0o700); err != nil {
		return err
	}
	stateTemp, err := stageRecoveryFile(filepath.Dir(statePath), ".dex-state-restore-*", stateData)
	if err != nil {
		return err
	}
	defer os.Remove(stateTemp)
	cursorTemp, err := stageRecoveryFile(filepath.Dir(cursorPath), ".dex-cursor-restore-*", cursorData)
	if err != nil {
		return err
	}
	defer os.Remove(cursorTemp)
	if err := os.Link(stateTemp, statePath); err != nil {
		return fmt.Errorf("install restored state: %w", err)
	}
	stateInstalled := true
	defer func() {
		if stateInstalled {
			_ = os.Remove(statePath)
		}
	}()
	if err := os.Link(cursorTemp, cursorPath); err != nil {
		return fmt.Errorf("install restored cursor: %w", err)
	}
	cursorInstalled := true
	defer func() {
		if cursorInstalled {
			_ = os.Remove(cursorPath)
		}
	}()
	if err := syncDirectory(filepath.Dir(statePath)); err != nil {
		return err
	}
	if filepath.Clean(filepath.Dir(cursorPath)) != filepath.Clean(filepath.Dir(statePath)) {
		if err := syncDirectory(filepath.Dir(cursorPath)); err != nil {
			return err
		}
	}
	stateInstalled = false
	cursorInstalled = false
	return nil
}

func exactExistingRecoveryFile(path string, expected []byte) (bool, bool, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 {
		return false, true, errors.New("restore destination is not a private regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return false, true, err
	}
	return bytes.Equal(data, expected), true, nil
}

func stageRecoveryFile(directory, pattern string, data []byte) (string, error) {
	file, err := os.CreateTemp(directory, pattern)
	if err != nil {
		return "", err
	}
	path := file.Name()
	remove := true
	defer func() {
		_ = file.Close()
		if remove {
			_ = os.Remove(path)
		}
	}()
	if err := file.Chmod(0o600); err != nil {
		return "", err
	}
	if _, err := file.Write(data); err != nil {
		return "", err
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	remove = false
	return path, nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func samePath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	return leftErr == nil && rightErr == nil && filepath.Clean(leftAbs) == filepath.Clean(rightAbs)
}

func durationMillis(duration time.Duration) int64 {
	if duration <= 0 {
		return 0
	}
	milliseconds := duration.Milliseconds()
	if milliseconds == 0 {
		return 1
	}
	return milliseconds
}
