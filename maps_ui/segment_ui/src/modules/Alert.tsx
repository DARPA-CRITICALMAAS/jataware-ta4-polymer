/**
 * @module Alert
 * @description Represents an alert module.
 */

import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { useTimeout, getRandomInt } from "./utils";
import * as Element from "./Elements";

/**
 * Represents an alert object consisting only of the required properties.
 */
interface BaseAlert {
  /**
   * The unique identifier of the alert.
   */
  id: string;
  /**
   * The message to be displayed in the alert.
   */
  message: string;
}

/**
 * Represents an alert object including optional properties.
 */
interface Alert extends BaseAlert {
  /**
   * The type of the alert.
   */
  type: "default" | "success" | "info" | "warning" | "error";
  /**
   * Whether to show the alert type in the message.
   */
  showAlertType: boolean;
  /**
   * The time in milliseconds before the alert is hidden.
   */
  time?: number;
}

/**
 * Represents the AlertStore object.
 */
export const AlertStore = {
  /**
   * A map of alerts, where the key is the alert ID and the value is the alert object.
   */
  alerts: new Map<string, Alert>(),

  /**
   * A set of callback functions that are subscribed to the AlertStore.
   */
  subscribers: new Set<() => void>(),

  /**
   * A set of all alert IDs that have been used.
   */
  savedIDs: new Set<string>(),
  /**
   * Returns a snapshot of the alerts map.
   * @returns A map of alerts.
   */
  getSnapshot: (): Map<string, Alert> => AlertStore.alerts,

  /**
   * Subscribes a callback function to the AlertStore.
   * @param callback - The callback function to be subscribed.
   * @returns A function to unsubscribe the callback.
   */
  subscribe: (callback: () => void): (() => void) => {
    AlertStore.subscribers.add(callback);
    return () => AlertStore.subscribers.delete(callback);
  },

  /**
   * Notifies all subscribers by invoking their callback functions.
   */
  notify: (): void => {
    AlertStore.alerts = new Map(AlertStore.alerts);
    AlertStore.subscribers.forEach((callback) => callback());
  },

  /**
   * Generates a new unique ID for an alert.
   * @returns A string representing the new ID.
   */
  getNewID: (): string => {
    let id = 0;
    while (AlertStore.savedIDs.has(id.toString())) {
      id = getRandomInt(0, Number.MAX_SAFE_INTEGER);
    }
    const newID = id.toString();
    AlertStore.savedIDs.add(newID);
    return newID;
  },

  /**
   * Creates a new alert object with the provided properties.
   * @param alert - The properties of the alert.
   * @returns The created alert object.
   */
  create: (alert: Omit<BaseAlert, "id"> & Partial<Alert>): Alert => {
    const id = AlertStore.getNewID();
    const defaults: Omit<Alert, keyof BaseAlert> = {
      type: "default",
      showAlertType: alert.type !== "default" && alert.type !== "info",
    };
    return { ...defaults, ...alert, id };
  },

  /**
   * Shows an alert by adding it to the alerts map and notifying subscribers.
   * @param alert - The alert to be shown.
   * @returns The alert object.
   */
  show: (alert: Alert): Alert => {
    AlertStore.alerts.set(alert.id, alert);
    AlertStore.notify();
    return alert;
  },

  /**
   * Closes an alert by removing it from the alerts map and notifying subscribers.
   * @param id - The ID of the alert to be closed.
   * @returns The closed alert object, or null if the alert was not found.
   */
  close: (id: string): Alert | null => {
    const alert = AlertStore.alerts.get(id);
    const result = AlertStore.alerts.delete(id);
    AlertStore.notify();
    return result && alert ? alert : null;
  },
};

export type AlertStore = typeof AlertStore;

/**
 * A component that renders an alert.
 * @param alert - The alert object to be rendered.
 */
const Alert = ({ alert }: { alert: Alert }): JSX.Element => {
  const [isDismissed, setIsDismissed] = useState(false);
  const DISMISS_DURATION = 350;
  const dismiss = (): void => {
    setIsDismissed(true);
    setTimeout(() => AlertStore.close(alert.id), DISMISS_DURATION);
  };

  useTimeout(dismiss, alert.time);

  const icon =
    alert.type === "success"
      ? "fa-check-circle"
      : alert.type === "warning"
        ? "fa-exclamation-triangle"
        : alert.type === "error"
          ? "fa-exclamation-circle"
          : "fa-info-circle";

  return (
    <div
      role="alert"
      className={`animation-[toast-pop_0.25s_ease-out] alert pointer-events-auto w-fit gap-2 p-2 shadow-md transition-all alert-${alert.type} ${
        isDismissed && "-mt-[calc(3.5rem+2px)] -translate-y-1 opacity-0"
      }`}
      style={{ transitionDuration: `${DISMISS_DURATION}ms` }}
    >
      <i className={`fa-solid ${icon} btn btn-circle btn-ghost btn-sm pointer-events-none`}></i>
      <div>
        {alert.showAlertType && alert.type !== "default" && (
          <span className="capitalize">{alert.type}: </span>
        )}
        {alert.message}
      </div>
      <button className="btn btn-circle btn-ghost btn-sm" onClick={dismiss}>
        ✕
      </button>
    </div>
  );
};

/**
 * A component that renders a container for alerts.
 */
const AlertContainer = (): JSX.Element => {
  const alerts = useSyncExternalStore(AlertStore.subscribe, AlertStore.getSnapshot);

  return (
    <div className="toast toast-center toast-top pointer-events-none relative z-20 items-center p-2 transition-[padding-right] duration-[350ms] group-has-[#layer-toggle:checked]/page:pr-[--side-bar-width]">
      {Array.from(alerts.values(), (alert) => (
        <Alert key={alert.id} alert={alert} />
      ))}
    </div>
  );
};

const alertContainerRoot = createRoot(Element.alertContainer);
alertContainerRoot.render(<AlertContainer />);
