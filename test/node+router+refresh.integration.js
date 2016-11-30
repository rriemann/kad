'use strict';

var expect = require('chai').expect;
var sinon = require('sinon');
var KNode = require('../lib/node');
var transports = require('../lib/transports');
var Logger = require('../lib/logger');
var FakeStorage = require('kad-memstore');
var Router = require('../lib/router');
var Contact = require('../lib/contact');
var inherits = require('util').inherits;
var utils = require('../lib/utils');
var _ = require ('lodash');
var constants = require('../lib/constants');
var assert = require('assert');
var async = require('async');
var RPC = require('../lib/rpc');

class FakeTransport {
  constructor(contact, options) {
    // Make sure that it can be instantiated without the `new` keyword
    if (!(this instanceof FakeTransport)) {
      return new FakeTransport(contact, options);
    }

    // Call `kademlia.RPC` to setup bindings (super)
    RPC.call(this, contact, options);
  }

  _open(ready) {
    FakeTransport.connections[this._contact.nodeID] = this;
    ready();
  }

  _send(data, contact) {
    async.nextTick(function sendFakeTransport() {
      FakeTransport.connections[contact.nodeID].receive(data);
    });
  }

  _close() {
    delete FakeTransport.connections[this._contact.nodeID];
  }
}

FakeTransport.connections = {};

// Inherit for `kademlia.RPC`
inherits(FakeTransport, RPC);


Router.PING_TTL = 0;

/*
  This function is different from utils.getRandomInBucketRangeBuffer as
  it does not set the pow(2,index) using utils.getPowerOfTwoBuffer

  commonPrefixLength determines the number of leading (most significant bits) zeros
*/
function getRandomBuffer(commonPrefixLength) {
  var index = constants.B - commonPrefixLength;
  var base = new Buffer(constants.B / 8);
  base.fill(0);
  var byte = parseInt(index / 8); // randomize bytes below the power of two

  for (var i = constants.K - 1; i > (constants.K - byte - 1); i--) {
    base[i] = parseInt(Math.random() * 256);
  }

  // also randomize the bits below the number in that byte
  // and remember arrays are off by 1
  for (var j = index - 1; j >= byte * 8; j--) {
    var one = Math.random() >= 0.5;
    var shiftAmount = j - byte * 8;

    base[constants.K - byte - 1] |= one ? (1 << shiftAmount) : 0;
  }

  return base;
}

var usedNodeIDs = [];

function nodeFactory(nodeID, commonPrefixLength) {
  // ensure to generate a unique (random) nodeID
  var freeNodeID;
  do {
    freeNodeID = utils.getDistance(nodeID, getRandomBuffer(commonPrefixLength).toString('hex')).toString('hex');
  } while (usedNodeIDs.indexOf(freeNodeID) > -1);
  usedNodeIDs.push(freeNodeID);
  // create a new node with a common prefix with nodeID of length commonPrefixLength
  var contact = new Contact({nodeID: freeNodeID});
  var transport = new FakeTransport(contact);
  return KNode({
    storage: new FakeStorage(),
    transport: transport,
    logger: new Logger(0)
  });
}

describe('Node+Router+Refresh', function() {
  var nodeID  = 'da23614e00469a0d7c7bd1bdab5c9c474b1904dc';
  var nodeID2 = utils.getDistance(nodeID, '0000000001000000000000000000000000000000').toString('hex');
  var commonPrefixLength = constants.B - utils.getBucketIndex(nodeID, nodeID2); // = 40
  var separateNode;

  describe('#refreshBuckets', function() {
    it('should find peers for every bucket', function(done) {
      var nodes = [];

      // create two nodes
      nodes.push(nodeFactory(nodeID,  constants.B));
      nodes.push(nodeFactory(nodeID2, constants.B));

      var branchSize = constants.K;

      async.waterfall([
        // connect two nodes that serve as entry point for their respective branch
        function(next) {
          nodes[0].connect(nodes[1]._self, next);
        },
        function(contact, next) {
          nodes[1].connect(nodes[0]._self, next);
        },
        // create subtrees for each node
        function(contact, next) {
          async.eachSeries([nodes[0]._self, nodes[1]._self], function(contact, callback) {
            async.timesSeries(branchSize, function(i, next) {
              var branchNode = nodeFactory(contact.nodeID, commonPrefixLength+20);
              nodes.push(branchNode);
              branchNode.connect(contact, next);
            }, callback);
          }, next);
        },
        // create and connect separate node
        function(next) {
          separateNode = nodeFactory(nodeID, commonPrefixLength-20);
          separateNode.connect(nodes[0]._self, next);
        },
        // update all buckets of other peers
        function(contact, next) {
          async.eachSeries(nodes, function(node, callback) {
            node._router.refreshBucketsBeyondClosest(null, function() {
              callback();
            });
          }, next);
        }
      ], function() {
        // count how many peers know the separate node
        var withBucket = 0;
        _.forEach(nodes, function(node) {
          var max = _.max(_.keys(node._router._buckets));
          // console.log(Object.keys(node._router._buckets));
          if(max > 130) { withBucket++ };
        });
        var withoutBucket = nodes.length - withBucket;
        console.log("with: %d, without: %d", withBucket, withoutBucket);
        expect(withoutBucket).to.be.equal(0);
        done();
      });
    });
  });
});
