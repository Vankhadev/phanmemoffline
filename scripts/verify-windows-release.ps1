param(
  [string]$Version = '',
  [string]$Tag = '',
  [string]$Owner = 'Vankhadev',
  [string]$Repo = 'phanmemoffline',
  [string]$ReleaseDir = 'release',
  [ValidateSet('local', 'remote', 'both')]
  [string]$Mode = 'local',
  [string[]]$Arch = @('x64', 'ia32'),
  [Int64]$MinInstallerBytes = 10485760
)

$ErrorActionPreference = 'Stop'
$Arch = @($Arch | ForEach-Object { [string]$_ -split '[,;|]' } | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
if ($Arch.Count -eq 0) { $Arch = @('x64', 'ia32') }

function Resolve-ProjectVersion {
  if (-not [string]::IsNullOrWhiteSpace($Version)) { return $Version }
  $pkgPath = Join-Path (Get-Location) 'package.json'
  if (-not (Test-Path $pkgPath)) { throw "Không tìm thấy package.json để xác định version." }
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  return [string]$pkg.version
}

function Resolve-ProjectTag([string]$ResolvedVersion) {
  if (-not [string]::IsNullOrWhiteSpace($Tag)) { return $Tag }
  return "v$ResolvedVersion"
}

function Get-InstallerFileName([string]$ResolvedVersion, [string]$TargetArch) {
  return "banhangoffline-setup-v$ResolvedVersion-$TargetArch.exe"
}

function Get-ManifestInstaller($Manifest, [string]$TargetArch) {
  if ($Manifest.installers -and $Manifest.installers.PSObject.Properties.Name -contains $TargetArch) {
    return $Manifest.installers.$TargetArch
  }
  if ([string]$Manifest.arch -eq $TargetArch) {
    return [pscustomobject]@{
      arch = [string]$Manifest.arch
      platform = [string]$Manifest.platform
      fileName = Split-Path ([string]$Manifest.url) -Leaf
      url = [string]$Manifest.url
      sha256 = [string]$Manifest.sha256
      size = [Int64]$Manifest.size
      installerType = [string]$Manifest.installerType
    }
  }
  throw "update-manifest.json không có installer cho kiến trúc $TargetArch."
}

function Assert-InstallerContentType([string]$Url, [string]$ContentType) {
  $normalized = ([string]$ContentType).ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    Write-Warning "Không có Content-Type cho $Url; tiếp tục kiểm tra file tải về bằng MZ/PE và hash."
    return
  }
  if ($normalized -match 'text/html|application/xhtml\+xml') {
    throw "URL $Url trả Content-Type '$ContentType', có khả năng là trang HTML thay vì installer."
  }
  if ($normalized -notmatch 'application/octet-stream|application/x-msdownload|application/vnd\.microsoft\.portable-executable|binary|application/x-msdos-program') {
    Write-Warning "Content-Type '$ContentType' không phổ biến cho .exe tại $Url; tiếp tục kiểm tra MZ/PE và hash."
  }
}

