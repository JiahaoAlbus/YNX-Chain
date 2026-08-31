$ErrorActionPreference = "Stop"

$app = Split-Path -Parent $PSScriptRoot
$repoRoot = (& git -C $app rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw "Unable to resolve the repository root for Windows packaging"
}

$trackedChanges = @(& git -C $repoRoot status --porcelain --untracked-files=no -- apps/developer packages/developer-client)
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect tracked Developer changes" }
if ($trackedChanges.Count -gt 0) {
  throw "Refusing to package tracked Developer changes that are not committed:`n$($trackedChanges -join [Environment]::NewLine)"
}

$sourceCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
$sourceTree = (& git -C $repoRoot rev-parse 'HEAD^{tree}').Trim()
$sourceDate = (& git -C $repoRoot show -s --format=%cI HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sourceCommit) -or [string]::IsNullOrWhiteSpace($sourceTree)) {
  throw "Unable to resolve exact Windows package source provenance"
}

$release = Get-Content (Join-Path $app "product-release.json") -Raw | ConvertFrom-Json
$runtimeCheckpoint = [string]$release.featureStatus.ynxCodePlatform.webSourceCommit
$publicDeploymentCommit = [string]$release.featureStatus.ynxCodePlatform.publicDeployment.sourceCommit
if ([string]::IsNullOrWhiteSpace($runtimeCheckpoint) -or [string]::IsNullOrWhiteSpace($publicDeploymentCommit) -or $runtimeCheckpoint -ne $publicDeploymentCommit) {
  throw "product-release.json does not expose one exact current public YNX Code runtime checkpoint"
}

$candidateRoot = [System.IO.Path]::GetFullPath((Join-Path $app ".ynx-developer-windows-candidates"))
$defaultOutput = Join-Path $candidateRoot $sourceCommit.Substring(0, 12)
$outRoot = [System.IO.Path]::GetFullPath($(if ($env:YNX_DEVELOPER_WINDOWS_OUTPUT_DIR) { $env:YNX_DEVELOPER_WINDOWS_OUTPUT_DIR } else { $defaultOutput }))
$candidatePrefix = "$candidateRoot$([System.IO.Path]::DirectorySeparatorChar)"
if (!$outRoot.StartsWith($candidatePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "YNX_DEVELOPER_WINDOWS_OUTPUT_DIR must stay under $candidateRoot"
}
if (Test-Path -LiteralPath $outRoot) {
  throw "Refusing to overwrite existing Windows package candidate: $outRoot"
}
$publish = Join-Path $outRoot "publish"
$stage = Join-Path $outRoot "YNX Developer Testnet Preview"
$zip = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-unsigned.zip"
$msix = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-test-signed.msix"
$installerCertificate = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-test-signed.cer"

New-Item $outRoot -ItemType Directory | Out-Null
New-Item $publish -ItemType Directory | Out-Null

dotnet publish (Join-Path $app "desktop/windows/YNXDeveloper.TestnetPreview.csproj") `
  --configuration Release --runtime win-x64 --self-contained true `
  --output $publish /p:PublishSingleFile=false /p:DebugType=None /p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw "Windows publish failed with exit $LASTEXITCODE" }

Copy-Item $publish $stage -Recurse
$resources = Join-Path $stage "Resources"
New-Item $resources -ItemType Directory -Force | Out-Null

