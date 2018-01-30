export default {
    getReadableListingSize(kb) {
        // Less than 1MB?
        if (kb < 1000) {
            // Return size in KB
            return kb + ' KB';
        }

        // Convert size to MB
        let mb = (kb / 1000).toFixed(1);

        // Less than 1 GB?
        if (mb < 1000) {
            // Return size in MB
            return mb + ' MB';
        }

        // Convert size to GB
        let gb = (mb / 1000).toFixed(2);

        // Return size in GB
        return gb + ' GB';
    }
}