function Get-PeHeaderInfo([string]$FilePath) {
  $stream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  try {
    if ($stream.Length -lt 64) { throw "File quá nhỏ để là PE hợp lệ: $FilePath" }
    $reader = New-Object System.IO.BinaryReader($stream)
    $mz = $reader.ReadBytes(64)
    if ($mz[0] -ne 0x4D -or $mz[1] -ne 0x5A) { throw "File không có header MZ: $FilePath" }
    $peOffset = [BitConverter]::ToInt32($mz, 0x3C)
    if ($peOffset -lt 64 -or $peOffset -gt ($stream.Length - 6)) { throw "PE offset không hợp lệ ($peOffset): $FilePath" }
    $stream.Seek($peOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
    $pe = $reader.ReadBytes(6)
    if ($pe[0] -ne 0x50 -or $pe[1] -ne 0x45 -or $pe[2] -ne 0x00 -or $pe[3] -ne 0x00) { throw "File không có signature PE đúng: $FilePath" }
    $machine = [BitConverter]::ToUInt16($pe, 4)
    $machineArch = switch ($machine) {
      0x014c { 'ia32' }
      0x8664 { 'x64' }
      0xaa64 { 'arm64' }
      default { "unknown-0x{0:x4}" -f $machine }
    }
    return [pscustomobject]@{
      mz = $true
      pe = $true
      peOffset = $peOffset
      machine = ("0x{0:x4}" -f $machine)
      arch = $machineArch
    }
  } finally {
    $stream.Dispose()
  }
}

function Assert-InstallerFile([string]$FilePath, [string]$ExpectedSha256, [Int64]$ExpectedSize, [string]$TargetArch) {
  if (-not (Test-Path $FilePath)) { throw "Không tìm thấy installer: $FilePath" }
  $item = Get-Item $FilePath
  if ($item.Length -lt $MinInstallerBytes) { throw "Installer $FilePath quá nhỏ ($($item.Length) bytes), có thể bị rỗng/truncate." }
  if ($ExpectedSize -gt 0 -and $item.Length -ne $ExpectedSize) { throw "Size mismatch $FilePath. Actual=$($item.Length), Expected=$ExpectedSize" }
  $pe = Get-PeHeaderInfo $FilePath
  if ($TargetArch -eq 'ia32' -and $pe.arch -ne 'ia32') { throw "Installer ia32 phải là PE ia32 để chạy trên Windows 32-bit. Actual=$($pe.arch), File=$FilePath" }
  if ($TargetArch -eq 'x64' -and $pe.arch -notin @('x64', 'ia32')) { throw "Installer x64 có PE machine không hợp lệ: $($pe.arch), File=$FilePath" }
  $hash = (Get-FileHash $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256) -and $hash -ne ([string]$ExpectedSha256).ToLowerInvariant()) {
    throw "SHA256 mismatch $FilePath. Actual=$hash, Expected=$ExpectedSha256"
  }
  Write-Host "OK $TargetArch local file: $FilePath"
  Write-Host "  Size: $($item.Length)"
  Write-Host "  PE: MZ=$($pe.mz), PE=$($pe.pe), Machine=$($pe.machine), Arch=$($pe.arch)"
  Write-Host "  SHA256: $hash"
}

function Invoke-HeadRequest([string]$Url) {
  try {
    return Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -MaximumRedirection 5 -Headers @{ 'User-Agent' = 'kha-release-installer-verify' } -TimeoutSec 60
  } catch {
    throw "HEAD thất bại cho $Url. $($_.Exception.Message)"
  }
}

function Invoke-DownloadFile([string]$Url, [string]$OutFile) {
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -MaximumRedirection 5 -Headers @{ 'User-Agent' = 'kha-release-installer-verify' } -TimeoutSec 180 | Out-Null
  } catch {
    throw "Download thất bại cho $Url. $($_.Exception.Message)"
  }
}

function Test-LocalRelease([string]$ResolvedVersion) {
  $manifestPath = Join-Path $ReleaseDir 'update-manifest.json'
  $latestPath = Join-Path $ReleaseDir 'latest.yml'
  if (-not (Test-Path $manifestPath)) { throw "Thiếu $manifestPath" }
  if (-not (Test-Path $latestPath)) { throw "Thiếu $latestPath" }

  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ([string]$manifest.version -ne $ResolvedVersion) { throw "Manifest version '$($manifest.version)' không khớp '$ResolvedVersion'." }
  $latestContent = Get-Content $latestPath -Raw
  if ($latestContent -notmatch "(?m)^version:\s*$([regex]::Escape($ResolvedVersion))\s*$") { throw "latest.yml không có version $ResolvedVersion." }

  foreach ($targetArch in $Arch) {
    $installerInfo = Get-ManifestInstaller $manifest $targetArch
    $fileName = if (-not [string]::IsNullOrWhiteSpace($installerInfo.fileName)) { [string]$installerInfo.fileName } else { Get-InstallerFileName $ResolvedVersion $targetArch }
    if ($fileName -notmatch "-$([regex]::Escape($targetArch))\.exe$") { throw "Tên installer chưa rõ kiến trúc ${targetArch}: $fileName" }
    if ($latestContent -notmatch [regex]::Escape($fileName)) { throw "latest.yml không tham chiếu $fileName." }
    $installerPath = Join-Path $ReleaseDir $fileName
    $blockmapPath = "$installerPath.blockmap"
    if (-not (Test-Path $blockmapPath)) { throw "Thiếu blockmap: $blockmapPath" }
    Assert-InstallerFile -FilePath $installerPath -ExpectedSha256 ([string]$installerInfo.sha256) -ExpectedSize ([Int64]$installerInfo.size) -TargetArch $targetArch
  }
}

