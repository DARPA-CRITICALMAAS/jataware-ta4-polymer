/// Edit history management

export default class EditHistory {
  static ERASE: string = "erase";
  static ADD: string = "add";
  static BASE_TOTAL: string = "base-total";
  static BASE_PARTIAL: string = "base-partial";
  static LASSO: string = "lasso";
  static LABEL: string = "label";
  static LABEL_DELETE: string = "label-delete";
  static RADIUS: string = "radius";
  static SELECT_DELETE: string = "select-delete";

  static history: { type: string; data: unknown }[] = [];
  static future: { type: string; data: unknown }[] = [];

  static onUndo: (type: string, data: unknown) => void;
  static onRedo: (type: string, data: unknown) => void;

  static init(
    onUndo: (type: string, data: unknown) => void,
    onRedo: (type: string, data: unknown) => void,
  ) {
    EditHistory.onUndo = onUndo;
    EditHistory.onRedo = onRedo;
  }

  static save(type: string, data: unknown, resetFuture: boolean = true) {
    EditHistory.history.push({ type, data });
    if (resetFuture) EditHistory.future.length = 0;
  }

  static queue(type: string, data: unknown) {
    EditHistory.future.push({ type, data });
  }

  static undo() {
    if (EditHistory.onUndo == null) throw new Error("EditHistory.onUndo is not set");
    if (EditHistory.history.length === 0) return;

    const { type, data } = EditHistory.history.pop()!;
    const queueData = EditHistory.onUndo(type, data);
    if (queueData != null) EditHistory.queue(type, queueData);
  }

  static redo() {
    if (EditHistory.onRedo == null) throw new Error("EditHistory.onRedo is not set");
    if (EditHistory.future.length === 0) return;

    const { type, data } = EditHistory.future.pop()!;
    const saveData = EditHistory.onRedo(type, data);
    if (saveData != null) EditHistory.save(type, saveData, false);
  }

  static clear() {
    EditHistory.history.length = 0;
    EditHistory.future.length = 0;
  }
}

// @ts-expect-error DEBUG!
window.EditHistory = {
  history: EditHistory.history,
  future: EditHistory.future,
};
