import { consola } from 'consola';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { spawn, exec } from 'child_process';
import { homedir, platform } from 'os';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import type { StatusBarOptions, StatusBarStatus } from '~/lib/types';

const execAsync = promisify(exec);

/**
 * StatusBarManager
 *
 * Manages the lifecycle of the macOS Copilot API Status Bar app
 * Handles installation, launching, stopping, and status checking
 */
export class StatusBarManager {
  private readonly appName = 'Copilot Status Bar.app';
  private readonly appPath: string;
  private readonly bundledAppPath: string;

  constructor(private options: StatusBarOptions = {}) {
    this.appPath = join(homedir(), 'Applications', this.appName);
    // Path to bundled app in the npm package - use process.cwd() for bundled app
    this.bundledAppPath = join(process.cwd(), 'macos-app', this.appName);
  }

  /**
   * Install the status bar app to ~/Applications/
   */
  async install(): Promise<void> {
    consola.start('Installing Copilot Status Bar app...');

    try {
      // Ensure Applications directory exists
      const appsDir = join(homedir(), 'Applications');
      if (!existsSync(appsDir)) {
        mkdirSync(appsDir, { recursive: true });
      }

      // Check if bundled app exists
      if (!existsSync(this.bundledAppPath)) {
        throw new Error('Status bar app bundle not found. Please reinstall copilot-api.');
      }

      // Copy app to Applications directory
      await this.copyAppBundle(this.bundledAppPath, this.appPath);

      // Make executable
      await this.makeAppExecutable();

      consola.success(`Status bar app installed to: ${this.appPath}`);
      consola.info('You can now run: copilot-api statusbar start');
    } catch (error) {
      consola.error('Installation failed:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Launch the status bar app
   */
  async start(): Promise<void> {
    try {
      // Check if app is installed
      if (!existsSync(this.appPath)) {
        consola.info('Status bar app not found. Installing...');
        await this.install();
      }

      // Check if already running
      const isRunning = await this.isAppRunning();
      if (isRunning) {
        consola.info('Status bar app is already running');
        return;
      }

      consola.start('Launching Copilot Status Bar...');

      // Launch the app using macOS 'open' command
      await execAsync(`open "${this.appPath}"`);

      // Wait a moment and verify it started
      await new Promise(resolve => setTimeout(resolve, 2000));

      const started = await this.isAppRunning();
      if (started) {
        consola.success('Status bar app launched successfully');
        consola.info('Look for the terminal icon in your menu bar');
      } else {
        throw new Error('App failed to start. Check System Settings for permissions.');
      }
    } catch (error) {
      consola.error('Failed to start status bar app:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Stop the status bar app
   */
  async stop(): Promise<void> {
    try {
      const isRunning = await this.isAppRunning();
      if (!isRunning) {
        consola.info('Status bar app is not running');
        return;
      }

      consola.start('Stopping Copilot Status Bar...');

      // Kill the app process
      await execAsync('pkill -f "Copilot Status Bar" || true');

      // Verify it stopped
      await new Promise(resolve => setTimeout(resolve, 1000));
      const stopped = !(await this.isAppRunning());

      if (stopped) {
        consola.success('Status bar app stopped');
      } else {
        consola.warn('App may still be running. Try manually quitting from the menu.');
      }
    } catch (error) {
      consola.error('Failed to stop status bar app:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Get the current status of the status bar app
   */
  async getStatus(): Promise<StatusBarStatus> {
    const installed = existsSync(this.appPath);
    const running = installed ? await this.isAppRunning() : false;

    const status: StatusBarStatus = {
      installed,
      running,
      appPath: this.appPath,
    };

    // Display status
    consola.info('Copilot Status Bar Status:');
    consola.info(`  Installed: ${installed ? '✅ Yes' : '❌ No'}`);
    consola.info(`  Running:   ${running ? '✅ Yes' : '❌ No'}`);
    consola.info(`  Location:  ${this.appPath}`);

    if (installed && !running) {
      consola.info('\nRun "copilot-api statusbar start" to launch the app');
    } else if (!installed) {
      consola.info('\nRun "copilot-api statusbar install" to install the app');
    }

    return status;
  }

  /**
   * Uninstall the status bar app
   */
  async uninstall(): Promise<void> {
    try {
      // Stop if running
      const isRunning = await this.isAppRunning();
      if (isRunning) {
        await this.stop();
      }

      if (!existsSync(this.appPath)) {
        consola.info('Status bar app is not installed');
        return;
      }

      consola.start('Uninstalling Copilot Status Bar...');

      // Remove the app
      await execAsync(`rm -rf "${this.appPath}"`);

      consola.success('Status bar app uninstalled successfully');
    } catch (error) {
      consola.error('Failed to uninstall status bar app:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Check if the status bar app is currently running
   */
  private async isAppRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('ps aux | grep -i "copilot status bar" | grep -v grep');
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Copy app bundle from source to destination
   */
  private async copyAppBundle(source: string, destination: string): Promise<void> {
    try {
      // Remove destination if it exists
      if (existsSync(destination)) {
        await execAsync(`rm -rf "${destination}"`);
      }

      // Copy the entire app bundle
      await execAsync(`cp -R "${source}" "${destination}"`);
    } catch (error) {
      throw new Error(`Failed to copy app bundle: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Make the app executable
   */
  private async makeAppExecutable(): Promise<void> {
    try {
      const executablePath = join(this.appPath, 'Contents', 'MacOS', 'CopilotStatusBar');
      if (existsSync(executablePath)) {
        chmodSync(executablePath, 0o755);
      }
    } catch (error) {
      throw new Error(`Failed to make app executable: ${error instanceof Error ? error.message : error}`);
    }
  }
}