function Test-RemoteRelease([string]$ResolvedVersion, [string]$ResolvedTag) {
  $base = "https://github.com/$Owner/$Repo/releases/download/$ResolvedTag"
  $latestUrl = "$base/latest.yml"
  $manifestUrl = "$base/update-manifest.json"
  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("kha-release-verify-" + [System.Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDir | Out-Null
  try {
    foreach ($url in @($latestUrl, $manifestUrl)) {
      $head = Invoke-HeadRequest $url
      if ([int]$head.StatusCode -ne 200) { throw "HTTP $($head.StatusCode) cho $url" }
      $contentType = [string]$head.Headers['Content-Type']
      if ($contentType -match 'text/html') { throw "$url trả HTML thay vì metadata release." }
      Write-Host "OK metadata HEAD $url ($contentType)"
    }

    $latestPath = Join-Path $tempDir 'latest.yml'
    $manifestPath = Join-Path $tempDir 'update-manifest.json'
    Invoke-DownloadFile $latestUrl $latestPath
    Invoke-DownloadFile $manifestUrl $manifestPath
    $latestContent = Get-Content $latestPath -Raw
    if ($latestContent -notmatch "(?m)^version:\s*$([regex]::Escape($ResolvedVersion))\s*$") { throw "Remote latest.yml không có version $ResolvedVersion." }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ([string]$manifest.version -ne $ResolvedVersion) { throw "Remote manifest version '$($manifest.version)' không khớp '$ResolvedVersion'." }

    foreach ($targetArch in $Arch) {
      $installerInfo = Get-ManifestInstaller $manifest $targetArch
      $installerUrl = [string]$installerInfo.url
      if ([string]::IsNullOrWhiteSpace($installerUrl)) { throw "Manifest remote thiếu URL installer $targetArch." }
      if ($installerUrl -notmatch "-$([regex]::Escape($targetArch))\.exe$") { throw "URL installer chưa rõ kiến trúc ${targetArch}: $installerUrl" }
      if ($latestContent -notmatch [regex]::Escape((Split-Path $installerUrl -Leaf))) { throw "Remote latest.yml không tham chiếu installer ${targetArch}: $installerUrl" }
      $head = Invoke-HeadRequest $installerUrl
      if ([int]$head.StatusCode -ne 200) { throw "HTTP $($head.StatusCode) cho $installerUrl" }
      Assert-InstallerContentType -Url $installerUrl -ContentType ([string]$head.Headers['Content-Type'])
      $contentLength = [Int64]0
      if ($head.Headers['Content-Length']) { [Int64]::TryParse(([string]$head.Headers['Content-Length']), [ref]$contentLength) | Out-Null }
      if ($contentLength -gt 0 -and [Int64]$installerInfo.size -gt 0 -and $contentLength -ne [Int64]$installerInfo.size) {
        throw "Remote Content-Length mismatch $installerUrl. Header=$contentLength, Manifest=$($installerInfo.size)"
      }
      $downloadedPath = Join-Path $tempDir (Split-Path $installerUrl -Leaf)
      Invoke-DownloadFile $installerUrl $downloadedPath
      Assert-InstallerFile -FilePath $downloadedPath -ExpectedSha256 ([string]$installerInfo.sha256) -ExpectedSize ([Int64]$installerInfo.size) -TargetArch $targetArch
    }
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$resolvedVersion = Resolve-ProjectVersion
$resolvedTag = Resolve-ProjectTag $resolvedVersion
Write-Host "Verifying Windows release. Mode=$Mode Version=$resolvedVersion Tag=$resolvedTag Arch=$($Arch -join ',')"

if ($Mode -in @('local', 'both')) { Test-LocalRelease $resolvedVersion }
if ($Mode -in @('remote', 'both')) { Test-RemoteRelease $resolvedVersion $resolvedTag }

Write-Host 'Release verification completed successfully.'
