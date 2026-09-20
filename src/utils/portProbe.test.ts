import net from 'net';
import { isPortAvailable, findNextAvailablePort } from './portProbe';

describe('Port Probe Utility (src/utils/portProbe.ts)', () => {
  it('should return false for invalid port numbers', async () => {
    expect(await isPortAvailable(0)).toBe(false);
    expect(await isPortAvailable(-1)).toBe(false);
    expect(await isPortAvailable(70000)).toBe(false);
  });

  it('should report a port as available when nothing is listening', async () => {
    // Port 59123 is typically free
    const port = 59123;
    const available = await isPortAvailable(port);
    expect(available).toBe(true);
  });

  it('should report a port as occupied when another server is listening on it', async () => {
    const port = 59124;
    const dummyServer = net.createServer();

    await new Promise<void>((resolve, reject) => {
      dummyServer.listen(port, '0.0.0.0', () => resolve());
      dummyServer.once('error', reject);
    });

    try {
      const available = await isPortAvailable(port);
      expect(available).toBe(false);
    } finally {
      await new Promise<void>(resolve => dummyServer.close(() => resolve()));
    }
  });

  it('findNextAvailablePort should skip forbidden ports and occupied ports', async () => {
    const occupiedPort = 59125;
    const dummyServer = net.createServer();

    await new Promise<void>((resolve, reject) => {
      dummyServer.listen(occupiedPort, '0.0.0.0', () => resolve());
      dummyServer.once('error', reject);
    });

    try {
      const forbidden = new Set<number>([59120, 59121, 59122]);
      const nextPort = await findNextAvailablePort(59120, forbidden);
      
      // Should skip 59120, 59121, 59122 (forbidden), and 59125 (occupied)
      expect(forbidden.has(nextPort)).toBe(false);
      expect(nextPort).not.toBe(occupiedPort);
      expect(nextPort).toBeGreaterThanOrEqual(59123);
    } finally {
      await new Promise<void>(resolve => dummyServer.close(() => resolve()));
    }
  });
});
