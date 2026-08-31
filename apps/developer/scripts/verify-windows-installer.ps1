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
if (!(Test-Path $msix) -or !(Test-Path $certificatePath) -or !(Test-Path $recordPath)) { throw "Windows MSIX installer evidence is missing" }

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
function Test-Launch([string]$label) {
  Start-Process -FilePath "$env:WINDIR\explorer.exe" -ArgumentList "shell:AppsFolder\\$appId"
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $process = Get-Process "YNXDeveloper.TestnetPreview" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($process -and $process.MainWindowHandle -ne 0) { if (!$process.CloseMainWindow()) { throw "MSIX app window was not closable during $label" }; if (!$process.WaitForExit(10000)) { $process.Kill($true); throw "MSIX app did not close during $label" }; return }
    Start-Sleep -Milliseconds 250
  }
  # Hosted runners do not expose an interactive Start menu. This is still the
  # installed MSIX payload, not the portable build used by the prior gate.
  Write-Host "AppsFolder did not surface a window; launching installed MSIX payload for $label."
  Start-Process -FilePath $installedExecutable
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    $process = Get-Process "YNXDeveloper.TestnetPreview" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($process -and $process.MainWindowHandle -ne 0) { if (!$process.CloseMainWindow()) { throw "MSIX app window was not closable during $label" }; if (!$process.WaitForExit(10000)) { $process.Kill($true); throw "MSIX app did not close during $label" }; return }
    Start-Sleep -Milliseconds 250
  }
  throw "MSIX app did not cold launch during $label"
}
Test-Launch "cold launch"
Test-Launch "second launch"
Remove-AppxPackage -Package $package.PackageFullName
Get-ChildItem $trustedPeopleStore | Where-Object { $_.Thumbprint -eq $record.signerThumbprint } | Remove-Item -Force
Write-Host "Windows MSIX installed, cold-launched and second-launched from installed payload with verified test-only signature: $hash"
