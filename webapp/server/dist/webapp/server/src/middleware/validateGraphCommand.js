/**
 * Middleware: validate graphCommand in request body.
 * Use on routes that accept graphCommand (e.g. apply-graph-command, chat with proposed command).
 * Returns 400 with structured error if graphCommand is present but invalid.
 * Logic mirrors src/ai/validateGraphCommand.ts for consistency.
 */
const VALID_LAYERS = [
    "Presentation",
    "Business Logic",
    "Data Access",
    "Infrastructure",
    "External Services",
    "Utilities",
    "Configuration",
    "Uncategorized",
];
const ID_PATTERN = /^[a-zA-Z0-9_\-/.]+$/;
const PATH_TRAVERSAL = /\.\.|\\\\|\/\//;
function validateNodeId(id) {
    if (id.length > 200)
        return "Node ID too long";
    if (PATH_TRAVERSAL.test(id))
        return "Node ID must not contain path traversal (.. or //)";
    if (!ID_PATTERN.test(id))
        return "Node ID must use only alphanumeric, underscore, hyphen, slash, or dot";
    return null;
}
function validateGraphCommand(raw) {
    if (!raw || typeof raw !== "object")
        return { valid: false, error: "graphCommand must be an object" };
    const o = raw;
    if (o.action === "create_node") {
        if (typeof o.id !== "string")
            return { valid: false, error: "create_node requires string id" };
        if (typeof o.label !== "string")
            return { valid: false, error: "create_node requires string label" };
        if (typeof o.layer !== "string")
            return { valid: false, error: "create_node requires string layer" };
        if (!VALID_LAYERS.includes(o.layer))
            return { valid: false, error: `create_node requires valid layer: ${VALID_LAYERS.join(", ")}` };
        const idErr = validateNodeId(o.id);
        if (idErr)
            return { valid: false, error: `create_node id: ${idErr}` };
        return {
            valid: true,
            command: {
                action: "create_node",
                id: o.id,
                label: o.label,
                layer: o.layer,
                description: typeof o.description === "string" ? o.description : undefined,
                archNodeId: typeof o.archNodeId === "string" ? o.archNodeId : undefined,
            },
        };
    }
    if (o.action === "connect") {
        if (typeof o.fromId !== "string")
            return { valid: false, error: "connect requires string fromId" };
        if (typeof o.toId !== "string")
            return { valid: false, error: "connect requires string toId" };
        const fromErr = validateNodeId(o.fromId);
        if (fromErr)
            return { valid: false, error: `connect fromId: ${fromErr}` };
        const toErr = validateNodeId(o.toId);
        if (toErr)
            return { valid: false, error: `connect toId: ${toErr}` };
        return {
            valid: true,
            command: {
                action: "connect",
                fromId: o.fromId,
                toId: o.toId,
                edgeType: typeof o.edgeType === "string" ? o.edgeType : undefined,
            },
        };
    }
    if (o.action === "reset")
        return { valid: true, command: { action: "reset" } };
    return { valid: false, error: "graphCommand must have action: create_node, connect, or reset" };
}
/** Structured error code for invalid graphCommand */
export const INVALID_GRAPH_COMMAND = "INVALID_GRAPH_COMMAND";
/**
 * Validates req.body.graphCommand if present.
 * - If absent: calls next()
 * - If present and valid: sets req.validatedGraphCommand, calls next()
 * - If present and invalid: returns 400 with structured error
 */
export function validateGraphCommandMiddleware(req, res, next) {
    const raw = req.body?.graphCommand;
    if (raw === undefined || raw === null) {
        next();
        return;
    }
    const result = validateGraphCommand(raw);
    if (result.valid) {
        req.validatedGraphCommand = result.command;
        next();
        return;
    }
    res.status(400).json({
        error: result.error,
        code: INVALID_GRAPH_COMMAND,
    });
}
