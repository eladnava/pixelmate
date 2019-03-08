import $ from 'jquery';
import adb from './util/adb';
import human from './util/human';
import ReactDOM from 'react-dom';
import React, { Component } from 'react';

import './index.css';

import fileIcon from './img/file.png';
import arrow from './img/arrow.png';
import folderIcon from './img/folder.png';

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
            selectedIndexes: [],
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
        contextMenu.append(new MenuItem({ label: 'Get Size', click: this.getSelectedListingsSizes.bind(this) }));
        contextMenu.append(new MenuItem({ label: 'Download', click: this.downloadSelectedListings.bind(this) }));
        contextMenu.append(new MenuItem({ type: 'separator' }));
        contextMenu.append(new MenuItem({ label: 'Delete', click: this.deleteSelectedListings.bind(this) }));

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
            this.isMultiSelectionValid() ? contextMenu.popup(remote.getCurrentWindow(), { async: true }) : contextMenuNoSelection.popup(remote.getCurrentWindow(), { async: true });
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
                    
                    // Is this a media file?
                    if (this.isMediaFile(itemName)) {
                        // Notify media added
                        await adb.notifyMediaUpdated(remotePath);
                    }
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
            // Enter?
            if (e.keyCode === 13) {
                // Valid selection?
                if (this.isSingleSelectionValid()) {
                    // Already editing?
                    if (this.isEditing()) {
                        // Save edits
                        return this.saveEdits();
                    }

                    // Must have just one selection to edit
                    if (this.state.selectedIndexes.length !== 1) {
                        return;
                    }

                    // Set editing flag
                    this.state.listings[this.state.selectedIndexes[0]].editing = true;

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

            // Ignore the following hotkeys if currently editing
            if (this.isEditing()) {
                return true;
            }

            // Arrow up?
            if (e.keyCode === 38) {
                // Command pressed?
                if (e.metaKey) {
                    // Go back
                    return this.back();
                }

                // Multiselect?
                if (e.shiftKey) {
                    // Already have one selection?
                    if (this.state.selectedIndexes.length > 0) {
                        // Calculate next index to select/unselect
                        let prevSelectionIdx = this.state.lastSelectedIndex - 1;

                        // Valid idx?
                        if (prevSelectionIdx >= 0) {
                            // Is it already selected tho?
                            let checkAlreadySelected = this.state.selectedIndexes.indexOf(prevSelectionIdx);

                            // Unselect last selection if so
                            if (checkAlreadySelected !== -1) {
                                this.state.selectedindexes = this.state.selectedIndexes.splice(checkAlreadySelected + 1, 1);
                            }
                            else {
                                // Push index
                                this.state.selectedIndexes.push(prevSelectionIdx);
                            }

                            // Update UI
                            this.setSelectedIndexes(this.state.selectedIndexes, prevSelectionIdx);
                        }
                    }

                    // No further processing
                    return;
                }

                // Can we scroll up?
                if (this.state.selectedIndexes.length > 0 && this.state.selectedIndexes[0] >= 0) {
                    // Calcuate new index
                    let newIdx = --this.state.lastSelectedIndex;

                    // Fallback to first listing
                    if (newIdx === -1) {
                        newIdx = 0;
                    }

                    // Select listing above
                    return this.setSelectedIndexes([newIdx]);
                }

                // No selection?
                if (this.state.selectedIndexes.length === 0) {
                    // Select last listing
                    return this.setSelectedIndexes([this.state.listings.length - 1]);
                }
            }

            // Arrow down?
            if (e.keyCode === 40) {
                // Command pressed?
                if (e.metaKey) {
                    return this.enterOrDownloadSelection();
                }

                // Multiselect?
                if (e.shiftKey) {
                    // Already have one selection?
                    if (this.state.selectedIndexes.length > 0) {
                        // Calculate next index to select
                        let nextSelectionIdx = this.state.lastSelectedIndex + 1;

                        // Valid idx?
                        if (nextSelectionIdx < this.state.listings.length) {
                            // Is it already selected tho?
                            let checkAlreadySelected = this.state.selectedIndexes.indexOf(nextSelectionIdx);

                            // Unselect if so
                            if (checkAlreadySelected !== -1) {
                                this.state.selectedindexes = this.state.selectedIndexes.splice(checkAlreadySelected - 1, 1);
                            }
                            else {
                                // Push index
                                this.state.selectedIndexes.push(nextSelectionIdx);
                            }

                            // Update UI
                            this.setSelectedIndexes(this.state.selectedIndexes, nextSelectionIdx);
                        }
                    }

                    // No further processing
                    return;
                }

                // Can we scroll down?
                if (this.state.selectedIndexes.length > 0 && this.state.selectedIndexes[0] < this.state.listings.length - 1) {
                    // Select listing below
                    return this.setSelectedIndexes([++this.state.lastSelectedIndex]);
                }
                else if (this.state.selectedIndexes.length === 0 && this.state.listings.length > 0) {
                    // Select first listing
                    return this.setSelectedIndexes([0]);
                }
            }

            // Backspace?
            if (e.keyCode === 8) {
                // Command pressed?
                if (e.metaKey) {
                    // Delete it
                    return this.deleteSelectedListings();
                }

                // Go back
                return this.back();
            }

            // Command + Shift + N?
            if (e.metaKey && e.shiftKey && e.keyCode === 'N'.charCodeAt(0)) {
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
                this.setState({ listings: this.state.listings, selectedIndexes: [this.state.listings.length - 1] });
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

            // Command + A?
            if (e.metaKey && e.keyCode === 'A'.charCodeAt(0)) {
                // Select all listings
                this.setSelectedIndexes([...this.state.listings.keys()]);
                return;
            }

            // Traverse listings
            for (let idx in this.state.listings) {
                // Get current listing
                let listing = this.state.listings[idx];

                // Attempt to find the first listing with this char code
                if (listing.name.length > 0 && listing.name.toUpperCase().charCodeAt(0) === e.keyCode) {
                    // Select first match
                    this.setSelectedIndexes([idx]);
                    return;
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

    isMediaFile(name) {
        // Basic media extension check
        return name.match( /(\.mp3|\.mp4|\.aac|\.avi|\.mov|\.mkv|\.avc)/ );
    }

    isSingleSelectionValid() {
        // Check whether selection is a valid element in the listings array
        return this.state.selectedIndexes.length === 1 && this.state.selectedIndexes[0] < this.state.listings.length;
    }

    isMultiSelectionValid() {
        // Check whether selection is valid
        return this.state.selectedIndexes.length > 0 && this.state.selectedIndexes[0] < this.state.listings.length && this.state.selectedIndexes[this.state.selectedIndexes.length - 1] < this.state.listings.length;
    }

    getSelectedListing() {
        // Return listing by index
        return this.state.listings[this.state.selectedIndexes[0]];
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

    async deleteSelectedListings() {
        // Valid selection(s)?
        if (this.isMultiSelectionValid()) {
            // Multiple listings?
            if (this.state.selectedIndexes.length > 1) {
                // Confirm multiple item deletion
                if (!window.confirm(`Are you sure you want to delete ${this.state.selectedIndexes.length} items?`)) {
                    return;
                }
            }
            else {
                // Build remote path to single listing
                let listingPath = `/${this.state.path.join('/')}/${this.state.listings[this.state.selectedIndexes[0]].name}`;

                // Confirm single item deletion
                if (!window.confirm(`Are you sure you want to delete:\n${listingPath}`)) {
                    return;
                }
            }

            // Traverse selection(s)
            for (let idx of this.state.selectedIndexes) {
                // Get selected listing
                let listing = this.state.listings[idx];

                // Build remote path to it
                let listingPath = `/${this.state.path.join('/')}/${listing.name}`;

                // Is it a folder?
                if (listing.folder) {
                    // Append trailing slash
                    listingPath += '/';
                }

                try {
                    // Attempt to delete the listing
                    await adb.rm(listingPath, this.onCommandOutput.bind(this));

                    // Is this a media file?
                    if (this.isMediaFile(listingPath)) {
                        // Notify media deleted
                        await adb.notifyMediaUpdated(listingPath);
                    }
                }
                catch (err) {
                    // Display error
                    return alert(err.message);
                }

                // Mark as deleted
                listing.deleted = true;
            }

            // Traverse selection(s) to remove deleted ones
            for (let listingIdx = 0; listingIdx < this.state.listings.length; listingIdx++) {
                // Current listing deleted?
                if (this.state.listings[listingIdx].deleted) {
                    // Remove listing from array
                    this.state.listings.splice(listingIdx, 1);

                    // Decrement and keep checking
                    listingIdx--;
                }
            }

            // Update status message and listings list
            this.setState({ status: 'Listings deleted', listings: this.state.listings });

            // Reset selection
            this.setSelectedIndexes([]);
        }
    }

    async getAllFolderSizes() {
        // Update status message
        this.setState({ status: 'Calculating...' });

        // Traverse listings
        for (let listing of this.state.listings) {
            // Is it a folder?
            if (listing.folder) {
                // Calculate its size
                listing.size = await adb.du(`/${this.state.path.join('/')}/${listing.name}`);
            }
        }

        // Update status message and listings list
        this.setState({ status: 'Done', listings: this.state.listings });
    }

    async getSelectedListingsSizes() {
        // Valid selection(s)?
        if (this.isMultiSelectionValid()) {
            // Traverse selection(s)
            for (let idx of this.state.selectedIndexes) {
                // Get selected listing
                let listing = this.state.listings[idx];

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
            }

            // Update status message and listings list
            this.setState({ listings: this.state.listings, status: `Done` });
        }
    }

    async downloadSelectedListings(options) {
        // Valid selection(s)?
        if (this.isMultiSelectionValid()) {
            // Traverse selection(s)
            for (let idx of this.state.selectedIndexes) {
                // Get current listing
                let listing = this.state.listings[idx];

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
    }

    onCommandOutput(output) {
        // Update status message
        this.setState({ status: output });
    }

    navigateIn() {
        // Valid selection?
        if (this.isSingleSelectionValid()) {
            // Get selected listing
            let listing = this.state.listings[this.state.selectedIndexes[0]];

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

        // Prepare full paths (old and new name)
        let oldPath = `/${this.state.path.join('/')}/${listing.name}`;
        let newPath = `/${this.state.path.join('/')}/${newName}`;

        // Attempt to rename the listing
        await adb.mv(oldPath, newPath, this.onCommandOutput.bind(this));

         // Is this a media file?
         if (this.isMediaFile(newName)) {
            // Notify media renamed
            await adb.notifyMediaUpdated(oldPath);
            await adb.notifyMediaUpdated(newPath);
        }

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
        this.setState({ status: 'Folder created', listings: this.state.listings, lastSelectedIndex: this.state.listings.length - 1 });
    }

    async reloadListings() {
        // Loading indicator
        this.setState({ loading: true, listings: [], selectedIndexes: [], status: 'Loading...' });

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
                        <tr onMouseDown={() => this.setSelectedIndexes([])}>
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

    multiSelectListings(e, targetIdx) {
        // Ignore right clicks
        if (e.nativeEvent.which === 3) {
            return;
        }

        // Clean input
        targetIdx = parseInt(targetIdx, 10);

        // Multiselect?
        if (e.shiftKey) {
            // Make sure we have selected something first
            if (this.state.selectedIndexes.length === 0) {
                return;
            }

            // Get first & last selections
            let firstSelectionIdx = this.state.selectedIndexes[0];
            let lastSelectedIdx = this.state.selectedIndexes[this.state.selectedIndexes.length - 1];

            // Target is lower than first index?
            if (targetIdx < firstSelectionIdx) {
                // Select all listings in between
                for (let i = targetIdx; i < firstSelectionIdx; i++) {
                    // Add them
                    this.state.selectedIndexes.push(i);

                    // Update UI
                    this.setSelectedIndexes(this.state.selectedIndexes, targetIdx);
                }
            }
            else {
                // Select all listings in between
                for (let i = targetIdx; i > lastSelectedIdx; i--) {
                    // Add them
                    this.state.selectedIndexes.push(i);

                    // Update UI
                    this.setSelectedIndexes(this.state.selectedIndexes, targetIdx);
                }
            }
        }
        else {
            // Select one
            this.setSelectedIndexes([targetIdx]);
        }
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
                <tr className={this.state.selectedIndexes.indexOf(parseInt(idx, 10)) !== -1 ? 'listing selected' : 'listing'} key={listing.name} name={listing.name} onMouseDown={(e) => this.multiSelectListings(e, idx)} onDoubleClick={() => this.enterOrDownloadSelection()}>
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
                    <tr className='listing' key={i} onMouseDown={() => this.setSelectedIndexes([])}>
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

    setSelectedIndexes(idxs, lastSelectedIdx) {
        // Convert to integers
        for (let i = 0; i < idxs.length; i++) {
            idxs[i] = parseInt(idxs[i], 10);
        }

        // Order indexes ASC
        idxs.sort(function sortNumber(a, b) {
            return a - b;
        });

        // Remove duplicates
        idxs = idxs.filter(function (item, pos) {
            return idxs.indexOf(item) == pos;
        })

        // No idx provided?
        if (lastSelectedIdx == undefined) {
            lastSelectedIdx = (idxs.length === 0) ? -1 : idxs[0];
        }

        // Update state with new selected index
        this.setState({ selectedIndexes: idxs, lastSelectedIndex: lastSelectedIdx });
    }

    enterOrDownloadSelection() {
        // Make sure selection is valid
        if (this.isSingleSelectionValid()) {
            // Fetch selected listing
            let listing = this.getSelectedListing();

            // Folder?
            if (listing.folder) {
                // Navigate into folder
                this.navigateIn();
            }
            else {
                // Attempt to download and open the listing
                this.downloadSelectedListings({ open: true });
            }
        }
    }
}

// Render main component
ReactDOM.render(<App />, document.getElementById('root'));
