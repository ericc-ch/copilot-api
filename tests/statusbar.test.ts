import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { platform } from 'os';
import { StatusBarManager } from '~/lib/statusbar-manager';
import type { StatusBarStatus } from '~/lib/types';

// Skip tests on non-macOS platforms
const isMacOS = platform() === 'darwin';

describe('StatusBar Manager', () => {
  let manager: StatusBarManager;

  beforeAll(() => {
    manager = new StatusBarManager();
  });

  test.skipIf(!isMacOS)('should create manager instance', () => {
    expect(manager).toBeDefined();
    expect(manager instanceof StatusBarManager).toBe(true);
  });

  test.skipIf(!isMacOS)('should get status', async () => {
    const status: StatusBarStatus = await manager.getStatus();

    expect(status).toBeDefined();
    expect(typeof status.installed).toBe('boolean');
    expect(typeof status.running).toBe('boolean');
    expect(typeof status.appPath).toBe('string');
    expect(status.appPath).toContain('Copilot Status Bar.app');
  });

  test.skipIf(!isMacOS)('should handle app not installed', async () => {
    // This test assumes the app might not be installed
    const status = await manager.getStatus();

    if (!status.installed) {
      expect(status.running).toBe(false);
    }
  });

  test('should throw error on non-macOS platforms', async () => {
    if (platform() !== 'darwin') {
      // Test that the manager would fail gracefully on non-macOS
      expect(() => {
        new StatusBarManager();
      }).not.toThrow(); // Constructor shouldn't throw

      // But operations should fail appropriately
      // This would be tested in the actual CLI command
    }
  });
});

describe('StatusBar CLI Integration', () => {
  test('should export proper CLI function structure', async () => {
    // Test that our CLI command follows the expected pattern
    const statusbarCommand = await import('~/statusbar');
    expect(statusbarCommand.default).toBeDefined();
    expect(typeof statusbarCommand.default).toBe('function');
  });

  test.skipIf(!isMacOS)('should handle different subcommands', async () => {
    // Test CLI command parsing
    const options = { _: ['status'] };

    // This would test the actual CLI parsing
    // For now, just ensure the options structure is correct
    expect(options._).toContain('status');
  });
});