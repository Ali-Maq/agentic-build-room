// Switch between local dev and Maincloud by flipping USE_MAINCLOUD.
// Local:     spacetime started on ws://127.0.0.1:3456 (port 3000/3001 were taken)
// Maincloud: wss://maincloud.spacetimedb.com
//
// NOTE for Maincloud: 'panel' may already be taken on shared Maincloud — publish
// under a unique name (e.g. 'panel-quidwaiali') and set MODULE_NAME to match.

export const MODULE_NAME = 'panel';

const USE_MAINCLOUD = false;

export const SPACETIMEDB_URI = USE_MAINCLOUD
  ? 'wss://maincloud.spacetimedb.com'
  : 'ws://127.0.0.1:3456';
