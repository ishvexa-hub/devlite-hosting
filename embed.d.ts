type LaunchCallback = (input: {nonce: string; parentOrigin: string; signal: AbortSignal}) => Promise<{code: string}>;
export function mountDevLite(options: {
  container: HTMLElement;
  providerId: string;
  dashboardUrl: string;
  height?: number;
  minHeight?: number;
  maxHeight?: number;
  timeoutMs?: number;
  title?: string;
  onStatusChange?: (status: EmbedStatus) => void;
  theme?: "light" | "dark" | "system";

  onError?: (error: Error) => void;
  onReady?: () => void;
} & ({launchUrl: string; createLaunch?: never} | {createLaunch: LaunchCallback; launchUrl?: never})): {
  iframe: HTMLIFrameElement;
  readonly status: EmbedStatus;
  reload(): void;
  destroy(): void;
};
export type EmbedStatus =
  "loading" | "authorizing" | "connected" | "error" | "destroyed";
