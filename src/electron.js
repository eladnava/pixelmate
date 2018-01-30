const url = require('url');
const path = require('path');
const { app, BrowserWindow } = require('electron');

// Keep a global reference of the window object
let win;

// Called when Electron has finished initialization
app.on('ready', function createWindow() {
    // Create the main browser window
    win = new BrowserWindow({ width: 780, height: 585, title: 'Pixelmate', icon: __dirname + '/img/1.ico' });

    // Development or production browser URL based on ENV variable
    const startUrl = process.env.URL || url.format({
        pathname: path.join(__dirname, '/../build/index.html'),
        protocol: 'file:',
        slashes: true
    });

    // Load the target URL
    win.loadURL(startUrl);

    // Open the DevTools automatically
    //win.webContents.openDevTools();

    // Emitted when the window is closed
    win.on('closed', () => {
        // Dereference the window object for gc
        win = null;
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open
    if (win === null) {
        app.emit('ready');
    }
});