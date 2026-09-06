$ErrorActionPreference = "Stop"

$app = Split-Path -Parent $PSScriptRoot
$sourceCommit = (& git -C $app rev-parse HEAD).Trim()
if ([string]::IsNullOrWhiteSpace($sourceCommit)) { throw "Unable to resolve exact Windows installer source commit" }
$candidateRoot = [System.IO.Path]::GetFullPath((Join-Path $app ".ynx-developer-windows-candidates"))
$defaultOutput = Join-Path $candidateRoot $sourceCommit.Substring(0, 12)
$outRoot = [System.IO.Path]::GetFullPath($(if ($env:YNX_DEVELOPER_WINDOWS_OUTPUT_DIR) { $env:YNX_DEVELOPER_WINDOWS_OUTPUT_DIR } else { $defaultOutput }))
$candidatePrefix = "$candidateRoot$([System.IO.Path]::DirectorySeparatorChar)"
if (!$outRoot.StartsWith($candidatePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "YNX_DEVELOPER_WINDOWS_OUTPUT_DIR must stay under $candidateRoot"
}
$msix = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-test-signed.msix"
$certificatePath = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-test-signed.cer"
$recordPath = Join-Path $outRoot "windows-installer.json"
$evidencePath = Join-Path $outRoot "windows-msix-install-evidence.json"
if (!(Test-Path $msix) -or !(Test-Path $certificatePath) -or !(Test-Path $recordPath)) { throw "Windows MSIX installer evidence is missing" }
if (Test-Path -LiteralPath $evidencePath) { throw "Refusing to overwrite existing Windows MSIX installation evidence: $evidencePath" }

$record = Get-Content $recordPath -Raw | ConvertFrom-Json
$hash = (Get-FileHash $msix -Algorithm SHA256).Hash.ToLowerInvariant()
if ($record.artifact -ne (Split-Path $msix -Leaf) -or $record.sha256 -ne $hash -or $record.bytes -ne (Get-Item $msix).Length) { throw "MSIX artifact identity mismatch" }
if ($record.installClass -ne "msix-sideload" -or $record.signingClass -ne "test-self-signed-not-production" -or $record.productionSigned -ne $false) { throw "MSIX signing boundary is invalid" }

$trustedPeopleStore = "Cert:\LocalMachine\TrustedPeople"
$certificate = Import-Certificate -FilePath $certificatePath -CertStoreLocation $trustedPeopleStore
if ($certificate.Thumbprint -ne $record.signerThumbprint) { throw "MSIX signer certificate mismatch" }

Get-AppxPackage -Name "YNXDeveloper.TestnetPreview" | Remove-AppxPackage -ErrorAction SilentlyContinue
# Add-AppxPackage performs the MSIX package-signature and Publisher validation.
# It is intentionally used instead of Get-AuthenticodeSignature, which does not
# consistently expose an AppX package signature through the generic API.
Add-AppxPackage -Path $msix
$package = Get-AppxPackage -Name "YNXDeveloper.TestnetPreview"
if (!$package) { throw "MSIX was not installed" }
$appId = "$($package.PackageFamilyName)!YNXDeveloper"
$installedExecutable = Join-Path $package.InstallLocation "YNXDeveloper.TestnetPreview.exe"
if (!(Test-Path $installedExecutable)) { throw "Installed MSIX executable is missing" }
. (Join-Path $PSScriptRoot "verify-windows-ui.ps1")
# This verifies the actual installed MSIX payload. Start menu activation is a separate unverified surface.
$ui = Invoke-YNXWindowsUIAcceptance $installedExecutable $outRoot "msix" $record.runtimeCheckpoint
Remove-AppxPackage -Package $package.PackageFullName
Get-ChildItem $trustedPeopleStore | Where-Object { $_.Thumbprint -eq $record.signerThumbprint } | Remove-Item -Force
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$evidence = [ordered]@{
  schemaVersion = 1
  productId = "ynx-developer-v1"
  surface = "windows-x64-testnet-preview-msix"
  sourceCommit = $record.sourceCommit
  sourceTree = $record.sourceTree
  runtimeCheckpoint = $record.runtimeCheckpoint
  artifact = $record.artifact
  artifactSha256 = $hash
  artifactBytes = (Get-Item $msix).Length
  installClass = $record.installClass
  signingClass = $record.signingClass
  signerThumbprint = $record.signerThumbprint
  certificateImported = $true
  packageSignatureValidatedByAddAppxPackage = $true
  installedPayloadVerified = $true
  startMenuActivation = $false
  hostedWorkspaceConnected = $ui.write.hostedWorkspaceConnected
  nativeMenuModelCommands = $ui.write.nativeCommandPipeline
  sameProfileProjectRestored = $ui.reopen.sameProfileProjectRestored
  physicalMenuPickerUI = $false
  splitDiffInstalledUI = $false
  coldLaunch = $true
  secondLaunch = $true
  uninstall = $true
  hosted = $false
  productionSigned = $false
  generatedAt = [DateTimeOffset]::UtcNow
}
[System.IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)
Write-Host "Windows MSIX installed, cold-launched and second-launched from installed payload with verified test-only signature: $hash"
