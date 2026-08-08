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
$runtimeCheckpoint = [string]$release.featureStatus.apiStudio.sourceCommit
if ([string]::IsNullOrWhiteSpace($runtimeCheckpoint)) {
  throw "product-release.json does not expose featureStatus.apiStudio.sourceCommit"
}

$outRoot = Join-Path $app ".ynx-developer-windows"
$publish = Join-Path $outRoot "publish"
$stage = Join-Path $outRoot "YNX Developer Testnet Preview"
$zip = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-unsigned.zip"

Remove-Item $outRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item $publish -ItemType Directory -Force | Out-Null

Push-Location $app
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Web build failed with exit $LASTEXITCODE" }
} finally {
  Pop-Location
}

dotnet publish (Join-Path $app "desktop/windows/YNXDeveloper.TestnetPreview.csproj") `
  --configuration Release --runtime win-x64 --self-contained true `
  --output $publish /p:PublishSingleFile=false /p:DebugType=None /p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw "Windows publish failed with exit $LASTEXITCODE" }

Copy-Item $publish $stage -Recurse
$resources = Join-Path $stage "Resources"
New-Item (Join-Path $resources "runtime") -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $app "dist") (Join-Path $resources "web") -Recurse
Copy-Item (Join-Path $app "desktop/server.mjs") $resources
Copy-Item (Join-Path $app "sbom.cdx.json") (Join-Path $resources "sbom.cdx.json")
$node = (Get-Command node.exe -ErrorAction Stop).Source
Copy-Item $node (Join-Path $resources "runtime/node.exe")
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$npmSource = Join-Path (Split-Path $npmCommand -Parent) "node_modules/npm"
if (!(Test-Path (Join-Path $npmSource "bin/npm-cli.js"))) {
  $npmRoot = (& npm root -g).Trim()
  $npmSource = Join-Path $npmRoot "npm"
}
if (!(Test-Path (Join-Path $npmSource "bin/npm-cli.js"))) { throw "A complete npm CLI is required for isolated desktop package installation" }
$npmTarget = Join-Path $resources "runtime/npm/node_modules/npm"
New-Item (Split-Path $npmTarget -Parent) -ItemType Directory -Force | Out-Null
Copy-Item $npmSource $npmTarget -Recurse

$sbomPath = Join-Path $resources "sbom.cdx.json"
$sbomHash = (Get-FileHash $sbomPath -Algorithm SHA256).Hash.ToLowerInvariant()
$provenance = [ordered]@{
  schemaVersion = 1
  productId = "ynx-developer-v1"
  version = "0.2.0"
  artifactClass = "unsigned-testnet-preview"
  platform = "windows-x64"
  signingClass = "unsigned-no-authenticode"
  sourceRepository = "https://github.com/JiahaoAlbus/YNX-Chain"
  sourceCommit = $sourceCommit
  sourceTree = $sourceTree
  sourceCommitDate = $sourceDate
  runtimeCheckpoint = $runtimeCheckpoint
  sourceDirty = $false
  sbomPath = "Resources/sbom.cdx.json"
  sbomSha256 = $sbomHash
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
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
Write-Host "Built unsigned Windows x64 Testnet Preview: $zip ($bytes bytes, sha256 $hash)"
Write-Host "Embedded source commit $sourceCommit, source tree $sourceTree, runtime checkpoint $runtimeCheckpoint and SBOM SHA-256 $sbomHash."
