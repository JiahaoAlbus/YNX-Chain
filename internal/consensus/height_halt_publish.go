package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strconv"

	"github.com/cometbft/cometbft/node"
)

// HeightHaltPublicationOptions contains independent operator inputs. Neither
// the public request nor this publisher grants a node or activation authority.
type HeightHaltPublicationOptions struct {
	ApplicationStatePath string
	Control              node.HeightHaltControl
}

// HeightHaltPublicationResult reports file publication only. Actual future
// height admission and completed shutdown belong to the running consumer.
type HeightHaltPublicationResult struct {
	Version            string `json:"version"`
	ControlPath        string `json:"controlPath"`
	RequestSHA256      string `json:"requestSHA256"`
	TargetHeight       string `json:"targetHeight"`
	ChainID            string `json:"chainId"`
	GenesisSHA256      string `json:"genesisSHA256"`
	OperatorPlanSHA256 string `json:"operatorPlanSHA256"`
	SessionID          string `json:"sessionId"`
	Published          bool   `json:"published"`
	NodeStopped        bool   `json:"nodeStopped"`
	Activation         bool   `json:"activation"`
}

// These per-call hooks inject interrupted I/O and concurrent filesystem effects
// in isolated tests. No normal caller may supply them or retry a partial result.
type heightHaltPublicationHooks struct {
	write         func(*os.File, []byte) (int, error)
	syncFile      func(*os.File) error
	syncDirectory func(*os.File) error
	beforeRename  func() error
	afterRename   func() error
}

// PublishHeightHaltRequest preserves the exact externally pinned request bytes.
// It never opens a node, writes application state, signs, or removes old files.
func PublishHeightHaltRequest(raw []byte, requestSHA256 string, options HeightHaltPublicationOptions) (HeightHaltPublicationResult, error) {
	return publishHeightHaltRequest(raw, requestSHA256, options, nil)
}

func publishHeightHaltRequest(raw []byte, requestSHA256 string, options HeightHaltPublicationOptions, hooks *heightHaltPublicationHooks) (HeightHaltPublicationResult, error) {
	if len(raw) == 0 || len(raw) > node.MaxHeightHaltRequestBytes {
		return HeightHaltPublicationResult{}, errors.New("height halt request must contain at most 4096 original approved bytes")
	}
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != requestSHA256 {
		return HeightHaltPublicationResult{}, errors.New("height halt request differs from its independent exact SHA256")
	}
	// One original closed-field decoder is shared with the running consumer.
	// In particular, publication does not try to infer the current/future H.
	target, err := node.ValidateHeightHaltRequest(raw, options.Control)
	if err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if !filepath.IsAbs(options.ApplicationStatePath) || filepath.Clean(options.ApplicationStatePath) != options.ApplicationStatePath ||
		options.Control.Path != filepath.Join(filepath.Dir(options.ApplicationStatePath), "operator-height-halt-"+options.Control.SessionID+".json") {
		return HeightHaltPublicationResult{}, errors.New("height halt publication requires the exact approved session path under the original application directory")
	}
	result := HeightHaltPublicationResult{Version: "YNX-OPERATOR-HEIGHT-HALT-PUBLISHED/v1", ControlPath: options.Control.Path,
		RequestSHA256: requestSHA256, TargetHeight: strconv.FormatInt(target, 10), ChainID: options.Control.ChainID,
		GenesisSHA256: options.Control.GenesisSHA256, OperatorPlanSHA256: options.Control.OperatorPlanSHA256, SessionID: options.Control.SessionID}
	return publishHeightHaltRequestPlatform(raw, options, result, hooks)
}
