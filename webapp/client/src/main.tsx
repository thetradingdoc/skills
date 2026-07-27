import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SharedView } from "./SharedView";
import { SoloWorkspace } from "./SoloWorkspace";

function Root() {
  const pathname = window.location.pathname;
  if (pathname === "/solo" || pathname.startsWith("/solo/")) {
    return <SoloWorkspace />;
  }
  // Slug parsing assumes pathname-based routing; hash routing (/#/shared/slug) is incompatible.
  if (pathname.startsWith("/shared/")) {
    const slug = pathname.replace(/^\/shared\//, "").split("/")[0];
    return slug ? <SharedView slug={slug} /> : <App />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
