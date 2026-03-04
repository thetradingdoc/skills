/**
 * Long-running task store — background jobs, status polling, cancel.
 */

type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskRecord {
  taskId: string;
  status: TaskStatus;
  createdAt: number;
  result?: unknown;
  error?: string;
  cancelled?: boolean;
}

const tasks = new Map<string, TaskRecord>();
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function prune() {
  const now = Date.now();
  for (const [id, t] of tasks.entries()) {
    if (now - t.createdAt > MAX_AGE_MS && (t.status === "completed" || t.status === "failed" || t.status === "cancelled")) {
      tasks.delete(id);
    }
  }
}

export function createTask(): TaskRecord {
  const taskId = crypto.randomUUID();
  const task: TaskRecord = {
    taskId,
    status: "pending",
    createdAt: Date.now(),
  };
  tasks.set(taskId, task);
  prune();
  return task;
}

export function getTask(taskId: string): TaskRecord | undefined {
  return tasks.get(taskId);
}

export function setTaskRunning(taskId: string): void {
  const t = tasks.get(taskId);
  if (t) t.status = "running";
}

export function setTaskCompleted(taskId: string, result: unknown): void {
  const t = tasks.get(taskId);
  if (t && !t.cancelled) {
    t.status = "completed";
    t.result = result;
  }
}

export function setTaskFailed(taskId: string, error: string): void {
  const t = tasks.get(taskId);
  if (t) {
    t.status = "failed";
    t.error = error;
  }
}

export function cancelTask(taskId: string): boolean {
  const t = tasks.get(taskId);
  if (!t) return false;
  if (t.status === "pending" || t.status === "running") {
    t.cancelled = true;
    t.status = "cancelled";
    return true;
  }
  return false;
}

export function isTaskCancelled(taskId: string): boolean {
  return tasks.get(taskId)?.cancelled ?? false;
}
