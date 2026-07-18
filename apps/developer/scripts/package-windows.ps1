$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$root = (Resolve-Path (Join-Path $app "../..")).Path
$outRoot = Join-Path $app ".ynx-developer-windows"
$publish = Join-Path $outRoot "publish"
$stage = Join-Path $outRoot "YNX Developer Testnet Preview"
$zip = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-unsigned.zip"

Remove-Item $outRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item $publish -ItemType Directory -Force | Out-Null

Push-Location $app
try { npm run build } finally { Pop-Location }

dotnet publish (Join-Path $app "desktop/windows/YNXDeveloper.TestnetPreview.csproj") `
  --configuration Release --runtime win-x64 --self-contained true `
  --output $publish /p:PublishSingleFile=false /p:DebugType=None /p:DebugSymbols=false

Copy-Item $publish $stage -Recurse
$resources = Join-Path $stage "Resources"
New-Item (Join-Path $resources "runtime") -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $app "dist") (Join-Path $resources "web") -Recurse
Copy-Item (Join-Path $app "desktop/server.mjs") $resources
$node = (Get-Command node.exe -ErrorAction Stop).Source
Copy-Item $node (Join-Path $resources "runtime/node.exe")

Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$bytes = (Get-Item $zip).Length
@{
  artifact = (Split-Path $zip -Leaf)
  sha256 = $hash
  bytes = $bytes
  signingClass = "unsigned"
  architecture = "win-x64"
  installClass = "portable-extract"
} | ConvertTo-Json | Set-Content (Join-Path $outRoot "windows-package.json") -Encoding utf8
Write-Host "Built unsigned Windows x64 Testnet Preview: $zip ($bytes bytes, sha256 $hash)"
