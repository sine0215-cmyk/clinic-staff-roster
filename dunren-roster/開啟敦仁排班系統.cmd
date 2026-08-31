@echo off
setlocal
set "APP=%~dp0index.html"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "敦仁診所四週排班系統" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%APP%"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "敦仁診所四週排班系統" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%APP%"
) else (
  start "敦仁診所四週排班系統" "%APP%"
)
endlocal
