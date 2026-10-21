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

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/** The Tauri host: commands go out through one command, everything comes back as "host" events. */
function createHostBridge(): Bridge {
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

export const bridge: Bridge = window.__TAURI_INTERNALS__ ? createHostBridge() : createPreviewBridge();
