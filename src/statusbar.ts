import { defineCommand } from 'citty';
import { consola } from 'consola';
import { platform } from 'os';
import { StatusBarManager } from '~/lib/statusbar-manager';

/**
 * macOS Status Bar CLI Command
 *
 * Manages the native macOS status bar app for Copilot API monitoring
 * Follows the established CLI patterns from copilot-api repository
 */
export default defineCommand({
  meta: {
    name: "statusbar",
    description: "Manage the macOS status bar app for Copilot API monitoring",
  },
  args: {
    command: {
      type: "positional",
      description: "Command to run: install, start, stop, status, uninstall",
      default: "status"
    },
    verbose: {
      type: "boolean",
      description: "Enable verbose logging",
      default: false
    }
  },
  async run({ args }) {
    // Platform validation
    if (platform() !== 'darwin') {
      consola.error('Status bar app is only available on macOS');
      return;
    }

    const manager = new StatusBarManager({
      verbose: args.verbose
    });

    const subcommand = args.command || args._?.[0] || 'status';

    try {
      switch (subcommand) {
        case 'install':
          await manager.install();
          break;
        case 'start':
          await manager.start();
          break;
        case 'stop':
          await manager.stop();
          break;
        case 'status':
          await manager.getStatus();
          break;
        case 'uninstall':
          await manager.uninstall();
          break;
        default:
          consola.info('Usage: copilot-api statusbar [install|start|stop|status|uninstall]');
          consola.info('');
          consola.info('Commands:');
          consola.info('  install    Download and install the status bar app');
          consola.info('  start      Launch the status bar app');
          consola.info('  stop       Quit the status bar app');
          consola.info('  status     Check if the status bar app is running');
          consola.info('  uninstall  Remove the status bar app');
      }
    } catch (error) {
      consola.error('Status bar command failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
});