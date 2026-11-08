// Whether this browser has finished the risk assessment, and whether one is
// in progress right now.
//
// The KidneyLearn unlocks only after a finished assessment: its symptom and
// medicine answers would otherwise shape how a first-time user answers the
// screening's "not sure → no" questions (REVIEW-FLAGS.md §17). No account
// exists, so "finished" is a yes/no flag in this browser — it holds no
// answers and no result. A private window or cleared site data starts locked.

const COMPLETED_KEY = "bato.assessmentCompleted";

export function hasCompletedAssessment(): boolean {
  try {
    return localStorage.getItem(COMPLETED_KEY) === "yes";
  } catch {
    return false;
  }
}

export function markAssessmentCompleted(): void {
  try {
    localStorage.setItem(COMPLETED_KEY, "yes");
  } catch {
    // Storage blocked: the chat stays locked in this browser, which is the
    // safe direction for the study.
  }
}

// In-progress state is in memory only: it exists to warn before leaving.
let inProgress = false;

export function setAssessmentInProgress(value: boolean): void {
  inProgress = value;
}

export function isAssessmentInProgress(): boolean {
  return inProgress;
}
