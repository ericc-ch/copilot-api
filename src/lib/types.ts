
// macOS Status Bar types

export interface StatusBarOptions {
  /** CLI arguments */
  _?: string[];
  /** Verbose logging */
  verbose?: boolean;
  /** Force operation without prompts */
  force?: boolean;
}

export interface StatusBarStatus {
  /** Whether the app is installed */
  installed: boolean;
  /** Whether the app is currently running */
  running: boolean;
  /** Path to the installed app */
  appPath: string;
}

export interface StatusBarError extends Error {
  code?: string;
  details?: Record<string, unknown>;
}
