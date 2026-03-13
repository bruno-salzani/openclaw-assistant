export type TransitionTable<S extends string> = Record<S, S[]>;

export class StateMachine<S extends string> {
  private current: S;

  constructor(
    initial: S,
    private readonly transitions: TransitionTable<S>
  ) {
    this.current = initial;
  }

  state() {
    return this.current;
  }

  can(next: S) {
    const allowed = this.transitions[this.current] ?? [];
    return allowed.includes(next);
  }

  transition(next: S) {
    if (next === this.current) return this.current;
    if (!this.can(next)) {
      throw new Error(`invalid transition ${this.current} -> ${next}`);
    }
    this.current = next;
    return this.current;
  }
}

