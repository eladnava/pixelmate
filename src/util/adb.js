const electron = window.require('electron');

const app = electron.remote.app;
const fs = electron.remote.require('fs');
const path = electron.remote.require('path');
const adb = electron.remote.require('adbkit');
const moment = electron.remote.require('moment');
const spawn = electron.remote.require('child_process').spawn;

// Create adb client and reuse it throughout app lifecycle
let client = adb.createClient({
    bin: pathToAdb()
});

export default {
    async pull(remotePath, localPath, outputListener) {
        // Validate adb device connectivity
        await this.getDevice();

        // Local file/folder already exists?
        if (fs.existsSync(localPath)) {
            throw new Error(`File or folder already exists locally: ${localPath}`);
        }

        // Pull remote file/folder to local path
        await this.execShellCommand(pathToAdb(), ['pull', this.escape(remotePath), this.escape(localPath)], outputListener);
    },

    async push(localPath, remotePath, outputListener) {
        // Validate adb device connectivity
        await this.getDevice();

        // Make sure remote file/folder doesn't exist
        let output = await this.execShellCommand(pathToAdb(), ['shell', 'ls', this.escape(remotePath)]);

        // Look for the 'no such file' error
        if (!output.includes('No such file')) {
            throw new Error('This file or folder already exists on the device.');
        }

        // Push local file/folder to remote path
        await this.execShellCommand(pathToAdb(), ['push', this.escape(localPath), this.escape(remotePath)], outputListener);
    },

    async mv(originalPath, newPath, outputListener) {
        // Validate adb device connectivity
        await this.getDevice();

        // Move the file/folder or rename it
        await this.execShellCommand(pathToAdb(), ['shell', 'mv', this.escape(originalPath), this.escape(newPath)], outputListener, true);
    },

    escape(path) {
        // Escape single quotes, double quotes, and spaces
        path = path.replace(/"/g, '\\"');
        path = path.replace(/ /g, '\\ ');
        path = path.replace(/'/g, '\\\'');

        // Return path
        return path;
    },

    async mkdir(remotePath, outputListener) {
        // Validate adb device connectivity
        await this.getDevice();

        // Create new folder
        await this.execShellCommand(pathToAdb(), ['shell', 'mkdir', this.escape(remotePath)], outputListener, true);
    },

    async rm(remotePath, outputListener) {
        // Validate adb device connectivity
        await this.getDevice();

        // Create new folder
        await this.execShellCommand(pathToAdb(), ['shell', 'rm', '-rf', this.escape(remotePath)], outputListener, true);
    },

    async du(remotePath, outputListener) {
        // Validate adb device connectivity
        await this.getDevice();

        // Execute du command
        let output = await this.execShellCommand(pathToAdb(), ['shell', 'du', '-s', this.escape(remotePath)]);

        // Parse output
        let parse = /(.+?)\t/g.exec(output);

        // Parse failed?
        if (parse.length === 0) {
            throw new Error('Parsing du command failed.');
        }

        // Get size in bytes
        let size = parse[1];

        // Convert to int
        return parseInt(size, 10);
    },

    async ls(path) {
        // Validate adb device connectivity
        let device = await this.getDevice();

        // Fetch folder listing using adbkit
        let listings = await client.readdir(device.id, path);

        // Strip out unnecessary properties
        listings = listings.map(function (listing) {
            // Return listing name, size in KB, formatted date, and whether it's a folder or not
            return {
                name: listing.name,
                folder: !listing.isFile(),
                size: listing.isDirectory() ? 0 : Math.round(listing.size / 1000),
                date: moment(listing.mtime).format('MMM DD, YYYY, hh:MM A')
            };
        });

        // Remove emulated storage listings
        listings = listings.filter(function (listing) {
            // Make sure path is /storage/
            return path !== '/storage/' || listing.name.indexOf('emulated') === -1;
        });

        // Sort listings alphabetically
        listings.sort(function (a, b) {
            // Current listing is a folder?
            if (a.folder && !b.folder) {
                return -1;
            }

            // Comparison is a folder?
            if (b.folder && !a.folder) {
                return 1;
            }

            // Sort listings by name ASC
            return a.name.localeCompare(b.name);
        });

        // Filter out listings based on a name blacklist
        listings = listings.filter(function (listing) {
            return ['.DS_Store'].indexOf(listing.name) === -1;
        });

        // All done
        return listings;
    },

    async getDevice() {
        // Fetch all connected adb devices
        let devices = await client.listDevices();

        // No device connected?
        if (devices.length === 0) {
            throw new Error('No device found.');
        }

        // Return first device (ignore others)
        return devices[0];
    },

    execShellCommand(binary, args, outputListener, outputMeansError) {
        // Promisify child_process.spawn command
        return new Promise((resolve, reject) => {
            // Spawn program with arguments
            let process = spawn(binary, args);

            // Keep track of program output
            let output = '';

            // Stdout/stderr listener
            let stdListener = function (data) {
                // Convert data to string
                data = data.toString();

                // Append to total program output
                output += `${data}\n`;

                // Provide data to output listener
                outputListener && outputListener(data.toString());
            };

            // Listen for stdout and stderr events
            process.stdout.on('data', stdListener);
            process.stderr.on('data', stdListener);

            // Process exit listener
            process.on('exit', function (code) {
                // Check exit code for success or failure
                if (code === 0) {
                    // Output means error?
                    if (output && outputMeansError) {
                        reject(new Error(`The operation failed:\n${output}`));
                    }
                    else {
                        // Operation successful
                        resolve(output);
                    }
                }
                else {
                    // Operation failed
                    reject(new Error(`The operation failed:\n${output}`));
                }
            });
        });
    }
}

function pathToAdb() {
    // OS X?
    if (window.require('os').platform() === "darwin") {
        // Resolve path to adb binary (bundled with pixelmate)
        return path.join(`${app.getAppPath()}/bin/adb`);
    }
    // Windows?
    else {
        // Resolve path to adb.exe binary (not bundled currently)
        return path.join(require('os').homedir(), "/AppData/Local/Android/Sdk/platform-tools/adb.exe")
    }
}
