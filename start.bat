@echo off
echo ================================================
echo GitHub Copilot API Server with Usage Viewer
echo ================================================
echo.

if not exist node_modules (
    echo Installing dependencies...
    npm install
    echo.
)

echo Starting server...
echo The usage viewer page will open automatically after the server starts
echo.

start "" "http://localhost:4141/public/usage.html"
npm run dev

pause
