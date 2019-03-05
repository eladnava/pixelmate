const url = require('url');
const path = require('path');
const { app, BrowserWindow, Menu, shell } = require('electron');

// Keep a global reference of the window object
let win;

// Called when Electron has finished initialization
app.on('ready', function createWindow() {
    // Create the main browser window
    win = new BrowserWindow({ width: 780, height: 585, title: 'Pixelmate', icon: __dirname + '/img/1.ico' });

    // Electron menu bar items
    const template = [
        {
            label: app.getName(),
            submenu: [
                {
                    label: 'All Storage Devices',
                    accelerator: 'CmdOrCtrl+Shift+A',
                    click() {
                        win.webContents.send('allStorageDevices');
                    }
                },
                { type: 'separator' },
                { label: 'Quit', role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'pasteandmatchstyle' },
                { role: 'delete' },
                { role: 'selectall' },
                { type: 'separator' },
                {
                    label: 'Speech',
                    submenu: [
                        { role: 'startspeaking' },
                        { role: 'stopspeaking' }
                    ]
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forcereload' },
                { role: 'toggledevtools' },
                { type: 'separator' },
                { role: 'resetzoom' },
                { role: 'zoomin' },
                { role: 'zoomout' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            role: 'window',
            submenu: [
                { role: 'close' },
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                { role: 'front' },
                { role: 'hide' },
                { role: 'hideothers' },
                { role: 'unhide' },
                { type: 'separator' },
            ]
        },
        {
            role: 'help',
            submenu: [
                {
                    label: 'GitHub Project',
                    click() { shell.openExternal('https://github.com/eladnava/pixelmate') }
                },
                {
                    label: 'Report an Issue',
                    click() { shell.openExternal('https://github.com/eladnava/pixelmate/issues/new') }
                }
            ]
        }
    ];

    // Set window menu bar
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    // Development or production browser URL based on ENV variable
    const startUrl = process.env.URL || url.format({
        pathname: path.join(__dirname, '/../build/index.html'),
        protocol: 'file:',
        slashes: true
    });

    // Load the target URL
    win.loadURL(startUrl);

    // Open the DevTools automatically
    // win.webContents.openDevTools();

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
