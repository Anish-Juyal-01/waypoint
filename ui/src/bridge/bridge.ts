import type { HostMessage, UiMessage } from "./protocol";
import { createPreviewBridge } from "./previewBridge";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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
    __TAURI_INTERNALS__?: unknown;
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

/** The Tauri host: commands go out through one command, everything comes back as "host" events. */
function createTauriBridge(): Bridge {
  return {
    isPreview: false,
    send: (message) => void invoke("ui_message", { message }).catch((e) => console.error("ui_message failed", e)),
    subscribe(handler) {
      let stop: (() => void) | null = null;
      let cancelled = false;
      void listen<HostMessage>("host", (e) => handler(e.payload)).then((un) => (cancelled ? un() : (stop = un)));
      return () => {
        cancelled = true;
        stop?.();
      };
    },
  };
}

export const bridge: Bridge = window.__TAURI_INTERNALS__
  ? createTauriBridge()
  : window.chrome?.webview
    ? createHostBridge(window.chrome.webview)
    : createPreviewBridge();
