@echo off
REM ============================================================
REM  Preview the SWBA site locally. Pages are never cached, so
REM  you always see the latest run. Close this window to stop.
REM ============================================================
cd /d "%~dp0"
set "PY=python"
where py >nul 2>nul && set "PY=py"
%PY% "%~dp0SWBA_Index.py" --preview
pause
