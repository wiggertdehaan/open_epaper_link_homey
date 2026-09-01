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
   *
   * Asked for by hand from the settings page, so force is set: the scheduled
   * sweeps skip a run with no paired devices because that is more likely to
   * mean the drivers are still loading than that the user owns no tags, but
   * someone pressing the button has the app in front of them.
   */
  async cleanupImages({ homey, query }) {
    const dryRun = query && (query.dryRun === 'true' || query.dryRun === true);
    return homey.app.cleanupImages({ dryRun, force: true });
  },

};
