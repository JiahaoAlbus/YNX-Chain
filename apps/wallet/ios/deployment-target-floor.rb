require 'rubygems/version'

def ynx_wallet_raise_pod_deployment_targets(installer, minimum)
  floor = Gem::Version.new(minimum)
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |configuration|
      current = configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
      # Leave inherited/Xcode expressions and newer minima untouched.
      next unless current.is_a?(String) && current.match?(/\A\d+(?:\.\d+)*\z/)
      if Gem::Version.new(current) < floor
        configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum
      end
    end
  end
end
