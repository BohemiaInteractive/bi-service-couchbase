const Promise      = require('bluebird');
const Couchbase    = require('couchbase');
const _            = require('lodash');
const EventEmmiter = require('events').EventEmitter;

module.exports = CouchbaseCluster;

/**
 * @param {Object} options
 * @param {String} options.host - string with host(s)
 * @param {Object} options.buckets
 * @param {Object} options.buckets.<NAME>
 * @param {String} options.buckets.<NAME>.bucket - bucket's name
 *
 * @constructor
 **/
function CouchbaseCluster(options) {
    EventEmmiter.call(this);

    this.options = _.cloneDeep(options || {});

    if (!_.isPlainObject(this.options.buckets) || _.isEmpty(this.options.buckets)) {
        throw Error('Can NOT create empty cluster with no buckets.');
    }

    this.buckets = {};

    this.errorCodes = Couchbase.errors;
    this.cluster = new Couchbase.Cluster(this.options.host);
};

CouchbaseCluster.prototype = Object.create(EventEmmiter.prototype);
CouchbaseCluster.prototype.constructor = CouchbaseCluster;

/**
 * @public
 * @param {String} name
 * @return {Bucket}
 */
CouchbaseCluster.prototype.get = function(name) {
    if (!this.buckets[name]) {
        throw new Error('The bucket (' + name + ') does not exists');
    }

    return this.buckets[name];
};

/**
 * @public
 * @param {String} name
 * @return {Bucket}
 */
CouchbaseCluster.prototype.openBucketSync = function(name) {
    if (this.buckets[name]) {
        return this.buckets[name];
    }
    if (!this.options.buckets.hasOwnProperty(name)) {
        throw new Error('There is no config record for the bucket: ' + name);
    }

    return this.$openBucketSync(name);
};

/**
 * @public
 * @param {String} name
 * @return {Promise<Bucket>}
 */
CouchbaseCluster.prototype.openBucket = function(name) {
    if (this.buckets[name]) {
        return Promise.resolve(this.buckets[name]);
    }
    if (!this.options.buckets.hasOwnProperty(name)) {
        return Promise.reject(new Error('There is no config record for the bucket: ' + name));
    }

    return this.$openBucket(name);
};

/**
 * @private
 * @param {String} name - connection name
 * @return {Bucket}
 */
CouchbaseCluster.prototype.$openBucketSync = function(name) {
    var self = this;
    var options = this.options.buckets[name];
    this.buckets[name] = this.cluster.openBucket(options.bucket, options.password);

    this.buckets[name].on('connect', function() {
        self.emit('connect', self.buckets[name]);
    });

    this.buckets[name].on('error', function(err) {
        self.emit('error', err);
    });

    Promise.promisifyAll(this.buckets[name]);

    return this.buckets[name];
};


/**
 * @private
 * @param {String} name - connection name
 * @return {Promise<Bucket>}
 */
CouchbaseCluster.prototype.$openBucket = function(name) {
    var self = this;
    var options = this.options.buckets[name];

    return new Promise(function(resolve, reject) {
        self.buckets[name] = self.cluster.openBucket(options.bucket, options.password);

        self.buckets[name].on('connect', function() {
            Promise.promisifyAll(self.buckets[name]);
            resolve(self.buckets[name]);
        });

        self.buckets[name].on('error', reject);
    });
};

/**
 * @return {Promise<true>}
 */
CouchbaseCluster.prototype.inspectIntegrity = function() {
    var self    = this
    ,   buckets = this.buckets
    ,   key     = `integrity_check_process_${process.pid}`;

    return Promise.map(Object.keys(buckets), function(name) {
        var bucket = buckets[name];
        return self.ensureConnected(bucket).then(function(bucket) {
            return bucket.upsertAsync(key, process.pid, {expiry: 10});
        });
    }).return(true);
};

/**
 * @param {Bucket} bucket
 * @return {Promise<>}
 */
CouchbaseCluster.prototype.ensureConnected = function(bucket) {
    return new Promise(function(resolve, reject) {

        if (bucket.connected) {
            return resolve(bucket);
        }

        bucket.once('connect', function() {
            return resolve(bucket);
        });

        bucket.once('error', function(err) {
            return reject(err);
        });
    });
};

/**
 * @param {Object} opt - options object
 * @return CouchbaseCluster
 */
CouchbaseCluster.build = function(opt) {
    return new CouchbaseCluster(opt);
};
