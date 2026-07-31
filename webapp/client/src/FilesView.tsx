/**
 * Files, with room to read them.
 *
 * The browser and viewer were living in a 400px sidebar, which is fine for a
 * list and useless for a 6,840-line file. This is the same two components in
 * the main area, where a file gets the width it needs.
 *
 * It is a separate view rather than part of Agents deliberately. Agents answers
 * "what runs here and what can it call" — the tool cards are the point of that
 * screen. Opening a file inside it would destroy the thing you were looking at
 * every time you followed a link.
 */
import { FileBrowser } from "./FileBrowser";
import { FileViewer } from "./FileViewer";

type Props = {
  graph?: any;
  openFile: { path: string; line?: number } | null;
  onOpenFile: (path: string, line?: number) => void;
  onClose: () => void;
  apiBase: string;
  accessToken: string | null;
};

export function FilesView({
  graph,
  openFile,
  onOpenFile,
  onClose,
  apiBase,
  accessToken,
}: Props) {
  if (!graph) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "#8b949e", lineHeight: 1.65 }}>
        Scan a repository to browse its files.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div
        style={{
          width: 320,
          flexShrink: 0,
          borderRight: "1px solid #21262d",
          padding: "14px 12px",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <FileBrowser
          graph={graph}
          openPath={openFile?.path}
          onOpen={onOpenFile}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: 12 }}>
        {openFile ? (
          <FileViewer
            projectRoot={graph?.projectRoot}
            filePath={openFile.path}
            line={openFile.line}
            apiBase={apiBase}
            accessToken={accessToken}
            onClose={onClose}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: "#6e7681",
              lineHeight: 1.7,
              textAlign: "center",
              padding: 24,
            }}
          >
            <div style={{ maxWidth: "48ch" }}>
              Pick a file on the left, or follow any filename in the app — an
              agent on the dashboard, a tool's declaration site in Agents, a
              piece of Guard evidence. They all open here.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
