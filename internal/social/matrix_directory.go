package social

import (
	"encoding/json"
	"io"
	"strings"
)

const MatrixDirectorySchema = "ynx-social-matrix-directory/v1"

// MatrixIdentity is an operator-confirmed binding to an EXISTING MXID. It is
// public routing metadata, never a token, OP configuration or registration API.
type MatrixIdentity struct {
	Account    string `json:"account"`
	Homeserver string `json:"homeserver"`
	ServerName string `json:"serverName"`
	UserID     string `json:"userId"`
}

// MatrixDirectory is immutable after parsing. No account-name derivation or
// fallback registration is permitted when a historical binding is absent.
type MatrixDirectory struct {
	identities map[string]MatrixIdentity
}

func ParseMatrixDirectory(reader io.Reader) (*MatrixDirectory, error) {
	var input struct {
		SchemaVersion string           `json:"schemaVersion"`
		Bindings      []MatrixIdentity `json:"bindings"`
	}
	data, err := io.ReadAll(io.LimitReader(reader, 128*1024+1))
	if err != nil || len(data) > 128*1024 {
		return nil, ErrInvalid
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || input.SchemaVersion != MatrixDirectorySchema || len(input.Bindings) == 0 || len(input.Bindings) > 1000 {
		return nil, ErrInvalid
	}
	directory := &MatrixDirectory{identities: make(map[string]MatrixIdentity, len(input.Bindings))}
	users := make(map[string]bool, len(input.Bindings))
	for _, binding := range input.Bindings {
		if !matrixAccount.MatchString(binding.Account) || !validMatrixUserID(binding.UserID, binding.ServerName) || (&MatrixBridge{}).validateServer(MatrixServer{binding.Homeserver, binding.ServerName}) != nil {
			return nil, ErrInvalid
		}
		if _, exists := directory.identities[binding.Account]; exists || users[binding.UserID] {
			return nil, ErrConflict
		}
		binding.Homeserver = strings.TrimRight(binding.Homeserver, "/") + "/"
		directory.identities[binding.Account] = binding
		users[binding.UserID] = true
	}
	return directory, nil
}

func validMatrixUserID(userID, serverName string) bool {
	if !matrixServerName.MatchString(serverName) || len(userID) > 255 || !strings.HasPrefix(userID, "@") || !strings.HasSuffix(userID, ":"+serverName) {
		return false
	}
	localpart := strings.TrimSuffix(strings.TrimPrefix(userID, "@"), ":"+serverName)
	if localpart == "" {
		return false
	}
	for _, char := range localpart {
		if char <= ' ' || char >= 127 || char == ':' {
			return false
		}
	}
	return true
}

func (d *MatrixDirectory) Resolve(account string) (MatrixIdentity, error) {
	if d == nil {
		return MatrixIdentity{}, ErrConflict
	}
	identity, exists := d.identities[account]
	if !exists {
		return MatrixIdentity{}, ErrNotFound
	}
	return identity, nil
}
