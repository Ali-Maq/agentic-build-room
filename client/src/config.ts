// Switch between local dev and Maincloud by flipping USE_MAINCLOUD.
// Local:     spacetime started on ws://127.0.0.1:3456 (port 3000/3001 were taken)
// Maincloud: wss://maincloud.spacetimedb.com
//
// Deployed as "amy-panel" on Maincloud. For local dev, publish the module
// locally under the SAME name (spacetime publish amy-panel --server <local>)
// and flip USE_MAINCLOUD to false.

export const MODULE_NAME = 'amy-panel';

const USE_MAINCLOUD = true;

export const SPACETIMEDB_URI = USE_MAINCLOUD
  ? 'wss://maincloud.spacetimedb.com'
  : 'ws://127.0.0.1:3456';
