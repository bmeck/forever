var util = require('util'),
  forever = require('../../../../forever'),
  ForeverServiceAdapter = require('../../adapter'),
  path = require('path'),
  fs = require('fs'),
  net = require('net'),
  StreamedEmitter = require('streamedemitter'),
  daemon = require('daemon');

forever.config.set('root', path.join('/var', 'local', 'foreverd'));

//
// Classic init.d script adapter
// Sometimes called inittab, but its origin is called systemv
//
function SystemVAdapter(service) {
  ForeverServiceAdapter.call(this, service);
  this.daemonized = false;
}
module.exports = SystemVAdapter;
util.inherits(SystemVAdapter, ForeverServiceAdapter);

SystemVAdapter.prototype.install = function install(callback) {
  //
  // Copy the init.d script to the right location
  // TODO Distribution fixes?
  //
  var script, initdPath, target;
  initdPath = path.join('/etc', 'init.d', 'foreverd');
  try {
    fs.mkdirSync(forever.config.get('root'), '0777');
    fs.mkdirSync(path.join(forever.config.get('root'), 'services'), '0777');
  }
  catch (e) {
    if (e.code !== 'EEXIST') {
      return callback && callback(e);
    }
  }
  try {
    script = fs.createReadStream(path.join(__dirname, 'foreverd'));
    target = fs.createWriteStream(initdPath, {
      flags: 'w',
      mode: '0777'
    });
    script.pipe(target);
    script.on('end', function onEnd() {
      var directories = fs.readdirSync('/etc');
      directories.forEach(function (directory) {
        var match = directory.match(/^rc(\d+)\.d$/),
          kill_or_start = match && {0: true, 1: true, 6: true}[match[1]] ? 'K' : 'S';
        if (match) {
          try {
            fs.symlinkSync(initdPath, path.join('/etc', directory, kill_or_start + '20foreverd'));
          }
          catch (e) {
            if (e.code !== 'EEXIST') {
              return callback && callback(e);
            }
          }
        }
      });
      if (callback) {
        callback();
      }
    });
  }
  catch (e) {
    if (e.code !== 'EEXIST' && callback) {
      callback(e);
    }
  }
};

//
//
//
SystemVAdapter.prototype.load = function load(callback) {
  var serviceFiles = fs.readdirSync(path.join(forever.config.get('root'), 'services')),
    services = [];
  if (serviceFiles.length !== 0) {
    serviceFiles.forEach(function loadServiceFiles(serviceFile, index) {
      var serviceFilePath = path.join(forever.config.get('root'), 'services', serviceFile),
        service = JSON.parse(fs.readFileSync(serviceFilePath)),
        file = service.file,
        options = service.options;
      options.minUptime = 200;
      services.push({
        file: service.file,
        options: service.options
      });
    });
  }
  callback(services);
};

SystemVAdapter.prototype.start = function start(callback) {
  require('child_process').spawn('/etc/init.d/foreverd', ['start']);
  if (callback) {
    callback();
  }
};

SystemVAdapter.prototype.stop = function stop(callback) {
  if (callback) {
    callback();
  }
};

SystemVAdapter.prototype.run = function run(callback) {
  if (this.daemonized) {
    return callback();
  }
  var self = this,
    pidFilePath = path.join('/var', 'run', 'foreverd.pid'),
    logFilePath = path.join('/var', 'log', 'foreverd'),
    sockPath = path.join(forever.config.get('root'), 'foreverd.sock');
  process.on('exit', function removePIDFile() {
    try {
      fs.unlinkSync(pidFilePath);
    }
    catch (err) {
      //we are exiting anyway. this may have some noexist error already
    }
  });
  fs.open(logFilePath, 'w+', function serviceLogOpened(err, logFile) {
    if (err) {
      throw err;
    }
    var server = net.createServer(function onConnect(conn) {
      self.service.addDuplex(conn);
    });
    server.listen(sockPath, function onListening() {
      try {
        //daemon.start(logFile);
        //daemon.lock(pidFilePath);
        self.daemonized = true;
        if (callback) {
          callback();
        }
      }
      catch (err) {
        if (callback) {
          callback(err);
        }
        return;
      }
    });
  });
};

SystemVAdapter.prototype.add = function add(file, options, callback) {
  forever.config.set('root', path.join('/var', 'local', 'foreverd'));
  //
  // Add descriptor to our service list
  // this is just a json file in $root/services/*.json
  //
  var service = {
      file: file,
      options: options || {}
    },
    filePath = path.join(forever.config.get('root'), 'services', options.uid + '.json');
  options.appendLog = true;
  fs.writeFile(filePath, JSON.stringify(service), function onWrite(err) {
    if (callback) {
      callback(err);
    }
  });
};

SystemVAdapter.prototype.getClient = function getClient(callback) {
  var sockPath = path.join(forever.config.get('root'), 'foreverd.sock'),
    client = new StreamedEmitter({wildcard: true}),
    connection = net.createConnection(sockPath, function onConnect(err) {
    if (err) {
      if (callback) {
        callback(err);
      }
    }
    else if (callback) {
      callback(false, client);
    }
  });
  client.addDuplex(connection);
};

SystemVAdapter.prototype.list = function list(callback) {
  this.getClient(function onClient(err, client) {
    if (err) {
      if (callback) {
        callback(err);
      }
    }
    client.on('foreverd.listed', function finishListing() {
      callback.apply(null, arguments);
      client.endStreams();
    });
    client.emit('foreverd.cmd.list');
  });
};