@echo off
chcp 65001 >nul
title Démonstration DBS-ASSURANCES
cd /d "%~dp0"
echo.
echo  Démonstration DBS-ASSURANCES
echo  ============================
echo.
docker info >nul 2>&1
if errorlevel 1 (
  echo  Docker Desktop n'est pas ouvert, ou pas encore prêt.
  echo  Ouvrez Docker Desktop, attendez qu'il indique « Engine running », puis recommencez.
  echo.
  pause
  exit /b 1
)
echo  Préparation en cours. La première fois, comptez 5 à 15 minutes ; ensuite, une minute environ.
echo.
docker compose -f compose.yml up -d --build --wait
if errorlevel 1 (
  echo.
  echo  Le démarrage a échoué. Ouvrez le guide DEMARRER.md, partie « En cas de problème ».
  echo.
  pause
  exit /b 1
)
start "" http://localhost:8080
echo.
echo  C'est prêt : la page http://localhost:8080 vient de s'ouvrir dans votre navigateur.
echo  Vous pouvez fermer cette fenêtre. Pour arrêter la démonstration : double-cliquez sur arreter.bat
echo.
pause
