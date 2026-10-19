@echo off
cd /d "%~dp0"
set "OFFSEASON="
choice /C YN /M "Is this sim for Offseason FA"
if errorlevel 2 goto run
set "OFFSEASON=--offseason"
:run
where py >nul 2>nul && (py "%~dp0SWBA_Index.py" "%~dp0." %OFFSEASON%) || (python "%~dp0SWBA_Index.py" "%~dp0." %OFFSEASON%)
pause
