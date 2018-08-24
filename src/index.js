import $ from 'jquery';
import adb from './util/adb';
import human from './util/human';
import ReactDOM from 'react-dom';
import React, { Component } from 'react';

import './index.css';

import fileIcon from './img/file.png';
import arrow from './img/arrow.png';
import folderIcon from './img/folder.png';
// const fs = require("fs");
// const fileIcon = fs.readFileSync('./img/')

console.log("platform: " + window.require('os').platform())

const electron = window.require('electron');
const ipcRenderer = electron.ipcRenderer;

const shell = electron.shell;
const { remote } = electron;
const { app, Menu, MenuItem } = remote;

class App extends Component {
    constructor(props) {
        super(props);

        // Initial app state
        this.state = {
            listings: [],
            path: ['sdcard'],
            status: 'Ready',
            selectedIndex: -1,
            sessionId: new Date().toDateString()
        };

        // Listen for 'allStorageDevices' event from IPC main
        ipcRenderer.on('allStorageDevices', (event, message) => {
                // Set path to /storage
                this.setState({ path: ['storage'] });

                // Reload listings
                this.reloadListings();
          })
    }

    componentDidUpdate() {
        // Focus any new folder / name edit inputs
        $('input').focus();
    }

    async componentDidMount() {
        // Load listings
        this.reloadListings();

        // Prepare listing context menu
        const contextMenu = new Menu();

        // Add listing context menus
        contextMenu.append(new MenuItem({ label: 'Get Size', click: this.getSelectedListingSize.bind(this) }));
        contextMenu.append(new MenuItem({ label: 'Download', click: this.downloadSelectedListing.bind(this) }));
        contextMenu.append(new MenuItem({ type: 'separator' }));
        contextMenu.append(new MenuItem({ label: 'Delete', click: this.deleteSelectedListing.bind(this) }));

        // Prepare generic context menu
        const contextMenuNoSelection = new Menu();

        // Add generic context menu actions
        contextMenuNoSelection.append(new MenuItem({ label: 'Refresh', click: this.reloadListings.bind(this) }));
        contextMenuNoSelection.append(new MenuItem({ type: 'separator' }));
        contextMenuNoSelection.append(new MenuItem({ label: 'Calculate Sizes', click: this.getAllFolderSizes.bind(this) }));

        // Listen for context menu event
        $('html').on('contextmenu', (event) => {
            // Prevent default browser action
            event.preventDefault();

            // Display relevant context menu based on valid listing selection
            this.isSelectionValid() ? contextMenu.popup(remote.getCurrentWindow(), { async: true }) : contextMenuNoSelection.popup(remote.getCurrentWindow(), { async: true });
        });

        // Prevent default browser action for dragover event
        $('html').on('dragover', function (event) {
            event.preventDefault();
        });

        // Prevent default browser action for dragleave event
        $('html').on('dragleave', function (event) {
            event.preventDefault();
        });

        // Handle item drop event
        $('html').on('drop', async (event) => {
            // Prevent default browser action for drop event
            event.preventDefault();

            // Traverse dropped listings
            for (let item of event.originalEvent.dataTransfer.files) {
                // Get split path of item that was dropped in
                let splitPath = item.path.split('/');

                // Get item name from split path
                let itemName = splitPath[splitPath.length - 1];

                // If no item type specified, the item is a folder
                if (!item.type) {
                    itemName += '/';
                }

                // Build local and remote paths
                let localPath = item.path;
                let remotePath = `/${this.state.path.join('/')}/${itemName}`;

                // Update status message
                this.setState({ status: `Uploading ${itemName}` });

                try {
                    // Push item via adb
                    await adb.push(localPath, remotePath, this.onCommandOutput.bind(this));
                }
                catch (err) {
                    // Display error
                    return alert(err.message);
                }
            }

            // Reload listings
            this.reloadListings();

            // Done
            return false;
        });

        // Listen for window keydown event
        $(window).keydown((e) => {
            // Arrow up?
            if (e.keyCode === 38) {
                // Command pressed?
                if (e.metaKey) {
                    // Go back
                    return this.back();
                }

                // Can we scroll up?
                if (this.state.selectedIndex > 0) {
                    // Select listing above
                    return this.setState({ selectedIndex: --this.state.selectedIndex });
                }

                // No selection?
                if (this.state.selectedIndex === -1) {
                    // Select last listing
                    return this.setState({ selectedIndex: this.state.listings.length - 1 });
                }
            }

            // Arrow down?
            if (e.keyCode === 40) {
                // Command pressed?
                if (e.metaKey) {
                    return this.enterOrDownloadSelection();
                }

                // Can we scroll down?
                if (this.state.selectedIndex < this.state.listings.length - 1) {
                    // Select listing below
                    return this.setState({ selectedIndex: ++this.state.selectedIndex });
                }
            }

            // Backspace?
            if (e.keyCode === 8) {
                // Command pressed?
                if (e.metaKey) {
                    // Delete it
                    return this.deleteSelectedListing();
                }

                // Go back
                return this.back();
            }

            // Command + Shift + N?
            if (e.metaKey && e.shiftKey && e.keyCode === 'N'.charCodeAt(0)) {
                // Not currently editing another listing?
                if (!this.isEditing()) {
                    // Create a new 'fake' folder
                    this.state.listings.push({
                        name: '',
                        size: 0,
                        date: '',
                        new: true,
                        editing: true,
                        folder: true
                    });

                    // Update listings list and set selected listing to new fake folder
                    this.setState({ listings: this.state.listings, selectedIndex: this.state.listings.length - 1 });
                }
            }

            // Command + Option + I?
            if (e.metaKey && e.altKey && e.keyCode === 'I'.charCodeAt(0)) {
                // Open Chrome DevTools
                remote.getCurrentWindow().webContents.openDevTools();
            }

            // Command + R?
            if (e.metaKey && e.keyCode === 'R'.charCodeAt(0)) {
                // Production mode?
                if (window.location.hostname !== 'localhost') {
                    // Not loading listings?
                    if (!this.state.loading) {
                        // Reload listings
                        return this.reloadListings();
                    }
                }
            }

            // Enter?
            if (e.keyCode === 13) {
                // Valid selection?
                if (this.isSelectionValid()) {
                    // Already editing?
                    if (this.isEditing()) {
                        // Save edits
                        return this.saveEdits();
                    }

                    // Set editing flag
                    this.state.listings[this.state.selectedIndex].editing = true;

                    // Update listings list
                    this.setState({ listings: this.state.listings });
                }
            }

            // Escape?
            if (e.keyCode === 27) {
                // Editing?
                if (this.isEditing()) {
                    // Stop
                    this.stopEditing();
                }
            }

            // Not editing?
            if (!this.isEditing()) {
                // Traverse listings
                for (var idx in this.state.listings) {
                    // Get current listing
                    var listing = this.state.listings[idx];

                    // Attempt to find the first listing with this char code
                    if (listing.name.length > 0 && listing.name.toUpperCase().charCodeAt(0) === e.keyCode) {
                        // Select first match
                        this.setState({ selectedIndex: parseInt(idx, 10) });
                        return;
                    }
                }
            }
        });
    }

