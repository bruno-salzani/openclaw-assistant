export class LatencyTimer {
  private readonly startedAt = Date.now();

  elapsedMs() {
    return Date.now() - this.startedAt;
  }

  elapsedSeconds() {
    return this.elapsedMs() / 1000;
  }
}
