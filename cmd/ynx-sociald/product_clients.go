package main

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/JiahaoAlbus/YNX-Chain/internal/social"
)

func newSocialProductClients() (map[string]social.ProductSessionAuthorizer, *productsessionv2.Client, error) {
	clients := map[string]social.ProductSessionAuthorizer{}
	var web *productsessionv2.Client
	for _, platform := range []string{"web", "android", "ios"} {
		policy := productsessionv2.Policy{ProductID: social.RequestingProduct, ClientID: social.ProductClientID, ApplicationID: social.BundleID, Platform: platform, Origin: "app://" + platform + "/" + social.BundleID, Callback: social.Callback, AllowedScopes: socialAllowedScopes()}
		identifier := social.BundleID
		switch platform {
		case "web":
			policy.ApplicationID += ".web"
			policy.Origin = social.Origin
			policy.Callback = social.Origin + "/wallet-auth/callback"
		case "android":
			policy.PackageID = &identifier
		case "ios":
			policy.BundleID = &identifier
		}
		client, err := productsessionv2.NewClient("https://wallet-auth.ynxweb4.com", policy, nil)
		if err != nil {
			return nil, nil, err
		}
		clients[platform] = client
		if platform == "web" {
			web = client
		}
	}
	return clients, web, nil
}
