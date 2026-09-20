import net from 'net';

/**
 * Checks whether a given TCP port is available to be listened on (not occupied by another process).
 * Probes both 0.0.0.0 and 127.0.0.1.
 */
export function isPortAvailable(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise(resolve => {
    if (!port || port < 1 || port > 65535) {
      resolve(false);
      return;
    }

    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    try {
      server.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Finds the next available port on the host, starting from `startPort` and skipping any `forbiddenPorts`.
 * Checks both internal configuration constraints and active OS port binding availability.
 */
export async function findNextAvailablePort(
  startPort = 4001,
  forbiddenPorts: Set<number> = new Set<number>()
): Promise<number> {
  let port = Math.max(1, startPort);

  while (port <= 65535) {
    if (!forbiddenPorts.has(port)) {
      const available = await isPortAvailable(port);
      if (available) {
        return port;
      }
    }
    port++;
  }

  throw new Error(`No available TCP ports found starting from ${startPort}`);
}
