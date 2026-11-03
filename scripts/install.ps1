# Installs or upgrades Argus from an extracted release ZIP.
# Run it from the ZIP folder: .\install.ps1
[CmdletBinding()]
param(
    [string]$Destination = (Join-Path $env:USERPROFILE ".copilot\extensions\argus")
)

$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "extension"

foreach ($required in "extension.mjs", "package.json", "dist") {
    if (-not (Test-Path (Join-Path $source $required))) {
        throw "Missing '$required' in $source. Run this script from the extracted release folder."
    }
}

# Copy over the install and do not delete it first. This keeps argus.config.json.
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -Recurse -Force (Join-Path $source "*") $Destination

Write-Host "Installed Argus to $Destination. Reload extensions in the Copilot app."
