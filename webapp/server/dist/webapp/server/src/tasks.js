/**
 * Long-running task store — background jobs, status polling, cancel.
 */
const tasks = new Map();
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
function prune() {
    const now = Date.now();
    for (const [id, t] of tasks.entries()) {
        if (now - t.createdAt > MAX_AGE_MS && (t.status === "completed" || t.status === "failed" || t.status === "cancelled")) {
            tasks.delete(id);
        }
    }
}
export function createTask() {
    const taskId = crypto.randomUUID();
    const task = {
        taskId,
        status: "pending",
        createdAt: Date.now(),
    };
    tasks.set(taskId, task);
    prune();
    return task;
}
export function getTask(taskId) {
    return tasks.get(taskId);
}
export function setTaskRunning(taskId) {
    const t = tasks.get(taskId);
    if (t)
        t.status = "running";
}
export function setTaskCompleted(taskId, result) {
    const t = tasks.get(taskId);
    if (t && !t.cancelled) {
        t.status = "completed";
        t.result = result;
    }
}
export function setTaskFailed(taskId, error) {
    const t = tasks.get(taskId);
    if (t) {
        t.status = "failed";
        t.error = error;
    }
}
export function cancelTask(taskId) {
    const t = tasks.get(taskId);
    if (!t)
        return false;
    if (t.status === "pending" || t.status === "running") {
        t.cancelled = true;
        t.status = "cancelled";
        return true;
    }
    return false;
}
export function isTaskCancelled(taskId) {
    return tasks.get(taskId)?.cancelled ?? false;
}
