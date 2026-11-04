# Installs or upgrades Argus from an extracted release ZIP.
# Run it from the ZIP folder: .\install.ps1
[CmdletBinding()]
param(
    [string]$Destination = (Join-Path $env:USERPROFILE ".copilot\extensions\argus")
)

$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "extension"

foreach ($required in "extension.mjs", "package.json", "dist", "node_modules") {
    if (-not (Test-Path -LiteralPath (Join-Path $source $required))) {
        throw "Missing '$required' in $source. Run this script from the extracted release folder."
    }
}

# Copy over the install and do not delete it first. This keeps argus.config.json.
# Move the old node_modules aside so packages that the release dropped do not remain.
# The move fails before any change when the running extension locks a file in it.
$modules = Join-Path $Destination "node_modules"
$backup = "$modules.old"
if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
$hadModules = Test-Path -LiteralPath $modules
if ($hadModules) { Move-Item -LiteralPath $modules -Destination $backup }

try {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $source | Copy-Item -Recurse -Force -Destination $Destination
}
catch {
    if ($hadModules) {
        if (Test-Path -LiteralPath $modules) { Remove-Item -LiteralPath $modules -Recurse -Force }
        Move-Item -LiteralPath $backup -Destination $modules
    }
    throw
}
if ($hadModules) { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host "Installed Argus to $Destination. Reload extensions in the Copilot app."
