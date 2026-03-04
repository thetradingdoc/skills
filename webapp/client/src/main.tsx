import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SharedView } from "./SharedView";

function Root() {
  const pathname = window.location.pathname;
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