    stopEditing() {
        // Not editing?
        if (!this.isEditing()) {
            return;
        }

        // Get listing being edited
        let listing = this.getEditedListing();

        // No longer editing
        listing.editing = false;

        // Tried creating a new folder?
        if (listing.new) {
            // Find its index
            let idx = this.state.listings.indexOf(listing);

            // Remove it
            this.state.listings.splice(idx, 1);
        }

        // Update listings list
        this.setState({ listings: this.state.listings });
    }

    isSelectionValid() {
        // Check whether selection is a valid element in the listings array
        return this.state.selectedIndex > -1 && this.state.selectedIndex < this.state.listings.length;
    }

    getSelectedListing() {
        // Return listing by index
        return this.state.listings[this.state.selectedIndex];
    }

    getEditedListing() {
        // Traverse listings
        for (let listing of this.state.listings) {
            // Is it being edited?
            if (listing.editing) {
                // Return it
                return listing;
            }
        }

        // Not editing any listings
        return null;
    }

    isEditing() {
        // Check whether a listing was returned with the "editing" flag
        return this.getEditedListing() != null;
    }

    async deleteSelectedListing() {
        // Valid selection?
        if (this.isSelectionValid()) {
            // Get selected listing object
            let listing = this.getSelectedListing();

            // Build remote path to it
            let listingPath = `/${this.state.path.join('/')}/${listing.name}`;

            // Is it a folder?
            if (listing.folder) {
                // Append trailing slash
                listingPath += '/';
            }

            // Confirm with user
            if (!window.confirm(`Are you sure you want to delete:\n${listingPath}`)) {
                return;
            }

            try {
                // Attempt to delete the listing
                await adb.rm(listingPath, this.onCommandOutput.bind(this));
            }
            catch (err) {
                // Display error
                return alert(err.message);
            }

            // Find listing's index in the listings list
            let idx = this.state.listings.indexOf(listing);

            // Remove listing from array
            this.state.listings.splice(idx, 1);

            // Update status message and listings list
            this.setState({ status: listing.folder ? 'Folder deleted' : 'File deleted', listings: this.state.listings });
        }
    }

