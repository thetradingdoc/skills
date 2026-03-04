import * as chokidar from "chokidar";
import { EventEmitter } from "events";

export class ProjectWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 1500;

  start(rootPath: string) {
    this.watcher = chokidar.watch(
      [
        `${rootPath}/**/*.ts`,
        `${rootPath}/**/*.tsx`,
        `${rootPath}/**/.context.md`,
        `${rootPath}/**/.arch-rules.json`,
      ],
      {
        ignored: /node_modules|\.git|dist/,
        persistent: true,
        ignoreInitial: true,
      }
    );

    const trigger = () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.emit("change"), this.DEBOUNCE_MS);
    };

    this.watcher.on("change", trigger).on("add", trigger).on("unlink", trigger);
  }

  stop() {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
