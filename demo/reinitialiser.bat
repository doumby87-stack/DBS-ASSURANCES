@echo off
chcp 65001 >nul
title Remise à zéro de la démonstration DBS-ASSURANCES
cd /d "%~dp0"
echo.
echo  Tout ce que vous avez saisi dans la démonstration sera effacé,
echo  et les données d'exemple reviendront.
echo.
set /p REPONSE= Continuer ? Tapez o puis Entrée : 
if /i not "%REPONSE%"=="o" (
  echo  Rien n'a été effacé.
  pause
  exit /b 0
)
docker compose -f compose.yml down -v
call "%~dp0demarrer.bat"
