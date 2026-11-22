@echo off
rem Efface tout ce qui a ete saisi dans la demonstration et repart des donnees d'exemple.
title Remise a zero de la demonstration DBS-ASSURANCES
cd /d "%~dp0"
echo.
echo  Tout ce que vous avez saisi dans la demonstration sera efface,
echo  et les donnees d'exemple reviendront.
echo.
set /p REPONSE= Continuer ? Tapez o puis Entree : 
if /i not "%REPONSE%"=="o" (
  echo  Rien n'a ete efface.
  pause
  exit /b 0
)
docker compose -f compose.yml down -v
call "%~dp0demarrer.bat"
