var util = require('util');
var StreamedEmitter = require('streamedemitter');
var SystemVAdapter = require('./adapter/systemv');
var ForeverRequestHandler = require('./requesthandler');
var forever = require('../forever');
var path = require('path');
var fs = require('fs');
var portfinder = require('portfinder');
var net = require('net');

module.exports = ForeverService;

// options
//   directories {log, pid, conf, run, local}
function ForeverService(options) {
    StreamedEmitter.call(this, {wildcard: true});
    options = options || {};
    var self = this;
    this.applications = [
        //{
        //file:
        //options:
        //monitor:
        //}
    ];
    if(typeof options.adapter == 'string') {
        options.adapter = ForeverService.adapter[options.adapter];
    }
    var AdapterType = options.adapter || SystemVAdapter;
    this.adapter = new AdapterType(this);
}
util.inherits(ForeverService, StreamedEmitter);

fs.readdirSync(path.join(__dirname, 'adapter')).forEach(function loadAdapter(adapterModule) {
    ForeverService[adapterModule] = require(path.join(__dirname, 'adapter', adapterModule));
});

process.on('uncaughtException', function(e) {console.error(e,e.stack)})

ForeverService.prototype.load = function load(callback) {
    var self = this;
    this.adapter.load(function onLoaded(applications) {
        applications.forEach(function startApplication(application, index) {
            self.applications.push(application);
            if(index === applications.length - 1) {
              var server = net.createServer(function onConnection(conn) {
                self.addDuplex(conn);  
              });
              server.listen(path.join(forever.config.get('root'),'foreverd.sock'), callback);
              self.emit('foreverd.loaded');
              new ForeverRequestHandler(self);
            }
        });
    });
    return this;
}

//
// Function add(file, options)
//   add the application to the service manager
//   DOES NOT START THE APPLICATION
//   call's the service manager's add method
//
ForeverService.prototype.add = function add(file, options, callback) {
    if (this.paused) {
        return callabck && callback(new Error('foreverd is paused'));
    }
    var self = this;
    this.adapter.add(file, options, function onAdd(err) {
       if(!err) {
         self.emit('foreverd.added')
       }
       callback && callback(err); 
    });
}

//
// Function remove(file, options)
//   remove the application from the service manager
//   call's the service manager's remove method
//
ForeverService.prototype.remove = function remove(file, options, callback) {
    if (this.paused) {
        return callback(new Error('foreverd is paused'));
    }
    var applicationsToRemove = this.applications;
    if (file) {
        var fileStr = JSON.stringify(file);
        applicationsToRemove = applicationsToRemove.filter(function compareFile(application) {
            return fileStr !== JSON.stringify(application.file);
        });
    }
    if (options) {
        var optionStr = JSON.stringify(options);
        applicationsToRemove = applicationsToRemove.filter(function compareOptions(application) {
            return optionStr !== JSON.stringify(application.options);
        });
    }
    var self = this;
    applicationsToRemove.forEach(function removeApplication(application) {
        if (application.monitor) {
            application.monitor.stop();
        }
        self.applications.splice(self.applications.indexOf(application), 1);
    });
    self.emit('foreverd.removed');
    callback && callback();
    return this;
}

//
// Function install()
//   installs all the required to run foreverd
//   call's the service manager's install(options)
//

ForeverService.prototype.install = function install(callback) {
    var self = this;
    this.adapter.install(function onInstall() {
        self.emit('foreverd.installed');
        callback && callback();
    });
    return this;
}

//
// Function uninstall(options)
//   uninstalls all the required to run foreverd
//   call's the service manager's uninstall(options)
//

ForeverService.prototype.uninstall = function uninstall(callback) {
    var self = this;
    this.adapter.uninstall(function onUninstall() {
        self.emit('foreverd.uninstalled');
        callback && callback();
    });
    return this;
}

//
// Function start()
//   calls the appropriate OS functionality to start this service
//
ForeverService.prototype.start = function start(callback) {
    var self = this;
    this.adapter.start(function onStart() {
        self.emit('foreverd.started');
        callback && callback();
    });
    return this;
}

//
// Function run()
//   creates monitors for all the services
//
ForeverService.prototype.run = function run(callback) {
    var self = this;
    this.adapter.run(function adapterStarted() {
        self.applications.forEach(function startApplication(application) {
            application.monitor = new forever.Monitor(application.file, application.options);
            application.monitor.start();
        });
        self.emit('foreverd.running');
        callback && callback();
    });
    return this;
}

//
// Function stop(monitors)
//
ForeverService.prototype.stop = function stop(callback) {
    var self = this;
    this.adapter.stop(function adapterStopped() {
        self.applications.forEach(function stopApplication(application) {
            application.monitor.stop();
        });
        self.emit('foreverd.stopped');
        callback && callback();
    });
    return this;
}

//
// Function restart()
//
ForeverService.prototype.restart = function restart(callback) {
    var self = this;
    this.adapter.start(function adapterRestarted() {
        self.applications.forEach(function restartApplication(application) {
            application.monitor.restart();
        });
        self.emit('foreverd.restarted');
        callback && callback();
    });
    return this;
}

//
// Function pause()
//   disables adding / removing applications
//
ForeverService.prototype.pause = function pause(callback) {
    this.paused = true;
    self.emit('foreverd.paused');
    callback && callback();
    return this;
}

//
// Function resume()
//   reenables adding / removing applications
//
ForeverService.prototype.resume = function resume(callback) {
    this.paused = false;
    self.emit('foreverd.resumed');
    callback && callback();
    return this;
}

ForeverService.prototype.list = function list(callback) {
    // Only return values that the User could have affected / state
    var apps = this.applications.map(function(application) {
       return {
            file: application.file,
            options: application.options,
            monitor: {
                childExists: application.monitor && application.monitor.childExists,
                times: application.monitor && application.monitor.times,
                command: application.monitor && application.monitor.command
            }
       };
    });
    this.emit('foreverd.listed', false, apps);
    callback && callback.apply(this, err, apps);    
    return this;
}