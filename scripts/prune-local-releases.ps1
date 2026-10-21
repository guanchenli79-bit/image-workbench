param([switch]$SyncDesktop, [switch]$AdminOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$adminRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release-admin'))
$desktopRoot = Join-Path $env:USERPROFILE ('Desktop\image' + [char]0x5de5 + [char]0x4f5c)
$usageName = -join @([char]0x4f7f,[char]0x7528,[char]0x8bf4,[char]0x660e,'.txt')
$changePrefix = [regex]::Escape((-join @([char]0x66f4,[char]0x65b0,[char]0x8bf4,[char]0x660e,'-v')))
$currentVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$preservedVersion = '0.1.17'

function Get-ArtifactVersion([string]$name) {
  if ($name -match '^ImageWorkbench-(?:source-)?(?<version>\d+\.\d+\.\d+)(?:-x64\.exe(?:\.blockmap)?|\.zip)$') { return $Matches.version }
  if ($name -match "^(?:notes-v|release-notes-|$changePrefix)(?<version>\d+\.\d+\.\d+)\.md$") { return $Matches.version }
  return $null
}

function Prune-Root([string]$root) {
  $resolvedRoot = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $root).Path)
  foreach ($file in Get-ChildItem -LiteralPath $resolvedRoot -File) {
    $version = Get-ArtifactVersion $file.Name
    if (-not $version -or $version -eq $currentVersion -or $version -eq $preservedVersion) { continue }
    if ([IO.Path]::GetFullPath($file.DirectoryName) -ne $resolvedRoot) { throw "Refusing to remove file outside target directory: $($file.FullName)" }
    Remove-Item -LiteralPath $file.FullName -Force
    Write-Output "Removed old version: $($file.FullName)"
  }
}

function Prune-AdminRoot {
  $resolvedRoot = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $adminRoot).Path)
  $versions = @(Get-ChildItem -LiteralPath $resolvedRoot -File | ForEach-Object {
    if ($_.Name -match '^ImageWorkbenchAdmin-(?<version>\d+\.\d+\.\d+)-x64\.exe$') { [version]$Matches.version }
  } | Sort-Object -Descending)
  if (-not $versions.Count) { return }
  $latestAdminVersion = $versions[0].ToString()
  foreach ($file in Get-ChildItem -LiteralPath $resolvedRoot -File) {
    if ($file.Name -notmatch '^ImageWorkbenchAdmin-(?<version>\d+\.\d+\.\d+)-x64\.exe(?:\.blockmap)?$') { continue }
    if ($Matches.version -eq $latestAdminVersion -or $Matches.version -eq $preservedVersion) { continue }
    if ([IO.Path]::GetFullPath($file.DirectoryName) -ne $resolvedRoot) { throw "Refusing to remove file outside target directory: $($file.FullName)" }
    Remove-Item -LiteralPath $file.FullName -Force
    Write-Output "Removed old admin version: $($file.FullName)"
  }
}

if ($AdminOnly) { Prune-AdminRoot; return }

if ($SyncDesktop) {
  $resolvedDesktop = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $desktopRoot).Path)
  $files = @(
    "ImageWorkbench-$currentVersion-x64.exe",
    "ImageWorkbench-$currentVersion-x64.exe.blockmap",
    "ImageWorkbench-source-$currentVersion.zip",
    "release-notes-$currentVersion.md",
    $usageName,
    'latest.yml'
  )
  foreach ($name in $files) {
    $source = if ($name -eq $usageName -or $name -like 'release-notes-*') { Join-Path $projectRoot $name } else { Join-Path $releaseRoot $name }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing delivery file: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $resolvedDesktop $name) -Force
  }
  Prune-Root $resolvedDesktop
}

Prune-Root $releaseRoot
Prune-AdminRoot
