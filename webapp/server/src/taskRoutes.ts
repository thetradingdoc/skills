/**
 * Task API — status polling, cancel.
 */

import { Router } from "express";
import {
  getTask,
  cancelTask as doCancelTask,
} from "./tasks.js";
import { optionalUser } from "./middleware/optionalUser.js";

const router = Router();

router.get("/tasks/:taskId", optionalUser, (req, res) => {
  const { taskId } = req.params;
  const task = getTask(taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({
    taskId: task.taskId,
    status: task.status,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt,
  });
});

router.post("/tasks/:taskId/cancel", optionalUser, (req, res) => {
  const { taskId } = req.params;
  const cancelled = doCancelTask(taskId);
  if (!cancelled) {
    res.status(404).json({ error: "Task not found or not cancellable" });
    return;
  }
  res.json({ taskId, status: "cancelled" });
});

export { router as taskRoutes };
