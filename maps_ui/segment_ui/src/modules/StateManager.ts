/**
 * @module StateManager
 */

interface StateManagerOptions<State> {
  defaultState: State;
  cycleStates?: State[];
  parentElement: HTMLElement;
  inputName?: string;
  onChange?: (newState: State, oldState: State) => void;
}

/**
 * Represents a state manager that handles the state of radio buttons and checkboxes.
 * @template State - The type of the state.
 */
export default class StateManager<State> {
  #query = "input[type=radio], input[type=checkbox]";
  #checked_query = "input[type=radio]:checked, input[type=checkbox]:checked";

  #clickEvent: (event: MouseEvent) => void;
  #onChange: (newState: State, oldState: State) => void;
  #defaultState: State;
  #cycleStates: State[];
  #oldState: State;

  #parentElement: HTMLElement;

  /**
   * Creates a new instance of the StateManager class.
   * @param {StateManagerOptions<State>} options - The options for the state manager.
   */
  constructor({
    defaultState,
    cycleStates,
    parentElement,
    inputName,
    onChange,
  }: StateManagerOptions<State>) {
    if (defaultState === undefined) throw new Error("Default state must be set.");
    if (parentElement == null) throw new Error("Parent element must be set.");

    if (inputName != null) {
      this.#query = `input[type=radio][name="${inputName}"], input[type=checkbox][name="${inputName}"]`;
      this.#checked_query = `input[type=radio][name="${inputName}"]:checked, input[type=checkbox][name="${inputName}"]:checked`;
    }

    this.#parentElement = parentElement;
    const elements = parentElement.querySelectorAll<HTMLInputElement>(this.#query);
    const states = Array.from(elements).map((element) => element.value);

    this.#defaultState = defaultState;
    this.#oldState = defaultState;

    if (cycleStates == null) {
      this.#cycleStates = states as State[];
    } else if (!Array.isArray(cycleStates) || cycleStates.length < 2) {
      throw new Error("Cycle states must be an array with at least 2 elements.");
    } else {
      this.#cycleStates = cycleStates;
    }

    const anyMissingValues = states.some((value) => value == null);
    if (anyMissingValues) throw new Error("Some elements missing `value`.");

    if (elements.length !== states.length)
      throw new Error("States and elements must have the same length.");

    this.#onChange = onChange ?? (() => {});
    this.#clickEvent = ({ target }: MouseEvent) => {
      if (target == null) throw new Error("Target is null.");
      if (
        !(
          target instanceof HTMLInputElement &&
          (target.type === "radio" || target.type === "checkbox")
        )
      )
        throw new Error("Target is not an input element.");

      target.checked = true;
      if (onChange != null) onChange(target.value as State, this.#oldState);
      this.#oldState = this.#state as State;
    };

    for (const element of elements) {
      element.addEventListener("click", this.#clickEvent);
    }
  }

  /**
   * Gets the current state.
   * @returns {State} The current state.
   */
  get #state(): State {
    return (
      (this.#parentElement.querySelector<HTMLInputElement>(this.#checked_query)?.value as State) ??
      this.#defaultState
    );
  }

  /**
   * Gets the current state.
   * @returns {State} The current state.
   */
  get(): State {
    return this.#state;
  }

  /**
   * Checks if the current state is equal to the specified value.
   * @param {State} val - The value to compare with the current state.
   * @returns {boolean} True if the current state is equal to the specified value, false otherwise.
   */
  is(val: State): boolean {
    return this.#state === val;
  }

  /**
   * Sets the state to the specified value.
   * @param {State} val - The value to set as the state.
   */
  set #state(val: State) {
    this.#oldState = this.#state;
    const selectedElement = this.#parentElement.querySelector<HTMLInputElement>(`[value="${val}"]`);

    // Allow setting to null only if the default state is null
    if (this.#defaultState === null && this.#defaultState === val) {
      this.#onChange(val, this.#oldState);
      return;
    }

    if (selectedElement == null) throw new Error(`Element with value "${val}" not found.`);

    selectedElement!.addEventListener("click", this.#clickEvent);
    selectedElement!.dispatchEvent(new Event("click"));
  }

  /**
   * Sets the state to the specified value.
   * @param {State} val - The value to set as the state.
   */
  set(val: State) {
    this.#state = val;
  }

  /**
   * Resets the state to the default state.
   */
  reset() {
    this.#state = this.#defaultState;
  }

  /**
   * Cycles the state to the next value in the cycle states array.
   */
  cycle() {
    const currentIndex = this.#cycleStates.indexOf(this.#state);
    const nextIndex = (currentIndex + 1) % this.#cycleStates.length;
    this.#state = this.#cycleStates[nextIndex];
  }

  /**
   * Shows the parent element by removing the "hidden" class.
   */
  show() {
    this.#parentElement.classList.remove("hidden");
  }

  /**
   * Hides the parent element by adding the "hidden" class.
   */
  hide() {
    this.#parentElement.classList.add("hidden");
  }
}
