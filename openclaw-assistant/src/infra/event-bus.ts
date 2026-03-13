type Listener = (payload: any) => void;

export class EventBus {
  private listeners = new Map<string, Listener[]>();

  on(topic: string, fn: Listener) {
    const arr = this.listeners.get(topic) ?? [];
    arr.push(fn);
    this.listeners.set(topic, arr);
  }

  off(topic: string, fn: Listener) {
    const arr = this.listeners.get(topic) ?? [];
    const next = arr.filter((f) => f !== fn);
    this.listeners.set(topic, next);
  }

  once(topic: string, fn: Listener) {
    const wrapper: Listener = (p) => {
      this.off(topic, wrapper);
      fn(p);
    };
    this.on(topic, wrapper);
  }

  emit(topic: string, payload: any) {
    const arr = this.listeners.get(topic) ?? [];
    for (const fn of arr) {
      try {
        fn(payload);
      } catch {}
    }
  }
}
