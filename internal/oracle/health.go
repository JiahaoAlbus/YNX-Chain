package oracle

// PublicHealth enriches the core storage/provider health snapshot with the
// versioned derivative policy required by Exchange consumers.
func (service *Service) PublicHealth() Health {
	health := service.Health()
	health.DerivativesPolicyVersion = service.derivatives.Version
	if health.Dependencies == nil {
		health.Dependencies = map[string]string{}
	}
	health.Dependencies["derivativesPolicy"] = service.derivatives.Version
	return health
}
