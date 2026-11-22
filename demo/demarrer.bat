@echo off
rem Demonstration DBS-ASSURANCES (Windows) : double-cliquez sur ce fichier.
rem Textes sans accents : selon sa version, l'invite de commandes de Windows les lit mal.
title Demonstration DBS-ASSURANCES
cd /d "%~dp0"
echo.
echo  Demonstration DBS-ASSURANCES
echo  ============================
echo.
docker info >nul 2>&1
if errorlevel 1 (
  echo  Docker Desktop n'est pas ouvert, ou pas encore pret.
  echo  Ouvrez Docker Desktop, attendez qu'il indique "Engine running", puis recommencez.
  echo.
  pause
  exit /b 1
)
echo  Preparation en cours. La premiere fois, comptez 5 a 15 minutes ; ensuite, une minute environ.
echo.
docker compose -f compose.yml up -d --build --wait
if errorlevel 1 goto echec
start "" http://localhost:8080
echo.
echo  C'est pret : la page http://localhost:8080 vient de s'ouvrir dans votre navigateur.
echo  Vous pouvez fermer cette fenetre. Pour arreter la demonstration : double-cliquez sur arreter.bat
echo.
pause
exit /b 0

:echec
echo.
echo  Le demarrage a echoue. Preparation du journal, patientez...
rem Le detail de l'erreur : construction (rejouee, le cache la rend rapide), etat et messages des conteneurs
> journal-demarrage.log echo Demonstration DBS-ASSURANCES : journal du demarrage
>> journal-demarrage.log docker version 2>&1
>> journal-demarrage.log docker compose version 2>&1
>> journal-demarrage.log docker compose --progress plain -f compose.yml build 2>&1
>> journal-demarrage.log docker compose -f compose.yml ps -a 2>&1
>> journal-demarrage.log docker compose -f compose.yml logs --no-color --tail 200 2>&1
echo.
echo  Le detail est dans le fichier journal-demarrage.log, ici, dans le dossier demo.
echo  Envoyez ce fichier a la personne qui developpe le projet.
echo  Voir aussi le guide DEMARRER.md, partie "En cas de probleme".
echo.
pause
exit /b 1
