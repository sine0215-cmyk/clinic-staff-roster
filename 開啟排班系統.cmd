@echo off
setlocal
set "APP=%~dp0index.html"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "醫療人員綜合排班" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%APP%"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "醫療人員綜合排班" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%APP%"
) else (
  start "醫療人員綜合排班" "%APP%"
)
endlocal
