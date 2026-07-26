package oracle

// PublicHealth enriches the core storage/provider health snapshot with the
// versioned derivative policy required by Exchange consumers.
func (service *Service) PublicHealth() Health {
	health := service.Health()
	health.DerivativesPolicyVersion = service.derivatives.Version
	health.DEXTWAPPolicyVersion = service.dexTWAP.Version
	health.StablecoinReservePolicyVersion = service.reserve.Version
	if health.Dependencies == nil {
		health.Dependencies = map[string]string{}
	}
	health.Dependencies["derivativesPolicy"] = service.derivatives.Version
	health.Dependencies["dexTwapPolicy"] = service.dexTWAP.Version
	health.Dependencies["stablecoinReservePolicy"] = service.reserve.Version
	return health
}
