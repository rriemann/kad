/**
 * @module kad/transports
 */

'use strict';

module.exports = {
  /** {@link TCPTransport} */
  TCP: require('./tcp'),
  /** {@link HTTPTransport} */
  HTTP: require('./http')
};
