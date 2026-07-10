const net = require('net');

function sendEscPos(host, port, buffer, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(true);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => done(new Error('Printer connection timeout')));
    socket.on('error', (e) => done(e));

    socket.connect(port, host, () => {
      socket.write(Buffer.from(buffer), (err) => {
        if (err) return done(err);
        socket.end(() => done(null));
      });
    });
  });
}

module.exports = { sendEscPos };
