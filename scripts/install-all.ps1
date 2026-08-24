$ErrorActionPreference = "Stop"

$integrationRoot = Split-Path -Parent $PSScriptRoot
$generatorRoot = Join-Path (Split-Path -Parent $integrationRoot) "context-bridge-external"
$lmStudioRoot = Join-Path $env:USERPROFILE ".lmstudio"
$runtimeNode = Join-Path $lmStudioRoot ".internal\utils\node.exe"
$installedOwnerRoot = Join-Path $lmStudioRoot "extensions\plugins\dandyarise"
$installedIntegrationRoot = Join-Path $installedOwnerRoot "context-bridge"
$installedGeneratorRoot = Join-Path $installedOwnerRoot "context-bridge-external"
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("context-bridge-install-" + [guid]::NewGuid().ToString("N"))
$stagedGeneratorRoot = Join-Path $stagingRoot "context-bridge-external"

if (-not (Test-Path -LiteralPath (Join-Path $generatorRoot "manifest.json"))) {
  throw "Context Bridge External was not found at $generatorRoot"
}

if (-not (Test-Path -LiteralPath $runtimeNode -PathType Leaf)) {
  throw "LM Studio's bundled Node.js runtime was not found at $runtimeNode. Start LM Studio once, wait for initialization, and retry."
}

function Install-Plugin([string] $pluginRoot, [string] $displayName) {
  Push-Location $pluginRoot
  try {
    & lms dev --install -y
    if ($LASTEXITCODE -ne 0) { throw "$displayName installation failed." }
  } finally {
    Pop-Location
  }
}

New-Item -ItemType Directory -Path $stagingRoot | Out-Null
try {
  # LM Studio 0.4.21's local installer replaces sibling plugins under the same owner.
  # Stage the generated companion bundle outside that owner before installing the integration.
  Install-Plugin $generatorRoot "Context Bridge External"
  if (-not (Test-Path -LiteralPath (Join-Path $installedGeneratorRoot ".lmstudio\production.js") -PathType Leaf)) {
    throw "Context Bridge External was installed without a production bundle."
  }
  Copy-Item -LiteralPath $installedGeneratorRoot -Destination $stagedGeneratorRoot -Recurse

  Install-Plugin $integrationRoot "Context Bridge integration"
  if (-not (Test-Path -LiteralPath (Join-Path $installedIntegrationRoot ".lmstudio\production.js") -PathType Leaf)) {
    throw "Context Bridge integration was installed without a production bundle."
  }

  if (-not (Test-Path -LiteralPath $installedGeneratorRoot)) {
    New-Item -ItemType Directory -Path $installedOwnerRoot -Force | Out-Null
    Copy-Item -LiteralPath $stagedGeneratorRoot -Destination $installedGeneratorRoot -Recurse
  }

  foreach ($installedRoot in @($installedIntegrationRoot, $installedGeneratorRoot)) {
    if (-not (Test-Path -LiteralPath (Join-Path $installedRoot "manifest.json") -PathType Leaf)) {
      throw "Installed plugin manifest missing at $installedRoot"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $installedRoot ".lmstudio\production.js") -PathType Leaf)) {
      throw "Installed plugin production bundle missing at $installedRoot"
    }
  }
} finally {
  $resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolvedStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot)
  if ($resolvedStagingRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
      (Test-Path -LiteralPath $resolvedStagingRoot)) {
    Remove-Item -LiteralPath $resolvedStagingRoot -Recurse -Force
  }
}

Write-Host "Installed dandyarise/context-bridge and dandyarise/context-bridge-external."
Write-Host "Restart LM Studio once so it rescans both installed plugins."
