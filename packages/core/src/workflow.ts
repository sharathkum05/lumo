import type { Status, Transition, Workflow } from "./model.ts";
import { LumoError } from "./errors.ts";

/** The workflow every new project gets unless it is given another one. */
export function defaultWorkflow(id = "default"): Workflow {
  const statuses: Status[] = [
    { id: "todo", name: "To Do", category: "todo" },
    { id: "in_progress", name: "In Progress", category: "in_progress" },
    { id: "in_review", name: "In Review", category: "in_progress" },
    { id: "done", name: "Done", category: "done" },
  ];
  const transitions: Transition[] = [
    { id: "11", name: "Start", from: ["todo"], to: "in_progress" },
    { id: "21", name: "Request review", from: ["in_progress"], to: "in_review" },
    { id: "31", name: "Request changes", from: ["in_review"], to: "in_progress" },
    { id: "41", name: "Done", from: [], to: "done" },
    { id: "51", name: "Reopen", from: ["done"], to: "todo" },
  ];
  return { id, name: "Default workflow", statuses, transitions, initialStatusId: "todo" };
}

export function validateWorkflow(workflow: Workflow): void {
  const ids = new Set(workflow.statuses.map((s) => s.id));
  if (ids.size !== workflow.statuses.length) {
    throw new LumoError("invalid_workflow", "Workflow has duplicate status ids");
  }
  if (!ids.has(workflow.initialStatusId)) {
    throw new LumoError("invalid_workflow", `Initial status "${workflow.initialStatusId}" is not in the workflow`);
  }
  for (const t of workflow.transitions) {
    for (const s of [...t.from, t.to]) {
      if (!ids.has(s)) {
        throw new LumoError("invalid_workflow", `Transition "${t.name}" references unknown status "${s}"`);
      }
    }
  }
}

export function findStatus(workflow: Workflow, statusId: string): Status {
  const status = workflow.statuses.find((s) => s.id === statusId);
  if (!status) throw new LumoError("not_found", `Status "${statusId}" is not in workflow "${workflow.name}"`);
  return status;
}

/** Transitions that can be taken from `statusId`, excluding ones that would not change the status. */
export function availableTransitions(workflow: Workflow, statusId: string): Transition[] {
  return workflow.transitions.filter(
    (t) => t.to !== statusId && (t.from.length === 0 || t.from.includes(statusId)),
  );
}

/**
 * Resolves a transition by id or (case-insensitive) name, as Jira clients send either.
 * Throws if it is not available from the current status.
 */
export function resolveTransition(workflow: Workflow, statusId: string, idOrName: string): Transition {
  const options = availableTransitions(workflow, statusId);
  const wanted = idOrName.toLowerCase();
  const match =
    options.find((t) => t.id === idOrName) ??
    options.find((t) => t.name.toLowerCase() === wanted) ??
    // Agents often name the target status ("move to Done") rather than the transition.
    options.find((t) => findStatus(workflow, t.to).name.toLowerCase() === wanted);
  if (!match) {
    const from = findStatus(workflow, statusId).name;
    const names = options.map((t) => `"${t.name}"`).join(", ") || "none";
    throw new LumoError("invalid_transition", `Cannot apply "${idOrName}" from "${from}". Available: ${names}`);
  }
  return match;
}
