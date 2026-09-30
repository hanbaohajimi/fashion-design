[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$SkipInstall
)

$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding =
  [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$envExampleFile = Join-Path $projectRoot ".env.example"
$utf8NoBom = [Text.UTF8Encoding]::new($false)

function Write-Step {
  param([Parameter(Mandatory)][string]$Message)

  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-NativeCommand {
  param([Parameter(Mandatory)][string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandType -in @("Application", "ExternalScript") } |
    Select-Object -First 1

  if (-not $command) {
    throw "未找到 $Name，请先安装后重试。"
  }

  return $command.Source
}

function Invoke-Native {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "命令执行失败（退出码 $LASTEXITCODE）：$FilePath $($Arguments -join ' ')"
  }
}

function Test-DockerDaemon {
  param([Parameter(Mandatory)][string]$DockerCommand)

  & $DockerCommand info *> $null
  return $LASTEXITCODE -eq 0
}

function Start-DockerDesktop {
  $dockerDesktopCandidates = @(
    (Join-Path $env:ProgramFiles "Docker/Docker/Docker Desktop.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Docker/Docker/Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker/Docker Desktop.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  $dockerDesktop = $dockerDesktopCandidates | Select-Object -First 1
  if (-not $dockerDesktop) {
    throw "Docker 服务未运行，且未找到 Docker Desktop。请先启动 Docker Desktop。"
  }

  Write-Host "Docker 服务未运行，正在启动 Docker Desktop..." -ForegroundColor Yellow
  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
}

function Wait-DockerDaemon {
  param(
    [Parameter(Mandatory)][string]$DockerCommand,
    [int]$TimeoutSeconds = 180
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (Test-DockerDaemon -DockerCommand $DockerCommand) {
      return
    }

    Start-Sleep -Seconds 3
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "等待 Docker Desktop 就绪超时（$TimeoutSeconds 秒）。"
}

function Test-HttpEndpoint {
  param([Parameter(Mandatory)][string]$Uri)

  try {
    $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-TcpPort {
  param(
    [Parameter(Mandatory)][string]$HostName,
    [Parameter(Mandatory)][int]$Port,
    [int]$TimeoutMilliseconds = 500
  )

  $client = [Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.BeginConnect($HostName, $Port, $null, $null)
    return $connection.AsyncWaitHandle.WaitOne($TimeoutMilliseconds) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function ConvertFrom-EnvOutput {
  param([Parameter(Mandatory)][string[]]$Lines)

  $values = @{}
  foreach ($line in $Lines) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
      $value = $Matches[2].Trim()
      if ($value.Length -ge 2 -and $value[0] -eq '"' -and $value[-1] -eq '"') {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $values[$Matches[1]] = $value
    }
  }

  return $values
}

function Set-DotEnvValues {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][hashtable]$Values
  )

  $content = [IO.File]::ReadAllText($Path, $utf8NoBom)
  $newline = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }

  foreach ($name in $Values.Keys) {
    $escapedName = [Regex]::Escape($name)
    $replacement = "$name=$($Values[$name])"
    $pattern = "(?m)^$escapedName=.*$"

    if ([Regex]::IsMatch($content, $pattern)) {
      $content = [Regex]::Replace($content, $pattern, $replacement)
    } else {
      if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) {
        $content += $newline
      }
      $content += $replacement + $newline
    }
  }

  [IO.File]::WriteAllText($Path, $content, $utf8NoBom)
}

try {
  Set-Location -LiteralPath $projectRoot
  Write-Host "AI 服装设计平台 · 本地一键启动" -ForegroundColor Green

  Write-Step "检查运行环境"
  $node = Get-NativeCommand -Name "node.exe"
  $pnpm = Get-NativeCommand -Name "pnpm.cmd"
  $docker = Get-NativeCommand -Name "docker.exe"

  $nodeVersionText = (& $node --version).TrimStart("v")
  $nodeVersion = [Version]$nodeVersionText
  if ($nodeVersion -lt [Version]"22.12.0") {
    throw "Node.js 版本过低：v$nodeVersionText；项目要求 v22.12.0 或更高版本。"
  }
  Write-Host "Node.js v$nodeVersionText、pnpm 与 Docker 已找到。"

  if (-not (Test-DockerDaemon -DockerCommand $docker)) {
    Start-DockerDesktop
    Wait-DockerDaemon -DockerCommand $docker
  }
  Write-Host "Docker 已就绪。"

  if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Step "创建本地环境配置"
    Copy-Item -LiteralPath $envExampleFile -Destination $envFile
    Write-Host "已从 .env.example 创建 .env。"
  }

  if (-not $SkipInstall -and -not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules/.pnpm"))) {
    Write-Step "安装项目依赖"
    Invoke-Native $pnpm "install" "--frozen-lockfile"
  }

  Write-Step "启动 PostgreSQL、Redis 与 MinIO"
  Invoke-Native $pnpm "infra:up"

  Write-Step "启动本地 Supabase"
  & $pnpm "auth:start" *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "本地 Supabase 启动失败。可单独运行 pnpm auth:start 查看详细信息。"
  }
  Write-Host "Supabase 已就绪。"

  Write-Step "同步本地认证配置"
  $statusOutput = & $pnpm "exec" "supabase" "status" "-o" "env" 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "无法读取本地 Supabase 状态。"
  }

  $supabaseValues = ConvertFrom-EnvOutput -Lines $statusOutput
  $publishableKey = if ($supabaseValues.ContainsKey("PUBLISHABLE_KEY")) {
    $supabaseValues["PUBLISHABLE_KEY"]
  } else {
    $supabaseValues["ANON_KEY"]
  }

  if (-not $supabaseValues.ContainsKey("API_URL") -or [string]::IsNullOrWhiteSpace($publishableKey)) {
    throw "Supabase 状态中缺少 API_URL 或 publishable/anon key。"
  }

  Set-DotEnvValues -Path $envFile -Values @{
    SUPABASE_URL = $supabaseValues["API_URL"]
    SUPABASE_PUBLISHABLE_KEY = $publishableKey
  }
  Write-Host "已更新 .env 中的本地 Supabase 地址与公钥（密钥内容不会输出）。"

  Write-Step "应用数据库迁移"
  Invoke-Native $pnpm "db:migrate"

  $webUrl = "http://localhost:3000"
  $apiHealthUrl = "http://localhost:3001/health/ready"
  $webReady = Test-HttpEndpoint -Uri $webUrl
  $apiReady = Test-HttpEndpoint -Uri $apiHealthUrl

  if ($webReady -and $apiReady) {
    Write-Step "平台已经在运行"
    Write-Host "Web 与 API 均已就绪，无需重复启动。"
    if (-not $NoBrowser) {
      Start-Process $webUrl
    }
    return
  }

  $occupiedPorts = @()
  if (Test-TcpPort -HostName "127.0.0.1" -Port 3000) {
    $occupiedPorts += 3000
  }
  if (Test-TcpPort -HostName "127.0.0.1" -Port 3001) {
    $occupiedPorts += 3001
  }
  if ($occupiedPorts.Count -gt 0) {
    throw "端口 $($occupiedPorts -join '、') 已被其他或未完全启动的进程占用。请先关闭占用进程后重试。"
  }

  if (-not $NoBrowser) {
    $browserJob = Start-Job -ScriptBlock {
      param($Url)

      $deadline = [DateTime]::UtcNow.AddMinutes(3)
      do {
        try {
          $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
          if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
            Start-Process $Url
            return
          }
        } catch {
          Start-Sleep -Seconds 2
        }
      } while ([DateTime]::UtcNow -lt $deadline)
    } -ArgumentList $webUrl
  }

  Write-Step "启动 Web、API 与 Worker"
  Write-Host "Web: http://localhost:3000"
  Write-Host "API: http://localhost:3001/health/ready"
  Write-Host "按 Ctrl+C 可停止开发服务；Docker 与 Supabase 数据服务会继续保留。" -ForegroundColor Yellow
  Invoke-Native $pnpm "dev"
} catch {
  Write-Host ""
  Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if (Get-Variable -Name browserJob -ErrorAction SilentlyContinue) {
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
  }
}
