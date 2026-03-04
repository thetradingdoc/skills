declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage: (message: unknown) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    };
  }
}

export const vscode =
  typeof window !== "undefined" && window.acquireVsCodeApi
    ? window.acquireVsCodeApi()
    : {
        postMessage: (msg: unknown) => console.log("[arch-visualizer mock]", msg),
        getState: () => null,
        setState: () => {},
      };
