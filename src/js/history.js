// zwicky. undo / redo via JSON snapshots of the whole model.
// Pure module: no DOM.
//
// Usage: call record(space) *before* a change. For text fields, call
// beginEdit(space) when the field gains focus and touch() on the first input:
// a whole typing session then becomes one undo step.

export function createHistory(limit = 200) {
  let undoStack = [];
  let redoStack = [];
  let pending = null; // snapshot taken at focus, recorded on first input

  const snap = (space) => JSON.stringify(space);

  return {
    record(space) {
      pending = null;
      undoStack.push(snap(space));
      if (undoStack.length > limit) undoStack.shift();
      redoStack = [];
    },
    beginEdit(space) {
      pending = snap(space);
    },
    /** Records the snapshot taken by beginEdit, once. Returns true if it did. */
    touch() {
      if (pending === null) return false;
      undoStack.push(pending);
      if (undoStack.length > limit) undoStack.shift();
      redoStack = [];
      pending = null;
      return true;
    },
    endEdit() {
      pending = null;
    },
    /** Returns the previous space, or null. */
    undo(current) {
      pending = null;
      if (!undoStack.length) return null;
      redoStack.push(snap(current));
      return JSON.parse(undoStack.pop());
    },
    redo(current) {
      pending = null;
      if (!redoStack.length) return null;
      undoStack.push(snap(current));
      return JSON.parse(redoStack.pop());
    },
    clear() {
      undoStack = [];
      redoStack = [];
      pending = null;
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
  };
}
