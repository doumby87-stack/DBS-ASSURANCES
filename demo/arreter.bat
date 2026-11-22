@echo off
rem Arrete la demonstration DBS-ASSURANCES ; les donnees sont gardees pour la prochaine fois.
title Arret de la demonstration DBS-ASSURANCES
cd /d "%~dp0"
echo.
echo  Arret de la demonstration DBS-ASSURANCES...
docker compose -f compose.yml down
echo.
echo  C'est arrete. Les donnees sont gardees pour la prochaine fois.
echo.
pause