    async getAllFolderSizes() {
        // Update status message
        this.setState({ status: 'Calculating...' });

        // Traverse listings
        for (var listing of this.state.listings) {
            // Is it a folder?
            if (listing.folder) {
                // Calculate its size
                listing.size = await adb.du(`/${this.state.path.join('/')}/${listing.name}`);
            }
        }

        // Update status message and listings list
        this.setState({ status: 'Done', listings: this.state.listings });
    }

    async getSelectedListingSize() {
        // Valid selection?
        if (this.isSelectionValid()) {
            // Get selected listing
            let listing = this.getSelectedListing();

            // Build remote path to selected listing
            let remotePath = `/${this.state.path.join('/')}/${listing.name}`;

            // Update status message
            this.setState({ status: `Calculating size of ${listing.name}...` });

            try {
                // Calculate listing size
                listing.size = await adb.du(remotePath, this.onCommandOutput.bind(this));
            }
            catch (err) {
                // Display error
                return alert(err.message);
            }

            // Update status message and listings list
            this.setState({ listings: this.state.listings, status: `Done` });
        }
    }

    async downloadSelectedListing(options) {
        // Valid selection?
        if (this.isSelectionValid()) {
            // Get selected listing
            let listing = this.getSelectedListing();

            // Build path to remote listing
            let remotePath = `/${this.state.path.join('/')}/${listing.name}`;

            // Build target download local path
            let localPath = `${app.getPath('downloads')}/Pixelmate/${this.state.sessionId}/${listing.name}`;

            // If listing is a folder, append a trailing slash
            if (listing.folder) {
                localPath += '/';
            }

            // Update status message
            this.setState({ status: `Downloading ${remotePath}` });

            try {
                // Pull the listing
                await adb.pull(remotePath, localPath, this.onCommandOutput.bind(this));
            }
            catch (err) {
                // Display error
                return alert(err.message);
            }

            // Open the listing after downloading?
            if (options.open) {
                // Use default OSX handler to open the listing
                shell.openItem(localPath);
            }
            else {
                // Show the item in its download location instead
                shell.showItemInFolder(localPath);
            }
        }
    }

    onCommandOutput(output) {
        // Update status message
        this.setState({ status: output });
    }

    navigateIn() {
        // Valid selection?
        if (this.isSelectionValid()) {
            // Get selected listing
            let listing = this.state.listings[this.state.selectedIndex];

            // Folder?
            if (listing.folder) {
                // Append to path and reload listings
                this.state.path.push(listing.name);

                // Update state with new path list
                this.setState({ path: this.state.path });

                // Reload listings
                return this.reloadListings();
            }
        }
    }

    back() {
        // Not in root /?
        if (this.state.path.length > 1) {
            // Not loading listings?
            if (!this.state.loading) {
                // Navigate backwards
                this.state.path.pop();

                // Reload listings
                this.reloadListings();

            }
        }
    }

    async saveEdits() {
        // Get listing being edited
        let listing = this.getEditedListing();

        // Get new name for this listing
        let newName = listing.input.value;

        // New name is exactly the same?
        if (listing.name === newName) {
            // User didn't change anything
            return this.stopEditing();
        }

        try {
            // New folder?
            if (listing.folder && listing.new) {
                // Empty?
                if (newName.trim() === '') {
                    return;
                }

                // Create a new folder!
                return await this.createNewFolder(listing, newName);
            }

            // Rename existing listing
            await this.renameListing(listing, newName);
        }
        catch (err) {
            // Display error
            return alert(err.message);
        }
    }

    async renameListing(listing, newName) {
        // Traverse existing listings
        for (let tmp of this.state.listings) {
            // Another listing already exists with this name?
            if (tmp.name === newName) {
                throw new Error('A listing with this name already exists.');
            }
        }

        // Attempt to rename the listing
        await adb.mv(`/${this.state.path.join('/')}/${listing.name}`, `/${this.state.path.join('/')}/${newName}`, this.onCommandOutput.bind(this));

        // Update name
        listing.name = newName;
        listing.editing = false;

        // Update status message and listings list
        this.setState({ status: listing.folder ? 'Folder renamed' : 'File renamed', listings: this.state.listings });
    }

