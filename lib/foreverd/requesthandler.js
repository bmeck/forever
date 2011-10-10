//
//
// A router for the streaming events of a ForeverService
//
//
module.exports = ForeverRequestHandler;
function ForeverRequestHandler(self) {
    self.on('foreverd.cmd.*', function() {
        self[this.event.slice('foreverd.cmd.'.length)].apply(this, arguments);
    });
}