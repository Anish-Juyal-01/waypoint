import type { HostMessage, UiMessage } from "./protocol";
import { createPreviewBridge } from "./previewBridge";

export interface Bridge {
  /** True when running in a plain browser (Vite dev / design review) — not connected to Windows audio. */
  readonly isPreview: boolean;
  send(message: UiMessage): void;
  subscribe(handler: (message: HostMessage) => void): () => void;
}

interface WebView2 {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
}

declare global {
  interface Window {
    chrome?: { webview?: WebView2 };
  }
}

function createHostBridge(webview: WebView2): Bridge {
  return {
    isPreview: false,
    send: (message) => webview.postMessage(message),
    subscribe(handler) {
      const listener = (e: { data: unknown }) => handler(e.data as HostMessage);
      webview.addEventListener("message", listener);
      return () => webview.removeEventListener("message", listener);
    },
  };
}

export const bridge: Bridge = window.chrome?.webview ? createHostBridge(window.chrome.webview) : createPreviewBridge();
