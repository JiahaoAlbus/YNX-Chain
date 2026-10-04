package main

import "github.com/JiahaoAlbus/YNX-Chain/internal/music"

// Recheck the same captured source immediately before the constructor can open
// or recover state. Nil preserves the original public-only/maintenance path.
func newOriginalMusicService(cfg music.Config, current func() error) (*music.Service, error) {
	if current != nil {
		if err := current(); err != nil {
			return nil, err
		}
	}
	return music.New(cfg)
}
