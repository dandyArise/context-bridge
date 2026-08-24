$ErrorActionPreference = "Stop"

$integrationRoot = Split-Path -Parent $PSScriptRoot
$generatorRoot = Join-Path (Split-Path -Parent $integrationRoot) "context-bridge-external"

if (-not (Test-Path -LiteralPath (Join-Path $generatorRoot "manifest.json"))) {
  throw "Context Bridge External was not found at $generatorRoot"
}

Push-Location $integrationRoot
try {
  & lms dev --install -y
  if ($LASTEXITCODE -ne 0) { throw "Context Bridge integration installation failed." }
} finally {
  Pop-Location
}

Push-Location $generatorRoot
try {
  & lms dev --install -y
  if ($LASTEXITCODE -ne 0) { throw "Context Bridge External installation failed." }
} finally {
  Pop-Location
}

Write-Host "Installed dandyarise/context-bridge and dandyarise/context-bridge-external."
