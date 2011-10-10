var util = require('util');
var forever = require('../../../forever');
var ForeverServiceAdapter = require('../../adapter');
var path = require('path');
var fs = require('fs');
var net = require('net');
var StreamedEmitter = require('streamedemitter');
var daemon = require('daemon');

forever.config.set('root', path.join('/var', 'local', 'foreverd'));
module.exports = SystemVAdapter;

//
// Classic init.d script adapter
// Sometimes called inittab, but its origin is called systemv
//
function SystemVAdapter(service) {
    ForeverServiceAdapter.call(this, service);
    this.daemonized = false;
}
util.inherits(SystemVAdapter, ForeverServiceAdapter);

SystemVAdapter.prototype.install = function install(callback) {
  //
  // Copy the init.d script to the right location
  // TODO Distribution fixes?
  //
  var initdPath = path.join('/etc', 'init.d', 'foreverd');
  try {
    fs.mkdirSync(forever.config.get('root'), 0777);
    fs.mkdirSync(path.join(forever.config.get('root'), 'services'), 0777);
  }
  catch (e) {
    if (e.code !== 'EEXIST') {
      return callback && callback(e);
    }
  }
  try {
    var script = fs.createReadStream(path.join(__dirname, 'foreverd'));
    var target = fs.createWriteStream(initdPath, {
      flags: 'w',
      mode: 0777
    });
    script.pipe(target);
    script.on('end', function() {
      var directories = fs.readdirSync('/etc');
      directories.forEach(function (directory) {
      var match = directory.match(/^rc(\d+)\.d$/);
        if(match) {
          var kill_or_start = {0:true, 1:true, 6:true}[match[1]] ? 'K' : 'S';
          try {
            fs.symlinkSync(initdPath, path.join('/etc',directory,kill_or_start+'20foreverd'));
          }
          catch (e) {
            if (e.code !== 'EEXIST') {
              return callback && callback(e);
            }
          }
        }
      });
      return callback && callback();
    });
  }
  catch (e) {
    if (e.code !== 'EEXIST') {
      return callback && callback(e);
    }
  }
}

//
//
//
SystemVAdapter.prototype.load = function load(callback) {
    var serviceFiles = fs.readdirSync(path.join(forever.config.get('root'), 'services'));
    var services = [];
    if (serviceFiles.length !== 0) {
        serviceFiles.forEach(function loadServiceFiles(serviceFile, index) {
          var serviceFilePath = path.join(forever.config.get('root'), 'services', serviceFile);
          var service = JSON.parse(fs.readFileSync(serviceFilePath));
          var file = service.file;
          var options = service.options;
          options.minUptime = 200;
          services.push({
            file:service.file,
            options:service.options
          })
        });
    }
    callback(services);
}

SystemVAdapter.prototype.start = function start(callback) {
  require('child_process').spawn('/etc/init.d/foreverd', ['start']);
  callback && callback();
}
SystemVAdapter.prototype.stop = function stop(callback) {
    callback && callback();
}

SystemVAdapter.prototype.run = function run(callback) {
  if(this.daemonized) {
    return callback();
  }
  var self = this;
  var pidFilePath = path.join('/var','run', 'foreverd.pid');
  var logFilePath = path.join('/var','log','foreverd');
  var sockPath = path.join(forever.config.get('root'),'foreverd.sock');
  process.on('exit', function removePIDFile() {
    try{
      fs.unlinkSync(pidFilePath);
    }
    catch(err) {
      //we are exiting anyway. this may have some noexist error already
    }
  })
  fs.open(logFilePath, 'w+', function serviceLogOpened(err, logFile) {
    if(err) {
      throw err;
    }
    var server = net.createServer(function onConnect(conn) {
        self.service.addDuplex(conn);
    });
    server.listen(sockPath, function() {
      try {
        //daemon.start(logFile);
        //daemon.lock(pidFilePath); 
        self.daemonized = true;
        callback && callback();
      }
      catch (err) {
        return callback && callback(err);
      }
    });
  });
}

SystemVAdapter.prototype.add = function add(file, options, callback) {
  forever.config.set('root', path.join('/var', 'local', 'foreverd'));
  //
  // Add descriptor to our service list
  // this is just a json file in $root/services/*.json
  //
  var service = {
    file: file,
    options: options || {}
  };
  options.appendLog = true;
  var filePath = path.join(forever.config.get('root'), 'services', options.uid + '.json');
  fs.writeFile(filePath, JSON.stringify(service), function(err) {
    callback && callback();  
  });
}

SystemVAdapter.prototype.getClient = function getClient(callback) {
  var sockPath = path.join(forever.config.get('root'),'foreverd.sock');
  var client = new StreamedEmitter({wildcard:true});
  var connection = net.createConnection(sockPath, function onConnect(err) {
    if(err) {
      callback && callback(err);  
    }
    else {
      callback && callback(false, client);
    }
  });
  client.addDuplex(connection);
}

SystemVAdapter.prototype.list = function list(callback) {
  this.getClient(function(err, client) {
    if(err) {
        callback && callback(err);
    }
    client.on('foreverd.listed', function() {
      callback.apply(null, arguments);
      connection.end();
    })
    client.emit('foreverd.cmd.list');
  })
}