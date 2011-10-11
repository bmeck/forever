//
//
// A router for the streaming events of a ForeverService
//
//
function foreverRequestHandler(self) {
  self.on('foreverd.cmd.*', function handleEvent() {
    self[this.event.slice('foreverd.cmd.'.length)].apply(this, arguments);
  });
}
module.exports = foreverRequestHandler;