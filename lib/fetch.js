var debug = require('debug')('pnpm:fetch')
var got = require('./got')
var crypto = require('crypto')
var gunzip = require('gunzip-maybe')
var tar = require('tar-fs')
var join = require('path').join
var fs = require('mz/fs')

var homedir = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME']

/*
 * Fetches a tarball `tarball` and extracts it into `dir`
 */

module.exports = function fetch (dir, pkg, log) {
  return getStream(pkg, log)
    .then(stream => fetchStream(dir, pkg, log, stream))
}

function npmCacheRoot() {
  return join(homedir, '.npm')
}

function cachedTarballPath(pkg) {
  return join(npmCacheRoot(), pkg.spec.name, pkg.version, 'package.tgz')
}

function getStream (pkg, log) {
  var path = cachedTarballPath(pkg)
  return fs.exists(path)
    .then(exists => {
      if (exists) {
        return fs.createReadStream(path)
      }
      log('download-queued')
      return got.getStream(pkg.dist.tarball)
    })
}

function fetchStream (dir, pkg, log, stream) {
  var tarball = pkg.dist.tarball
  var shasum = pkg.dist.shasum
  return new Promise((resolve, reject) => {
    var actualShasum = crypto.createHash('sha1')
    var size
    var downloaded = 0

    stream
      .on('response', start)
      .on('data', _ => { actualShasum.update(_) })
      .on('error', reject)
      .pipe(gunzip()).on('error', reject)
      .pipe(tar.extract(dir, { strip: 1 })).on('error', reject)
      .on('finish', finish)

    function start (res) {
      if (res.statusCode !== 200) {
        return reject(new Error('' + tarball + ': invalid response ' + res.statusCode))
      }

      log('download-start')
      if ('content-length' in res.headers) {
        size = +res.headers['content-length']
        res.on('data', chunk => {
          downloaded += chunk.length
          log('downloading', { done: downloaded, total: size })
        })
      }
    }

    function finish () {
      var digest = actualShasum.digest('hex')
      debug('finish %s %s', shasum, tarball)
      if (shasum && digest !== shasum) {
        return reject(new Error('' + tarball + ': incorrect shasum (expected ' + shasum + ', got ' + digest + ')'))
      }

      return resolve(dir)
    }
  })
}
