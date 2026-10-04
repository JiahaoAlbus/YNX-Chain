//go:build !ynx_canonical_media || !ynx_media_combined_authority

package main

import "github.com/JiahaoAlbus/YNX-Chain/internal/video"

// Original public-only build cannot acquire canonical business authority.
func prepareOriginalBusiness() (video.VideoBusinessAuthority, func() error, error) {
	return nil, nil, nil
}
