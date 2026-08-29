'use strict';

/**
 * App API, reachable from the settings page via Homey.api().
 */
module.exports = {

  /** Current on-disk screenshot usage, and how much of it is orphaned. */
  async getImageStorage({ homey }) {
    return homey.app.getImageStorageReport();
  },

  /**
   * Removes orphaned screenshots. Pass ?dryRun=true to see what would go
   * without deleting anything.
   */
  async cleanupImages({ homey, query }) {
    const dryRun = query && (query.dryRun === 'true' || query.dryRun === true);
    return homey.app.cleanupImages({ dryRun });
  },

};
