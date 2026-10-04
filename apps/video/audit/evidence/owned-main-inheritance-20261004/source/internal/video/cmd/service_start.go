package main

import "github.com/JiahaoAlbus/YNX-Chain/internal/video"

// Recheck the same captured source immediately before the constructor can open
// or recover state. Nil preserves the original public-only/maintenance path.
func newOriginalVideoService(cfg video.Config, current func() error) (*video.Service, error) {
	if current != nil {
		if err := current(); err != nil {
			return nil, err
		}
	}
	return video.NewService(cfg)
}
