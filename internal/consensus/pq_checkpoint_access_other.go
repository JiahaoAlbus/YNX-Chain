//go:build !linux

package consensus

import "errors"

type PQCheckpointAccessServer struct{}

func checkpointAccessClientIdentity(PQCheckpointAccess) error {
	return errors.New("checkpoint descriptor access requires Linux SO_PEERCRED and SCM_RIGHTS")
}
func StartPQCheckpointAccess(string, PQCheckpointAccess) (*PQCheckpointAccessServer, error) {
	return nil, checkpointAccessClientIdentity(PQCheckpointAccess{})
}
func (*PQCheckpointAccessServer) Close() error { return nil }
func capturePQCheckpointAccess(string, PQCheckpointAccess) (*pqEngineStateRead, error) {
	return nil, checkpointAccessClientIdentity(PQCheckpointAccess{})
}
