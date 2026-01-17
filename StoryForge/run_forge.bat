@echo off
title StoryForge Server
echo Starting StoryForge...

:: Launch the web page in the default browser after a 3-second delay 
:: to give the Flask server a moment to initialize.
start "" http://127.0.0.1:5001/

:: Start the Flask server using the Python interpreter.
:: We use 'python' directly so the CMD window stays active to show 
:: charactergen logs and Flask debug output.
python app.py

:: If the server crashes or is stopped, keep the window open.
pause