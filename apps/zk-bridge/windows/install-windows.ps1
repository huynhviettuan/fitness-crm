#Requires -RunAsAdministrator
<#
  Flow Fitness - cai dat cau noi ZKTeco tren may tinh Windows cua phong tap (docs/33, A-310).
  Installs the ZKTeco bridge on the gym's Windows computer.

  Chay trong PowerShell voi quyen Administrator, trong thu muc nay:
    powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

  Viec no lam / what it does:
    1. Kiem tra Node.js 22+ va file zk-bridge.json (checks Node.js and the settings)
    2. Kiem tra khoa voi CRM (--check) (checks each machine key against the CRM)
    3. Mo cong 8081 cho mang noi bo (opens the port for the local network only)
    4. Tao tac vu "Flow ZK Bridge": chay khi bat may, tu chay lai neu dung (starts at boot, restarted if it stops)
    5. Chi Administrators va SYSTEM doc duoc zk-bridge.json (the settings hold the keys)
#>
param([int]$Port = 0)

$ErrorActionPreference = 'Stop'
$TaskName = 'Flow ZK Bridge'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Join-Path $here 'zk-bridge.json'
$main = Join-Path $here 'main.js'
$log = Join-Path $here 'zk-bridge.log'

function Say([string]$text) { Write-Host "  $text" }

# 1. Node.js and the settings
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Chua cai Node.js 22 tro len (https://nodejs.org) / Node.js 22 or later is not installed' }
$major = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw "Node.js $major qua cu, can 22 tro len / Node.js 22 or later is needed" }
if (-not (Test-Path $config)) {
  throw 'Thieu zk-bridge.json: chep zk-bridge.example.json thanh zk-bridge.json va dien dia chi CRM, so se ri, khoa / zk-bridge.json is missing'
}
if ($Port -eq 0) { $Port = [int]((Get-Content $config -Raw | ConvertFrom-Json).listenPort) }
if ($Port -eq 0) { $Port = 8081 }
Say "Node.js: $node (v$major)"

# 2. The keys against the CRM
Say 'Kiem tra khoa voi CRM / checking the keys...'
& $node $main --config $config --check
if ($LASTEXITCODE -ne 0) { throw 'Kiem tra khong dat: xem dong LOI o tren / the check failed, see the LOI lines above' }

# 3. The firewall: the machine reaches this computer on the local network only
Get-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $TaskName -Direction Inbound -Protocol TCP -LocalPort $Port `
  -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
Say "Da mo cong $Port cho mang noi bo / port $Port open to the local network"

# 4. The task: at start-up, and every 5 minutes so it starts again if it stopped (never two at once)
$command = "`"$node`" `"$main`" --config `"$config`" >> `"$log`" 2>&1"
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$command`"" -WorkingDirectory $here
$atStartup = New-ScheduledTaskTrigger -AtStartup
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atStartup, $watchdog) `
  -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Say "Da tao va chay tac vu '$TaskName' / task created and started"

# 5. The settings hold the keys: Administrators and SYSTEM only
& icacls $config /inheritance:r /grant:r 'SYSTEM:(R)' 'Administrators:(F)' | Out-Null
Say 'Chi Administrators va SYSTEM doc duoc zk-bridge.json / settings readable by Administrators and SYSTEM only'

Start-Sleep -Seconds 3
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
  Say "Cau noi dang chay: dang cho gui $($health.waiting) luot quet / the bridge is running"
} catch {
  Say "Chua thay cau noi tra loi; xem $log / no answer yet, see the log"
}
Say "Tiep theo: tren may cham cong, dat may chu = dia chi IP cua may tinh nay, cong $Port, tat HTTPS (docs/33 muc 3)."