$coreRuntime = Get-Item (Join-Path $publish "coreclr.dll")
$desktopRuntime = Get-Item (Join-Path $publish "PresentationFramework.dll")
$dotnetVersion = ([string]$coreRuntime.VersionInfo.ProductVersion).Split("+")[0]
$windowsDesktopVersion = ([string]$desktopRuntime.VersionInfo.ProductVersion).Split("+")[0]
[xml]$windowsProject = Get-Content (Join-Path $app "desktop/windows/YNXDeveloper.TestnetPreview.csproj") -Raw
$webViewReference = @($windowsProject.Project.ItemGroup.PackageReference) | Where-Object { $_.Include -eq "Microsoft.Web.WebView2" } | Select-Object -First 1
$webViewVersion = [string]$webViewReference.Version
if ([string]::IsNullOrWhiteSpace($dotnetVersion) -or [string]::IsNullOrWhiteSpace($windowsDesktopVersion) -or [string]::IsNullOrWhiteSpace($webViewVersion)) {
  throw "Exact self-contained .NET, Windows Desktop or WebView2 inventory could not be resolved"
}
$serialSeed = [System.BitConverter]::ToString(
  [System.Security.Cryptography.SHA256]::HashData(
    [System.Text.Encoding]::UTF8.GetBytes("$sourceCommit`n$dotnetVersion`n$windowsDesktopVersion`n$webViewVersion")
  )
).Replace("-", "").ToLowerInvariant()
$sbom = [ordered]@{
  bomFormat = "CycloneDX"
  specVersion = "1.5"
  serialNumber = "urn:uuid:$($serialSeed.Substring(0,8))-$($serialSeed.Substring(8,4))-4$($serialSeed.Substring(13,3))-a$($serialSeed.Substring(17,3))-$($serialSeed.Substring(20,12))"
  version = 1
  metadata = [ordered]@{
    timestamp = [DateTimeOffset]::UtcNow
    component = [ordered]@{ type = "application"; name = "YNX Code Windows Hosted Workspace Client"; version = "0.2.0"; "bom-ref" = "pkg:generic/ynx-code-windows@0.2.0" }
    properties = @(
      [ordered]@{ name = "ynx:sourceCommit"; value = $sourceCommit },
      [ordered]@{ name = "ynx:artifactClass"; value = "unsigned-testnet-preview" },
      [ordered]@{ name = "ynx:deliveryMode"; value = "hosted-workspace-client" },
      [ordered]@{ name = "ynx:workspaceUrl"; value = "https://developer.ynxweb4.com/" }
    )
  }
  components = @(
    [ordered]@{ type = "framework"; name = ".NET Runtime win-x64"; version = $dotnetVersion; scope = "required"; "bom-ref" = "pkg:generic/dotnet-runtime-win-x64@$dotnetVersion" },
    [ordered]@{ type = "framework"; name = ".NET Windows Desktop Runtime win-x64"; version = $windowsDesktopVersion; scope = "required"; "bom-ref" = "pkg:generic/dotnet-windows-desktop-runtime-win-x64@$windowsDesktopVersion" },
    [ordered]@{ type = "library"; name = "Microsoft.Web.WebView2"; version = $webViewVersion; scope = "required"; purl = "pkg:nuget/Microsoft.Web.WebView2@$webViewVersion"; "bom-ref" = "pkg:nuget/Microsoft.Web.WebView2@$webViewVersion" },
    [ordered]@{ type = "service"; name = "YNX Code Hosted Workspace"; version = "0.2.0-testnet-preview"; scope = "required"; "bom-ref" = "https://developer.ynxweb4.com/" }
  )
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$sbomPath = Join-Path $resources "sbom.cdx.json"
[System.IO.File]::WriteAllText($sbomPath, (($sbom | ConvertTo-Json -Depth 12) + [Environment]::NewLine), $utf8NoBom)

$sbomHash = (Get-FileHash $sbomPath -Algorithm SHA256).Hash.ToLowerInvariant()
$provenance = [ordered]@{
  schemaVersion = 1
  productId = "ynx-developer-v1"
  version = "0.2.0"
  artifactClass = "unsigned-testnet-preview"
  platform = "windows-x64"
  signingClass = "unsigned-no-authenticode"
  deliveryMode = "hosted-workspace-client"
  workspaceUrl = "https://developer.ynxweb4.com/"
  workspaceHealthUrl = "https://developer.ynxweb4.com/healthz"
  sourceRepository = "https://github.com/JiahaoAlbus/YNX-Chain"
  sourceCommit = $sourceCommit
  sourceTree = $sourceTree
  sourceCommitDate = $sourceDate
  runtimeCheckpoint = $runtimeCheckpoint
  sourceDirty = $false
  sbomPath = "Resources/sbom.cdx.json"
  sbomSha256 = $sbomHash
}
$provenancePath = Join-Path $resources "build-provenance.json"
[System.IO.File]::WriteAllText($provenancePath, (($provenance | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)

$exe = Join-Path $stage "YNXDeveloper.TestnetPreview.exe"
if (!(Test-Path $exe)) { throw "Published Windows executable is missing before packaging" }
$signature = Get-AuthenticodeSignature $exe
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
  throw "Refusing unsigned-preview classification: expected Authenticode NotSigned, got $($signature.Status)"
}

Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$bytes = (Get-Item $zip).Length
$packageRecord = [ordered]@{
  schemaVersion = 1
  artifact = (Split-Path $zip -Leaf)
  sha256 = $hash
  bytes = $bytes
  signingClass = "unsigned-no-authenticode"
  authenticodeStatus = "NotSigned"
  architecture = "win-x64"
  installClass = "portable-extract"
  deliveryMode = "hosted-workspace-client"
  workspaceUrl = "https://developer.ynxweb4.com/"
  sourceCommit = $sourceCommit
  sourceTree = $sourceTree
  sourceCommitDate = $sourceDate
  runtimeCheckpoint = $runtimeCheckpoint
  sourceDirty = $false
  sbomSha256 = $sbomHash
  provenanceEmbedded = $true
  hosted = $false
  productionSigned = $false
}
[System.IO.File]::WriteAllText((Join-Path $outRoot "windows-package.json"), (($packageRecord | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)

# The ZIP remains an internal extraction-evidence input only. The distributable
# desktop format is MSIX, signed by an explicitly test-only self-signed
# certificate. It is deliberately not an Authenticode production signature.
$assets = Join-Path $stage "Assets"
New-Item $assets -ItemType Directory -Force | Out-Null
$transparentPng = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQXwAAAABJRU5ErkJggg==")
foreach ($name in @("Square44x44Logo.png", "Square150x150Logo.png", "StoreLogo.png")) { [System.IO.File]::WriteAllBytes((Join-Path $assets $name), $transparentPng) }
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
  <Identity Name="YNXDeveloper.TestnetPreview" Publisher="CN=YNX Developer Testnet Preview" Version="0.2.0.0" ProcessorArchitecture="x64" />
  <Properties><DisplayName>YNX Developer Testnet Preview</DisplayName><PublisherDisplayName>YNX</PublisherDisplayName><Logo>Assets\StoreLogo.png</Logo></Properties>
  <Resources><Resource Language="en-us" /></Resources>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
  <Applications><Application Id="YNXDeveloper" Executable="YNXDeveloper.TestnetPreview.exe" EntryPoint="Windows.FullTrustApplication"><uap:VisualElements DisplayName="YNX Developer Testnet Preview" Description="YNX Developer Testnet Preview" BackgroundColor="transparent" Square44x44Logo="Assets\Square44x44Logo.png" Square150x150Logo="Assets\Square150x150Logo.png" /></Application></Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@
[System.IO.File]::WriteAllText((Join-Path $stage "AppxManifest.xml"), $manifest, $utf8NoBom)
$makeAppxCommand = Get-Command MakeAppx.exe -ErrorAction SilentlyContinue
$makeAppx = if ($makeAppxCommand) { $makeAppxCommand.Source } else {
  Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter MakeAppx.exe -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ([string]::IsNullOrWhiteSpace($makeAppx) -or !(Test-Path $makeAppx)) { throw "Windows App Packaging tools (MakeAppx.exe) are required" }
& $makeAppx pack /d $stage /p $msix /o
if ($LASTEXITCODE -ne 0 -or !(Test-Path $msix)) { throw "MSIX packaging failed" }
$certificate = New-SelfSignedCertificate -Type Custom -Subject "CN=YNX Developer Testnet Preview" -KeyUsage DigitalSignature -KeyExportPolicy Exportable -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
Export-Certificate -Cert $certificate -FilePath $installerCertificate -Force | Out-Null
$temporaryPfx = Join-Path $outRoot "msix-test-signing.pfx"
$pfxPassword = [Guid]::NewGuid().ToString("N")
Export-PfxCertificate -Cert $certificate -FilePath $temporaryPfx -Password (ConvertTo-SecureString $pfxPassword -AsPlainText -Force) -Force | Out-Null
$signTool = Join-Path (Split-Path $makeAppx -Parent) "SignTool.exe"
if (!(Test-Path $signTool)) { throw "Windows SDK SignTool.exe is required for MSIX signing" }
& $signTool sign /fd SHA256 /f $temporaryPfx /p $pfxPassword $msix
$signExit = $LASTEXITCODE
Remove-Item $temporaryPfx -Force -ErrorAction SilentlyContinue
if ($signExit -ne 0) { throw "MSIX test signature failed with SignTool exit $signExit" }
# Authenticode's generic PowerShell reader reports UnknownError for valid AppX
# package signatures on the hosted runner. The installer verifier imports the
# public certificate and uses Add-AppxPackage, which is the Windows package
# signature verifier, before it allows any launch evidence to be recorded.
$msixHash = (Get-FileHash $msix -Algorithm SHA256).Hash.ToLowerInvariant()
$msixBytes = (Get-Item $msix).Length
$installerRecord = [ordered]@{
  schemaVersion = 1
  artifact = (Split-Path $msix -Leaf)
  sha256 = $msixHash
  bytes = $msixBytes
  installClass = "msix-sideload"
  signingClass = "test-self-signed-not-production"
  signerThumbprint = $certificate.Thumbprint
  certificateArtifact = (Split-Path $installerCertificate -Leaf)
  sourceCommit = $sourceCommit
  sourceTree = $sourceTree
  runtimeCheckpoint = $runtimeCheckpoint
  sourceDirty = $false
  internalZipEvidence = (Split-Path $zip -Leaf)
  internalZipSha256 = $hash
  productionSigned = $false
  hosted = $false
}
[System.IO.File]::WriteAllText((Join-Path $outRoot "windows-installer.json"), (($installerRecord | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)
Write-Host "Built internal ZIP evidence: $zip ($bytes bytes, sha256 $hash)"
Write-Host "Built installable Windows x64 MSIX: $msix ($msixBytes bytes, sha256 $msixHash, signing test-self-signed-not-production)"
Write-Host "Embedded source commit $sourceCommit, source tree $sourceTree, runtime checkpoint $runtimeCheckpoint and SBOM SHA-256 $sbomHash."