    async createNewFolder(listing, name) {
        // Traverse existing listings
        for (let tmp of this.state.listings) {
            // Another listing already exists with this name?
            if (tmp.name === name) {
                throw new Error('A file or folder with this name already exists.');
            }
        }

        // Attempt to create the new folder
        await adb.mkdir(`/${this.state.path.join('/')}/${name}`, this.onCommandOutput.bind(this));

        // Set folder name
        listing.name = name;

        // No longer a new folder, nor are we editing
        listing.new = false;
        listing.editing = false;

        // Update status message and listings list
        this.setState({ status: 'Folder created', listings: this.state.listings });
    }

    async reloadListings() {
        // Loading indicator
        this.setState({ loading: true, listings: [], selectedIndex: -1, status: 'Loading...' });

        // Prepare listings array
        let listings;

        try {
            // Attempt to fetch listings
            listings = await adb.ls(`/${this.state.path.join('/')}/`);
        }
        catch (err) {
            // No longer loading
            this.setState({ loading: false, status: 'Error loading listings' });

            // Display error
            return alert(err.message + '\n\nPlease refresh the page and try again.');
        }

        // Reset listing container scrollbar position
        $('.listing-container').scrollTop(0);

        // Update app state
        this.setState({ loading: false, listings: listings, status: `${listings.length} listings` });
    }

    render() {
        // Component layout
        return (
            <div className="listing-container">
                <table className="listings">
                    <tbody>
                        <tr onMouseDown={() => this.selectListingByIndex(-1)}>
                            <th width="60%">Name</th>
                            <th>Date Modified</th>
                            <th>Size</th>
                        </tr>
                        {this.renderListings.bind(this)()}
                    </tbody>
                </table>
                <div className="status-bar">
                    {this.state.status}
                </div>
            </div>
        );
    }

    renderListings() {
        // Listings HTML elements array
        let listings = [];

        // Traverse listings
        for (let idx in this.state.listings) {
            // Get current listing
            let listing = this.state.listings[idx];

            // Build <tr> for this listing
            listings.push(
                <tr className={parseInt(idx, 10) === this.state.selectedIndex ? 'listing selected' : 'listing'} key={listing.name} name={listing.name} onMouseDown={() => this.selectListingByIndex(idx)} onDoubleClick={() => this.enterOrDownloadSelection()}>
                    <td>
                        {listing.folder && <img src={arrow} height="11" className="arrow" alt="arrow" />}
                        {listing.folder && <img src={folderIcon} width="17" className="folder" alt="folder" />}
                        {!listing.folder && <img src={fileIcon} width="18" className="file" alt="file" />}

                        {listing.editing && <input type="text" ref={(input) => { listing.input = input }} defaultValue={listing.name} size="30" />}

                        {!listing.editing && listing.name}
                    </td>
                    <td className="faded">
                        {listing.date}
                    </td>
                    <td className="faded right">
                        {listing.size > 0 ? human.getReadableListingSize(listing.size) : '--'}
                    </td>
                </tr>
            );
        }

        // If there are less listings than this number, add empty ones (for an alternating row effect)
        let minListings = 23;

        // If there are less listings than this number, add empty ones (for an alternating row effect)
        if (listings.length < minListings) {
            // Add the difference in listings
            for (let i = listings.length; i < minListings; i++) {
                // Add empty listing <tr> item
                listings.push(
                    <tr className='listing' key={i} onMouseDown={() => this.selectListingByIndex(-1)}>
                        <td></td>
                        <td></td>
                        <td></td>
                    </tr>
                );
            }
        }

        // Return listing elements
        return listings;
    }

    selectListingByIndex(idx) {
        // Update state with new selected index
        this.setState({ selectedIndex: parseInt(idx, 10) });
    }

    enterOrDownloadSelection() {
        // Make sure selection is valid
        if (this.isSelectionValid()) {
            // Fetch selected listing
            let listing = this.getSelectedListing();

            // Folder?
            if (listing.folder) {
                // Navigate into folder
                this.navigateIn();
            }
            else {
                // Attempt to download and open the listing
                this.downloadSelectedListing({ open: true });
            }
        }
    }
}

// Render main component
ReactDOM.render(<App />, document.getElementById('root'));
