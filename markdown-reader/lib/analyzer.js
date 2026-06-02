'use strict';

/**
 * Pure markdown analysis. No I/O.
 *
 * The implementation is the UMD module in ../analyzer.js so that the exact
 * same code powers the Node server, the tests, and the static (no-server)
 * browser frontend — keeping all three in perfect agreement. This file just
 * re-exports it for the server's CommonJS `require('./lib/analyzer')` callers.
 */

module.exports = require('../analyzer.js');
